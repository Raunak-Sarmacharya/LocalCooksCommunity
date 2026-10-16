import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchens, locations, paymentTransactions, equipmentBookings, storageBookings, pendingStorageExtensions } from '@shared/schema';
import { bookingChangeSchedule, kitchenRescheduleCutoff } from '@shared/kitchen-booking-change';
import { cancellationSourceQuote, isCancellationReservationSource } from '@shared/cancellation-refund';
import { DomainError } from '../shared/errors/domain-error';
import { createRefund, getCancellationPaymentFacts, getPaymentIntentRefunds, reverseTransferAndRefund, verifyCancellationRefundFunding } from './stripe-service';
import { cancelLinkedBookingDates, cancelledStorageStatus } from './booking-linked-cancellation';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { addPaymentHistory } from './payment-transactions-service';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { allocateCents, legacyCancellationSnapshot, quoteCancellation, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { policySessionStart } from './cancellation-policy-settings';

/** Staff use the same instant frozen-policy command as the chef. */
export async function requestChefCancellation(bookingId: number, chefId: number, actorId: number, publicMessage?: string, operationKey = `support-chef-cancel-${bookingId}`) {
  return cancelChefBooking(bookingId, chefId, operationKey, publicMessage, actorId);
}

/** Local Cooks goodwill changes neither the manager transfer nor their entitlement. */
export async function refundSupportGoodwill(bookingId: number, managerId: number, actorId: number, amount: number, operationKey: string) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    await assertBookingMoneyWritable({ bookingId, operationKey }, tx);
    const source = ctx.sources.find(row => row.paymentIntentId === ctx.parent.paymentIntentId);
    if (!source?.paymentIntentId || source.chefId !== ctx.parent.chefId || source.managerId !== managerId
      || !Number.isSafeInteger(amount) || amount <= 0) throw Error('A captured booking payment with verified ownership is needed for a refund.');
    const saved = metadata(source);
    if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
      || saved.kitchenCancellationRefund && saved.kitchenCancellationRefund.status !== 'succeeded'
      || saved.fullRefundRequest?.status === 'pending') throw Error('An earlier refund needs review before goodwill can be sent.');
    const facts = await getCancellationPaymentFacts(source.paymentIntentId);
    if (facts.currency !== source.currency.toLowerCase() || facts.captured !== Number(source.amount)) throw Error('The captured payment needs review.');
    cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
    const previous = facts.refunds.find(row => row.metadata?.refund_operation_id === operationKey);
    if (!previous && (facts.refunds.some(row => row.status !== 'succeeded') || amount > facts.captured - facts.refunded))
      throw Error('The refund exceeds the remaining payment, or another refund is still being checked.');
    const refund = await createRefund(source.paymentIntentId, amount, 'requested_by_customer', {
      sourceConnection: tx, idempotencyKey: operationKey,
      metadata: { booking_id: String(bookingId), transaction_id: String(source.id), support_actor_id: String(actorId),
        customer_receives: String(amount), manager_debited: '0', platform_service_fee_returned: '0', platform_goodwill_cents: String(amount) },
    });
    if (refund.status !== 'succeeded' || refund.amount !== amount || refund.charge !== facts.chargeId)
      throw Error('The refund is still being checked. Please review this original operation before trying again.');
    const verified = await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(source.paymentIntentId, tx);
    await tx.update(kitchenBookings).set({ paymentStatus: verified.status === 'refunded' ? 'refunded' : 'partially_refunded', updatedAt: new Date() })
      .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.paymentIntentId, source.paymentIntentId)));
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: verified.status, eventType: 'support_goodwill_verified',
      description: 'Local Cooks funded goodwill; kitchen transfer unchanged', createdBy: actorId,
      metadata: { operationKey, refundId: refund.id, amountCents: amount, fundedBy: 'local_cooks' } }, tx);
    return { refundId: refund.id, paymentIntentId: source.paymentIntentId, amountCents: refund.amount, localCooksPaysCents: refund.amount, managerPaysCents: 0 };
  });
}

/** The durable record of a kitchen-caused cancellation's refund. The cancellation is committed first; this tracks the money. */
export type KitchenRefundPlan = {
  /** Also the provider operation key (refund and reversal metadata), so every retry finds the original receipts. */
  id: string; status: 'pending' | 'succeeded'; expectedCents: number; reason: string; capturedRace: boolean; requestedAt: string; actorId: number;
  fundedByLocalCooks?: boolean; attempts: number; error?: string; failedAt?: string; refundId?: string; completedAt?: string;
};
export const kitchenRefundPlan = (source: { metadata?: unknown } | undefined): KitchenRefundPlan | undefined =>
  (source?.metadata as { kitchenCancellationRefund?: KitchenRefundPlan } | null | undefined)?.kitchenCancellationRefund;
const fromProvider = (message: string) => message.replace(/^Failed to (reverse transfer and refund|create refund): /, '');

/**
 * Kitchen cannot host: Local Cooks cancels and refunds the chef in full, absorbing the processing cost.
 *
 * Two steps, so a failing money step can never leave the chef's slot booked or the kitchen unsure what happened:
 * 1. Commit the cancellation (inventory and itinerary truth), the durable refund record and the chef's notice. No provider call.
 * 2. Reverse the kitchen's share and refund the chef under the original operation key; on failure the record keeps the
 *    problem for support (retry, or Local Cooks funds the refund) and the error is rethrown.
 * Used or separately charged add-ons need their own allocation review before this command.
 */
export async function cancelKitchenCausedBooking(bookingId: number, managerId: number, actorId: number, operationKey: string, reason = 'Kitchen unavailable',
  options: { fundedByLocalCooks?: boolean } = {}) {
  const committed = await commitKitchenCancellation(bookingId, managerId, actorId, operationKey, reason);
  if (committed.done) return { success: true, replayed: true };
  try {
    return await refundKitchenCancellation(bookingId, managerId, actorId, committed.planId, options);
  } catch (error) {
    await recordKitchenRefundProblem(bookingId, managerId, committed.planId, fromProvider((error as Error).message)).catch(() => undefined);
    throw error;
  }
}

