import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ parent: null as any, sources: [] as any[], storage: [] as any[], equipment: [] as any[], extensions: [] as any[],
  crashAfterCancel: false, sweepNotices: [] as any[], inTransaction: false, managerId: 2, receipts: {} as Record<string, any[]>, providerStatus: 'succeeded', secondProviderPending: false, failResponse: false, feePending: false, calls: [] as any[], notices: vi.fn(), history: vi.fn(), goodwill: vi.fn(), frozen: false, failFunding: false, genericInsufficient: false, providerDown: false, visits: [] as any[], sweep: [] as any[] }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => connection.select(...args), update: (...args: any[]) => connection.update(...args), transaction: async (work: any) => { state.inTransaction = true; try { const result = await work(connection); if (state.crashAfterCancel && state.parent.equipmentItems?.some((row: any) => row.removal?.finalizationPending)) { state.crashAfterCancel = false; throw Error('Process stopped after commit'); } return result; } finally { state.inTransaction = false; } }, execute: async (query: any) => new PgDialect().sqlToQuery(query).sql.includes('FROM kitchen_bookings') ? ({ rows: state.sweepNotices }) : ({ rows: state.frozen ? [{ id: 1 }] : state.sweep }) } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.notices }));
vi.mock('./payment-transactions-service', () => ({ addPaymentHistory: state.history }));
vi.mock('./booking-linked-cancellation', () => ({ cancelledStorageStatus: 'cancelled', cancelLinkedBookingDates: async () => {
  for (const item of state.storage) { item.status = item.checkinStatus === 'checkin_completed' ? 'cancellation_requested' : 'cancelled'; item.cancellationAcceptedAt = new Date(); }
  for (const item of state.equipment) if (item.status !== 'completed') item.status = 'cancelled';
} }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Alex' }));
const days = vi.hoisted(() => ({ cancel: vi.fn(), quote: vi.fn() }));
vi.mock('./dated-booking-cancellation', async original => ({ ...(await original<typeof import('./dated-booking-cancellation')>()),
  cancelDatedDays: days.cancel, readDatedCancellationQuote: days.quote }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./stripe-service', () => ({ getCancellationReversalEvidence: async () => [], createRefund: state.goodwill, verifyCancellationRefundFunding: async () => ({ transferId: null, available: null }), getCancellationPaymentFacts: async (intent: string) => {
  if (state.feePending) throw Error('Actual card processing fee is not yet verified');
  const source = state.sources.find(row => row.paymentIntentId === intent);
  const refunds = state.receipts[intent] || [];
  return { captured: Number(source.amount), processingCost: 384, currency: 'cad', chargeId: `ch_${source.id}`,
    refunded: refunds.filter(row => row.status === 'succeeded').reduce((sum, row) => sum + row.amount, 0), refunds };
}, getPaymentIntentRefunds: async (intent: string) => state.receipts[intent] || [],
reverseTransferAndRefund: async (intent: string, amount: number, _reason: string, options: any) => {
  if (options.reservedOperation) expect(state.inTransaction).toBe(false);
  // The committed reservation is present before provider I/O.
  const source = state.sources.find(row => row.paymentIntentId === intent);
  if (source.metadata.cancellationRefundOperation) expect(source.metadata.cancellationRefundOperation.id).toBe(options.idempotencyKey);
  else expect(options.idempotencyKey).toMatch(/^support-/);
  const existing = (state.receipts[intent] || []).find(row => row.metadata.refund_operation_id === options.idempotencyKey);
  if (!existing && state.providerDown) throw Error('Stripe is unavailable');
  if (!existing && state.genericInsufficient) throw Error('Stripe platform balance is insufficient');
  if (!existing && state.failFunding && options.reverseTransferAmount > 0) throw Error('Failed to reverse transfer and refund: The required manager reversal exceeds the verified unreversed transfer. Separate funding approval is required.');
  const refund = existing || { id: `re_${source.id}`, amount, currency: 'cad', payment_intent: intent, charge: `ch_${source.id}`, status: state.secondProviderPending && source.id === 100 ? 'pending' : state.providerStatus, metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
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
        if (name === 'kitchen_bookings') return resolve(joined ? [{ booking: state.parent, managerId: state.managerId, kitchenName: 'Harbour kitchen' }] : [state.parent]);
        if (name === 'kitchens') return resolve([{ managerId: state.managerId }]);
        if (name === 'storage_bookings') return resolve(state.storage);
        if (name === 'equipment_bookings') return resolve(state.equipment);
        if (name === 'kitchen_booking_visits') return resolve(state.visits);
        if (name === 'equipment_listings') return resolve([{ name: 'Commercial Oven' }]);
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
import { acceptCancellationRefund, readCancellationRefund, retryCancellationRefund, refundSupportGoodwill, cancelKitchenCausedBooking, refundKitchenCausedAddons, requestChefCancellation, cancelChefBooking, readChefCancellationQuote, readChefAddonQuote, removeChefAddon, recoverChefAddonRefunds, ADDON_MONEY_REVIEW } from './booking-cancellation-refund';
describe('quoted parent cancellation reservation and provider recovery', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    state.parent = { id: 10, kitchenId: 4, chefId: 3, status: 'cancellation_requested', paymentStatus: 'paid', paymentIntentId: 'pi_original',
      bookingDate: new Date('2026-11-10T12:00:00Z'), startTime: '09:00', endTime: '11:00', selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }],
      operatingWindowStartTime: '08:00', cancellationPolicyHours: 24, cancellationRequestedAt: new Date('2026-11-01T11:00:00Z'), updatedAt: new Date('2026-11-01T11:00:00Z') };
    state.sources = [{ id: 99, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_original', status: 'succeeded',
      amount: '12200', baseAmount: '11500', managerRevenue: '11116', serviceFee: '700', refundAmount: '0', currency: 'CAD', metadata: {}, updatedAt: new Date('2026-11-01T11:00:00Z') }];
    state.storage = []; state.equipment = []; state.extensions = []; state.receipts = {}; state.providerStatus = 'succeeded'; state.secondProviderPending = false; state.failResponse = false; state.feePending = false; state.calls = []; state.managerId = 2; state.frozen = false; state.failFunding = false;
    state.goodwill.mockImplementation(async (intent: string, amount: number, _reason: string, options: any) => {
      const receipt = { id: 're_goodwill', charge: 'ch_99', amount, status: state.providerStatus,
        metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
      (state.receipts[intent] ||= []).push(receipt); return receipt;
    });
  });
  const reviewed = async () => await readCancellationRefund(10, 2, 'manager') as any;
  it('sends a Mon/Wed/Fri cancellation to the day engine instead of the single-session engine', async () => {
    Object.assign(state.parent, { status: 'confirmed', scheduleRevision: 1 });
    days.cancel.mockResolvedValue({ success: true, action: 'cancelled' });
    await cancelChefBooking(10, 3, 'dated-first-deadline', 'Plans changed', 3, 21313);
    expect(days.cancel).toHaveBeenCalledWith(10, { role: 'chef', id: 3 }, { target: { visitIds: undefined }, operationKey: 'dated-first-deadline', reason: 'Plans changed', expectedRefundCents: 21313 });
    expect(state.calls).toEqual([]); expect(state.parent.status).toBe('confirmed');
  });
  it('sourceComponents splits the 1664 service fee by 13052/14284 manager gross', async () => {
    state.parent.status = 'confirmed';
    Object.assign(state.sources[0], { amount: '29000', baseAmount: '27336', serviceFee: '1664', managerRevenue: '26952' });
    state.sources[0].metadata.capturedComponentAllocations = [13052, 14284].map(managerGrossCents => ({ kind: 'kitchen', bookingId: 10, managerGrossCents, sessionIndex: 0 }));
    // Different component ids, as on two visits, with the frozen first session kept equal to the parent.
    state.parent.cancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50,
      tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'America/St_Johns',
      sessions: [{ startAt: '2026-11-10T12:30:00Z' }, { startAt: '2026-11-12T12:30:00Z' }] };
    state.sources[0].metadata.capturedComponentAllocations[1].sessionIndex = 1;
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote.sources[0].perComponent.map((row: any) => row.platformCents)).toEqual([795, 869]);
  });
  describe('CP6: every dated cancellation command goes to the day engine', () => {
    const result = { success: true, state: 'refunded', refundCents: 21313, refundId: 're_day', managerPaysCents: 20053, localCooksPaysCents: 1260, processingCostAbsorbedCents: 0 };
    const chef = { role: 'chef', id: 3 }, kitchen = { role: 'manager', id: 2 };
    const paths = [
      ['chef cancellation quote', () => readChefCancellationQuote(10, 3, { visitIds: [11] }), days.quote, [10, chef, { visitIds: [11] }]],
      ['chef cancellation', () => cancelChefBooking(10, 3, 'dated-cancellation', undefined, 3, undefined, [11]), days.cancel, [10, chef, { target: { visitIds: [11] }, operationKey: 'dated-cancellation', reason: undefined, expectedRefundCents: undefined }]],
      ['support chef cancellation', () => requestChefCancellation(10, 3, 1, 'Chef called', 'support-dated', [11]), days.cancel, [10, chef, { target: { visitIds: [11] }, operationKey: 'support-dated', reason: 'Chef called', expectedRefundCents: undefined, supportActorId: 1 }]],
      ['chef add-on quote', () => readChefAddonQuote(10, 3, { kind: 'equipment', id: 20 }), days.quote, [10, chef, { equipmentIds: [20] }]],
      ['chef add-on removal', () => removeChefAddon(10, 3, { kind: 'equipment', id: 20 }, { operationKey: 'dated-removal', expectedRefundCents: 0 } as any), days.cancel, [10, chef, { target: { equipmentIds: [20] }, operationKey: 'dated-removal', expectedRefundCents: 0, reason: undefined }]],
      ['kitchen-caused cancellation', () => cancelKitchenCausedBooking(10, 2, 2, 'dated-kitchen-cancel', 'Oven repair', { visitIds: [12] }), days.cancel, [10, kitchen, { target: { visitIds: [12] }, operationKey: 'dated-kitchen-cancel', reason: 'Oven repair' }]],
      ['kitchen-caused add-on refund', () => refundKitchenCausedAddons(10, 2, 1, 'dated-addon-refund', [{ kind: 'equipment', id: 20 }]), days.cancel, [10, kitchen, { target: { equipmentIds: [20] }, operationKey: 'dated-addon-refund', supportActorId: 1 }]],
    ] as const;
    it.each(paths)('%s', async (_name, run, engine, args) => {
      Object.assign(state.parent, { status: 'confirmed', scheduleRevision: 1 });
      days.quote.mockResolvedValue({ quoteReady: true, lines: [{ paidCents: 2300 }], refundPercent: 100 }); days.cancel.mockResolvedValue(result);
      await run();
      expect(engine).toHaveBeenCalledWith(...args);
      expect(state.calls).toEqual([]); expect(state.goodwill).not.toHaveBeenCalled();
    });
    it('refuses Local Cooks-funded kitchen refunds (unpaid days are debited from their pending payout)', async () => {
      Object.assign(state.parent, { status: 'confirmed', scheduleRevision: 1 });
      await expect(cancelKitchenCausedBooking(10, 2, 1, 'dated-kitchen-cancel', undefined, { fundedByLocalCooks: true })).rejects.toThrow('applied automatically');
      expect(days.cancel).not.toHaveBeenCalled();
    });
    it('refuses the single-session request/accept flow for a dated booking', async () => {
      Object.assign(state.parent, { scheduleRevision: 1 });
      await expect(readCancellationRefund(10, 2, 'manager')).rejects.toThrow('per day');
      await expect(acceptCancellationRefund(10, 2, 'a'.repeat(64))).rejects.toThrow();
      expect(state.calls).toEqual([]);
    });
    it('refuses a per-day charge on a booking without a dated schedule', async () => {
      state.parent.status = 'confirmed'; state.sources[0].payoutPartition = 'per_day';
      await expect(readChefCancellationQuote(10, 3)).rejects.toThrow('needs Local Cooks review');
      expect(state.calls).toEqual([]);
    });
    it('sends Local Cooks goodwill on a dated booking without debiting any day', async () => {
      Object.assign(state.parent, { status: 'confirmed', scheduleRevision: 1 }); state.sources[0].payoutPartition = 'per_day';
      await refundSupportGoodwill(10, 2, 1, 100, 'dated-goodwill');
      expect(state.goodwill).toHaveBeenCalledWith('pi_original', 100, 'requested_by_customer', expect.objectContaining({ allocatedRefund: true,
        metadata: expect.objectContaining({ manager_debited: '0', platform_goodwill_cents: '100' }) }));
    });
  });
  it('quotes and self-serves the full refundable pool with no manager approval; replays once', async () => {
    state.parent.status = 'confirmed';
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote).toMatchObject({ chefRefundCents: 11816, feeRetainedCents: 384, kitchenShareRetainedCents: 0 });
    await cancelChefBooking(10, 3, 'chef-operation-one', undefined, 3, quote.chefRefundCents);
    expect(state.parent.status).toBe('cancelled'); expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ amount: 11816, options: { reverseTransferAmount: 11116, metadata: { platform_service_fee_returned: '700' } } });
    await cancelChefBooking(10, 3, 'chef-operation-one'); expect(state.calls).toHaveLength(1);
    expect(state.notices.mock.calls.filter(call => ['cancelled', 'refund_issued'].includes(call[2])).map(call => call[2])).toEqual(['cancelled']);
    await expect(cancelChefBooking(10, 3, 'chef-operation-two')).rejects.toThrow('another operation');
  });
  it('never refunds a paid session extension through the cancellation engine; only the booking payment is refunded', async () => {
    state.parent.status = 'confirmed';
    state.sources.push({ id: 101, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_extension', status: 'succeeded',
      amount: '3000', baseAmount: '2825', managerRevenue: '2708', serviceFee: '175', refundAmount: '0', currency: 'CAD',
      metadata: { type: 'session_extension', sessionExtensionId: 5, nonRefundable: true }, updatedAt: new Date('2026-11-01T11:00:00Z') });
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote.chefRefundCents).toBe(11816); expect(quote.sources.map((row: any) => row.intentId)).toEqual(['pi_original']);
    await cancelChefBooking(10, 3, 'chef-with-extension', undefined, 3, quote.chefRefundCents);
    expect(state.calls.map(call => call.intent)).toEqual(['pi_original']); expect(state.calls[0].amount).toBe(11816);
    expect(state.sources[1].metadata.cancellationRefundOperation).toBeUndefined();
  });
  it('keeps a frozen 50% short-notice policy and returns platform share automatically', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    state.parent.status = 'confirmed';
    state.parent.cancellationPolicySnapshot = { policyId: 10, version: 1, noticeHours: 72, lateChargePercent: 50,
      tiers: [{ minHoursBeforeStart: 72, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'America/St_Johns',
      sessions: [{ startAt: '2026-11-10T12:30:00Z' }], disclosureVersion: 'food-corridor-v1', acceptedAt: new Date().toISOString() };
    state.parent.cancellationPolicyHours = 24; // A live/legacy edit cannot replace the snapshot.
    expect((await readChefCancellationQuote(10, 3) as any).chefRefundCents).toBe(5908);
    await cancelChefBooking(10, 3, 'chef-half-operation');
    expect(state.calls[0]).toMatchObject({ amount: 5908, options: { reverseTransferAmount: 5558 } });
    expect(state.sources[0].metadata.cancellationRefundOperation.kitchenShareRetainedCents).toBe(5558);
  });
  it('allows a zero-refund cancellation without any Stripe refund', async () => {
    state.parent.status = 'confirmed'; state.parent.bookingDate = new Date('2020-01-01');
    await cancelChefBooking(10, 3, 'chef-no-refund');
    expect(state.parent.status).toBe('cancelled'); expect(state.calls).toHaveLength(0);
    expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', customerRefund: 0 });
  });
  it('quotes each frozen session separately on one captured source', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T12:30:00Z')); state.parent.status = 'confirmed';
    state.parent.cancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 100,
      tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 0 }], timezone: 'America/St_Johns',
      sessions: [{ startAt: '2026-11-10T12:30:00Z' }, { startAt: '2026-11-12T12:30:00Z' }] };
    state.sources[0].metadata.capturedComponentAllocations = [0, 1].map(sessionIndex => ({ kind: 'kitchen', bookingId: 10, managerGrossCents: 5750, sessionIndex }));
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote.chefRefundCents).toBe(5908); expect(quote.sources[0].perComponent.map((item: any) => item.refundPercent)).toEqual([0, 100]);
    await cancelChefBooking(10, 3, 'chef-two-sessions'); expect(state.calls[0].amount).toBe(5908);
  });
  it('refuses stale exact amounts, foreign chefs, and money flags before reserving', async () => {
    state.parent.status = 'confirmed';
    await expect(cancelChefBooking(10, 3, 'chef-stale-quote', undefined, 3, 999)).rejects.toThrow('refund changed');
    await expect(cancelChefBooking(10, 999, 'chef-wrong-owner')).rejects.toThrow('access denied');
    state.frozen = true; await expect(cancelChefBooking(10, 3, 'chef-flagged')).rejects.toThrow('paused');
    expect(state.parent.status).toBe('confirmed'); expect(state.calls).toHaveLength(0);
  });
  it('recovers a lost self-serve response using the same refund and funding shares', async () => {
    state.parent.status = 'confirmed'; state.failResponse = true;
    await cancelChefBooking(10, 3, 'chef-lost-response'); expect(state.parent.status).toBe('cancelled');
    expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('recovery_required');
    await cancelChefBooking(10, 3, 'chef-lost-response');
    expect(state.calls).toHaveLength(1); expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded');
  });
  it('manager kitchen cancellation replays without sending another full refund', async () => {
    state.parent.status = 'confirmed';
    await cancelKitchenCausedBooking(10, 2, 2, 'support-kitchen-replay', 'Kitchen equipment is unavailable');
    await cancelKitchenCausedBooking(10, 2, 2, 'support-kitchen-replay', 'Kitchen equipment is unavailable');
    expect(state.calls).toHaveLength(1); expect(state.parent.cancellationCause).toBe('kitchen');
  });
  it('unknown fee cancels instantly, holds entitlement and recovers at the original received time', async () => {
    state.parent.status = 'confirmed'; state.feePending = true;
    expect(await readChefCancellationQuote(10, 3)).toMatchObject({ quoteReady: false });
    await cancelChefBooking(10, 3, 'chef-pending-fee');
    expect(state.parent.status).toBe('cancelled'); expect(state.calls).toHaveLength(0);
    const received = state.sources[0].metadata.cancellationRefundOperation.acceptedAt;
    expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('fee_pending');
    state.feePending = false; await cancelChefBooking(10, 3, 'chef-pending-fee');
    expect(state.calls).toHaveLength(1); expect(state.calls[0].amount).toBe(11816);
    expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ acceptedAt: received, status: 'succeeded' });
  });
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
  it.each([100, 1000, 3000, 12000])('supports an admin-chosen goodwill amount of %i cents within captured funds', async amount => {
    state.parent.status = 'confirmed';
    await refundSupportGoodwill(10, 2, 77, amount, `support-variable-${amount}`);
    expect(state.sources[0].refundAmount).toBe(String(amount));
    expect(state.goodwill.mock.calls[0][3].metadata.platform_goodwill_cents).toBe(String(amount));
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
    expect(state.sources[0].status).toBe('refunded');
  });
  describe('when the money step fails after the kitchen cancels', () => {
    const failFirst = async (key = 'support-kitchen-fail') => {
      state.parent.status = 'confirmed'; state.sources[0].transferId = 'tr_kitchen'; state.failFunding = true;
      await expect(cancelKitchenCausedBooking(10, 2, 77, key, 'Kitchen equipment is unavailable')).rejects.toThrow('manager reversal');
    };
    it('keeps the cancellation, tells the chef the refund is on its way with the reference, and records the problem for Local Cooks', async () => {
      state.parent.referenceCode = 'KB-KITCHEN1';
      await failFirst();
      expect(state.calls).toHaveLength(0);
      expect(state.parent).toMatchObject({ status: 'cancelled', cancellationCause: 'kitchen', paymentStatus: 'paid' });
      expect(state.sources[0].metadata.kitchenCancellationRefund).toMatchObject({ id: 'support-kitchen-fail', status: 'pending', expectedCents: 12200, attempts: 1, error: expect.stringContaining('manager reversal') });
      const chef = state.notices.mock.calls.find((call: any[]) => call[2] === 'cancelled');
      expect(chef?.[3]).toBe('The kitchen can’t host your booking');
      expect(chef?.[4]).toMatch(/\$122\.00 is being refunded.*Reference KB-KITCHEN1.*Contact Local Cooks/);
      expect(chef?.[6].cancellationNotice).toMatchObject({ cause: 'kitchen', refundCents: 12200, reference: 'KB-KITCHEN1' });
      const admin = state.notices.mock.calls.filter((call: any[]) => call[6]?.recipientPolicy === 'admins');
      expect(admin).toHaveLength(1); expect(admin[0][6]).toMatchObject({ supportCase: true });
      expect(admin[0][4]).toContain('retry it or fund it from Local Cooks');
    });
    it('the checkout stays blocked from payouts while the refund is owed', async () => {
      await failFirst();
      expect(state.sources[0].metadata.kitchenCancellationRefund.status).not.toBe('succeeded');
      await expect(refundSupportGoodwill(10, 2, 77, 500, 'support-goodwill-while-owed')).rejects.toThrow('earlier refund needs review');
    });
    it('retrying under the original reference refunds once and tells the chef it was sent', async () => {
      await failFirst();
      state.failFunding = false;
      const result = await cancelKitchenCausedBooking(10, 2, 77, 'support-retry-new-key');
      expect(result.amountCents).toBe(12200);
      expect(state.calls).toHaveLength(1);
      expect(state.calls[0].options.idempotencyKey).toBe('support-kitchen-fail');
      expect(state.parent).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
      expect(state.sources[0].metadata.kitchenCancellationRefund).toMatchObject({ status: 'succeeded', refundId: 're_99' });
      expect(state.sources[0].metadata.kitchenCancellationRefund.error).toBeUndefined();
      expect(state.notices.mock.calls.filter((call: any[]) => call[3] === 'Your refund was sent')).toHaveLength(1);
      await cancelKitchenCausedBooking(10, 2, 77, 'support-retry-new-key');
      expect(state.calls).toHaveLength(1);
    });
    it('Local Cooks can fund the refund so the kitchen balance is never debited', async () => {
      await failFirst();
      const result = await cancelKitchenCausedBooking(10, 2, 77, 'support-fund-it', undefined, { fundedByLocalCooks: true });
      expect(result).toMatchObject({ amountCents: 12200, managerPaysCents: 0, localCooksPaysCents: 12200 });
      expect(state.calls[0].options.reverseTransferAmount).toBe(0);
      expect(state.calls[0].options.idempotencyKey).toBe('support-kitchen-fail');
      expect(state.history.mock.calls.at(-1)?.[1].metadata).toMatchObject({ fundedByLocalCooks: true });
    });
    it('a lost response adopts the original receipt instead of sending another refund', async () => {
      state.parent.status = 'confirmed'; state.sources[0].transferId = 'tr_kitchen'; state.failResponse = true;
      await expect(cancelKitchenCausedBooking(10, 2, 77, 'support-lost-response')).rejects.toThrow('response lost');
      expect(state.calls).toHaveLength(1);
      await cancelKitchenCausedBooking(10, 2, 77, 'support-lost-response');
      expect(state.calls).toHaveLength(1);
      expect(state.parent.paymentStatus).toBe('refunded');
    });
  });
  it('marks the payment refunded (not partially) when the kitchen-caused refund equals the amount', async () => {
    state.parent.status = 'confirmed'; state.sources[0].transferId = 'tr_kitchen'; state.sources[0].status = 'partially_refunded';
    await cancelKitchenCausedBooking(10, 2, 77, 'support-kitchen-full');
    expect(Number(state.sources[0].refundAmount)).toBeGreaterThanOrEqual(Number(state.sources[0].amount));
    expect(state.sources[0].status).toBe('refunded');
  });
  it('refunds a request whose card was charged before its release landed, and closes the stuck decision', async () => {
    Object.assign(state.parent, { status: 'pending', paymentDecision: { id: 'dec-1', target: 'cancelled', state: 'pending', intentId: 'pi_original',
      deadEnd: { kind: 'captured_before_release', at: '2026-11-01T11:30:00.000Z' } } });
    state.sources[0].transferId = 'tr_kitchen';
    const result = await cancelKitchenCausedBooking(10, 2, 77, 'support-captured-race');
    expect(result.amountCents).toBe(12200);
    expect(state.parent).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded',
      paymentDecision: { id: 'dec-1', state: 'complete', resolution: 'refunded_after_capture' } });
    const notice = state.notices.mock.calls.find((call: any[]) => call[2] === 'cancelled');
    expect(notice?.[3]).toBe('Your request was not accepted');
    expect(JSON.stringify(notice)).not.toMatch(/kitchen cancelled your booking/i);
  });
  it('does not take the captured-race path for a pending booking without that dead end', async () => {
    Object.assign(state.parent, { status: 'pending', paymentDecision: { id: 'dec-1', target: 'cancelled', state: 'pending', intentId: 'pi_original' } });
    await expect(cancelKitchenCausedBooking(10, 2, 77, 'support-no-dead-end')).rejects.toThrow();
    expect(state.calls).toHaveLength(0);
    state.parent.paymentDecision = { id: 'dec-2', target: 'confirmed', state: 'pending', deadEnd: { kind: 'captured_before_release', at: 'x' } };
    await expect(cancelKitchenCausedBooking(10, 2, 77, 'support-wrong-target')).rejects.toThrow();
    expect(state.calls).toHaveLength(0);
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
  it('support uses instant cancellation and keeps the internal note out of the notice', async () => {
    state.parent.status = 'confirmed'; await requestChefCancellation(10, 3, 77);
    expect(state.parent.status).toBe('cancelled'); expect(state.notices.mock.calls[0][5]).toBe(77);
    expect(state.calls[0].amount).toBe(11816);
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

describe('kitchen-caused add-on cancellation refunds the chef in full (policy R1)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    state.parent = { id: 10, kitchenId: 4, chefId: 3, status: 'confirmed', paymentStatus: 'paid', paymentIntentId: 'pi_original', bookingDate: new Date('2026-11-10T12:00:00Z'), startTime: '09:00', endTime: '11:00', updatedAt: new Date('2026-11-01T11:00:00Z') };
    state.sources = [{ id: 99, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_original', status: 'succeeded', amount: '12200', baseAmount: '11500', managerRevenue: '11116',
      serviceFee: '700', refundAmount: '0', currency: 'CAD', transferId: 'tr_kitchen', updatedAt: new Date('2026-11-01T11:00:00Z'),
      metadata: { capturedComponentAllocations: [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 9500 }, { kind: 'equipment', bookingId: 31, managerGrossCents: 2000 }] } }];
    state.storage = []; state.equipment = [{ id: 31, kitchenBookingId: 10, chefId: 3, paymentIntentId: 'pi_original', status: 'cancelled' }]; state.extensions = [];
    state.receipts = {}; state.providerStatus = 'succeeded'; state.calls = []; state.managerId = 2; state.frozen = false; state.failResponse = false;
  });
  it('refunds the full captured item amount, debits only the kitchen share and records the absorbed fee as platform-funded', async () => {
    const result = await refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-1', [{ kind: 'equipment', id: 31 }]);
    expect(result).toMatchObject({ amountCents: 2122, managerPaysCents: 1933, localCooksPaysCents: 189, processingCostAbsorbedCents: 67 });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ amount: 2122, options: { reverseTransferAmount: 1933, metadata: { customer_receives: '2122', manager_debited: '1933', platform_service_fee_returned: '122', platform_processing_cost_cents: '67' } } });
    // The kitchen entitlement drops by the kitchen share only; the card fee is never charged to the kitchen.
    expect(state.sources[0].metadata.refunds[0]).toMatchObject({ managerDebited: 1933, platformServiceFeeReturned: 122 });
    expect(state.sources[0].metadata.kitchenAddonRefunds).toEqual([expect.objectContaining({ kind: 'equipment', id: 31, operationKey: 'support-addon-key-1', refundCents: 2122, kitchenRefundCents: 1933 })]);
    expect(state.parent.paymentStatus).toBe('partially_refunded');
  });
  it('freezes a kitchen-caused add-on settlement so a later booking cancellation refunds the untouched kitchen time', async () => {
    state.parent.cancellationPolicySnapshot = { policyId: 10, version: 1, noticeHours: 24, lateChargePercent: 50,
      tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'America/St_Johns',
      sessions: [{ startAt: '2026-11-10T12:30:00Z' }], disclosureVersion: 'food-corridor-v3', acceptedAt: '2026-10-01T00:00:00Z' };
    await refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-settled', [{ kind: 'equipment', id: 31 }]);
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote).toMatchObject({ alreadyRefundedCents: 2122, chefRefundCents: 9761 });
  });
  it('replays without a second refund and refuses to refund the same add-on again', async () => {
    await refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-1', [{ kind: 'equipment', id: 31 }]);
    await refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-1', [{ kind: 'equipment', id: 31 }]);
    expect(state.calls).toHaveLength(1);
    await expect(refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-2', [{ kind: 'equipment', id: 31 }])).rejects.toThrow('already refunded');
    expect(state.calls).toHaveLength(1);
  });
  it('needs the add-on cancelled first and refuses shared charges with no frozen allocations', async () => {
    state.equipment[0].status = 'confirmed';
    await expect(refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-3', [{ kind: 'equipment', id: 31 }])).rejects.toThrow('Cancel the add-on first');
    state.equipment[0].status = 'cancelled'; delete state.sources[0].metadata.capturedComponentAllocations;
    await expect(refundKitchenCausedAddons(10, 2, 2, 'support-addon-key-4', [{ kind: 'equipment', id: 31 }])).rejects.toThrow('frozen');
    expect(state.calls).toHaveLength(0);
  });
});

