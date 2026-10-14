import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { platformSettings } from '@shared/schema';

export const lifecycleSettings = {
  serviceEndGraceMinutes: { key: 'kitchen_service_end_grace_minutes', defaultValue: 15, min: 0, max: 120 },
  inspectionAutoCloseHours: { key: 'kitchen_inspection_auto_close_hours', defaultValue: 24, min: 1, max: 168 },
  tourPreparationMinuteOfDay: { key: 'tour_preparation_minute_of_day', defaultValue: 420, min: 0, max: 1439 },
  tourArrivalReminderMinutes: { key: 'tour_arrival_reminder_minutes', defaultValue: 60, min: 1, max: 1440 },
  tourDepartureReminderMinutes: { key: 'tour_departure_reminder_minutes', defaultValue: 10, min: 1, max: 120 },
  tourPreparationEnabled: { key: 'tour_preparation_enabled', defaultValue: 1, min: 0, max: 1 },
  tourArrivalEnabled: { key: 'tour_arrival_enabled', defaultValue: 1, min: 0, max: 1 },
  tourDepartureEnabled: { key: 'tour_departure_enabled', defaultValue: 1, min: 0, max: 1 },
  tourOutcomeReminderMinutes: { key: 'tour_outcome_reminder_minutes', defaultValue: 0, min: 0, max: 10080 },
  historicalVisitReviewAfterHours: { key: 'historical_visit_review_after_hours', defaultValue: 48, min: 1, max: 720 },
  preparationReminderHours: { key: 'preparation_reminder_hours', defaultValue: 48, min: 1, max: 168 },
  managerResponseBufferHours: { key: 'manager_response_buffer_hours', defaultValue: 1, min: 0, max: 24 },
  managerDecisionFirstReminderHours: { key: 'manager_decision_first_reminder_hours', defaultValue: 12, min: 1, max: 24 },
  managerDecisionFinalReminderHours: { key: 'manager_decision_final_reminder_hours', defaultValue: 2, min: 1, max: 24 },
  arrivalReminderHours: { key: 'arrival_reminder_hours', defaultValue: 2, min: 1, max: 24 },
  departureReminderMinutes: { key: 'departure_reminder_minutes', defaultValue: 30, min: 1, max: 120 },
  responseWarningHours: { key: 'response_warning_hours', defaultValue: 6, min: 1, max: 168 },
  cancellationWarningHours: { key: 'cancellation_warning_hours', defaultValue: 6, min: 1, max: 168 },
  inspectionWarningPercent: { key: 'inspection_warning_percent', defaultValue: 50, min: 1, max: 99 },
};
type SettingsReader = Pick<typeof db, 'select'>;
export async function getLifecycleSettings(reader: SettingsReader = db) {
  const rows = await reader.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings)
    .where(inArray(platformSettings.key, Object.values(lifecycleSettings).map(setting => setting.key)));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const result = {} as Record<keyof typeof lifecycleSettings, number>;
  for (const name of Object.keys(lifecycleSettings) as Array<keyof typeof lifecycleSettings>) {
    const definition = lifecycleSettings[name];
    const value = Number(values.get(definition.key) ?? definition.defaultValue);
    if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) throw new Error(`Invalid lifecycle setting: ${name}`);
    result[name] = value;
  }
  if (result.preparationReminderHours <= result.arrivalReminderHours)
    throw new Error('Preparation reminder must be earlier than arrival reminder');
  if (result.managerDecisionFirstReminderHours <= result.managerDecisionFinalReminderHours)
    throw new Error('First kitchen decision reminder must be earlier than the final reminder');
  return result;
}
export async function saveLifecycleSettings(input: Record<string, unknown>, adminId: number) {
    const updates: Array<{ key: string; value: string; updatedBy: number; updatedAt: Date }> = [];
  for (const name of Object.keys(lifecycleSettings) as Array<keyof typeof lifecycleSettings>) {
    if (input[name] === undefined) continue;
    const definition = lifecycleSettings[name];
    const value = input[name];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < definition.min || value > definition.max)
      throw new Error(`${name} must be a whole number between ${definition.min} and ${definition.max}`);
    updates.push({ key: definition.key, value: String(value), updatedBy: adminId, updatedAt: new Date() });
  }
  if (!updates.length) throw new Error('No lifecycle settings supplied');
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lifecycle-timing-settings'))`);
    const current = await getLifecycleSettings(tx);
    if (Number(input.managerDecisionFirstReminderHours ?? current.managerDecisionFirstReminderHours) <= Number(input.managerDecisionFinalReminderHours ?? current.managerDecisionFinalReminderHours))
      throw new Error('First kitchen decision reminder must be earlier than the final reminder');
    if (Number(input.preparationReminderHours ?? current.preparationReminderHours) <= Number(input.arrivalReminderHours ?? current.arrivalReminderHours))
      throw new Error('Preparation reminder must be earlier than arrival reminder');
    for (const update of updates) await tx.insert(platformSettings).values(update)
      .onConflictDoUpdate({ target: platformSettings.key, set: update });
  });
  return getLifecycleSettings();
}

/** Finished bookings whose service ended before this instant close silently: state is saved, nobody is emailed.
 * It stops the first closeout sweep announcing every historic booking. When no value has been saved the first
 * closeout run anchors it to that moment, so only bookings finishing after the rollout notify. */
export const closeoutNotificationsFromKey = 'closeout_notifications_from';
type CutoverReader = Pick<typeof db, 'select'>;
async function readCutover(reader: CutoverReader) {
  const [row] = await reader.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, closeoutNotificationsFromKey)).limit(1);
  if (!row) return null;
  const at = new Date(row.value);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid lifecycle setting: closeoutNotificationsFrom');
  return at;
}
/** Read only (admin screens): null until an admin saves one or the first closeout run anchors it. */
export const getSavedCloseoutNotificationsFrom = (reader: CutoverReader = db) => readCutover(reader);
/** Closeout path: returns the cutover, storing `now` once if it has never been set. Safe under concurrent first reads. */
export async function getCloseoutNotificationsFrom(reader: Pick<typeof db, 'select' | 'insert'> = db, now = new Date()) {
  const saved = await readCutover(reader);
  if (saved) return saved;
  await reader.insert(platformSettings).values({ key: closeoutNotificationsFromKey, value: now.toISOString(),
    description: 'Bookings that finished before this instant close silently (no Visit finished or Inspection window closed emails).' })
    .onConflictDoNothing({ target: platformSettings.key });
  return (await readCutover(reader)) ?? now;
}
export async function saveCloseoutNotificationsFrom(input: unknown, adminId: number) {
  if (typeof input !== 'string' || !Number.isFinite(new Date(input).getTime())) throw new Error('closeoutNotificationsFrom must be a date and time');
  const value = new Date(input).toISOString();
  const update = { key: closeoutNotificationsFromKey, value, updatedBy: adminId, updatedAt: new Date() };
  await db.insert(platformSettings).values(update).onConflictDoUpdate({ target: platformSettings.key, set: update });
  return new Date(value);
}
