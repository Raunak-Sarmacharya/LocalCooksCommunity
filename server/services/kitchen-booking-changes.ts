import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, or, lte, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../db';
import { kitchenBookings, kitchenBookingChanges, kitchenBookingVisits, kitchens, locations, platformSettings,
  paymentTransactions, equipmentBookings, storageBookings, kitchenCheckoutHolds, kitchenViewings, users } from '@shared/schema';
import { assertKitchenChange, bookingChangeSchedule, changeDeadline, kitchenChangeQuote, readKitchenChangePolicy,
  OPEN_KITCHEN_CHANGE_STATES, type ChangeSchedule, type ChangeQuote, type KitchenChangeKind, type KitchenChangeState,
  type KitchenChangePolicy, type ConfirmedStorageChoice } from '@shared/kitchen-booking-change';
import { tourBookingOverlaps } from '@shared/tour-booking-overlap';
import { bookingService } from '../domains/bookings/booking.service';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { createPaymentTransaction, findPaymentTransactionByIntentId, updatePaymentTransaction } from './payment-transactions-service';
import { AUTH_EXPIRY_HOURS } from './auth-expiry-service';
import { HOLD_MINUTES } from './kitchen-checkout-holds';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Change = typeof kitchenBookingChanges.$inferSelect;
export type ChangeActor = { id: number; role: string | null };
export class KitchenChangeError extends Error { constructor(message: string, public status = 409) { super(message); } }
const schedule = (value: unknown) => value as ChangeSchedule;
const quote = (value: unknown) => value as ChangeQuote;
const policy = (value: unknown) => value as KitchenChangePolicy;
// JSONB does not preserve object key order.
export function sameChangeValue(left: unknown, right: unknown): boolean {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function context(connection: typeof db | Tx, bookingId: number, actor?: ChangeActor) {
  const [row] = await connection.select({ booking: kitchenBookings, kitchen: kitchens, managerId: locations.managerId })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || actor && !(actor.role === 'admin' || actor.role === 'chef' && actor.id === row.booking.chefId
    || actor.role === 'manager' && actor.id === row.managerId)) throw new KitchenChangeError('Booking not found', 404);
  return row;
}

async function lockedContext(tx: Tx, bookingId: number, actor?: ChangeActor) {
  const initial = await context(tx, bookingId, actor);
  // Shared schedule/booking/tour lock order. All decisive reads/writes occur inside this transaction.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${initial.booking.kitchenId}, 0)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${initial.booking.kitchenId}, 7)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(0, ${initial.booking.kitchenId})`);
  await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).for('update');
  await tx.select({ id: kitchens.id }).from(kitchens).where(eq(kitchens.id, initial.booking.kitchenId)).for('share');
  await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, initial.kitchen.locationId)).for('share');
  return context(tx, bookingId, actor);
}

async function selectedPolicy(connection: typeof db | Tx) {
  const [setting] = await connection.select().from(platformSettings).where(eq(platformSettings.key, 'kitchen_change_policy')).limit(1);
  const selected = readKitchenChangePolicy(setting?.value);
  return selected?.decisionHours === AUTH_EXPIRY_HOURS && selected.paymentHours === AUTH_EXPIRY_HOURS ? selected : null;
}

async function changeTableAvailable(connection: typeof db | Tx) {
  const result = await connection.execute(sql`SELECT to_regclass('kitchen_booking_changes') IS NOT NULL AS available`);
  return result.rows[0]?.available === true;
}

// Provider identity belongs to the authorization attempt, not a later replacement quote.
function attemptQuote(change: Change): ChangeQuote {
  const attempt = [...change.history as Array<{ state: string; quote?: ChangeQuote }>].reverse().find(entry => entry.state === 'payment_pending');
  return attempt?.quote || quote(change.quote);
}

async function linkedResources(tx: Tx, bookingId: number) {
  const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, bookingId)).for('update');
  const storage = await tx.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, bookingId)).for('update');
  return { equipment: equipment.filter(item => item.status !== 'cancelled'), storage: storage.filter(item => item.status !== 'cancelled'
    || item.checkinCompletedAt && !item.checkoutApprovedAt) };
}
async function assertResources(tx: Tx, bookingId: number, choices: ConfirmedStorageChoice[] = []) {
  const resources = await linkedResources(tx, bookingId);
  if (resources.equipment.length) throw new KitchenChangeError('Equipment must be selected and quoted again, including any cancellation/refund decision. This equipment-change branch is not available yet; no item has been changed.');
  const required = resources.storage.map(item => ({ kind: 'storage', id: item.id, action: 'retain', updatedAt: item.updatedAt.toISOString(),
    startDate: item.startDate.toISOString(), endDate: item.endDate.toISOString() }));
  if (!sameChangeValue(required.sort((a,b) => a.id-b.id), [...choices].sort((a,b) => a.id-b.id)))
    throw new KitchenChangeError('Confirm each storage booking and its existing independent dates again. Changed storage dates, removals and replacements require their existing item workflow; occupied storage stays reserved until verified removal.');
}