describe('chef removes an add-on instantly under the booking’s frozen policy', () => {
  const OVEN = { kind: 'equipment' as const, id: 31 };
  const remove = (key = 'chef-oven-key-1', extra: Record<string, unknown> = {}) => removeChefAddon(10, 3, OVEN, { operationKey: key, ...extra });
  const noticeKinds = () => state.notices.mock.calls.map((call: any[]) => call[2]);
  const removalNotices = () => state.notices.mock.calls.filter((call: any[]) => call[2] === 'addon_removed');
  const policy = (late: number) => ({ policyId: 10, version: 1, noticeHours: 24, lateChargePercent: late, tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 100 - late }],
    timezone: 'America/St_Johns', sessions: [{ startAt: '2026-11-10T12:30:00Z' }], disclosureVersion: 'food-corridor-v3', acceptedAt: '2026-10-01T00:00:00Z' });
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    state.parent = { id: 10, kitchenId: 4, chefId: 3, status: 'confirmed', paymentStatus: 'paid', paymentIntentId: 'pi_original', referenceCode: 'KB-OVEN1', checkinStatus: 'not_checked_in',
      bookingDate: new Date('2026-11-10T12:00:00Z'), startTime: '09:00', endTime: '11:00', operatingWindowStartTime: '08:00', cancellationPolicyHours: 24,
      equipmentItems: [{ equipmentBookingId: 31, status: 'confirmed', totalPrice: 2000 }], storageItems: [], createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-11-01T11:00:00Z') };
    state.sources = [{ id: 99, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_original', status: 'succeeded', amount: '12200', baseAmount: '11500', managerRevenue: '11116',
      serviceFee: '700', refundAmount: '0', currency: 'CAD', updatedAt: new Date('2026-11-01T11:00:00Z'),
      metadata: { capturedComponentAllocations: [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 9500 }, { kind: 'equipment', bookingId: 31, managerGrossCents: 2000 }] } }];
    state.storage = []; state.extensions = []; state.visits = []; state.receipts = {}; state.providerStatus = 'succeeded'; state.calls = []; state.managerId = 2; state.frozen = false;
    state.failResponse = false; state.feePending = false; state.failFunding = false; state.genericInsufficient = false; state.providerDown = false; state.sweep = []; state.sweepNotices = []; state.crashAfterCancel = false;
    state.equipment = [{ id: 31, kitchenBookingId: 10, chefId: 3, equipmentListingId: 7, paymentIntentId: 'pi_original', status: 'confirmed', totalPrice: '2000', updatedAt: new Date('2026-11-01T11:00:00Z') }];
  });
  afterEach(() => vi.useRealTimers());

  it('quotes the part: its price, HST and service-fee share minus its share of the real card fee', async () => {
    const quote = await readChefAddonQuote(10, 3, OVEN) as any;
    expect(quote).toMatchObject({ quoteReady: true, free: false, lateCancel: false, itemName: 'Commercial Oven', itemPriceCents: 2000, chefRefundCents: 2055, feeRetainedCents: 67, retainedCents: 67 });
    expect(quote.sources).toHaveLength(1); expect(quote.sources[0]).toMatchObject({ capturedCents: 2122, kitchenRefundCents: 1933, platformRefundCents: 122 });
    expect(quote.snapshot.noticeHours).toBe(24);
    expect(state.calls).toHaveLength(0); expect(state.equipment[0].status).toBe('confirmed');
  });

  it('removes at once: add-on cancelled, booking stays confirmed, refunded once, kitchen share debited, one notice', async () => {
    const result = await remove('chef-oven-key-1', { expectedRefundCents: 2055 }) as any;
    expect(result).toMatchObject({ success: true, action: 'removed', state: 'removed', refundCents: 2055, free: false, lateCancel: false, itemName: 'Commercial Oven' });
    expect(state.equipment[0].status).toBe('cancelled'); expect(state.parent.status).toBe('confirmed');
    expect(state.parent.equipmentItems[0]).toMatchObject({ status: 'cancelled', removal: { operationKey: 'chef-oven-key-1', refundCents: 2055, noticeState: 'removed' } });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ amount: 2055, options: { reverseTransferAmount: 1933, metadata: { customer_receives: '2055', manager_debited: '1933', platform_service_fee_returned: '122' } } });
    expect(state.sources[0].metadata.refunds[0]).toMatchObject({ customerReceived: 2055, managerDebited: 1933, platformServiceFeeReturned: 122 });
    expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', chefInitiated: true, scope: OVEN, refundId: 're_99', customerRefund: 2055 });
    expect(state.sources[0].metadata.addonRemovals).toEqual([expect.objectContaining({ id: 31, refundCents: 2055, kitchenRefundCents: 1933 })]);
    expect(state.sources[0].stripeProcessingFee).toBe('384'); expect(state.sources[0].status).toBe('partially_refunded'); expect(state.parent.paymentStatus).toBe('partially_refunded');
    expect(removalNotices()).toHaveLength(1);
    expect(removalNotices()[0][6].addonRemoval).toMatchObject({ state: 'removed', itemName: 'Commercial Oven', refundCents: 2055, kitchenRefundCents: 1933, afterDeadline: false, free: false });
    expect(removalNotices()[0][4]).not.toMatch(/#31|#10|pi_|re_/);
    expect(noticeKinds()).not.toContain('cancelled'); expect(noticeKinds()).not.toContain('refund_issued');
  });

  it('refuses when the refund moved since the chef saw it, without changing anything', async () => {
    await expect(remove('chef-oven-key-2', { expectedRefundCents: 1000 })).rejects.toThrow('The refund changed. Review the new amount.');
    expect(state.equipment[0].status).toBe('confirmed'); expect(state.calls).toHaveLength(0); expect(state.notices).not.toHaveBeenCalled();
  });

  it('a $0 or never-charged add-on comes off with no money and no refund wording', async () => {
    state.equipment[0].totalPrice = '0';
    state.sources[0].metadata.capturedComponentAllocations[0].managerGrossCents = 11500;
    state.sources[0].metadata.capturedComponentAllocations[1].managerGrossCents = 0;
    const quote = await readChefAddonQuote(10, 3, OVEN) as any;
    expect(quote).toMatchObject({ quoteReady: true, free: true, chefRefundCents: 0, sources: [] });
    const result = await remove('chef-oven-free-1', { expectedRefundCents: 0 }) as any;
    expect(result).toMatchObject({ free: true, refundCents: 0, state: 'removed' }); expect(result.message).toContain('wasn’t charged');
    expect(state.equipment[0].status).toBe('cancelled'); expect(state.calls).toHaveLength(0);
    expect(state.sources[0].metadata.cancellationRefundOperation).toBeUndefined();
    expect(removalNotices()[0][6].addonRemoval).toMatchObject({ free: true, refundCents: 0 });
  });

  it('after the refund deadline it can still come off, but nothing is refunded and the chef is told before and after', async () => {
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    state.parent.cancellationPolicySnapshot = policy(100);
    const quote = await readChefAddonQuote(10, 3, OVEN) as any;
    expect(quote).toMatchObject({ quoteReady: true, lateCancel: true, free: false, chefRefundCents: 0, feeRetainedCents: 67 });
    const result = await remove('chef-oven-late-1', { expectedRefundCents: 0 }) as any;
    expect(result).toMatchObject({ lateCancel: true, refundCents: 0, state: 'removed' }); expect(result.message).toContain('isn’t refundable');
    expect(state.equipment[0].status).toBe('cancelled'); expect(state.parent.status).toBe('confirmed'); expect(state.calls).toHaveLength(0);
    expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', customerRefund: 0, lateCancel: true });
    expect(removalNotices()[0][6].addonRemoval).toMatchObject({ afterDeadline: true, refundCents: 0 });
  });

  it('uses the frozen 50% late tier instead of replacing every late add-on refund with zero', async () => {
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    state.parent.cancellationPolicySnapshot = policy(50);
    const quote = await readChefAddonQuote(10, 3, OVEN) as any;
    expect(quote).toMatchObject({ quoteReady: true, lateCancel: true, chefRefundCents: 1027, feeRetainedCents: 67, retainedCents: 1095 });
    expect(quote.sources[0]).toMatchObject({ kitchenRefundCents: 966, platformRefundCents: 61 });
    const result = await remove('chef-oven-half-late', { expectedRefundCents: 1027 }) as any;
    expect(result).toMatchObject({ state: 'removed', lateCancel: true, refundCents: 1027 });
    expect(state.calls[0]).toMatchObject({ amount: 1027, options: { reverseTransferAmount: 966 } });
    expect(removalNotices()[0][6].addonRemoval).toMatchObject({ afterDeadline: true, refundCents: 1027, kitchenRefundCents: 966 });
  });

  describe('every automatic money step has a way out', () => {
    it('Stripe fails: the removal stands, it is retried under the same key, Local Cooks hears once, the chef is told when it is sent', async () => {
      state.providerDown = true;
      const first = await remove('chef-oven-down-1') as any;
      expect(first).toMatchObject({ state: 'processing', refundCents: 2055 }); expect(first.message).toContain('being processed');
      expect(state.equipment[0].status).toBe('cancelled'); expect(state.parent.status).toBe('confirmed');
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'recovery_required', error: 'Stripe is unavailable' });
      expect(state.calls).toHaveLength(0);
      const admin = state.notices.mock.calls.filter((call: any[]) => call[6]?.recipientPolicy === 'admins');
      expect(admin).toHaveLength(1); expect(admin[0][2]).toBe('payment_recovery_needed'); expect(admin[0][4]).toMatch(/KB-OVEN1.*Commercial Oven.*\$20\.55/);
      expect(removalNotices()[0][6].addonRemoval).toMatchObject({ state: 'processing', refundCents: 2055 });
      // Provider back: the sweep (and the webhook) retry; one refund, then one "sent" notice.
      state.providerDown = false; state.sweep = [{ id: 99, booking_id: 10, manager_id: 2 }];
      await recoverChefAddonRefunds(3); await retryCancellationRefund(10, 2);
      expect(state.calls).toHaveLength(1); expect(state.calls[0].options.idempotencyKey).toBe(state.sources[0].metadata.cancellationRefundOperation.id);
      expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded');
      const sent = state.notices.mock.calls.filter((call: any[]) => call[2] === 'refund_issued');
      expect(sent).toHaveLength(1); expect(sent[0][6]).toMatchObject({ itemKind: 'equipment', itemId: 31, addonRemoval: { state: 'sent', refundCents: 2055 } });
      expect(removalNotices()).toHaveLength(1);
    });

    it('a lost provider response adopts the original receipt: never a second refund', async () => {
      state.failResponse = true;
      expect(await remove('chef-oven-lost-1')).toMatchObject({ state: 'processing' });
      expect(state.calls).toHaveLength(1);
      await retryCancellationRefund(10, 2);
      expect(state.calls).toHaveLength(1); expect(state.sources[0].metadata.cancellationRefundOperation.status).toBe('succeeded');
    });

    it('an admin retry uses a new refund key and the original reversal key', async () => {
      state.providerDown = true;
      await remove('chef-oven-admin-retry');
      const operation = state.sources[0].metadata.cancellationRefundOperation;
      state.providerDown = false;
      await retryCancellationRefund(10, 2, { selector: { transactionId: 99, refundOperationId: operation.id },
        supportOperationKey: 'support-retry-refund-1' });
      expect(state.calls[0].options).toMatchObject({
        idempotencyKey: operation.id,
        refundIdempotencyKey: `${operation.id}-refund-support-retry-refund-1`,
        reversalIdempotencyKey: `${operation.id}-reversal`,
      });
    });

    it('card fee not known yet: removed now, exact refund sent when the fee is confirmed, at the original removal time', async () => {
      state.feePending = true;
      const result = await remove('chef-oven-fee-1') as any;
      expect(result).toMatchObject({ state: 'fee_pending' }); expect(result.message).toContain('confirming the card fee');
      expect(state.equipment[0].status).toBe('cancelled'); expect(state.calls).toHaveLength(0);
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'fee_pending', chefInitiated: true });
      expect(removalNotices()[0][6].addonRemoval).toMatchObject({ state: 'fee_pending' });
      state.feePending = false; vi.setSystemTime(new Date('2026-11-10T13:00:00Z')); // later than the deadline: the original removal time still decides
      await retryCancellationRefund(10, 2);
      expect(state.calls).toHaveLength(1); expect(state.calls[0].amount).toBe(2055);
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', customerRefund: 2055 });
      expect(state.parent.equipmentItems[0].removal).toMatchObject({ refundCents: 2055, noticeState: 'sent' });
      expect(state.notices.mock.calls.filter((call: any[]) => call[2] === 'refund_issued')).toHaveLength(1);
    });

    it('settles fee-pending removal with the original 50% late tier once the card fee is known', async () => {
      vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
      state.parent.cancellationPolicySnapshot = policy(50); state.feePending = true;
      const removed = await remove('chef-oven-half-fee') as any;
      expect(removed).toMatchObject({ state: 'fee_pending', refundCents: 0 });
      state.feePending = false;
      await retryCancellationRefund(10, 2);
      expect(state.calls[0]).toMatchObject({ amount: 1027, options: { reverseTransferAmount: 966 } });
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', lateCancel: true, customerRefund: 1027 });
    });

    it('the kitchen share can’t be pulled back: the chef is still refunded, the debt is recorded, Local Cooks and the kitchen are told', async () => {
      state.sources[0].transferId = 'tr_kitchen'; state.failFunding = true;
      const result = await remove('chef-oven-debt-1') as any;
      expect(result).toMatchObject({ state: 'removed', refundCents: 2055, kitchenDebtCents: 1933 });
      expect(state.calls).toHaveLength(1); expect(state.calls[0]).toMatchObject({ amount: 2055, options: { reverseTransferAmount: 0, metadata: { manager_debited: '1933' } } });
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', kitchenDebtCents: 1933, platformFunding: true });
      const admin = state.notices.mock.calls.filter((call: any[]) => call[6]?.recipientPolicy === 'admins');
      expect(admin).toHaveLength(1); expect(admin[0][4]).toMatch(/KB-OVEN1.*\$19\.33.*kitchen/);
      expect(removalNotices()[0][6].addonRemoval).toMatchObject({ state: 'removed', kitchenDebtCents: 1933 });
    });

    it('keeps kitchen debt durable across a lost platform-funded refund response', async () => {
      state.sources[0].transferId = 'tr_kitchen'; state.failFunding = true; state.failResponse = true;
      expect(await remove('chef-oven-debt-lost')).toMatchObject({ state: 'processing', kitchenDebtCents: 1933 });
      expect(state.sources[0].metadata.kitchenRefundDebts).toContainEqual(expect.objectContaining({ amountCents: 1933, status: 'awaiting_refund' }));
      await retryCancellationRefund(10, 2);
      expect(state.calls).toHaveLength(1);
      expect(state.sources[0].metadata.kitchenRefundDebts).toContainEqual(expect.objectContaining({ amountCents: 1933, status: 'open', refundId: 're_99' }));
    });

    it('does not call an unrelated insufficient-platform error kitchen debt', async () => {
      state.sources[0].transferId = 'tr_kitchen'; state.genericInsufficient = true;
      expect(await remove('chef-oven-platform-low')).toMatchObject({ state: 'processing', kitchenDebtCents: 0 });
      expect(state.sources[0].metadata.cancellationRefundOperation).not.toHaveProperty('platformFunding');
      expect(state.sources[0].metadata.kitchenRefundDebts).toBeUndefined();
    });

    it('two taps, a retry and a webhook replay make one refund, one receipt record and one notice per side', async () => {
      // The parent row lock serialises real taps; the second one finds the saved removal.
      const a = await remove('chef-oven-tap-1'), b = await remove('chef-oven-tap-1');
      await remove('chef-oven-tap-1'); await retryCancellationRefund(10, 2); await retryCancellationRefund(10, 2);
      expect(a).toMatchObject({ refundCents: 2055 }); expect(b).toMatchObject({ refundCents: 2055 });
      expect(state.calls).toHaveLength(1); expect(state.sources[0].metadata.refunds).toHaveLength(1);
      expect(state.sources[0].metadata.addonRemovals).toHaveLength(1);
      expect(removalNotices()).toHaveLength(1); expect(noticeKinds().filter((kind: string) => kind === 'refund_issued')).toHaveLength(0);
      await expect(remove('chef-oven-other-key')).rejects.toThrow('already removed');
      expect(state.calls).toHaveLength(1);
    });

    it('a cancelled or started booking is refused plainly and no money moves', async () => {
      state.parent.status = 'cancelled';
      await expect(remove('chef-oven-gone-1')).rejects.toThrow('no longer active');
      state.parent.status = 'confirmed'; state.parent.checkinStatus = 'checked_in';
      await expect(remove('chef-oven-gone-2')).rejects.toThrow('already started');
      state.parent.checkinStatus = 'not_checked_in'; state.visits = [{ checkinStatus: 'checked_in', checkedInAt: new Date() }];
      await expect(remove('chef-oven-gone-3')).rejects.toThrow('already started');
      state.visits = []; state.equipment[0].status = 'cancellation_requested';
      await expect(remove('chef-oven-gone-4')).rejects.toThrow('already reviewing');
      expect(state.calls).toHaveLength(0); expect(state.notices).not.toHaveBeenCalled(); expect(state.sources[0].metadata.cancellationRefundOperation).toBeUndefined();
      await expect(removeChefAddon(10, 999, OVEN, { operationKey: 'chef-oven-wrong-chef' })).rejects.toThrow('access denied');
    });

    it('a payment that can’t be verified is refused before anything changes, with a plain message', async () => {
      state.frozen = true;
      await expect(readChefAddonQuote(10, 3, OVEN)).rejects.toThrow(ADDON_MONEY_REVIEW);
      await expect(remove('chef-oven-frozen-1')).rejects.toThrow('Local Cooks is reviewing this booking’s payment. Contact Local Cooks to remove it.');
      state.frozen = false; state.parent.paymentDecision = { state: 'pending' };
      await expect(remove('chef-oven-frozen-2')).rejects.toThrow(ADDON_MONEY_REVIEW);
      state.parent.paymentDecision = null; state.sources[0].metadata.refundRecovery = { attemptKey: 'old', status: 'recovery_required' };
      await expect(remove('chef-oven-frozen-3')).rejects.toThrow(ADDON_MONEY_REVIEW);
      expect(state.equipment[0].status).toBe('confirmed'); expect(state.calls).toHaveLength(0);
      expect(state.notices.mock.calls.filter((call: any[]) => call[2] === 'payment_recovery_needed')).toHaveLength(1);
    });

    it('never calls a missing source, a missing item payment link, or contradictory frozen money free', async () => {
      state.sources = [];
      await expect(readChefAddonQuote(10, 3, OVEN)).rejects.toThrow(ADDON_MONEY_REVIEW);
      expect(state.equipment[0].status).toBe('confirmed');

      state.parent.equipmentItems[0].paymentReviewNeeded = false;
      state.sources = [{ id: 99, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, paymentIntentId: 'pi_original', status: 'succeeded', amount: '12200', baseAmount: '11500', managerRevenue: '11116',
        serviceFee: '700', refundAmount: '0', currency: 'CAD', updatedAt: new Date('2026-11-01T11:00:00Z'), metadata: { capturedComponentAllocations: [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 9500 }, { kind: 'equipment', bookingId: 31, managerGrossCents: 2000 }] } }];
      state.equipment[0].paymentIntentId = null;
      await expect(readChefAddonQuote(10, 3, OVEN)).rejects.toThrow(ADDON_MONEY_REVIEW);

      state.parent.equipmentItems[0].paymentReviewNeeded = false; state.equipment[0].paymentIntentId = 'pi_original'; state.equipment[0].totalPrice = '0';
      await expect(readChefAddonQuote(10, 3, OVEN)).rejects.toThrow(ADDON_MONEY_REVIEW);
      expect(state.notices.mock.calls.filter((call: any[]) => call[2] === 'payment_recovery_needed')).toHaveLength(3);
      expect(state.calls).toHaveLength(0);
    });

    it('recovers notices after a process stops immediately after reserving a paid removal', async () => {
      state.crashAfterCancel = true;
      await expect(remove('chef-oven-crash-paid')).rejects.toThrow('Process stopped after commit');
      expect(state.parent.equipmentItems[0].removal).toMatchObject({ finalizationPending: true });
      expect(state.parent.equipmentItems[0].removal.noticeState).toBeUndefined();
      expect(removalNotices()).toHaveLength(0);
      state.sweep = [{ id: 99, booking_id: 10, manager_id: 2 }];
      state.sweepNotices = [{ id: 10, chef_id: 3, equipment_items: state.parent.equipmentItems }];
      await recoverChefAddonRefunds();
      expect(state.calls).toHaveLength(1); expect(removalNotices()).toHaveLength(1);
      expect(state.parent.equipmentItems[0].removal.finalizationPending).toBe(false);
    });

    it('recovers a free removal notice without any payment operation after a process stop', async () => {
      state.equipment[0].totalPrice = '0';
      state.sources[0].metadata.capturedComponentAllocations[0].managerGrossCents = 11500;
      state.sources[0].metadata.capturedComponentAllocations[1].managerGrossCents = 0;
      state.crashAfterCancel = true;
      await expect(remove('chef-oven-crash-free')).rejects.toThrow('Process stopped after commit');
      state.sweepNotices = [{ id: 10, chef_id: 3, equipment_items: state.parent.equipmentItems }];
      await recoverChefAddonRefunds();
      expect(state.calls).toHaveLength(0); expect(removalNotices()).toHaveLength(1);
      expect(removalNotices()[0][6].addonRemoval).toMatchObject({ free: true, refundCents: 0 });
    });

    it('the provider reconciliation path completes the add-on receipt and notices once', async () => {
      state.providerDown = true;
      await remove('chef-oven-webhook-path');
      const operation = state.sources[0].metadata.cancellationRefundOperation;
      state.providerDown = false;
      state.receipts.pi_original = [{ id: 're_webhook', amount: 2055, currency: 'cad', payment_intent: 'pi_original', charge: 'ch_99', status: 'succeeded', metadata: {
        refund_operation_id: operation.id, transaction_id: '99', customer_receives: '2055', manager_debited: '1933', platform_service_fee_returned: '122' } }];
      const { reconcilePaymentRefundReceipts } = await import('./payment-refund-reconciliation');
      await reconcilePaymentRefundReceipts('pi_original');
      expect(state.sources[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded', refundId: 're_webhook' });
      expect(state.notices.mock.calls.filter((call: any[]) => call[2] === 'refund_issued')).toHaveLength(1);
      await reconcilePaymentRefundReceipts('pi_original');
      expect(state.notices.mock.calls.filter((call: any[]) => call[2] === 'refund_issued')).toHaveLength(1);
    });
  });

  it('cancelling the whole booking later keeps the removed add-on’s refund as paid instead of re-quoting it', async () => {
    state.parent.cancellationPolicySnapshot = policy(50);
    await remove('chef-oven-early-1');
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z')); // inside the 24-hour window: 50% of the booking that is left
    const quote = await readChefCancellationQuote(10, 3) as any;
    expect(quote.alreadyRefundedCents).toBe(2055);
    expect(quote.chefRefundCents).toBe(4881);
    await cancelChefBooking(10, 3, 'chef-whole-after-oven', undefined, 3, quote.chefRefundCents);
    expect(state.calls).toHaveLength(2); expect(state.calls[1].amount).toBe(4881);
  });

  it('the kitchen can’t refund an add-on the chef already removed under the policy (no second refund)', async () => {
    await remove('chef-oven-then-kitchen-1');
    expect(state.calls).toHaveLength(1);
    state.sources[0].transferId = 'tr_kitchen';
    await expect(refundKitchenCausedAddons(10, 2, 2, 'support-addon-after-chef', [OVEN])).rejects.toThrow('already removed this add-on');
    expect(state.calls).toHaveLength(1);
  });

  it('removing two add-ons in a row refunds each its own part, independent of the other', async () => {
    state.parent.equipmentItems.push({ equipmentBookingId: 32, status: 'confirmed', totalPrice: 1000 });
    state.equipment.push({ id: 32, kitchenBookingId: 10, chefId: 3, equipmentListingId: 8, paymentIntentId: 'pi_original', status: 'confirmed', totalPrice: '1000', updatedAt: new Date('2026-11-01T11:00:00Z') });
    state.sources[0].metadata.capturedComponentAllocations = [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 8500 }, { kind: 'equipment', bookingId: 31, managerGrossCents: 2000 }, { kind: 'equipment', bookingId: 32, managerGrossCents: 1000 }];
    const rack = { kind: 'equipment' as const, id: 32 };
    const rackBefore = await readChefAddonQuote(10, 3, rack) as any;
    await removeChefAddon(10, 3, OVEN, { operationKey: 'chef-two-addons-1' });
    const rackAfter = await readChefAddonQuote(10, 3, rack) as any;
    expect(rackAfter.chefRefundCents).toBe(rackBefore.chefRefundCents);
    await removeChefAddon(10, 3, rack, { operationKey: 'chef-two-addons-1', expectedRefundCents: rackAfter.chefRefundCents });
    expect(state.calls.map(call => call.amount)).toEqual([2055, rackBefore.chefRefundCents]);
    expect(state.calls[0].options.idempotencyKey).not.toBe(state.calls[1].options.idempotencyKey);
    expect(state.sources[0].metadata.addonRemovals.map((row: any) => row.id)).toEqual([31, 32]);
    expect(state.equipment.map(item => item.status)).toEqual(['cancelled', 'cancelled']); expect(state.parent.status).toBe('confirmed');
    expect(removalNotices()).toHaveLength(2);
  });

  it('a completed new removal does not block legacy kitchen acceptance for another item on the same charge', async () => {
    state.parent.equipmentItems.push({ equipmentBookingId: 32, status: 'cancellation_requested', totalPrice: 1000 });
    state.equipment.push({ id: 32, kitchenBookingId: 10, chefId: 3, equipmentListingId: 8, paymentIntentId: 'pi_original', status: 'cancellation_requested', totalPrice: '1000', cancellationRequestedAt: new Date('2026-11-01T11:30:00Z'), updatedAt: new Date('2026-11-01T11:30:00Z') });
    state.sources[0].metadata.capturedComponentAllocations = [{ kind: 'kitchen', bookingId: 10, managerGrossCents: 8500 }, { kind: 'equipment', bookingId: 31, managerGrossCents: 2000 }, { kind: 'equipment', bookingId: 32, managerGrossCents: 1000 }];
    await remove('chef-oven-before-legacy');
    const quote = await readCancellationRefund(10, 2, 'manager', { kind: 'equipment', id: 32 }) as any;
    expect(quote).toMatchObject({ scope: { kind: 'equipment', id: 32 } });
    expect(quote.sources[0].managerRefund).toBe(1000);
  });

  it('reads as a money review for the support console and blocks goodwill while the add-on refund is unfinished', async () => {
    state.providerDown = true; await remove('chef-oven-review-1');
    await expect(refundSupportGoodwill(10, 2, 77, 500, 'support-goodwill-while-oven')).rejects.toThrow('earlier refund needs review');
  });
});
