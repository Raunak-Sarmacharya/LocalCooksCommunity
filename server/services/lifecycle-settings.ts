import { inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { platformSettings } from '@shared/schema';

export const lifecycleSettings = {
  tourPreparationMinuteOfDay: { key: 'tour_preparation_minute_of_day', defaultValue: 420, min: 0, max: 1439 },
  tourArrivalReminderMinutes: { key: 'tour_arrival_reminder_minutes', defaultValue: 60, min: 1, max: 1440 },
  tourDepartureReminderMinutes: { key: 'tour_departure_reminder_minutes', defaultValue: 10, min: 1, max: 120 },
  tourPreparationEnabled: { key: 'tour_preparation_enabled', defaultValue: 1, min: 0, max: 1 },
  tourArrivalEnabled: { key: 'tour_arrival_enabled', defaultValue: 1, min: 0, max: 1 },
  tourDepartureEnabled: { key: 'tour_departure_enabled', defaultValue: 1, min: 0, max: 1 },
  tourOutcomeReminderMinutes: { key: 'tour_outcome_reminder_minutes', defaultValue: 0, min: 0, max: 10080 },
  historicalVisitReviewAfterHours: { key: 'historical_visit_review_after_hours', defaultValue: 48, min: 1, max: 720 },
  preparationReminderHours: { key: 'preparation_reminder_hours', defaultValue: 24, min: 1, max: 168 },
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
    if (Number(input.preparationReminderHours ?? current.preparationReminderHours) <= Number(input.arrivalReminderHours ?? current.arrivalReminderHours))
      throw new Error('Preparation reminder must be earlier than arrival reminder');
    for (const update of updates) await tx.insert(platformSettings).values(update)
      .onConflictDoUpdate({ target: platformSettings.key, set: update });
  });
  return getLifecycleSettings();
}