async function commitKitchenCancellation(bookingId: number, managerId: number, actorId: number, operationKey: string, reason: string) {
  return db.transaction(async (tx): Promise<{ done: true } | { done: false; planId: string }> => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    const existingSource = ctx.sources.find(row => row.paymentIntentId && row.paymentIntentId === ctx.parent.paymentIntentId);
    const existing = kitchenRefundPlan(existingSource);
    // The cancellation is already committed (this call or an earlier one); only the refund can be outstanding.
    if (existing && ctx.parent.cancellationCause === 'kitchen') return existing.status === 'succeeded' ? { done: true } : { done: false, planId: existing.id };
    if (ctx.parent.cancellationOperationKey === operationKey && ctx.parent.cancellationCause === 'kitchen') return { done: true };
    await assertBookingMoneyWritable({ bookingId, operationKey }, tx);
    // A request that was declined/withdrawn/expired but whose card was captured before the hold could be released
    // (payment decision dead end). Local Cooks support refunds it in full here, then the decision is closed below.
    const decision = ctx.parent.paymentDecision as { state?: string; target?: string; deadEnd?: { kind?: string } } | null;
    const capturedRace = ctx.parent.status === 'pending' && decision?.state === 'pending' && decision.target === 'cancelled'
      && decision.deadEnd?.kind === 'captured_before_release' && ctx.parent.paymentStatus === 'paid';
    if ((ctx.parent.status !== 'confirmed' && !capturedRace) || ctx.sources.length !== 1 || ctx.storage.some(item => usedStorage(item) || item.checkinStatus === 'checkin_requested' || item.startDate && item.startDate.getTime() <= Date.now()) || ctx.equipment.some(usedEquipment))
      throw Error('This cancellation needs a review of linked payments or items already used. No refund has been sent.');
    const source = ctx.sources[0], saved = metadata(source);
    if (!source.paymentIntentId || source.paymentIntentId !== ctx.parent.paymentIntentId || source.chefId !== ctx.parent.chefId || source.managerId !== managerId
      || saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
      || saved.fullRefundRequest?.status === 'pending') throw Error('An earlier payment or refund needs review before cancellation.');
    const expectedCents = Number(source.amount) - Number(source.refundAmount || 0);
    if (expectedCents <= 0) throw Error('The payment has already been refunded. Review the cancellation separately.');
    const trimmed = reason.trim(), reference = ctx.parent.referenceCode || `#${bookingId}`;
    const plan: KitchenRefundPlan = { id: operationKey, status: 'pending', expectedCents, reason: trimmed, capturedRace, requestedAt: new Date().toISOString(), actorId, attempts: 0 };
    await tx.update(paymentTransactions).set({ metadata: { ...saved, kitchenCancellationRefund: plan }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
    await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: new Date(), cancellationOperationKey: operationKey,
      cancellationCause: 'kitchen', cancellationRequestReason: trimmed, updatedAt: new Date(),
      // The cancellation decision itself is finished; the refund is tracked on the payment record, never by a stuck decision.
      ...(capturedRace ? { paymentDecision: { ...decision, state: 'complete', completedAt: new Date().toISOString(), resolution: 'refund_pending_after_capture' } } : {}) })
      .where(eq(kitchenBookings.id, bookingId));
    await cancelLinkedBookingDates(tx, bookingId);
    const dollars = `$${(expectedCents / 100).toFixed(2)}`;
    await queueBookingLifecycleEvent(tx, bookingId, 'cancelled', capturedRace ? 'Your request was not accepted' : 'The kitchen can’t host your booking',
      capturedRace
        ? `Your request was not accepted, but your card was charged before the hold could be released. Your full payment of ${dollars} is being refunded, including the card processing fee. Reference ${reference}. Your bank may take a few days to show it. Questions? Contact Local Cooks.`
        : `We’re sorry, the kitchen needs to cancel: ${trimmed}. Your full payment of ${dollars} is being refunded, including the card processing fee. Reference ${reference}. Your bank may take a few days to show it. Questions? Contact Local Cooks.`, actorId,
      capturedRace
        ? { kitchenCaused: true, roleText: {
          chef: { title: 'Your request was not accepted', message: `Your request was not accepted, but your card was charged before the hold could be released. Your full payment of ${dollars} is being refunded, including the card processing fee. Reference ${reference}. Your bank may take a few days to show it. Questions? Contact Local Cooks.` },
          manager: { title: 'Request not accepted', message: 'The chef’s card was charged before the hold could be released, so Local Cooks is refunding them in full. Your payout for this booking is $0.00.' } } }
        : { kitchenCaused: true, cancellationNotice: { cause: 'kitchen', refundCents: expectedCents, reason: trimmed, kitchenShareRetainedCents: 0, reference }, roleText: { manager: {
          title: 'You cancelled as the kitchen', message: 'The chef receives a full refund. Your payout for this booking is $0.00.' } } });
    return { done: false, planId: plan.id };
  });
}

async function refundKitchenCancellation(bookingId: number, managerId: number, actorId: number, planId: string, options: { fundedByLocalCooks?: boolean }) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    const source = ctx.sources.find(row => row.paymentIntentId && row.paymentIntentId === ctx.parent.paymentIntentId);
    const plan = kitchenRefundPlan(source);
    if (!source?.paymentIntentId || !plan || plan.id !== planId) throw Error('The cancellation refund record is missing. Review the payment before another attempt.');
    if (plan.status === 'succeeded') return { success: true, replayed: true };
    await assertBookingMoneyWritable({ bookingId, operationKey: plan.id }, tx);
    const saved = metadata(source), capturedRace = plan.capturedRace;
    if (source.chefId !== ctx.parent.chefId || source.managerId !== managerId
      || saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
      || saved.fullRefundRequest?.status === 'pending') throw Error('An earlier payment or refund needs review before the refund can be sent.');
    const facts = await getCancellationPaymentFacts(source.paymentIntentId);
    if (facts.captured !== Number(source.amount) || facts.currency !== source.currency.toLowerCase()) throw Error('The captured payment needs review.');
    if (facts.refunds.some(receipt => Number(receipt.metadata?.platform_goodwill_cents || 0) > 0))
      throw Error('An earlier goodwill refund needs a funding review before the kitchen cancellation. No new refund has been sent.');
    const originalReceipt = facts.refunds.find(row => row.metadata?.refund_operation_id === plan.id);
    if (originalReceipt && originalReceipt.status !== 'succeeded') throw Error('The original refund still needs review.');
    const quotedFacts = originalReceipt ? { ...facts, refunded: facts.refunded - originalReceipt.amount, refunds: facts.refunds.filter(row => row.id !== originalReceipt.id) } : facts;
    const money = cancellationSourceQuote({ ...quotedFacts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
    const amount = originalReceipt?.amount ?? facts.captured - facts.refunded;
    if (amount <= 0) throw Error('The payment has already been refunded. Review the cancellation separately.');
    // Local Cooks funding: the kitchen's balance is not touched, so a reversal that cannot be funded never blocks the chef's refund.
    // An original receipt fixes what the kitchen was already debited; only a new refund can choose the funding.
    const localCooksFunds = options.fundedByLocalCooks ?? plan.fundedByLocalCooks ?? false;
    const managerDebit = originalReceipt ? Number(originalReceipt.metadata?.manager_debited ?? Math.min(amount, money.managerRefund))
      : localCooksFunds ? 0 : Math.min(amount, money.managerRefund);
    const serviceFeeReturn = Math.min(amount - managerDebit, money.serviceFeeReview);
    if (!originalReceipt && managerDebit > 0) await verifyCancellationRefundFunding(source.paymentIntentId, source.transferId, managerDebit);
    const refund = await reverseTransferAndRefund(source.paymentIntentId, amount, 'requested_by_customer', {
      sourceConnection: tx, idempotencyKey: plan.id, reverseTransferAmount: managerDebit,
      metadata: { booking_id: String(bookingId), transaction_id: String(source.id), support_actor_id: String(actorId),
        customer_receives: String(amount), manager_debited: String(managerDebit), platform_service_fee_returned: String(serviceFeeReturn),
        platform_processing_cost_cents: String(amount - managerDebit - serviceFeeReturn) },
    });
    await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(source.paymentIntentId, tx);
    // A kitchen-caused cancellation refunds the whole captured payment, so the payment row says so
    // (reconciliation can leave 'partially_refunded' when it nets out the absorbed processing cost).
    const [refundedRow] = await tx.select({ amount: paymentTransactions.amount, refundAmount: paymentTransactions.refundAmount, metadata: paymentTransactions.metadata }).from(paymentTransactions).where(eq(paymentTransactions.id, source.id)).limit(1);
    const done: KitchenRefundPlan = { ...plan, status: 'succeeded', refundId: refund.refundId, completedAt: new Date().toISOString(), error: undefined, failedAt: undefined,
      ...(options.fundedByLocalCooks !== undefined ? { fundedByLocalCooks: options.fundedByLocalCooks } : {}) };
    await tx.update(paymentTransactions).set({ metadata: { ...((refundedRow?.metadata as Record<string, any>) || saved), kitchenCancellationRefund: done },
      ...(refundedRow && Number(refundedRow.refundAmount) >= Number(refundedRow.amount) ? { status: 'refunded' as const } : {}), updatedAt: new Date() })
      .where(eq(paymentTransactions.id, source.id));
    const decision = ctx.parent.paymentDecision as Record<string, unknown> | null;
    await tx.update(kitchenBookings).set({ paymentStatus: 'refunded', updatedAt: new Date(),
      // The refund closes the saved cancellation decision, so recovery and the support console treat it as finished.
      ...(capturedRace && decision ? { paymentDecision: { ...decision, state: 'complete', resolution: 'refunded_after_capture', refundId: refund.refundId } } : {}) })
      .where(eq(kitchenBookings.id, bookingId));
    if (source.payoutTiming === 'after_closeout') await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx);
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: 'refunded', eventType: 'kitchen_caused_cancellation',
      description: localCooksFunds ? 'Kitchen cancellation fully refunded; Local Cooks funded the refund' : 'Kitchen cancellation fully refunded; Local Cooks absorbed processing cost', createdBy: actorId,
      metadata: { operationKey: plan.id, amountCents: amount, processingCostAbsorbedCents: amount - managerDebit - serviceFeeReturn, refundId: refund.refundId, fundedByLocalCooks: localCooksFunds } }, tx);
    await queueBookingLifecycleEvent(tx, bookingId, 'support_updated', 'Your refund was sent',
      `Your full refund of $${(amount / 100).toFixed(2)} for ${ctx.parent.referenceCode || `#${bookingId}`} was sent. Banks usually show it within 5–10 business days.`, actorId,
      { recipientPolicy: 'chef', kitchenCancellationRefundId: plan.id });
    return { refundId: refund.refundId, transferReversalId: refund.transferReversalId, amountCents: amount, paymentIntentId: source.paymentIntentId,
      managerPaysCents: managerDebit, localCooksPaysCents: amount - managerDebit, processingCostAbsorbedCents: amount - managerDebit - serviceFeeReturn };
  });
}