async function terms(tx: Tx, row: Awaited<ReturnType<typeof context>>) {
  const booking = row.booking;
  if (booking.paymentStatus !== 'paid' || !booking.paymentIntentId || !booking.pricingMode)
    throw new KitchenChangeError('Original paid terms or rate mode need Local Cooks verification. Do not pay again.');
  const [payment] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.paymentIntentId, booking.paymentIntentId),
    eq(paymentTransactions.status, 'succeeded'))).limit(1);
  if (!payment || payment.bookingId !== booking.id || payment.chefId !== booking.chefId || Number(payment.refundAmount) !== 0)
    throw new KitchenChangeError('Original payment history needs Local Cooks verification.');
  const metadata = payment.metadata as Record<string, unknown> | null;
  // Require recorded capture split rather than guessing from a current hourly rate or a legacy custom PaymentIntent.
  const subtotal = metadata?.approvedSubtotal;
  if (!Number.isSafeInteger(subtotal) || Number(subtotal) < 0 || Number(payment.baseAmount) - Number(payment.taxAmount) !== subtotal
    || Number(payment.amount) !== Number(payment.baseAmount) + Number(payment.serviceFee))
    throw new KitchenChangeError('The original captured kitchen subtotal is ambiguous. Local Cooks must verify the recorded checkout selection and money.');
  const [latest] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, booking.id),
    eq(kitchenBookingChanges.state, 'applied'))).orderBy(sql`${kitchenBookingChanges.createdAt} DESC`).limit(1);
  const resources = await linkedResources(tx, booking.id);
  let approvedAddonCents = 0;
  const decision = booking.paymentDecision as any;
  const hasSavedItems = resources.storage.length || resources.equipment.length || Array.isArray(metadata?.storage_items) && metadata.storage_items.length
    || Array.isArray(metadata?.equipment_items) && metadata.equipment_items.length;
  if (hasSavedItems) {
    if (decision?.state !== 'complete' || decision.intentId !== booking.paymentIntentId || decision.id !== metadata?.bookingDecisionId)
      throw new KitchenChangeError('The original approved kitchen/item payment split needs financial review. No saved item or payment was changed.');
    for (const key of ['storage', 'equipment'] as const) {
      const approved = decision[key]?.filter((item: any) => item.status === 'confirmed');
      const saved = metadata?.[`${key}_items`];
      if (!Array.isArray(approved) || !Array.isArray(saved)) throw new KitchenChangeError('The original approved item prices are unavailable.');
      for (const item of approved) {
        const prices = saved.filter((entry: any) => (entry[`${key}BookingId`] ?? entry.id) === item.id);
        const price = Number(prices[0]?.totalPrice);
        if (prices.length !== 1 || !Number.isSafeInteger(price) || price < 0) throw new KitchenChangeError('An original approved item price requires financial review.');
        approvedAddonCents += price;
      }
    }
  }
  const originalKitchenCents = Number(subtotal) - approvedAddonCents;
  if (originalKitchenCents <= 0) throw new KitchenChangeError('The original kitchen amount requires financial review.');
  const kitchenSubtotal = latest ? quote(latest.quote).retainedKitchenCents : originalKitchenCents;
  return { subtotal: kitchenSubtotal, originalTaxCents: kitchenSubtotal === originalKitchenCents
    ? Math.round(Number(payment.taxAmount) * originalKitchenCents / Number(subtotal)) : undefined };
}

async function validateDestination(tx: Tx, row: Awaited<ReturnType<typeof context>>, kind: KitchenChangeKind,
  destination: ChangeSchedule, selected: KitchenChangePolicy | null, holdId?: string | null, linkedItems: ConfirmedStorageChoice[] = []) {
  const booking = row.booking, original = bookingChangeSchedule(booking);
  const targetMode = destination.pricingMode || booking.pricingMode;
  const positiveRate = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (targetMode !== booking.pricingMode && (!positiveRate(row.kitchen.hourlyRate) || !positiveRate(row.kitchen.dailyRate)))
    throw new KitchenChangeError('Hourly and daily conversions require the manager to offer both with positive rates.');
  if (!positiveRate(targetMode === 'daily' ? row.kitchen.dailyRate : row.kitchen.hourlyRate))
    throw new KitchenChangeError('The manager does not offer this pricing mode at a positive rate.');
  if (kind === 'extend' && destination.pricingMode && destination.pricingMode !== booking.pricingMode) throw new KitchenChangeError('An active extension cannot change the original pricing mode.');
  const result = await bookingService.validateBookingAvailability(booking.kitchenId, new Date(`${destination.date}T12:00:00Z`),
    destination.slots[0].startTime, destination.slots.at(-1)!.endTime, { selectedSlots: destination.slots,
      fullDay: (destination.pricingMode || booking.pricingMode) === 'daily', excludeBookingId: booking.id, excludeHoldId: holdId || undefined });
  if (!result.valid || !result.windowStartTime || targetMode !== 'daily' && !sameChangeValue(result.slots, destination.slots)) throw new KitchenChangeError(result.error || 'Availability changed; select the schedule again.');
  destination = { ...destination, slots: result.slots!, windowStart: result.windowStartTime };
  if (holdId) {
    const [hold] = await tx.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, holdId)).limit(1).for('update');
    if (!hold || hold.kitchenId !== booking.kitchenId || hold.chefId !== booking.chefId || hold.operatingDate !== destination.date
      || hold.expiresAt.getTime() <= Date.now() || hold.windowStartTime !== destination.windowStart || !sameChangeValue(hold.selectedSlots, destination.slots))
      throw new KitchenChangeError('The destination reservation is missing, expired or different. Verify the existing payment; do not pay again.');
  }
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id));
  try { assertKitchenChange({ kind, original, destination, status: booking.status, checkinStatus: booking.checkinStatus,
    checkedInAt: booking.checkedInAt, checkoutRequestedAt: booking.checkoutRequestedAt, checkedOutAt: booking.checkedOutAt,
    visitCount: visits.length, pricingMode: booking.pricingMode, now: Date.now(), cancellationPolicyHours: booking.cancellationPolicyHours ?? 24, policy: selected }); }
  catch (error) { throw new KitchenChangeError((error as Error).message); }
  if (!row.kitchen.isActive || row.kitchen.listingStatus !== 'active') throw new KitchenChangeError('This kitchen is unavailable for a new schedule.');
  await assertResources(tx, booking.id, linkedItems);
  // Tours are context, not capacity. Require manager acknowledgment of the exact current overlap list.
  const tours = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.targetedKitchenId, booking.kitchenId),
    inArray(kitchenViewings.status, ['confirmed', 'pending', 'pending_local_cooks'])));
  const candidate = { ...booking, bookingDate: `${destination.date}T12:00:00Z`, selectedSlots: destination.slots,
    startTime: destination.slots[0].startTime, endTime: destination.slots.at(-1)!.endTime, operatingWindowStartTime: destination.windowStart };
  const overlaps = tours.filter(tour => tourBookingOverlaps([candidate], booking.kitchenId, tour.scheduledAt, tour.durationMinutes).length)
    .map(tour => ({ id: tour.id, scheduledAt: tour.scheduledAt.toISOString(), durationMinutes: tour.durationMinutes, status: tour.status }));
  return { original, destination, overlaps, overlapKey: createHash('sha256').update(JSON.stringify(overlaps)).digest('hex') };
}

