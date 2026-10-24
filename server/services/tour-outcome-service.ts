import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, locations, tourDeliveryEvents } from '@shared/schema';
import { logger } from '../logger';
import { queueTourEvent, deliverTourEvents, attemptTourDelivery } from './tour-delivery-service';
import { tourRequestEscalationDue, tourRequestEscalationKey } from '@shared/tour-request-decision';
import { workerAfter, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
import { queueTourReconfirmations, queueTourReconfirmation } from './tour-reconfirmation-service';
import { tourFeedbackEventKey, tourFeedbackMissingDue, tourFeedbackOpen } from '@shared/tour-feedback';
import { readTourFeedbackStatus } from './tour-feedback-service';
import { scheduleTourTimer } from './deadline-timer';

/** Expiry follows the existing confirmation deadline; it never invents attendance or changes reservation state. */
export async function expireTourRequest(id: number) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, id),
      inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']), sql`${kitchenViewings.scheduledAt} <= clock_timestamp()`)).limit(1).for('update');
    if (!current || !['pending_local_cooks', 'pending'].includes(current.status) || new Date(current.scheduledAt).getTime() > Date.now()) return false;
    const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
      .where(and(eq(tourDeliveryEvents.viewingId, current.id), sql`${tourDeliveryEvents.payload}->>'kind' = 'expired'`)).limit(1);
    const [expired] = await tx.update(kitchenViewings).set({ status: 'cancelled', requestExpiredAt: current.scheduledAt,
      cancelledAt: current.scheduledAt, cancelledBy: 'request_expired', cancellationReason: null,
      rescheduleProposedSlots: [], rescheduleProposedAt: null, requestedRescheduleAt: null, rescheduleRequestedAt: null, updatedAt: new Date() })
      .where(and(eq(kitchenViewings.id, current.id), inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']), sql`${kitchenViewings.scheduledAt} <= clock_timestamp()`)).returning();
    if (!expired) return false;
    if (!existing) await queueTourEvent(tx, { kind: 'expired', before: current, after: expired, actorRole: 'automated' });
    return true;
  });
}

/** The 12h stage and 6h-before-start alerts; one event per decision key. */
export async function escalateTourRequest(id: number) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, id),
      inArray(kitchenViewings.status, ['pending_local_cooks', 'pending', 'confirmed']),
      sql`${kitchenViewings.scheduledAt} > clock_timestamp()`)).limit(1).for('update');
    if (!current || !tourRequestEscalationDue(current)) return false;
    const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
      .where(eq(tourDeliveryEvents.eventKey, tourRequestEscalationKey(current))).limit(1);
    if (existing) return false;
    await queueTourEvent(tx, { kind: 'request_escalation', before: current, after: current, actorRole: 'automated' });
    return true;
  });
}

/** Asks both sides for private feedback once the confirmed tour has ended. Returns how many events it queued. */
export async function requestTourFeedback(id: number) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1).for('update');
    if (!current || !tourFeedbackOpen(current)) return 0;
    if (!(await readTourFeedbackStatus(tx, current)).missing) return 0;
    const [requested] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
      .where(eq(tourDeliveryEvents.eventKey, tourFeedbackEventKey(current, 'feedback_requested'))).limit(1);
    if (requested) return 0;
    await queueTourEvent(tx, { kind: 'feedback_requested', before: current, after: current, actorRole: 'automated' });
    await tx.update(kitchenViewings).set({ feedbackRequestedAt: new Date() }).where(eq(kitchenViewings.id, current.id));
    return 1;
  });
}

