export type RefundReceipt = { id: string; customerReceived: number; managerDebited: number; platformServiceFeeReturned: number;
  kitchenChangeId?: string; platformGoodwillCents?: number; platformProcessingCostCents?: number };

export function isCancellationReservationSource(source: { paymentIntentId: string | null; metadata: unknown }, originalIntentIds: Array<string | null>,
  extensionIntentIds: Array<string | null>, parentIntent: string | null) {
  const saved = (source.metadata || {}) as Record<string, any>;
  if (['damage_claim', 'overstay_penalty'].includes(saved.type) || saved.damage_claim_id || saved.overstay_record_id) return false;
  // Paid extra time (session extensions / extra-time charges) is non-refundable by cancellation; support can still refund.
  if (saved.type === 'session_extension' || saved.sessionExtensionId) return false;
  if (source.paymentIntentId && [...originalIntentIds, ...extensionIntentIds].includes(source.paymentIntentId)) return true;
  if (saved.kitchenChangeId && saved.originalBookingPaymentIntentId === parentIntent && parentIntent) return true;
  throw new Error('Ambiguous legacy payment purpose requires Local Cooks review before cancellation');
}
const cents = (value: unknown) => {
  const result = Number(value);
  if (value === null || value === undefined || !Number.isSafeInteger(result) || result < 0) throw new Error('Verified refund allocations require review');
  return result;
};

type ProviderRefund = { id: string; amount: number; status: string | null; currency?: string; charge?: unknown;
  payment_intent?: unknown; metadata: Record<string, string> | null };

/** Terminal attempts belong to a retry only when one success has the same immutable operation and allocation. */
export function successfulRefundAttempt(refunds: ProviderRefund[], operationId: string) {
  const attempts = refunds.filter(row => row.metadata?.refund_operation_id === operationId);
  const successes = attempts.filter(row => row.status === 'succeeded');
  if (successes.length > 1 || attempts.some(row => !['succeeded', 'failed', 'canceled'].includes(row.status || '')))
    throw Error('Conflicting refund receipts require financial review.');
  const success = successes[0];
  if (success && attempts.some(row => row.amount !== success.amount || row.currency !== success.currency
    || row.charge !== success.charge || row.payment_intent !== success.payment_intent
    || ['transaction_id', 'customer_receives', 'manager_debited', 'platform_service_fee_returned', 'kitchen_debt_cents',
      'platform_goodwill_cents', 'platform_processing_cost_cents', 'kitchen_change_id', 'type']
      .some(key => row.metadata?.[key] !== success.metadata?.[key]))) throw Error('Conflicting refund receipts require financial review.');
  return success;
}

