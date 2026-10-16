import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ source: null as any, finalize: vi.fn() }));
vi.mock('./stripe-service', () => ({ getCancellationPaymentFacts: vi.fn(), getCancellationReversalEvidence: vi.fn() }));
vi.mock('./booking-cancellation-refund', () => ({ finalizeCancellationRefund: h.finalize }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./payment-transactions-service', () => ({ addPaymentHistory: vi.fn() }));
vi.mock('../db', () => ({ db: {} }));
import { reconcilePaymentRefundReceipts } from './payment-refund-reconciliation';
import { verifiedReservedRefund } from '../../shared/cancellation-refund';
const tx: any = {
  select: () => { const q: any = { from: () => q, where: () => q, for: () => q, then: (resolve: any) => resolve([structuredClone(h.source)]) }; return q; },
  update: () => ({ set: (patch: any) => ({ where: async () => { Object.assign(h.source, patch); } }) }),
};
const receipt = { id: 're_success', amount: 2055, status: 'succeeded', currency: 'cad', charge: 'ch_one', payment_intent: 'pi_one',
  metadata: { refund_operation_id: 'operation_one', transaction_id: '99', customer_receives: '2055', manager_debited: '1933', platform_service_fee_returned: '122' } };
const facts: any = { captured: 12200, processingCost: 384, currency: 'cad', chargeId: 'ch_one', refunded: 2055, refunds: [receipt] };
beforeEach(() => { vi.clearAllMocks(); h.source = { id: 99, paymentIntentId: 'pi_one', amount: '12200', currency: 'CAD', serviceFee: '700', refundAmount: '0', status: 'succeeded',
  metadata: { cancellationRefundOperation: { id: 'operation_one', intentId: 'pi_one', bookingId: 10, status: 'recovery_required', managerRefund: 1933, platformRefund: 122, customerRefund: 2055 } } }; });
describe('successful support retry reconciliation', () => {
  it('can reconcile the same successful receipt when no failed attempt exists', async () => {
    await expect(reconcilePaymentRefundReceipts('pi_one', tx, facts)).resolves.toMatchObject({ operation: { status: 'succeeded' } });
    expect(h.finalize).toHaveBeenCalledOnce();
  });
  it.each(['failed', 'canceled'])('reconciles one successful replacement with retained %s attempts from the same operation', async status => {
    const attempts = { ...facts, refunds: [{ ...receipt, id: 're_old', status }, receipt] };
    expect(verifiedReservedRefund(h.source, h.source.metadata.cancellationRefundOperation, attempts)).toBe(receipt);
    await expect(reconcilePaymentRefundReceipts('pi_one', tx, attempts)).resolves.toMatchObject({ operation: { status: 'succeeded', refundId: 're_success' } });
    expect(h.source.metadata.refunds).toHaveLength(1); expect(h.finalize).toHaveBeenCalledOnce();
  });
  it.each([
    { name: 'pending attempt', prior: { ...receipt, id: 're_old', status: 'pending' } },
    { name: 'unrelated failed refund', prior: { ...receipt, id: 're_old', status: 'failed', metadata: { ...receipt.metadata, refund_operation_id: 'unrelated' } } },
    { name: 'conflicting failed allocation', prior: { ...receipt, id: 're_old', status: 'failed', metadata: { ...receipt.metadata, manager_debited: '1932' } } },
    { name: 'multiple successes', prior: { ...receipt, id: 're_old' } },
  ])('rejects $name without completing the reservation', async ({ prior }) => {
    await expect(reconcilePaymentRefundReceipts('pi_one', tx, { ...facts, refunds: [prior, receipt] })).rejects.toThrow();
    expect(h.source.metadata.cancellationRefundOperation.status).toBe('recovery_required');
    expect(h.finalize).not.toHaveBeenCalled();
  });
});
