import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, settings: [] as any[], decide: vi.fn(), queue: vi.fn(), queries: [] as any[] }));
vi.mock('./booking-payment-decision', () => ({ decideAuthorizedBooking: state.decide }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./payment-transactions-service', () => ({ findPaymentTransactionByIntentId: async () => null }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Alex' }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => {
  const database = { select: () => {
    let table = '', joined = false, condition: any;
    const rows = () => {
      if (condition) state.queries.push(new PgDialect().sqlToQuery(condition));
      return table === 'platform_settings' ? state.settings : table === 'kitchen_invitations' ? [{ managerId: 2 }] : table === 'kitchens' ? [{ timezone: 'UTC' }]
        : table === 'kitchen_bookings' ? joined ? [{ booking: state.booking, kitchen: { id: 4, name: 'Test kitchen' }, location: { id: 2, timezone: 'UTC' } }]
          : [state.booking] : [];
    };
    const chain: any = { from: (t: any) => { table = getTableName(t); return chain; }, innerJoin: () => { joined = true; return chain; },
      where: (c: any) => { condition = c; return chain; }, limit: () => chain, orderBy: () => chain, then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject) };
    return chain;
  } };
  return { db: database };
});
import { db } from '../db';
import { lazyExpireKitchenBookingAuth, processExpiredAuthorizations, sendAuthExpiryNotification } from './auth-expiry-service';
import { getBookingResponseDeadline } from './booking-response-deadline';

describe('R5 authorization enforcement (all external effects mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks(); state.settings = []; state.queries = [];
    state.booking = { id: 1, kitchenId: 4, chefId: 3, createdAt: new Date('2026-10-14T10:00:00Z'),
      bookingDate: new Date('2026-10-14T00:00:00Z'), startTime: '20:00', endTime: '21:00', status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_mock' };
    vi.useFakeTimers();
  });
  it('does not expire before R5, and expires at its exact boundary', async () => {
    vi.setSystemTime(new Date('2026-10-14T18:59:59Z'));
    expect(await lazyExpireKitchenBookingAuth(state.booking)).toBe(false);
    expect(state.decide).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-14T19:00:00Z'));
    expect(await lazyExpireKitchenBookingAuth(state.booking)).toBe(true);
    expect(state.decide).toHaveBeenCalledWith(1, 'cancelled', [], [], undefined, { responseDeadlineAt: '2026-10-14T19:00:00.000Z' });
  });
  it('sweep discovers short-notice requests younger than 24h, without expiring future requests', async () => {
    vi.setSystemTime(new Date('2026-10-14T18:59:59Z'));
    expect(await processExpiredAuthorizations()).toEqual([]);
    vi.setSystemTime(new Date('2026-10-14T19:00:00Z'));
    expect(await processExpiredAuthorizations()).toEqual([expect.objectContaining({ id: 1, action: 'canceled' })]);
    expect(state.queries.filter(q => q.sql.includes('"payment_status"')).every(q => !q.sql.includes('"created_at"'))).toBe(true);
  });
  it('uses saved settings and keeps a decision already in progress', async () => {
    state.settings = [{ key: 'manager_response_buffer_hours', value: '2' }];
    expect((await getBookingResponseDeadline(state.booking)).toISOString()).toBe('2026-10-14T18:00:00.000Z');
    state.booking.paymentDecision = { state: 'pending' }; vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    expect(await lazyExpireKitchenBookingAuth(state.booking)).toBe(false); expect(state.decide).not.toHaveBeenCalled();
  });
  it('attempts pre-approved invitation acceptance instead of expiring a stranded invitation booking', async () => {
    state.booking.invitationId = 'inv_one'; vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    expect(await lazyExpireKitchenBookingAuth(state.booking)).toBe(false);
    expect(state.decide).toHaveBeenCalledWith(1, 'confirmed', [], [], 2);
    state.decide.mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await lazyExpireKitchenBookingAuth(state.booking)).toBe(false);
    expect(state.decide.mock.calls.every(call => call[1] === 'confirmed')).toBe(true);
  });
  it('queues warm role-specific expiry copy only in the verified release transaction', async () => {
    await sendAuthExpiryNotification(3, 1, 'kitchen_booking', 4, db as any, '2026-10-14T19:00:00Z');
    const metadata = state.queue.mock.calls[0][6];
    expect(metadata.roleText.chef.message).toContain("Test kitchen didn't respond in time");
    expect(metadata.roleText.chef.message).toContain("Your card wasn't charged");
    expect(metadata.roleText.manager.message).toContain("Alex's request");
    expect(metadata.roleText.manager.message).toContain('7:00 p.m.');
    expect(metadata.kitchenPath).toBe('/kitchen-preview/2?kitchenId=4');
    expect(JSON.stringify(metadata)).not.toContain('within 24 hours');
  });
});
import { afterEach } from 'vitest';
afterEach(() => vi.useRealTimers());