/** The money step failed after the cancellation was committed: keep the verified problem for support, tell Local Cooks once. */
async function recordKitchenRefundProblem(bookingId: number, managerId: number, planId: string, message: string) {
  await db.transaction(async tx => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    const source = ctx.sources.find(row => row.paymentIntentId && row.paymentIntentId === ctx.parent.paymentIntentId);
    const plan = kitchenRefundPlan(source);
    if (!source || !plan || plan.id !== planId || plan.status === 'succeeded') return;
    const first = !plan.error;
    await tx.update(paymentTransactions).set({ metadata: { ...metadata(source), kitchenCancellationRefund: { ...plan, attempts: plan.attempts + 1, error: message.slice(0, 500), failedAt: new Date().toISOString() } },
      updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
    if (first) await queueBookingLifecycleEvent(tx, bookingId, 'support_updated', 'A kitchen cancellation refund needs attention',
      `${ctx.parent.referenceCode || `#${bookingId}`} was cancelled because the kitchen can’t host, but the full refund of $${(plan.expectedCents / 100).toFixed(2)} did not go through: ${message.slice(0, 200)}. The chef has been told their refund is being processed. Open the booking in support to retry it or fund it from Local Cooks.`,
      undefined, { recipientPolicy: 'admins', supportCase: true, kitchenCancellationRefundId: plan.id });
  });
}
export type KitchenAddonRefundResult = { refundIds: string[]; amountCents: number; managerPaysCents: number; localCooksPaysCents: number; processingCostAbsorbedCents: number; replayed?: boolean };
/** Policy R1: an add-on the KITCHEN cancels is refunded to the chef in full, including its share of the card processing fee.
 * The kitchen's payout drops by the item's kitchen share only (price net of its card-fee share); Local Cooks absorbs the card fee
 * and returns the item's service-fee share. The add-on must already be cancelled; this only moves the money. */
export async function refundKitchenCausedAddons(bookingId: number, managerId: number, actorId: number, operationKey: string, picks: CancellationScope[]): Promise<KitchenAddonRefundResult> {
  if (!picks.length) throw Error('Choose at least one add-on to refund.');
  if (new Set(picks.map(pick => `${pick.kind}:${pick.id}`)).size !== picks.length) throw Error('Each add-on can be refunded once.');
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    await assertBookingMoneyWritable({ bookingId, operationKey }, tx);
    if (ctx.parent.status !== 'confirmed') throw Error('Add-on refunds are only available on confirmed bookings.');
    const groups = new Map<number, { source: Source; picks: CancellationScope[] }>();
    for (const pick of picks) {
      const item = (pick.kind === 'storage' ? ctx.storage : ctx.equipment).find(row => row.id === pick.id);
      if (!item || item.status !== 'cancelled') throw Error('Cancel the add-on first, then refund it.');
      if (pick.kind === 'storage' ? usedStorage(item as typeof storageBookings.$inferSelect) : usedEquipment(item as typeof equipmentBookings.$inferSelect))
        throw Error('This add-on was already used, so its payment stays with the kitchen.');
      const source = ctx.sources.find(row => row.bookingType === pick.kind && row.bookingId === pick.id)
        ?? ctx.sources.find(row => row.paymentIntentId && row.paymentIntentId === item.paymentIntentId);
      // Nothing was ever captured for this add-on (still pending, never paid): there is no money to return.
      if (!source || ['pending', 'authorized', 'failed', 'canceled'].includes(source.status)) continue;
      if (!source.paymentIntentId || !['succeeded', 'partially_refunded'].includes(source.status) || source.chefId !== ctx.parent.chefId || source.managerId !== managerId)
        throw Error('No verified captured payment found for this add-on.');
      const group = groups.get(source.id) ?? { source, picks: [] };
      group.picks.push(pick); groups.set(source.id, group);
    }
    if (!groups.size) return { refundIds: [], amountCents: 0, managerPaysCents: 0, localCooksPaysCents: 0, processingCostAbsorbedCents: 0 };
    const refundIds: string[] = []; let amount = 0, managerPays = 0, platformPays = 0, processing = 0, replayed = true;
    for (const { source, picks: sourcePicks } of Array.from(groups.values())) {
      const saved = metadata(source);
      if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded' || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
        || saved.fullRefundRequest?.status === 'pending') throw Error('An earlier payment or refund needs review before this add-on refund.');
      const key = groups.size === 1 ? operationKey : `${operationKey}:${source.id}`;
      const done: Array<{ kind: string; id: number; operationKey: string }> = saved.kitchenAddonRefunds || [];
      if (sourcePicks.some(pick => done.some(row => row.kind === pick.kind && row.id === pick.id && row.operationKey !== key)))
        throw Error('This add-on was already refunded.');
      const facts = await getCancellationPaymentFacts(source.paymentIntentId!);
      if (facts.currency !== source.currency.toLowerCase() || facts.captured !== Number(source.amount)) throw Error('The captured payment needs review.');
      if (facts.refunds.some(receipt => Number(receipt.metadata?.platform_goodwill_cents || 0) > 0)) throw Error('An earlier goodwill refund needs a funding review before this add-on refund.');
      const original = facts.refunds.find(row => row.metadata?.refund_operation_id === key);
      if (original && original.status !== 'succeeded') throw Error('The original refund still needs review.');
      const quotedFacts = original ? { ...facts, refunded: facts.refunded - original.amount, refunds: facts.refunds.filter(row => row.id !== original.id) } : facts;
      const money = cancellationSourceQuote({ ...quotedFacts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
      const allocations = (saved.capturedComponentAllocations as Array<{ kind: string; bookingId: number; managerGrossCents: number }> | undefined)
        ?? (['storage', 'equipment'].includes(source.bookingType) ? [{ kind: source.bookingType, bookingId: source.bookingId!, managerGrossCents: facts.captured - Number(source.serviceFee) }] : undefined);
      if (!allocations || allocations.reduce((sum, row) => sum + row.managerGrossCents, 0) !== facts.captured - Number(source.serviceFee))
        throw new DomainError('CANCELLATION_ALLOCATION_REVIEW', 'This add-on shares a captured charge without frozen component allocations. Local Cooks must verify its paid amount first.', 409);
      const grosses = allocations.map(row => row.managerGrossCents);
      const platformShares = allocateCents(Number(source.serviceFee), grosses), feeShares = allocateCents(facts.processingCost, grosses);
      let customer = 0, kitchenDebit = 0, platformReturn = 0, feeAbsorbed = 0;
      for (const pick of sourcePicks) {
        const index = allocations.findIndex(row => row.kind === pick.kind && row.bookingId === pick.id);
        if (index < 0 || allocations.filter(row => row.kind === pick.kind && row.bookingId === pick.id).length !== 1) throw new DomainError('CANCELLATION_ALLOCATION_REVIEW', 'This add-on has no frozen paid amount. Local Cooks must verify it first.', 409);
        customer += grosses[index] + platformShares[index]; kitchenDebit += grosses[index] - feeShares[index];
        platformReturn += platformShares[index]; feeAbsorbed += feeShares[index];
      }
      if (customer > facts.captured - quotedFacts.refunded || kitchenDebit > money.managerRefund || platformReturn > money.serviceFeeReview)
        throw Error('The remaining payment cannot fund this add-on refund. Local Cooks must review it.');
      if (!original) await verifyCancellationRefundFunding(source.paymentIntentId!, source.transferId, kitchenDebit);
      const refund = await reverseTransferAndRefund(source.paymentIntentId!, customer, 'requested_by_customer', {
        sourceConnection: tx, idempotencyKey: key, reverseTransferAmount: kitchenDebit,
        metadata: { booking_id: String(bookingId), transaction_id: String(source.id), support_actor_id: String(actorId), kitchen_caused_addons: sourcePicks.map(pick => `${pick.kind}:${pick.id}`).join(','),
          customer_receives: String(customer), manager_debited: String(kitchenDebit), platform_service_fee_returned: String(platformReturn), platform_processing_cost_cents: String(feeAbsorbed) },
      });
      const verified = await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(source.paymentIntentId!, tx);
      const [fresh] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, source.id)).limit(1);
      await tx.update(paymentTransactions).set({ metadata: { ...metadata(fresh ?? source), kitchenAddonRefunds: [...done.filter(row => row.operationKey !== key), ...sourcePicks.map(pick => ({ ...pick, operationKey: key }))] }, updatedAt: new Date() })
        .where(eq(paymentTransactions.id, source.id));
      if (source.paymentIntentId === ctx.parent.paymentIntentId)
        await tx.update(kitchenBookings).set({ paymentStatus: verified.status === 'refunded' ? 'refunded' : 'partially_refunded', updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
      if (!original) replayed = false;
      await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: verified.status, eventType: 'kitchen_caused_addon_refund',
        description: 'Kitchen cancelled an add-on; chef refunded in full, Local Cooks absorbed the card processing fee', createdBy: actorId,
        metadata: { operationKey: key, amountCents: customer, kitchenDebitCents: kitchenDebit, processingCostAbsorbedCents: feeAbsorbed, serviceFeeReturnedCents: platformReturn, refundId: refund.refundId } }, tx);
      refundIds.push(refund.refundId); amount += customer; managerPays += kitchenDebit; platformPays += customer - kitchenDebit; processing += feeAbsorbed;
    }
    return { refundIds, amountCents: amount, managerPaysCents: managerPays, localCooksPaysCents: platformPays, processingCostAbsorbedCents: processing, ...(replayed ? { replayed } : {}) };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
export type CancellationScope = { kind: 'storage' | 'equipment'; id: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const metadata = (source: Source): Record<string, any> => (source.metadata as Record<string, any>) || {};
const usedStorage = (item: typeof storageBookings.$inferSelect) => item.status === 'completed' || item.checkinStatus === 'checkin_completed';
const usedEquipment = (item: typeof equipmentBookings.$inferSelect) => item.status === 'completed';

async function context(tx: Tx, bookingId: number, actorId: number, role: 'manager' | 'chef', lock = false) {
  const [row] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || (role === 'manager' ? row.managerId : row.booking.chefId) !== actorId) throw new Error('Booking not found or access denied');
  let storage = await tx.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, bookingId));
  let equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, bookingId));
  const sourceWhere = or(and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.bookingId, bookingId)),
    ...(storage.length ? [and(eq(paymentTransactions.bookingType, 'storage'), inArray(paymentTransactions.bookingId, storage.map(item => item.id)))] : []),
    ...(equipment.length ? [and(eq(paymentTransactions.bookingType, 'equipment'), inArray(paymentTransactions.bookingId, equipment.map(item => item.id)))] : []));
  // Source locks precede the parent, matching direct refunds and late payouts.
  const sources = lock ? await tx.select().from(paymentTransactions).where(sourceWhere).orderBy(asc(paymentTransactions.id)).for('update')
    : await tx.select().from(paymentTransactions).where(sourceWhere).orderBy(asc(paymentTransactions.id));
  const parent = lock ? (await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).for('update'))[0] : row.booking;
  if (!parent) throw new Error('Booking no longer exists');
  if (lock) {
    const [owner] = await tx.select({ managerId: locations.managerId }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchens.id, parent.kitchenId)).for('share');
    if (!owner || (role === 'manager' ? owner.managerId : parent.chefId) !== actorId) throw new Error('Booking ownership changed; refresh before deciding');
    storage = await tx.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, bookingId)).orderBy(asc(storageBookings.id)).for('update');
    equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, bookingId)).orderBy(asc(equipmentBookings.id)).for('update');
    if (storage.some(item => item.chefId !== parent.chefId) || equipment.some(item => item.chefId !== parent.chefId)) throw new Error('Linked item ownership requires review');
    const currentIds = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(or(
      and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.bookingId, bookingId)),
      ...(storage.length ? [and(eq(paymentTransactions.bookingType, 'storage'), inArray(paymentTransactions.bookingId, storage.map(item => item.id)))] : []),
      ...(equipment.length ? [and(eq(paymentTransactions.bookingType, 'equipment'), inArray(paymentTransactions.bookingId, equipment.map(item => item.id)))] : [])));
    if (currentIds.length !== sources.length || currentIds.some(item => !sources.some(source => source.id === item.id))) throw new Error('Linked payment sources changed; refresh before deciding');
  }
  const extensions = storage.length ? await tx.select().from(pendingStorageExtensions).where(inArray(pendingStorageExtensions.storageBookingId, storage.map(item => item.id))) : [];
  const reservationSources = sources.filter(source => isCancellationReservationSource(source,
    [parent.paymentIntentId, ...storage.map(item => item.paymentIntentId), ...equipment.map(item => item.paymentIntentId)], extensions.map(item => item.stripePaymentIntentId), parent.paymentIntentId));
  const intentIds = reservationSources.map(source => source.paymentIntentId).filter(Boolean);
  if (new Set(intentIds).size !== intentIds.length) throw new Error('Duplicate captured source identity requires Local Cooks review before cancellation');
  return { parent, managerId: row.managerId!, timezone: row.timezone || 'America/St_Johns', storage, equipment, sources: reservationSources };
}

