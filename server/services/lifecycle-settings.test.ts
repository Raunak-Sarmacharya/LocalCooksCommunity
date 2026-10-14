import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], writes: [] as any[], transactionCalls: 0 }));
vi.mock('../db', () => {
 const select = () => ({ from: () => ({ where: () => Object.assign(Promise.resolve(state.rows), { limit: async () => state.rows.slice(0, 1) }) }) });
 const insert = () => ({ values: (value: any) => { state.writes.push(value); return {
  onConflictDoNothing: async () => { state.rows.push(value); }, onConflictDoUpdate: async () => { state.rows = [value]; } }; } });
 return { db: {
  select, insert,
  transaction: async (fn: any) => { state.transactionCalls++; return fn({ select, execute: async () => undefined, insert: () => ({ values: (value: any) => {
    state.writes.push(value); return { onConflictDoUpdate: async () => undefined }; } }) }); },
} }; });
import { getLifecycleSettings, saveLifecycleSettings, getCloseoutNotificationsFrom, getSavedCloseoutNotificationsFrom, saveCloseoutNotificationsFrom } from './lifecycle-settings';
describe('admin lifecycle settings', () => {
  beforeEach(() => { state.rows = []; state.writes = []; state.transactionCalls = 0; });
  it('supplies editable defaults when no setting has been saved', async () => {
    expect(await getLifecycleSettings()).toEqual({ serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, tourOutcomeReminderMinutes: 0, historicalVisitReviewAfterHours: 48,
      preparationReminderHours: 48, arrivalReminderHours: 2, departureReminderMinutes: 30,
      tourPreparationMinuteOfDay: 420, tourArrivalReminderMinutes: 60, tourDepartureReminderMinutes: 10, tourPreparationEnabled: 1, tourArrivalEnabled: 1, tourDepartureEnabled: 1,
      responseWarningHours: 6, cancellationWarningHours: 6, inspectionWarningPercent: 50 });
  });
  it('bounds the closeout timers and rejects out-of-range values before writing', async () => {
    await expect(saveLifecycleSettings({ serviceEndGraceMinutes: 121 }, 2)).rejects.toThrow();
    await expect(saveLifecycleSettings({ inspectionAutoCloseHours: 0 }, 2)).rejects.toThrow();
    expect(state.transactionCalls).toBe(0); expect(state.writes).toEqual([]);
  });
  it('uses saved admin values', async () => {
    state.rows = [{ key: 'tour_outcome_reminder_minutes', value: '90' }, { key: 'historical_visit_review_after_hours', value: '72' }];
    expect(await getLifecycleSettings()).toMatchObject({ tourOutcomeReminderMinutes: 90, historicalVisitReviewAfterHours: 72 });
  });
  it('rejects invalid combined updates before writing any setting', async () => {
    await expect(saveLifecycleSettings({ tourOutcomeReminderMinutes: 20, historicalVisitReviewAfterHours: 1.5 }, 2)).rejects.toThrow(/whole number/);
    expect(state.transactionCalls).toBe(0); expect(state.writes).toEqual([]);
  });
  it('records who changed the setting', async () => {
    await saveLifecycleSettings({ tourOutcomeReminderMinutes: 20 }, 2);
    expect(state.writes[0]).toMatchObject({ key: 'tour_outcome_reminder_minutes', value: '20', updatedBy: 2 });
  });
  it('validates combined lead times against saved values before any write', async () => {
    state.rows = [{ key: 'arrival_reminder_hours', value: '4' }];
    await expect(saveLifecycleSettings({ preparationReminderHours: 3 }, 2)).rejects.toThrow(/earlier/);
    expect(state.writes).toEqual([]);
    await expect(saveLifecycleSettings({ departureReminderMinutes: 0 }, 2)).rejects.toThrow(/whole number/);
    expect(state.writes).toEqual([]);
  });
});

it('validates and persists independent tour controls with admin audit', async () => {
  await saveLifecycleSettings({ tourPreparationMinuteOfDay: 480, tourArrivalReminderMinutes: 90, tourDepartureReminderMinutes: 15, tourArrivalEnabled: 0 }, 2);
  expect(state.writes.map(({key, value}) => [key, value])).toEqual([
    ['tour_preparation_minute_of_day', '480'], ['tour_arrival_reminder_minutes', '90'], ['tour_departure_reminder_minutes', '15'], ['tour_arrival_enabled', '0'],
  ]);
  expect(state.writes.every(row => row.updatedBy === 2)).toBe(true);
  await expect(saveLifecycleSettings({ tourPreparationMinuteOfDay: 1440 }, 2)).rejects.toThrow();
  await expect(saveLifecycleSettings({ tourDepartureEnabled: 2 }, 2)).rejects.toThrow();
});

describe('closeout notification cutover', () => {
  beforeEach(() => { state.rows = []; state.writes = []; });
  it('anchors an unset cutover to the first closeout run, once', async () => {
    expect(await getSavedCloseoutNotificationsFrom()).toBeNull();
    const first = await getCloseoutNotificationsFrom(undefined, new Date('2026-10-14T12:00:00Z'));
    expect(first.toISOString()).toBe('2026-10-14T12:00:00.000Z');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ key: 'closeout_notifications_from', value: '2026-10-14T12:00:00.000Z' });
    // A later run keeps the anchor instead of moving it.
    expect((await getCloseoutNotificationsFrom(undefined, new Date('2026-10-20T00:00:00Z'))).toISOString()).toBe('2026-10-14T12:00:00.000Z');
    expect(state.writes).toHaveLength(1);
  });
  it('uses the saved admin value and rejects a corrupt one', async () => {
    state.rows = [{ value: '2026-11-01T09:00:00.000Z' }];
    expect((await getCloseoutNotificationsFrom()).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    state.rows = [{ value: 'garbage' }];
    await expect(getCloseoutNotificationsFrom()).rejects.toThrow(/closeoutNotificationsFrom/);
  });
  it('validates and records the admin cutover', async () => {
    await expect(saveCloseoutNotificationsFrom('not a date', 2)).rejects.toThrow(/date and time/);
    await expect(saveCloseoutNotificationsFrom(undefined, 2)).rejects.toThrow();
    expect(state.writes).toEqual([]);
    expect((await saveCloseoutNotificationsFrom('2026-11-01T09:00:00Z', 2)).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(state.writes[0]).toMatchObject({ key: 'closeout_notifications_from', value: '2026-11-01T09:00:00.000Z', updatedBy: 2 });
  });
});
