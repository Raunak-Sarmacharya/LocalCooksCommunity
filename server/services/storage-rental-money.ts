/**
 * Storage refunds (WP-ST6). One reserved `cancellationRefundOperation` per paid term's payment row, latest term first, using the
 * kitchen-booking refund engine unchanged: reserve locally, then `reverseTransferAndRefund` (a reversal only when the term was
 * already paid out), then `reconcilePaymentRefundReceipts`, whose completion lands in `finalizeStorageRefund`.
 * Before the payout the receipt's managerDebited simply lowers the later transfer. After it, a reversal the kitchen's balance
 * can't cover becomes a recorded kitchen debt (Local Cooks refunds the chef from its own balance), persisted before sending.
 * Causes: kitchen (unused days, kitchen-funded), local_cooks (unused days, Local Cooks-funded), goodwill_kitchen / goodwill_lc
 * (an amount), before_start (the frozen cancellation policy). Calling again with the same operationKey resumes the same refund.
 * Lock order: rental -> payment.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions, storageBookings, storageRentalTerms } from '@shared/schema';
import { beforeStartRefund, unusedRefundSplit } from '@shared/storage-rental';
import { cancellationSourceQuote } from '@shared/cancellation-refund';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { getCancellationPaymentFacts, reverseTransferAndRefund } from './stripe-service';
import { addPaymentHistory } from './payment-transactions-service';
import { queueStorageRentalNotice } from './storage-rental-notices';
import { kitchenFundingShortfall } from './booking-cancellation-refund';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
export type StorageRefundCause = 'kitchen' | 'local_cooks' | 'goodwill_kitchen' | 'goodwill_lc' | 'before_start';
export type StorageRefundInput = { cause: StorageRefundCause; actorId: number; operationKey: string; fromDate?: string; amountCents?: number; now?: Date };
type Share = { customer: number; managerDebited: number; feeReturned: number; goodwill: number; processing: number };
const CAPTURED = ['succeeded', 'partially_refunded'] as Source['status'][];
const meta = (row: { metadata: unknown }) => (row.metadata || {}) as Record<string, any>;
export class StorageRefundError extends Error { constructor(public code: string, public status = 409) { super(code); } }

/** Pure: what each paid term's payment row refunds and who funds it, before the per-source ceilings. */
export function storageRefundShares(terms: Array<{ id: number; startsOn: string; endsOn: string; days: number; subtotalCents: number; taxCents: number;
  serviceFeeCents: number; totalCents: number; paidAt: Date | null; processingFeeCents: number | null; refundedCents: number; remainingKitchenCents: number }>,
  input: Pick<StorageRefundInput, 'cause' | 'fromDate' | 'amountCents' | 'now'> & { snapshot?: CancellationPolicySnapshot; approvedAt?: Date | null }) {
  const shares = new Map<number, Share>();
  const add = (id: number, share: Share) => share.customer > 0 && shares.set(id, share);
  if (input.cause === 'kitchen' || input.cause === 'local_cooks') {
    if (!input.fromDate) throw new StorageRefundError('invalid_details', 400);
    for (const part of unusedRefundSplit(terms, input.fromDate)) add(part.termId, input.cause === 'kitchen'
      ? { customer: part.customer, managerDebited: part.managerDebited, feeReturned: part.platformServiceFeeReturned, goodwill: 0, processing: 0 }
      : { customer: part.customer, managerDebited: 0, feeReturned: part.platformServiceFeeReturned, goodwill: part.managerDebited, processing: 0 });
  } else if (input.cause === 'before_start') {
    if (!input.snapshot || !input.approvedAt) throw new StorageRefundError('not_cancellable');
    for (const term of terms) {
      const quote = beforeStartRefund(input.snapshot, { cancelAt: input.now ?? new Date(), approvedAt: input.approvedAt, term, processingFeeCents: term.processingFeeCents,
        alreadyRefundedCents: term.refundedCents });
      if (!quote.quoteReady) throw new StorageRefundError('fee_pending');
      add(term.id, { customer: quote.chefRefundCents, managerDebited: quote.kitchenRefundCents, feeReturned: quote.platformRefundCents, goodwill: 0, processing: 0 });
    }
  } else {
    let left = input.amountCents ?? 0;
    if (!Number.isSafeInteger(left) || left <= 0) throw new StorageRefundError('invalid_details', 400);
    for (const term of [...terms].sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))) {
      const room = input.cause === 'goodwill_kitchen' ? term.remainingKitchenCents : term.totalCents - term.refundedCents;
      const take = Math.min(left, Math.max(0, room));
      left -= take;
      add(term.id, input.cause === 'goodwill_kitchen' ? { customer: take, managerDebited: take, feeReturned: 0, goodwill: 0, processing: 0 }
        : { customer: take, managerDebited: 0, feeReturned: 0, goodwill: take, processing: 0 });
    }
    if (left > 0) throw new StorageRefundError('refund_too_large');
  }
  return shares;
}

