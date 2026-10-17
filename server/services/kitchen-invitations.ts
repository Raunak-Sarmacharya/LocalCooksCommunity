import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  chefLocationAccess,
  equipmentListings,
  kitchenBookings,
  kitchenInvitationEvents,
  kitchenInvitations,
  kitchens,
  locations,
  users,
} from '@shared/schema';
import { bookingService } from '../domains/bookings/booking.service';
import { chefService } from '../domains/users/chef.service';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { getUserDisplayName } from '../utils/user-display';
import { workerAfter, workerBatch, workerPageEnd, workerRecord } from './worker-context';
import { readLocationBookingEligibility } from './location-booking-eligibility';
import { publishedCancellationPolicy } from './cancellation-policy-settings';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { matchingLocalInstants } from '@shared/booking-dst';
import { notificationService } from './notification.service';
import { ensureServerI18n, tLocale } from '../i18n';
import { sendEmail } from '../email';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { operationalEmailAllowed } from './admin-email-preferences';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { kitchenBookingPolicies } from './booking-policy-settings';
import { BookingRuleOverrideError, invitationOverrideScope, kitchenRuleOverride, overrideRecord, savedInvitationOverride, type BookingRuleOverride } from './booking-rule-overrides';
import { weeklyQuotaShortfallsFor } from './kitchen-booking-quota';
import { weeklyQuotaMessage } from '@shared/kitchen-booking-quota';
import { policyBufferMinutes } from '@shared/kitchen-booking-policies';

export const invitationStatuses = [
  'sent', 'accepted_pending_payment', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded', 'unavailable',
] as const;
export type InvitationStatus = typeof invitationStatuses[number];
export type InvitationDiscount = { type: 'amount' | 'percent'; value: number };
export type InvitationInput = {
  kitchenId: number; chefId: number; date: string; startTime: string; endTime: string;
  discount?: InvitationDiscount; expiresInHours: 24 | 48 | 168; note?: string;
  /** The kitchen's explicit, reasoned override of its own buffer and/or this chef's weekly limit (audited). */
  ruleOverride?: { ignoreBuffer?: boolean; ignoreWeeklyLimit?: boolean; reason?: string };
};

const scopedRecord = (override: BookingRuleOverride | undefined, row: { id: string; kitchenId: number; chefId: number }) =>
  override ? { ...overrideRecord(override)!, scope: invitationOverrideScope(row) } : null;

export class InvitationError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid_invitation') { super(message); }
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):(?:00|30)$/;

export function offeredInvitationSubtotal(list: number, discount?: InvitationDiscount) {
  if (!Number.isSafeInteger(list) || list < 100) throw new InvitationError('The kitchen subtotal must be at least $1.00.');
  if (!discount) return list;
  if (!Number.isSafeInteger(discount.value) || discount.value < 0) throw new InvitationError('Discount must be a non-negative whole number.');
  const offered = discount.type === 'amount'
    ? list - discount.value
    : discount.type === 'percent' && discount.value <= 100
      ? Math.round(list * (100 - discount.value) / 100)
      : NaN;
  if (!Number.isSafeInteger(offered)) throw new InvitationError('Percent discount must be between 0 and 100.');
  if (offered < 100) throw new InvitationError('The offered kitchen subtotal must be at least $1.00.');
  return offered;
}

export function invitationStatusAt(status: string, expiresAt: Date, now = new Date()): InvitationStatus {
  return status === 'sent' && now >= expiresAt ? 'expired' : status as InvitationStatus;
}
function readStatus(row: typeof kitchenInvitations.$inferSelect, now = new Date()): InvitationStatus {
  return invitationStatusAt(row.status, row.expiresAt, now);
}

async function context(kitchenId: number) {
  const [row] = await db.select({
    kitchenId: kitchens.id, kitchenName: kitchens.name, photoUrl: kitchens.imageUrl,
    locationId: locations.id, locationName: locations.name, managerId: locations.managerId,
    timezone: locations.timezone, hourlyRate: kitchens.hourlyRate, dailyRate: kitchens.dailyRate,
    taxRatePercent: kitchens.taxRatePercent, listingStatus: kitchens.listingStatus, active: kitchens.isActive,
    kitchenDailyLimit: kitchens.defaultDailyBookingLimit, locationDailyLimit: locations.defaultDailyBookingLimit,
  }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchens.id, kitchenId)).limit(1);
  if (!row || !row.active || row.listingStatus !== 'active') throw new InvitationError('Kitchen not found.', 404);
  return row;
}