/** Nobody recorded the result within 24h of the end: the visitor's own private answer decides. Returns the new status, or null if nothing was due. */
export async function closeUnrecordedTour(id: number, now = new Date()) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1).for('update');
    if (!current || !tourFeedbackMissingDue(current, now)) return null;
    const answer = (await readTourFeedbackStatus(tx, current)).current.find(row => row.respondentRole === 'chef' && row.respondentId === current.chefId);
    const happened = answer?.happened === true;
    const status = happened ? 'completed' : 'cancelled';
    const [updated] = await tx.update(kitchenViewings).set({ status, updatedAt: now,
      ...(happened ? { completedAt: now, disruptionReason: null }
        : { disruptionReason: 'outcome_unknown', cancelledBy: 'local_cooks', cancelledAt: now, cancellationReason: null, completedAt: null }),
      noShowAt: null, noShowReason: null, requestedRescheduleAt: null, rescheduleRequestedAt: null, rescheduleProposedSlots: [], rescheduleProposedAt: null,
      outcomeNotificationPending: false,
      outcomeHistory: [...(Array.isArray(current.outcomeHistory) ? current.outcomeHistory : []), { from: current.status, to: status, actorId: null,
        actorRole: 'automated', recordedAt: now.toISOString(), reason: happened ? 'visitor_said_happened' : answer ? 'visitor_said_not_happened' : 'no_visitor_feedback',
        notes: null, sharedNotes: null, disruptionReason: happened ? null : 'outcome_unknown' }] })
      .where(and(eq(kitchenViewings.id, current.id), eq(kitchenViewings.status, 'confirmed'))).returning();
    if (!updated) return null;
    // Only the visitor's "did not happen" reason reaches admins; it is never copied into a field the manager can read.
    await queueTourEvent(tx, { kind: 'status', before: current, after: updated, actorRole: 'automated',
      ...(answer && !happened && answer.reason ? { unrecordedReason: answer.reason } : {}) });
    return status;
  });
}

/** Runs every step that is due for one tour, then arms the timer for the next one. Idempotent; the worker sweep and exact timers both call it. */
export async function advanceTour(id: number, now = new Date()) {
  const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1);
  if (!tour) return { changed: false };
  const t = now.getTime(), start = new Date(tour.scheduledAt).getTime();
  const errors: unknown[] = [];
  let changed = false;
  const step = async (due: boolean, run: () => Promise<unknown>) => {
    if (!due) return;
    try { changed = !!(await run()) || changed; } catch (error) { errors.push(error); logger.error('[Tours] Timed step failed; it will retry', { id, error }); }
  };
  await step(['pending_local_cooks', 'pending'].includes(tour.status) && start <= t, () => expireTourRequest(id));
  await step(start > t && tourRequestEscalationDue(tour, t), () => escalateTourRequest(id));
  await step(tour.status === 'confirmed' && start > t && start - 24 * 3_600_000 <= t, () => queueTourReconfirmation(id));
  await step(tourFeedbackOpen(tour, now), () => requestTourFeedback(id));
  await step(tourFeedbackMissingDue(tour, now), () => closeUnrecordedTour(id, now));
  const [fresh] = changed ? await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1) : [tour];
  scheduleTourTimer(fresh, t);
  if (changed) await attemptTourDelivery(id);
  if (errors.length) throw errors[0];
  return { changed };
}

export async function deliverTourOutcome(viewing: typeof kitchenViewings.$inferSelect, locationName: string) {
  // Move pre-existing pending deliveries to the ledger without changing their outcome.
  await db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, viewing.id),
      eq(kitchenViewings.status, viewing.status), eq(kitchenViewings.updatedAt, viewing.updatedAt), eq(kitchenViewings.outcomeNotificationPending, true))).limit(1).for('update');
    if (!current) return;
    await queueTourEvent(tx, { kind: 'status', before: current, after: current });
    await tx.update(kitchenViewings).set({ outcomeNotificationPending: false }).where(eq(kitchenViewings.id, current.id));
  });
}