async function chefQuote(tx: Tx, ctx: Awaited<ReturnType<typeof context>>, cancelAt: Date, recoveringFee = false) {
  const snapshot = ctx.parent.cancellationPolicySnapshot as CancellationPolicySnapshot | null ?? legacyCancellationSnapshot(ctx.parent.cancellationPolicyHours, ctx.timezone,
    [{ startAt: policySessionStart(ctx.parent.bookingDate.toISOString(), ctx.parent.startTime, ctx.parent.operatingWindowStartTime || ctx.parent.startTime, ctx.timezone) }]);
  if (snapshot.policyId && snapshot.sessions[0]?.startAt && Date.parse(snapshot.sessions[0].startAt) !== Date.parse(policySessionStart(ctx.parent.bookingDate.toISOString(), ctx.parent.startTime, ctx.parent.operatingWindowStartTime || ctx.parent.startTime, snapshot.timezone)))
    throw new DomainError('CANCELLATION_AMENDMENT_REVIEW', 'The booking time changed after these terms were accepted. Local Cooks must verify the accepted new deadline before quoting a refund.', 409);
  const sources = [];
  for (const source of ctx.sources) {
    if (['pending', 'failed', 'canceled'].includes(source.status)) continue;
    if (!source.paymentIntentId || source.status === 'authorized' || source.chefId !== ctx.parent.chefId || source.managerId !== ctx.managerId) throw Error('Payment ownership or an unresolved hold needs review');
    const saved = metadata(source);
    if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded' || saved.fullRefundRequest?.status === 'pending'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
        && !(recoveringFee && saved.cancellationRefundOperation.status === 'fee_pending')) throw Error('An earlier refund needs review before cancellation');
    const facts = await getCancellationPaymentFacts(source.paymentIntentId);
    if (facts.currency !== source.currency.toLowerCase() || facts.captured !== Number(source.amount)) throw Error('Captured source differs from the payment ledger');
    const verified = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
    let allocations = saved.capturedComponentAllocations as Array<{ kind: 'kitchen' | 'equipment' | 'storage'; bookingId: number; managerGrossCents: number; sessionIndex?: number }> | undefined;
    if (!allocations) {
      if (['kitchen', 'bundle'].includes(source.bookingType) && [...ctx.storage, ...ctx.equipment].some(item => item.paymentIntentId === source.paymentIntentId)
        || snapshot.sessions.length !== 1) throw Error('Shared or multi-session payment needs frozen component allocations');
      allocations = [{ kind: source.bookingType === 'storage' ? 'storage' : source.bookingType === 'equipment' ? 'equipment' : 'kitchen', bookingId: source.bookingId!, managerGrossCents: facts.captured - Number(source.serviceFee) }];
    }
    if (allocations.reduce((sum, item) => sum + item.managerGrossCents, 0) !== facts.captured - Number(source.serviceFee)) throw Error('Frozen component allocation differs from capture');
    if (snapshot.sessions.length > 1 && allocations.some(item => item.sessionIndex === undefined)) throw Error('Multiple sessions need frozen per-session payment allocations before quoting a refund');
    const platform = allocateCents(Number(source.serviceFee), allocations.map(item => item.managerGrossCents));
    const components = allocations.map((item, index) => ({ id: `${item.kind}:${item.bookingId}:${item.sessionIndex ?? 0}`, bookingId: item.bookingId, kind: item.kind, sessionIndex: item.sessionIndex ?? 0,
      kitchenCents: item.managerGrossCents, platformCents: platform[index] }));
    const startedComponents = components.filter(item => item.kind === 'storage' ? ctx.storage.some(storage => item.bookingId === storage.id &&
      (usedStorage(storage) || ['checkin_requested', 'checkin_completed'].includes(storage.checkinStatus || '') || storage.startDate <= cancelAt))
      : item.kind === 'equipment' && ctx.equipment.some(equipment => item.bookingId === equipment.id && usedEquipment(equipment))).map(item => item.id);
    const engine = quoteCancellation(snapshot, { cancelAt, confirmedAt: ctx.parent.createdAt || cancelAt, capturedCents: facts.captured, processingFeeCents: facts.processingCost,
      components, startedComponents, cause: 'chef', alreadyRefundedCents: facts.refunded,
      alreadyKitchenRefundedCents: verified.receipts.reduce((sum, item) => sum + item.managerDebited, 0),
      alreadyPlatformRefundedCents: verified.receipts.reduce((sum, item) => sum + item.platformServiceFeeReturned, 0) });
    if (!engine.quoteReady) throw Error('Actual card processing fee is not yet verified');
    const funding = engine.kitchenRefundCents ? await verifyCancellationRefundFunding(source.paymentIntentId, source.transferId, engine.kitchenRefundCents) : null;
    sources.push({ transactionId: source.id, intentId: source.paymentIntentId, currency: source.currency, processingCost: facts.processingCost,
      feeProvenance: { balanceTransactionId: facts.balanceTransactionId, details: facts.feeDetails, classification: 'stripe_fee' },
      serviceFee: Number(source.serviceFee), receipts: verified.receipts, funding, ...engine });
  }
  if (!sources.length) throw Error('No captured booking payment is verified');
  return { bookingId: ctx.parent.id, quoteReady: true, snapshot, cancelAt: cancelAt.toISOString(),
    alreadyRefundedCents: sources.reduce((sum, source) => sum + source.alreadyRefundedCents, 0),
    chefRefundCents: sources.reduce((sum, source) => sum + source.chefRefundCents, 0), feeRetainedCents: sources.reduce((sum, source) => sum + source.feeRetainedCents, 0),
    retainedCents: sources.reduce((sum, source) => sum + source.retainedCents, 0), kitchenShareRetainedCents: sources.reduce((sum, source) => sum + source.kitchenShareRetainedCents, 0), sources };
}

