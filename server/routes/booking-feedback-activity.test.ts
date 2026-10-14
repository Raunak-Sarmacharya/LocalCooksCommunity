import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ condition: null as any }));
vi.mock('../db', () => ({ db: { select: () => {
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
});