async function freshQuote(tx: Tx, row: Awaited<ReturnType<typeof context>>, kind: KitchenChangeKind, destination: ChangeSchedule,
  selected: KitchenChangePolicy | null) {
  const original = bookingChangeSchedule(row.booking), recorded = await terms(tx, row), subtotal = recorded.subtotal;
  const daily = (destination.pricingMode || row.booking.pricingMode) === 'daily';
  const rate = Number(daily ? row.kitchen.dailyRate : row.kitchen.hourlyRate);
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new KitchenChangeError('Current rate is unavailable.');
  const base = kitchenChangeQuote(kind, subtotal, rate, original.slots.length, destination.slots.length, row.booking.currency,
    { daily });
  if (!selected) return base;
  const taxRate = Number(row.kitchen.taxRatePercent || 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new KitchenChangeError('Current tax setting needs review.');
  const taxCents = Math.round(base.addedKitchenCents * taxRate / 100);
  const feeCents = base.addedKitchenCents === 0 ? 0 : (await calculateCheckoutFeesAsync(base.addedKitchenCents, { taxAmountCents: taxCents })).platformCommissionInCents;
  return kitchenChangeQuote(kind, subtotal, rate, original.slots.length, destination.slots.length, row.booking.currency,
    { daily, taxRate, feeCents, originalTaxCents: recorded.originalTaxCents });
}

const labels: Record<KitchenChangeState, string> = { requested: 'Awaiting manager decision', awaiting_consent: 'Updated quote needs chef consent',
  awaiting_payment: 'Chef must authorize the additional amount', payment_pending: 'Card authorization verification in progress',
  authorized: 'Card hold authorized; awaiting manager decision', capture_pending: 'Approved; capture verification in progress',
  refund_pending: 'Approved; refund verification in progress',
  release_pending: 'Card hold release verification in progress',
  recovery_required: 'Local Cooks must reconcile payment and schedule', applied: 'Change confirmed', declined: 'Change declined',
  withdrawn: 'Request withdrawn', expired: 'Request expired' };

function quoteMessage(change: Pick<Change, 'original' | 'destination' | 'quote'>) {
  const old = schedule(change.original), destination = schedule(change.destination), money = quote(change.quote);
  const amount = (cents: number | null) => cents === null ? 'awaiting policy' : `${money.currency} ${(cents / 100).toFixed(2)}`;
  return `Original: ${old.date} ${old.slots[0].startTime}–${old.slots.at(-1)!.endTime}; requested: ${destination.date} ${destination.slots[0].startTime}–${destination.slots.at(-1)!.endTime} (Newfoundland time). Recorded kitchen ${amount(money.originalKitchenCents)}; current quote ${amount(money.currentKitchenCents)}; kitchen after change ${amount(money.retainedKitchenCents)}. Additional kitchen ${amount(money.addedKitchenCents)}, tax ${amount(money.taxCents)}, service fee ${amount(money.feeCents)}, payment ${amount(money.payableCents)}. Refund on approval: kitchen ${amount(money.refundKitchenCents)} plus original tax ${amount(money.refundTaxCents)}, total ${amount(money.refundableCents)}. The original service fee stays charged. Whole-booking cancellation keeps its separate policy.`;
}

async function transition(tx: Tx, change: Change, next: KitchenChangeState, message: string, actorId?: number, values: Partial<typeof kitchenBookingChanges.$inferInsert> = {}, replacementQuote?: ChangeQuote) {
  const revision = change.revision + 1;
  const [updated] = await tx.update(kitchenBookingChanges).set({ ...values, state: next, revision, updatedAt: new Date(),
    history: [...(values.history || change.history) as any[], { revision, state: next, message, actorId, at: new Date().toISOString(),
      ...(next === 'payment_pending' ? { quote: change.quote } : {}), ...(replacementQuote ? { replacementQuote } : {}) }] })
    .where(eq(kitchenBookingChanges.id, change.id)).returning();
  await queueBookingLifecycleEvent(tx, change.bookingId, `kitchen_change_${next}`, labels[next], `${message} ${quoteMessage(updated)}`, actorId,
    { changeId: change.id, changeRevision: revision, recipientPolicy: next === 'recovery_required' ? undefined : 'participants',
      calendarReconciliationRequired: next === 'applied' });
  return updated;
}

async function releaseHold(tx: Tx, change: Change) {
  if (change.holdId) await tx.delete(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, change.holdId));
}

