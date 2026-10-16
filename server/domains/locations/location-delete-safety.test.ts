import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const h = vi.hoisted(() => ({ blockers: vi.fn(), history: vi.fn(), statements: [] as string[], apps: [] as any[] }));
vi.mock('../../logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../chat-service', () => ({ deleteConversation: vi.fn(async () => undefined) }));
vi.mock('../../db', () => {
  const run = async (q: any) => { h.statements.push(new PgDialect().sqlToQuery(q).sql); return { rows: [] }; };
  const db: any = {
    select: () => ({ from: () => ({ where: async () => h.apps }) }),
    execute: run,
    transaction: async (fn: any) => fn({ execute: run }),
  };
  return { db };
});
vi.mock('../../services/deletion-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/deletion-guard')>()),
  getDeletionBlockers: h.blockers, hasDeletionHistory: h.history,
}));
import { LocationService } from './location.service';
import { DeletionBlockedError } from '../../services/deletion-guard';

const empty = { total: 0, refs: [] as any[] };
const clear = { upcomingBookings: empty, openClaims: empty, pendingMoney: empty, checkoutIncidents: empty, blocked: false };

function service() {
  const repo: any = { findById: vi.fn(async () => ({ id: 4, name: 'Loc' })), delete: vi.fn(), archive: vi.fn() };
  return new LocationService(repo);
}

describe('location delete safety', () => {
  beforeEach(() => { h.statements.length = 0; h.apps = []; h.blockers.mockReset().mockResolvedValue(clear); h.history.mockReset().mockResolvedValue(false); });

  it('blocks on live bookings or claims without touching a row', async () => {
    h.blockers.mockResolvedValue({ ...clear, blocked: true, openClaims: { total: 1, refs: [{ ref: 'DC-77' }] } });
    const failure = await service().deleteLocation(4).catch(e => e);
    expect(failure).toBeInstanceOf(DeletionBlockedError);
    expect(failure.message).toContain('This location has 1 open damage claim (DC-77)');
    expect(h.statements).toEqual([]);
  });

  it('archives the location and every kitchen when history exists, never deleting', async () => {
    h.history.mockResolvedValue(true);
    expect(await service().deleteLocation(4)).toEqual({ archived: true });
    expect(h.statements.some(s => s.startsWith('UPDATE kitchens SET archived_at'))).toBe(true);
    expect(h.statements.some(s => s.startsWith('UPDATE locations SET archived_at'))).toBe(true);
    expect(h.statements.some(s => /^DELETE/.test(s))).toBe(false);
  });

  it('removes a location with no history, and only manager blocks go with it', async () => {
    expect(await service().deleteLocation(4)).toEqual({ archived: false });
    expect(h.statements[0]).toContain("booking_type = 'manager_blocked'");
    expect(h.statements[1]).toMatch(/^DELETE FROM locations/);
  });
});
