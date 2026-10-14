import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({
  rows: [] as any[], owner: { managerId: 2, status: 'confirmed' } as any, context: {} as any, parent: {} as any,
  visitWrites: [] as any[], queue: vi.fn(), capture: vi.fn(), checkin: vi.fn(), nextId: 1,
}));

const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const dialect = new PgDialect();
vi.mock('../db', async () => {
  const schema = await import('@shared/schema');
  const render = (condition: any) => dialect.sqlToQuery(condition);
  const chain = (rows: (table: any) => any[]) => { let from: any; const q: any = { from: (table: any) => { from = table; return q; }, innerJoin: () => q, where: () => q,
    orderBy: () => q, limit: () => q, then: (ok: any, bad: any) => Promise.resolve(rows(from)).then(ok, bad) }; return q; };
  const db: any = {
    select: (projection?: any) => chain(table => table === schema.kitchenVisitArrivalChallenges ? state.rows : !projection ? [] : projection.visit ? [state.context]
      : 'selectedSlots' in projection ? [{ startTime: '09:00', endTime: '11:00', selectedSlots: null, operatingWindowStartTime: null }]
      : 'managerId' in projection ? [state.owner] : 'updatedAt' in projection ? [state.parent] : [{}]),
    execute: async (query: any) => {
      const { sql: text, params } = render(query);
      if (!text.includes('kitchen_visit_arrival_challenges')) return { rows: [] };
      const found = state.rows.filter(row => text.includes('target_key') ? row.targetKey === params[0] : row.bookingId === params[0]);
      return { rows: found.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [snake(key), value]))) };
    },
    insert: (table: any) => ({ values: (values: any) => {
      const run = async () => {
        if (table !== schema.kitchenVisitArrivalChallenges) return [];
        const created: any[] = [];
        for (const value of [].concat(values)) {
          if (state.rows.some(row => row.targetKey === (value as any).targetKey)) continue;
          const row = { id: state.nextId++, visitId: null, failedAttempts: 0, lockedAt: null, consumedAt: null, consumedMethod: null,
            consumedByUserId: null, consumedRequestKey: null, revokedAt: null, revokedReason: null, modeChangedAt: null,
            modeReason: null, issuedAt: new Date(), ...(value as any) };
          state.rows.push(row); created.push({ id: row.id });
        }
        return created;
      };
      return { onConflictDoNothing: () => ({ returning: run, then: (ok: any, bad: any) => run().then(ok, bad) }) };
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: (condition: any) => { const run = async () => {
      if (table === schema.kitchenBookingVisits) { state.visitWrites.push(values); return [{ id: 5 }]; }
      if (table !== schema.kitchenVisitArrivalChallenges) { state.visitWrites.push(values); return [{ id: 1 }]; }
      const { sql: text, params } = render(condition);
      const byBooking = text.includes('"booking_id"');
      const targets = state.rows.filter(row => (byBooking ? row.bookingId === params[0] : row.id === params[0])
        && (!text.includes('"revision"') || row.revision === params[1])
        && (!text.includes('"consumed_at" is null') || !row.consumedAt)
        && (!text.includes('"revoked_at" is null') || !row.revokedAt)
        && (!text.includes('"locked_at" is null') || !row.lockedAt));
      for (const row of targets) {
        for (const [key, value] of Object.entries(values)) {
          if (value && typeof value === 'object' && 'queryChunks' in (value as any)) continue;
          row[key] = value;
        }
        if (values.failedAttempts && typeof values.failedAttempts === 'object') {
          row.failedAttempts += 1;
          if (row.failedAttempts >= 5) row.lockedAt = new Date();
        }
      }
      return targets.map(row => ({ id: row.id, failedAttempts: row.failedAttempts }));
    }; return { returning: run, then: (ok: any, bad: any) => run().then(ok, bad) }; } }) }),
  };
  db.transaction = async (run: any) => {
    const snapshot = structuredClone(state.rows);
    try { return await run(db); } catch (error) { state.rows.splice(0, state.rows.length, ...snapshot); throw error; }
  };
  return { db };
});
vi.mock('./visit-duties', () => ({ kitchenDuties: async () => ({ version: 1, checkinWindowMinutesBefore: 15 }),
  currentKitchenDuties: async () => ({ arrival: { enabled: false, items: [], photos: [] } }),
  validateCurrentKitchenSubmission: vi.fn(async () => {}), captureKitchenDuties: state.capture }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./kitchen-checkout-service', () => ({ sendCheckinNotification: state.checkin,
  sendCheckoutRequestNotification: vi.fn(), sendCheckoutClearedNotification: vi.fn() }));