function validateInput(input: InvitationInput) {
  if (!input || typeof input !== 'object') throw new InvitationError('Invitation details are required.');
  if (!Number.isSafeInteger(input.kitchenId) || !Number.isSafeInteger(input.chefId)) throw new InvitationError('Kitchen and customer are required.');
  if (!datePattern.test(input.date) || !timePattern.test(input.startTime) || !timePattern.test(input.endTime) || input.startTime === input.endTime)
    throw new InvitationError('Use a valid date and consecutive half-hour times.');
  if (![24, 48, 168].includes(input.expiresInHours)) throw new InvitationError('Expiry must be 24, 48, or 168 hours.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length > 500))
    throw new InvitationError('Note must be 500 characters or less.');
  if (input.discount !== undefined && (!input.discount || typeof input.discount !== 'object'
    || !['amount', 'percent'].includes(input.discount.type))) throw new InvitationError('Discount type must be amount or percent.');
}

function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

async function pendingRequestConflict(input: InvitationInput) {
  const rows = await db.select({ startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime })
    .from(kitchenBookings).where(and(eq(kitchenBookings.kitchenId, input.kitchenId), eq(kitchenBookings.chefId, input.chefId),
      eq(kitchenBookings.status, 'pending'), sql`${kitchenBookings.bookingDate}::date = ${input.date}::date`));
  return rows.some(row => overlaps(input, row));
}

export async function previewKitchenInvitation(managerId: number, input: InvitationInput) {
  validateInput(input);
  await ensureServerI18n();
  const [reader] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, managerId)).limit(1);
  const locale = reader?.locale || 'en-CA';
  const ctx = await context(input.kitchenId);
  if (ctx.managerId !== managerId) throw new InvitationError('Kitchen not found.', 404);
  let override: BookingRuleOverride | undefined;
  try {
    override = kitchenRuleOverride({ actorId: managerId, actorRole: 'manager', scope: 'invitation-preview', ...(input.ruleOverride ?? {}) });
  } catch (error) {
    if (error instanceof BookingRuleOverrideError) throw new InvitationError(error.message);
    throw error;
  }
  const rules = await kitchenBookingPolicies(input.kitchenId);
  // Frozen with the invitation and used through checkout; an explicit kitchen waiver saves Off.
  const bufferMinutes = override?.ignoreBuffer ? 0 : policyBufferMinutes(rules);
  const eligibility = await chefService.getApplicationStatusForBooking(input.chefId, ctx.locationId, input.kitchenId);
  const date = new Date(`${input.date}T12:00:00.000Z`);
  const hourlyAvailability = await bookingService.validateBookingAvailability(input.kitchenId, date, input.startTime, input.endTime, { bufferMinutes, override });
  const dailyAvailability = Number(ctx.dailyRate || 0) > 0
    ? await bookingService.validateBookingAvailability(input.kitchenId, date, input.startTime, input.endTime, { fullDay: true, bufferMinutes, override })
    : { valid: false as const };
  const useDaily = dailyAvailability.valid && dailyAvailability.slots?.[0]?.startTime === input.startTime
    && dailyAvailability.slots?.at(-1)?.endTime === input.endTime;
  const availability = useDaily ? dailyAvailability : hourlyAvailability;
  const slots = availability.slots || [];
  const pricingMode = useDaily || Number(ctx.hourlyRate || 0) <= 0 ? 'daily' as const : 'hourly' as const;
  // Longest booking: null at kitchen + location = no cap; otherwise hourly length must fit.
  const dailyLimit = ctx.kitchenDailyLimit ?? ctx.locationDailyLimit ?? null;
  const exceedsDailyLimit = pricingMode === 'hourly' && dailyLimit != null && slots.length > dailyLimit;
  // An unavailable time still gets priced by the hours asked for, so the kitchen reads "not available", not a price error.
  const [startH, startM] = input.startTime.split(':').map(Number), [endH, endM] = input.endTime.split(':').map(Number);
  const requestedHours = ((endH * 60 + endM - startH * 60 - startM + 1440) % 1440) / 60;
  const listSubtotalCents = pricingMode === 'daily'
    ? Math.round(Number(ctx.dailyRate || 0))
    : Math.round(Math.round(Number(ctx.hourlyRate || 0)) * (slots.length || requestedHours));
  const offeredSubtotalCents = offeredInvitationSubtotal(listSubtotalCents, input.discount);
  const taxCents = Math.round(offeredSubtotalCents * Number(ctx.taxRatePercent || 0) / 100);
  const fees = await calculateCheckoutFeesAsync(offeredSubtotalCents, { taxAmountCents: taxCents });
  const requestedExpiry = new Date(Date.now() + input.expiresInHours * 3_600_000);
  const policy = await publishedCancellationPolicy(input.kitchenId);
  const calendarDate = calendarDateForOperatingTime(input.date, input.startTime, availability.windowStartTime || input.startTime);
  const startInstant = matchingLocalInstants(calendarDate, input.startTime, ctx.timezone || 'America/St_Johns')[0];
  const latestExpiry = new Date(startInstant - (policy.noticeHours * 60 + 37) * 60_000);
  const expiresAt = new Date(Math.min(requestedExpiry.getTime(), latestExpiry.getTime()));
  if (expiresAt <= new Date()) throw new InvitationError('This time is too soon for an invitation checkout.', 409);
  const conflict = await pendingRequestConflict(input);
  const activeInvitations = await db.select({ startTime: kitchenInvitations.startTime, endTime: kitchenInvitations.endTime }).from(kitchenInvitations)
    .where(and(eq(kitchenInvitations.kitchenId, input.kitchenId), eq(kitchenInvitations.date, input.date),
      inArray(kitchenInvitations.status, ['sent', 'accepted_pending_payment'])));
  const warnings = activeInvitations.some(row => overlaps(input, row))
    ? [tLocale(locale, 'booking:invOverlapWarning')] : [];
  // Weekly hours are only reserved when the chef checks out; the kitchen sees the shortfall now and may override it.
  const weeklyLimit = availability.valid && availability.windowStartTime ? await weeklyQuotaShortfallsFor({ kitchenId: input.kitchenId,
    chefId: input.chefId, limitHours: rules.weeklyChefHoursLimit, override,
    proposed: slots.map(slot => ({ date: input.date, windowStartTime: availability.windowStartTime!, ...slot })) }) : [];
  const available = eligibility.canBook && availability.valid && !conflict && !exceedsDailyLimit && !weeklyLimit.length;
  return {
    pricing: {
      listSubtotalCents, offeredSubtotalCents, discount: input.discount || null,
      taxCents, serviceFeeCents: fees.platformCommissionInCents,
      totalCents: offeredSubtotalCents + taxCents + fees.platformCommissionInCents,
      managerEstimatedPayoutCents: fees.managerReceivesInCents,
    },
    expiresAt: expiresAt.toISOString(),
    available,
    ...(!available ? { unavailableReason: !eligibility.canBook
      ? tLocale(locale, 'booking:invUnavailable')
      : conflict ? tLocale(locale, 'booking:invPendingConflict')
        : exceedsDailyLimit ? tLocale(locale, 'booking:invUnavailable')
          : weeklyLimit.length ? weeklyQuotaMessage(weeklyLimit[0])
            : tLocale(locale, 'booking:invUnavailable') } : {}),
    ...(weeklyLimit.length ? { weeklyLimit: { code: 'WEEKLY_CHEF_HOURS_LIMIT', weeks: weeklyLimit, timezone: rules.timezone } } : {}),
    warnings,
    internal: { ctx, slots, pricingMode, policy, windowStartTime: availability.windowStartTime || input.startTime, bufferMinutes, override },
  };
}