/** Plans (provider reads first), reserves under the rental lock, then sends every reserved refund. */
export async function refundRentalUnused(rentalId: number, input: StorageRefundInput) {
  if (!/^[\w:-]{1,128}$/.test(input.operationKey)) throw new StorageRefundError('invalid_details', 400);
  const opId = (sourceId: number) => `storage-refund-${rentalId}-${sourceId}-${input.operationKey}`;
  const [rental] = await db.select().from(storageBookings).where(eq(storageBookings.id, rentalId));
  if (!rental?.rentalTerms) throw new StorageRefundError('not_found', 404);
  const rows = await db.select({ term: storageRentalTerms, source: paymentTransactions }).from(storageRentalTerms)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, storageRentalTerms.paymentTransactionId))
    .where(and(eq(storageRentalTerms.rentalId, rentalId), eq(storageRentalTerms.status, 'paid'), inArray(paymentTransactions.status, [...CAPTURED, 'refunded'])))
    .orderBy(desc(storageRentalTerms.startsOn));
  const resumed = rows.some(row => meta(row.source).cancellationRefundOperation?.id === opId(row.source.id));
  if (!resumed) {
    const facts = new Map<number, Awaited<ReturnType<typeof getCancellationPaymentFacts>>>();
    const money = new Map<number, ReturnType<typeof cancellationSourceQuote>>();
    for (const { source } of rows.filter(row => CAPTURED.includes(row.source.status))) {
      const fact = await getCancellationPaymentFacts(source.paymentIntentId!);
      facts.set(source.id, fact);
      money.set(source.id, cancellationSourceQuote({ ...fact, serviceFee: Number(source.serviceFee), localReceipts: (meta(source).refunds || []).map((item: any) => ({ ...item, id: item.id || item.refundId })) }));
    }
    const shares = storageRefundShares(rows.filter(row => money.has(row.source.id)).map(({ term, source }) => ({ ...term,
      processingFeeCents: facts.get(source.id)!.processingCost, refundedCents: money.get(source.id)!.alreadyRefunded,
      remainingKitchenCents: money.get(source.id)!.managerRefund })), { ...input, snapshot: (rental.rentalTerms as { cancellationPolicySnapshot?: CancellationPolicySnapshot }).cancellationPolicySnapshot,
      approvedAt: rental.approvedAt });
    if (!shares.size) throw new StorageRefundError('nothing_to_refund');
    await db.transaction(async tx => {
      await tx.select({ id: storageBookings.id }).from(storageBookings).where(eq(storageBookings.id, rentalId)).for('update');
      await assertBookingMoneyWritable({ storageRentalId: rentalId, operationKey: input.operationKey }, tx);
      for (const { term, source: planned } of rows) {
        const share = shares.get(term.id);
        if (!share) continue;
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, planned.id)).for('update');
        const saved = meta(source), m = money.get(source.id)!;
        if (saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded' || saved.refundRecovery && saved.refundRecovery.status !== 'succeeded')
          throw new StorageRefundError('refund_pending');
        if (Number(source.refundAmount || 0) !== m.alreadyRefunded) throw new StorageRefundError('refund_changed');
        // Ceilings from what is still on this charge. A kitchen-funded refund can't take more than the kitchen's remaining net:
        // the card processing on refunded days is then Local Cooks' cost (recorded on the receipt).
        const customer = Math.min(share.customer, m.captured - m.alreadyRefunded);
        const managerDebited = Math.min(share.managerDebited, m.managerRefund, customer);
        const feeReturned = Math.min(share.feeReturned, m.serviceFeeReview, customer - managerDebited);
        const goodwill = Math.min(share.goodwill, customer - managerDebited - feeReturned);
        const processing = customer - managerDebited - feeReturned - goodwill;
        if (customer <= 0) continue;
        const operation = { id: opId(source.id), storageRentalId: rentalId, cause: input.cause, actorId: input.actorId, managerId: source.managerId,
          intentId: source.paymentIntentId, termId: term.id, customerRefund: customer, managerRefund: managerDebited, platformRefund: feeReturned,
          platformGoodwillCents: goodwill, platformProcessingCostCents: processing, status: 'pending', acceptedAt: (input.now ?? new Date()).toISOString() };
        await tx.update(paymentTransactions).set({ stripeProcessingFee: String(m.processingCost), updatedAt: new Date(), metadata: { ...saved, refunds: m.receipts,
          cancellationRefundOperations: [...(saved.cancellationRefundOperations || []), ...(saved.cancellationRefundOperation ? [saved.cancellationRefundOperation] : [])],
          cancellationRefundOperation: operation } }).where(eq(paymentTransactions.id, source.id));
        await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'cancellation_refund_reserved',
          description: 'Storage refund reserved before provider work', metadata: operation, createdBy: input.actorId }, tx);
      }
    });
  }
  const results = [];
  for (const { source } of rows) results.push(...await sendReservedStorageRefund(source.id, opId(source.id), input.operationKey));
  return { rentalId, refunds: results };
}

