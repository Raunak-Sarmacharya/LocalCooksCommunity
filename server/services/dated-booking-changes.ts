/**
 * CP7: one change request for a whole dated (multi-day) booking, on the WP-RS engine (`kitchen-booking-changes.ts`).
 *
 * Owner spec row 9: days and each day's hours/equipment change together, under the same count/span rules, with the price
 * difference shown first; the kitchen approves or declines and the original stays if it declines; before the one refund
 * deadline only. The engine keeps its state machine, card hold, capture/refund-then-apply recovery and notices; this
 * module supplies what differs for a day set:
 *  - destination: CP3 `validateBookingDays` (count, span, advance, notice, buffer, weekly hours, equipment), excluding the
 *    booking's own time and its own hold group;
 *  - quote: CP4 day pricing at the current rates, whole old total (the current active days) vs whole new total;
 *  - hold: one hold row per destination day, sharing the change's hold id as group (the original stays booked meanwhile);
 *  - apply: a new visit revision (CP2 builder), new codes, per-day equipment rows, the policy sessions (0098: sessions only,
 *    so the one refund deadline follows the new first day), and the day ledger moved to the new days.
 *
 * Ledger (per payment source, CP4/CP5): the active parts' cents (subtotal, tax, service fee, actual card fee) move to the new
 * days by residual subtotals after the positive charge takes its increase-weighted share, conserving every source exactly; moved rows are marked `supersededBy` and their unsent
 * installments end with no entitlement. Settled rows (dropped days, removed items) stay where they are. A refund (negative
 * difference) is recorded as one fully settled `change-refund:<id>` part; a positive difference is a separate charge whose
 * day split CP5 reads from `dayComponents`. A sent or in-flight installment, a part with a partial refund, an unallocated
 * refund or a pending fee makes the change support-only: nothing already paid is ever reallocated.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingDayAllocations as allocations, kitchenBookingDayPayouts as payouts,
  paymentTransactions, equipmentBookings, equipmentListings, kitchenCheckoutHolds, storageBookings } from '@shared/schema';
import { isDatedChangeSchedule, type DatedChangeSchedule } from '@shared/kitchen-booking-change';
import { allocateCents, roundRatio, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { bookingFreeCancelHours } from '@shared/booking-response-deadline';
import { rescheduleEligibility, rescheduleMoney, RESCHEDULE_MESSAGES, type ChangeMoneyFull, type PriceTerms } from '@shared/kitchen-booking-reschedule';
import { makeCloseoutSnapshot, type ClockBooking } from '@shared/clock-closeout';
import { validateBookingDays } from './booking-days-validation';
import { priceBookingDays, allocateDatedCapture, type DayComponent, type DatedBookingManifest, type PricedBookingDay } from './dated-booking-quote';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { policySessionStart } from './cancellation-policy-settings';
import { lockKitchenInventory } from './kitchen-checkout-holds';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { ensureDayPayoutRows, dayTransferKey, refundsAllocated, hasUnreconciledChangeRefund } from './kitchen-day-payouts';
import { ensureChallengesForBooking, revokeForVisit, arrivalModeForChangedBooking } from './visit-code-challenge';
import { closeoutTiming } from './clock-closeout';
import { KitchenChangeError, type RefundSource } from './kitchen-booking-changes';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof kitchenBookings.$inferSelect;
type Payment = typeof paymentTransactions.$inferSelect;
type Allocation = typeof allocations.$inferSelect;
type Visit = typeof kitchenBookingVisits.$inferSelect;
export type DatedRow = { booking: Booking; kitchen: { id: number; name: string; hourlyRate: string | null; dailyRate: string | null; taxRatePercent: string | null;
  isActive: boolean | null; listingStatus: string | null; locationId: number }; managerId: number | null; timezone: string };
/** The quote saved with a dated change: the engine's money plus the priced destination days. */
export type DatedChangeMoney = ChangeMoneyFull & { datedDays: PricedBookingDay[] };

const SUPPORT = 'This booking needs Local Cooks to change it. Message the kitchen or contact Local Cooks.';
const support = (why: string) => new KitchenChangeError(SUPPORT, 409, 'datedChangeSupport', { why });
const meta = (row: { metadata?: unknown }) => (row.metadata || {}) as Record<string, any>;
const evidence = (row: Allocation) => (row.evidence || {}) as Record<string, any>;
const paid = (row: Allocation) => row.subtotalCents + row.taxCents + row.serviceFeeCents;
const sum = <T>(rows: T[], value: (row: T) => number) => rows.reduce((total, row) => total + value(row), 0);
const byDate = <T extends { visitDate?: string | null; date?: string }>(a: T, b: T) => String(a.visitDate ?? a.date).localeCompare(String(b.visitDate ?? b.date));
export const isDatedRow = (row: { booking: { scheduleRevision?: number | null } }) => (row.booking.scheduleRevision ?? 0) > 0;

