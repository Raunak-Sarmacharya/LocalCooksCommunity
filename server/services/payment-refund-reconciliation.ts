import { eq } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions } from '@shared/schema';
import { cancellationSourceQuote, verifiedReservedRefund } from '@shared/cancellation-refund';
import { getCancellationPaymentFacts, getCancellationReversalEvidence } from './stripe-service';
import { addPaymentHistory } from './payment-transactions-service';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recover component receipts when a provider callback precedes the route commit. */
export async function reconcilePaymentRefundReceipts(intentId: string, connection?: Tx, evidence?: Awaited<ReturnType<typeof getCancellationPaymentFacts>>, reversals?: Awaited<ReturnType<typeof getCancellationReversalEvidence>>): Promise<{
  sourceId: number; status: typeof paymentTransactions.$inferSelect.status; money: ReturnType<typeof cancellationSourceQuote>; operation: any;
}> {
  if (!connection) {
    const facts = await getCancellationPaymentFacts(intentId);
    const reversalFacts = await getCancellationReversalEvidence(intentId);
    const result = await db.transaction(tx => reconcilePaymentRefundReceipts(intentId, tx, facts, reversalFacts));
    if (result.operation?.status === 'succeeded') await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(result.operation.bookingId, 'cancellation refund reconciled')).catch(() => undefined);
    return result;
  }
  const [source] = await connection.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intentId)).for('update');
  if (!source) throw new Error('Refund source is missing');
  const saved = (source.metadata || {}) as Record<string, any>;
  const facts = evidence ?? await getCancellationPaymentFacts(intentId);
  if (facts.currency !== source.currency.toLowerCase() || facts.captured !== Number(source.amount)) throw new Error('Captured payment differs from the reserved source');
  const localReceipts = (saved.refunds || []).map((item: any) => ({ ...item, id: item.id || item.refundId }));
  const money = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts });
  const operation = saved.cancellationRefundOperation;
  let reconciledOperation = operation;
  if (operation && operation.status !== 'succeeded') {
    const matches = facts.refunds.filter(refund => refund.metadata?.refund_operation_id === operation.id);
    if (matches.length > 1) throw new Error('Multiple receipts match the reserved refund');
    if (matches[0]) {
      const providerReceipt = verifiedReservedRefund(source, operation, facts);
      const receipt = money.receipts.find(item => item.id === providerReceipt.id)!;
      if (receipt.managerDebited !== operation.managerRefund || receipt.platformServiceFeeReturned !== (operation.platformRefund ?? 0) || receipt.customerReceived !== (operation.customerRefund ?? operation.managerRefund))
        throw new Error('Refund receipt differs from the reserved cancellation allocation');
      if (operation.platformFunding && Number(providerReceipt.metadata?.kitchen_debt_cents) !== operation.kitchenDebtCents) throw new Error('Kitchen funding evidence differs from the reserved debt');
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
  if (reversals) {
    const { recordPayoutTransferEvidence } = await import('./payout-document-evidence');
    for (const reversal of reversals) await recordPayoutTransferEvidence(connection, intentId, reversal);
  }
  const debts = (saved.kitchenRefundDebts || []).map((debt: any) => debt.operationId === reconciledOperation?.id && reconciledOperation?.status === 'succeeded'
    ? { ...debt, status: 'open', refundId: reconciledOperation.refundId } : debt);
  const status = money.alreadyRefunded === 0 ? source.status : money.alreadyRefunded >= money.captured - money.processingCost ? 'refunded' : 'partially_refunded';
  await connection.update(paymentTransactions).set({ status, refundAmount: String(money.alreadyRefunded),
    stripeProcessingFee: String(money.processingCost), netAmount: String(money.captured - money.alreadyRefunded),
    metadata: { ...saved, ...(debts.length ? { kitchenRefundDebts: debts } : {}), ...(recovered ? { refundRecovery: recovered } : {}), refunds: money.receipts,
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
    await (await import('./booking-cancellation-refund')).finalizeCancellationRefund(connection, { ...source, status }, reconciledOperation);
  }
  return { sourceId: source.id, status, money, operation: reconciledOperation };
}

