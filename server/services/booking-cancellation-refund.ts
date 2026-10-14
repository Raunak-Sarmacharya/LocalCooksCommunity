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

/** Staff requests use the same saved cutoff and cancellation-request path as the chef. */
export async function requestChefCancellation(bookingId: number, chefId: number, actorId: number, publicMessage?: string) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, chefId, 'chef', true);
    if (ctx.parent.status !== 'confirmed' || !['paid', 'partially_refunded'].includes(ctx.parent.paymentStatus || '')
      || (ctx.parent.paymentDecision as { state?: string } | null)?.state === 'pending') throw Error('This booking cannot request cancellation in its current state.');
    if (Date.now() >= kitchenRescheduleCutoff(bookingChangeSchedule(ctx.parent), ctx.parent.cancellationPolicyHours ?? 24))
      throw Error('The saved cancellation deadline has passed. Local Cooks needs to review the next step.');
    await tx.update(kitchenBookings).set({ status: 'cancellation_requested', cancellationRequestedAt: new Date(),
      cancellationRequestReason: publicMessage || null, updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
    await queueBookingLifecycleEvent(tx, bookingId, 'cancellation_requested', 'Kitchen cancellation requested',
      `Local Cooks support updated your booking: a cancellation was requested on your behalf. The kitchen will review the cancellation and refund.${publicMessage ? ` ${publicMessage}` : ''}`,
      actorId, { recipientPolicy: 'participants' });
    return { success: true };
  });
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

/** Full customer refund for a kitchen failure; Local Cooks absorbs the processing cost.
 * Used or separately charged add-ons need their own allocation review before this command. */