export async function readChefCancellationQuote(bookingId: number, chefId: number) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, chefId, 'chef', true);
    if (ctx.parent.status === 'pending' && ['pending', 'authorized', 'failed'].includes(ctx.parent.paymentStatus || ''))
      return { bookingId, quoteReady: true, reasonCode: 'hold_release', chefRefundCents: 0, feeRetainedCents: 0, retainedCents: 0, sources: [] };
    if (ctx.parent.status === 'cancelled') return { bookingId, cancelled: true, sources: ctx.sources.map(source => metadata(source).cancellationRefundOperation) };
    if (!['confirmed', 'cancellation_requested'].includes(ctx.parent.status)) throw Error('This booking cannot be cancelled');
    await assertBookingMoneyWritable({ bookingId }, tx);
    try { return await chefQuote(tx, ctx, new Date()); }
    catch (error) { if ((error as Error).message.includes('not yet verified')) return { bookingId, quoteReady: false, reasonCode: 'processing_fee_pending' }; throw error; }
  });
}

/** Reserve the received time and every source operation before provider work. */
export async function cancelChefBooking(bookingId: number, chefId: number, operationKey: string, reason?: string, actorId = chefId, expectedRefundCents?: number) {
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(operationKey || '')) throw Error('A cancellation operation key is required');
  const managerId = await db.transaction(async tx => {
    const ctx = await context(tx, bookingId, chefId, 'chef', true);
    if (ctx.parent.cancellationOperationKey) {
      if (ctx.parent.cancellationOperationKey !== operationKey || ctx.parent.cancellationCause !== 'chef') throw Error('This booking was cancelled by another operation');
      return ctx.managerId;
    }
    await assertBookingMoneyWritable({ bookingId, operationKey }, tx);
    if (!['confirmed', 'cancellation_requested'].includes(ctx.parent.status) || (ctx.parent.paymentDecision as any)?.state === 'pending') throw Error('This booking cannot be cancelled in its current state');
    const cancelAt = new Date();
    let quoted: Awaited<ReturnType<typeof chefQuote>>;
    try { quoted = await chefQuote(tx, ctx, cancelAt); }
    catch (error) {
      if (!(error as Error).message.includes('not yet verified')) throw error;
      for (const source of ctx.sources.filter(source => !['pending', 'failed', 'canceled'].includes(source.status)))
        await tx.update(paymentTransactions).set({ metadata: { ...metadata(source), cancellationRefundOperation: {
          id: `chef-cancel-${bookingId}-${source.id}-${operationKey}`, intentId: source.paymentIntentId, bookingId, managerId: ctx.managerId,
          policyEngine: true, status: 'fee_pending', acceptedAt: cancelAt.toISOString(), supportOperationKey: actorId !== chefId ? operationKey : undefined,
        } }, updatedAt: cancelAt }).where(eq(paymentTransactions.id, source.id));
      await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: cancelAt, cancellationOperationKey: operationKey, cancellationCause: 'chef',
        cancellationRequestReason: reason?.trim() || null, updatedAt: cancelAt }).where(eq(kitchenBookings.id, bookingId));
      await cancelLinkedBookingDates(tx, bookingId);
      await queueBookingLifecycleEvent(tx, bookingId, 'cancelled', 'Booking cancelled',
        'Your booking is cancelled. We’re confirming the card processing fee before showing and issuing the exact refund. Local Cooks will follow up.', actorId, { feePending: true, cancellationNotice: { cause: 'chef', feePending: true } });
      return ctx.managerId;
    }
    if (expectedRefundCents !== undefined && expectedRefundCents !== quoted.chefRefundCents) throw Error('The cancellation refund changed. Review the refreshed amounts before cancelling.');
    for (const money of quoted.sources) {
      const source = ctx.sources.find(item => item.id === money.transactionId)!;
      const operation = { ...money, id: `chef-cancel-${bookingId}-${source.id}-${operationKey}`, bookingId, managerId: ctx.managerId, policyEngine: true,
        managerRefund: money.kitchenRefundCents, customerRefund: money.chefRefundCents, platformRefund: money.platformRefundCents, cancellationNoticeIncludesRefund: true,
        status: money.chefRefundCents ? 'pending' : 'succeeded', acceptedAt: cancelAt.toISOString(), supportOperationKey: actorId !== chefId ? operationKey : undefined };
      await tx.update(paymentTransactions).set({ stripeProcessingFee: String(money.processingCost), managerRevenue: String(money.capturedCents - money.processingCost - money.serviceFee),
        metadata: { ...metadata(source), refunds: money.receipts, cancellationRefundOperation: operation }, updatedAt: cancelAt }).where(eq(paymentTransactions.id, source.id));
      await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'policy_cancellation_reserved', description: 'Frozen policy refund reserved before provider work', createdBy: actorId, metadata: operation }, tx);
    }
    await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: cancelAt, cancellationOperationKey: operationKey, cancellationCause: 'chef', cancellationRequestReason: reason?.trim() || null, updatedAt: cancelAt }).where(eq(kitchenBookings.id, bookingId));
    await cancelLinkedBookingDates(tx, bookingId);
    if (ctx.sources.some(source => source.payoutTiming === 'after_closeout')) await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx);
    const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    await queueBookingLifecycleEvent(tx, bookingId, 'cancelled', 'Booking cancelled',
      quoted.chefRefundCents ? `You cancelled your booking. Your refund is ${dollars(quoted.chefRefundCents)}; the ${dollars(quoted.feeRetainedCents)} card processing fee is kept. Your bank may take a few days to show it.` : 'You cancelled your booking. There is no refund under your booking’s saved policy.', actorId,
      { cancellationNotice: { cause: 'chef', refundCents: quoted.chefRefundCents, alreadyRefundedCents: quoted.alreadyRefundedCents, feeCents: quoted.feeRetainedCents, kitchenShareRetainedCents: quoted.kitchenShareRetainedCents }, roleText: { manager: { title: 'Booking cancelled', message: `The chef cancelled. Your payout for this booking is ${dollars(quoted.kitchenShareRetainedCents)}.` } }, cancellationQuote: quoted });
    return ctx.managerId;
  });
  await retryCancellationRefund(bookingId, managerId);
  return { success: true, action: 'cancelled', ...(await readCancellationRefund(bookingId, chefId, 'chef')) };
}

