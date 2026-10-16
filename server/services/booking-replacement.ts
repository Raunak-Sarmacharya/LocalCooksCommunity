import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchens, bookingLifecycleEvents } from '@shared/schema';
import { logger } from '../logger';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { getBookingResponseDeadline } from './booking-response-deadline';
import type { ReplacementNotice } from './request-replacement-notice';
import { workerAfter, workerBatch, workerPageEnd, workerRecord } from './worker-context';

/**
 * "Rebook first, the old request closes after": a chef changes a PENDING request by sending a new one for the same kitchen.
 * Only once the new request exists is the old one withdrawn through the normal chef-withdraw path (hold released, slots freed).
 */
export class ReplacementError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/** Pending pairs and unresolved releases remain recoverable until finished or handed to support. */
export type ReplacementOutcome = 'pending' | 'withdrawn' | 'releasing' | 'two_bookings' | 'ended' | 'needs_support';
const STATUS_KIND = 'replacement_status';

type Pending = { replacedBy?: { bookingId: number; reference: string | null; deadlineAt?: string }; target?: string; deadEnd?: { kind: string } };
type Writer = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The id a checkout session says it replaces, or undefined. */
export function replacesBookingIdFrom(metadata: Record<string, string | undefined>): number | undefined {
  const id = Number(metadata.replaces_booking_id);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Checked before a checkout session exists: the chef's own, same kitchen, still an undecided pending request. */
export async function assertReplaceableRequest(oldBookingId: number, chefId: number, kitchenId: number) {
  if (!Number.isSafeInteger(oldBookingId) || oldBookingId <= 0) throw new ReplacementError('We couldn’t find the request you’re changing.', 404);
  const [old] = await db.select({ booking: kitchenBookings, kitchenName: kitchens.name }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .where(and(eq(kitchenBookings.id, oldBookingId), eq(kitchenBookings.chefId, chefId))).limit(1);
  if (!old) throw new ReplacementError('We couldn’t find the request you’re changing.', 404);
  if (old.booking.kitchenId !== kitchenId) throw new ReplacementError('You can only change a request for the same kitchen. Start a new booking for a different kitchen.');
  if (old.booking.status !== 'pending' || old.booking.paymentStatus !== 'authorized' || old.booking.paymentDecision)
    throw new ReplacementError(`${old.kitchenName || 'The kitchen'} has already answered your earlier request, so it can’t be changed. Book a new time from the kitchen page.`);
  return old.booking;
}

/** The earlier request, read inside the fulfillment transaction: is it still an undecided pending request? */
export async function replacedRequestForFulfillment(tx: Pick<typeof db, 'select'>, oldBookingId: number, chefId: number, kitchenId: number) {
  const [old] = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, oldBookingId),
    eq(kitchenBookings.chefId, chefId), eq(kitchenBookings.kitchenId, kitchenId))).limit(1).for('update');
  if (!old) return undefined;
  const live = old.status === 'pending' && old.paymentStatus === 'authorized' && !old.paymentDecision;
  return { booking: old, live };
}

export function noticeTimes(booking: { bookingDate: Date | string; startTime: string; endTime: string }) {
  return { date: new Date(booking.bookingDate).toISOString().slice(0, 10), startTime: booking.startTime, endTime: booking.endTime };
}

async function latestStatus(newBookingId: number, reader: Pick<typeof db, 'select'> = db) {
  const [row] = await reader.select({ metadata: bookingLifecycleEvents.metadata }).from(bookingLifecycleEvents)
    .where(and(eq(bookingLifecycleEvents.bookingId, newBookingId), eq(bookingLifecycleEvents.kind, STATUS_KIND)))
    .orderBy(desc(bookingLifecycleEvents.id)).limit(1);
  const metadata = row?.metadata as { outcome?: ReplacementOutcome; oldBookingId?: number; oldReference?: string } | undefined;
  return metadata?.outcome ? metadata : undefined;
}

/** What the success page and booking page tell the chef. Null when this request did not replace another. */
export async function readReplacementOutcome(newBookingId: number, chefId: number) {
  const [booking] = await db.select({ id: kitchenBookings.id, referenceCode: kitchenBookings.referenceCode, kitchenName: kitchens.name }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .where(and(eq(kitchenBookings.id, newBookingId), eq(kitchenBookings.chefId, chefId))).limit(1);
  if (!booking) return null;
  const status = await latestStatus(newBookingId);
  if (!status?.oldBookingId || !status.outcome) return null;
  let outcome = status.outcome;
  if (['pending', 'releasing', 'needs_support'].includes(outcome)) {
    const [old] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, status.oldBookingId)).limit(1);
    if (old?.status !== 'cancelled' && (old?.paymentDecision as Pending | null)?.deadEnd) outcome = 'needs_support';
    else if (outcome === 'needs_support' && old?.status === 'cancelled') outcome = 'ended';
  }
  return { outcome, oldBookingId: status.oldBookingId, oldReference: status.oldReference ?? null, newReference: booking.referenceCode ?? null, kitchenName: booking.kitchenName ?? null };
}