export async function readKitchenChanges(bookingId: number, actor: ChangeActor) {
  return db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor);
    const selected = await selectedPolicy(tx);
    if (!await changeTableAvailable(tx)) return { bookingId, original: bookingChangeSchedule(row.booking), linkedItems: [], availablePricingModes: [],
      equipmentChangeUnavailable: false, policyReady: false, policyMessage: 'Booking changes are awaiting reviewed platform configuration.', changes: [] };
    const changes = await tx.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, bookingId)).orderBy(asc(kitchenBookingChanges.createdAt)).for('update');
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index];
      if (change.state === 'authorized' && Date.now() >= change.decisionBy.getTime()) {
        changes[index] = await transition(tx, change, 'release_pending', 'The manager approval window expired. The additional card hold must be released; the original booking remains reserved.', undefined, { releaseOutcome: 'expired' });
        continue;
      }
      if (['requested', 'awaiting_consent', 'awaiting_payment'].includes(change.state)
        && Date.now() >= (change.state === 'awaiting_payment' ? change.paymentBy! : change.decisionBy).getTime()) {
        await releaseHold(tx, change);
        changes[index] = await transition(tx, change, 'expired', 'The request deadline passed. The original booking remains reserved; no new schedule or payment was applied.');
      }
    }
    const resources = await linkedResources(tx, bookingId);
    return { bookingId, original: bookingChangeSchedule(row.booking), linkedItems: resources.storage.map(item => ({ kind: 'storage', id: item.id, action: 'retain',
      updatedAt: item.updatedAt.toISOString(), startDate: item.startDate.toISOString(), endDate: item.endDate.toISOString() })), equipmentChangeUnavailable: resources.equipment.length > 0, policyReady: !!selected,
      policyMessage: selected ? null : 'Booking changes are awaiting platform configuration. You can review the kitchen price, but contact Local Cooks before submitting or paying.',
      availablePricingModes: [row.kitchen.hourlyRate, row.kitchen.dailyRate].every(rate => Number.isSafeInteger(Number(rate)) && Number(rate) > 0)
        ? ['hourly', 'daily'] as const : [],
      changes: changes.map(change => ({ id: change.id, kind: change.kind, state: change.state, label: labels[change.state as KitchenChangeState],
        revision: change.revision, original: change.original, destination: change.destination, quote: change.quote,
        decisionBy: change.decisionBy, paymentBy: change.paymentBy, history: change.history, createdAt: change.createdAt,
        paymentRecorded: !!change.intentId, refundRecorded: !!change.refundId, canDecide: actor.role === 'manager' && actor.id === row.managerId && change.managerId === row.managerId })) };
  });
}

export async function previewKitchenChange(bookingId: number, actor: ChangeActor, kind: KitchenChangeKind, destination: ChangeSchedule, linkedItems: ConfirmedStorageChoice[] = []) {
  if (actor.role !== 'chef') throw new KitchenChangeError('Only the booking chef requests changes', 403);
  throw new KitchenChangeError('Confirmed kitchen bookings cannot be rescheduled or have their hours changed. Use cancellation under the saved terms.');
}

export async function requestKitchenChange(bookingId: number, actor: ChangeActor, input: { kind: KitchenChangeKind; destination: ChangeSchedule;
  requestKey: string; expectedUpdatedAt: string; quote: ChangeQuote; linkedItems?: ConfirmedStorageChoice[] }) {
  if (actor.role !== 'chef') throw new KitchenChangeError('Only the booking chef requests changes', 403);
  return db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor);
    if (!await changeTableAvailable(tx)) throw new KitchenChangeError('Confirmed kitchen bookings cannot be rescheduled or have their hours changed. Historical change records are unavailable; no new request was started.');
    const [existing] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId), eq(kitchenBookingChanges.requestKey, input.requestKey))).limit(1);
    if (existing) {
      if (existing.kind !== input.kind || !sameChangeValue(existing.destination, input.destination) || !sameChangeValue(existing.linkedItems || [], input.linkedItems || [])) throw new KitchenChangeError('Retry key belongs to a different request.');
      return existing;
    }
    throw new KitchenChangeError('Confirmed kitchen bookings cannot be rescheduled or have their hours changed. Use cancellation under the saved terms.');
  });
}

async function lockedChange(tx: Tx, bookingId: number, changeId: string, actor?: ChangeActor) {
  const row = await lockedContext(tx, bookingId, actor);
  if (!await changeTableAvailable(tx)) throw new KitchenChangeError('Historical change records are unavailable. No payment or schedule change was started.');
  const [change] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.id, changeId), eq(kitchenBookingChanges.bookingId, bookingId))).limit(1).for('update');
  if (!change) throw new KitchenChangeError('Change request not found', 404);
  return { row, change };
}

async function applyChange(tx: Tx, row: Awaited<ReturnType<typeof context>>, change: Change) {
  throw new KitchenChangeError('Confirmed booking changes are retired. Verified historical money requires Local Cooks recovery; the original itinerary remains recorded.');

}

