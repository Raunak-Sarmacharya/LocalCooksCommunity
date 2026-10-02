import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { platformSettings } from '@shared/schema';

export const lifecycleSettings = {
  tourOutcomeReminderMinutes: { key: 'tour_outcome_reminder_minutes', defaultValue: 0, min: 0, max: 10080 },
  historicalVisitReviewAfterHours: { key: 'historical_visit_review_after_hours', defaultValue: 48, min: 1, max: 720 },
};
export async function getLifecycleSettings() {
  const rows = await db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings)
    .where(inArray(platformSettings.key, Object.values(lifecycleSettings).map(setting => setting.key)));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const result = {} as Record<keyof typeof lifecycleSettings, number>;
  for (const name of Object.keys(lifecycleSettings) as Array<keyof typeof lifecycleSettings>) {
    const definition = lifecycleSettings[name];
    const value = Number(values.get(definition.key) ?? definition.defaultValue);
    if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) throw new Error(`Invalid lifecycle setting: ${name}`);
    result[name] = value;
  }
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
    for (const update of updates) await tx.insert(platformSettings).values(update)
      .onConflictDoUpdate({ target: platformSettings.key, set: update });
  });
  return getLifecycleSettings();
}