/** Kitchen-local instant of an operating time on an operating date (after-midnight times belong to the next calendar day). */
const instant = (date: string, time: string, windowStart: string, timezone: string) => policySessionStart(date, time, windowStart, timezone);
const dayStart = (day: { date: string; slots: Array<{ startTime: string }>; windowStart: string }, timezone: string) => instant(day.date, day.slots[0].startTime, day.windowStart, timezone);
const dayEnd = (day: { date: string; slots: Array<{ startTime: string }>; windowStart: string }, timezone: string) =>
  new Date(Date.parse(instant(day.date, day.slots.at(-1)!.startTime, day.windowStart, timezone)) + 3_600_000).toISOString();

// ---------------------------------------------------------------------------------------------------------------------------
// The current schedule and its day ledger
// ---------------------------------------------------------------------------------------------------------------------------
async function currentDays(tx: Tx, booking: Booking) {
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id)).orderBy(asc(kitchenBookingVisits.id));
  const active = visits.filter(visit => visit.scheduleRevision === booking.scheduleRevision && visit.scheduleState === 'active' && !!visit.visitDate).sort(byDate);
  const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, booking.id));
  return { visits, active, equipment };
}
type Days = Awaited<ReturnType<typeof currentDays>>;

function scheduleOf(days: Days): DatedChangeSchedule {
  return { version: 'days-v1', days: days.active.map(visit => ({ date: String(visit.visitDate), pricingMode: visit.pricingMode === 'daily' ? 'daily' as const : 'hourly' as const,
    slots: (visit.selectedSlots as Array<{ startTime: string; endTime: string }>) || [], windowStart: visit.operatingWindowStartTime || visit.startTime,
    equipmentIds: days.equipment.filter(item => item.kitchenBookingVisitId === visit.id && item.status === 'confirmed')
      .map(item => item.equipmentListingId).sort((a, b) => a - b) })) };
}

export async function datedOriginal(tx: Tx, booking: Booking) { return scheduleOf(await currentDays(tx, booking)); }

type SourceLedger = { source: Payment; live: Allocation[]; active: Allocation[]; revision: number; moved: { sub: number; tax: number; svc: number; fee: number } };

/**
 * Every captured source of the booking with its moveable (active, unrefunded) parts. Throws a support-only refusal when any
 * money was already paid out, is moving, or can't be attributed to a day. `changeId`: this change's own charge/refund.
 */
async function ledger(tx: Tx, booking: Booking, days: Days, changeId?: string) {
  const all = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, booking.id),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']))).orderBy(asc(paymentTransactions.id));
  if (all.some(hasUnreconciledChangeRefund)) throw support('a kept change refund needs reconciliation');
  const sources = all.filter(row => ['succeeded', 'partially_refunded'].includes(row.status) && !(changeId && meta(row).kitchenChangeId === changeId));
  const parent = sources.find(row => !!row.paymentIntentId && row.paymentIntentId === booking.paymentIntentId);
  if (!parent || !['paid', 'partially_refunded'].includes(booking.paymentStatus || ''))
    throw new KitchenChangeError('The original payment needs Local Cooks to look at it. Message the kitchen or contact Local Cooks.', 409, 'originalPaymentReview');
  if (sources.some(row => row.payoutPartition !== 'per_day')) throw support('a payment is not split by day');
  const ids = sources.map(row => row.id);
  const rows = await tx.select().from(allocations).where(inArray(allocations.sourceId, ids)).orderBy(asc(allocations.id));
  const installments = await tx.select().from(payouts).where(inArray(payouts.sourceId, ids)).orderBy(asc(payouts.id));
  if (installments.some(row => row.transferId || (row.evidence as { state?: string }).state === 'pending')) throw support('a day was already paid out');
  const activeIds = new Set(days.active.map(visit => visit.id));
  const confirmedItems = new Map(days.equipment.filter(item => item.status === 'confirmed').map(item => [item.id, item]));
  const result: SourceLedger[] = [];
  for (const source of sources) {
    const m = meta(source);
    if (m.cancellationRefundOperation && m.cancellationRefundOperation.status !== 'succeeded')
      throw new KitchenChangeError('A payment for this booking is still being checked. Refresh in a moment.', 409, 'paymentChecking');
    const own = changeId ? m.changeGrossRefundOperations?.[changeId] : undefined;
    if (!refundsAllocated({ ...source, metadata: { ...m, allocatedChangeRefunds: [...(m.allocatedChangeRefunds || []), ...(own ? [own] : [])] } }))
      throw support('a refund is not assigned to a day');
    const mine = rows.filter(row => row.sourceId === source.id), live = mine.filter(row => !evidence(row).supersededBy);
    if (!live.length || live.some(row => row.stripeFeeCents === null))
      throw new KitchenChangeError('The card processing fee is not known yet. Try again in a few minutes.', 409, 'feeNotKnown');
    if (sum(live, paid) !== Number(source.amount) || sum(live, row => row.stripeFeeCents!) !== Number(source.stripeProcessingFee))
      throw support('the day ledger does not add up');
    const active = live.filter(row => activeIds.has(row.visitId) && (row.componentKey === 'kitchen'
      || confirmedItems.get(Number(row.componentKey.slice('equipment:'.length)))?.kitchenBookingVisitId === row.visitId));
    if (active.some(row => (evidence(row).refunds || []).length || evidence(row).managerDebitedCents)) throw support('a day has a partial refund');
    // Settled parts (dropped days, removed items, earlier change refunds) keep nothing for the kitchen before the deadline.
    if (live.some(row => !active.includes(row) && row.subtotalCents + row.taxCents - row.stripeFeeCents! - Number(evidence(row).managerDebitedCents || 0) !== 0))
      throw support('a cancelled part still carries a kitchen share');
    result.push({ source, live, active, revision: Math.max(...mine.map(row => row.allocationRevision)),
      moved: { sub: sum(active, row => row.subtotalCents), tax: sum(active, row => row.taxCents), svc: sum(active, row => row.serviceFeeCents), fee: sum(active, row => row.stripeFeeCents!) } });
  }
  if (days.active.some(visit => !result.find(entry => entry.source.id === parent.id)?.active.some(row => row.visitId === visit.id && row.componentKey === 'kitchen')))
    throw support('a day has no kitchen allocation');
  return { sources: result, parent };
}