async function event(tx: any, invitation: { id: string; version: number }, kind: string, actorId?: number, actorRole?: string, reason?: string, metadata: object = {}) {
  await tx.insert(kitchenInvitationEvents).values({
    invitationId: invitation.id, version: invitation.version, kind, actorId, actorRole, reason, metadata,
    noticeKey: `${invitation.id}:${invitation.version}:${kind}:${randomUUID()}`,
  });
  wakeInvitationDelivery(invitation.id);
}

/** Best-effort wakeup (debounced well past the producing commit); the outbox row and the backstop tick stay authoritative. */
export function wakeInvitationDelivery(invitationId: string) {
  if (!process.env.INNGEST_EVENT_KEY || isE2eOutboundSuppressed()) return;
  void import('../lifecycle-inngest')
    .then(({ inngest, invitationNoticeEvent }) => inngest.send({ name: invitationNoticeEvent, data: { invitationId } }))
    .catch(error => console.warn('[Invitations] Delivery wakeup not sent; the backstop tick will deliver', error instanceof Error ? error.message : error));
}

export async function createKitchenInvitation(managerId: number, input: InvitationInput & { requestKey: string }) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.requestKey)) throw new InvitationError('requestKey must be a UUID.');
  const [existing] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.requestKey, input.requestKey)).limit(1);
  if (existing) {
    if (existing.managerId !== managerId) throw new InvitationError('Invitation not found.', 404);
    return invitationDto(existing, 'manager');
  }
  const preview = await previewKitchenInvitation(managerId, input);
  if (!preview.available) throw new InvitationError(preview.unavailableReason || 'These dates are unavailable.', 409);
  let row: typeof kitchenInvitations.$inferSelect;
  try { row = await db.transaction(async tx => {
    const id = randomUUID();
    const [created] = await tx.insert(kitchenInvitations).values({
      id, requestKey: input.requestKey, kitchenId: input.kitchenId, locationId: preview.internal.ctx.locationId,
      managerId, chefId: input.chefId, status: 'sent', version: 1, date: input.date,
      startTime: input.startTime, endTime: input.endTime, operatingWindowStartTime: preview.internal.windowStartTime,
      timezone: preview.internal.ctx.timezone || 'America/St_Johns',
      pricingMode: preview.internal.pricingMode, selectedSlots: preview.internal.slots,
      listSubtotalCents: preview.pricing.listSubtotalCents, offeredSubtotalCents: preview.pricing.offeredSubtotalCents,
      discountType: input.discount?.type, discountValue: input.discount?.value,
      taxCents: preview.pricing.taxCents, serviceFeeCents: preview.pricing.serviceFeeCents,
      totalCents: preview.pricing.totalCents, managerEstimatedPayoutCents: preview.pricing.managerEstimatedPayoutCents,
      cancellationPolicyHours: preview.internal.policy.noticeHours,
      cancellationChargePercent: preview.internal.policy.lateChargePercent,
      note: input.note?.trim() || null, expiresInHours: input.expiresInHours, expiresAt: new Date(preview.expiresAt),
      bufferMinutesSnapshot: preview.internal.bufferMinutes,
      bookingRuleOverrides: scopedRecord(preview.internal.override, { id, kitchenId: input.kitchenId, chefId: input.chefId }),
    }).returning();
    await event(tx, created, 'created', managerId, 'manager', undefined,
      created.bookingRuleOverrides ? { ruleOverride: created.bookingRuleOverrides } : {});
    await event(tx, created, 'sent', managerId, 'manager');
    return created;
  }); } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    const [won] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.requestKey, input.requestKey)).limit(1);
    if (!won || won.managerId !== managerId) throw new InvitationError('requestKey is already in use.', 409);
    row = won;
  }
  return invitationDto(row, 'manager');
}

