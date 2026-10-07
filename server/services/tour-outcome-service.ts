import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, locations, tourDeliveryEvents } from '@shared/schema';
import { logger } from '../logger';
import { queueTourEvent, deliverTourEvents } from './tour-delivery-service';
import { tourRequestEscalationDue, tourRequestEscalationKey } from '@shared/tour-request-decision';
import { workerAfter, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
import { queueTourReconfirmations } from './tour-reconfirmation-service';
import { tourFeedbackEventKey, tourFeedbackMissingDue, tourFeedbackOpen } from '@shared/tour-feedback';
import { readTourFeedbackStatus } from './tour-feedback-service';

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

/** Request private participant feedback; elapsed time never establishes a final visit result. */
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
    try {
      await db.transaction(async tx => {
        const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, candidate.id),
          inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']), sql`${kitchenViewings.scheduledAt} <= clock_timestamp()`)).limit(1).for('update');
        if (!current || !['pending_local_cooks', 'pending'].includes(current.status) || new Date(current.scheduledAt).getTime() > Date.now()) return;
        const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
          .where(and(eq(tourDeliveryEvents.viewingId, current.id), sql`${tourDeliveryEvents.payload}->>'kind' = 'expired'`)).limit(1);
        const [expired] = await tx.update(kitchenViewings).set({ status: 'cancelled', requestExpiredAt: current.scheduledAt,
          cancelledAt: current.scheduledAt, cancelledBy: 'request_expired', cancellationReason: null,
          rescheduleProposedSlots: [], rescheduleProposedAt: null, requestedRescheduleAt: null, rescheduleRequestedAt: null, updatedAt: new Date() })
          .where(and(eq(kitchenViewings.id, current.id), inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']), sql`${kitchenViewings.scheduledAt} <= clock_timestamp()`)).returning();
        if (!expired) return;
        if (!existing) await queueTourEvent(tx, { kind: 'expired', before: current, after: expired, actorRole: 'automated' });
      });
    } catch (error) { result.errors++; logger.error('[Tours] Request expiry notification could not be queued', error); }
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
    try {
      const queued = await db.transaction(async tx => {
        const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, candidate.id),
          inArray(kitchenViewings.status, ['pending_local_cooks', 'pending', 'confirmed']),
          sql`${kitchenViewings.scheduledAt} > clock_timestamp()`,
          )).limit(1).for('update');
        if (!current || !tourRequestEscalationDue(current)) return false;
        const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
          .where(eq(tourDeliveryEvents.eventKey, tourRequestEscalationKey(current))).limit(1);
        if (existing) return false;
        await queueTourEvent(tx, { kind: 'request_escalation', before: current, after: current, actorRole: 'automated' });
        return true;
      });
      if (queued) result.reminded++;
    } catch (error) { result.errors++; logger.error('[Tours] Pending request escalation could not be queued', error); }
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
      const queued = await db.transaction(async tx => {
        const [current] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, viewing.id)).limit(1).for('update');
        if (!current || !tourFeedbackOpen(current)) return 0;
        const feedback = await readTourFeedbackStatus(tx, current);
        if (!feedback.missing) return 0;
        let queued = 0;
        const [requested] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
          .where(eq(tourDeliveryEvents.eventKey, tourFeedbackEventKey(current, 'feedback_requested'))).limit(1);
        if (!requested) {
          await queueTourEvent(tx, { kind: 'feedback_requested', before: current, after: current, actorRole: 'automated' });
          await tx.update(kitchenViewings).set({ feedbackRequestedAt: new Date() }).where(eq(kitchenViewings.id, current.id));
          queued++;
        }
        if (tourFeedbackMissingDue(current)) {
          const [escalated] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
            .where(eq(tourDeliveryEvents.eventKey, tourFeedbackEventKey(current, 'feedback_missing'))).limit(1);
          if (!escalated) {
            await queueTourEvent(tx, { kind: 'feedback_missing', before: current, after: current, actorRole: 'automated' });
            await tx.update(kitchenViewings).set({ feedbackEscalatedAt: new Date() }).where(eq(kitchenViewings.id, current.id));
            queued++;
          }
        }
        return queued;
      });
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