const termsOf = (book: Awaited<ReturnType<typeof ledger>>): PriceTerms => ({ kitchenCents: sum(book.sources, entry => entry.moved.sub),
  taxCents: sum(book.sources, entry => entry.moved.tax), feeCents: sum(book.sources, entry => entry.moved.svc) });

// ---------------------------------------------------------------------------------------------------------------------------
// Eligibility, destination and quote
// ---------------------------------------------------------------------------------------------------------------------------
export async function datedEligibility(tx: Tx, row: DatedRow, now: Date, openChange: boolean) {
  const booking = row.booking, snapshot = booking.cancellationPolicySnapshot as CancellationPolicySnapshot | null;
  if (snapshot?.deadlineBasis !== 'booking_first_day' || !snapshot.sessions?.length) throw new KitchenChangeError(RESCHEDULE_MESSAGES.contactKitchen, 409, 'contactKitchen');
  const days = await currentDays(tx, booking), original = scheduleOf(days);
  if (!original.days.length) throw new KitchenChangeError(RESCHEDULE_MESSAGES.notConfirmed, 409, 'eligibilityNotConfirmed');
  // One refund deadline: the notice period before the first booked day (a dropped first day keeps its place).
  const startAt = new Date(Math.min(...snapshot.sessions.map(session => Date.parse(session.startAt)))).toISOString();
  let endAt: string;
  try { endAt = dayEnd(original.days.at(-1)!, row.timezone); } catch { throw new KitchenChangeError(RESCHEDULE_MESSAGES.contactKitchen, 409, 'contactKitchen'); }
  const checkedIn = days.active.some(visit => (visit.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || !!visit.checkedInAt || !!visit.checkoutRequestedAt || !!visit.checkedOutAt);
  const storage = await tx.select({ status: storageBookings.status }).from(storageBookings).where(eq(storageBookings.kitchenBookingId, booking.id));
  const freeCancelHours = bookingFreeCancelHours(booking);
  const result = rescheduleEligibility({ status: booking.status, checkedIn, startAt, freeCancelHours, now, multiVisit: false,
    linkedItems: storage.some(item => item.status !== 'cancelled'), openChange });
  if (result.allowed) {
    try { await ledger(tx, booking, days); }
    catch (error) { if (!(error instanceof KitchenChangeError)) throw error; return { allowed: false, reason: error.message, code: error.code, values: error.values, until: result.until, original, startAt, endAt, freeCancelHours }; }
  }
  return { ...result, original, startAt, endAt, freeCancelHours };
}

const normalizedDays = (schedule: DatedChangeSchedule) => schedule.days.map(day => ({ date: day.date, pricingMode: day.pricingMode,
  slots: day.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime })), equipmentIds: [...day.equipmentIds].sort((a, b) => a - b) }));
/** Same days, modes, hours and equipment (daily days compare without hours, which the server fills from opening hours). */
export function sameDatedRequest(left: DatedChangeSchedule, right: DatedChangeSchedule) {
  const shape = (schedule: DatedChangeSchedule) => JSON.stringify(normalizedDays(schedule).map(day => ({ ...day, slots: day.pricingMode === 'daily' ? [] : day.slots })));
  return shape(left) === shape(right);
}

