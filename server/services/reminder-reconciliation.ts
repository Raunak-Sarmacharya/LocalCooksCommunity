import { sql } from 'drizzle-orm';
import { db } from '../db';
import { scheduleAdvanceReminders, type ReminderSource } from './advance-reminders';
import { workerRecord, workerPageEnd, isWorkerBudgetError } from './worker-context';
import { logger } from '../logger';

// Fixed source inventory; neither table names nor predicates come from a request.
export const reminderSources: ReminderSource[] = ['booking', 'tour', 'claim', 'penalty', 'booking_review',
  'storage_review', 'cancellation_review', 'storage_cancellation_review', 'storage_arrival'];
const currentSource: Record<ReminderSource, string> = {
  booking: "SELECT id FROM kitchen_bookings WHERE status = 'confirmed'",
  tour: "SELECT id FROM kitchen_viewings WHERE status = 'confirmed' OR (checked_in_at IS NOT NULL AND checked_out_at IS NULL)",
  claim: "SELECT id FROM damage_claims WHERE status = 'submitted'",
  penalty: "SELECT id FROM storage_overstay_records WHERE status = 'penalty_approved'",
  booking_review: "SELECT id FROM kitchen_bookings WHERE status = 'confirmed'",
  storage_review: "SELECT id FROM storage_bookings WHERE checkout_status = 'checkout_requested'",
  cancellation_review: "SELECT id FROM kitchen_bookings WHERE status = 'cancellation_requested'",
  storage_cancellation_review: "SELECT id FROM storage_bookings WHERE status = 'cancellation_requested'",
  storage_arrival: "SELECT id FROM storage_bookings WHERE status = 'confirmed' AND checkin_status = 'not_checked_in'",
};
export function reminderDiscoveryQuery(source: ReminderSource, after: number, limit: number) {
  if (!reminderSources.includes(source) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw Error('Invalid discovery page');
  return sql`SELECT id FROM (${sql.raw(currentSource[source])}
    UNION SELECT (text_body::jsonb->'reminder'->>'reservationId')::integer AS id
      FROM email_logs WHERE category = 'advance_reminder' AND tracking_id LIKE ${`advance:${source}:%`}
    ) sources WHERE id > ${after} ORDER BY id LIMIT ${limit}`;
}
export async function reconcileRecurringSource(source: ReminderSource, after: number, limit = 3) {
  const key = `reconcile:${source}`;
  const result = await db.execute(reminderDiscoveryQuery(source, after, limit));
  await workerPageEnd(key, result.rows.length);
  let errors = 0;
  for (const row of result.rows) {
    const id = Number(row.id);
    await workerRecord(key, id);
    try { await db.transaction(tx => scheduleAdvanceReminders(tx, source, id)); }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      errors++;
      logger.error('[Reminders] Source record needs recovery', { source, id, error });
    }
  }
  return { reconciled: result.rows.length - errors, errors };
}
