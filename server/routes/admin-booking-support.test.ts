import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn(), execute: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({
  requireFirebaseAuthWithUser: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Sign in to continue.' });
    req.neonUser = { id: 77, role: req.headers.authorization }; next();
  },
  requireAdmin: (req: any, res: any, next: any) => req.neonUser?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' }),
}));
vi.mock('../services/booking-support', () => ({ searchBookingSupport: state.search, readBookingSupport: state.read,
  executeBookingSupportAction: state.execute, BookingSupportError: class extends Error { constructor(message: string, public status = 409) { super(message); } } }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import router from './admin-booking-support';
import { BookingSupportError } from '../services/booking-support';
function request(method: string, path: string, authorization?: string, body: any = {}, query: any = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res: any = { status: (value: number) => { status = value; return res; }, json: (body: any) => resolve({ status, body }) };
    const req: any = { method, url: path, headers: { authorization }, body, query };
    router.handle(req, res, (error?: any) => error ? reject(error) : resolve({ status: 404, body: null }));
  });
}
beforeEach(() => {
  vi.clearAllMocks(); state.search.mockResolvedValue({ results: [] }); state.read.mockResolvedValue({ bookingId: 149, visitCodes: [] });
  state.execute.mockResolvedValue({ action: { id: 1, status: 'verified' }, case: { bookingId: 149 }, replayed: false });
});
describe('protected booking support route contracts', () => {
  it.each(['GET /admin/booking-support/search', 'GET /admin/booking-support/149', 'POST /admin/booking-support/149/actions'])('requires a named admin for %s', async entry => {
    const [method, path] = entry.split(' ');
    expect((await request(method, path)).status).toBe(401);
    expect((await request(method, path, 'manager')).status).toBe(403);
    expect(state.search).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled(); expect(state.execute).not.toHaveBeenCalled();
  });
  it('keeps search ahead of the numeric case route and passes its query', async () => {
    expect((await request('GET', '/admin/booking-support/search', 'admin', {}, { q: 'KB-EXAMPLE' })).body).toEqual({ results: [] });
    expect(state.search).toHaveBeenCalledWith('KB-EXAMPLE'); expect(state.read).not.toHaveBeenCalled();
  });
  it('loads a numeric case and rejects invalid IDs/query shapes', async () => {
    expect((await request('GET', '/admin/booking-support/149', 'admin')).status).toBe(200);
    expect(state.read).toHaveBeenCalledWith(149);
    expect((await request('GET', '/admin/booking-support/nope', 'admin')).status).toBe(400);
    expect((await request('GET', '/admin/booking-support/search', 'admin', {}, { q: ['a', 'b'] })).status).toBe(400);
  });
  it('takes the real staff identity from auth and returns the action envelope unchanged', async () => {
    const body = { type: 'open_flag', operationKey: 'support-operation' };
    expect((await request('POST', '/admin/booking-support/149/actions', 'admin', body)).body.action.status).toBe('verified');
    expect(state.execute).toHaveBeenCalledWith(149, 77, body);
  });
  it('preserves domain errors and returns a calm error for an unavailable database', async () => {
    state.read.mockRejectedValueOnce(new BookingSupportError('Booking not found.', 404));
    expect((await request('GET', '/admin/booking-support/149', 'admin')).status).toBe(404);
    state.read.mockRejectedValueOnce(Error('private provider credentials'));
    const result = await request('GET', '/admin/booking-support/149', 'admin');
    expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain('credentials');
  });
});