/** Aggregate refunded totals cannot establish who funded a refund. */
export function cancellationSourceQuote(input: { captured: number; processingCost: number; serviceFee: number; refunded: number;
  refunds: ProviderRefund[]; localReceipts?: RefundReceipt[];
  retainedUsedAddonCents?: number }) {
  const captured = cents(input.captured), processingCost = cents(input.processingCost), serviceFee = cents(input.serviceFee);
  if (processingCost + serviceFee > captured) throw new Error('Captured source cannot fund its retained fees');
  const receipts: RefundReceipt[] = [];
  for (const refund of input.refunds) {
    const operationReceipt = refund.metadata?.refund_operation_id
      ? successfulRefundAttempt(input.refunds, refund.metadata.refund_operation_id) : undefined;
    if (['failed', 'canceled'].includes(refund.status || '') && refund.metadata?.refund_operation_id
      && operationReceipt) continue;
    // A terminal failed change refund is closed only by its verified support-authorized replacement.
    if (['failed', 'canceled'].includes(refund.status || '') && input.refunds.some(other => other.status === 'succeeded'
      && other.metadata?.refund_replaces_id === refund.id && other.metadata?.type === 'kitchen_booking_change'
      && other.metadata?.kitchen_change_id && other.metadata.kitchen_change_id === refund.metadata?.kitchen_change_id
      && other.amount === refund.amount && ['customer_receives', 'manager_debited', 'platform_service_fee_returned']
        .every(key => other.metadata?.[key] === refund.metadata?.[key]))) continue;
    if (refund.status !== 'succeeded') throw new Error('A prior refund is pending or failed; reconcile that source before accepting cancellation');
    const local = input.localReceipts?.find(item => item.id === refund.id);
    const hasProviderAllocation = refund.metadata?.customer_receives !== undefined;
    const changeId = refund.metadata?.kitchen_change_id;
    if (changeId !== undefined && (!/^[a-zA-Z0-9_-]{1,128}$/.test(changeId) || refund.metadata?.type !== 'kitchen_booking_change')) throw new Error('Invalid booking change refund evidence');
    const receipt = hasProviderAllocation ? { id: refund.id, ...(changeId ? { kitchenChangeId: changeId } : {}), customerReceived: cents(refund.metadata?.customer_receives),
      managerDebited: cents(refund.metadata?.manager_debited), platformServiceFeeReturned: cents(refund.metadata?.platform_service_fee_returned),
      ...(refund.metadata?.platform_goodwill_cents !== undefined ? { platformGoodwillCents: cents(refund.metadata.platform_goodwill_cents) } : {}),
      ...(refund.metadata?.platform_processing_cost_cents !== undefined ? { platformProcessingCostCents: cents(refund.metadata.platform_processing_cost_cents) } : {}) }
      : local;
    if (!receipt || receipt.customerReceived !== cents(refund.amount)
      || receipt.managerDebited + receipt.platformServiceFeeReturned + (receipt.platformGoodwillCents || 0) + (receipt.platformProcessingCostCents || 0) !== receipt.customerReceived)
      throw new Error('Prior refund allocation is unverified; Local Cooks must reconcile the source');
    if (local && hasProviderAllocation && (local.managerDebited !== receipt.managerDebited || local.platformServiceFeeReturned !== receipt.platformServiceFeeReturned))
      throw new Error('Provider and local refund allocations disagree');
    if (receipts.some(item => item.id === receipt.id)) throw new Error('Duplicate provider refund receipt');
    receipts.push(receipt);
  }
  const alreadyRefunded = receipts.reduce((sum, item) => sum + item.customerReceived, 0);
  if (alreadyRefunded !== cents(input.refunded)) throw new Error('Aggregate refund total has no verified receipt allocation');
  const retainedUsedAddonCents = cents(input.retainedUsedAddonCents ?? 0);
  const managerRefund = captured - processingCost - serviceFee - retainedUsedAddonCents - receipts.reduce((sum, item) => sum + item.managerDebited, 0);
  const serviceFeeReview = serviceFee - receipts.reduce((sum, item) => sum + item.platformServiceFeeReturned, 0);
  if (managerRefund < 0 || serviceFeeReview < 0) throw new Error('Prior refunds exceed the captured source allocation');
  return { captured, processingCost, serviceFee, alreadyRefunded, managerRefund, serviceFeeReview, retainedUsedAddonCents, receipts };
}

/** A receipt can finish only its exact immutable reservation; aggregate totals are never proof. */
export function verifiedReservedRefund(source: { id: number; paymentIntentId: string | null; currency: string; amount: string }, operation: Record<string, any>,
  facts: { captured: number; currency: string; chargeId: string; refunds: Array<{ id: string; amount: number; status: string | null; currency?: string; charge?: unknown; payment_intent?: unknown; metadata: Record<string, string> | null }> }) {
  if (source.paymentIntentId !== operation.intentId || facts.captured !== Number(source.amount) || facts.currency !== source.currency.toLowerCase()) throw Error('The reserved payment changed');
  const matches = facts.refunds.filter(row => row.metadata?.refund_operation_id === operation.id);
  if (!matches.length || matches.some(row => row.amount !== (operation.customerRefund ?? operation.managerRefund) || row.currency !== facts.currency
    || row.charge !== facts.chargeId || row.payment_intent !== source.paymentIntentId
    || !['succeeded', 'failed', 'canceled'].includes(row.status || ''))) throw Error('The provider refund attempts do not match the reservation');
  const receipt = successfulRefundAttempt(matches, operation.id);
  if (!receipt) throw Error('Exactly one successful provider refund receipt is required');
  const m = receipt.metadata;
  if (receipt.status !== 'succeeded' || receipt.charge !== facts.chargeId || receipt.payment_intent !== source.paymentIntentId || receipt.currency !== facts.currency
    || receipt.amount !== (operation.customerRefund ?? operation.managerRefund) || m?.transaction_id !== String(source.id)
    || Number(m?.customer_receives) !== receipt.amount || Number(m?.manager_debited) !== operation.managerRefund
    || Number(m?.platform_service_fee_returned) !== (operation.platformRefund ?? 0)
    || operation.platformFunding && Number(m?.kitchen_debt_cents) !== operation.kitchenDebtCents) throw Error('The provider receipt does not match the reserved refund');
  return receipt;
}
