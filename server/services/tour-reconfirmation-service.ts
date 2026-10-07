import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, locations, tourDeliveryEvents } from '@shared/schema';
import { tourReconfirmation, tourReconfirmationEventKey } from '@shared/tour-reconfirmation';
import { queueTourEvent } from './tour-delivery-service';
import { workerAfter, workerPageEnd, workerRecord } from './worker-context';

/** Soft responses never release an appointment. Uses the existing tour outbox and row lock. */
export async function queueTourReconfirmations(maxTours = 20, deadline = Date.now() + 5000) {
  const candidates = await db.select({ id: kitchenViewings.id }).from(kitchenViewings)
    .where(and(workerAfter('tourReconfirmation', kitchenViewings.id), eq(kitchenViewings.status, 'confirmed'), sql`${kitchenViewings.checkedInAt} IS NULL`,
      sql`${kitchenViewings.scheduledAt} > CURRENT_TIMESTAMP`, sql`${kitchenViewings.scheduledAt} <= CURRENT_TIMESTAMP + interval '24 hours'`))
    .orderBy(kitchenViewings.id).limit(maxTours);
  let queued = 0, errors = 0;
  await workerPageEnd('tourReconfirmation', candidates.length);
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    await workerRecord('tourReconfirmation', candidate.id);
    try { await db.transaction(async tx => {
      const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, candidate.id)).limit(1).for('update');
      if (!tour) return;
      const [location] = await tx.select({ managerId: locations.managerId }).from(locations).where(eq(locations.id, tour.locationId)).limit(1).for('share');
      const state = tourReconfirmation(tour, location?.managerId || null);
      if (!state.canReply) return;
      for (const kind of ['reconfirmation_requested', 'reconfirmation_escalated', 'reconfirmation_reminder'] as const) {
        if (kind === 'reconfirmation_requested' ? state.reply !== null : kind === 'reconfirmation_reminder' ? !state.needsVisitorReminder : !state.needsStaffAttention) continue;
        if (kind === 'reconfirmation_reminder') {
          const [ask] = await tx.select({ completedAt: tourDeliveryEvents.completedAt }).from(tourDeliveryEvents)
            .where(eq(tourDeliveryEvents.eventKey, tourReconfirmationEventKey(tour, location?.managerId || null, 'reconfirmation_requested'))).limit(1);
          // A delayed first delivery must not be followed immediately by another ask.
          if (!ask?.completedAt || Date.now() - new Date(ask.completedAt).getTime() < 3600000) continue;
        }
        const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
          .where(eq(tourDeliveryEvents.eventKey, tourReconfirmationEventKey(tour, location?.managerId || null, kind))).limit(1);
        if (existing) continue;
        await queueTourEvent(tx, { kind, before: tour, after: { ...tour, managerId: location?.managerId || null }, actorRole: 'automated' });
        queued++;
      }
    }); } catch { errors++; }
  }
  return { queued, errors };
}