/** The destination as the kitchen's rules allow it. `request` keeps the advance window and notice; `approve` re-checks inventory only. */
export async function validateDatedDestination(tx: Tx, row: DatedRow, raw: unknown, now: Date, holdId: string | null | undefined, mode: 'request' | 'approve') {
  const booking = row.booking;
  if (!isDatedChangeSchedule(raw) || !raw.days.length) throw new KitchenChangeError('Choose the new days and hours.', 409, 'chooseDateHours');
  if (raw.days.some(day => !day || !['hourly', 'daily'].includes(day.pricingMode) || day.pricingMode === 'hourly' && !day.slots?.length
    || !Array.isArray(day.equipmentIds) || day.equipmentIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(day.equipmentIds).size !== day.equipmentIds.length))
    throw new KitchenChangeError('Choose the new days and hours.', 409, 'chooseDateHours');
  await lockKitchenInventory(tx, booking.kitchenId, raw.days.map(day => day.date), raw.days.flatMap(day => day.equipmentIds));
  const check = await validateBookingDays({ kitchenId: booking.kitchenId, chefId: booking.chefId, now, reader: tx,
    days: raw.days.map(day => ({ date: day.date, pricingMode: day.pricingMode, equipmentIds: day.equipmentIds, ...(day.pricingMode === 'hourly' ? { slots: day.slots } : {}) })),
    // The booking's own days and its own held destination never block it; the moved booking keeps the buffer it was made with.
    excludeBookingId: booking.id, excludeHoldId: holdId || undefined, keepAdvanceWindow: mode === 'request', skipNotice: mode === 'approve',
    bufferMinutes: booking.bufferMinutesSnapshot, authorizedContract: true });
  if (!check.ok) throw check.code === 'WEEKLY_CHEF_HOURS_LIMIT'
    ? new KitchenChangeError(check.error, 409, 'WEEKLY_CHEF_HOURS_LIMIT', { weeks: check.weeks, timezone: check.timezone })
    // Per-date reasons are the server's own words (as at checkout).
    : new KitchenChangeError(check.error, 409, undefined, { dayErrors: check.dayErrors });
  if (!row.kitchen.isActive || row.kitchen.listingStatus !== 'active') throw new KitchenChangeError('This kitchen is unavailable for a new schedule.', 409, 'kitchenUnavailable');
  const destination: DatedChangeSchedule = { version: 'days-v1', days: check.days.map(day => ({ date: day.date, pricingMode: day.pricingMode, slots: day.slots,
    windowStart: day.windowStartTime, equipmentIds: [...day.equipmentIds].sort((a, b) => a - b) })) };
  if (mode === 'request' && sameDatedRequest(destination, await datedOriginal(tx, booking)))
    throw new KitchenChangeError('Choose different days, hours or equipment.', 409, 'chooseDifferentTime');
  return { destination, validated: check.days };
}

/**
 * Whole old total (the current active days, as they were paid) vs whole new total (CP4 pricing at today's rates, HST and
 * service fee once on the aggregate). Positive: the chef pays the difference. Negative: the difference minus its card-fee
 * share comes back, newest payment first, exactly as on a one-day booking.
 */