vi.mock('./kitchen-booking-visits', () => ({ ensureKitchenBookingVisits: vi.fn() }));
vi.mock('./checkin-checkout-checklist', () => ({}));
vi.mock('./lifecycle-settings', () => ({}));
vi.mock('./worker-context', () => ({ inRecurringWorker: () => false }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import * as vc from './visit-code-challenge';
import { checkinKitchenVisit } from './kitchen-visit-lifecycle';

const SECRET = 'unit-test-secret-unit-test-secret-0123456789';
const target = { bookingId: 10, visitId: 5, chefId: 3 };
const challenge = (over: any = {}) => ({ id: 1, bookingId: 10, visitId: 5, targetKey: 'visit:5', mode: 'staffed', revision: 1, keyVersion: 1,
  nonce: 'nonce-a', failedAttempts: 0, lockedAt: null, issuedByUserId: 2, issuedAt: new Date('2026-10-01T00:00:00Z'),
  modeChangedByUserId: null, modeChangedAt: null, modeReason: null, consumedAt: null, consumedMethod: null, consumedByUserId: null,
  consumedRequestKey: null, revokedAt: null, revokedReason: null, ...over });
const codeOf = (row = state.rows[0]) => vc.deriveVisitCode(row);
const wrongOf = () => (codeOf() === '000000' ? '000001' : '000000');
const sentinel = () => JSON.stringify(state.rows[0]);

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T16:30:00Z'));
  process.env.VISIT_CODE_HMAC_SECRET = SECRET; delete process.env.VISIT_CODE_HMAC_KEY_VERSION;
  state.rows = [challenge()]; state.nextId = 2; state.owner = { managerId: 2, status: 'confirmed' }; state.visitWrites = [];
  state.context = { timezone: 'America/Vancouver', locationId: 4, managerId: 2,
    booking: { id: 10, chefId: 3, status: 'confirmed', bookingDate: new Date('2026-10-02T00:00:00Z'), startTime: '09:00', endTime: '17:00',
      operatingWindowStartTime: '08:00', updatedAt: new Date('2026-10-01T00:00:00Z'), visitDuties: null },
    visit: { id: 5, bookingId: 10, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in' } };
  state.parent = { status: 'confirmed', updatedAt: state.context.booking.updatedAt };
});
afterEach(() => { vi.useRealTimers(); delete process.env.VISIT_CODE_HMAC_SECRET; delete process.env.VISIT_CODE_HMAC_SECRET_V1;
  delete process.env.VISIT_CODE_HMAC_KEY_VERSION; });

describe('derivation and verification', () => {
  const base = { targetKey: 'visit:5', revision: 1, nonce: 'abc', keyVersion: 1 };
  it('is deterministic, six digits and zero padded', () => {
    expect(vc.deriveVisitCode(base)).toBe(vc.deriveVisitCode({ ...base }));
    for (let i = 0; i < 200; i++) expect(vc.deriveVisitCode({ ...base, nonce: `n${i}` })).toMatch(/^\d{6}$/);
  });
  it('changes with revision, nonce, target and key', () => {
    const original = vc.deriveVisitCode(base);
    expect(vc.deriveVisitCode({ ...base, revision: 2 })).not.toBe(original);
    expect(vc.deriveVisitCode({ ...base, nonce: 'abd' })).not.toBe(original);
    expect(vc.deriveVisitCode({ ...base, targetKey: 'visit:6' })).not.toBe(original);
    process.env.VISIT_CODE_HMAC_KEY_VERSION = '2'; process.env.VISIT_CODE_HMAC_SECRET_V1 = SECRET;
    process.env.VISIT_CODE_HMAC_SECRET = 'a-different-current-secret-a-different-secret';
    expect(vc.deriveVisitCode(base)).toBe(original); // old key version still reads V1
    expect(vc.deriveVisitCode({ ...base, keyVersion: 2 })).not.toBe(original);
  });
  it('verifies exact codes only and never throws on a length mismatch', () => {
    const code = vc.deriveVisitCode(base);
    expect(vc.verifyVisitCode(base, code)).toBe(true);
    expect(vc.verifyVisitCode(base, code === '123456' ? '123457' : '123456')).toBe(false);
    expect(vc.verifyVisitCode(base, '12345')).toBe(false);
  });
  it('names the missing variable but never a value', () => {
    delete process.env.VISIT_CODE_HMAC_SECRET;
    expect(() => vc.deriveVisitCode(base)).toThrow('VISIT_CODE_HMAC_SECRET is not configured');
    process.env.VISIT_CODE_HMAC_SECRET = 'short-secret-value';
    let message = ''; try { vc.deriveVisitCode(base); } catch (error: any) { message = error.message; }
    expect(message).toContain('VISIT_CODE_HMAC_SECRET'); expect(message).not.toContain('short-secret-value');
  });
});

describe('attempts and lockout', () => {
  it('counts wrong codes in a committed write even though arrival is rejected', async () => {
    await expect(vc.verifyArrivalCode({ ...target, visitCode: wrongOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_WRONG', attemptsLeft: 4 });
    expect(state.rows[0].failedAttempts).toBe(1);
  });
  it('locks at five wrong codes and stays locked for the correct code', async () => {
    for (let i = 0; i < 4; i++) await expect(vc.verifyArrivalCode({ ...target, visitCode: wrongOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_WRONG' });
    await expect(vc.verifyArrivalCode({ ...target, visitCode: wrongOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_LOCKED' });
    expect(state.rows[0].failedAttempts).toBe(5); expect(state.rows[0].lockedAt).toBeTruthy();
    await expect(vc.verifyArrivalCode({ ...target, visitCode: codeOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_LOCKED' });
    expect(state.rows[0].failedAttempts).toBe(5);
  });
  it('requires a code without counting a missing or malformed entry', async () => {
    await expect(vc.verifyArrivalCode({ ...target })).rejects.toMatchObject({ code: 'VISIT_CODE_REQUIRED' });
    await expect(vc.verifyArrivalCode({ ...target, visitCode: '12ab56' })).rejects.toMatchObject({ code: 'VISIT_CODE_REQUIRED' });
    expect(state.rows[0].failedAttempts).toBe(0);
  });
  it('only the owning manager issuing a new code recovers a lock, and the old code stops working', async () => {
    const old = codeOf(); state.rows[0].failedAttempts = 5; state.rows[0].lockedAt = new Date();
    const [issued] = await vc.issueNewCode(10, 2, 'visit:5');
    expect(issued).toMatchObject({ revision: 2, locked: false, attemptsLeft: 5 });
    expect(state.rows[0].nonce).not.toBe('nonce-a');
    expect(issued.code).toBe(codeOf()); expect(issued.code).not.toBe(old);
    await expect(vc.verifyArrivalCode({ ...target, visitCode: old })).rejects.toMatchObject({ code: 'VISIT_CODE_WRONG' });
    await expect(vc.verifyArrivalCode({ ...target, visitCode: codeOf() })).resolves.toMatchObject({ kind: 'ok', method: 'code' });
  });
});

describe('arrival through the writer (code gate, replay, evidence)', () => {
  it('rejects a wrong code without writing evidence, notices, or consuming; the attempt is persisted', async () => {
    const result = await checkinKitchenVisit(10, 5, 3, undefined, [], [], wrongOf(), 'req-1');
    expect(result).toMatchObject({ success: false, code: 'VISIT_CODE_WRONG', attemptsLeft: 4 });
    expect(state.visitWrites).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.checkin).not.toHaveBeenCalled();
    expect(state.rows[0]).toMatchObject({ failedAttempts: 1, consumedAt: null });
  });
  it('accepts the right code once; replay with the same chef and key returns success without a second event', async () => {
    expect(await checkinKitchenVisit(10, 5, 3, undefined, [], [], codeOf(), 'req-1')).toMatchObject({ success: true });
    expect(state.rows[0]).toMatchObject({ consumedMethod: 'code', consumedByUserId: 3, consumedRequestKey: 'client:req-1' });
    expect(state.queue).toHaveBeenCalledTimes(1); expect(state.visitWrites).toHaveLength(1);
    const replay = await checkinKitchenVisit(10, 5, 3, undefined, [], [], codeOf(), 'req-1');
    expect(replay).toMatchObject({ success: true, checkinStatus: 'checked_in' });
    expect(state.queue).toHaveBeenCalledTimes(1); expect(state.visitWrites).toHaveLength(1); expect(state.checkin).toHaveBeenCalledTimes(1);
  });
  it('anything else after consumption is "arrival already recorded"', async () => {
    await checkinKitchenVisit(10, 5, 3, undefined, [], [], codeOf(), 'req-1');
    const other = await checkinKitchenVisit(10, 5, 3, undefined, [], [], codeOf(), 'req-2');
    expect(other).toMatchObject({ success: false, code: 'VISIT_CODE_ALREADY_RECORDED' });
    await expect(vc.verifyArrivalCode({ ...target, chefId: 4, requestKey: 'req-1', visitCode: codeOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_ALREADY_RECORDED' });
    expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it('self mode confirms without a code and records the distinct method', async () => {
    state.rows[0].mode = 'self';
    expect(await checkinKitchenVisit(10, 5, 3)).toMatchObject({ success: true });
    expect(state.rows[0]).toMatchObject({ consumedMethod: 'self', consumedByUserId: 3 });
    expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it('a booking without a challenge keeps today\'s tap-to-arrive behaviour', async () => {
    state.rows = [];
    expect(await checkinKitchenVisit(10, 5, 3)).toMatchObject({ success: true });
    expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it('a revoked challenge blocks arrival with a specific message', async () => {
    state.rows[0].revokedAt = new Date();
    expect(await checkinKitchenVisit(10, 5, 3, undefined, [], [], codeOf(), 'r')).toMatchObject({ success: false, code: 'VISIT_CODE_REVOKED' });
  });
  it('manager-assisted arrival consumes without any code and later chef arrival is already recorded', async () => {
    const { db } = await import('../db');
    await (db as any).transaction((tx: any) => vc.consumeForAssistedArrival(tx, { bookingId: 10, visitId: 5 }, 2));
    expect(state.rows[0]).toMatchObject({ consumedMethod: 'assisted', consumedByUserId: 2 });
    await expect(vc.verifyArrivalCode({ ...target, visitCode: codeOf() })).rejects.toMatchObject({ code: 'VISIT_CODE_ALREADY_RECORDED' });
  });
});

describe('enrollment and revocation', () => {
  it('a same-mode request does not rotate or emit a notice', async () => {
    const before = sentinel();
    await vc.setMode(10, 2, { targetKey: 'visit:5', mode: 'staffed' });
    expect(sentinel()).toBe(before);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('queues one bulk notice with only changed targets and no credentials or internal reason', async () => {
    state.rows.push(challenge({ id: 2, visitId: 6, targetKey: 'visit:6' }),
      challenge({ id: 3, visitId: 7, targetKey: 'visit:7', consumedAt: new Date() }),
      challenge({ id: 4, visitId: 8, targetKey: 'visit:8', mode: 'self' }));
    const code = codeOf();
    await vc.setMode(10, 2, { all: true, mode: 'self', reason: 'INTERNAL-REASON-SENTINEL' });
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0][2]).toBe('arrival_mode_changed');
    expect(state.queue.mock.calls[0][6]).toEqual({ targets: [
      { targetKey: 'visit:5', visitId: 5, revision: 2, mode: 'self' },
      { targetKey: 'visit:6', visitId: 6, revision: 2, mode: 'self' }] });
    const notices = JSON.stringify(state.queue.mock.calls);
    expect(notices).not.toContain(code);
    expect(notices).not.toContain('INTERNAL-REASON-SENTINEL');
    expect(notices).not.toContain('nonce');
  });
  it('queues code reissue in the rotation transaction and records failed-attempt email eligibility outside metadata', async () => {
    state.rows[0].failedAttempts = 3;
    const code = codeOf();
    await vc.issueNewCode(10, 2, 'visit:5');
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0].slice(1)).toEqual([10, 'arrival_code_reissued', 'Arrival details updated',
      expect.any(String), 2, { targets: [{ targetKey: 'visit:5', visitId: 5, revision: 2, mode: 'staffed' }] }, true]);
    expect(JSON.stringify(state.queue.mock.calls)).not.toContain(code);
  });
  it('creates one staffed revision-1 challenge for a booking and is idempotent', async () => {
    state.rows = [];
    const { db } = await import('../db');
    await (db as any).transaction((tx: any) => vc.ensureChallengesForBooking(tx, 77, 2));
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ targetKey: 'booking:77', mode: 'staffed', revision: 1, keyVersion: 1, failedAttempts: 0 });
    expect(state.rows[0].nonce).toMatch(/^[0-9a-f]{32}$/);
    await (db as any).transaction((tx: any) => vc.ensureChallengesForBooking(tx, 77, 2));
    expect(state.rows).toHaveLength(1);
  });
  it('skips enrollment (legacy behaviour) when the signing key is missing', async () => {
    state.rows = []; delete process.env.VISIT_CODE_HMAC_SECRET;
    const { db } = await import('../db');
    expect(await (db as any).transaction((tx: any) => vc.ensureChallengesForBooking(tx, 77))).toBe(0);
    expect(state.rows).toEqual([]);
  });
  it('cancellation revokes unconsumed challenges and keeps consumed history', async () => {
    state.rows.push(challenge({ id: 2, visitId: 6, targetKey: 'visit:6', consumedAt: new Date(), consumedMethod: 'code' }));
    const { db } = await import('../db');
    await (db as any).transaction((tx: any) => vc.revokeForBooking(tx, 10, 'booking_cancelled'));
    expect(state.rows[0]).toMatchObject({ revokedReason: 'booking_cancelled' }); expect(state.rows[1].revokedAt).toBeNull();
  });
});

describe('redaction and ownership', () => {
  it('revalidates target revisions, modes, consumption and revocation without returning challenge secrets', async () => {
    const targets = [{ targetKey: 'visit:5', visitId: 5, revision: 1, mode: 'staffed' as const }];
    expect(await vc.currentArrivalNoticeTargets(10, targets)).toEqual(targets);
    state.rows[0].revision = 2;
    expect(await vc.currentArrivalNoticeTargets(10, targets)).toEqual([]);
    state.rows[0].revision = 1; state.rows[0].consumedAt = new Date();
    expect(await vc.currentArrivalNoticeTargets(10, targets)).toEqual([]);
    state.rows[0].consumedAt = null; state.rows[0].revokedAt = new Date();
    expect(await vc.currentArrivalNoticeTargets(10, targets)).toEqual([]);
  });
  it('summarizes modes without inventing a self mode for legacy bookings', () => {
    expect(vc.arrivalModeFor([])).toBe('legacy');
    expect(vc.arrivalModeFor([{ mode: 'self' }])).toBe('self');
    expect(vc.arrivalModeFor([{ mode: 'staffed' }, { mode: 'self' }])).toBe('mixed');
  });
  it('chef projection and outbox payloads never contain the code', async () => {
    const code = codeOf();
    expect(JSON.stringify(vc.chefProjection(state.rows[0]))).not.toContain(code);
    expect(vc.chefProjection(state.rows[0])).toMatchObject({ mode: 'staffed', codeRequired: true, locked: false, attemptsLeft: 5 });
    await checkinKitchenVisit(10, 5, 3, undefined, [], [], code, 'req-9');
    expect(JSON.stringify(state.queue.mock.calls)).not.toContain(code);
    expect(JSON.stringify(state.visitWrites)).not.toContain(code);
    expect(JSON.stringify(state.rows[0])).not.toContain(code);
  });
  it('manager projection shows the code while open and never after consumption or revocation', async () => {
    const code = codeOf();
    expect(vc.managerProjection(state.rows[0]).code).toBe(code);
    await checkinKitchenVisit(10, 5, 3, undefined, [], [], code, 'req-9');
    const after = vc.managerProjection(state.rows[0]);
    expect(after).toMatchObject({ code: null, consumed: true, consumedMethod: 'code' });
    expect(JSON.stringify(after)).not.toContain(code);
    expect(vc.managerProjection(challenge({ revokedAt: new Date() })).code).toBeNull();
    expect(vc.managerProjection(challenge({ mode: 'self' })).code).toBeNull();
  });
  it('only the owning manager can read, rotate, or change mode', async () => {
    state.owner = { managerId: 99, status: 'confirmed' };
    await expect(vc.getManagerVisitCodes(10, 2)).rejects.toMatchObject({ status: 404 });
    await expect(vc.issueNewCode(10, 2, 'visit:5')).rejects.toMatchObject({ status: 404 });
    await expect(vc.setMode(10, 2, { all: true, mode: 'staffed' })).rejects.toMatchObject({ status: 404 });
    expect(state.rows[0].revision).toBe(1);
  });
  it('setMode self needs a reason, rotates the revision, can target all visits, and switching back rotates again', async () => {
    state.rows.push(challenge({ id: 2, visitId: 6, targetKey: 'visit:6', nonce: 'nonce-b' }));
    await expect(vc.setMode(10, 2, { all: true, mode: 'self' })).rejects.toThrow(/Explain why/);
    const targets = await vc.setMode(10, 2, { all: true, mode: 'self', reason: 'Kitchen unattended on Sunday mornings' });
    expect(targets.map(t => t.mode)).toEqual(['self', 'self']);
    expect(state.rows.map(r => r.revision)).toEqual([2, 2]);
    expect(state.rows[0]).toMatchObject({ modeChangedByUserId: 2, modeReason: 'Kitchen unattended on Sunday mornings' });
    expect(targets.every(t => t.code === null)).toBe(true);
    await vc.setMode(10, 2, { targetKey: 'visit:5', mode: 'staffed' });
    expect(state.rows[0]).toMatchObject({ mode: 'staffed', revision: 3 }); expect(state.rows[1].mode).toBe('self');
  });
  it('does not rotate a consumed target', async () => {
    state.rows[0].consumedAt = new Date(); state.rows[0].consumedMethod = 'code';
    await expect(vc.issueNewCode(10, 2, 'visit:5')).rejects.toThrow(/already recorded/);
    expect(sentinel()).toContain('"revision":1');
  });
});