/** History-only rows (no notices): "Replaced by {ref}" on the old request, "Replaces {ref}" on the new one. Once each. */
async function recordLinks(tx: Writer, oldId: number, oldRef: string | null, newId: number, newRef: string | null) {
  const link = async (bookingId: number, kind: 'replaced_by' | 'replaces', otherId: number, otherRef: string | null) => {
    const [existing] = await tx.select({ id: bookingLifecycleEvents.id }).from(bookingLifecycleEvents).where(and(
      eq(bookingLifecycleEvents.bookingId, bookingId), eq(bookingLifecycleEvents.kind, kind),
      sql`${bookingLifecycleEvents.metadata}->>'otherBookingId' = ${String(otherId)}`)).limit(1);
    if (existing) return;
    await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, title: kind === 'replaced_by' ? 'Request replaced' : 'Replaces an earlier request',
      message: otherRef ? `${kind === 'replaced_by' ? 'Replaced by' : 'Replaces'} ${otherRef}` : 'Replaced request', metadata: { otherBookingId: otherId, ...(otherRef ? { otherRef } : {}) },
      emails: [], completedAt: new Date() });
  };
  await link(oldId, 'replaced_by', newId, newRef);
  await link(newId, 'replaces', oldId, oldRef);
}

export async function recordReplacementPending(tx: Writer, newBookingId: number, oldBookingId: number, oldReference: string | null) {
  await recordStatus(tx, newBookingId, oldBookingId, oldReference, 'pending');
}

async function recordStatus(tx: Writer, newBookingId: number, oldBookingId: number, oldReference: string | null, outcome: ReplacementOutcome) {
  await tx.insert(bookingLifecycleEvents).values({ bookingId: newBookingId, kind: STATUS_KIND, title: 'Replacement status',
    message: outcome, metadata: { outcome, oldBookingId, ...(oldReference ? { oldReference } : {}) }, emails: [], completedAt: new Date() });
}

async function notifyChef(tx: Writer, newBookingId: number, chefId: number, notice: ReplacementNotice, title: string, message: string) {
  await queueBookingLifecycleEvent(tx, newBookingId, 'request_replacement_update', title, message, chefId,
    { recipientPolicy: 'chef', replacementNotice: notice });
}

/**
 * After the new request exists: withdraw the old one through the existing chef-withdraw path. Idempotent: safe to run again
 * after a webhook replay. A request the kitchen already answered is never touched; the chef is told plainly instead.
 */