type Reader = 'manager' | 'chef' | 'admin';
export async function invitationDto(row: typeof kitchenInvitations.$inferSelect, reader: Reader, now = new Date(), locale?: string) {
  if (!locale) {
    const personId = reader === 'chef' ? row.chefId : row.managerId;
    const [person] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, personId)).limit(1);
    locale = person?.locale || 'en-CA';
  }
  const ctx = await context(row.kitchenId);
  let status = readStatus(row, now);
  if (status === 'sent') {
    const [availability, eligibility] = await Promise.all([
      bookingService.validateBookingAvailability(row.kitchenId, new Date(`${row.date}T12:00:00Z`), row.startTime, row.endTime, {
        selectedSlots: row.selectedSlots as Array<{ startTime: string; endTime: string }>, fullDay: row.pricingMode === 'daily',
        bufferMinutes: row.bufferMinutesSnapshot, override: savedInvitationOverride(row),
      }),
      chefService.getApplicationStatusForBooking(row.chefId, row.locationId, row.kitchenId),
    ]);
    if (!availability.valid || !eligibility.canBook) status = 'unavailable';
  }
  const chefName = reader === 'chef' ? null : await getUserDisplayName(row.chefId, 'chef').catch(() => 'Customer');
  return {
    id: row.id, version: row.version, status,
    kitchen: { id: ctx.kitchenId, name: ctx.kitchenName, locationId: ctx.locationId, locationName: ctx.locationName, photoUrl: ctx.photoUrl },
    chef: reader === 'chef' ? null : { id: row.chefId, name: chefName || 'Customer' },
    date: row.date, startTime: row.startTime, endTime: row.endTime, timezone: row.timezone,
    pricing: {
      listSubtotalCents: row.listSubtotalCents, offeredSubtotalCents: row.offeredSubtotalCents,
      discount: row.discountType ? { type: row.discountType, value: row.discountValue! } : null,
      taxCents: row.taxCents, serviceFeeCents: row.serviceFeeCents, totalCents: row.totalCents,
      ...(reader !== 'chef' ? { managerEstimatedPayoutCents: row.managerEstimatedPayoutCents } : {}),
    },
    note: row.note, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
    bookingId: row.bookingId,
    // The chef reads the kitchen's published policy against this start, exactly as a normal checkout does.
    startAt: new Date(matchingLocalInstants(calendarDateForOperatingTime(row.date, row.startTime, row.operatingWindowStartTime), row.startTime, row.timezone)[0]).toISOString(),
    ...(reader !== 'chef' ? { canWithdraw: status === 'sent', canReplace: status !== 'accepted_pending_payment' && status !== 'accepted' } : {}),
    ...(reader === 'chef' ? { canPay: status === 'sent' || status === 'accepted_pending_payment', canDecline: status === 'sent' } : {}),
  };
}

/** The invited kitchen time plus any rental equipment the chef adds; no add-ons keeps the exact offered total. */
export async function invitationCheckoutPricing(row: typeof kitchenInvitations.$inferSelect, equipmentIds: unknown = []) {
  if (!Array.isArray(equipmentIds) || equipmentIds.length > 10 || equipmentIds.some(id => !Number.isSafeInteger(id)))
    throw new InvitationError('Choose equipment from this kitchen.');
  const listings = await db.select().from(equipmentListings).where(and(eq(equipmentListings.kitchenId, row.kitchenId),
    eq(equipmentListings.availabilityType, 'rental'), eq(equipmentListings.isActive, true), isNull(equipmentListings.archivedAt)));
  const equipment = Array.from(new Set(equipmentIds as number[])).map(id => {
    const listing = listings.find(item => item.id === id);
    if (!listing) throw new InvitationError('That equipment is no longer offered. Refresh and choose again.', 409, 'equipment_unavailable');
    return { listingId: id, name: `Equipment: ${listing.brand ? `${listing.brand} ` : ''}${listing.equipmentType}`, priceCents: Math.round(Number(listing.sessionRate || 0)) };
  });
  if (!equipment.length) return { equipment, subtotalCents: row.offeredSubtotalCents, taxCents: row.taxCents,
    serviceFeeCents: row.serviceFeeCents, totalCents: row.totalCents };
  const { taxRatePercent } = await context(row.kitchenId);
  const subtotalCents = row.offeredSubtotalCents + equipment.reduce((sum, item) => sum + item.priceCents, 0);
  const taxCents = Math.round(subtotalCents * Number(taxRatePercent || 0) / 100);
  const fees = await calculateCheckoutFeesAsync(subtotalCents, { taxAmountCents: taxCents });
  return { equipment, subtotalCents, taxCents, serviceFeeCents: fees.platformCommissionInCents,
    totalCents: subtotalCents + taxCents + fees.platformCommissionInCents };
}

