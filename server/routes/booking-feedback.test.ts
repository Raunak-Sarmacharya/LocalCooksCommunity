import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), admin: vi.fn(), submit: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({
  requireFirebaseAuthWithUser: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Sign in' });
    req.neonUser = { id: 77, role: req.headers.authorization, preferredLocale: 'en-CA' }; next();
  },
  requireAdmin: (req: any, res: any, next: any) => req.neonUser.role === 'admin' ? next() : res.status(403).json({ error: 'Admin required' }),
}));
vi.mock('../db', () => ({ db: { transaction: (work: any) => work({ tx: true }) } }));
vi.mock('../services/booking-feedback-service', () => ({ getBookingFeedback: state.read, getAdminBookingFeedback: state.admin, submitBookingFeedback: state.submit }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import router from './booking-feedback';
import { DomainError } from '../shared/errors/domain-error';
function request(method: string, url: string, authorization?: string, body: any = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res: any = { status: (n: number) => { status = n; return res; }, json: (value: any) => resolve({ status, body: value }) };
    router.handle({ method, url, headers: { authorization }, body } as any, res, (error?: any) => error ? reject(error) : resolve({ status: 404, body: null }));
  });
}
beforeEach(() => { vi.clearAllMocks(); state.read.mockResolvedValue({ response: null, available: true }); state.admin.mockResolvedValue({ responses: [] }); state.submit.mockResolvedValue({ response: { rating: 4 }, available: false }); });
describe('feedback route contracts', () => {
  it.each(['/bookings/42/feedback', '/manager/bookings/42/feedback', '/admin/bookings/42/feedback'])('requires authentication for %s', async path => {
    expect((await request('GET', path)).status).toBe(401); expect(state.read).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled();
  });
  it.each([['chef', '/bookings/42/feedback'], ['manager', '/manager/bookings/42/feedback']])('passes the authenticated identity and fixed %s role', async (role, path) => {
    expect((await request('GET', path, role)).body).toEqual({ response: null, available: true });
    expect(state.read).toHaveBeenCalledWith(expect.anything(), 42, { id: 77, role, locale: 'en-CA' });
    const payload = { rating: 4, respondentId: 999 };
    expect((await request('POST', path, role, payload)).status).toBe(200);
    expect(state.submit).toHaveBeenCalledWith({ tx: true }, 42, { id: 77, role, locale: 'en-CA' }, payload);
  });
  it('keeps the admin endpoint guarded and read-only', async () => {
    expect((await request('GET', '/admin/bookings/42/feedback', 'manager')).status).toBe(403);
    expect((await request('GET', '/admin/bookings/42/feedback', 'admin')).body).toEqual({ responses: [] });
    expect((await request('POST', '/admin/bookings/42/feedback', 'admin')).status).toBe(404);
    expect(state.submit).not.toHaveBeenCalled();
  });
  it('validates IDs and preserves immutable/closed error statuses', async () => {
    expect((await request('GET', '/bookings/not-an-id/feedback', 'chef')).status).toBe(400);
    state.submit.mockRejectedValueOnce(new DomainError('BOOKING_FEEDBACK_ALREADY_SUBMITTED', 'Already sent', 409));
    expect((await request('POST', '/bookings/42/feedback', 'chef')).status).toBe(409);
  });
  it('does not reveal internal failures', async () => {
    state.read.mockRejectedValueOnce(Error('internal connection detail'));
    const result = await request('GET', '/bookings/42/feedback', 'chef');
    expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain('connection detail');
  });
});
