/**
 * One server-authoritative check for a set of booking days (owner spec, Oct 17), built on the single-day engine
 * (`validateBookingAvailability`). Used by quotes, reservations, changes and invitations; the boolean month map is
 * never authoritative. It returns a reason for every failing date, never a silently truncated set.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { equipmentListings } from '@shared/schema';
import { matchingLocalInstants } from '@shared/booking-dst';
import type { DatedSlot } from '@shared/booking-occupancy';
import { effectiveMaxBookingDays, validateBookingDaysContract, type BookingDayInput } from '@shared/booking-days-contract';
import { weeklyQuotaMessage, type WeeklyQuotaWeek } from '@shared/kitchen-booking-quota';
import { policyBufferMinutes } from '@shared/kitchen-booking-policies';
import { calendarDateForOperatingTime, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { bookingService, type BookingDayReason } from '../domains/bookings/booking.service';
import { chefService } from '../domains/users/chef.service';
import { kitchenService } from '../domains/kitchens/kitchen.service';
import { kitchenBookingPolicies } from './booking-policy-settings';
import { waivesBuffer, type BookingRuleOverride } from './booking-rule-overrides';
import { weeklyQuotaShortfallsFor } from './kitchen-booking-quota';

type Slot = { startTime: string; endTime: string };

export type BookingDayRequest = {
  date: string; pricingMode: 'hourly' | 'daily';
  /** Selected one-hour slots; a full day may omit them (the whole opening window is used). */
  slots?: unknown;
  /** Legacy single-day payloads send the range; new day sets derive it from the slots. */
  startTime?: string; endTime?: string;
  equipmentIds?: unknown;
};

export type ValidatedBookingDay = {
  date: string; pricingMode: 'hourly' | 'daily'; slots: Slot[]; windowStartTime: string;
  startTime: string; endTime: string; equipmentIds: number[];
};

export type BookingDayError = { date: string; reason: BookingDayReason; message: string };

export type BookingDaysValidation =
  | { ok: true; days: ValidatedBookingDay[]; bufferMinutes: number; timezone: string }
  | { ok: false; code: string; error: string; dayErrors: BookingDayError[]; weeks?: WeeklyQuotaWeek[]; timezone?: string;
      /** 'availability' failures are inventory (409-style); 'rules' are request shape/limits. */
      kind: 'contract' | 'eligibility' | 'availability' | 'rules' | 'weekly' };

const AVAILABILITY_REASONS: BookingDayReason[] = ['closed', 'booked', 'held', 'buffer', 'beyond_advance_window', 'clock_change', 'unavailable'];

