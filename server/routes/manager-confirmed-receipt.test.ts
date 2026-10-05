import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: null as any, payment: null as any, events: [] as any[],
  intent: vi.fn(), session: vi.fn(), capture: vi.fn(), create: vi.fn(), update: vi.fn(), notify: vi.fn() }));
vi.mock('../db', () => {
  const database = () => ({
    select: (fields: any) => {
      let table: any;
      const rows = () => {
        const name = table?.[Symbol.for('drizzle:Name')];
        if (name === 'kitchen_bookings') {
          if (fields?.chefId) return [{ chefId: 3, managerId: 2 }];
          if (fields?.booking) return [{ booking: state.booking, kitchen: { name: 'Fixture kitchen', checkinCheckoutEnabled: false },
            location: { name: 'Harbour', address: '1 Harbour Road' }, checklist: null }];
          return [state.booking];
        }
        if (name === 'users') return [{ id: 3, email: 'chef@example.test', role: 'chef' }, { id: 2, email: 'manager@example.test', role: 'manager' }, { id: 1, email: 'admin@example.test', role: 'admin' }];
        if (name === 'payment_transactions') return state.payment ? [{ amount: state.payment.amount, tax: state.payment.tax_amount, fee: state.payment.service_fee }] : [];
        if (name === 'booking_lifecycle_events') return state.events;
        return [];
      };
      const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain, leftJoin: () => chain,
        where: () => chain, limit: () => chain, for: () => chain, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      return chain;
    },
    update: (table: any) => ({ set: (values: any) => ({ where: () => {
      if (table[Symbol.for('drizzle:Name')] === 'kitchen_bookings') Object.assign(state.booking, values);
      const chain: any = { returning: async () => [{ id: 10 }], then: (resolve: any) => Promise.resolve([]).then(resolve) }; return chain;
    } }) }),
    insert: () => ({ values: async (event: any) => { state.events.push(event); } }),
  });
  return { db: { ...database(), transaction: async (run: any) => {
    const saved = structuredClone({ booking: state.booking, payment: state.payment, events: state.events });
    try { return await run(database()); }
    catch (error) { Object.assign(state, saved); throw error; }
  } }, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  getBookingById: async () => structuredClone(state.booking), getStorageBookingsByKitchenBooking: async () => [], getEquipmentBookingsByKitchenBooking: async () => [] } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 5 }) } }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationById: async () => ({ id: 5, managerId: 2 }) } }));
vi.mock('../services/stripe-service', async importOriginal => ({ ...await importOriginal<typeof import('../services/stripe-service')>(),
  getBookingPaymentIntent: state.intent, getBookingCheckoutSession: state.session, capturePaymentIntent: state.capture }));
vi.mock('../services/payment-transactions-service', async importOriginal => ({ ...await importOriginal<typeof import('../services/payment-transactions-service')>(),
  findPaymentTransactionByIntentId: async () => state.payment, createPaymentTransaction: state.create, updatePaymentTransaction: state.update }));
