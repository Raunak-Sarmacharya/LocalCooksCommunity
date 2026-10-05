import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], managerId: 2, writes: [] as any[], notice: vi.fn(), captured: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: async () => [], select: () => { let table: string; const q: any = {
    from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; }, innerJoin: () => q, where: () => q,
    limit: async () => [{ booking: state.booking, managerId: state.managerId }],
    then: (resolve: any) => resolve(table === 'kitchen_booking_visits' ? state.visits : []) }; return q; },
    update: () => ({ set: (values: any) => ({ where: async () => { state.writes.push(values); } }) }) };
  db.transaction = async (run: any) => run(db); return { db };
});
vi.mock('./visit-duties', () => ({ kitchenDuties: state.captured }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.notice, deliverBookingLifecycleEvents: async () => { throw Error('SMTP unavailable'); } }));
import { assistKitchenVisit } from './visit-assistance';
const input = { action: 'departure' as const, reason: 'Chef reported leaving; upload repeatedly failed', actualAt: '2026-10-02T19:30:00Z',
  expectedUpdatedAt: '2026-10-02T18:00:00Z', expectedBookingUpdatedAt: '2026-10-02T18:00:00Z' };
describe('audited manager assistance (mocked database)', () => {
  beforeEach(() => { state.booking = { id: 10, chefId: 3, status: 'confirmed', checkinStatus: 'not_checked_in',
    updatedAt: new Date(input.expectedUpdatedAt), assistanceHistory: [], checkinPhotoUrls: ['original'], checkoutPhotoUrls: ['existing'] };
    state.visits = []; state.managerId = 2; state.writes = []; vi.clearAllMocks(); state.captured.mockResolvedValue({ version: 1 }); });
  it('requests inspection without manufacturing arrival, clearance, photos or money; keeps durable recovery on send failure', async () => {
    expect(await assistKitchenVisit(10, 2, input)).toEqual({ success: true });
    expect(state.writes[0]).toMatchObject({ checkinStatus: 'checkout_requested', actualEndTime: '17:00', assistanceHistory: [expect.objectContaining({ actorId: 2, reason: input.reason, actualAt: new Date(input.actualAt).toISOString() })] });
    for (const field of ['checkedInAt', 'checkinPhotoUrls', 'checkoutPhotoUrls', 'checkoutApprovedAt', 'status', 'paymentStatus']) expect(state.writes[0]).not.toHaveProperty(field);
    expect(state.notice.mock.calls[0][2]).toBe('visit_assisted');
    expect(state.notice.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
  });
  it('preserves history and separately records assisted arrival', async () => {
    state.booking.assistanceHistory = [{ action: 'earlier correction' }];
    await assistKitchenVisit(10, 2, { ...input, action: 'arrival' });
    expect(state.writes[0].assistanceHistory).toHaveLength(2); expect(state.writes[0].checkedInMethod).toBe('manager');
    expect(state.writes[0].checkedInAt).toEqual(new Date(input.actualAt));
  });
  it('rejects another location manager before changing anything', async () => {
    await expect(assistKitchenVisit(10, 999, input)).rejects.toThrow(/not found/); expect(state.writes).toEqual([]);
  });
  it.each(['cancelled', 'completed', 'pending'])('does not assist a %s booking', async status => {
    state.booking.status = status; await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/confirmed/); expect(state.notice).not.toHaveBeenCalled();
  });
  it.each(['checkout_requested', 'checkout_claim_filed', 'checked_out', 'no_show'])('preserves competing review/correction %s', async checkinStatus => {
    state.booking.checkinStatus = checkinStatus; await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/correction|inspection/); expect(state.writes).toEqual([]);
  });
  it('rejects stale parent, foreign visits, missing reason and ambiguous/future time', async () => {
    await expect(assistKitchenVisit(10, 2, { ...input, expectedBookingUpdatedAt: '2026-10-01' })).rejects.toThrow(/changed/);
    await expect(assistKitchenVisit(10, 2, { ...input, visitId: 999 })).rejects.toThrow(/Choose/);
    await expect(assistKitchenVisit(10, 2, { ...input, reason: '' })).rejects.toThrow(/explain/);
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt: '2026-10-02T19:30:00' })).rejects.toThrow(/UTC offset/);
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt: '2099-10-02T19:30:00Z' })).rejects.toThrow(/no later/);
    expect(state.writes).toEqual([]);
  });
});
