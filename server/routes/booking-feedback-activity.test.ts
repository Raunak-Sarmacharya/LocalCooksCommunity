import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ condition: null as any, fields: null as any }));
vi.mock('../db', () => ({ db: { select: (fields: any) => { state.fields = fields;
  const q: any = { from: () => q, innerJoin: () => q, where: (condition: any) => { state.condition = condition; return q; }, orderBy: () => q, limit: async () => [] }; return q;
} } }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (req: any, _res: any, next: any) => { req.neonUser = { id: 2 }; next(); }, requireManager: (_req: any, _res: any, next: any) => next(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/booking-attendance-service', () => ({ AttendanceError: class extends Error {}, readBookingAttendance: vi.fn(), readBookingHistory: vi.fn(), recordBookingAttendance: vi.fn() }));
import router from './booking-attendance';
describe('private feedback activity isolation', () => {
  it('excludes private feedback flag and reminder events from the manager’s general activity feed', async () => {
    await new Promise<void>((resolve, reject) => router.handle({ method: 'GET', url: '/manager/booking-lifecycle' } as any,
      { json: () => resolve(), status: () => ({ json: reject }) } as any, reject));
    const query = new PgDialect().sqlToQuery(state.condition);
    expect(query.sql).toContain("NOT IN ('feedback_flagged', 'feedback_requested')");
    expect(query.params).toEqual([2]);
  });
  it('shows the kitchen its own wording for an event and never a Local Cooks-only notice', async () => {
    await new Promise<void>((resolve, reject) => router.handle({ method: 'GET', url: '/manager/booking-lifecycle' } as any,
      { json: () => resolve(), status: () => ({ json: reject }) } as any, reject));
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(state.fields.title).sql).toContain("->'roleText'->'manager'->>'title'");
    expect(dialect.sqlToQuery(state.condition).sql).toContain("->>'recipientPolicy', '') <> 'admins'");
  });
  it('shows a changed request once: no replacement status, no replaced-by link, no chef-only withdrawal of the old request', async () => {
    await new Promise<void>((resolve, reject) => router.handle({ method: 'GET', url: '/manager/booking-lifecycle' } as any,
      { json: () => resolve(), status: () => ({ json: reject }) } as any, reject));
    const sql = new PgDialect().sqlToQuery(state.condition).sql;
    expect(sql).toContain("NOT IN ('replacement_status', 'replaced_by')");
    expect(sql).toContain("->>'requestOutcome', '') <> 'replaced'");
  });
});