export async function decideKitchenChange(bookingId: number, changeId: string, actor: ChangeActor, input: {
  revision: number; action: 'approve' | 'decline' | 'withdraw' | 'consent'; overlapKey?: string; acceptTourOverlap?: boolean }) {
  const result = await db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, changeId, actor);
    const chef = actor.role === 'chef' && actor.id === row.booking.chefId;
    const manager = actor.role === 'manager' && actor.id === row.managerId && change.managerId === row.managerId;
    if ((['approve', 'decline'].includes(input.action) ? !manager : !chef)) throw new KitchenChangeError('This action belongs to the booking chef or current assigned manager', 403);
    if (change.revision !== input.revision) throw new KitchenChangeError('Request changed; refresh before deciding.');
    if (input.action === 'approve' || input.action === 'consent') throw new KitchenChangeError('Confirmed bookings cannot be rescheduled. Decline or withdraw this historical request, or verify its original payment outcome.');
    if (input.action === 'withdraw' || input.action === 'decline') {
      if (change.state === 'authorized') return transition(tx, change, 'release_pending', 'The original booking remains reserved while the additional card hold is released.', actor.id,
        { releaseOutcome: input.action === 'withdraw' ? 'withdrawn' : 'declined' });
      if (!['requested', 'awaiting_consent', 'awaiting_payment'].includes(change.state)) throw new KitchenChangeError('Payment may be in progress. Verify its original outcome before releasing inventory or closing the request.');
      await releaseHold(tx, change);
      return transition(tx, change, input.action === 'withdraw' ? 'withdrawn' : 'declined', 'The change will not be applied. The original booking and cancellation policy remain unchanged.', actor.id);
    }

    throw new KitchenChangeError('Confirmed booking changes are retired.');
  });
  if (['capture_pending', 'release_pending', 'refund_pending'].includes(result.state)) {
    await settleKitchenChangeDecision(result);
    const [current] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, result.id)).limit(1);
    return current;
  }
  return result;
}

async function settleKitchenChangeDecision(change: Change) {
  if (change.state === 'refund_pending') return settleKitchenChangeRefund(change);
  if (!change.intentId) throw new KitchenChangeError('The original card authorization must be reconciled.');
  const { getBookingPaymentIntent, capturePaymentIntent, cancelPaymentIntent } = await import('./stripe-service');
  let intent = await getBookingPaymentIntent(change.intentId);
  if (change.state === 'capture_pending') {
    if (intent.status !== 'succeeded' && intent.status !== 'canceled') {
      const retired = await db.transaction(async tx => {
        const { change: current } = await lockedChange(tx, change.bookingId, change.id);
        if (current.state !== 'capture_pending') return current;
        return transition(tx, current, 'release_pending', 'Confirmed booking changes are retired. Release the original additional authorization; no new capture or itinerary change is permitted.', undefined, { releaseOutcome: 'expired' });
      });
      return settleKitchenChangeDecision(retired);
    }
    if (intent.status === 'canceled') return reconcileKitchenChangeCancellation(intent);
    intent = await getBookingPaymentIntent(intent.id);
    return reconcileKitchenChangePayment(intent);
  }
  if (change.state === 'release_pending') {
    if (intent.status === 'succeeded') return reconcileKitchenChangePayment(intent);
    if (intent.status === 'requires_capture') await cancelPaymentIntent(intent.id);
    intent = await getBookingPaymentIntent(intent.id);
    if (intent.status !== 'canceled') throw new KitchenChangeError('Card hold release is unverified. Local Cooks must reconcile it; do not pay again.');
    const cancellation = await reconcileKitchenChangeCancellation(intent);
    if (cancellation) return cancellation;
    return db.transaction(async tx => {
      const { change: current } = await lockedChange(tx, change.bookingId, change.id);
      if (current.state !== 'release_pending') return current;
      await releaseHold(tx, current);
      const outcome = current.releaseOutcome as KitchenChangeState;
      if (!['declined', 'withdrawn', 'expired', 'awaiting_consent'].includes(outcome)) throw new KitchenChangeError('Card hold release outcome requires review.');
      return transition(tx, current, outcome, 'Stripe verified release of the additional card hold. The original booking remains reserved.', undefined,
        { holdId: null, releaseOutcome: null });
    });
  }
}