async function quote(tx: Tx, bookingId: number, managerId: number, scope?: CancellationScope) {
  const ctx = await context(tx, bookingId, managerId, 'manager', true);
  const selectedItem = scope ? (scope.kind === 'storage' ? ctx.storage : ctx.equipment).find(item => item.id === scope.id) : undefined;
  if (scope && (!selectedItem || selectedItem.status !== 'cancellation_requested' || ctx.parent.status !== 'confirmed')) throw new Error('No selected add-on cancellation awaits a decision');
  if (!scope && (ctx.parent.status !== 'cancellation_requested' || !ctx.parent.cancellationRequestedAt)) throw new Error('No cancellation request awaits a decision');
  const requestedAt = scope ? ('cancellationRequestedAt' in selectedItem! ? selectedItem!.cancellationRequestedAt : selectedItem!.updatedAt) : ctx.parent.cancellationRequestedAt;
  if (!requestedAt) throw new Error('Saved cancellation request time requires review');
  const cutoff = kitchenRescheduleCutoff(bookingChangeSchedule(ctx.parent), ctx.parent.cancellationPolicyHours ?? 24);
  if (Date.now() >= cutoff || requestedAt.getTime() >= cutoff) throw new Error('The saved cancellation cutoff has passed');
  if (ctx.storage.some(item => item.startDate.getTime() <= Date.now() && !usedStorage(item)
    && !['cancelled', 'completed'].includes(item.status)))
    throw new DomainError('CANCELLATION_STORAGE_REVIEW', 'Linked storage has started but actual use is unverified. Local Cooks must verify its use before quoting retained or refundable payments; its reservation remains recorded.', 409);
  const sources = [];
  for (const source of ctx.sources) {
    if (scope && source.paymentIntentId !== selectedItem!.paymentIntentId && !(source.bookingType === scope.kind && source.bookingId === scope.id)) continue;
    if (['pending', 'authorized', 'failed', 'canceled'].includes(source.status)) {
      if (source.status === 'authorized') throw new Error('A linked source has an unresolved card hold; verify its release before quoting cancellation');
      continue;
    }
    if (!source.paymentIntentId || source.chefId !== ctx.parent.chefId || source.managerId !== managerId) throw new Error('Captured source ownership requires review');
    const saved = metadata(source);
    if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded') throw new Error('A previous direct refund/reversal requires owned verification before cancellation can be quoted');
    if (saved.fullRefundRequest?.status === 'pending' || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded')
      throw new Error('A source already has an unresolved refund decision');
    const facts = await getCancellationPaymentFacts(source.paymentIntentId);
    if (facts.currency !== source.currency.toLowerCase() || facts.captured !== Number(source.amount)) throw new Error('Captured source differs from the retained ledger');
    const localReceipts = (saved.refunds || []).map((item: any) => ({ ...item, id: item.id || item.refundId }));
    const entirelyUsed = source.bookingType === 'storage' && ctx.storage.some(item => item.id === source.bookingId && usedStorage(item))
      || source.bookingType === 'equipment' && ctx.equipment.some(item => item.id === source.bookingId && usedEquipment(item));
    const usedItems = [...ctx.storage.filter(usedStorage).map(item => ({ kind: 'storage', id: item.id, intentId: item.paymentIntentId })),
      ...ctx.equipment.filter(usedEquipment).map(item => ({ kind: 'equipment', id: item.id, intentId: item.paymentIntentId }))];
    const usedInSource = usedItems.filter(item => item.intentId === source.paymentIntentId);
    let retainedUsedAddonCents = entirelyUsed ? facts.captured - facts.processingCost - Number(source.serviceFee) : 0;
    if (usedInSource.length && !entirelyUsed) {
      if (['storage', 'equipment'].includes(source.bookingType)) continue; // Used standalone source stays paid in full.
      // Never manufacture a tax/fee allocation for mixed historical charges.
      const allocations = saved.capturedComponentAllocations;
      if (!Array.isArray(allocations) || allocations.reduce((sum: number, item: any) => sum + Number(item.managerGrossCents), 0) !== Number(source.baseAmount)
        || allocations.some((item: any) => !Number.isSafeInteger(item.managerGrossCents) || item.managerGrossCents < 0))
        throw new DomainError('CANCELLATION_ALLOCATION_REVIEW', 'Used add-on payments stay retained. This bundled source lacks frozen component allocations; Local Cooks must verify them before cancellation can be accepted.', 409);
      for (const item of usedInSource) {
        const allocation = allocations.filter((entry: any) => entry.kind === item.kind && entry.bookingId === item.id);
        if (allocation.length !== 1) throw new Error('Used add-on component allocation requires Local Cooks review');
        retainedUsedAddonCents += allocation[0].managerGrossCents;
      }
    }
    const money = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts, retainedUsedAddonCents });
    if (entirelyUsed) money.managerRefund = 0;
    // Mixed sources lack verified component service-fee allocations; retain fees for owned review.
    if (entirelyUsed || usedInSource.length) money.serviceFeeReview = 0;
    if (scope && ['kitchen', 'bundle'].includes(source.bookingType)) {
      const allocations = saved.capturedComponentAllocations;
      const allocation = Array.isArray(allocations) ? allocations.filter((item: any) => item.kind === scope.kind && item.bookingId === scope.id) : [];
      if (allocation.length !== 1 || !Number.isSafeInteger(allocation[0].managerGrossCents) || allocation[0].managerGrossCents < 0
        || allocations.reduce((sum: number, item: any) => sum + Number(item.managerGrossCents), 0) !== Number(source.baseAmount))
        throw new DomainError('CANCELLATION_ALLOCATION_REVIEW', 'This selected add-on shares a captured charge without frozen component allocations. Local Cooks must verify its original paid component before acceptance.', 409);
      if (money.alreadyRefunded && (saved.cancellationRefundOperation?.scope?.id !== scope.id || saved.cancellationRefundOperation?.scope?.kind !== scope.kind))
        throw new Error('Prior refund component entitlement requires Local Cooks review before selected add-on acceptance');
      money.managerRefund = Math.min(money.managerRefund, allocation[0].managerGrossCents);
      money.serviceFeeReview = 0; // A selected component cannot return the whole source service fee.
    }
    const funding = money.managerRefund ? await verifyCancellationRefundFunding(source.paymentIntentId, source.transferId, money.managerRefund) : { transferId: source.transferId, available: null };
    sources.push({ transactionId: source.id, intentId: source.paymentIntentId, currency: source.currency, ...money, funding,
      version: hash({ updatedAt: source.updatedAt, refundAmount: source.refundAmount, metadata: saved, chargeId: facts.chargeId }) });
  }
  if (!sources.length) throw new Error('No captured sources are verified for this paid cancellation');
  const items = [...ctx.storage.map(item => ({ kind: 'storage', id: item.id, updatedAt: item.updatedAt.toISOString(),
    paymentTreatment: usedStorage(item) ? 'used_payment_retained' : 'unused_manager_share_refund',
    treatment: !['checkout_approved', 'completed', 'checkout_claim_filed'].includes(item.checkoutStatus || 'active')
      && (['checkin_requested', 'checkin_completed'].includes(item.checkinStatus || '') || item.startDate.getTime() <= Date.now())
      ? 'removal_required' : item.status === 'completed' ? 'completed' : 'cancelled' })),
    ...ctx.equipment.map(item => ({ kind: 'equipment', id: item.id, updatedAt: item.updatedAt.toISOString(), paymentTreatment: usedEquipment(item) ? 'used_payment_retained' : 'unused_manager_share_refund', treatment: item.status === 'completed' ? 'completed' : 'cancelled' }))];
  const result = { bookingId, managerId, scope, parentVersion: ctx.parent.updatedAt.toISOString(), requestedAt: requestedAt.toISOString(), sources,
    items: scope ? items.filter(item => item.kind === scope.kind && item.id === scope.id) : items };
  return { ctx, quote: { ...result, quoteHash: hash(result) } };
}

