import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({ claim: null as any, booking: {} as any, visit: {} as any, source: null as any,
  actions: [] as any[], evidence: [] as any[], history: [] as any[], events: [] as string[], queries: [] as string[],
  due: [] as any[], flag: false, insufficient: false, failTransfer: false, create: vi.fn(), retrieve: vi.fn(), list: [] as any[], transfer: vi.fn(), balance: vi.fn(), cancel: vi.fn(), refund: vi.fn() }));
vi.mock('../db', () => {
  const db: any = {
    transaction: async (run: any) => { const result = await run(db); state.events.push('commit'); return result; },
    execute: async (query: any) => { state.queries.push(new PgDialect().sqlToQuery(query).sql); return { rows: state.flag ? [{ id: 1 }] : [] }; },
    select: (fields?: any) => { let table = '', limit: number | undefined, ordered = false, condition: any;
      const chain: any = { from: (value: any) => { table = getTableName(value); return chain; }, where: (value: any) => { condition = value; return chain; },
        innerJoin: () => chain, leftJoin: () => chain, for: () => chain,
        orderBy: () => { ordered = true; return chain; }, limit: (n: number) => { limit = n; return chain; },
        then: (resolve: any) => {
          if (table === 'damage_claims') {
            if (fields?.bookingId && Object.keys(fields).length === 1) return resolve(state.claim ? [{ bookingId: state.claim.kitchenBookingId }] : []);
            if (ordered && limit && fields === undefined) { state.queries.push(`DUE LIMIT ${limit}`); return resolve(state.due); }
            return resolve(state.claim ? [state.claim] : []);
          }
          if (table === 'kitchen_bookings') return resolve(fields?.booking ? [{ booking: state.booking, timezone: 'America/St_Johns', managerId: 2, locationId: 3, kitchenName: 'Maya’s kitchen' }] : [state.booking]);
          if (table === 'kitchen_booking_visits') return resolve([state.visit]);
          if (table === 'users') return resolve([{ customerId: 'cus_platform', accountId: 'acct_kitchen', stripeAccountId: 'acct_kitchen' }]);
          if (table === 'payment_transactions') return resolve(state.source ? [state.source] : []);
          if (table === 'support_actions' && condition) {
            const query = new PgDialect().sqlToQuery(condition);
            if (query.sql.includes('"operation_key"')) return resolve(state.actions.filter(action => query.params.includes(action.operationKey)));
          }
          return resolve(table === 'support_actions' ? state.actions : table === 'damage_evidence' ? state.evidence : table === 'damage_claim_history' ? state.history : []);
        } }; return chain; },
    insert: (value: any) => ({ values: (input: any) => {
      const apply = () => { const table = getTableName(value), row = { createdAt: new Date(), id: table === 'support_actions' ? state.actions.length + 1 : 1, ...input };
        if (table === 'damage_claims') state.claim = row;
        if (table === 'support_actions') state.actions.push(row);
        if (table === 'damage_claim_history') state.history.push(row);
        if (table === 'payment_transactions') state.source = row;
        if (table === 'damage_evidence') state.evidence.push(...(Array.isArray(input) ? input.map(item => ({ createdAt: new Date(), ...item })) : [row]));
        state.events.push(`insert:${table}`); return [row]; };
      return { returning: async () => apply(), then: (resolve: any) => resolve(apply()) };
    } }),
    update: (value: any) => ({ set: (input: any) => ({ where: (condition: any) => {
      const apply = () => { const table = getTableName(value); state.events.push(`update:${table}`);
        if (table === 'damage_claims') state.claim = { ...state.claim, ...input };
        if (table === 'payment_transactions') state.source = { ...state.source, ...input };
        if (table === 'support_actions') {
          const params = new PgDialect().sqlToQuery(condition).params;
          Object.assign(state.actions.find(action => params.includes(action.id)) || {}, input);
        }
        return [table === 'damage_claims' ? state.claim : { id: 1, ...input }]; };
      return { returning: async () => apply(), then: (resolve: any) => resolve(apply()) };
    } }) }),
  }; return { db };
});
vi.mock('stripe', () => ({ default: class { paymentIntents = { create: state.create, retrieve: state.retrieve, cancel: state.cancel,
    list: () => ({ async *[Symbol.asyncIterator]() { for (const item of state.list) yield item; } }) };
  transfers = { create: state.transfer }; balance = { retrieve: state.balance }; refunds = { create: state.refund, retrieve: state.refund }; } }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => 'DC-TEST' }));
