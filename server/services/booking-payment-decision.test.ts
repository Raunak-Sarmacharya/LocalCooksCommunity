import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kitchenBookings, equipmentBookings, paymentTransactions } from '@shared/schema';
const mocks = vi.hoisted(() => ({ intent: vi.fn(), session: vi.fn(), capture: vi.fn(), cancel: vi.fn(),
  state: {} as Record<string, any[]>, failFinalize: false }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: mocks.intent, getBookingCheckoutSession: mocks.session,
  capturePaymentIntent: mocks.capture, cancelPaymentIntent: mocks.cancel }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./booking-linked-cancellation', () => ({ cancelLinkedBookingDates: vi.fn() }));
const expiry = vi.hoisted(() => ({ lazy: vi.fn() }));
const guard = vi.hoisted(() => ({ allowed: true }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
vi.mock('./auth-expiry-service', () => ({ AUTH_EXPIRY_HOURS: 24, lazyExpireKitchenBookingAuth: expiry.lazy }));
vi.mock('./booking-response-deadline', async () => {
  const { responseDeadlineForBooking } = await import('@shared/booking-response-deadline');
  return { getBookingResponseDeadline: async (booking: any) => booking.bookingDate
    ? responseDeadlineForBooking(booking, 'UTC') : new Date(booking.createdAt.getTime() + 24 * 3_600_000),
    getPartialAcceptanceWindow: async (_booking: any, now: Date) => ({ deadline: new Date(now.getTime() + 24 * 3_600_000), allowed: guard.allowed }) };
});
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const database = (state: Record<string, any[]>) => {
    const db: any = {
      select: () => ({ from: (table: any) => {
        const rows = () => state[name(table)] || [];
        const chain: any = { where: () => chain, limit: () => chain, for: () => chain, innerJoin: () => chain, leftJoin: () => chain,
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
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async () => 'Sam Taylor') }));
import { decideAuthorizedBooking, recordReplacementWithdrawal, BookingRequestExpired, answerPartialAcceptance, LAST_MINUTE_MESSAGE } from './booking-payment-decision';
import { db } from '../db';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
// Owner (Oct 17): a partial capture now follows the chef's acceptance of the kitchen's waiting proposal.
const PROPOSAL = '11111111-1111-4111-8111-111111111111';
function waitingProposal() {
  mocks.state.kitchen_bookings[0].partialAcceptance = { id: PROPOSAL, state: 'waiting', intentId: 'pi_fixture', actorId: 2,
    proposedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
    equipment: [{ id: 2, status: 'cancelled' }], declined: [{ id: 2, name: 'Mixer', cents: 1000 }], oldTotalCents: 2440, newTotalCents: 1220 };
}
const acceptProposal = () => decideAuthorizedBooking(1, 'confirmed', [], [{ equipmentBookingId: 2, action: 'cancelled' }], 3, undefined, { proposalId: PROPOSAL });
describe('durable booking capture recovery (isolated Stripe and transaction model)', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.failFinalize = false; guard.allowed = true;
    Object.assign(mocks.state, { kitchen_bookings: [{ id: 1, chefId: 3, kitchenId: 4, status: 'pending', paymentStatus: 'authorized',
      paymentIntentId: 'pi_fixture', updatedAt: new Date('2026-10-02'), storageItems: [], equipmentItems: [{ equipmentBookingId: 2 }] }],
      equipment_bookings: [{ id: 2, chefId: 3, kitchenBookingId: 1, totalPrice: '1000', status: 'pending', equipmentListingId: 8 }],
      payment_transactions: [{ id: 7, paymentIntentId: 'pi_fixture', metadata: {} }] });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    mocks.session.mockResolvedValue({ status: 'complete', currency: 'cad', amount_total: 2440,
      metadata: { type: 'kitchen_booking', chef_id: '3', kitchen_id: '4', fee_model: 'separate-charge-commission-v1',
        total_price_cents: '2000', tax_cents: '300', tax_rate_percent: '15', platform_fee_cents: '140', addon_prices: '{"s":[],"e":[[8,1000]]}' } });
  });
  it('leaves the booking pending and retains its frozen decision after capture timeout', async () => {
    mocks.capture.mockRejectedValue(new Error('timeout'));
    waitingProposal();
    await expect(acceptProposal()).rejects.toThrow('timeout');
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized',
      paymentDecision: { state: 'pending', amount: 1220, subtotal: 1000, commission: 70, tax: 150 } });
    expect(mocks.state.equipment_bookings[0].status).toBe('pending');
  });
  it('records captured money when capture wins a cancellation release, without releasing linked resources', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 2440 });
    mocks.cancel.mockRejectedValue(Error('Capture already succeeded'));
    await expect(decideAuthorizedBooking(1, 'cancelled')).rejects.toThrow('Paid funds are recorded');
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'paid', paymentDecision: { target: 'cancelled', state: 'pending' } });
    expect(mocks.state.payment_transactions[0]).toMatchObject({ status: 'succeeded', stripeStatus: 'succeeded' });
    expect(mocks.state.equipment_bookings[0]).toMatchObject({ kitchenBookingId: 1, status: 'pending' });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(vi.mocked(queueBookingLifecycleEvent).mock.calls.some(call => call[2] === 'payment_recovery_needed')).toBe(true);
  });
  it('recovers a captured payment after local finalization fails, without capturing again', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 1220 });
    mocks.failFinalize = true;
    waitingProposal();
    await expect(acceptProposal()).rejects.toThrow('DB unavailable');
    expect(mocks.state.kitchen_bookings[0].status).toBe('pending');
    mocks.failFinalize = false;
    await expect(decideAuthorizedBooking(1, 'confirmed')).resolves.toMatchObject({ success: true });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('pi_fixture', 1220, undefined, expect.stringMatching(/^booking-decision:/));
    expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', totalPrice: '1000',
      serviceFee: '70', equipmentItems: [{ equipmentBookingId: 2, rejected: true }], paymentDecision: { state: 'complete' } });
    expect(mocks.state.equipment_bookings[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
  });
  it('does not confirm a processing payment', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'processing' });
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('reconciliation');
    expect(mocks.state.kitchen_bookings[0].status).toBe('pending');
    expect(vi.mocked(queueBookingLifecycleEvent).mock.calls.some(call => call[2] === 'confirmed')).toBe(false);
  });
  it('hands the finalized approved state to the outbox in the same transaction, after capture verification', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 1220 });
    vi.mocked(queueBookingLifecycleEvent).mockImplementationOnce(async tx => {
      const [booking] = await tx.select().from(kitchenBookings);
      const [payment] = await tx.select().from(paymentTransactions);
      const [equipment] = await tx.select().from(equipmentBookings);
      expect(booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paymentDecision: { state: 'complete', amount: 1220 } });
      // A declined add-on never inflates the kitchen share (live #169: $57.50 shown for a $30.50 capture).
      expect(payment).toMatchObject({ status: 'succeeded', amount: '1220', managerRevenue: '1150' });
      expect(equipment).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    });
    waitingProposal();
    await acceptProposal();
    expect(mocks.state.kitchen_bookings[0].partialAcceptance).toMatchObject({ state: 'accepted', answeredBy: 3 });
    expect(queueBookingLifecycleEvent).toHaveBeenCalledWith(expect.anything(), 1, 'confirmed', expect.any(String), expect.any(String), 2, expect.objectContaining({ decisionId: expect.any(String) }));
  });
  it('does not change a persisted approval into rejection', async () => {
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow();
    await expect(decideAuthorizedBooking(1, 'cancelled')).rejects.toThrow('different payment decision');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each([
    [2, 'manager', 'declined', 'PHASE0 Main Kitchen couldn’t take your request', 'You declined Sam Taylor’s request'],
    [3, 'chef', 'withdrawn', 'Request withdrawn', 'Sam Taylor withdrew their request'],
  ])('releasing a request as user %i (%s) says who released it to each side (%s)', async (actorId, _role, kind, chefTitle, managerTitle) => {
    Object.assign(mocks.state.kitchen_bookings[0], { bookingDate: new Date('2026-10-19T12:00:00Z'), startTime: '12:00' });
    mocks.state.users = [{ id: actorId, role: _role }];
    mocks.state.kitchens = [{ id: 4, name: 'PHASE0 Main Kitchen' }];
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await decideAuthorizedBooking(1, 'cancelled', [], [], actorId);
    const metadata = vi.mocked(queueBookingLifecycleEvent).mock.calls.at(-1)![6] as any;
    expect(metadata.requestOutcome).toBe(kind);
    expect(metadata.roleText.chef.title).toBe(chefTitle);
    expect(metadata.roleText.manager.title).toBe(managerTitle);
    expect(JSON.stringify(metadata.roleText)).not.toMatch(/Storage in use/);
  });
  it('releases a historical uncaptured hold without reconstructing its missing fee terms or ledger', async () => {
    mocks.state.payment_transactions = [];
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'cancelled')).resolves.toMatchObject({ success: true, status: 'cancelled', authorizationVoided: true });
    await expect(decideAuthorizedBooking(1, 'cancelled')).resolves.toMatchObject({ success: true, status: 'cancelled', authorizationVoided: true, recovered: true });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.state.kitchen_bookings[0].paymentDecision.state).toBe('complete');
  });
  it('refuses confirmation at the short-notice deadline, before the 24h window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-14T19:00:00Z'));
      Object.assign(mocks.state.kitchen_bookings[0], { createdAt: new Date('2026-10-14T10:00:00Z'),
        bookingDate: '2026-10-14', startTime: '20:00', endTime: '21:00' });
      await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toBeInstanceOf(BookingRequestExpired);
      expect(expiry.lazy).toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('blocks partial capture when original item prices are missing', async () => {
    const session = await mocks.session(); delete session.metadata.addon_prices;
    mocks.session.mockResolvedValue(session);
    waitingProposal();
    await expect(acceptProposal()).rejects.toThrow('original checkout terms');
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('sends a checkout that priced storage before the cutover to review instead of capturing it', async () => {
    const session = await mocks.session(); session.metadata.addon_prices = '{"s":[[9,500]],"e":[[8,1000]]}';
    mocks.session.mockResolvedValue(session);
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('original checkout terms');
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('refuses to confirm a request past its 24-hour response deadline and releases the hold', async () => {
    mocks.state.kitchen_bookings[0].createdAt = new Date(Date.now() - 25 * 3_600_000);
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toBeInstanceOf(BookingRequestExpired);
    expect(expiry.lazy).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.state.kitchen_bookings[0].paymentDecision).toBeUndefined();
  });
  it('still confirms a request inside its response deadline', async () => {
    mocks.state.kitchen_bookings[0].createdAt = new Date(Date.now() - 23 * 3_600_000);
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('timeout');
    expect(expiry.lazy).not.toHaveBeenCalled();
  });
  // "Change request": the chef's earlier request is withdrawn because the new one was sent.
  describe('withdrawing a request the chef replaced', () => {
    const replacedBy = { bookingId: 11, reference: 'KB-NEW222', deadlineAt: '2099-01-01T15:00:00.000Z' };
    it('records the immutable withdrawal using stored payment evidence, with no provider call inside the transaction', async () => {
      mocks.state.payment_transactions[0].amount = '2440';
      await db.transaction(async tx => {
        const [original] = await tx.select().from(kitchenBookings).for('update');
        await recordReplacementWithdrawal(tx, original, replacedBy);
        expect(mocks.intent).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();
      });
      expect(mocks.state.kitchen_bookings[0].paymentDecision).toMatchObject({ target: 'cancelled', state: 'pending', replacedBy,
        authorizedAmount: 2440, storage: [], equipment: [{ id: 2, status: 'cancelled' }] });
      await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('different payment decision');
      expect(mocks.capture).not.toHaveBeenCalled();
    });

    it('never exposes an internal booking id in replacement recovery copy when no public reference exists', async () => {
      mocks.state.kitchen_bookings[0].referenceCode = null;
      mocks.cancel.mockRejectedValue(new Error('timeout'));
      await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 3, undefined, { replacedBy })).rejects.toThrow();
      const recovery = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(call => call[2] === 'payment_recovery_needed')!;
      expect(recovery[4]).toContain('your earlier request yet');
      expect(recovery[4]).not.toMatch(/#1|booking 1|request 1/);
    });
    beforeEach(() => { mocks.state.kitchen_bookings[0].referenceCode = 'KB-OLD111'; });
    it('releases the hold, tells only the chef (Request updated facts) and not the kitchen', async () => {
      mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
      await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 3, undefined, { replacedBy })).resolves.toMatchObject({ success: true, status: 'cancelled', authorizationVoided: true });
      expect(mocks.cancel).toHaveBeenCalledWith('pi_fixture');
      expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', paymentDecision: { state: 'complete', replacedBy } });
      const call = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(entry => entry[2] === 'cancelled')!;
      const metadata = call[6] as Record<string, any>;
      expect(metadata).toMatchObject({ recipientPolicy: 'chef', requestOutcome: 'replaced',
        replacementNotice: { variant: 'updated', oldRef: 'KB-OLD111', newRef: 'KB-NEW222', holdCents: 2440, deadlineAt: '2099-01-01T15:00:00.000Z' } });
      // Not the generic "request withdrawn" copy to either side, and never a notice to the kitchen.
      expect(metadata.roleText).toBeUndefined();
      expect(metadata.recipientPolicy).not.toBe('participants');
    });
    it('keeps the replaced context when a Stripe failure is retried by recovery (no options passed the second time)', async () => {
      mocks.cancel.mockRejectedValueOnce(new Error('Stripe timeout'));
      mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
      await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 3, undefined, { replacedBy })).rejects.toThrow('Stripe timeout');
      expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentDecision: { state: 'pending', replacedBy } });
      // Recovery: the old booking stays pending with a recorded release; the chef and Local Cooks hear, the kitchen does not.
      const recovery = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(entry => entry[2] === 'payment_recovery_needed')!;
      expect(recovery[3]).toBe('We’re releasing your earlier hold');
      expect(recovery[6]).toMatchObject({ recipientPolicy: 'chef', supportCase: true, replacementNotice: { variant: 'releasing', oldRef: 'KB-OLD111', newRef: 'KB-NEW222' } });
      mocks.intent.mockReset().mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
      await decideAuthorizedBooking(1, 'cancelled');
      expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'cancelled', paymentDecision: { state: 'complete', replacedBy } });
      const cancelled = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(entry => entry[2] === 'cancelled')!;
      expect(cancelled[6]).toMatchObject({ requestOutcome: 'replaced', recipientPolicy: 'chef' });
    });
    it('an ordinary withdrawal is unchanged: role-specific copy for both sides', async () => {
      mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
      await decideAuthorizedBooking(1, 'cancelled', [], [], 3);
      const metadata = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(entry => entry[2] === 'cancelled')![6] as Record<string, any>;
      expect(metadata.requestOutcome).toBe('withdrawn');
      expect(metadata.roleText.manager.title).toContain('withdrew their request');
      expect(metadata.replacementNotice).toBeUndefined();
    });
  });
  describe('single-day partial acceptance (owner, Oct 17)', () => {
    it('declining an item saves a proposal for the chef: nothing captured or released, hold and pending state kept', async () => {
      const result: any = await decideAuthorizedBooking(1, 'confirmed', [], [{ equipmentBookingId: 2, action: 'cancelled' }], 2);
      expect(result).toMatchObject({ success: true, status: 'pending', proposal: { state: 'waiting', oldTotalCents: 2440, newTotalCents: 1220,
        equipment: [{ id: 2, status: 'cancelled' }], declined: [{ id: 2, cents: 1000 }], actorId: 2 } });
      expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized', partialAcceptance: { state: 'waiting' } });
      expect(mocks.state.kitchen_bookings[0].paymentDecision).toBeUndefined();
      expect(mocks.state.equipment_bookings[0].status).toBe('pending');
      expect(queueBookingLifecycleEvent).toHaveBeenCalledWith(expect.anything(), 1, 'partial_acceptance_proposed', expect.any(String), expect.any(String), 2,
        expect.objectContaining({ recipientPolicy: 'chef' }));
    });
    it('last-minute guard: refuses the proposal with a clear 409 and leaves the request untouched', async () => {
      guard.allowed = false;
      const error = await decideAuthorizedBooking(1, 'confirmed', [], [{ equipmentBookingId: 2, action: 'cancelled' }], 2).catch(e => e);
      expect(error).toMatchObject({ status: 409, message: LAST_MINUTE_MESSAGE });
      expect(mocks.state.kitchen_bookings[0].partialAcceptance).toBeUndefined();
      expect(mocks.capture).not.toHaveBeenCalled(); expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
    });
    it('the guard never blocks accepting everything or declining (unchanged behaviour)', async () => {
      guard.allowed = false;
      mocks.capture.mockRejectedValue(new Error('timeout'));
      await expect(decideAuthorizedBooking(1, 'confirmed', [], [{ equipmentBookingId: 2, action: 'confirmed' }], 2)).rejects.toThrow('timeout');
      expect(mocks.capture).toHaveBeenCalledWith('pi_fixture', 2440, undefined, expect.any(String));
    });
    it('the chef declines: the whole hold is released and the proposal records the answer', async () => {
      waitingProposal();
      mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
      await answerPartialAcceptance(1, PROPOSAL, 'decline', 3);
      expect(mocks.cancel).toHaveBeenCalledOnce(); expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.state.kitchen_bookings[0]).toMatchObject({ status: 'cancelled', partialAcceptance: { state: 'declined', answeredBy: 3 },
        paymentDecision: { target: 'cancelled', proposal: { id: PROPOSAL, outcome: 'declined' } } });
      expect(vi.mocked(queueBookingLifecycleEvent).mock.calls.at(-1)![6]).toMatchObject({ partialAcceptance: { variant: 'declined', newCents: 1220, oldCents: 2440 } });
    });
    it('the kitchen cannot confirm (or re-propose) while the chef has not answered', async () => {
      waitingProposal();
      await expect(decideAuthorizedBooking(1, 'confirmed', [], [], 2)).rejects.toThrow('Waiting for the chef');
      await expect(decideAuthorizedBooking(1, 'confirmed', [], [{ equipmentBookingId: 2, action: 'cancelled' }], 2)).rejects.toThrow('Waiting for the chef');
      expect(mocks.capture).not.toHaveBeenCalled();
    });
    it('the chef withdrawing the request closes the proposal as declined', async () => {
      waitingProposal();
      mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
        .mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
      await decideAuthorizedBooking(1, 'cancelled', [], [], 3);
      expect(mocks.state.kitchen_bookings[0].partialAcceptance).toMatchObject({ state: 'declined' });
    });
  });
});
