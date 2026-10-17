import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ dated: false, transaction: {} as any, refund: vi.fn(), update: vi.fn(), recovery: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: async () => ({ rows: state.dated ? [{ id: 10 }] : [] }), transaction: async (work: any) => work(db),
    select: () => { const chain: any = { from: () => chain, where: () => chain, limit: () => chain,
      then: (resolve: any) => resolve([{ stripeConnectAccountId: 'acct_fixture' }]) }; return chain; },
    update: () => ({ set: () => ({ where: async () => {} }) }) };
  return { db, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../services/payment-transactions-service', () => ({ findPaymentTransactionById: async () => state.transaction, updatePaymentTransaction: state.update, addPaymentHistory: vi.fn() }));
vi.mock('../services/stripe-service', () => ({ reverseTransferAndRefund: state.refund }));
vi.mock('../services/outcome-delivery', () => ({ attemptOutcomeDelivery: vi.fn(), recordRefundRecovery: state.recovery }));
import manager from './manager';
const route = (manager as any).stack.find((entry: any) => entry.route?.path === '/revenue/transactions/:transactionId/refund').route;
async function refund(amount = 2300) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack.at(-1).handle({ params: { transactionId: '99' }, neonUser: { id: 2, role: 'manager' }, body: { amount } }, response);
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.dated = false;
  state.transaction = { id: 99, manager_id: 2, booking_id: 10, booking_type: 'kitchen', payment_intent_id: 'pi_fixture',
    status: 'succeeded', amount: '12200', refund_amount: '0', manager_revenue: '11116', stripe_processing_fee: '384', service_fee: '700', metadata: {} };
  state.refund.mockResolvedValue({ refundId: 're_fixture', refundAmount: 2300, refundStatus: 'succeeded', transferReversalId: 'trr_fixture' });
});
it('an extra award on a policy-cancelled booking returns proportional platform money and keeps the actual fee', async () => {
  state.transaction.metadata = { cancellationRefundOperation: { policyEngine: true, status: 'succeeded', perComponent: [] }, refunds: [] };
  const response = await refund(3000);
  expect(response.status).not.toHaveBeenCalledWith(400);
  expect(state.refund).toHaveBeenCalledWith('pi_fixture', 3000, 'requested_by_customer', expect.objectContaining({ reverseTransferAmount: 2822,
    metadata: expect.objectContaining({ customer_receives: '3000', manager_debited: '2822', platform_service_fee_returned: '178' }) }));
});
describe('manager refund allocations and truthful recovery', () => {
  it('refuses a dated full-refund request before changing refund metadata', async () => {
    state.dated = true;
    const handler = (manager as any).stack.find((entry: any) => entry.route?.path === '/revenue/transactions/:transactionId/full-refund-request').route.stack.at(-1).handle;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ params: { transactionId: '99' }, neonUser: { id: 2, role: 'manager' }, body: { reason: 'Kitchen unavailable' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Dated booking cancellations and refunds') }));
    expect(state.update).not.toHaveBeenCalled();
  });
  it('refuses a dated direct refund before provider I/O', async () => {
    state.dated = true;
    const res = await refund();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Dated booking cancellations and refunds') }));
    expect(state.refund).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it('records the zero platform contribution required to reconcile later payout callbacks', async () => {
    await refund();
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update.mock.calls[0][1].metadata.refunds[0]).toMatchObject({
      id: 're_fixture', customerReceived: 2300, managerDebited: 2300, platformServiceFeeReturned: 0,
    });
  });
  it('a pending provider outcome does not update completed-refund totals and records the same operation for recovery', async () => {
    state.refund.mockRejectedValueOnce(Error('Refund re_pending is not verified as complete (pending).'));
    const res = await refund();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.recovery).toHaveBeenCalledWith(99, 'manager-refund-99-0-2300');
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