export async function getInvitationForChef(id: string, chefId: number) {
  const [row] = await db.select().from(kitchenInvitations).where(and(eq(kitchenInvitations.id, id), eq(kitchenInvitations.chefId, chefId))).limit(1);
  if (!row) throw new InvitationError('Invitation not found.', 404);
  return row;
}

export async function listKitchenInvitations(reader: Reader, actorId: number, filters: Record<string, unknown> = {}) {
  await ensureServerI18n();
  const [person] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, actorId)).limit(1);
  const locale = person?.locale || 'en-CA';
  const clauses = reader === 'chef' ? [eq(kitchenInvitations.chefId, actorId)]
    : reader === 'manager' ? [eq(kitchenInvitations.managerId, actorId)] : [];
  for (const [key, column] of [['chefId', kitchenInvitations.chefId], ['kitchenId', kitchenInvitations.kitchenId], ['locationId', kitchenInvitations.locationId]] as const) {
    const value = Number(filters[key]);
    if (Number.isSafeInteger(value)) clauses.push(eq(column, value));
  }
  const requestedStatus = typeof filters.status === 'string' && invitationStatuses.includes(filters.status as InvitationStatus)
    ? filters.status as InvitationStatus : undefined;
  const rows = await db.select().from(kitchenInvitations).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(kitchenInvitations.createdAt));
  const dtos = (await Promise.all(rows.map(row => invitationDto(row, reader, new Date(), locale))))
    .filter(invitation => !requestedStatus || invitation.status === requestedStatus);
  return reader === 'chef' ? dtos.sort((a, b) =>
    Number(['sent', 'accepted_pending_payment'].includes(b.status)) - Number(['sent', 'accepted_pending_payment'].includes(a.status))) : dtos;
}

async function transition(id: string, actor: { id: number; role: Reader }, version: number, from: string[], to: string, reason?: string) {
  const [person] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, actor.id)).limit(1);
  const row = await db.transaction(async tx => {
    const clauses = [eq(kitchenInvitations.id, id), eq(kitchenInvitations.version, version), inArray(kitchenInvitations.status, from)];
    if (actor.role === 'manager') clauses.push(eq(kitchenInvitations.managerId, actor.id));
    if (actor.role === 'chef') clauses.push(eq(kitchenInvitations.chefId, actor.id));
    if (actor.role !== 'admin' && from.includes('sent')) clauses.push(sql`${kitchenInvitations.expiresAt} > now()`);
    const [row] = await tx.update(kitchenInvitations).set({ status: to, version: version + 1, updatedAt: new Date() })
      .where(and(...clauses)).returning();
    if (!row) throw new InvitationError('Invitation changed; refresh and try again.', 409, 'version_conflict');
    await event(tx, row, to, actor.id, actor.role, reason);
    return row;
  });
  return invitationDto(row, actor.role, new Date(), person?.locale || 'en-CA');
}

export const withdrawKitchenInvitation = (id: string, managerId: number, version: number) =>
  transition(id, { id: managerId, role: 'manager' }, version, ['sent'], 'withdrawn');
export const declineKitchenInvitation = (id: string, chefId: number, version: number, reason?: string) =>
  transition(id, { id: chefId, role: 'chef' }, version, ['sent'], 'declined', reason?.trim().slice(0, 500));

export async function replaceKitchenInvitation(id: string, managerId: number, version: number, input: InvitationInput & { requestKey: string }) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.requestKey)) throw new InvitationError('requestKey must be a UUID.');
  const [existing] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.requestKey, input.requestKey)).limit(1);
  if (existing) {
    if (existing.managerId !== managerId || existing.replacesId !== id) throw new InvitationError('requestKey is already in use.', 409);
    return invitationDto(existing, 'manager');
  }
  const preview = await previewKitchenInvitation(managerId, input);
  if (!preview.available) throw new InvitationError(preview.unavailableReason || 'These dates are unavailable.', 409);
  const row = await db.transaction(async tx => {
    const [old] = await tx.select().from(kitchenInvitations)
      .where(and(eq(kitchenInvitations.id, id), eq(kitchenInvitations.managerId, managerId))).limit(1).for('update');
    if (!old || old.version !== version || old.status !== 'sent' || old.expiresAt <= new Date())
      throw new InvitationError('Invitation changed; refresh and try again.', 409);
    const replacementId = randomUUID();
    const [replacement] = await tx.insert(kitchenInvitations).values({
      id: replacementId, requestKey: input.requestKey, replacesId: id, kitchenId: input.kitchenId,
      locationId: preview.internal.ctx.locationId, managerId, chefId: input.chefId, status: 'sent', version: version + 1,
      date: input.date, startTime: input.startTime, endTime: input.endTime, operatingWindowStartTime: preview.internal.windowStartTime,
      timezone: preview.internal.ctx.timezone || 'America/St_Johns', pricingMode: preview.internal.pricingMode,
      selectedSlots: preview.internal.slots, listSubtotalCents: preview.pricing.listSubtotalCents,
      offeredSubtotalCents: preview.pricing.offeredSubtotalCents, discountType: input.discount?.type,
      discountValue: input.discount?.value, taxCents: preview.pricing.taxCents,
      serviceFeeCents: preview.pricing.serviceFeeCents, totalCents: preview.pricing.totalCents,
      managerEstimatedPayoutCents: preview.pricing.managerEstimatedPayoutCents, note: input.note?.trim() || null,
      cancellationPolicyHours: preview.internal.policy.noticeHours,
      cancellationChargePercent: preview.internal.policy.lateChargePercent,
      expiresInHours: input.expiresInHours, expiresAt: new Date(preview.expiresAt),
      bufferMinutesSnapshot: preview.internal.bufferMinutes,
      bookingRuleOverrides: scopedRecord(preview.internal.override, { id: replacementId, kitchenId: input.kitchenId, chefId: input.chefId }),
    }).returning();
    const [changed] = await tx.update(kitchenInvitations).set({ status: 'superseded', version: version + 1, updatedAt: new Date() })
      .where(and(eq(kitchenInvitations.id, id), eq(kitchenInvitations.version, version), eq(kitchenInvitations.status, 'sent'))).returning();
    if (!changed) throw new InvitationError('Invitation changed; refresh and try again.', 409);
    await event(tx, changed, 'superseded', managerId, 'manager', undefined, { replacementId });
    await event(tx, replacement, 'created', managerId, 'manager', undefined,
      { replacesId: id, ...(replacement.bookingRuleOverrides ? { ruleOverride: replacement.bookingRuleOverrides } : {}) });
    await event(tx, replacement, 'sent', managerId, 'manager');
    return replacement;
  });
  return invitationDto(row, 'manager');
}