vi.mock('./damage-claim-notices', () => ({ queueDamageClaimNotice: async () => { state.events.push('notice'); } }));
import { decideDamageClaim, disputeDamageClaim, escalateDamageClaims, fileDamageClaim, readBookingClaims, replyToClaimReview, damageClaimsReviewFirst, notifyDamageClaimBookingHolds } from './damage-claims-v2';
import { prepareClaimPayment, settleClaimPayment, sendClaimKitchenMoney, recoverDamageClaimMoney } from './damage-claim-money';
import { chargeApprovedClaim, adminDecision } from './damage-claim-service';
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
vi.mock('../email', () => ({ getSubdomainUrl: () => 'https://example.invalid' }));

const now = new Date('2026-10-14T18:00:00Z');
const cost = { type: 'damage', description: 'Repair cracked tray', amountCents: 2000, document: { fileUrl: 'https://example.invalid/quote.pdf', fileName: 'quote.pdf' } };
const action = (type: string, extra = {}) => ({ claimId: 1, type, reasonCode: 'evidence', note: 'We reviewed the evidence privately.',
  publicMessage: 'We reviewed both statements and the receipts.', operationKey: `claim:action:${type}`, requestSource: 'proactive', ...extra });
const intent = () => ({ id: 'pi_claim', status: 'succeeded', amount_received: 2000, amount: 2000, currency: 'cad', customer: 'cus_platform',
  latest_charge: 'ch_claim', metadata: { type: 'damage_claim', damage_claim_v2: 'true', damage_claim_id: '1', chef_id: '5', booking_id: '7',
    claim_operation_key: state.claim?.paymentOperation?.key } });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('STRIPE_SECRET_KEY', 'test_only'); vi.clearAllMocks();
  state.events = []; state.queries = []; state.actions = []; state.evidence = []; state.history = []; state.due = []; state.source = null;
  state.flag = false; state.insufficient = false; state.failTransfer = false;
  state.booking = { id: 7, chefId: 5, status: 'completed', bookingDate: new Date('2026-10-14'), startTime: '09:00', endTime: '11:00',
    operatingWindowStartTime: null, stripeCustomerId: 'cus_platform', stripePaymentMethodId: 'pm_saved' };
  state.visit = { id: 9, bookingId: 7, startTime: '09:00', endTime: '11:00', checkoutRequestedAt: new Date('2026-10-14T13:30:00Z'),
    checkinPhotoUrls: ['https://example.invalid/before.jpg'], checkoutPhotoUrls: ['https://example.invalid/after.jpg'], checkinNotes: 'Clean on arrival', checkoutNotes: 'Tray cracked' };
  state.claim = { id: 1, kitchenBookingId: 7, kitchenBookingVisitId: 9, bookingType: 'kitchen', claimVersion: 2, status: 'submitted', chefId: 5,
    managerId: 2, locationId: 3, claimedAmountCents: 2000, finalAmountCents: 2000, costLines: [cost], chefOwes: true, checkoutAttempt: 0,
    chefResponseDeadline: new Date(now.getTime() + 72 * 3600000), chefVisibleAt: now, fundedBy: 'chef' };
  state.create.mockImplementation(async (params) => { state.events.push('stripe:create'); return { id: 'pi_claim', client_secret: 'mock_client_secret', ...params, status: 'requires_confirmation' }; });
  state.retrieve.mockImplementation(async () => ({ ...intent(), latest_charge: { id: 'ch_claim', balance_transaction: { fee: 88 } } }));
  state.transfer.mockImplementation(async () => { state.events.push('stripe:transfer'); if (state.failTransfer) throw Error('Provider timeout'); return { id: 'tr_claim' }; });
  state.balance.mockImplementation(async () => { state.events.push('stripe:balance'); return { available: [{ currency: 'cad', amount: state.insufficient ? 0 : 100000 }] }; });
  state.cancel.mockResolvedValue({ id: 'pi_claim', status: 'canceled' });
  state.refund.mockResolvedValue({ id: 're_claim', status: 'succeeded' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('itemized filing and dispute', () => {
  it('files into private first review with auto-attached photos and notes; the chef clock has not started', async () => {
    state.claim = null;
    const result = await fileDamageClaim(2, { bookingId: 7, visitId: 9, description: 'A tray was cracked during the visit.', lines: [cost], requestKey: 'file:claim:one' });
    expect(result.amountCents).toBe(2000); expect(state.claim.status).toBe('in_review'); expect(state.claim.chefVisibleAt).toBeNull();
    expect(state.claim.visitEvidence).toMatchObject({ before: ['https://example.invalid/before.jpg'], checkoutNotes: 'Tray cracked' });
    expect(state.evidence).toHaveLength(3); expect(state.create).not.toHaveBeenCalled();
  });
  it('rejects missing receipts and expired filing without making a payment', async () => {
    await expect(fileDamageClaim(2, { bookingId: 7, description: 'A damaged tray needs repair', lines: [{ ...cost, document: undefined }], requestKey: 'file:claim:two' })).rejects.toThrow(/receipt/);
    state.claim = null; state.visit.checkoutRequestedAt = new Date('2026-10-01');
    await expect(fileDamageClaim(2, { bookingId: 7, visitId: 9, description: 'A damaged tray needs repair', lines: [cost], requestKey: 'file:claim:two' })).rejects.toThrow(/72 hours/);
    expect(state.create).not.toHaveBeenCalled();
  });
  it('requires a dispute note, saves optional photos, and opens review without charging', async () => {
    await expect(disputeDamageClaim(1, 5, { note: 'No' })).rejects.toThrow(/10 characters/);
    await disputeDamageClaim(1, 5, { note: 'The tray was cracked when I arrived.', photos: [{ fileUrl: 'https://example.invalid/chef.jpg', fileName: 'chef.jpg' }] });
    expect(state.claim.status).toBe('under_review'); expect(state.evidence[0].uploadedBy).toBe(5); expect(state.create).not.toHaveBeenCalled();
  });
  it('escalates exactly at the deadline in a bounded page and returns immediately when empty', async () => {
    await expect(escalateDamageClaims()).resolves.toEqual([]); expect(state.history).toHaveLength(0); expect(state.queries).toContain('DUE LIMIT 3');
    state.claim.chefResponseDeadline = now; state.due = [state.claim];
    expect(await escalateDamageClaims()).toHaveLength(1); expect(state.claim.status).toBe('under_review'); expect(state.create).not.toHaveBeenCalled();
  });
});
describe('review-first amendment', () => {
  it('defaults to review first and hides the whole claim, including evidence, from the chef', async () => {
    expect(await damageClaimsReviewFirst()).toBe(true);
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null; state.due = [state.claim];
    const result = await readBookingClaims(7, { id: 5, role: 'chef' });
    expect(result.claims).toEqual([]);
    await expect(prepareClaimPayment(1, 5)).rejects.toThrow(/cannot be paid/);
  });
  it('an account with a manager role that booked as chef still cannot see first-review claims', async () => {
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null; state.due = [state.claim];
    expect((await readBookingClaims(7, { id: 5, role: 'manager' })).claims).toEqual([]);
  });
  it('sending a reduced first-review claim starts a fresh 72-hour clock without starting a booking hold', async () => {
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null;
    await decideDamageClaim(7, 99, action('claim_send', { amountCents: 1500 }));
    expect(state.claim).toMatchObject({ status: 'submitted', finalAmountCents: 1500, chefVisibleAt: now });
    expect(state.claim.chefResponseDeadline.getTime() - now.getTime()).toBe(72 * 3600000); expect(state.claim.upheldAt).toBeUndefined();
    expect(state.claim.adminDecisionReason).toBe(action('claim_send').publicMessage);
  });
  it('pauses for kitchen info and a note/upload returns it to first review', async () => {
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null;
    await decideDamageClaim(7, 99, action('claim_ask_info'));
    expect(state.claim.status).toBe('awaiting_kitchen');
    await replyToClaimReview(1, 2, { note: 'Here is the replacement quote.', files: [cost.document] });
    expect(state.claim.status).toBe('in_review'); expect(state.evidence).toHaveLength(1); expect(state.claim.chefVisibleAt).toBeNull();
  });
  it('first-review compensation closes with no chef debt even if an old client asks to keep the debt', async () => {
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null;
    await decideDamageClaim(7, 99, action('claim_compensate', { amountCents: 2000, chefStillOwes: true }));
    expect(state.claim).toMatchObject({ status: 'resolved', chefOwes: false, chefVisibleAt: null, fundedBy: 'local_cooks' });
  });
  it('withdraws an unpaid private claim with no Stripe calls or chef cost', async () => {
    state.claim.status = 'in_review'; state.claim.chefVisibleAt = null;
    await decideDamageClaim(7, 99, action('claim_withdraw'));
    expect(state.claim).toMatchObject({ status: 'resolved', chefOwes: false, resolutionType: 'withdrawn' });
    expect(state.claim.withdrawalOperation.state).toBe('succeeded'); expect(state.create).not.toHaveBeenCalled();
  });
  it('withdraws a paid claim with an idempotent full platform-funded refund and leaves kitchen money intact', async () => {
    await prepareClaimPayment(1, 5); await settleClaimPayment(intent() as any);
    await decideDamageClaim(7, 99, action('claim_withdraw')); await decideDamageClaim(7, 99, action('claim_withdraw'));
    expect(state.refund).toHaveBeenCalledTimes(1); expect(state.refund.mock.calls[0][0]).toMatchObject({ payment_intent: 'pi_claim', amount: 2000 });
    expect(state.source).toMatchObject({ status: 'refunded', transferId: 'tr_claim', refundAmount: '2000', netAmount: '0' });
    expect(state.transfer).toHaveBeenCalledTimes(1); expect(state.claim.withdrawalOperation).toMatchObject({ state: 'succeeded', refundId: 're_claim' });
  });
});
describe('explicit chef payments', () => {
  it('persists before creating an unconfirmed platform intent and reuses it on repeat taps', async () => {
    await prepareClaimPayment(1, 5); await prepareClaimPayment(1, 5);
    expect(state.events.indexOf('commit')).toBeLessThan(state.events.indexOf('stripe:create'));
    expect(state.create).toHaveBeenCalledTimes(1);
    const [params, options] = state.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 2000, customer: 'cus_platform', payment_method: 'pm_saved', capture_method: 'automatic' });
    for (const field of ['off_session', 'confirm', 'transfer_data', 'application_fee_amount']) expect(params).not.toHaveProperty(field);
    expect(options.idempotencyKey).toBe(state.claim.paymentOperation.key);
  });
  it('allows a new card without trusting an arbitrary payment method from the client', async () => {
    await prepareClaimPayment(1, 5, true); expect(state.create.mock.calls[0][0]).not.toHaveProperty('payment_method');
    await expect(prepareClaimPayment(1, 99)).rejects.toThrow(/not found/);
  });
  it('does not return a client secret or resurrect an intent cancelled during creation', async () => {
    state.create.mockImplementation(async params => {
      state.claim.paymentOperation = { ...state.claim.paymentOperation, state: 'cancel_pending' };
      state.claim.withdrawalOperation = { key: 'claim:1:withdraw', state: 'pending', startedAt: now.toISOString(), amountCents: 2000 };
      return { id: 'pi_claim', client_secret: 'mock_client_secret', ...params, status: 'requires_confirmation' };
    });
    await expect(prepareClaimPayment(1, 5)).rejects.toThrow(/claim changed/);
    expect(state.claim.paymentOperation.state).toBe('cancel_pending');
  });
  it('validates provider truth and pays the kitchen in full, recording the Stripe fee as platform cost', async () => {
    await prepareClaimPayment(1, 5);
    await expect(settleClaimPayment({ ...intent(), amount_received: 1 } as any)).rejects.toThrow(/saved decision/);
    await settleClaimPayment(intent() as any); await settleClaimPayment(intent() as any);
    expect(state.claim.chefOwes).toBe(false); expect(state.transfer).toHaveBeenCalledTimes(1);
    expect(state.transfer.mock.calls[0][0]).toMatchObject({ amount: 2000, source_transaction: 'ch_claim', destination: 'acct_kitchen' });
    expect(state.source).toMatchObject({ managerRevenue: '2000', stripeProcessingFee: '88', transferId: 'tr_claim', payoutTiming: 'at_capture' });
    expect(state.source.metadata.platformProcessingCostCents).toBe(88);
  });
  it('cannot charge through either retired legacy entry point', async () => {
    expect((await chargeApprovedClaim(1)).success).toBe(false);
    expect((await adminDecision(1, 99, { decision: 'approve', decisionReason: 'Reviewed' })).success).toBe(false);
    expect(state.create).not.toHaveBeenCalled();
  });
});
describe('support decisions and compensation', () => {
  it('notifies both sides once when a final upheld claim becomes seven days overdue', async () => {
    state.claim.status = 'approved'; state.claim.upheldAt = new Date(now.getTime() - 7 * 86400000); state.due = [state.claim];
    await notifyDamageClaimBookingHolds(); await notifyDamageClaimBookingHolds();
    expect(state.history.filter(row => row.action === 'booking_hold_started')).toHaveLength(1);
    expect(state.claim.bookingHoldNotifiedAt).toEqual(now); expect(state.create).not.toHaveBeenCalled();
  });
  it.each(['claim_uphold', 'claim_reduce'])('audits %s with a shared decision and starts seven-day timing without Stripe I/O', async type => {
    state.claim.status = 'under_review'; await decideDamageClaim(7, 99, action(type, type === 'claim_reduce' ? { amountCents: 1000 } : {}));
    expect(state.claim.upheldAt).toEqual(now); expect(state.actions[0]).toMatchObject({ internalNote: expect.any(String), reasonCode: 'evidence', status: 'verified' });
    expect(state.create).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled();
    expect(state.claim.finalAmountCents).toBe(type === 'claim_reduce' ? 1000 : 2000);
  });
  it.each(['claim_reject', 'claim_close', 'claim_release_hold'])('%s lifts new-booking eligibility', async type => {
    await decideDamageClaim(7, 99, action(type));
    expect(state.claim.holdReleasedAt || state.claim.resolvedAt).toEqual(now);
  });
  it.each([true, false])('pays from platform balance idempotently with chefStillOwes=%s', async chefStillOwes => {
    const input = action('claim_compensate', { amountCents: 2000, chefStillOwes });
    await decideDamageClaim(7, 99, input); await decideDamageClaim(7, 99, input);
    expect(state.transfer).toHaveBeenCalledTimes(1); expect(state.transfer.mock.calls[0][0]).not.toHaveProperty('source_transaction');
    expect(state.claim).toMatchObject({ fundedBy: 'local_cooks', chefOwes: chefStillOwes });
    expect(state.events.indexOf('commit')).toBeLessThan(state.events.indexOf('stripe:balance'));
    expect(state.actions[0].status).toBe('verified');
  });
  it('insufficient balance sends nothing and retries the persisted decision after funding', async () => {
    state.insufficient = true; const input = action('claim_compensate', { amountCents: 2000, chefStillOwes: true });
    await expect(decideDamageClaim(7, 99, input)).rejects.toThrow(/insufficient/); expect(state.transfer).not.toHaveBeenCalled();
    expect(state.actions[0].status).toBe('recovery_required'); state.insufficient = false;
    await decideDamageClaim(7, 99, input); expect(state.transfer).toHaveBeenCalledTimes(1);
    expect(state.actions).toHaveLength(1);
  });
  it('cancels an opened, unconfirmed chef payment under an audit decision before kitchen compensation', async () => {
    await prepareClaimPayment(1, 5);
    state.retrieve.mockImplementation(async () => ({ ...intent(), status: 'requires_confirmation' }));
    await decideDamageClaim(7, 99, action('claim_compensate', { amountCents: 2000, chefStillOwes: false }));
    expect(state.cancel).toHaveBeenCalledTimes(1); expect(state.actions.map(row => row.actionType)).toEqual(['claim_cancel_payment', 'claim_compensate']);
    expect(state.claim.paymentOperation.state).toBe('cancelled'); expect(state.claim.compensationOperation.state).toBe('succeeded');
  });
  it('a flag opened after balance discovery still blocks the outgoing transfer', async () => {
    state.balance.mockImplementation(async () => { state.flag = true; return { available: [{ currency: 'cad', amount: 100000 }] }; });
    await expect(decideDamageClaim(7, 99, action('claim_compensate', { amountCents: 2000, chefStillOwes: true }))).rejects.toThrow(/paused/);
    expect(state.transfer).not.toHaveBeenCalled(); expect(state.claim.compensationOperation.state).toBe('pending');
  });
  it('ambiguous transfer retries keep the exact operation key and amount', async () => {
    state.failTransfer = true; const input = action('claim_compensate', { amountCents: 2000, chefStillOwes: true });
    await expect(decideDamageClaim(7, 99, input)).rejects.toThrow('Provider timeout');
    state.failTransfer = false; await decideDamageClaim(7, 99, input);
    expect(state.transfer.mock.calls.map(call => call[1].idempotencyKey)).toEqual(['claim:1:compensation', 'claim:1:compensation']);
    expect(state.claim.compensationOperation).toMatchObject({ state: 'succeeded', amountCents: 2000 });
  });
  it('flags block compensation before provider I/O; stale ambiguous transfers never reuse an expired Stripe key', async () => {
    state.flag = true;
    await expect(decideDamageClaim(7, 99, action('claim_compensate', { amountCents: 2000, chefStillOwes: true }))).rejects.toThrow(/paused/);
    expect(state.balance).not.toHaveBeenCalled(); state.flag = false;
    state.claim.compensationOperation = { key: 'claim:old', state: 'pending', amountCents: 2000, destination: 'acct_kitchen', startedAt: '2026-10-01', attemptedAt: '2026-10-01' };
    await expect(sendClaimKitchenMoney(1, 'compensation')).rejects.toThrow(/verify its earlier attempt/);
    expect(state.transfer).not.toHaveBeenCalled();
  });
  it('a chef repayment after Local Cooks compensation goes to Local Cooks without a second kitchen transfer', async () => {
    await decideDamageClaim(7, 99, action('claim_compensate', { amountCents: 2000, chefStillOwes: true }));
    await prepareClaimPayment(1, 5); await settleClaimPayment(intent() as any);
    expect(state.transfer).toHaveBeenCalledTimes(1); expect(state.source.managerRevenue).toBe('0'); expect(state.claim.chefOwes).toBe(false);
  });
  it('recovery exits on an empty bounded page and never confirms a chef payment', async () => {
    await recoverDamageClaimMoney(); expect(state.create).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled();
  });
});

