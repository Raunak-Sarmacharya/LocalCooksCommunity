import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, locations, tourDeliveryEvents } from '@shared/schema';
import { logger } from '../logger';
import { getLifecycleSettings } from './lifecycle-settings';
import { queueTourEvent, deliverTourEvents } from './tour-delivery-service';
import { workerAfter, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';

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

/** Remind people to confirm attendance; elapsed time never proves attendance. */
export async function remindUnrecordedTourOutcomes({ budgetMs = 20_000, maxTours = 20 } = {}): Promise<{ reminded: number; delivered?: number; errors: number }> {
  const result = { reminded: 0, delivered: 0, errors: 0 };
  const deadline = Date.now() + budgetMs;
  // Expiry follows the existing confirmation deadline; it never invents attendance or changes reservation state.
  const expired = await db.select({ id: kitchenViewings.id }).from(kitchenViewings)
    .where(and(inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']),
      workerAfter('tourExpiry', kitchenViewings.id),
      sql`${kitchenViewings.scheduledAt} <= CURRENT_TIMESTAMP`,
      sql`NOT EXISTS (SELECT 1 FROM tour_delivery_events WHERE viewing_id = ${kitchenViewings.id} AND payload->>'kind' = 'expired')`)).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourExpiry', expired.length);
  for (const candidate of expired) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourExpiry', candidate.id);
    try {
      await db.transaction(async tx => {
        const [current] = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.id, candidate.id),
          inArray(kitchenViewings.status, ['pending_local_cooks', 'pending']), sql`${kitchenViewings.scheduledAt} <= clock_timestamp()`)).limit(1).for('update');
        if (!current) return;
        const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
          .where(and(eq(tourDeliveryEvents.viewingId, current.id), sql`${tourDeliveryEvents.payload}->>'kind' = 'expired'`)).limit(1);
        if (!existing) await queueTourEvent(tx, { kind: 'expired', before: current, after: current, actorRole: 'automated' });
      });
    } catch (error) { result.errors++; logger.error('[Tours] Request expiry notification could not be queued', error); }
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
  const settings = await getLifecycleSettings();
  const tours = await db.select({ viewing: kitchenViewings, managerId: locations.managerId,
    locationName: locations.name }).from(kitchenViewings)
    .innerJoin(locations, eq(kitchenViewings.locationId, locations.id))
    .where(and(eq(kitchenViewings.status, 'confirmed'),
      workerAfter('tourOutcome', kitchenViewings.id),
      isNull(kitchenViewings.outcomeReminderSentAt),
      sql`${kitchenViewings.scheduledAt} + (${kitchenViewings.durationMinutes} + ${settings.tourOutcomeReminderMinutes}) * interval '1 minute' <= CURRENT_TIMESTAMP`)).orderBy(kitchenViewings.id).limit(maxTours);
  await workerPageEnd('tourOutcome', tours.length);
  for (const { viewing, managerId, locationName } of tours) {
    if (deadline - Date.now() < (inRecurringWorker() ? 1_000 : 5_000)) break;
    await workerRecord('tourOutcome', viewing.id);
    try {
      const queued = await db.transaction(async tx => {
        const [claimed] = await tx.update(kitchenViewings).set({ outcomeReminderSentAt: new Date() })
          .where(and(eq(kitchenViewings.id, viewing.id), eq(kitchenViewings.status, 'confirmed'),
            isNull(kitchenViewings.outcomeReminderSentAt))).returning();
        if (!claimed) return false;
        await queueTourEvent(tx, { kind: 'reminder', before: claimed, after: claimed });
        return true;
      });
      if (queued) result.reminded++;
    } catch (error) {
      result.errors++;
      logger.error('[Tours] Failed to send outcome reminder:', error);
    }
  }
  const delivery = await deliverTourEvents(undefined, maxTours, Math.max(0, deadline - Date.now()));
  result.delivered = delivery.delivered; result.errors += delivery.errors;
  return result;
}
