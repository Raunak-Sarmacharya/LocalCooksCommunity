import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./visit-code-challenge', () => ({ ensureChallengesForBooking: vi.fn() }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {} }));
const mocks = vi.hoisted(() => ({ intent: vi.fn(), session: vi.fn(), capture: vi.fn(), cancel: vi.fn(),
  state: {} as Record<string, any[]>, failFinalize: false }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: mocks.intent, getBookingCheckoutSession: mocks.session,
  capturePaymentIntent: mocks.capture, cancelPaymentIntent: mocks.cancel }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./booking-linked-cancellation', () => ({ cancelLinkedBookingDates: vi.fn() }));
const expiry = vi.hoisted(() => ({ lazy: vi.fn() }));
vi.mock('./auth-expiry-service', () => ({ AUTH_EXPIRY_HOURS: 24, lazyExpireKitchenBookingAuth: expiry.lazy }));
vi.mock('./booking-response-deadline', async () => {
  const { responseDeadlineForBooking } = await import('@shared/booking-response-deadline');
  return { getBookingResponseDeadline: async (booking: any) => booking.bookingDate
    ? responseDeadlineForBooking(booking, 'UTC') : new Date(booking.createdAt.getTime() + 24 * 3_600_000) };
});
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const database = (state: Record<string, any[]>) => {
    const db: any = {
      select: () => ({ from: (table: any) => {
        const rows = () => state[name(table)] || [];
        const chain: any = { where: () => chain, limit: () => chain, for: () => chain,
          then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject) };
        return chain;
      } }),
      update: (table: any) => ({ set: (values: any) => ({ where: () => {
        const save = () => { for (const row of state[name(table)] || []) Object.assign(row, values); return state[name(table)] || []; };
        return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
      } }) }),
      insert: (table: any) => ({ values: (values: any) => ({ onConflictDoNothing: async () => {
        if (name(table) === 'kitchen_invitation_events' && mocks.failFinalize) throw new Error('invitation completion DB unavailable');
        (state[name(table)] ||= []).push(values);
      } }) }),
      transaction: async (run: any) => {
        const snapshot = structuredClone(mocks.state);
        const result = await run(database(snapshot));
        for (const key of Object.keys(mocks.state)) mocks.state[key] = snapshot[key];
        return result;
      },
    };
    return db;
  };
  return { db: database(mocks.state) };
});
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async () => 'Sam Taylor') }));
import { decideAuthorizedBooking } from './booking-payment-decision';
describe('atomic invitation capture completion', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.failFinalize = false;
    Object.assign(mocks.state, { kitchen_bookings: [{ id: 1, chefId: 3, kitchenId: 4, status: 'pending', paymentStatus: 'authorized',
      paymentIntentId: 'pi_fixture', updatedAt: new Date('2026-10-02'), storageItems: [], equipmentItems: [{ equipmentBookingId: 2 }] }],
      equipment_bookings: [{ id: 2, chefId: 3, kitchenBookingId: 1, totalPrice: '1000', status: 'pending', equipmentListingId: 8 }],
      payment_transactions: [{ id: 7, paymentIntentId: 'pi_fixture', metadata: {} }] });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    mocks.session.mockResolvedValue({ status: 'complete', currency: 'cad', amount_total: 2440,
      metadata: { type: 'kitchen_booking', chef_id: '3', kitchen_id: '4', fee_model: 'separate-charge-commission-v1',
        total_price_cents: '2000', tax_cents: '300', tax_rate_percent: '15', platform_fee_cents: '140', addon_prices: '{"s":[],"e":[[8,1000]]}' } });
  });
  // Cold-imports the Stripe checkout service; under the full parallel server run that alone can pass 5 s.
  it('rolls back invitation, booking and decision completion together and recovers the original capture', async () => {
    mocks.state.kitchen_bookings[0].invitationId = 'inv_one';
    mocks.state.kitchen_invitations = [{ id: 'inv_one', version: 1, status: 'accepted_pending_payment', managerId: 2, listCents: 3000, offeredCents: 2000 }];
    mocks.state.kitchen_invitation_events = [];
    mocks.state.kitchen_bookings[0].createdAt = new Date('2020-01-01');
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount: 2440, amount_received: 2440 });
    mocks.failFinalize = true;
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('invitation completion DB unavailable');
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized', paymentDecision: { state: 'pending' } });
    expect(mocks.state.kitchen_invitations[0]).toMatchObject({ status: 'accepted_pending_payment' });
    expect(mocks.state.kitchen_invitation_events).toHaveLength(0);
    mocks.failFinalize = false;
    await expect(decideAuthorizedBooking(1, 'confirmed')).resolves.toMatchObject({ success: true });
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paymentDecision: { state: 'complete' } });
    expect(mocks.state.kitchen_invitations[0]).toMatchObject({ status: 'accepted', bookingId: 1 });
    expect(mocks.state.kitchen_invitation_events).toEqual([expect.objectContaining({ invitationId: 'inv_one', kind: 'accepted', metadata: { bookingId: 1, preApproved: true } })]);
    await expect(decideAuthorizedBooking(1, 'confirmed')).resolves.toMatchObject({ recovered: true });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(expiry.lazy).not.toHaveBeenCalled();
    expect(mocks.state.kitchen_invitation_events).toHaveLength(1);
  }, 30_000);
});