export async function priceDatedChange(tx: Tx, row: DatedRow, validated: Awaited<ReturnType<typeof validateDatedDestination>>['validated'], changeId?: string) {
  const booking = row.booking, book = await ledger(tx, booking, await currentDays(tx, booking), changeId);
  const ids = Array.from(new Set(validated.flatMap(day => day.equipmentIds)));
  const listings = ids.length ? await tx.select().from(equipmentListings).where(and(inArray(equipmentListings.id, ids), eq(equipmentListings.kitchenId, booking.kitchenId))) : [];
  let days: PricedBookingDay[];
  try { days = priceBookingDays(validated, { hourlyRate: Number(row.kitchen.hourlyRate ?? 0), dailyRate: Number(row.kitchen.dailyRate ?? 0) }, listings); }
  catch { throw new KitchenChangeError(RESCHEDULE_MESSAGES.contactKitchen, 409, 'contactKitchen'); }
  const subtotal = sum(days, day => day.kitchenCents + sum(day.equipment, item => item.cents));
  const taxRate = Number(row.kitchen.taxRatePercent ?? 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new KitchenChangeError('The kitchen’s tax setting needs review. Message the kitchen.', 409, 'taxReview');
  const taxCents = Math.round(subtotal * taxRate / 100);
  const next: PriceTerms = { kitchenCents: subtotal, taxCents, feeCents: (await calculateCheckoutFeesAsync(subtotal, { taxAmountCents: taxCents })).platformCommissionInCents };
  const old = termsOf(book);
  // Day-by-day prices may rise and fall together; only a split moving both ways (a rate setting changed) needs a person.
  const deltas = [next.kitchenCents - old.kitchenCents, next.taxCents - old.taxCents, next.feeCents - old.feeCents];
  const difference = sum(deltas, n => n);
  if (deltas.some(n => n > 0) && deltas.some(n => n < 0) || difference > 0 && deltas[0] <= 0)
    throw new KitchenChangeError('This change needs Local Cooks to price it. Message the kitchen or contact Local Cooks.', 409, 'pricingReview');
  const money = rescheduleMoney({ oldTerms: old, newTerms: next, currency: booking.currency, processingFeeCents: 0, capturedCents: 0 }) as DatedChangeMoney;
  money.datedDays = days;
  const plans: RefundSource[] = [];
  if (difference < 0) {
    let remaining = -difference, feeReturn = old.feeCents - next.feeCents;
    for (const entry of [...book.sources].sort((a, b) => b.source.id - a.source.id)) {
      const { source, moved } = entry, captured = Number(source.amount), fee = Number(source.stripeProcessingFee);
      const gross = Math.min(remaining, moved.sub + moved.tax + moved.svc,
        captured - Math.max(Number(meta(source).changeGrossRefundedCents || 0), Number(source.refundAmount || 0)));
      if (gross <= 0) continue;
      const kept = Math.min(gross, moved.fee, Math.round(fee * gross / captured)), refund = gross - kept;
      const platform = Math.min(feeReturn, moved.svc, remaining === gross ? feeReturn : Math.round((old.feeCents - next.feeCents) * gross / -difference), refund);
      const kitchen = refund - platform;
      if (kept > moved.fee || kitchen > moved.sub + moved.tax - moved.fee) throw new KitchenChangeError('This change needs Local Cooks to refund it. Message the kitchen or contact Local Cooks.', 409, 'refundReview');
      plans.push({ intentId: source.paymentIntentId!, transactionId: source.id, capturedCents: captured, processingFeeCents: fee,
        grossCents: gross, refundCents: refund, kitchenDebitCents: kitchen, platformReturnCents: platform });
      remaining -= gross; feeReturn -= platform;
      if (!remaining) break;
    }
    if (remaining || feeReturn) throw new KitchenChangeError('This change needs Local Cooks to refund it. Message the kitchen or contact Local Cooks.', 409, 'refundReview');
    money.refundCents = sum(plans, plan => plan.refundCents!);
    money.feeKeptCents = -difference - money.refundCents;
    money.kitchenDebitCents = sum(plans, plan => plan.kitchenDebitCents!);
    money.platformReturnCents = sum(plans, plan => plan.platformReturnCents!);
    money.lines = money.lines.map(line => line.key === 'fee_kept' ? { ...line, cents: -money.feeKeptCents } : line.key === 'refund' ? { ...line, cents: money.refundCents } : line);
  }
  return { money, refundSources: plans };
}

export function datedChangeFingerprint(bookingId: number, destination: DatedChangeSchedule, money: DatedChangeMoney) {
  return JSON.stringify([bookingId, destination.version, destination.days.map(day => [day.date, day.pricingMode, day.windowStart, day.slots.map(slot => [slot.startTime, slot.endTime]), day.equipmentIds]),
    money.currency, [money.oldTerms.kitchenCents, money.oldTerms.taxCents, money.oldTerms.feeCents], [money.newTerms.kitchenCents, money.newTerms.taxCents, money.newTerms.feeCents],
    money.datedDays.map(day => [day.date, day.rateCents, day.kitchenCents, day.equipment.map(item => [item.listingId, item.cents])]),
    money.payCents, money.refundCents, money.feeKeptCents, money.kitchenDebitCents, money.platformReturnCents]);
}

export const datedStartAt = (destination: DatedChangeSchedule, timezone: string) => dayStart(destination.days[0], timezone);
export const datedEndAt = (destination: DatedChangeSchedule, timezone: string) => dayEnd(destination.days.at(-1)!, timezone);

// ---------------------------------------------------------------------------------------------------------------------------
// Holds: the whole destination group while the original days stay booked
// ---------------------------------------------------------------------------------------------------------------------------
export async function holdDatedDays(tx: Tx, row: DatedRow, head: string, destination: DatedChangeSchedule, expiresAt: Date) {
  for (const [index, day] of Array.from(destination.days.entries())) {
    await tx.insert(kitchenCheckoutHolds).values({ id: index === 0 ? head : `${head}:${day.date}`, groupId: head, kitchenId: row.booking.kitchenId,
      chefId: row.booking.chefId!, operatingDate: day.date, windowStartTime: day.windowStart, selectedSlots: day.slots, expiresAt,
      bufferMinutesSnapshot: row.booking.bufferMinutesSnapshot }).onConflictDoUpdate({ target: kitchenCheckoutHolds.id, set: { expiresAt } });
  }
}

/** At approval and again after money moved: the same original, nothing started, the whole group held, still free and priced the same. */
export async function assertDatedStillValid(tx: Tx, row: DatedRow, change: { id: string; original: unknown; destination: unknown; quote: unknown; policy: unknown }, head: string, now: Date) {
  const booking = row.booking, m = change.policy as { originalStartAt: string; newStartAt: string };
  if (booking.status !== 'confirmed') throw new KitchenChangeError('This booking is no longer confirmed, so it can’t be moved.', 409, 'bookingNotConfirmed');
  const days = await currentDays(tx, booking);
  if (days.active.some(visit => (visit.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || visit.checkedInAt || visit.checkoutRequestedAt || visit.checkedOutAt)
    || now.getTime() >= Date.parse(m.originalStartAt)) throw new KitchenChangeError('This booking has already started, so it can’t be moved.', 409, 'bookingStarted');
  if (JSON.stringify(normalizedDays(scheduleOf(days))) !== JSON.stringify(normalizedDays(change.original as DatedChangeSchedule)))
    throw new KitchenChangeError('The booking changed since this request was sent.', 409, 'bookingChanged');
  if (Date.parse(m.newStartAt) <= now.getTime()) throw new KitchenChangeError('The new time has already passed.', 409, 'newTimePassed');
  const destination = change.destination as DatedChangeSchedule;
  const holds = await tx.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.groupId, head)).for('update');
  if (holds.length !== destination.days.length || holds.some(hold => hold.expiresAt.getTime() <= now.getTime())
    || destination.days.some(day => !holds.some(hold => hold.operatingDate === day.date)))
    throw new KitchenChangeError('That time isn’t held any more, so it can’t be confirmed. Decline the request; the chef can ask again.', 409, 'holdGone');
  const { destination: fresh } = await validateDatedDestination(tx, row, destination, now, head, 'approve');
  if (JSON.stringify(normalizedDays(fresh)) !== JSON.stringify(normalizedDays(destination))) throw new KitchenChangeError('That time is no longer available.', 409, 'timeUnavailable');
  const quote = change.quote as DatedChangeMoney;
  const old = termsOf(await ledger(tx, booking, days, change.id));
  if (old.kitchenCents !== quote.oldTerms.kitchenCents || old.taxCents !== quote.oldTerms.taxCents || old.feeCents !== quote.oldTerms.feeCents)
    throw new KitchenChangeError('The booking changed since this request was sent.', 409, 'bookingChanged');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Apply: the new visit revision, codes, equipment, policy sessions and the day ledger, in the caller's transaction
// ---------------------------------------------------------------------------------------------------------------------------
export async function applyDatedChange(tx: Tx, row: DatedRow, change: { id: string; quote: unknown; policy: unknown; intentId: string | null }, now: Date) {
  const booking = row.booking, quote = change.quote as DatedChangeMoney, days = quote.datedDays;
  const snapshot = booking.cancellationPolicySnapshot as CancellationPolicySnapshot;
  const timezone = snapshot.timezone || row.timezone;
  const state = await currentDays(tx, booking), book = await ledger(tx, booking, state, change.id);
  const arrivalMode = await arrivalModeForChangedBooking(tx, booking.id);
  // 1. The old days stop: their codes are revoked and their equipment rows end. Cancelled days stay cancelled (their refund evidence).
  for (const visit of state.active) await revokeForVisit(tx, booking.id, visit.id, 'booking_changed');
  await tx.update(kitchenBookingVisits).set({ scheduleState: 'superseded', updatedAt: now }).where(inArray(kitchenBookingVisits.id, state.active.map(visit => visit.id)));
  const oldItems = state.equipment.filter(item => item.status === 'confirmed' && state.active.some(visit => visit.id === item.kitchenBookingVisitId));
  if (oldItems.length) await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: now }).where(inArray(equipmentBookings.id, oldItems.map(item => item.id)));
  // 2. The parent projects the new first day; the accepted terms stay and only `sessions` change (0098), so the one deadline follows the new first day.
  const first = days[0];
  await tx.update(kitchenBookings).set({ scheduleRevision: booking.scheduleRevision + 1, bookingDate: new Date(`${first.date}T12:00:00Z`),
    startTime: first.startTime, endTime: first.endTime, operatingWindowStartTime: first.windowStartTime, pricingMode: first.pricingMode, hourlyRate: String(first.rateCents),
    durationHours: String(sum(days, day => day.slots.length)), totalPrice: String(quote.newTerms.kitchenCents), serviceFee: String(quote.newTerms.feeCents),
    selectedSlots: days.flatMap(day => day.slots.map(slot => ({ ...slot, date: day.date, windowStartTime: day.windowStartTime }))),
    cancellationPolicySnapshot: { ...snapshot, sessions: days.map(day => ({ startAt: instant(day.date, day.startTime, day.windowStartTime, timezone) })) },
    updatedAt: now }).where(eq(kitchenBookings.id, booking.id));
  const visits = await ensureKitchenBookingVisits(booking.id, tx, days.map(day => ({ date: day.date, pricingMode: day.pricingMode,
    operatingWindowStartTime: day.windowStartTime, selectedSlots: day.slots,
    priceSnapshot: { contract: 'kitchen-change-days-v1', changeId: change.id, rateCents: day.rateCents, kitchenCents: day.kitchenCents, equipment: day.equipment } })));
  // 3. One equipment row per new day and item, already paid for by the booking's sources.
  const oldComponentCents = (date: string, listingId?: number) => sum(book.sources, entry => sum(entry.active.filter(part => {
    if (state.active.find(visit => visit.id === part.visitId)?.visitDate !== date) return false;
    return listingId === undefined ? part.componentKey === 'kitchen'
      : state.equipment.some(item => item.id === Number(part.componentKey.slice('equipment:'.length)) && item.equipmentListingId === listingId);
  }), part => part.subtotalCents));
  const increases: number[] = [];
  const components: DayComponent[] = [], equipmentItems: Record<string, unknown>[] = [];
  for (const [sessionIndex, day] of Array.from(days.entries())) {
    const visit = visits.find(item => item.visitDate === day.date)!;
    increases.push(Math.max(0, day.kitchenCents - oldComponentCents(day.date)));
    components.push({ visitId: visit.id, sessionIndex, componentKey: 'kitchen', kind: 'kitchen', bookingId: booking.id, subtotalCents: day.kitchenCents });
    const startDate = new Date(instant(day.date, day.startTime, day.windowStartTime, timezone));
    const endDate = new Date(Date.parse(instant(day.date, day.slots.at(-1)!.startTime, day.windowStartTime, timezone)) + 3_600_000);
    for (const item of day.equipment) {
      const [saved] = await tx.insert(equipmentBookings).values({ kitchenBookingId: booking.id, kitchenBookingVisitId: visit.id, chefId: booking.chefId,
        equipmentListingId: item.listingId, startDate, endDate, status: 'confirmed', paymentStatus: 'paid', paymentIntentId: booking.paymentIntentId,
        totalPrice: String(item.cents), pricingModel: 'daily', damageDeposit: '0' }).returning();
      equipmentItems.push({ id: saved.id, equipmentBookingId: saved.id, equipmentListingId: item.listingId, visitId: visit.id, date: day.date, name: item.name, totalPrice: item.cents, status: 'confirmed' });
      increases.push(Math.max(0, item.cents - oldComponentCents(day.date, item.listingId)));
      components.push({ visitId: visit.id, sessionIndex, componentKey: `equipment:${saved.id}`, kind: 'equipment', bookingId: saved.id, subtotalCents: item.cents });
    }
  }
  // 4. The money ledger follows the new days.
  const addedSubtotals = quote.payCents > 0
    ? allocateCents(quote.newTerms.kitchenCents - quote.oldTerms.kitchenCents, increases) : components.map(() => 0);
  // Net increases fund the extra charge; each original source moves over the complementary residual.
  const residualComponents = components.map((item, i) => ({ ...item, subtotalCents: item.subtotalCents - addedSubtotals[i] }));
  await moveLedger(tx, book.sources, residualComponents, change, state.active[0], (change.policy as { refundSources?: RefundSource[] }).refundSources || [], now);
  if (quote.payCents > 0) {
    // CP5 splits the separate change charge by positive component deltas, matched by date and item.
    const [extra] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, booking.id), eq(paymentTransactions.paymentIntentId, change.intentId || '')));
    const subs = addedSubtotals;
    if (!extra || meta(extra).kitchenChangeId !== change.id || Number(extra.baseAmount) - Number(extra.taxAmount) !== sum(subs, n => n)) throw Error('The change charge does not match its quote');
    await tx.update(paymentTransactions).set({ metadata: { ...meta(extra), dayComponents: components.map((item, i) => ({ ...item, subtotalCents: subs[i] })) } })
      .where(eq(paymentTransactions.id, extra.id));
  }
  // 5. Clocks and codes for the new days.
  const [moved] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, booking.id));
  const all = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id));
  const clockCloseout = makeCloseoutSnapshot(moved as unknown as ClockBooking, row.timezone, await closeoutTiming(row.kitchen.locationId, tx), all);
  await tx.update(kitchenBookings).set({ equipmentItems, visitDuties: { ...(moved.visitDuties as object || {}), clockCloseout } }).where(eq(kitchenBookings.id, booking.id));
  await ensureChallengesForBooking(tx, booking.id, undefined, arrivalMode);
  return { startAt: new Date(dayStart({ date: first.date, slots: first.slots, windowStart: first.windowStartTime }, timezone)),
    endAt: new Date(dayEnd({ date: days.at(-1)!.date, slots: days.at(-1)!.slots, windowStart: days.at(-1)!.windowStartTime }, timezone)) };
}

