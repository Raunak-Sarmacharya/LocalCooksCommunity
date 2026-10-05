import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ transaction: {} as any, refund: vi.fn(), update: vi.fn(), recovery: vi.fn(), history: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: vi.fn(), transaction: async (work: any) => work(db),
    update: () => ({ set: () => ({ where: async () => {} }) }) };
  return { db, getDbError: vi.fn() };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireAdmin: vi.fn(), requireManager: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../firebase-setup', () => ({ initializeFirebaseAdmin: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/payment-transactions-service', () => ({ findPaymentTransactionById: async () => state.transaction,
  updatePaymentTransaction: state.update, addPaymentHistory: state.history }));
vi.mock('../services/stripe-service', () => ({ reverseTransferAndRefund: state.refund }));
vi.mock('../services/outcome-delivery', () => ({ recordRefundRecovery: state.recovery }));
import admin from './admin';
const handler = (admin as any).stack.find((entry: any) => entry.route?.path === '/transactions/:transactionId/full-refund-request/decision').route.stack.at(-1).handle;
async function approve() {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { transactionId: '99' }, neonUser: { id: 1, role: 'admin' }, body: { decision: 'approve' } }, response);
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.transaction = { id: 99, booking_id: 10, booking_type: 'kitchen', payment_intent_id: 'pi_fixture',
    status: 'partially_refunded', amount: '12200', refund_amount: '11116', manager_revenue: '11116', stripe_processing_fee: '384', service_fee: '700',
    metadata: { fullRefundRequest: { status: 'pending', requestedAt: '2026-11-01T11:00:00Z' },
      refunds: [{ id: 're_manager', customerReceived: 11116, managerDebited: 11116, platformServiceFeeReturned: 0 }] } };
  state.refund.mockResolvedValue({ refundId: 're_admin', refundAmount: 700, refundStatus: 'succeeded', transferReversalId: null });
});
describe('admin fee return after cancellation', () => {
  it('preserves the exact fee/manager allocation on the provider receipt for lost-commit recovery', async () => {
    await approve();
    expect(state.refund).toHaveBeenCalledWith('pi_fixture', 700, 'requested_by_customer', expect.objectContaining({
      reverseTransferAmount: 0,
      metadata: expect.objectContaining({ customer_receives: '700', manager_debited: '0', platform_service_fee_returned: '700' }),
    }));
  });
  it('cannot return retained used add-on money or mixed-source fees through admin approval', async () => {
    state.transaction.refund_amount = '9116';
    state.transaction.metadata.refunds[0] = { id: 're_manager', customerReceived: 9116, managerDebited: 9116, platformServiceFeeReturned: 0 };
    state.transaction.metadata.cancellationRefundOperation = { status: 'succeeded', retainedUsedAddonCents: 2000, serviceFeeReview: 0 };
    const response = await approve();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(state.refund).not.toHaveBeenCalled();
  });
});