export async function completeReplacement(newBookingId: number, oldBookingId: number): Promise<ReplacementOutcome | null> {
  const [fresh] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, newBookingId)).limit(1);
  if (!fresh?.chefId || oldBookingId === newBookingId) return null;
  const chefId = fresh.chefId;
  const prior = await latestStatus(newBookingId);
  if (prior?.outcome && !['pending', 'releasing', 'needs_support'].includes(prior.outcome)) return prior.outcome;
  const [oldRow] = await db.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, oldBookingId),
    eq(kitchenBookings.chefId, chefId), eq(kitchenBookings.kitchenId, fresh.kitchenId))).limit(1);
  if (!oldRow) return null;
  const deadlineAt = await getBookingResponseDeadline(fresh).then(value => value.toISOString()).catch(() => undefined);
  const oldRef = oldRow.referenceCode ?? null, newRef = fresh.referenceCode ?? null;
  const ours = (row: typeof oldRow) => (row.paymentDecision as Pending | null)?.replacedBy?.bookingId === newBookingId;

  let current = oldRow;
  if (!(current.paymentDecision as Pending | null)?.deadEnd && current.status === 'pending' && current.paymentStatus === 'authorized' && (!current.paymentDecision || ours(current))) {
    try {
      const { decideAuthorizedBooking } = await import('./booking-payment-decision');
      await decideAuthorizedBooking(oldBookingId, 'cancelled', [], [], chefId, undefined,
        { replacedBy: { bookingId: newBookingId, reference: newRef, ...(deadlineAt ? { deadlineAt } : {}) } });
    } catch (error) {
      logger.warn('[Replacement] The earlier request could not be withdrawn yet', { oldBookingId, newBookingId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Serialize history/status/outbox writes on the new booking row. Never hold this lock while calling Stripe.
  const savedOutcome = await db.transaction(async tx => {
    await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, newBookingId)).for('update');
    const saved = await latestStatus(newBookingId, tx);
    if (saved?.outcome && !['pending', 'releasing', 'needs_support'].includes(saved.outcome)) return saved.outcome;
    // A different reconciler may have finished while this caller waited for the pair lock.
    [current] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, oldBookingId)).limit(1);
    const decision = current.paymentDecision as Pending | null;
    const stuck = current.status === 'pending' && current.paymentStatus === 'authorized' && !decision;
    const outcome: ReplacementOutcome = current.status !== 'cancelled' && decision?.deadEnd ? 'needs_support'
      : ours(current) ? current.status === 'cancelled' ? 'withdrawn' : 'releasing'
      : current.status === 'cancelled' ? 'ended'
      : decision?.target === 'cancelled' ? 'releasing'
      : current.status === 'confirmed' || decision?.target === 'confirmed' ? 'two_bookings' : 'releasing';
    if (ours(current)) {
      await recordLinks(tx, oldBookingId, oldRef, newBookingId, newRef);
      if (current.status === 'cancelled') await tx.update(kitchenBookings).set({
        cancellationEffectiveAt: current.cancellationEffectiveAt ?? new Date(), cancellationCause: 'chef',
        cancellationOperationKey: `chef-withdraw-${oldBookingId}-replaced-${newBookingId}` }).where(eq(kitchenBookings.id, oldBookingId));
    }
    if (saved?.outcome !== outcome) {
      // Legacy pairs can fail before a decision is saved; the normal reconciler queues recovery for recorded decisions.
      if (outcome === 'releasing' && stuck) await queueBookingLifecycleEvent(tx, oldBookingId, 'payment_recovery_needed', 'We’re releasing your earlier hold',
        `Your new request is sent. We couldn’t release the hold for your earlier request${oldRef ? ` ${oldRef}` : ''} yet. We’ll keep trying, and Local Cooks has been told. Please don’t pay again.`,
        chefId, { recipientPolicy: 'chef', supportCase: true, replacementNotice: { variant: 'releasing', oldRef: oldRef ?? undefined, newRef: newRef ?? undefined } });
      await recordStatus(tx, newBookingId, oldBookingId, oldRef, outcome);
      const names = { oldRef: oldRef ?? undefined, newRef: newRef ?? undefined, ...(deadlineAt ? { deadlineAt } : {}) };
      if (outcome === 'two_bookings') await notifyChef(tx, newBookingId, chefId, { variant: 'two_bookings', ...names }, 'You now have two bookings',
        `The kitchen accepted your original request ${oldRef ?? ''} before your change was sent. You now have two bookings. Cancel the one you don’t need. The new request can be withdrawn at no cost.`);
      if (outcome === 'ended') await notifyChef(tx, newBookingId, chefId, { variant: 'ended', ...names }, 'Your new request is sent',
        `Your earlier request ${oldRef ?? ''} had already ended, so there was nothing to withdraw.`);
    }
    return outcome;
  });
  // The withdrawal's own notice is queued with the hold release; deliver both bookings' notices now rather than at the next tick.
  const { deliverBookingLifecycleEvents } = await import('./booking-lifecycle-delivery');
  for (const id of [oldBookingId, newBookingId]) await deliverBookingLifecycleEvents(10, 20_000, id).catch(error => logger.warn('Replacement notice pending retry', error));
  return savedOutcome;
}

/** Never lets a replacement problem fail the checkout fulfillment (the new request already stands). */
export async function completeReplacementSafely(newBookingId: number, oldBookingId: number): Promise<ReplacementOutcome | null> {
  try { return await completeReplacement(newBookingId, oldBookingId); }
  catch (error) {
    logger.error('[Replacement] Could not finish replacing the earlier request; the new request stands', { newBookingId, oldBookingId, error });
    return null;
  }
}

/**
 * Worker backstop for "releasing": the withdrawal of the earlier request didn't finish. A paid checkout webhook is not replayed by
 * Stripe, so without this the earlier request would stay open to the kitchen until it expired. Bounded: three per tick.
 */
export async function retryStuckReplacements(limit = 3) {
  const pageSize = Math.min(limit, workerBatch());
  const due = await db.select({ id: bookingLifecycleEvents.id, bookingId: bookingLifecycleEvents.bookingId, metadata: bookingLifecycleEvents.metadata })
    .from(bookingLifecycleEvents).where(and(workerAfter('replacementRecovery', bookingLifecycleEvents.id),
      eq(bookingLifecycleEvents.kind, STATUS_KIND), sql`${bookingLifecycleEvents.metadata}->>'outcome' IN ('pending', 'releasing')`,
      sql`NOT EXISTS (SELECT 1 FROM booking_lifecycle_events newer WHERE newer.booking_id = ${bookingLifecycleEvents.bookingId}
        AND newer.kind = ${STATUS_KIND} AND newer.id > ${bookingLifecycleEvents.id})`,
      sql`NOT EXISTS (SELECT 1 FROM kitchen_bookings original WHERE original.id::text = ${bookingLifecycleEvents.metadata}->>'oldBookingId'
        AND original.payment_decision->'deadEnd' IS NOT NULL AND original.status <> 'cancelled')`))
    .orderBy(bookingLifecycleEvents.id).limit(pageSize);
  await workerPageEnd('replacementRecovery', due.length, pageSize);
  let completed = 0;
  for (const row of due) {
    await workerRecord('replacementRecovery', row.id);
    const outcome = await completeReplacementSafely(row.bookingId, Number((row.metadata as { oldBookingId: number }).oldBookingId));
    if (outcome && !['pending', 'releasing'].includes(outcome)) completed++;
  }
  return { processed: due.length, completed };
}