async function moveLedger(tx: Tx, sources: SourceLedger[], components: DayComponent[], change: { id: string }, firstOld: Visit, plans: RefundSource[], now: Date) {
  const weights = components.map(item => item.subtotalCents), at = now.toISOString();
  for (const entry of sources) {
    const { source } = entry, revision = entry.revision + 1, plan = plans.find(item => item.transactionId === source.id);
    let { sub, tax, svc, fee } = entry.moved;
    const proof = { chargeId: source.chargeId, balanceTransactionId: meta(source).balanceTransactionId ?? null, feeStatus: 'verified', changeId: change.id };
    if (plan) {
      // The refunded part: fully settled, nothing left for the kitchen (its debit equals its share after the kept card fee).
      const svcPart = plan.platformReturnCents!, gross = plan.grossCents! - svcPart, kept = plan.grossCents! - plan.refundCents!;
      const taxPart = roundRatio(gross, tax, sub + tax), subPart = gross - taxPart;
      const refundId = meta(source).changeGrossRefundOperations?.[change.id];
      if (!refundId || subPart < 0 || subPart > sub || taxPart > tax || svcPart > svc || kept > fee || gross - kept !== plan.kitchenDebitCents)
        throw Error('The change refund does not fit the day ledger');
      const [part] = await tx.insert(allocations).values({ sourceId: source.id, visitId: firstOld.id, allocationRevision: revision, componentKey: `change-refund:${change.id}`,
        subtotalCents: subPart, taxCents: taxPart, serviceFeeCents: svcPart, stripeFeeCents: kept, evidence: { ...proof, kind: 'change_refund', refundId,
          managerDebitedCents: plan.kitchenDebitCents, refunds: [{ operationId: `kitchen-change:${change.id}`, mode: 'change', at, customerCents: plan.refundCents,
            kitchenCents: plan.kitchenDebitCents, platformCents: svcPart, absorbedFeeCents: 0, feeCents: kept, refundPercent: 100, funding: 'entitlement', installmentId: null }] } }).returning();
      await tx.insert(payouts).values({ sourceId: source.id, visitId: part.visitId, allocationRevision: revision, operationKey: dayTransferKey(source.id, part.visitId, revision),
        noEntitlement: true, transferAmountCents: 0, evidence: { changeRefund: change.id } });
      await tx.update(paymentTransactions).set({ metadata: { ...meta(source), allocatedChangeRefunds: [...(meta(source).allocatedChangeRefunds || []), refundId] } })
        .where(eq(paymentTransactions.id, source.id));
      sub -= subPart; tax -= taxPart; svc -= svcPart; fee -= kept;
    }
    if (sub + tax + svc > 0) {
      if (!sub) throw Error('A moved source has no subtotal left to allocate');
      const subs = allocateCents(sub, weights);
      const parts = allocateDatedCapture(components.map((item, i) => ({ ...item, subtotalCents: subs[i] })),
        { totalCents: sub + tax + svc, taxCents: tax, serviceFeeCents: svc } as DatedBookingManifest, fee);
      await tx.insert(allocations).values(parts.map(part => ({ sourceId: source.id, visitId: part.visitId, allocationRevision: revision, componentKey: part.componentKey,
        subtotalCents: part.subtotalCents, taxCents: part.taxCents, serviceFeeCents: part.serviceFeeCents, stripeFeeCents: part.stripeFeeCents,
        evidence: { ...proof, sessionIndex: part.sessionIndex, kind: part.kind, bookingId: part.bookingId, movedFrom: entry.active.map(row => row.id) } })));
    } else if (fee) throw Error('A card fee is left with nothing to allocate');
    // Immutable lineage: the old parts keep their cents and say where they went; their unsent installments end at zero.
    for (const old of entry.active) await tx.update(allocations).set({ evidence: { ...evidence(old), supersededBy: { changeId: change.id, allocationRevision: revision } } })
      .where(eq(allocations.id, old.id));
    const stale = await tx.select().from(payouts).where(eq(payouts.sourceId, source.id));
    for (const item of stale.filter(item => item.allocationRevision < revision && !item.transferId && !item.noEntitlement))
      await tx.update(payouts).set({ noEntitlement: true, transferAmountCents: 0, holdReason: null, updatedAt: now,
        evidence: { ...(item.evidence as object), supersededBy: { changeId: change.id, allocationRevision: revision } } }).where(eq(payouts.id, item.id));
    await ensureDayPayoutRows(tx, source.id);
  }
}