export async function eligibleInvitationChefs(managerId: number, locationId: number) {
  const [location] = await db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, managerId))).limit(1);
  if (!location) throw new InvitationError('Location not found.', 404);
  const access = await db.select({ id: users.id }).from(chefLocationAccess).innerJoin(users, eq(users.id, chefLocationAccess.chefId))
    .where(eq(chefLocationAccess.locationId, locationId));
  const chefs = [];
  for (const person of access) {
    const eligibility = await readLocationBookingEligibility(person.id, locationId).catch(() => ({ canBook: false }));
    if (eligibility.canBook) chefs.push({ id: person.id, name: await getUserDisplayName(person.id, 'chef').catch(() => 'Customer') });
  }
  return chefs;
}

export async function adminInvitationAction(id: string, adminId: number, action: 'withdraw' | 'extend' | 'resend',
  body: { reason: string; version: number; hours?: number }) {
  if (typeof body?.reason !== 'string' || !body.reason.trim()) throw new InvitationError('A support reason is required.');
  if (action === 'withdraw') return transition(id, { id: adminId, role: 'admin' }, body.version, ['sent'], 'withdrawn', body.reason);
  const [admin] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, adminId)).limit(1);
  const row = await db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, id)).limit(1).for('update');
    if (!current || current.version !== body.version || !['sent', 'expired'].includes(readStatus(current)))
      throw new InvitationError('Invitation changed; refresh and try again.', 409);
    const hours = action === 'extend' ? body.hours : current.expiresInHours;
    if (![24, 48, 168].includes(hours || 0)) throw new InvitationError('hours must be 24, 48, or 168.');
    const policy = await publishedCancellationPolicy(current.kitchenId, tx);
    const calendarDate = calendarDateForOperatingTime(current.date, current.startTime, current.operatingWindowStartTime);
    const startInstant = matchingLocalInstants(calendarDate, current.startTime, current.timezone)[0];
    const cap = startInstant - (policy.noticeHours * 60 + 37) * 60_000;
    const expiresAt = new Date(Math.min(Date.now() + hours! * 3_600_000, cap));
    if (expiresAt <= new Date()) throw new InvitationError('This invitation cannot be extended past its checkout cutoff.', 409);
    const [row] = await tx.update(kitchenInvitations).set({ status: 'sent', expiresInHours: hours!, expiresAt, version: current.version + 1,
      reminderSentAt: null, expiryNotifiedAt: null, updatedAt: new Date() }).where(eq(kitchenInvitations.id, id)).returning();
    await event(tx, row, `support_${action}`, adminId, 'admin', body.reason);
    return row;
  });
  return invitationDto(row, 'admin', new Date(), admin?.locale || 'en-CA');
}

export async function releaseInvitationCheckout(invitationId: string | undefined, version: number | undefined, sessionId: string) {
  if (!invitationId || !Number.isSafeInteger(version)) return;
  const [row] = await db.update(kitchenInvitations).set({ status: 'sent', version: version! + 1, holdId: null, stripeSessionId: null, updatedAt: new Date() })
    .where(and(eq(kitchenInvitations.id, invitationId), eq(kitchenInvitations.version, version!),
      eq(kitchenInvitations.status, 'accepted_pending_payment'), eq(kitchenInvitations.stripeSessionId, sessionId))).returning();
  if (row) await db.insert(kitchenInvitationEvents).values({ invitationId, version: row.version, kind: 'payment_abandoned',
    actorId: row.chefId, actorRole: 'chef', noticeKey: `${invitationId}:${row.version}:payment_abandoned`,
    metadata: {} }).onConflictDoNothing();
}