export async function cancelKitchenCausedBooking(bookingId: number, managerId: number, actorId: number, operationKey: string) {
  return db.transaction(async tx => {
    const ctx = await context(tx, bookingId, managerId, 'manager', true);
    await assertBookingMoneyWritable({ bookingId, operationKey }, tx);
    if (ctx.parent.status !== 'confirmed' || ctx.sources.length !== 1 || ctx.storage.some(usedStorage) || ctx.equipment.some(usedEquipment))
      throw Error('This cancellation needs a review of linked payments or items already used. No refund has been sent.');
    const source = ctx.sources[0], saved = metadata(source);
    if (!source.paymentIntentId || source.paymentIntentId !== ctx.parent.paymentIntentId || source.chefId !== ctx.parent.chefId || source.managerId !== managerId
      || saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
      || saved.fullRefundRequest?.status === 'pending') throw Error('An earlier payment or refund needs review before cancellation.');
    const facts = await getCancellationPaymentFacts(source.paymentIntentId);
    if (facts.captured !== Number(source.amount) || facts.currency !== source.currency.toLowerCase()) throw Error('The captured payment needs review.');
    if (facts.refunds.some(receipt => Number(receipt.metadata?.platform_goodwill_cents || 0) > 0))
      throw Error('An earlier goodwill refund needs a funding review before the kitchen cancellation. No new refund has been sent.');
    const originalReceipt = facts.refunds.find(row => row.metadata?.refund_operation_id === operationKey);
    if (originalReceipt && originalReceipt.status !== 'succeeded') throw Error('The original refund still needs review.');
    const quotedFacts = originalReceipt ? { ...facts, refunded: facts.refunded - originalReceipt.amount, refunds: facts.refunds.filter(row => row.id !== originalReceipt.id) } : facts;
    const money = cancellationSourceQuote({ ...quotedFacts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
    const amount = originalReceipt?.amount ?? facts.captured - facts.refunded;
    if (amount <= 0) throw Error('The payment has already been refunded. Review the cancellation separately.');
    const managerDebit = Math.min(amount, money.managerRefund);
    const serviceFeeReturn = Math.min(amount - managerDebit, money.serviceFeeReview);
    if (!originalReceipt) await verifyCancellationRefundFunding(source.paymentIntentId, source.transferId, managerDebit);
    const refund = await reverseTransferAndRefund(source.paymentIntentId, amount, 'requested_by_customer', {
      sourceConnection: tx, idempotencyKey: operationKey, reverseTransferAmount: managerDebit,
      metadata: { booking_id: String(bookingId), transaction_id: String(source.id), support_actor_id: String(actorId),
        customer_receives: String(amount), manager_debited: String(managerDebit), platform_service_fee_returned: String(serviceFeeReturn),
        platform_processing_cost_cents: String(amount - managerDebit - serviceFeeReturn) },
    });
    await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(source.paymentIntentId, tx);
    await tx.update(kitchenBookings).set({ status: 'cancelled', paymentStatus: 'refunded', updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
    await cancelLinkedBookingDates(tx, bookingId);
    if (source.payoutTiming === 'after_closeout') await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx);
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: 'refunded', eventType: 'kitchen_caused_cancellation',
      description: 'Kitchen cancellation fully refunded; Local Cooks absorbed processing cost', createdBy: actorId,
      metadata: { operationKey, amountCents: amount, processingCostAbsorbedCents: amount - managerDebit - serviceFeeReturn, refundId: refund.refundId } }, tx);
    return { refundId: refund.refundId, transferReversalId: refund.transferReversalId, amountCents: amount, paymentIntentId: source.paymentIntentId,
      managerPaysCents: managerDebit, localCooksPaysCents: amount - managerDebit, processingCostAbsorbedCents: amount - managerDebit - serviceFeeReturn };
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
  const [row] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId }).from(kitchenBookings)
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
  return { parent, managerId: row.managerId!, storage, equipment, sources: reservationSources };
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
  const ctx = await db.transaction(tx => context(tx, bookingId, managerId, 'manager'));
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
        const result = await reverseTransferAndRefund(operation.intentId, operation.managerRefund, 'requested_by_customer', {
          sourceConnection: tx, idempotencyKey: operation.id, supportOperationKey: operation.supportOperationKey, reverseTransferAmount: operation.managerRefund, refundApplicationFee: false,
          metadata: { booking_id: String(bookingId), transaction_id: String(source.id), manager_id: String(managerId),
            customer_receives: String(operation.managerRefund), manager_debited: String(operation.managerRefund), platform_service_fee_returned: '0' } });
        const facts = await getCancellationPaymentFacts(operation.intentId);
        const money = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: saved.refunds });
        if (!money.receipts.some(item => item.id === result.refundId && item.managerDebited === operation.managerRefund && item.platformServiceFeeReturned === 0))
          throw new Error('Provider refund allocation differs from the reserved quote');
        const status = money.alreadyRefunded >= money.captured - money.processingCost ? 'refunded' : 'partially_refunded';
        await tx.update(paymentTransactions).set({ refundAmount: String(money.alreadyRefunded), netAmount: String(money.captured - money.alreadyRefunded),
          status, refundId: result.refundId, refundedAt: new Date(), updatedAt: new Date(), metadata: { ...saved, refunds: money.receipts,
            cancellationRefundOperation: { ...operation, status: 'succeeded', refundId: result.refundId, refunded: operation.managerRefund, verifiedAt: new Date().toISOString(), error: null } } }).where(eq(paymentTransactions.id, source.id));
        if (['kitchen', 'bundle'].includes(source.bookingType)) await tx.update(kitchenBookings).set({ paymentStatus: status, updatedAt: new Date() })
          .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.paymentIntentId, source.paymentIntentId!)));
        await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: status, eventType: 'cancellation_refund_verified', description: 'Stripe verified the reserved cancellation refund; bank receipt is not confirmed', metadata: { ...operation, refundId: result.refundId }, createdBy: managerId }, tx);
        await queueBookingLifecycleEvent(tx, bookingId, 'refund_issued', 'Refund sent',
          `A refund of ${(operation.managerRefund / 100).toFixed(2)} ${source.currency} has been sent. Processing costs are kept. It may take time to appear at the chef’s bank.`, managerId, { transactionId: source.id, refundId: result.refundId });
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
