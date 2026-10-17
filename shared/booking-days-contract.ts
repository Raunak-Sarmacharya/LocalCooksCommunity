/**
 * Pure day-set contract for multi-day kitchen bookings (CP1 adapter).
 * Not wired into checkout; callers pass effective max days and the platform rollout gate.
 */
import { daysBetween } from './storage-rental';

export const BOOKING_DAYS_SPAN_MAX = 14;
export const BOOKING_DAYS_PLATFORM_CAP = 14;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BookingDayPricingMode = 'hourly' | 'daily';

export type BookingDayInput = {
  date: string;
  pricingMode: BookingDayPricingMode;
  slots?: unknown;
  equipmentIds?: unknown;
};

export type BookingDaysContractOptions = {
  /** Effective max selected days (1 when multi-day is Off). */
  maxBookingDays: number;
  /** Platform rollout gate; false rejects any multi-day / new day-set payload. */
  multidayCreationEnabled: boolean;
  /** Kitchen/location timezone (reserved for callers that project wall-clock dates). */
  timezone?: string;
};

export type BookingDaysContractOk = {
  ok: true;
  days: BookingDayInput[];
  firstDate: string;
  lastDate: string;
  dayCount: number;
};

export type BookingDaysContractError = {
  ok: false;
  code:
    | 'MULTIDAY_DISABLED'
    | 'EMPTY_DAYS'
    | 'INVALID_DATE'
    | 'DUPLICATE_DATE'
    | 'TOO_MANY_DAYS'
    | 'SPAN_TOO_LONG'
    | 'INVALID_PRICING_MODE';
  message: string;
};

export type BookingDaysContractResult = BookingDaysContractOk | BookingDaysContractError;

function isValidCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const ms = Date.UTC(+match[1], +match[2] - 1, +match[3]);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * Validate a day-set payload: unique valid dates, count within effective max,
 * and calendar span (last − first) ≤ 14 days. DST-safe via UTC calendar-day math.
 */
export function validateBookingDaysContract(
  days: BookingDayInput[] | null | undefined,
  options: BookingDaysContractOptions,
): BookingDaysContractResult {
  if (!Array.isArray(days) || days.length === 0) {
    return { ok: false, code: 'EMPTY_DAYS', message: 'Select at least one day.' };
  }

  const maxDays = Math.max(1, Math.min(BOOKING_DAYS_PLATFORM_CAP, Math.floor(options.maxBookingDays) || 1));
  if (!options.multidayCreationEnabled && days.length > 1) {
    return {
      ok: false,
      code: 'MULTIDAY_DISABLED',
      message: 'Multi-day bookings are not available yet.',
    };
  }
  if (days.length > maxDays) {
    return {
      ok: false,
      code: 'TOO_MANY_DAYS',
      message: maxDays === 1
        ? 'This kitchen accepts one day per booking.'
        : `Select up to ${maxDays} days in one booking.`,
    };
  }

  const seen = new Set<string>();
  const normalized: BookingDayInput[] = [];
  for (const day of days) {
    if (!day || typeof day.date !== 'string' || !isValidCalendarDate(day.date)) {
      return { ok: false, code: 'INVALID_DATE', message: 'Each day needs a valid calendar date.' };
    }
    if (seen.has(day.date)) {
      return { ok: false, code: 'DUPLICATE_DATE', message: 'Each date can only be selected once.' };
    }
    if (day.pricingMode !== 'hourly' && day.pricingMode !== 'daily') {
      return { ok: false, code: 'INVALID_PRICING_MODE', message: 'Each day must be hourly or daily.' };
    }
    seen.add(day.date);
    normalized.push({
      date: day.date,
      pricingMode: day.pricingMode,
      slots: day.slots,
      equipmentIds: day.equipmentIds,
    });
  }

  normalized.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const firstDate = normalized[0]!.date;
  const lastDate = normalized[normalized.length - 1]!.date;
  // Inclusive span: first + 14 allowed (difference 14); first + 15 refused (difference 15).
  if (daysBetween(firstDate, lastDate) > BOOKING_DAYS_SPAN_MAX) {
    return {
      ok: false,
      code: 'SPAN_TOO_LONG',
      message: 'All selected days must fall within 14 days of the first day.',
    };
  }

  return {
    ok: true,
    days: normalized,
    firstDate,
    lastDate,
    dayCount: normalized.length,
  };
}

/** Effective max days for a kitchen: Off → 1, else min(override ?? location ?? 7, platform cap). */
export function effectiveMaxBookingDays(input: {
  allowMultiDayBookings: boolean;
  maxBookingDays: number;
}): number {
  if (!input.allowMultiDayBookings) return 1;
  return Math.max(1, Math.min(BOOKING_DAYS_PLATFORM_CAP, Math.floor(input.maxBookingDays) || 1));
}