vi.mock('../services/notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: vi.fn() }));
import manager from './manager';
const handler = (manager as any).stack.find((entry: any) => entry.route?.path === '/bookings/:id/status' && entry.route.methods.put).route.stack.at(-1).handle;
const respond = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1');
  state.booking = { id: 10, chefId: 3, kitchenId: 4, status: 'pending', paymentStatus: 'processing', paymentIntentId: 'pi_fixture', paymentDecision: null,
    totalPrice: '1000', serviceFee: '70', storageItems: [], equipmentItems: [], bookingDate: new Date('2026-10-07'), startTime: '09:00', endTime: '10:00', updatedAt: new Date() };
  state.payment = { id: 90, booking_id: 10, booking_type: 'kitchen', chef_id: 3, manager_id: 2, currency: 'CAD', status: 'processing', amount: '1220', base_amount: '1150', tax_amount: '150', service_fee: '70', paid_at: null };
  state.events = [];
  state.intent.mockResolvedValue({ id: 'pi_fixture', currency: 'cad', status: 'succeeded', amount_received: 1220 });
  state.session.mockResolvedValue({ id: 'cs_fixture', status: 'complete', currency: 'cad', amount_total: 1220,
    metadata: { type: 'kitchen_booking', chef_id: '3', kitchen_id: '4', fee_model: 'separate-charge-commission-v1', total_price_cents: '1000', tax_cents: '150', platform_fee_cents: '70', tax_rate_percent: '15' } });
  state.update.mockImplementation(async (_id, values) => { Object.assign(state.payment, values); return state.payment; });
  state.create.mockImplementation(async values => { state.payment = { id: 90, booking_id: values.bookingId, booking_type: values.bookingType,
    chef_id: values.chefId, manager_id: values.managerId, amount: String(values.amount), base_amount: String(values.baseAmount),
    service_fee: String(values.serviceFee), tax_amount: String(values.taxAmount), status: values.status }; return state.payment; });
});
const confirm = async () => { const res = respond(); await handler({ params: { id: '10' }, body: { status: 'confirmed' }, neonUser: { id: 2, role: 'manager' } }, res); return res; };
describe('actual manager fallback → authoritative payment history → real rich queue (isolated provider/DB)', () => {
  it.each(['processing', 'paid'])('reconciles a still-processing local payment for a %s parent without recapture', async paymentStatus => {
    state.booking.paymentStatus = paymentStatus;
    const res = await confirm();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(state.payment.status).toBe('succeeded');
    const event = state.events.find(event => event.kind === 'confirmed');
    expect(event.emails[0].content.text).toContain('Payment captured: CAD $12.20 (tax CAD $1.50, service fee CAD $0.70)');
    expect(event.emails[0].content.attachments[0].content).toContain('UID:booking-10@localcooks.com');
    expect(state.capture).not.toHaveBeenCalled(); expect(state.session).not.toHaveBeenCalled();
  });
  it('restores a missing record from verified original checkout terms, then queues the honest receipt', async () => {
    state.payment = null;
    await confirm();
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1220, baseAmount: 1150, taxAmount: 150, serviceFee: 70 }), expect.anything());
    expect(state.events.find(event => event.kind === 'confirmed').emails[0].content.text).toContain('CAD $12.20');
    expect(state.capture).not.toHaveBeenCalled();
  });
  it('allows an owned review to resume confirmation once original evidence is available, without a pending paymentDecision or recapture', async () => {
    const checkout = await state.session();
    state.payment = null; state.session.mockResolvedValue(null);
    await confirm();
    expect(state.booking.status).toBe('pending');
    expect(state.booking.paymentDecision).toBeNull();
    state.session.mockResolvedValue(checkout);
    const res = await confirm();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(state.events.map(event => event.kind)).toEqual(['payment_recovery_needed', 'confirmed']);
    expect(state.capture).not.toHaveBeenCalled();
  });
  it.each(['missing_terms', 'mismatch', 'processing'])('keeps uncertainty pending and creates a deduplicated owned recovery task: %s', async reason => {
    if (reason === 'missing_terms') { state.payment = null; state.session.mockResolvedValue(null); }
    if (reason === 'mismatch') state.payment.amount = '9999';
    if (reason === 'processing') state.intent.mockResolvedValue({ id: 'pi_fixture', currency: 'cad', status: 'processing', amount_received: 0 });
    const res = await confirm();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CAPTURED_BOOKING_REVIEW_REQUIRED', recoveryRequired: true }));
    expect(state.booking.status).toBe('pending');
    expect(state.events.some(event => event.kind === 'confirmed')).toBe(false);
    expect(state.events[0]).toMatchObject({ kind: 'payment_recovery_needed', metadata: { capturedPaymentReview: true } });
    expect(state.events[0].emails.some((email: any) => email.to === 'admin@example.test')).toBe(true);
    await confirm(); expect(state.events).toHaveLength(1);
    expect(state.capture).not.toHaveBeenCalled();
  });
});
