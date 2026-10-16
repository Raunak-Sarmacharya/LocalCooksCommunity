import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const h = vi.hoisted(() => ({
  user: null as any, statements: [] as Array<{ sql: string; params: unknown[] }>, deleted: [] as unknown[],
  blockers: vi.fn(), history: vi.fn(), purge: vi.fn(), anonymize: vi.fn(), locations: [] as any[],
}));
vi.mock('../../logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/overstay-penalty-service', () => ({ hasChefUnpaidPenalties: async () => false, getChefUnpaidPenalties: async () => [] }));
vi.mock('../../services/damage-claim-service', () => ({ hasChefUnpaidDamageClaims: async () => false, getChefUnpaidDamageClaims: async () => [] }));
vi.mock('../../db', () => {
  const tx: any = {
    select: () => ({ from: (table: any) => ({ where: () => ({ for: async () => (table?.managerId !== undefined ? h.locations : h.user ? [h.user] : []) }) }) }),
    execute: async (q: any) => { h.statements.push(new PgDialect().sqlToQuery(q)); return { rows: [] }; },
    delete: () => ({ where: async () => { h.deleted.push('users'); } }),
  };
  return { db: { transaction: async (fn: any) => fn(tx) } };
});
vi.mock('../../services/deletion-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/deletion-guard')>()),
  getDeletionBlockers: h.blockers, hasDeletionHistory: h.history,
}));
vi.mock('./user-deletion.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./user-deletion.service')>()),
  deleteUserDependents: h.purge, anonymizeUserAccount: h.anonymize,
}));
import { UserService } from './user.service';
import { DeletionBlockedError } from '../../services/deletion-guard';

const empty = { total: 0, refs: [] as any[] };
const clear = { upcomingBookings: empty, openClaims: empty, pendingMoney: empty, checkoutIncidents: empty, blocked: false };
const blocked = { ...clear, blocked: true, upcomingBookings: { total: 1, refs: [{ ref: 'KB-AAA111', detail: '2026-11-02' }] } };
const audit = () => h.statements.find(s => s.sql.includes('INSERT INTO account_deletion_audit'));
const job = () => h.statements.find(s => s.sql.includes('INSERT INTO user_deletion_jobs'));

describe('account deletion safety', () => {
  beforeEach(() => {
    h.statements.length = 0; h.deleted.length = 0; h.locations = [];
    h.user = { id: 9, username: 'chef@example.com', role: 'chef', firebaseUid: 'uid-9' };
    h.blockers.mockReset().mockResolvedValue(clear); h.history.mockReset().mockResolvedValue(false);
    h.purge.mockReset().mockResolvedValue({}); h.anonymize.mockReset().mockResolvedValue({ archivedLocationIds: [], removed: {} });
  });

  it('self-deletion is refused while bookings are upcoming, listing them, and nothing is written', async () => {
    h.blockers.mockResolvedValue(blocked);
    const failure = await new UserService({} as any).deleteUser(9).catch(e => e);
    expect(failure).toBeInstanceOf(DeletionBlockedError);
    expect(failure.message).toContain('This account has 1 upcoming or unfinished booking (KB-AAA111, 2026-11-02)');
    expect(h.purge).not.toHaveBeenCalled(); expect(h.anonymize).not.toHaveBeenCalled(); expect(h.deleted).toEqual([]);
  });

  it('an admin override needs a written reason', async () => {
    h.blockers.mockResolvedValue(blocked);
    await expect(new UserService({} as any).deleteUser(9, { override: { actorId: 1, reason: 'short' } })).rejects.toThrow('written reason');
    expect(h.anonymize).not.toHaveBeenCalled();
  });

  it('an audited override still anonymizes instead of purging history, and records who and why', async () => {
    h.blockers.mockResolvedValue(blocked); h.history.mockResolvedValue(true);
    const outcome = await new UserService({} as any).deleteUser(9, { override: { actorId: 1, reason: 'Owner asked in writing on Oct 15' } });
    expect(outcome).toBe('anonymized');
    expect(h.anonymize).toHaveBeenCalled(); expect(h.purge).not.toHaveBeenCalled(); expect(h.deleted).toEqual([]);
    expect(audit()!.params).toEqual(expect.arrayContaining([1, true, 'Owner asked in writing on Oct 15', 'anonymized']));
  });

  it('keeps history: anonymizes (no row purge, no user delete) and drops location-wide chat clean-up', async () => {
    h.history.mockResolvedValue(true);
    h.user = { ...h.user, role: 'manager' }; h.locations = [{ id: 10 }];
    expect(await new UserService({} as any).deleteUser(9)).toBe('anonymized');
    expect(h.deleted).toEqual([]); expect(h.purge).not.toHaveBeenCalled();
    expect(job()!.params).toContain('[]');
  });

  it('removes an account with no history completely, never purging history tables', async () => {
    h.user = { ...h.user, role: 'manager' }; h.locations = [{ id: 10 }];
    expect(await new UserService({} as any).deleteUser(9)).toBe('deleted');
    expect(h.purge).toHaveBeenCalledWith(expect.anything(), 9, { keepHistory: true });
    expect(h.deleted).toEqual(['users']); expect(job()!.params).toContain('[10]');
  });

  it('is a no-op for an account that was already anonymized (retrying the external clean-up)', async () => {
    h.user = { ...h.user, username: 'deleted-user-9@deleted.localcooks.invalid' };
    expect(await new UserService({} as any).deleteUser(9)).toBe('anonymized');
    expect(h.anonymize).not.toHaveBeenCalled(); expect(h.statements).toEqual([]);
  });
});
