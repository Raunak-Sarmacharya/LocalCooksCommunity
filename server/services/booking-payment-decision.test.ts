import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kitchenBookings, storageBookings, equipmentBookings, paymentTransactions } from '@shared/schema';
const mocks = vi.hoisted(() => ({ intent: vi.fn(), session: vi.fn(), capture: vi.fn(), cancel: vi.fn(),
  state: {} as Record<string, any[]>, failFinalize: false }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: mocks.intent, getBookingCheckoutSession: mocks.session,
  capturePaymentIntent: mocks.capture, cancelPaymentIntent: mocks.cancel }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./booking-linked-cancellation', () => ({ cancelLinkedBookingDates: vi.fn() }));
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
      update: (table: any) => ({ set: (values: any) => ({ where: async () => {
        if (name(table) === 'kitchen_bookings' && values.status && mocks.failFinalize) throw new Error('DB unavailable after Stripe success');
        for (const row of state[name(table)] || []) Object.assign(row, values);
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
import { decideAuthorizedBooking } from './booking-payment-decision';
describe('durable booking capture recovery (isolated Stripe and transaction model)', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.failFinalize = false;
    Object.assign(mocks.state, { kitchen_bookings: [{ id: 1, chefId: 3, kitchenId: 4, status: 'pending', paymentStatus: 'authorized',
      paymentIntentId: 'pi_fixture', updatedAt: new Date('2026-10-02'), storageItems: [{ storageBookingId: 2 }], equipmentItems: [] }],
      storage_bookings: [{ id: 2, chefId: 3, kitchenBookingId: 1, totalPrice: '1000', status: 'pending', storageListingId: 8 }],
      equipment_bookings: [], payment_transactions: [{ id: 7, paymentIntentId: 'pi_fixture', metadata: {} }] });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    mocks.session.mockResolvedValue({ status: 'complete', currency: 'cad', amount_total: 2440,
      metadata: { type: 'kitchen_booking', chef_id: '3', kitchen_id: '4', fee_model: 'separate-charge-commission-v1',
        total_price_cents: '2000', tax_cents: '300', tax_rate_percent: '15', platform_fee_cents: '140', addon_prices: '{"s":[[8,1000]],"e":[]}',
        selected_storage: '[{"storageListingId":8}]' } });
  });
  it('leaves the booking pending and retains its frozen decision after capture timeout', async () => {
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await expect(decideAuthorizedBooking(1, 'confirmed', [{ storageBookingId: 2, action: 'cancelled' }])).rejects.toThrow('timeout');
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized',
      paymentDecision: { state: 'pending', amount: 1220, subtotal: 1000, commission: 70, tax: 150 } });
    expect(mocks.state.storage_bookings[0].status).toBe('pending');
  });
  it('recovers a captured payment after local finalization fails, without capturing again', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 1220 });
    mocks.failFinalize = true;
    await expect(decideAuthorizedBooking(1, 'confirmed', [{ storageBookingId: 2, action: 'cancelled' }])).rejects.toThrow('DB unavailable');
    expect(mocks.state.kitchen_bookings[0].status).toBe('pending');
    mocks.failFinalize = false;
    await expect(decideAuthorizedBooking(1, 'confirmed')).resolves.toMatchObject({ success: true });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('pi_fixture', 1220, undefined, expect.stringMatching(/^booking-decision:/));
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', totalPrice: '1000',
      serviceFee: '70', storageItems: [{ storageBookingId: 2, rejected: true }], paymentDecision: { state: 'complete' } });
    expect(mocks.state.storage_bookings[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
  });
  it('does not confirm a processing payment', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'processing' });
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('reconciliation');
    expect(mocks.state.kitchen_bookings[0].status).toBe('pending');
  });
  it('does not change a persisted approval into rejection', async () => {
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow();
    await expect(decideAuthorizedBooking(1, 'cancelled')).rejects.toThrow('different payment decision');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('releases a historical uncaptured hold without reconstructing its missing fee terms or ledger', async () => {
    mocks.state.payment_transactions = [];
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'cancelled')).resolves.toMatchObject({ success: true, status: 'cancelled' });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.state.kitchen_bookings[0].paymentDecision.state).toBe('complete');
  });
  it('blocks partial capture when original item prices are missing', async () => {
    const session = await mocks.session(); delete session.metadata.addon_prices;
    mocks.session.mockResolvedValue(session);
    await expect(decideAuthorizedBooking(1, 'confirmed', [{ storageBookingId: 2, action: 'cancelled' }])).rejects.toThrow('original checkout terms');
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
