import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ notify: vi.fn(), insert: vi.fn(), rows: [] as any[][] }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import { deliverBookingLifecycleEvents, queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
const tx: any = { select: () => { const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
  limit: () => Promise.resolve(state.rows.shift()), then: (resolve: any) => resolve(state.rows.shift()) }; return chain; },
  insert: () => ({ values: state.insert }) };
describe('booking lifecycle recipients and durable email evidence', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'development'); state.rows = [
    [{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' },
      { id: 2, email: 'manager@example.test', role: 'manager' }, { id: 1, email: 'support@example.test', role: 'admin' }] ]; });
  it('commits an in-app alert and email outbox recipient for each surface', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'report_attended', 'Chef attendance reported', 'Shared attendance evidence', 2, { visitId: 5 });
    expect(state.notify).toHaveBeenCalledTimes(3);
    expect(state.notify.mock.calls.map(call => call[0].actionUrl)).toEqual(['/booking/10', '/manager/booking/10', '/admin?section=transactions&bookingId=10']);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'report_attended', actorId: 2,
      emails: [expect.objectContaining({ url: 'http://chef.localhost:5001/booking/10' }),
        expect.objectContaining({ url: 'http://kitchen.localhost:5001/manager/booking/10' }),
        expect.objectContaining({ url: 'http://admin.localhost:5001/admin?section=transactions&bookingId=10' })] }));
    expect(state.notify.mock.calls.every(call => call[1] === tx)).toBe(true);
  });
  it('rolls back the caller when the outbox cannot be saved', async () => {
    state.insert.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Payment captured')).rejects.toThrow('outbox unavailable');
  });
  it('does not acknowledge suppressed test email as delivered', async () => {
    vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1');
    try { expect(await deliverBookingLifecycleEvents()).toEqual({ completed: 0 }); }
    finally { vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0'); }
  });
});