export async function validateBookingDays(input: {
  kitchenId: number;
  /** The chef booking (eligibility and weekly hours); omit for external/portal customers. */
  chefId?: number | null;
  days: BookingDayRequest[];
  /** Server-owned: the chef's own booking/hold being replaced or moved. */
  excludeBookingId?: number; excludeHoldId?: string; keepAdvanceWindow?: boolean;
  /** Saved buffer (a moved booking's or an invitation's); default the kitchen's current buffer. */
  bufferMinutes?: number | null;
  override?: BookingRuleOverride;
  /** The platform rollout gate does not apply to the one-day legacy contract. */
  legacySingleDay?: boolean;
  /** Skip the notice period (a kitchen-approved change keeps its own deadline rules). */
  skipNotice?: boolean;
  now?: Date;
  /** Already-authorized immutable contracts remain recoverable if the rollout switch is later disabled. */
  authorizedContract?: boolean;
  reader?: Pick<typeof db, 'select'>;
}): Promise<BookingDaysValidation> {
  const policy = await kitchenBookingPolicies(input.kitchenId);
  if (!policy.multidayCreationEnabled && !input.legacySingleDay && !input.authorizedContract)
    return { ok: false, code: 'MULTIDAY_DISABLED', error: 'Multi-day bookings are not available yet.', dayErrors: [], kind: 'contract' };
  const reader = input.reader ?? db;
  const contract = validateBookingDaysContract(input.days as BookingDayInput[], {
    maxBookingDays: effectiveMaxBookingDays(policy),
    multidayCreationEnabled: policy.multidayCreationEnabled || !!input.authorizedContract || !!input.legacySingleDay && input.days.length === 1,
  });
  if (!contract.ok) return { ok: false, code: contract.code, error: contract.message, dayErrors: [], kind: 'contract' };

  const kitchen = await kitchenService.getKitchenById(input.kitchenId);
  if (input.chefId) {
    const access = await chefService.getApplicationStatusForBooking(input.chefId, kitchen.locationId, input.kitchenId);
    if (!access.canBook) {
      const message = access.message || 'You cannot book this kitchen.';
      return { ok: false, code: 'not_open_to_you', error: message, kind: 'eligibility',
        dayErrors: contract.days.map(day => ({ date: day.date, reason: 'not_open_to_you' as const, message })) };
    }
  }

  const equipmentIds = Array.from(new Set(contract.days.flatMap(day => Array.isArray(day.equipmentIds) ? day.equipmentIds : [])));
  if (equipmentIds.some(id => !Number.isSafeInteger(id))) return { ok: false, code: 'equipment_unavailable', error: 'Choose equipment from this kitchen.', dayErrors: [], kind: 'rules' };
  const listings = equipmentIds.length ? await reader.select({ id: equipmentListings.id }).from(equipmentListings).where(and(
    inArray(equipmentListings.id, equipmentIds as number[]), eq(equipmentListings.kitchenId, input.kitchenId),
    eq(equipmentListings.isActive, true), isNull(equipmentListings.archivedAt))) : [];
  const activeEquipment = new Set(listings.map(listing => listing.id));

  const now = (input.now ?? new Date()).getTime();
  const minimumHours = Number(kitchen.minimumBookingHours ?? 0);
  const longest = policy.defaultDailyBookingLimit;
  const notice = Number(policy.minimumBookingWindowHours ?? 1);
  const days: ValidatedBookingDay[] = [];
  const dayErrors: BookingDayError[] = [];
  const fail = (date: string, reason: BookingDayReason, message: string) => { dayErrors.push({ date, reason, message }); };

  for (const day of [...input.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const date = new Date(`${day.date}T12:00:00Z`);
    const requested = Array.isArray(day.slots) ? day.slots as Slot[] : undefined;
    let { startTime, endTime } = day;
    if (!startTime || !endTime) {
      const window = await bookingService.operatingWindow(input.kitchenId, date);
      if ('error' in window) { fail(day.date, 'closed', window.error); continue; }
      if (requested?.length && requested.every(slot => typeof slot?.startTime === 'string' && typeof slot?.endTime === 'string')) {
        const ordered = sortTimesInOperatingWindow(requested.map(slot => slot.startTime), window.startTime);
        startTime = ordered[0];
        endTime = requested.find(slot => slot.startTime === ordered.at(-1))!.endTime;
      } else {
        startTime = window.startTime;
        endTime = window.endTime;
      }
    }
    const availability = await bookingService.validateBookingAvailability(input.kitchenId, date, startTime, endTime, {
      selectedSlots: requested, fullDay: day.pricingMode === 'daily', excludeBookingId: input.excludeBookingId,
      excludeHoldId: input.excludeHoldId, keepAdvanceWindow: input.keepAdvanceWindow, bufferMinutes: input.bufferMinutes, override: input.override,
    });
    if (!availability.valid || !availability.slots || !availability.windowStartTime) {
      fail(day.date, availability.code ?? 'unavailable', availability.error || 'This day is unavailable.');
      continue;
    }
    const slots = availability.slots, windowStartTime = availability.windowStartTime;
    // Longest booking applies to hourly days only; a full day stays available at the daily rate.
    if (day.pricingMode === 'hourly' && longest != null && slots.length > longest) { fail(day.date, 'length', `Select no more than ${longest} hourly slots`); continue; }
    const startDate = calendarDateForOperatingTime(day.date, startTime, windowStartTime);
    const startAt = matchingLocalInstants(startDate, startTime, policy.timezone)[0];
    if (!input.skipNotice && !(startAt > now)) { fail(day.date, 'notice', 'Cannot book a time slot that has already passed'); continue; }
    if (!input.skipNotice && (startAt - now) / 3_600_000 < notice) {
      fail(day.date, 'notice', `Bookings must be made at least ${notice} hour${notice !== 1 ? 's' : ''} in advance`);
      continue;
    }
    if (day.pricingMode === 'hourly' && minimumHours > 0 && slots.length < minimumHours) {
      fail(day.date, 'length', `This kitchen requires a minimum of ${minimumHours} hour${minimumHours > 1 ? 's' : ''} per booking. You selected ${slots.length}.`);
      continue;
    }
    const dayEquipment = Array.isArray(day.equipmentIds) ? day.equipmentIds as number[] : [];
    if (dayEquipment.some(id => !activeEquipment.has(id))) { fail(day.date, 'equipment_unavailable', 'Some equipment is not available that day.'); continue; }
    days.push({ date: day.date, pricingMode: day.pricingMode, slots, windowStartTime, startTime: slots[0].startTime,
      endTime: slots.at(-1)!.endTime, equipmentIds: dayEquipment });
  }

  if (dayErrors.length) {
    const first = dayErrors[0];
    return { ok: false, code: first.reason, error: first.message, dayErrors, timezone: policy.timezone,
      kind: AVAILABILITY_REASONS.includes(first.reason) ? 'availability' : 'rules' };
  }

  const proposed: DatedSlot[] = days.flatMap(day => day.slots.map(slot => ({ date: day.date, windowStartTime: day.windowStartTime, ...slot })));
  const weeks = await weeklyQuotaShortfallsFor({ kitchenId: input.kitchenId, chefId: input.chefId, limitHours: policy.weeklyChefHoursLimit,
    proposed, excludeBookingId: input.excludeBookingId, excludeHoldId: input.excludeHoldId, override: input.override }, reader);
  if (weeks.length) {
    const message = weeklyQuotaMessage(weeks[0]);
    const blocked = new Set(weeks.map(week => week.weekStart));
    const { weekStartDate } = await import('@shared/kitchen-booking-quota');
    return { ok: false, code: 'WEEKLY_CHEF_HOURS_LIMIT', error: message, weeks, timezone: policy.timezone, kind: 'weekly',
      dayErrors: days.filter(day => blocked.has(weekStartDate(day.date))).map(day => ({ date: day.date, reason: 'weekly_limit' as const, message })) };
  }
  return { ok: true, days, bufferMinutes: waivesBuffer(input.override) ? 0 : input.bufferMinutes ?? policyBufferMinutes(policy), timezone: policy.timezone };
}

/** HTTP body for a failed validation (weekly-limit failures carry their weeks for the "used 6 of 8 hours" message). */
export function bookingDaysErrorBody(result: Extract<BookingDaysValidation, { ok: false }>) {
  return { error: result.error, code: result.code, dayErrors: result.dayErrors,
    ...(result.weeks ? { weeks: result.weeks, timezone: result.timezone } : {}) };
}
