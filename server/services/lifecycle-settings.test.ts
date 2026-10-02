import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], writes: [] as any[], transactionCalls: 0 }));
vi.mock('../db', () => ({ db: {
  select: () => ({ from: () => ({ where: async () => state.rows }) }),
  transaction: async (fn: any) => { state.transactionCalls++; return fn({ insert: () => ({ values: (value: any) => {
    state.writes.push(value); return { onConflictDoUpdate: async () => undefined }; } }) }); },
} }));
import { getLifecycleSettings, saveLifecycleSettings } from './lifecycle-settings';
describe('admin lifecycle settings', () => {
  beforeEach(() => { state.rows = []; state.writes = []; state.transactionCalls = 0; });
  it('supplies editable defaults when no setting has been saved', async () => {
    expect(await getLifecycleSettings()).toEqual({ tourOutcomeReminderMinutes: 0, historicalVisitReviewAfterHours: 48 });
  });
  it('uses saved admin values', async () => {
    state.rows = [{ key: 'tour_outcome_reminder_minutes', value: '90' }, { key: 'historical_visit_review_after_hours', value: '72' }];
    expect(await getLifecycleSettings()).toEqual({ tourOutcomeReminderMinutes: 90, historicalVisitReviewAfterHours: 72 });
  });
  it('rejects invalid combined updates before writing any setting', async () => {
    await expect(saveLifecycleSettings({ tourOutcomeReminderMinutes: 20, historicalVisitReviewAfterHours: 1.5 }, 2)).rejects.toThrow(/whole number/);
    expect(state.transactionCalls).toBe(0); expect(state.writes).toEqual([]);
  });
  it('records who changed the setting', async () => {
    await saveLifecycleSettings({ tourOutcomeReminderMinutes: 20 }, 2);
    expect(state.writes[0]).toMatchObject({ key: 'tour_outcome_reminder_minutes', value: '20', updatedBy: 2 });
  });
});
