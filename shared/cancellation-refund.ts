export type RefundReceipt = { id: string; customerReceived: number; managerDebited: number; platformServiceFeeReturned: number };

export function isCancellationReservationSource(source: { paymentIntentId: string | null; metadata: unknown }, originalIntentIds: Array<string | null>,
  extensionIntentIds: Array<string | null>, parentIntent: string | null) {
  const saved = (source.metadata || {}) as Record<string, any>;
  if (['damage_claim', 'overstay_penalty'].includes(saved.type) || saved.damage_claim_id || saved.overstay_record_id) return false;
  if (source.paymentIntentId && [...originalIntentIds, ...extensionIntentIds].includes(source.paymentIntentId)) return true;
  if (saved.kitchenChangeId && saved.originalBookingPaymentIntentId === parentIntent && parentIntent) return true;
  throw new Error('Ambiguous legacy payment purpose requires Local Cooks review before cancellation');
}
const cents = (value: unknown) => {
  const result = Number(value);
  if (value === null || value === undefined || !Number.isSafeInteger(result) || result < 0) throw new Error('Verified refund allocations require review');
  return result;
};

/** Aggregate refunded totals cannot establish who funded a refund. */
export function cancellationSourceQuote(input: { captured: number; processingCost: number; serviceFee: number; refunded: number;
  refunds: Array<{ id: string; amount: number; status: string | null; metadata: Record<string, string> | null }>; localReceipts?: RefundReceipt[];
  retainedUsedAddonCents?: number }) {
  const captured = cents(input.captured), processingCost = cents(input.processingCost), serviceFee = cents(input.serviceFee);
  if (processingCost + serviceFee > captured) throw new Error('Captured source cannot fund its retained fees');
  const receipts: RefundReceipt[] = [];
  for (const refund of input.refunds) {
    if (refund.status !== 'succeeded') throw new Error('A prior refund is pending or failed; reconcile that source before accepting cancellation');
    const local = input.localReceipts?.find(item => item.id === refund.id);
    const hasProviderAllocation = refund.metadata?.customer_receives !== undefined;
    const receipt = hasProviderAllocation ? { id: refund.id, customerReceived: cents(refund.metadata?.customer_receives),
      managerDebited: cents(refund.metadata?.manager_debited), platformServiceFeeReturned: cents(refund.metadata?.platform_service_fee_returned) }
      : local;
    if (!receipt || receipt.customerReceived !== cents(refund.amount)
      || receipt.managerDebited + receipt.platformServiceFeeReturned !== receipt.customerReceived)
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
