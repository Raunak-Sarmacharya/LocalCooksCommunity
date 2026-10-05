import { eq } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions } from '@shared/schema';
import { cancellationSourceQuote } from '@shared/cancellation-refund';
import { getCancellationPaymentFacts } from './stripe-service';
import { addPaymentHistory } from './payment-transactions-service';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recover component receipts when a provider callback precedes the route commit. */
export async function reconcilePaymentRefundReceipts(intentId: string, connection?: Tx): Promise<{
  sourceId: number; status: typeof paymentTransactions.$inferSelect.status; money: ReturnType<typeof cancellationSourceQuote>; operation: any;
}> {
  if (!connection) return db.transaction(tx => reconcilePaymentRefundReceipts(intentId, tx));
  const [source] = await connection.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intentId)).for('update');
  if (!source) throw new Error('Refund source is missing');
  const saved = (source.metadata || {}) as Record<string, any>;
  const facts = await getCancellationPaymentFacts(intentId);
  const localReceipts = (saved.refunds || []).map((item: any) => ({ ...item, id: item.id || item.refundId }));
  const money = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts });
  const operation = saved.cancellationRefundOperation;
  let reconciledOperation = operation;
  if (operation && operation.status !== 'succeeded') {
    const matches = facts.refunds.filter(refund => refund.metadata?.refund_operation_id === operation.id);
    if (matches.length > 1) throw new Error('Multiple receipts match the reserved refund');
    if (matches[0]) {
      const receipt = money.receipts.find(item => item.id === matches[0].id)!;
      if (receipt.managerDebited !== operation.managerRefund || receipt.platformServiceFeeReturned !== 0 || receipt.customerReceived !== operation.managerRefund)
        throw new Error('Refund receipt differs from the reserved cancellation allocation');
      reconciledOperation = { ...operation, status: 'succeeded', refunded: receipt.customerReceived, refundId: receipt.id, verifiedAt: new Date().toISOString(), error: null };
    }
  }
  const recovery = saved.refundRecovery;
  const recoveredReceipt = recovery ? facts.refunds.find(refund => refund.metadata?.refund_operation_id === recovery.attemptKey) : null;
  const recovered = recoveredReceipt && money.receipts.some(item => item.id === recoveredReceipt.id)
    ? { ...recovery, status: 'succeeded', refundId: recoveredReceipt.id, verifiedAt: new Date().toISOString() } : recovery;
  const request = saved.fullRefundRequest;
  let reconciledRequest = request;
  if (request?.status === 'pending') {
    const matches = facts.refunds.filter(refund => refund.metadata?.refund_operation_id === `admin-refund-${source.id}-${request.requestedAt}`);
    if (matches.length > 1) throw new Error('Multiple receipts match the admin refund decision');
    if (matches[0]) {
      const receipt = matches[0], actorId = Number(receipt.metadata?.approved_by);
      if (receipt.metadata?.refund_model !== 'admin_controlled' || receipt.metadata?.transaction_id !== String(source.id)
        || !Number.isSafeInteger(actorId) || actorId <= 0 || !money.receipts.some(item => item.id === receipt.id))
        throw new Error('Original admin refund decision requires verified receipt and actor evidence');
      reconciledRequest = { ...request, status: 'approved', approvedAmount: receipt.amount,
        decidedBy: actorId, decidedAt: new Date().toISOString(), recoveredFromRefundId: receipt.id };
    }
  }
  const status = money.alreadyRefunded === 0 ? source.status : money.alreadyRefunded >= money.captured - money.processingCost ? 'refunded' : 'partially_refunded';
  await connection.update(paymentTransactions).set({ status, refundAmount: String(money.alreadyRefunded),
    stripeProcessingFee: String(money.processingCost), netAmount: String(money.captured - money.alreadyRefunded),
    metadata: { ...saved, ...(recovered ? { refundRecovery: recovered } : {}), refunds: money.receipts,
      ...(reconciledRequest ? { fullRefundRequest: reconciledRequest } : {}),
      ...(reconciledOperation ? { cancellationRefundOperation: reconciledOperation } : {}) }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
  if (request?.status === 'pending' && reconciledRequest?.status === 'approved') {
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: status, eventType: 'full_refund_approved', eventSource: 'admin',
      description: 'Original admin refund decision recovered from verified provider receipt', metadata: reconciledRequest,
      createdBy: reconciledRequest.decidedBy }, connection);
  }
  if (operation?.status !== 'succeeded' && reconciledOperation?.status === 'succeeded') {
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: status, eventType: 'cancellation_refund_verified',
      description: 'Original provider receipt recovered with verified component allocations', metadata: reconciledOperation }, connection);
    await queueBookingLifecycleEvent(connection, operation.bookingId, 'refund_issued', 'Cancellation refund verified',
      `Stripe verified the original ${(reconciledOperation.refunded / 100).toFixed(2)} ${source.currency} refund. Processing costs remain deducted. Bank receipt is not confirmed.`,
      undefined, { transactionId: source.id, refundId: reconciledOperation.refundId, operationId: operation.id });
  }
  return { sourceId: source.id, status, money, operation: reconciledOperation };
}