async function settleKitchenChangeRefund(change: Change) {
  const plan = change.refundPlan as { intentId: string; transactionId: number; amount: number; initialRefundCents: number } | null;
  if (!plan?.intentId || !plan.amount) throw new KitchenChangeError('The original refund plan needs financial review.');
  const { reverseTransferAndRefund, getPaymentIntentRefunds } = await import('./stripe-service');
  // Recover the original operation even beyond Stripe's idempotency-key retention.
  const receipts = (await getPaymentIntentRefunds(plan.intentId)).filter(item => item.metadata?.kitchen_change_id === change.id);
  if (receipts.length > 1) throw new KitchenChangeError('Multiple refund records require Local Cooks reconciliation. No new refund was started.');
  if (!receipts.length && (change.refundId || change.state === 'recovery_required')) throw new KitchenChangeError('The original refund needs financial reconciliation. No new refund was started.');
  if (!receipts.length && Date.now() >= change.decisionBy.getTime()) {
    return db.transaction(async tx => {
      const { change: current } = await lockedChange(tx, change.bookingId, change.id);
      if (current.state !== 'refund_pending') return current;
      await releaseHold(tx, current);
      return transition(tx, current, 'recovery_required', 'The approved refund outcome could not be verified before the change deadline. Local Cooks must reconcile any transfer reversal and refund; the original booking remains recorded.');
    });
  }
  if (!receipts.length) return db.transaction(async tx => {
    const { change: current } = await lockedChange(tx, change.bookingId, change.id);
    await releaseHold(tx, current);
    return transition(tx, current, 'recovery_required', 'Historical reduction is retired. No new refund or itinerary change was initiated. Local Cooks must verify any earlier reversal or provider outcome.');
  });
  const refund = { refundId: receipts[0].id, refundAmount: receipts[0].amount, refundStatus: receipts[0].status };
  if (refund.refundAmount !== plan.amount || refund.refundStatus !== 'succeeded') throw new KitchenChangeError('The refund is not verified as complete. The original booking remains recorded; verify the same request instead of issuing another refund.');
  return db.transaction(async tx => {
    const { row, change: current } = await lockedChange(tx, change.bookingId, change.id);
    if (current.state === 'applied') return current;
    if (!['refund_pending', 'recovery_required'].includes(current.state) || !sameChangeValue(current.refundPlan, plan)) throw new KitchenChangeError('Refund recovery requires financial review.');
    if (current.state === 'recovery_required' && current.refundId === refund.refundId) return current;
    const source = await findPaymentTransactionByIntentId(plan.intentId, tx);
    const cumulative = plan.initialRefundCents + plan.amount;
    if (!source || source.id !== plan.transactionId || Number(source.refund_amount) > cumulative) throw new KitchenChangeError('Another refund changed the source transaction. Local Cooks must reconcile it.');
    const refunds = Array.isArray(source.metadata?.refunds) ? source.metadata.refunds : [];
    const metadata = { ...(source.metadata || {}), refunds: refunds.some((entry: any) => entry.refundId === refund.refundId) ? refunds : [...refunds,
      { refundId: refund.refundId, kitchenChangeId: change.id, customerReceived: plan.amount, managerDebited: plan.amount, platformServiceFeeReturned: 0 }] };
    await updatePaymentTransaction(source.id, { status: 'partially_refunded', refundId: refund.refundId, refundAmount: cumulative,
      refundReason: 'Approved kitchen reschedule price decrease', refundedAt: new Date(), metadata }, tx, true);
    await tx.update(kitchenBookingChanges).set({ refundId: refund.refundId }).where(eq(kitchenBookingChanges.id, current.id));
    if (current.state === 'recovery_required') return transition(tx, current, 'recovery_required', 'The original approved refund is now verified and recorded. The destination schedule still requires Local Cooks reconciliation.', undefined, { refundId: refund.refundId });
    await tx.execute(sql`SAVEPOINT kitchen_change_refund_apply`);
    try {
      if (Date.now() >= current.decisionBy.getTime() || row.managerId !== current.managerId) throw new KitchenChangeError('The approved change window or assigned manager changed during refund verification.');
      const applied = await applyChange(tx, row, current);
      await tx.execute(sql`RELEASE SAVEPOINT kitchen_change_refund_apply`);
      return applied;
    } catch {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT kitchen_change_refund_apply`);
      await releaseHold(tx, current);
      return transition(tx, current, 'recovery_required', 'The approved refund is recorded, but the destination schedule is not confirmed. The original booking remains recorded. Local Cooks must reconcile the refund and reservation; do not issue another refund.');
    }
  });
}

export async function reconcileKitchenChangeRefundCharge(charge: Stripe.Charge) {
  const ids = Array.from(new Set((charge.refunds?.data || []).map(item => item.metadata?.kitchen_change_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)));
  if (!ids.length) return false;
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  const changes = await db.select().from(kitchenBookingChanges).where(inArray(kitchenBookingChanges.id, ids));
  for (const change of changes) {
    const plan = change.refundPlan as { intentId?: string; initialRefundCents?: number; amount?: number } | null;
    if (plan?.intentId !== intentId || charge.amount_refunded !== Number(plan?.initialRefundCents) + Number(plan?.amount)) continue;
    if (['refund_pending', 'recovery_required'].includes(change.state)) await settleKitchenChangeRefund(change);
    if (['refund_pending', 'applied', 'recovery_required'].includes(change.state)) return true;
  }
  return false;
}

export async function kitchenChangeDecisionContext(bookingId: number, changeId: string, actor: ChangeActor) {
  return db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, changeId, actor);
    if (actor.role !== 'manager' || actor.id !== row.managerId || row.managerId !== change.managerId) throw new KitchenChangeError('Only the current assigned manager can approve', 403);
    return validateDestination(tx, row, change.kind as KitchenChangeKind, schedule(change.destination), policy(change.policy), change.holdId, change.linkedItems as ConfirmedStorageChoice[]);
  });
}

/** Freeze the provider operation before external I/O. Retrying the same revision uses the same Stripe key. */
export async function checkoutKitchenChange(stripe: Stripe, bookingId: number, changeId: string, actor: ChangeActor, baseUrl: string): Promise<Stripe.Checkout.Session> {
  return db.transaction(async tx => {
    await lockedChange(tx, bookingId, changeId, actor);
    if (actor.role !== 'chef') throw new KitchenChangeError('Only the booking chef can pay', 403);
    throw new KitchenChangeError('Confirmed booking changes are retired. Checkout is closed; verify the original provider outcome without authorizing another payment.');
  });
}

/** Verified provider success, API recovery and repeated webhooks share this one inventory/money commit. */
export async function reconcileKitchenChangePayment(intent: Stripe.PaymentIntent) {
  if (intent.metadata.type !== 'kitchen_booking_change') return null;
  if (intent.status !== 'succeeded') throw new KitchenChangeError('Additional payment has not succeeded.');
  const id = intent.metadata.kitchen_change_id, bookingId = Number(intent.metadata.booking_id);
  return db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, id);
    const money = attemptQuote(change);
    const providerRevision = [...change.history as Array<{ state: string; revision: number }>].reverse().find(entry => entry.state === 'payment_pending')?.revision;
    if (intent.metadata.chef_id !== String(row.booking.chefId) || intent.metadata.change_revision !== String(providerRevision)
      || intent.currency !== money.currency.toLowerCase()
      || intent.amount_received !== money.payableCents || change.intentId && change.intentId !== intent.id)
      throw new KitchenChangeError('Provider payment differs from the recorded request. Local Cooks must reconcile it.');
    const approved = (change.history as Array<{ state: string }>).some(entry => entry.state === 'capture_pending');
    let transaction = await findPaymentTransactionByIntentId(intent.id, tx);
    if (transaction && (transaction.booking_id !== bookingId || transaction.amount !== String(money.payableCents)
      || !['authorized', 'succeeded', 'partially_refunded', 'refunded'].includes(transaction.status))) throw new KitchenChangeError('Recorded adjustment needs financial review.');
    if (transaction?.status === 'authorized') transaction = await updatePaymentTransaction(transaction.id, {
      status: 'succeeded', stripeStatus: intent.status, chargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id,
      paidAt: new Date() }, tx, true);
    if (!transaction) transaction = await createPaymentTransaction({ bookingId, bookingType: 'kitchen', chefId: row.booking.chefId,
      managerId: change.managerId, amount: money.payableCents!, baseAmount: money.addedKitchenCents + money.taxCents!, taxAmount: money.taxCents!,
      serviceFee: money.feeCents!, managerRevenue: money.addedKitchenCents + money.taxCents!, currency: money.currency,
      paymentIntentId: intent.id, chargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id,
      status: 'succeeded', stripeStatus: intent.status, metadata: { kitchenChangeId: id, approvedSubtotal: money.addedKitchenCents,
        approvedTax: money.taxCents, platformCommission: money.feeCents, changeQuote: money, originalBookingPaymentIntentId: row.booking.paymentIntentId } }, tx);
    await tx.update(kitchenBookingChanges).set({ intentId: intent.id }).where(eq(kitchenBookingChanges.id, id));
    if (change.state === 'applied') return { transaction, applied: true };
    await tx.execute(sql`SAVEPOINT kitchen_change_apply`);
    try {
      if (!approved || change.state !== 'capture_pending') throw new KitchenChangeError('Capture arrived outside its current approved decision. Verified funds require Local Cooks review.');
      if (!change.paymentBy || Date.now() >= change.paymentBy.getTime() || row.managerId !== change.managerId) throw new KitchenChangeError('Payment arrived after the approved deadline or manager ownership changed.');
      await applyChange(tx, row, change);
      await tx.execute(sql`RELEASE SAVEPOINT kitchen_change_apply`);
      return { transaction, applied: true };
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT kitchen_change_apply`);
      // Keep successful funds and original commitment truthful. No automatic refund or second charge.
      await releaseHold(tx, change);
      if (change.state !== 'recovery_required') await transition(tx, change, 'recovery_required', `Additional payment was received, but the schedule is not confirmed. The original booking remains recorded. Local Cooks must reconcile the payment and reservation; do not pay again. ${(error as Error).message}`);
      return { transaction, applied: false };
    }
  });
}

