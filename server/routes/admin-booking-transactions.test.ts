import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ execute: vi.fn(), auth: vi.fn(), admin: vi.fn() }));
vi.mock('../db', () => ({ db: { execute: state.execute }, getDbError: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: state.auth, requireAdmin: state.admin, requireManager: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../firebase-setup', () => ({ initializeFirebaseAdmin: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import admin from './admin';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
const stack = (admin as any).stack.find((entry: any) => entry.route?.path === '/transactions' && entry.route.methods.get).route.stack;
const handler = stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const dialect = new PgDialect();
beforeEach(() => { vi.clearAllMocks(); state.execute.mockResolvedValueOnce({ rows: [{ total: '0' }] }).mockResolvedValueOnce({ rows: [] }); });
describe('admin exact kitchen booking context query', () => {
  it('consumes the generated action parameters with exact ID and kitchen/bundle predicates in count and row queries', async () => {
    const query = Object.fromEntries(new URL(adminBookingTransactionsPath(10), 'https://admin.example.test').searchParams);
    const res = response();
    await handler({ query: { ...query, search: 'KB-FIXTURE', locationId: '5' } }, res);
    expect(res.json).toHaveBeenCalledWith({ transactions: [], total: 0 });
    for (const [statement] of state.execute.mock.calls) {
      const compiled = dialect.sqlToQuery(statement);
      expect(compiled.sql).toMatch(/pt\.booking_id = \$\d+ AND pt\.booking_type IN \('kitchen', 'bundle'\)/);
      expect(compiled.params).toContain(10);
      expect(compiled.params).toContain('%KB-FIXTURE%');
      expect(compiled.params).toContain(5);
    }
    expect(stack[0].handle).toBe(state.auth); expect(stack[1].handle).toBe(state.admin);
  });
  it('rejects malformed IDs instead of broadening to the general list', async () => {
    const res = response(); await handler({ query: { bookingId: '10garbage' } }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(state.execute).not.toHaveBeenCalled();
  });
});
