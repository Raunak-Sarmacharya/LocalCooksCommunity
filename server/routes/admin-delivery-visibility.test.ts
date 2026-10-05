import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), where: vi.fn(), visible: vi.fn(), pending: vi.fn(), retry: vi.fn() }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: (condition: any) => { state.where(condition); return chain; },
    orderBy: () => chain, limit: () => chain, offset: () => chain, then: (resolve: any) => resolve([]) };
  return chain;
} }, getDbError: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: state.auth, requireAdmin: state.admin, requireManager: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../firebase-setup', () => ({ initializeFirebaseAdmin: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/delivery-visibility', () => ({ visibleEmailLogs: state.visible, pendingDecisionDeliveries: state.pending, retryDecisionDelivery: state.retry }));
import router from './admin';
const route = (path: string, method: string) => (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); state.visible.mockResolvedValue([]); state.pending.mockResolvedValue([]); });
it('keeps existing authentication/admin boundaries on visibility and original-event recovery', () => {
  for (const [path, method] of [['/email-logs', 'get'], ['/email-logs/pending-events', 'get'], ['/email-logs/events/:source/:id/retry', 'post']]) {
    const stack = route(path, method);
    expect(stack[0].handle).toBe(state.auth); expect(stack[1].handle).toBe(state.admin);
  }
});
it('filters due original intents in both list/count queries and serializes through the public summary', async () => {
  const res = response(); await route('/email-logs', 'get').at(-1).handle({ query: { status: 'due', role: 'all' } }, res);
  expect(state.visible).toHaveBeenCalledWith([]); expect(state.where).toHaveBeenCalledTimes(2);
  const compiled = new PgDialect().sqlToQuery(state.where.mock.calls[0][0]);
  expect(compiled.sql).toContain('CURRENT_TIMESTAMP'); expect(compiled.sql).toContain('CASE WHEN');
  expect(compiled.sql).toContain('lifecycle_outcome'); expect(compiled.sql).toContain('advance_reminder');
});
it('rejects malformed original event identity before any recovery action', async () => {
  const res = response(); await route('/email-logs/events/:source/:id/retry', 'post').at(-1).handle({ params: { source: 'booking', id: '9junk' } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(state.retry).not.toHaveBeenCalled();
});