/** Authorization is a card hold, never a captured transaction or confirmed schedule. */
export async function reconcileKitchenChangeAuthorization(intent: Stripe.PaymentIntent) {
  if (intent.metadata.type !== 'kitchen_booking_change') return null;
  if (intent.status !== 'requires_capture') throw new KitchenChangeError('The additional card authorization is not verified.');
  return db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, Number(intent.metadata.booking_id), intent.metadata.kitchen_change_id);
    const revision = [...change.history as Array<{ state: string; revision: number }>].reverse().find(entry => entry.state === 'payment_pending')?.revision;
    if (intent.metadata.chef_id !== String(row.booking.chefId) || intent.metadata.change_revision !== String(revision)
      || intent.amount_capturable !== attemptQuote(change).payableCents || intent.currency !== attemptQuote(change).currency.toLowerCase()
      || change.intentId && change.intentId !== intent.id) throw new KitchenChangeError('The card authorization differs from the recorded request.');
    if (change.state === 'authorized') return change;
    if (['capture_pending', 'release_pending', 'applied', 'recovery_required', 'declined', 'withdrawn', 'expired', 'awaiting_consent'].includes(change.state)) return change;
    if (change.state !== 'payment_pending') throw new KitchenChangeError('This authorization requires Local Cooks reconciliation.');
    await tx.update(kitchenBookingChanges).set({ intentId: intent.id }).where(eq(kitchenBookingChanges.id, change.id));
    return transition(tx, change, 'release_pending', 'Confirmed booking changes are retired. The verified additional authorization must be released; the original itinerary remains recorded.', undefined, { intentId: intent.id, releaseOutcome: 'expired' });
  });
}