export async function releaseInvitationCheckoutByHold(holdId: string) {
  const [row] = await db.select({ id: kitchenInvitations.id, version: kitchenInvitations.version, stripeSessionId: kitchenInvitations.stripeSessionId })
    .from(kitchenInvitations).where(eq(kitchenInvitations.holdId, holdId)).limit(1);
  if (row?.stripeSessionId) await releaseInvitationCheckout(row.id, row.version, row.stripeSessionId);
}

export async function recordFulfilledInvitation(invitationId: string, bookingId: number, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const [row] = await tx.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, invitationId)).limit(1);
  if (!row) return;
  const [updated] = await tx.update(kitchenInvitations).set({ status: 'accepted', bookingId, updatedAt: new Date() })
    .where(and(eq(kitchenInvitations.id, invitationId), eq(kitchenInvitations.version, row.version),
      eq(kitchenInvitations.status, 'accepted_pending_payment'))).returning();
  if (updated) await tx.insert(kitchenInvitationEvents).values({ invitationId, version: row.version,
    kind: 'accepted', actorId: row.managerId, actorRole: 'manager',
    noticeKey: `${invitationId}:${row.version}:accepted`, metadata: { bookingId, preApproved: true } }).onConflictDoNothing();
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const chefKinds = ['sent', 'support_extend', 'support_resend', 'expiry_reminder', 'withdrawn', 'expired', 'unavailable'];
const managerKinds = ['declined', 'expired', 'unavailable', 'support_extend', 'support_resend'];
/** Who hears about an event: never the person who just acted. Admins oversee offers as they go out; a paid invitation
 *  reaches them (and the kitchen) as the booking's own confirmation, and a payment that couldn't book reaches the chef
 *  and admins as the checkout safety net's notice. A replacement is announced by its new "sent". */
export function invitationNoticeReaders(kind: string, actorRole?: string | null, metadata?: unknown): Reader[] {
  const afterPayment = kind === 'unavailable' && (metadata as { afterPayment?: boolean } | null)?.afterPayment === true;
  return [
    ...(chefKinds.includes(kind) && !afterPayment ? ['chef' as const] : []),
    ...(managerKinds.includes(kind) || (kind === 'withdrawn' && actorRole === 'admin') ? ['manager' as const] : []),
    ...(kind === 'sent' ? ['admin' as const] : []),
  ];
}