describe('support starts a chef claim payment over (stuck attempt held for review)', () => {
  const held = (error: string) => ({ ...state.claim, chefId: 0, status: 'approved', upheldAt: now, chefOwes: true, finalAmountCents: 4000,
    paymentOperation: { key: 'claim:1:pay:1', state: 'pending', amountCents: 4000, customerId: 'cus_platform', startedAt: now.toISOString(), error } });
  it('asks the provider again: no payment found → the chef can pay again; audited', async () => {
    state.claim = held('The payment provider could not be reached to check the earlier attempt.'); state.list = [];
    expect(await decideDamageClaim(7, 99, action('claim_restart_payment'))).toMatchObject({ result: 'reset' });
    expect(state.claim.paymentOperation.state).toBe('cancelled');
    expect(state.actions.at(-1)).toMatchObject({ actionType: 'claim_restart_payment', status: 'verified' });
  });
  it('still undecidable → refuses until Local Cooks confirms it checked the provider, then resets', async () => {
    const match = { id: 'pi_a', status: 'requires_payment_method', amount: 4000, currency: 'cad', customer: 'cus_platform', metadata: { claim_operation_key: 'claim:1:pay:1' } };
    state.claim = held('More than one payment matches this attempt.'); state.list = [match, { ...match, id: 'pi_b' }];
    await expect(decideDamageClaim(7, 99, action('claim_restart_payment'))).rejects.toThrow(/confirm no payment was taken/);
    expect(state.claim.paymentOperation.state).toBe('pending');
    expect(await decideDamageClaim(7, 99, action('claim_restart_payment', { verifiedNoPayment: true, operationKey: 'claim:action:restart2' }))).toMatchObject({ result: 'verified_reset' });
    expect(state.claim.paymentOperation).toMatchObject({ state: 'cancelled', error: expect.stringContaining('no payment was taken') });
  });
  it('is refused when nothing is waiting for review', async () => {
    state.claim = { ...state.claim, paymentOperation: null };
    await expect(decideDamageClaim(7, 99, action('claim_restart_payment'))).rejects.toThrow(/no payment waiting for review/);
  });
});