export async function reconcileKitchenChangeCancellation(intent: Stripe.PaymentIntent) {
  if (intent.metadata.type !== 'kitchen_booking_change' || intent.status !== 'canceled') return null;
  return db.transaction(async tx => {
    const { change } = await lockedChange(tx, Number(intent.metadata.booking_id), intent.metadata.kitchen_change_id);
    const revision = [...change.history as Array<{ state: string; revision: number }>].reverse().find(entry => entry.state === 'payment_pending')?.revision;
    if (intent.metadata.change_revision !== String(revision) || change.intentId && change.intentId !== intent.id) return change;
    if (!['payment_pending', 'authorized', 'release_pending', 'capture_pending'].includes(change.state)) return change;
    const transaction = await findPaymentTransactionByIntentId(intent.id, tx);
    if (transaction?.status === 'authorized') await updatePaymentTransaction(transaction.id, { status: 'canceled', stripeStatus: intent.status }, tx, true);
    await releaseHold(tx, change);
    const outcome = change.state === 'release_pending' ? change.releaseOutcome as KitchenChangeState : 'expired';
    if (!['declined', 'withdrawn', 'expired', 'awaiting_consent'].includes(outcome)) throw new KitchenChangeError('Card hold release outcome requires review.');
    const replacement = [...change.history as Array<{ replacementQuote?: ChangeQuote }>].reverse().find(entry => entry.replacementQuote)?.replacementQuote;
    return transition(tx, change, outcome, 'Stripe verified release of the additional card hold. The original booking remains reserved.', undefined,
      { holdId: null, releaseOutcome: null, ...(outcome === 'awaiting_consent' && replacement ? { quote: replacement } : {}) });
  });
}

/** Bounded existing-worker sweep. Payment uncertainty remains owned; a timer cannot declare it unpaid. */
export async function expireKitchenChanges(limit = 3) {
  if (!await changeTableAvailable(db)) return { checked: 0 };
  const due = await db.select({ bookingId: kitchenBookingChanges.bookingId }).from(kitchenBookingChanges).where(or(
    inArray(kitchenBookingChanges.state, ['payment_pending', 'capture_pending', 'release_pending', 'refund_pending']),
    and(inArray(kitchenBookingChanges.state, ['requested', 'awaiting_consent', 'authorized']), lte(kitchenBookingChanges.decisionBy, new Date())),
    and(eq(kitchenBookingChanges.state, 'awaiting_payment'), lte(kitchenBookingChanges.paymentBy, new Date()))))
    .orderBy(asc(kitchenBookingChanges.decisionBy)).limit(limit);
  let pendingCount = 0;
  for (const change of due) {
    try {
    // System reads the same transactional expiration path, without inventing attendance.
    await readKitchenChanges(change.bookingId, { id: 0, role: 'admin' });
    const pending = await db.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, change.bookingId), inArray(kitchenBookingChanges.state, ['payment_pending', 'capture_pending', 'release_pending', 'refund_pending']))).limit(1);
    if (pending[0]?.state === 'payment_pending') {
      if (!process.env.STRIPE_SECRET_KEY) { pendingCount++; continue; }
      const { default: StripeClient } = await import('stripe');
      await syncKitchenChange(new StripeClient(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' }), change.bookingId, pending[0].id, { id: 0, role: 'admin' });
    } else if (pending[0]) await settleKitchenChangeDecision(pending[0]);
    } catch { pendingCount++; }
  }
  return { checked: due.length, pending: pendingCount };
}

export async function syncKitchenChange(stripe: Stripe, bookingId: number, changeId: string, actor: ChangeActor) {
  await context(db, bookingId, actor);
  const [change] = await db.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.id, changeId), eq(kitchenBookingChanges.bookingId, bookingId))).limit(1);
  if (!change) throw new KitchenChangeError('Change not found', 404);
  if (change.state === 'recovery_required' && change.refundPlan) return settleKitchenChangeRefund(change);
  if (['capture_pending', 'release_pending', 'refund_pending'].includes(change.state)) return settleKitchenChangeDecision(change);
  if (change.intentId) {
    const intent = await stripe.paymentIntents.retrieve(change.intentId);
    if (intent.status === 'requires_capture') return reconcileKitchenChangeAuthorization(intent);
    if (intent.status === 'canceled') return reconcileKitchenChangeCancellation(intent);
    return reconcileKitchenChangePayment(intent);
  }
  if (!change.sessionId) throw new KitchenChangeError('Checkout creation outcome needs reconciliation. Retry the original payment action; never start a new request.');
  const session = await stripe.checkout.sessions.retrieve(change.sessionId, { expand: ['payment_intent'] });
  const intent = session.payment_intent;
  if (intent && typeof intent !== 'string' && intent.status === 'requires_capture') return reconcileKitchenChangeAuthorization(intent);
  if (intent && typeof intent !== 'string' && intent.status === 'succeeded') return reconcileKitchenChangePayment(intent);
  if (session.status !== 'expired') return { applied: false, pending: true };
  // Provider-verified expiry releases the destination. Ambiguous responses never do.
  return db.transaction(async tx => {
    const { change: current } = await lockedChange(tx, bookingId, changeId, actor);
    if (current.state === 'payment_pending' && current.sessionId === session.id && !current.intentId) {
      await releaseHold(tx, current);
      return transition(tx, current, 'expired', 'Stripe confirmed that Checkout expired without successful payment. The original booking remains unchanged.');
    }
    return current;
  });
}