export async function invitationNoticeCopy(input: {
  kind: string; reader: Reader; locale: string; kitchen: string; customer: string;
  date: string; startTime: string; endTime: string; totalCents: number; offeredSubtotalCents?: number; listSubtotalCents?: number;
  expiresAt: Date; timezone: string; reason?: string | null; actorRole?: string | null;
}) {
  await ensureServerI18n();
  const money = (cents: number) => new Intl.NumberFormat(input.locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const clock = (time: string) => new Intl.DateTimeFormat(input.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(`1970-01-01T${time}:00Z`));
  const values = {
    kitchen: input.kitchen, customer: input.customer,
    when: tLocale(input.locale, 'booking:invWhen', {
      day: new Intl.DateTimeFormat(input.locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${input.date}T12:00:00Z`)),
      start: clock(input.startTime), end: clock(input.endTime), zone: friendlyTimezoneName(input.timezone, input.locale),
    }),
    total: money(input.totalCents),
    price: money(input.offeredSubtotalCents ?? 0), list: money(input.listSubtotalCents ?? 0),
    expiry: new Intl.DateTimeFormat(input.locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: input.timezone }).format(input.expiresAt),
  };
  const kind = input.kind === 'support_resend' ? 'support_extend' : input.kind === 'withdrawn' && input.actorRole === 'admin' ? 'support_withdraw' : input.kind;
  const key = `booking:invN_${kind}_${input.reader}${input.reader === 'admin' && input.listSubtotalCents !== input.offeredSubtotalCents ? '_discount' : ''}`;
  const reason = input.reason?.trim()
    ? ` ${tLocale(input.locale, input.kind === 'declined' ? 'booking:invNTheirNote' : 'booking:invSupportReason', { reason: input.reason.trim() })}` : '';
  return { title: tLocale(input.locale, `${key}_title`, values), message: tLocale(input.locale, `${key}_body`, values) + reason };
}

/** Deliver append-only invitation outbox records with per-reader names and locale. */
export async function deliverKitchenInvitationEvents(limit = 3) {
  await ensureServerI18n();
  const events = await db.select().from(kitchenInvitationEvents)
    .where(and(workerAfter('invitationDelivery', kitchenInvitationEvents.id),
      sql`${kitchenInvitationEvents.deliveredAt} IS NULL`))
    .orderBy(kitchenInvitationEvents.id).limit(Math.min(limit, workerBatch()));
  await workerPageEnd('invitationDelivery', events.length, Math.min(limit, workerBatch()));
  for (const record of events) {
    await workerRecord('invitationDelivery', record.id);
    const readers = invitationNoticeReaders(record.kind, record.actorRole, record.metadata);
    const [invitation] = readers.length ? await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, record.invitationId)).limit(1) : [];
    if (invitation) {
      const ctx = await context(invitation.kitchenId).catch(() => null);
      const chefName = await getUserDisplayName(invitation.chefId, 'chef').catch(() => 'Customer');
      const people = await db.select({ id: users.id, email: users.username, role: users.role, locale: users.preferredLocale,
        adminEmailNotifications: users.adminEmailNotifications }).from(users)
        .where(sql`${users.id} IN (${invitation.chefId}, ${invitation.managerId}) OR ${users.role} = 'admin'`);
      for (const [person, reader] of people.flatMap(person => readers
        .filter(reader => reader === 'admin' ? person.role === 'admin' : person.id === (reader === 'chef' ? invitation.chefId : invitation.managerId))
        .map(reader => [person, reader] as const))) {
        const locale = person.locale || 'en-CA';
        const { title, message } = await invitationNoticeCopy({
          kind: record.kind, reader, locale, kitchen: ctx?.kitchenName || '', customer: chefName, date: invitation.date,
          startTime: invitation.startTime, endTime: invitation.endTime, totalCents: invitation.totalCents,
          offeredSubtotalCents: invitation.offeredSubtotalCents, listSubtotalCents: invitation.listSubtotalCents,
          expiresAt: invitation.expiresAt, timezone: invitation.timezone, reason: record.reason, actorRole: record.actorRole,
        });
        const path = reader === 'chef' ? `/invitation/${invitation.id}` : reader === 'admin' ? '/admin?section=booking-support'
          : `/manager/invitations/new?chefId=${invitation.chefId}&location=${invitation.locationId}`;
        const actionLabel = tLocale(locale, 'booking:invEmailButton');
        await notificationService.create({
          userId: person.id, target: reader === 'chef' ? 'chef' : 'manager', locationId: invitation.locationId,
          type: 'system_announcement', title, message, metadata: { invitationId: invitation.id }, actionUrl: path, actionLabel,
        });
        // Admin email follows each admin's operational-email toggle; in-app always.
        if (person.email && (reader !== 'admin' || operationalEmailAllowed(person))) {
          const actionUrl = `${process.env.PUBLIC_APP_URL || 'https://localcooks.ca'}${path}`;
          await sendEmail({
            to: person.email, subject: title, text: `${title}

${message}

${actionUrl}`,
            html: `<!doctype html><html lang="${locale}"><meta name="viewport" content="width=device-width"><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="${actionUrl}">${escapeHtml(actionLabel)}</a></p></body></html>`,
          }, { emailType: 'booking_notification' });
        }
      }
    }
    await db.update(kitchenInvitationEvents).set({ deliveredAt: new Date() }).where(eq(kitchenInvitationEvents.id, record.id));
  }
  return { delivered: events.length };
}

/** Expiry is already correct on reads; this sparse sweep only records durable notice events once. */
export async function sweepKitchenInvitationExpiry(limit = 10) {
  const reminderRows = await db.select().from(kitchenInvitations).where(and(workerAfter('invitationReminder', kitchenInvitations.workerId),
    eq(kitchenInvitations.status, 'sent'), sql`${kitchenInvitations.expiresAt} > now()`,
    sql`${kitchenInvitations.expiresAt} <= now() + interval '24 hours'`,
    sql`${kitchenInvitations.expiresAt} - ${kitchenInvitations.createdAt} > interval '24 hours'`,
    sql`${kitchenInvitations.reminderSentAt} IS NULL`)).orderBy(kitchenInvitations.workerId).limit(Math.min(limit, workerBatch()));
  await workerPageEnd('invitationReminder', reminderRows.length, Math.min(limit, workerBatch()));
  for (const row of reminderRows) {
    await workerRecord('invitationReminder', row.workerId);
    await db.transaction(async tx => {
      const [updated] = await tx.update(kitchenInvitations).set({ reminderSentAt: new Date() })
        .where(and(eq(kitchenInvitations.id, row.id), sql`${kitchenInvitations.reminderSentAt} IS NULL`)).returning();
      if (updated) await event(tx, updated, 'expiry_reminder');
    });
  }
  const rows = await db.select().from(kitchenInvitations).where(and(workerAfter('invitationExpiry', kitchenInvitations.workerId),
    eq(kitchenInvitations.status, 'sent'), sql`${kitchenInvitations.expiresAt} <= now()`,
    sql`${kitchenInvitations.expiryNotifiedAt} IS NULL`)).orderBy(kitchenInvitations.workerId).limit(Math.min(limit, workerBatch()));
  await workerPageEnd('invitationExpiry', rows.length, Math.min(limit, workerBatch()));
  for (const row of rows) {
    await workerRecord('invitationExpiry', row.workerId);
    await db.transaction(async tx => {
      const [updated] = await tx.update(kitchenInvitations).set({ expiryNotifiedAt: new Date() })
        .where(and(eq(kitchenInvitations.id, row.id), sql`${kitchenInvitations.expiryNotifiedAt} IS NULL`)).returning();
      if (updated) await event(tx, updated, 'expired');
    });
  }
  return { reminded: reminderRows.length, expired: rows.length };
}
