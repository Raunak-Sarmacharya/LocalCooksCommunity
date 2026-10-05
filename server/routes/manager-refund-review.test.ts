import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ transaction: {} as any, refund: vi.fn(), update: vi.fn(), recovery: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: vi.fn(), transaction: async (work: any) => work(db),
    select: () => { const chain: any = { from: () => chain, where: () => chain, limit: () => chain,
      then: (resolve: any) => resolve([{ stripeConnectAccountId: 'acct_fixture' }]) }; return chain; },
    update: () => ({ set: () => ({ where: async () => {} }) }) };
  return { db, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../services/payment-transactions-service', () => ({ findPaymentTransactionById: async () => state.transaction, updatePaymentTransaction: state.update }));
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
  state.transaction = { id: 99, manager_id: 2, booking_id: 10, booking_type: 'kitchen', payment_intent_id: 'pi_fixture',
    status: 'succeeded', amount: '12200', refund_amount: '0', manager_revenue: '11116', stripe_processing_fee: '384', service_fee: '700', metadata: {} };
  state.refund.mockResolvedValue({ refundId: 're_fixture', refundAmount: 2300, refundStatus: 'succeeded', transferReversalId: 'trr_fixture' });
});
describe('manager refund allocations and truthful recovery', () => {
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