/** Backstop sweep: loops the same per-tour steps the exact timers run (advanceTour), so a missed timer only delays the step. */
export async function remindUnrecordedTourOutcomes({ budgetMs = 20_000, maxTours = 20 } = {}): Promise<{ reminded: number; delivered?: number; errors: number }> {
  const result = { reminded: 0, delivered: 0, errors: 0 };
  const deadline = Date.now() + budgetMs;
  const reconfirmation = await queueTourReconfirmations(maxTours, deadline);
  result.reminded += reconfirmation.queued; result.errors += reconfirmation.errors;
  const reviews = await db.select({ id: kitchenViewings.id }).from(kitchenViewings)
    .where(and(eq(kitchenViewings.visitEvidenceState, 'review'), workerAfter('tourEvidence', kitchenViewings.id))).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourEvidence', reviews.length);
  for (const candidate of reviews) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourEvidence', candidate.id);
    try {
      await db.transaction(async tx => {
        const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, candidate.id)).limit(1).for('update');
        if (!tour || tour.visitEvidenceState !== 'review') return;
        const key = `evidence-review:${tour.id}:${tour.visitEvidenceMigratedAt?.toISOString() || 'unknown'}`;
        const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents).where(eq(tourDeliveryEvents.eventKey, key)).limit(1);
        if (!existing) await queueTourEvent(tx, { kind: 'evidence_review', before: tour, after: tour, actorRole: 'automated' });
      });
    } catch (error) { result.errors++; logger.error('[Tours] Visit evidence review could not be queued', error); }
  }
  // Expiry follows the existing confirmation deadline; it never invents attendance or changes reservation state.
  const expired = await db.select({ id: kitchenViewings.id }).from(kitchenViewings)
    .where(and(inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']),
      workerAfter('tourExpiry', kitchenViewings.id),
      sql`${kitchenViewings.scheduledAt} <= CURRENT_TIMESTAMP`)).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourExpiry', expired.length);
  for (const candidate of expired) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourExpiry', candidate.id);
    try { await expireTourRequest(candidate.id); }
    catch (error) { result.errors++; logger.error('[Tours] Request expiry notification could not be queued', error); }
  }
  const urgent = await db.select({ id: kitchenViewings.id }).from(kitchenViewings)
    .where(and(or(inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']),
      and(eq(kitchenViewings.status, 'confirmed'), sql`${kitchenViewings.checkedInAt} IS NULL`, or(sql`${kitchenViewings.requestedRescheduleAt} IS NOT NULL`, sql`jsonb_array_length(${kitchenViewings.rescheduleProposedSlots}) > 0`))),
      workerAfter('tourRequestEscalation', kitchenViewings.id),
      sql`${kitchenViewings.scheduledAt} > CURRENT_TIMESTAMP`,
      or(sql`${kitchenViewings.scheduledAt} <= CURRENT_TIMESTAMP + interval '6 hours'`,
        sql`${kitchenViewings.status} = 'pending_local_cooks' AND ${kitchenViewings.createdAt} <= CURRENT_TIMESTAMP - interval '12 hours'`,
        sql`${kitchenViewings.status} = 'pending' AND jsonb_array_length(${kitchenViewings.rescheduleProposedSlots}) = 0 AND COALESCE(${kitchenViewings.adminReviewedAt}, ${kitchenViewings.createdAt}) <= CURRENT_TIMESTAMP - interval '12 hours'`,
        sql`${kitchenViewings.status} = 'confirmed' AND ${kitchenViewings.requestedRescheduleAt} IS NOT NULL AND ${kitchenViewings.rescheduleRequestedAt} <= CURRENT_TIMESTAMP - interval '12 hours'`))).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourRequestEscalation', urgent.length);
  for (const candidate of urgent) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourRequestEscalation', candidate.id);
    try { if (await escalateTourRequest(candidate.id)) result.reminded++; }
    catch (error) { result.errors++; logger.error('[Tours] Pending request escalation could not be queued', error); }
  }
  const pending = await db.select({ viewing: kitchenViewings, locationName: locations.name }).from(kitchenViewings)
    .innerJoin(locations, eq(kitchenViewings.locationId, locations.id))
    .where(and(workerAfter('tourRecovery', kitchenViewings.id), eq(kitchenViewings.outcomeNotificationPending, true), inArray(kitchenViewings.status, ['completed', 'no_show']))).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourRecovery', pending.length);
  for (const row of pending) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourRecovery', row.viewing.id);
    try { await deliverTourOutcome(row.viewing, row.locationName); }
    catch (error) { result.errors++; logger.error('Tour outcome delivery retry failed', error); }
  }
  const tours = await db.select({ viewing: kitchenViewings, managerId: locations.managerId,
    locationName: locations.name }).from(kitchenViewings)
    .innerJoin(locations, eq(kitchenViewings.locationId, locations.id))
    .where(and(eq(kitchenViewings.status, 'confirmed'),
      workerAfter('tourOutcome', kitchenViewings.id),
      sql`${kitchenViewings.scheduledAt} + ${kitchenViewings.durationMinutes} * interval '1 minute' <= CURRENT_TIMESTAMP`)).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourOutcome', tours.length);
  for (const { viewing } of tours) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourOutcome', viewing.id);
    try {
      const queued = await requestTourFeedback(viewing.id) + (await closeUnrecordedTour(viewing.id) ? 1 : 0);
      result.reminded += queued;
    } catch (error) {
      result.errors++;
      logger.error('[Tours] Failed to queue participant feedback:', error);
    }
  }
  const delivery = await deliverTourEvents(undefined, maxTours, Math.max(0, deadline - Date.now()));
  result.delivered = delivery.delivered; result.errors += delivery.errors;
  return result;
}
