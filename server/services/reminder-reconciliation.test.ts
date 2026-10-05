import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ execute: vi.fn(), schedule: vi.fn(), transactions: [] as any[] }));
vi.mock('../db', () => ({ db: { execute: state.execute, transaction: async (run: any) => {
  const tx = { isolated: true }; state.transactions.push(tx); return run(tx);
} } }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: state.schedule }));
import { reminderDiscoveryQuery, reminderSources, reconcileRecurringSource } from './reminder-reconciliation';
import { workerContext } from './worker-context';
beforeEach(() => { vi.clearAllMocks(); state.transactions = []; });
describe('current and prior scheduled source discovery', () => {
  it('queries every supported current source plus previous schedule IDs using a finite ordered keyset page', () => {
    const dialect = new PgDialect();
    for (const source of reminderSources) {
      const query = dialect.sqlToQuery(reminderDiscoveryQuery(source, 7, 3));
      expect(query.sql).toContain('UNION SELECT'); expect(query.sql).toContain("category = 'advance_reminder'");
      expect(query.sql).toContain('ORDER BY id LIMIT'); expect(query.params).toEqual([`advance:${source}:%`, 7, 3]);
    }
    expect(() => reminderDiscoveryQuery('booking', 0, 51)).toThrow();
  });
  it('checkpoints each discovered current/obsolete ID before its transaction and resets an empty sweep', async () => {
    state.execute.mockResolvedValueOnce({ rows: [{ id: 8 }, { id: 9 }] }).mockResolvedValueOnce({ rows: [] });
    const saved: number[] = [], cursors: Record<string, number> = {};
    const deadline = performance.now() + 26_000;
    await workerContext.run({ database: {} as any, deadline, taskDeadline: deadline, cursors,
      checkpoint: async (key, id) => { saved.push(id); cursors[key] = id; } }, async () => {
      await reconcileRecurringSource('booking', 7); await reconcileRecurringSource('booking', 9);
    });
    expect(saved).toEqual([8, 9, 0]);
    expect(state.schedule.mock.calls.map(call => [call[1], call[2]])).toEqual([['booking', 8], ['booking', 9]]);
    expect(state.schedule.mock.calls.every(call => state.transactions.includes(call[0]))).toBe(true);
  });
});

it('discovers terminal tours with outstanding departure in the real SQL contract and continues past a poison record', async () => {
  const query = new PgDialect().sqlToQuery(reminderDiscoveryQuery('tour', 0, 3));
  expect(query.sql).toContain('checked_in_at IS NOT NULL AND checked_out_at IS NULL');
  state.execute.mockResolvedValue({ rows: [{ id: 8 }, { id: 9 }] });
  state.schedule.mockRejectedValueOnce(Error('bad tour evidence')).mockResolvedValueOnce(undefined);
  expect(await reconcileRecurringSource('tour', 0)).toEqual({ reconciled: 1, errors: 1 });
  expect(state.schedule.mock.calls.map(call => call[2])).toEqual([8, 9]);
});