export async function readCancellationRefund(bookingId: number, actorId: number, role: 'manager' | 'chef', scope?: CancellationScope) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, actorId, role);
    const saved = ctx.sources.flatMap(source => [...(metadata(source).cancellationRefundOperations || []), metadata(source).cancellationRefundOperation].filter(Boolean)
      .map(operation => ({ transactionId: source.id, operation, serviceFeeRequest: metadata(source).fullRefundRequest })))
      .filter(item => item.operation && (role === 'chef' || !scope && ctx.parent.status === 'confirmed'
        || (!scope && !item.operation.scope) || scope && item.operation.scope?.kind === scope.kind && item.operation.scope?.id === scope.id));
    if (saved.length) return { bookingId, accepted: true, sources: saved };
    if (role === 'chef') return { bookingId, accepted: false, sources: [] };
    return (await quote(tx, bookingId, actorId, scope)).quote;
  });
}

export async function acceptCancellationRefund(bookingId: number, managerId: number, quoteHash: string, scope?: CancellationScope, supportOperationKey?: string) {
  if (!/^[a-f0-9]{64}$/.test(quoteHash || '')) throw new Error('Review and acknowledge the current cancellation refund quote');
  await db.transaction(async tx => {
    const existing = await context(tx, bookingId, managerId, 'manager', true);
    const operations = existing.sources.map(source => metadata(source).cancellationRefundOperation).filter(Boolean);
    if (operations.some(operation => operation.quoteHash === quoteHash)) return;
    if (!scope && existing.parent.status === 'cancelled' && operations.length) {
      if (operations.some(operation => operation.quoteHash !== quoteHash)) throw new Error('Cancellation was accepted with a different quote');
      return;
    }
    const reviewed = await quote(tx, bookingId, managerId, scope);
    if (reviewed.quote.quoteHash !== quoteHash) throw new Error('Refund quote changed. Review the refreshed amounts before accepting');
    for (const money of reviewed.quote.sources) {
      const source = reviewed.ctx.sources.find(item => item.id === money.transactionId)!;
      const operation = { id: `booking-cancellation-${bookingId}-${money.transactionId}-${quoteHash}`, quoteHash, bookingId, managerId, scope,
        ...(supportOperationKey ? { supportOperationKey } : {}),
        ...money, items: reviewed.quote.items, status: money.managerRefund ? 'pending' : 'succeeded', acceptedAt: new Date().toISOString() };
      await tx.update(paymentTransactions).set({ metadata: { ...metadata(source), refunds: money.receipts, cancellationRefundOperations: [...(metadata(source).cancellationRefundOperations || []), ...(metadata(source).cancellationRefundOperation ? [metadata(source).cancellationRefundOperation] : [])], cancellationRefundOperation: operation },
        stripeProcessingFee: String(money.processingCost), managerRevenue: String(money.captured - money.processingCost - money.serviceFee), updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
      await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'cancellation_refund_reserved', description: 'Quoted manager-share cancellation refund reserved before provider work', metadata: operation, createdBy: managerId }, tx);
    }
    if (!scope) {
      await tx.update(kitchenBookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
      await cancelLinkedBookingDates(tx, bookingId);
      if (reviewed.ctx.sources.some(source => source.payoutTiming === 'after_closeout'))
        await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx);
    } else {
      let itemStatus = 'cancelled';
      if (scope.kind === 'storage') { const [updatedItem] = await tx.update(storageBookings).set({ status: cancelledStorageStatus, cancellationAcceptedAt: new Date(), updatedAt: new Date() }).where(eq(storageBookings.id, scope.id)).returning({ status: storageBookings.status }); itemStatus = updatedItem.status; }
      else await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(equipmentBookings.id, scope.id));
      const key = scope.kind === 'storage' ? 'storageItems' : 'equipmentItems';
      const itemKey = scope.kind === 'storage' ? 'storageBookingId' : 'equipmentBookingId';
      await tx.update(kitchenBookings).set({ [key]: (reviewed.ctx.parent[key] as any[] || []).map(item => (item[itemKey] ?? item.id) === scope.id
        ? { ...item, status: itemStatus, cancellationRequested: false, rejected: true } : item), updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
    }
    await queueBookingLifecycleEvent(tx, bookingId, 'cancellation_reviewed', scope ? 'Selected add-on cancellation accepted' : 'Kitchen cancellation accepted',
      `${scope ? 'Selected add-on cancellation' : 'Cancellation'} accepted. We’re checking the refund from the kitchen’s share. Processing costs are kept; the kitchen can ask Local Cooks to review the service fee separately. Storage in use stays reserved until collection is confirmed.`, managerId, { action: 'accept', quote: reviewed.quote });
  });
  await retryCancellationRefund(bookingId, managerId);
  return readCancellationRefund(bookingId, managerId, 'manager', scope);
}

export async function retryCancellationRefund(bookingId: number, managerId: number) {
  let ctx = await db.transaction(tx => context(tx, bookingId, managerId, 'manager'));
  if (ctx.sources.some(source => metadata(source).cancellationRefundOperation?.status === 'fee_pending')) {
    try {
      await db.transaction(async tx => {
        const locked = await context(tx, bookingId, managerId, 'manager', true);
        const pending = locked.sources.filter(source => metadata(source).cancellationRefundOperation?.status === 'fee_pending');
        if (!pending.length) return;
        await assertBookingMoneyWritable({ bookingId, operationKey: metadata(pending[0]).cancellationRefundOperation.supportOperationKey }, tx);
        const quoted = await chefQuote(tx, locked, new Date(metadata(pending[0]).cancellationRefundOperation.acceptedAt), true);
        for (const money of quoted.sources) {
          const source = pending.find(item => item.id === money.transactionId);
          if (!source) throw Error('Fee-pending source set changed; review required');
          const operation = metadata(source).cancellationRefundOperation;
          await tx.update(paymentTransactions).set({ stripeProcessingFee: String(money.processingCost), managerRevenue: String(money.capturedCents - money.processingCost - money.serviceFee),
            metadata: { ...metadata(source), refunds: money.receipts, cancellationRefundOperation: { ...operation, ...money,
              managerRefund: money.kitchenRefundCents, customerRefund: money.chefRefundCents, platformRefund: money.platformRefundCents,
              status: money.chefRefundCents ? 'pending' : 'succeeded' } }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
        }
      });
      ctx = await db.transaction(tx => context(tx, bookingId, managerId, 'manager'));
    } catch { return readCancellationRefund(bookingId, managerId, 'manager'); }
  }
  if (!ctx.sources.some(source => metadata(source).cancellationRefundOperation)) throw new Error('No accepted cancellation to reconcile');
  for (const original of ctx.sources) {
    const originalOperation = metadata(original).cancellationRefundOperation;
    if (!originalOperation || originalOperation.status === 'succeeded') continue;
    try {
      await db.transaction(async tx => {
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, original.id)).for('update');
        const saved = metadata(source), operation = saved.cancellationRefundOperation;
        if (!operation || operation.status === 'succeeded') return;
        if (operation.managerId !== managerId || operation.intentId !== source.paymentIntentId) throw new Error('Reserved refund source ownership changed');
        const receipts = await getPaymentIntentRefunds(operation.intentId);
        const previous = receipts.filter(item => item.metadata?.refund_operation_id === operation.id);
        if (previous.length > 1) throw new Error('Multiple provider receipts require Local Cooks review');
        if (previous[0] && previous[0].status !== 'succeeded') throw new Error(`Original refund ${previous[0].status}; verify the same operation with Local Cooks`);
        const customerRefund = operation.customerRefund ?? operation.managerRefund;
        const platformRefund = operation.platformRefund ?? 0;
        await assertBookingMoneyWritable({ bookingId, operationKey: operation.supportOperationKey }, tx);
        const result = await reverseTransferAndRefund(operation.intentId, customerRefund, 'requested_by_customer', {
          sourceConnection: tx, idempotencyKey: operation.id, supportOperationKey: operation.supportOperationKey, reverseTransferAmount: operation.managerRefund, refundApplicationFee: false,
          metadata: { booking_id: String(bookingId), transaction_id: String(source.id), manager_id: String(managerId),
            customer_receives: String(customerRefund), manager_debited: String(operation.managerRefund), platform_service_fee_returned: String(platformRefund) } });
        const facts = await getCancellationPaymentFacts(operation.intentId);
        const money = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
        if (!money.receipts.some(item => item.id === result.refundId && item.customerReceived === customerRefund && item.managerDebited === operation.managerRefund && item.platformServiceFeeReturned === platformRefund))
          throw new Error('Provider refund allocation differs from the reserved quote');
        const status = money.alreadyRefunded >= money.captured - money.processingCost ? 'refunded' : 'partially_refunded';
        await tx.update(paymentTransactions).set({ refundAmount: String(money.alreadyRefunded), netAmount: String(money.captured - money.alreadyRefunded),
          status, refundId: result.refundId, refundedAt: new Date(), updatedAt: new Date(), metadata: { ...saved, refunds: money.receipts,
            cancellationRefundOperation: { ...operation, status: 'succeeded', refundId: result.refundId, refunded: customerRefund, verifiedAt: new Date().toISOString(), error: null } } }).where(eq(paymentTransactions.id, source.id));
        if (['kitchen', 'bundle'].includes(source.bookingType)) await tx.update(kitchenBookings).set({ paymentStatus: status, updatedAt: new Date() })
          .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.paymentIntentId, source.paymentIntentId!)));
        await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: status, eventType: 'cancellation_refund_verified', description: 'Stripe verified the reserved cancellation refund; bank receipt is not confirmed', metadata: { ...operation, refundId: result.refundId }, createdBy: managerId }, tx);
        if (!operation.cancellationNoticeIncludesRefund) await queueBookingLifecycleEvent(tx, bookingId, 'refund_issued', 'Refund sent',
          `A refund of ${(customerRefund / 100).toFixed(2)} ${source.currency} has been sent. Processing costs are kept. It may take time to appear at the chef’s bank.`, managerId, { transactionId: source.id, refundId: result.refundId });
      });
    } catch (error) {
      await db.transaction(async tx => {
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, original.id)).for('update');
        const saved = metadata(source), operation = saved.cancellationRefundOperation;
        if (operation?.status === 'succeeded') return;
        if (operation?.status === 'recovery_required' && operation.error === (error as Error).message) return;
        await tx.update(paymentTransactions).set({ metadata: { ...saved, cancellationRefundOperation: { ...operation, status: 'recovery_required', error: (error as Error).message } }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
        await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'cancellation_refund_recovery', description: 'Cancellation refund requires original-operation verification', metadata: { operationId: operation.id, error: (error as Error).message }, createdBy: managerId }, tx);
        await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Local Cooks is checking your refund',
          'The cancellation is accepted. Local Cooks is checking the refund and will confirm the next step. Please don’t send another payment or refund.',
          managerId, { transactionId: source.id, operationId: operation.id, error: (error as Error).message });
      });
    }
  }
  return readCancellationRefund(bookingId, managerId, 'manager');
}