/** Provider work for one reserved row; the funding decision is persisted before any money moves. */
async function sendReservedStorageRefund(sourceId: number, operationId: string, supportOperationKey: string) {
  let [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId));
  let operation = meta(source).cancellationRefundOperation;
  if (operation?.id !== operationId) return [];
  if (operation.status === 'succeeded') return [{ sourceId, status: 'succeeded', customerRefund: operation.customerRefund, kitchenDebtCents: operation.kitchenDebtCents || 0 }];
  try {
    const send = (reverseTransferAmount: number) => reverseTransferAndRefund(operation.intentId, operation.customerRefund, 'requested_by_customer', {
      reservedOperation: true, idempotencyKey: operation.id, supportOperationKey, reverseTransferAmount, refundApplicationFee: false,
      metadata: { storage_rental_id: String(operation.storageRentalId), transaction_id: String(sourceId), manager_id: String(operation.managerId),
        customer_receives: String(operation.customerRefund), manager_debited: String(operation.managerRefund), platform_service_fee_returned: String(operation.platformRefund),
        ...(operation.platformGoodwillCents ? { platform_goodwill_cents: String(operation.platformGoodwillCents) } : {}),
        ...(operation.platformProcessingCostCents ? { platform_processing_cost_cents: String(operation.platformProcessingCostCents) } : {}),
        ...(operation.kitchenDebtCents ? { kitchen_debt_cents: String(operation.kitchenDebtCents) } : {}) } });
    try { await send(operation.platformFunding ? 0 : operation.managerRefund); }
    catch (error) {
      if (!(operation.managerRefund > 0 && kitchenFundingShortfall(error))) throw error;
      operation = await db.transaction(async tx => {
        [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).for('update');
        const saved = meta(source), op = saved.cancellationRefundOperation;
        if (op?.id !== operationId || op.status === 'succeeded') throw new Error('The refund changed before funding could be recorded');
        const next = { ...op, platformFunding: true, kitchenDebtCents: op.managerRefund };
        const debt = { operationId: op.id, storageRentalId: op.storageRentalId, amountCents: op.managerRefund, status: 'awaiting_refund', recordedAt: new Date().toISOString() };
        await tx.update(paymentTransactions).set({ updatedAt: new Date(), metadata: { ...saved, cancellationRefundOperation: next,
          kitchenRefundDebts: [...(saved.kitchenRefundDebts || []).filter((row: any) => row.operationId !== op.id), debt] } }).where(eq(paymentTransactions.id, sourceId));
        return next;
      });
      await send(0);
    }
    const reconciled = await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(operation.intentId);
    if (reconciled.operation?.id !== operation.id || reconciled.operation?.status !== 'succeeded') throw new Error('No successful matching provider refund receipt is available.');
    return [{ sourceId, status: 'succeeded', customerRefund: operation.customerRefund, kitchenDebtCents: operation.kitchenDebtCents || 0 }];
  } catch (error) {
    const message = (error as Error).message;
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).for('update');
      const saved = meta(locked), op = saved.cancellationRefundOperation;
      if (op?.id !== operationId || op.status === 'succeeded' || op.status === 'recovery_required' && op.error === message) return;
      await tx.update(paymentTransactions).set({ updatedAt: new Date(), metadata: { ...saved, cancellationRefundOperation: { ...op, status: 'recovery_required', error: message } } })
        .where(eq(paymentTransactions.id, sourceId));
      await queueStorageRentalNotice(tx, op.storageRentalId, 'support_flag', { eventKey: `refund:${op.id}:recovery`,
        message: `A storage refund of $${(op.customerRefund / 100).toFixed(2)} needs attention (${message.slice(0, 200)}). Retry it under the same reference; check Stripe before sending another refund.` });
    });
    return [{ sourceId, status: 'recovery_required', customerRefund: operation.customerRefund, kitchenDebtCents: operation.kitchenDebtCents || 0 }];
  }
}

/** Storage branch of finalizeCancellationRefund: runs once, in the reconciliation transaction that verified the receipt. */
export async function finalizeStorageRefund(tx: Tx, _source: Source, operation: Record<string, any>) {
  const rentalId = Number(operation.storageRentalId);
  const [term] = operation.termId ? await tx.select().from(storageRentalTerms).where(eq(storageRentalTerms.id, operation.termId)) : [];
  const facts = { startOn: term?.startsOn, endOn: term?.endsOn, days: term?.days };
  await queueStorageRentalNotice(tx, rentalId, 'refund_issued', { ...facts, eventKey: operation.id, amountCents: operation.customerRefund, only: ['chef', 'admins'] });
  // The kitchen hears only when its share paid for it, and only that share.
  if (operation.managerRefund > 0)
    await queueStorageRentalNotice(tx, rentalId, 'refund_issued', { ...facts, eventKey: operation.id, amountCents: operation.managerRefund, only: ['manager'] });
  if (operation.kitchenDebtCents) await queueStorageRentalNotice(tx, rentalId, 'kitchen_debt', { ...facts, eventKey: operation.id, amountCents: operation.kitchenDebtCents });
}
