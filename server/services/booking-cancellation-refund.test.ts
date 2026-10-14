import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ parent: null as any, sources: [] as any[], storage: [] as any[], equipment: [] as any[], extensions: [] as any[],
  managerId: 2, receipts: {} as Record<string, any[]>, providerStatus: 'succeeded', secondProviderPending: false, failResponse: false, calls: [] as any[], notices: vi.fn(), history: vi.fn(), goodwill: vi.fn(), frozen: false }));
vi.mock('../db', () => ({ db: { transaction: async (work: any) => work(connection) } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.notices }));
vi.mock('./payment-transactions-service', () => ({ addPaymentHistory: state.history }));
vi.mock('./booking-linked-cancellation', () => ({ cancelledStorageStatus: 'cancelled', cancelLinkedBookingDates: async () => {
  for (const item of state.storage) { item.status = item.checkinStatus === 'checkin_completed' ? 'cancellation_requested' : 'cancelled'; item.cancellationAcceptedAt = new Date(); }
  for (const item of state.equipment) if (item.status !== 'completed') item.status = 'cancelled';
} }));
vi.mock('./stripe-service', () => ({ createRefund: state.goodwill, verifyCancellationRefundFunding: async () => ({ transferId: null, available: null }), getCancellationPaymentFacts: async (intent: string) => {
  const source = state.sources.find(row => row.paymentIntentId === intent);
  const refunds = state.receipts[intent] || [];
  return { captured: Number(source.amount), processingCost: 384, currency: 'cad', chargeId: `ch_${source.id}`,
    refunded: refunds.filter(row => row.status === 'succeeded').reduce((sum, row) => sum + row.amount, 0), refunds };
}, getPaymentIntentRefunds: async (intent: string) => state.receipts[intent] || [],
reverseTransferAndRefund: async (intent: string, amount: number, _reason: string, options: any) => {
  // The committed reservation is present before provider I/O.
  const source = state.sources.find(row => row.paymentIntentId === intent);
  if (source.metadata.cancellationRefundOperation) expect(source.metadata.cancellationRefundOperation.id).toBe(options.idempotencyKey);
  else expect(options.idempotencyKey).toMatch(/^support-/);
  const existing = (state.receipts[intent] || []).find(row => row.metadata.refund_operation_id === options.idempotencyKey);
  const refund = existing || { id: `re_${source.id}`, amount, status: state.secondProviderPending && source.id === 100 ? 'pending' : state.providerStatus, metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
  if (!existing) { (state.receipts[intent] ||= []).push(refund); state.calls.push({ intent, amount, options }); }
  if (state.failResponse) { state.failResponse = false; throw Error('Provider response lost'); }
  if (refund.status !== 'succeeded') throw Error(`Original refund ${refund.status}`);
  return { refundId: refund.id, refundAmount: amount, refundStatus: refund.status };
} }));
const params = (value: any) => new PgDialect().sqlToQuery(value).params;
const connection: any = {
  execute: async () => ({ rows: state.frozen ? [{ id: 1 }] : [] }),
  select: (fields: any) => {
    let table: any, joined = false, condition: any;
    const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => { joined = true; return chain; },
      where: (value: any) => { condition = value; return chain; }, limit: () => chain, for: () => chain, orderBy: () => chain,
      then: (resolve: any) => {
        const name = getTableName(table);
        if (name === 'kitchen_bookings') return resolve(joined ? [{ booking: state.parent, managerId: state.managerId }] : [state.parent]);
        if (name === 'kitchens') return resolve([{ managerId: state.managerId }]);
        if (name === 'storage_bookings') return resolve(state.storage);
        if (name === 'equipment_bookings') return resolve(state.equipment);
        if (name === 'pending_storage_extensions') return resolve(state.extensions);
        if (name === 'payment_transactions') {
          const values = condition ? params(condition) : [];
          return resolve(values.length === 1 ? state.sources.filter(row => row.id === values[0] || row.paymentIntentId === values[0]) : fields?.id ? state.sources.map(row => ({ id: row.id })) : state.sources);
        }
        return resolve([]);
      } }; return chain;
  },
  update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => {
    const name = getTableName(table), id = params(condition)[0];
    const target = name === 'kitchen_bookings' ? state.parent : name === 'storage_bookings' ? state.storage.find(row => row.id === id)
      : name === 'equipment_bookings' ? state.equipment.find(row => row.id === id) : state.sources.find(row => row.id === id);
    Object.assign(target, value);
    return { returning: async () => [target], then: (resolve: any) => resolve() };
  } }) }),
};
import { acceptCancellationRefund, readCancellationRefund, retryCancellationRefund, refundSupportGoodwill, cancelKitchenCausedBooking, requestChefCancellation } from './booking-cancellation-refund';
describe('quoted parent cancellation reservation and provider recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    state.parent = { id: 10, kitchenId: 4, chefId: 3, status: 'cancellation_requested', paymentStatus: 'paid', paymentIntentId: 'pi_original',
      bookingDate: new Date('2026-11-10T12:00:00Z'), startTime: '09:00', endTime: '11:00', selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }],
      operatingWindowStartTime: '08:00', cancellationPolicyHours: 24, cancellationRequestedAt: new Date('2026-11-01T11:00:00Z'), updatedAt: new Date('2026-11-01T11:00:00Z') };
    state.sources = [{ id: 99, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_original', status: 'succeeded',
      amount: '12200', baseAmount: '11500', managerRevenue: '11116', serviceFee: '700', refundAmount: '0', currency: 'CAD', metadata: {}, updatedAt: new Date('2026-11-01T11:00:00Z') }];
    state.storage = []; state.equipment = []; state.extensions = []; state.receipts = {}; state.providerStatus = 'succeeded'; state.secondProviderPending = false; state.failResponse = false; state.calls = []; state.managerId = 2; state.frozen = false;
    state.goodwill.mockImplementation(async (intent: string, amount: number, _reason: string, options: any) => {
      const receipt = { id: 're_goodwill', charge: 'ch_99', amount, status: state.providerStatus,
        metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
      (state.receipts[intent] ||= []).push(receipt); return receipt;
    });
  });
  const reviewed = async () => await readCancellationRefund(10, 2, 'manager') as any;
  it('sends goodwill on the original charge without reversing the kitchen transfer and reconciles its allocation', async () => {
    state.parent.status = 'confirmed'; state.sources[0].transferId = 'tr_kitchen';
    const result = await refundSupportGoodwill(10, 2, 77, 1000, 'support-goodwill');
    expect(result.refundId).toBe('re_goodwill'); expect(state.calls).toHaveLength(0);
    expect(state.goodwill.mock.calls[0][3]).toMatchObject({ idempotencyKey: 'support-goodwill', metadata: {
      manager_debited: '0', platform_goodwill_cents: '1000', support_actor_id: '77' } });
    expect(state.goodwill.mock.calls[0][3].reverseTransfer).toBeUndefined();
    expect(state.sources[0].managerRevenue).toBe('11116'); expect(state.sources[0].transferId).toBe('tr_kitchen');
    expect(state.sources[0].refundAmount).toBe('1000');
  });
  it('refuses goodwill beyond the remaining captured payment, during an open flag, and for a pending refund', async () => {
    state.parent.status = 'confirmed';
    await expect(refundSupportGoodwill(10, 2, 77, 12201, 'support-goodwill')).rejects.toThrow('remaining payment');
    state.frozen = true;
    await expect(refundSupportGoodwill(10, 2, 77, 1000, 'support-goodwill')).rejects.toThrow('paused');
    state.frozen = false; state.providerStatus = 'pending';
    await expect(refundSupportGoodwill(10, 2, 77, 1000, 'support-goodwill')).rejects.toThrow('still being checked');
  });
  it('fully refunds a kitchen failure, records platform processing cost and cancels the linked items', async () => {
    state.parent.status = 'confirmed'; state.sources[0].transferId = 'tr_kitchen';
    const result = await cancelKitchenCausedBooking(10, 2, 77, 'support-kitchen-failure');
    expect(result.amountCents).toBe(12200); expect(state.calls[0]).toMatchObject({ amount: 12200, options: { reverseTransferAmount: 11116,
      metadata: { platform_processing_cost_cents: '384', platform_service_fee_returned: '700', support_actor_id: '77' } } });
    expect(state.parent.status).toBe('cancelled'); expect(state.parent.paymentStatus).toBe('refunded');
    expect(state.sources[0].refundAmount).toBe('12200');
  });
  it('refuses a kitchen-caused full refund with already used or separately charged add-ons', async () => {
    state.parent.status = 'confirmed'; state.storage = [{ id: 20, kitchenBookingId: 10, chefId: 3, paymentIntentId: 'pi_original', status: 'confirmed', checkinStatus: 'checkin_completed' }];
    await expect(cancelKitchenCausedBooking(10, 2, 77, 'support-kitchen-failure')).rejects.toThrow('linked payments');
    expect(state.calls).toHaveLength(0);
  });
  it('requires allocation review for kitchen cancellation after a goodwill refund', async () => {
    state.parent.status = 'confirmed';
    state.receipts.pi_original = [{ id: 're_goodwill', status: 'succeeded', amount: 1000,
      metadata: { customer_receives: '1000', manager_debited: '0', platform_service_fee_returned: '0', platform_goodwill_cents: '1000' } }];
    await expect(cancelKitchenCausedBooking(10, 2, 77, 'support-kitchen-failure')).rejects.toThrow('funding review');
    expect(state.calls).toHaveLength(0);
  });
  it('uses the existing chef request/cutoff path and keeps the internal note out of the notice', async () => {
    state.parent.status = 'confirmed'; await requestChefCancellation(10, 3, 77);
    expect(state.parent.status).toBe('cancellation_requested'); expect(state.notices.mock.calls[0][5]).toBe(77);
    state.parent.status = 'confirmed'; state.parent.bookingDate = new Date('2026-11-01');
    await expect(requestChefCancellation(10, 3, 77)).rejects.toThrow('deadline');
  });
  it('shows the $122 quote and reserves before refund, then deduplicates acceptance', async () => {
    const quote = await reviewed(); expect(quote.sources[0]).toMatchObject({ managerRefund: 11116, serviceFeeReview: 700, processingCost: 384 });
    const accepted = await acceptCancellationRefund(10, 2, quote.quoteHash) as any;
    expect(accepted.accepted).toBe(true); expect(accepted.sources[0].operation).toMatchObject({ status: 'succeeded', refunded: 11116 });
    await acceptCancellationRefund(10, 2, quote.quoteHash); expect(state.calls).toHaveLength(1); expect(state.sources[0].status).toBe('partially_refunded');
  });
  it('requires the shown quote and rejects stale source versions without money movement', async () => {
    await expect(acceptCancellationRefund(10, 2, '')).rejects.toThrow('acknowledge');
    const quote = await reviewed(); state.sources[0].updatedAt = new Date('2026-11-01T12:00:00Z');
    await expect(acceptCancellationRefund(10, 2, quote.quoteHash)).rejects.toThrow('changed'); expect(state.calls).toHaveLength(0);
  });
  it('recovers a lost provider response without another refund', async () => {
    const quote = await reviewed(); state.failResponse = true;
    const result = await acceptCancellationRefund(10, 2, quote.quoteHash) as any;
    expect(result.sources[0].operation.status).toBe('recovery_required');
    await retryCancellationRefund(10, 2); expect(state.calls).toHaveLength(1); expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded');
  });
  it.each(['pending', 'failed'])('keeps a provider %s operation visible/reserved, then verifies the same receipt', async status => {
    const quote = await reviewed(); state.providerStatus = status;
    const result = await acceptCancellationRefund(10, 2, quote.quoteHash) as any;
    expect(result.sources[0].operation.status).toBe('recovery_required'); expect(state.sources[0].refundAmount).toBe('0');
    await retryCancellationRefund(10, 2); expect(state.calls).toHaveLength(1);
    state.receipts.pi_original[0].status = 'succeeded'; await retryCancellationRefund(10, 2);
    expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded'); expect(state.calls).toHaveLength(1);
  });
  it('requires current manager ownership and strict saved request/acceptance cutoff', async () => {
    await expect(readCancellationRefund(10, 9, 'manager')).rejects.toThrow('access');
    state.parent.cancellationRequestedAt = new Date('2026-11-10T12:00:00Z'); await expect(reviewed()).rejects.toThrow('cutoff');
  });
  it('excludes damage and penalty charges sharing parent identity', async () => {
    state.sources.push({ ...state.sources[0], id: 100, paymentIntentId: 'pi_claim', metadata: { type: 'damage_claim' } },
      { ...state.sources[0], id: 101, paymentIntentId: 'pi_penalty', metadata: { type: 'overstay_penalty' } });
    expect((await reviewed()).sources.map((row: any) => row.transactionId)).toEqual([99]);
  });
  it('blocks a used-storage bundle with no frozen allocations instead of refunding used money', async () => {
    state.storage.push({ id: 77, kitchenBookingId: 10, chefId: 3, status: 'confirmed', paymentIntentId: 'pi_original', checkinStatus: 'checkin_completed',
      startDate: new Date('2026-10-31'), endDate: new Date('2026-11-12'), updatedAt: new Date('2026-11-01'), checkoutStatus: 'active' });
    await expect(reviewed()).rejects.toThrow('frozen component'); expect(state.calls).toHaveLength(0);
  });
  it('retains allocated occupied storage money and its reservation after parent cancellation', async () => {
    state.storage.push({ id: 77, kitchenBookingId: 10, chefId: 3, status: 'confirmed', paymentIntentId: 'pi_original', checkinStatus: 'checkin_completed',
      startDate: new Date('2026-10-31'), endDate: new Date('2026-11-12'), updatedAt: new Date('2026-11-01'), checkoutStatus: 'active' });
    state.sources[0].metadata.capturedComponentAllocations = [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 9500 }, { kind: 'storage', bookingId: 77, managerGrossCents: 2000 }];
    const quote = await reviewed(); expect(quote.sources[0].managerRefund).toBe(9116);
    await acceptCancellationRefund(10, 2, quote.quoteHash); expect(state.storage[0].status).toBe('cancellation_requested'); expect(state.storage[0].kitchenBookingId).toBe(10);
  });
  it('quotes selected unused storage without cancelling its parent or spending the kitchen component', async () => {
    state.parent.status = 'confirmed';
    state.storage.push({ id: 77, kitchenBookingId: 10, chefId: 3, status: 'cancellation_requested', paymentIntentId: 'pi_original', checkinStatus: 'not_checked_in',
      cancellationRequestedAt: new Date('2026-11-01T11:00:00Z'), startDate: new Date('2026-11-08'), endDate: new Date('2026-11-12'), updatedAt: new Date('2026-11-01'), checkoutStatus: 'active' });
    state.sources[0].metadata.capturedComponentAllocations = [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 9500 }, { kind: 'storage', bookingId: 77, managerGrossCents: 2000 }];
    const scope = { kind: 'storage' as const, id: 77 };
    const quote = await readCancellationRefund(10, 2, 'manager', scope) as any;
    expect(quote.sources[0]).toMatchObject({ managerRefund: 2000, serviceFeeReview: 0 });
    await acceptCancellationRefund(10, 2, quote.quoteHash, scope);
    expect(state.parent.status).toBe('confirmed'); expect(state.calls[0].amount).toBe(2000);
  });
  it('tracks multiple sources independently when only one provider refund succeeds', async () => {
    state.sources.push({ ...state.sources[0], id: 100, paymentIntentId: 'pi_adjustment', metadata: { kitchenChangeId: 'historical', originalBookingPaymentIntentId: 'pi_original' } });
    const quote = await reviewed(); expect(quote.sources).toHaveLength(2); state.secondProviderPending = true;
    await acceptCancellationRefund(10, 2, quote.quoteHash);
    expect(state.calls.map(item => item.intent)).toEqual(['pi_original', 'pi_adjustment']);
    expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded');
    expect(state.sources[1].metadata.cancellationRefundOperation.status).toBe('recovery_required');
  });
  it('does not infer equipment use from booking-date midnight before a zero-hour cutoff', async () => {
    state.equipment.push({ id: 88, kitchenBookingId: 10, chefId: 3, status: 'confirmed', paymentIntentId: 'pi_original', startDate: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01') });
    const quote = await reviewed(); expect(quote.items[0].paymentTreatment).toBe('unused_manager_share_refund');
  });
  it('recovers allocated provider receipts when the aggregate webhook preceded the lost route commit', async () => {
    const quote = await reviewed(); state.failResponse = true;
    await acceptCancellationRefund(10, 2, quote.quoteHash);
    state.sources[0].refundAmount = '11116'; // Earlier aggregate-only callback did not establish an allocation.
    const { reconcilePaymentRefundReceipts } = await import('./payment-refund-reconciliation');
    const result = await reconcilePaymentRefundReceipts('pi_original', connection);
    expect(result.operation.status).toBe('succeeded'); expect(result.money.receipts[0].managerDebited).toBe(11116);
    await retryCancellationRefund(10, 2); expect(state.calls).toHaveLength(1);
  });
  it('preserves a previous interrupted direct refund reservation until verified provider recovery', async () => {
    state.sources[0].metadata.refundRecovery = { attemptKey: 'old-direct-operation', status: 'recovery_required' };
    await expect(reviewed()).rejects.toThrow('previous direct refund'); expect(state.calls).toHaveLength(0);
  });
  it('recovers an admin fee return and its pending decision after the provider succeeds before local commit', async () => {
    const requestedAt = '2026-11-01T11:00:00Z';
    state.sources[0].metadata = {
      fullRefundRequest: { status: 'pending', requestedAt, reason: 'Return platform fee' },
      refundRecovery: { attemptKey: `admin-refund-99-${requestedAt}`, status: 'recovery_required' },
    };
    state.receipts.pi_original = [{ id: 're_admin', amount: 700, status: 'succeeded', metadata: {
      refund_operation_id: `admin-refund-99-${requestedAt}`, refund_model: 'admin_controlled', approved_by: '1', transaction_id: '99',
      customer_receives: '700', manager_debited: '0', platform_service_fee_returned: '700',
    } }];
    const { reconcilePaymentRefundReceipts } = await import('./payment-refund-reconciliation');
    await reconcilePaymentRefundReceipts('pi_original', connection);
    expect(state.sources[0].metadata.fullRefundRequest).toMatchObject({ status: 'approved', approvedAmount: 700, decidedBy: 1 });
    expect(state.sources[0].metadata.refundRecovery.status).toBe('succeeded');
    expect(state.sources[0].metadata.refunds[0]).toMatchObject({ managerDebited: 0, platformServiceFeeReturned: 700 });
    expect(state.calls).toHaveLength(0);
  });
});
