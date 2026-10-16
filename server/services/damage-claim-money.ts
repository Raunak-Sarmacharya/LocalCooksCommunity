import Stripe from 'stripe';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, kitchenBookings, paymentTransactions, users } from '@shared/schema';
import { payableClaimStatuses, type ClaimMoneyOperation } from '@shared/damage-claims';
import { chefCanSeeClaim, claimHistory, DamageClaimError, lockClaim, type Claim, type ClaimTx } from './damage-claims-v2';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { assertWorkerTime, workerAfter, workerPageEnd, workerRecord, isWorkerBudgetError } from './worker-context';

// No provider client is constructed until a requested money action runs. This module has no import-time I/O.
function provider() {
  if (!process.env.STRIPE_SECRET_KEY) throw new DamageClaimError('Payments are unavailable. Please try again later.', 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover', maxNetworkRetries: 0, timeout: 1500 });
}
async function locked(id: number, tx: ClaimTx) {
  const [row] = await tx.select({ bookingId: damageClaims.kitchenBookingId }).from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
  if (row?.bookingId) {
    // Same source → parent order as flag/refund writers, including the later transfer/refund receipt transaction.
    await (await import('./booking-support-flags')).lockBookingMoneySources(tx, row.bookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${row.bookingId} FOR UPDATE`);
  }
  return lockClaim(id, tx);
}
function retrySafe(op: ClaimMoneyOperation) {
  // Stripe retains idempotency keys for at least 24 hours. An ambiguous older attempt needs provider reconciliation, never a new key.
  if (op.attemptedAt && Date.now() - Date.parse(op.attemptedAt) >= 23 * 3600000)
    throw new DamageClaimError('This payment needs Local Cooks to verify its earlier attempt. No new money was sent.');
}
const creationIsAged = (op: ClaimMoneyOperation) => !!op.attemptedAt && Date.now() - Date.parse(op.attemptedAt) >= 23 * 3600000;
type StalledOutcome = { kind: 'found'; intent: Stripe.PaymentIntent } | { kind: 'reset' } | { kind: 'review'; reason: string };
const MAX_SCANNED_INTENTS = 500;

/**
 * An intent-creation attempt with no saved intent that is too old to retry under its idempotency key. Looks the original up by its
 * operation key in the customer's own intents (a consistent list, never an eventually-consistent search):
 * exactly one verified match is attached; none in a complete listing means it was never created, so a new attempt starts under a new
 * key; anything else (provider unreachable, too many intents, conflicting matches, a mismatch) is kept for Local Cooks with the reason.
 */
export async function resolveStalledClaimCreation(id: number, op: ClaimMoneyOperation, claim: Claim): Promise<StalledOutcome> {
  const review = async (reason: string): Promise<StalledOutcome> => { await markClaimPaymentForReview(id, op, reason); return { kind: 'review', reason }; };
  if (!op.customerId) return review('The saved payment has no customer to search.');
  const matches: Stripe.PaymentIntent[] = [];
  try {
    const since = Math.floor((Date.parse(op.startedAt) - 5 * 60000) / 1000);
    let scanned = 0;
    for await (const candidate of provider().paymentIntents.list({ customer: op.customerId, created: { gte: since }, limit: 100 })) {
      if (++scanned > MAX_SCANNED_INTENTS) return review('The customer has too many payments in this period to check automatically.');
      if (candidate.metadata?.claim_operation_key === op.key) matches.push(candidate);
    }
  } catch {
    return review('The payment provider could not be reached to check the earlier attempt.');
  }
  if (matches.length > 1) return review('More than one payment matches this attempt.');
  if (matches.length === 0 || matches[0].status === 'canceled') {
    await db.transaction(async tx => {
      const current = await locked(id, tx);
      if (current.paymentOperation?.key !== op.key || current.paymentOperation.intentId) return;
      await tx.update(damageClaims).set({ paymentOperation: { ...current.paymentOperation, state: 'cancelled', error: 'No payment was created by that attempt; a new one was started.' },
        stripePaymentIntentId: null, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    });
    return { kind: 'reset' };
  }
  const found = matches[0];
  if (found.amount !== op.amountCents || found.currency !== 'cad' || intentReference(found.customer) !== op.customerId
    || found.metadata.damage_claim_id !== String(id) || found.metadata.chef_id !== String(claim.chefId)
    || found.metadata.booking_id !== String(claim.kitchenBookingId)) return review('The payment found does not match the saved claim decision.');
  await db.transaction(async tx => {
    const current = await locked(id, tx);
    if (current.paymentOperation?.key !== op.key || current.paymentOperation.intentId) return;
    await tx.update(damageClaims).set({ stripePaymentIntentId: found.id, paymentOperation: { ...current.paymentOperation, intentId: found.id, error: undefined,
      state: current.paymentOperation.state === 'pending' ? 'ready' : current.paymentOperation.state }, updatedAt: new Date() }).where(eq(damageClaims.id, id));
  });
  // The chef may have paid without us ever learning of it: settle it from the verified original.
  if (found.status === 'succeeded') await settleClaimPayment(found);
  return { kind: 'found', intent: found };
}

/** Durable, once: keep the reason on the operation and tell Local Cooks, so a stalled payment is never silent. */
async function markClaimPaymentForReview(id: number, op: ClaimMoneyOperation, reason: string) {
  await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.paymentOperation?.key !== op.key || claim.paymentOperation.error === reason) return;
    await tx.update(damageClaims).set({ paymentOperation: { ...claim.paymentOperation, error: reason } }).where(eq(damageClaims.id, id));
    if (!claim.kitchenBookingId) return;
    const { queueBookingLifecycleEvent } = await import('./booking-lifecycle-delivery');
    await queueBookingLifecycleEvent(tx, claim.kitchenBookingId, 'support_updated', 'A damage claim payment needs attention',
      `${claim.referenceCode || `Claim ${id}`}: the chef's payment for $${(op.amountCents / 100).toFixed(2)} could not be matched to the payment provider. ${reason} Open the booking in support to review the payment before any new charge.`,
      undefined, { recipientPolicy: 'admins', supportCase: true, claimId: id });
  });
}

/** Bounded sweep: stalled claim payments are resolved without waiting for the chef to return. */
export async function recoverStalledClaimPayments(limit = 3) {
  assertWorkerTime();
  const due = await db.select().from(damageClaims).where(and(workerAfter('claimPayments', damageClaims.id),
    sql`${damageClaims.paymentOperation}->>'state' = 'pending'`, sql`${damageClaims.paymentOperation}->>'intentId' IS NULL`,
    sql`(${damageClaims.paymentOperation}->>'attemptedAt')::timestamptz < now() - interval '23 hours'`)).orderBy(asc(damageClaims.id)).limit(limit);
  await workerPageEnd('claimPayments', due.length, limit);
  for (const row of due) {
    await workerRecord('claimPayments', row.id);
    try { await resolveStalledClaimCreation(row.id, row.paymentOperation!, row as unknown as Claim); }
    catch (error) { if (isWorkerBudgetError(error)) throw error; }
  }
}
const intentReference = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;

export async function prepareClaimPayment(id: number, chefId: number, newCard = false, retriedAfterReset = false) {
  const saved = await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.chefId !== chefId) throw new DamageClaimError('Claim not found.', 404);
    if (!chefCanSeeClaim(claim) || !payableClaimStatuses.includes(claim.status) || claim.resolvedAt || claim.chargeSucceededAt || !claim.chefOwes
      || claim.compensationOperation?.state === 'pending') throw new DamageClaimError('This claim cannot be paid now. Contact Local Cooks.');
    if (claim.claimVersion !== 2) throw new DamageClaimError('Local Cooks will help resolve this earlier claim. No automatic charge will be made.');
    await assertBookingMoneyWritable({ bookingId: claim.kitchenBookingId! }, tx);
    if (claim.paymentOperation && claim.paymentOperation.state !== 'cancelled') {
      if (claim.paymentOperation.state === 'cancel_pending') throw new DamageClaimError('The previous payment is being cancelled. Please retry.');
      return { claim, operation: claim.paymentOperation };
    }
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, claim.kitchenBookingId!)).limit(1);
    const [chef] = await tx.select({ customerId: users.stripeCustomerId }).from(users).where(eq(users.id, chefId)).limit(1);
    const customerId = booking?.stripeCustomerId || chef?.customerId;
    if (!customerId) throw new DamageClaimError('Add a card to your Local Cooks payment settings first.');
    const attempt = claim.checkoutAttempt + 1, now = new Date().toISOString();
    const operation: ClaimMoneyOperation = { key: `claim:${id}:pay:${attempt}`, state: 'pending', amountCents: claim.finalAmountCents ?? claim.claimedAmountCents,
      customerId, ...(newCard || !booking?.stripePaymentMethodId ? {} : { paymentMethodId: booking.stripePaymentMethodId }), startedAt: now, attemptedAt: now };
    await tx.update(damageClaims).set({ paymentOperation: operation, paymentRoute: 'on_session', checkoutAttempt: attempt,
      finalAmountCents: operation.amountCents, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    return { claim, operation };
  });
  const stripe = provider(), op = saved.operation;
  assertWorkerTime(2000);
  // Persisted parameters only. Creating an unconfirmed intent never charges or authorizes the card.
  let discovered: Stripe.PaymentIntent | undefined;
  if (!op.intentId && creationIsAged(op)) {
    // An attempt older than the provider's idempotency retention: find what it did instead of guessing.
    const outcome = await resolveStalledClaimCreation(id, op, saved.claim);
    if (outcome.kind === 'reset' && !retriedAfterReset) return prepareClaimPayment(id, chefId, newCard, true);
    if (outcome.kind !== 'found') throw new DamageClaimError('Local Cooks is checking this payment. You do not need to do anything, and you have not been charged twice.');
    discovered = outcome.intent;
    if (outcome.intent.status === 'succeeded') throw new DamageClaimError('Your payment was received. Thank you.');
  }
  const intent = discovered ?? (op.intentId ? await stripe.paymentIntents.retrieve(op.intentId) : await stripe.paymentIntents.create({
    amount: op.amountCents, currency: 'cad', customer: op.customerId, ...(op.paymentMethodId ? { payment_method: op.paymentMethodId } : {}),
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, capture_method: 'automatic',
    metadata: { type: 'damage_claim', damage_claim_v2: 'true', damage_claim_id: String(id), chef_id: String(chefId),
      booking_id: String(saved.claim.kitchenBookingId), manager_id: String(saved.claim.managerId), claim_operation_key: op.key } }, { idempotencyKey: op.key }));
  if (intent.amount !== op.amountCents || intent.currency !== 'cad' || intentReference(intent.customer) !== op.customerId
    || intent.metadata.claim_operation_key !== op.key) throw new DamageClaimError('The saved card payment needs verification before it can be shown.');
  const canReturnSecret = await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.paymentOperation?.key !== op.key) throw new DamageClaimError('Payment changed; contact Local Cooks before retrying.');
    await tx.update(damageClaims).set({ stripePaymentIntentId: intent.id,
      paymentOperation: { ...claim.paymentOperation, intentId: intent.id, state: claim.paymentOperation.state === 'pending' ? 'ready' : claim.paymentOperation.state },
      updatedAt: new Date() }).where(eq(damageClaims.id, id));
    return !claim.withdrawalOperation && (!claim.compensationOperation || claim.compensationOperation.state === 'succeeded' && claim.chefOwes)
      && !['cancelled', 'cancel_pending'].includes(claim.paymentOperation.state);
  });
  if (!canReturnSecret) throw new DamageClaimError('This claim changed. Refresh before choosing Pay again.');
  return { clientSecret: intent.client_secret, intentId: intent.id, hasSavedCard: !!op.paymentMethodId, amountCents: op.amountCents };
}
export async function cancelClaimPayment(id: number, chefId: number) {
  const op = await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.chefId !== chefId) throw new DamageClaimError('Claim not found.', 404);
    const operation = claim.paymentOperation;
    if (!operation || operation.state === 'cancelled') return null;
    if (operation.state === 'succeeded') throw new DamageClaimError('This payment is complete. Contact Local Cooks for help.');
    if (!operation.intentId) throw new DamageClaimError('Payment creation needs recovery. Open Pay to recover it before disputing.');
    await tx.update(damageClaims).set({ paymentOperation: { ...operation, state: 'cancel_pending' } }).where(eq(damageClaims.id, id));
    return operation;
  });
  if (!op) return;
  const stripe = provider(), current = await stripe.paymentIntents.retrieve(op.intentId!);
  if (current.status === 'succeeded' || current.status === 'processing') throw new DamageClaimError('Payment is complete or processing. Contact Local Cooks for help.');
  if (current.status !== 'canceled') await stripe.paymentIntents.cancel(current.id, {}, { idempotencyKey: `${op.key}:cancel` });
  await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.paymentOperation?.key === op.key && !claim.chargeSucceededAt) await tx.update(damageClaims).set({
      paymentOperation: { ...claim.paymentOperation, state: 'cancelled' }, stripePaymentIntentId: null, updatedAt: new Date() }).where(eq(damageClaims.id, id));
  });
}
export async function syncClaimPayment(id: number, chefId: number) {
  const [claim] = await db.select().from(damageClaims).where(and(eq(damageClaims.id, id), eq(damageClaims.chefId, chefId))).limit(1);
  if (!claim?.paymentOperation?.intentId) throw new DamageClaimError('Payment not found.', 404);
  const intent = await provider().paymentIntents.retrieve(claim.paymentOperation.intentId);
  if (intent.status !== 'succeeded') return { success: false, status: intent.status };
  await settleClaimPayment(intent);
  return { success: true, status: 'succeeded' };
}
/** Called by signed webhooks and authenticated sync; exact persisted identity/amount/customer are mandatory. */
export async function settleClaimPayment(intent: Stripe.PaymentIntent) {
  const id = Number(intent.metadata.damage_claim_id);
  if (intent.metadata.damage_claim_v2 !== 'true' || !Number.isSafeInteger(id) || id <= 0 || intent.status !== 'succeeded') throw new DamageClaimError('Invalid claim payment.');
  const [withdrawing] = await db.select().from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
  if (withdrawing?.withdrawalOperation) {
    await withdrawClaimMoney(id);
    return;
  }
  const claim = await db.transaction(async tx => {
    const claim = await locked(id, tx), op = claim.paymentOperation;
    if (!op || op.key !== intent.metadata.claim_operation_key || (op.intentId && op.intentId !== intent.id)
      || intent.amount_received !== op.amountCents || intent.currency !== 'cad' || intentReference(intent.customer) !== op.customerId
      || intent.metadata.chef_id !== String(claim.chefId) || intent.metadata.booking_id !== String(claim.kitchenBookingId)
      || claim.finalAmountCents !== op.amountCents || ['cancelled'].includes(op.state)) throw new DamageClaimError('Claim payment does not match its saved decision.');
    const chargeId = intentReference(intent.latest_charge);
    if (!chargeId) throw new DamageClaimError('The payment charge is not available yet.');
    const now = new Date();
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
    if (!source) {
      const [created] = await tx.insert(paymentTransactions).values({ bookingId: claim.kitchenBookingId!, bookingType: 'kitchen', chefId: claim.chefId,
        managerId: claim.managerId, amount: String(op.amountCents), baseAmount: String(op.amountCents), serviceFee: '0', taxAmount: '0',
        managerRevenue: claim.fundedBy === 'local_cooks' ? '0' : String(op.amountCents), netAmount: String(op.amountCents), currency: 'CAD',
        paymentIntentId: intent.id, chargeId, status: 'succeeded', stripeStatus: 'succeeded', paidAt: now, payoutTiming: 'at_capture',
        metadata: { ...intent.metadata, platformAbsorbsProcessingFee: true, fundedBy: claim.fundedBy, platformRecovery: claim.fundedBy === 'local_cooks' } }).returning();
      claim.paymentTransactionId = created.id;
    } else claim.paymentTransactionId = source.id;
    const updated: Claim = { ...claim, status: 'charge_succeeded', chargeSucceededAt: claim.chargeSucceededAt || now, resolvedAt: now, chefOwes: false,
      stripePaymentIntentId: intent.id, stripeChargeId: chargeId, paymentOperation: { ...op, state: 'succeeded', intentId: intent.id } };
    await tx.update(damageClaims).set({ status: updated.status, chargeSucceededAt: updated.chargeSucceededAt, resolvedAt: now, chefOwes: false,
      resolutionType: 'paid', stripePaymentIntentId: intent.id, stripeChargeId: chargeId, paymentOperation: updated.paymentOperation,
      paymentTransactionId: claim.paymentTransactionId, updatedAt: now }).where(eq(damageClaims.id, id));
    if (!claim.chargeSucceededAt) await claimHistory(tx, updated, updated.status, 'chef_paid', 'stripe_webhook');
    return updated;
  });
  // The chef can settle even while a flag freezes outgoing kitchen money. Keep the transfer retryable and separate.
  if (claim.fundedBy !== 'local_cooks') {
    try { await sendClaimKitchenMoney(id, 'payment'); }
    catch (error) { if (isWorkerBudgetError(error)) throw error; (await import('../logger')).logger.error('Paid claim kitchen transfer will recover', { claimId: id }); }
  }
  // Fee discovery can arrive later via charge.updated; it must never make the chef pay twice or delay full kitchen entitlement.
  try { await recordClaimProcessingCost(intent.id); }
  catch (error) { if (isWorkerBudgetError(error)) throw error; (await import('../logger')).logger.error('Claim processing cost needs fee reconciliation', { claimId: id }); }
  // Chef receipt for the claim payment and the kitchen's remittance (idempotent; never fails settlement).
  await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(claim.kitchenBookingId, 'claim_paid')).catch(() => undefined);
}
export async function recordClaimProcessingCost(intentId: string) {
  const stripe = provider(), intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] });
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const balance = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
  if (!balance) return;
  const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intentId)).limit(1);
  if (!source) return;
  await db.update(paymentTransactions).set({ stripeProcessingFee: String(balance.fee),
    metadata: { ...(source.metadata as object), platformProcessingCostCents: balance.fee }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
}
export async function sendClaimKitchenMoney(id: number, kind: 'payment' | 'compensation', supportKey?: string) {
  const column = kind === 'compensation' ? 'compensationOperation' : 'transferOperation';
  const saved = await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (kind === 'payment' && claim.fundedBy === 'local_cooks') return { claim, operation: null };
    let op = claim[column];
    if (op?.state === 'succeeded') return { claim, operation: op };
    if (!op) {
      if (kind === 'compensation' || !claim.chargeSucceededAt || !claim.stripeChargeId) throw new DamageClaimError('A saved payment decision is required.');
      const [manager] = await tx.select({ accountId: users.stripeConnectAccountId }).from(users).where(eq(users.id, claim.managerId)).limit(1);
      if (!manager?.accountId) throw new DamageClaimError('The kitchen must finish payment setup first.');
      op = { key: `claim:${id}:kitchen`, state: 'pending', amountCents: claim.finalAmountCents!, destination: manager.accountId,
        sourceCharge: claim.stripeChargeId, startedAt: new Date().toISOString() };
      await tx.update(damageClaims).set({ [column]: op, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    }
    if (claim.withdrawalOperation && op.state !== 'succeeded') {
      if (op.attemptedAt) throw new DamageClaimError('The earlier kitchen transfer must be reconciled before this withdrawal can finish.');
      await tx.update(damageClaims).set({ [column]: { ...op, state: 'cancelled' } }).where(eq(damageClaims.id, id));
      return { claim, operation: null };
    }
    return { claim, operation: op };
  });
  let op = saved.operation;
  if (!op || op.state === 'succeeded') return { transferId: op?.transferId || null };
  await assertBookingMoneyWritable({ bookingId: saved.claim.kitchenBookingId!, operationKey: supportKey });
  retrySafe(op);
  assertWorkerTime(2000);
  const stripe = provider();
  // Compensation uses available CAD balance, with no source_transaction. Chef-paid claims use their own captured charge.
  if (kind === 'compensation') {
    const balance = await stripe.balance.retrieve();
    const available = balance.available.filter(row => row.currency === 'cad').reduce((total, row) => total + row.amount, 0);
    if (available < op.amountCents) throw new DamageClaimError('Local Cooks has insufficient available CAD balance. No kitchen payment was sent.');
  }
  op = await db.transaction(async tx => {
    const claim = await locked(id, tx), current = claim[column];
    if (!current || current.key !== op!.key) throw new DamageClaimError('Kitchen payment changed.');
    if (current.state === 'succeeded') return current;
    await assertBookingMoneyWritable({ bookingId: claim.kitchenBookingId!, operationKey: supportKey }, tx);
    retrySafe(current);
    const attempted = { ...current, attemptedAt: current.attemptedAt || new Date().toISOString() };
    await tx.update(damageClaims).set({ [column]: attempted }).where(eq(damageClaims.id, id));
    return attempted;
  });
  if (op.state === 'succeeded') return { transferId: op.transferId! };
  return db.transaction(async tx => {
    const claim = await locked(id, tx), current = claim[column];
    if (!current || current.key !== op!.key) throw new DamageClaimError('Kitchen transfer needs reconciliation.');
    if (current.state === 'succeeded') return { transferId: current.transferId! };
    await assertBookingMoneyWritable({ bookingId: claim.kitchenBookingId!, operationKey: supportKey }, tx);
    assertWorkerTime(2000);
    // Decision AND first-attempt timestamp are already committed. Keep the source/parent locks only for the bounded
    // provider attempt and receipt, so a flag cannot open between the final freeze check and the outgoing transfer.
    const transfer = await stripe.transfers.create({ amount: current.amountCents, currency: 'cad', destination: current.destination!,
      ...(kind === 'payment' ? { source_transaction: current.sourceCharge } : {}), transfer_group: `claim_${id}`,
      metadata: { damage_claim_id: String(id), type: 'damage_claim', funded_by: kind === 'compensation' ? 'local_cooks' : 'chef' } }, { idempotencyKey: current.key });
    await tx.update(damageClaims).set({ [column]: { ...current, state: 'succeeded', transferId: transfer.id }, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    if (kind === 'payment' && claim.paymentTransactionId) await tx.update(paymentTransactions).set({ transferId: transfer.id,
      managerRevenue: String(op!.amountCents), updatedAt: new Date() }).where(eq(paymentTransactions.id, claim.paymentTransactionId));
    await claimHistory(tx, claim, claim.status, 'kitchen_paid', 'system');
    return { transferId: transfer.id };
  });
}
/** A withdrawal costs the chef and kitchen nothing. Any collected claim charge is refunded by Local Cooks;
 * an already sent kitchen payment is retained and recorded as a platform cost, never clawed back from the kitchen. */
export async function withdrawClaimMoney(id: number, supportKey?: string) {
  const saved = await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (!claim.withdrawalOperation) throw new DamageClaimError('A saved withdrawal decision is required.');
    await assertBookingMoneyWritable({ bookingId: claim.kitchenBookingId!, operationKey: supportKey }, tx);
    if (!claim.withdrawalOperation.intentId && claim.paymentOperation?.intentId) {
      claim.withdrawalOperation = { ...claim.withdrawalOperation, intentId: claim.paymentOperation.intentId };
      await tx.update(damageClaims).set({ withdrawalOperation: claim.withdrawalOperation }).where(eq(damageClaims.id, id));
    }
    return claim;
  });
  let op = saved.withdrawalOperation!;
  if (op.state === 'succeeded') return { refundId: op.refundId || null };
  const stripe = op.intentId || saved.paymentOperation ? provider() : null;
  let intentId = op.intentId;
  if (!intentId && saved.paymentOperation && saved.paymentOperation.state !== 'cancelled') {
    // Recover an interrupted unconfirmed create using precisely the original parameters and key, then cancel it.
    const payment = saved.paymentOperation;
    retrySafe(payment);
    const intent = await stripe!.paymentIntents.create({ amount: payment.amountCents, currency: 'cad', customer: payment.customerId,
      ...(payment.paymentMethodId ? { payment_method: payment.paymentMethodId } : {}),
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, capture_method: 'automatic',
      metadata: { type: 'damage_claim', damage_claim_v2: 'true', damage_claim_id: String(id), chef_id: String(saved.chefId),
        booking_id: String(saved.kitchenBookingId), manager_id: String(saved.managerId), claim_operation_key: payment.key } }, { idempotencyKey: payment.key });
    intentId = intent.id;
    op = { ...op, intentId };
    await db.update(damageClaims).set({ withdrawalOperation: op, stripePaymentIntentId: intentId,
      paymentOperation: { ...payment, intentId, state: 'cancel_pending' } }).where(eq(damageClaims.id, id));
  }
  let refundId: string | undefined;
  if (intentId) {
    const intent = await stripe!.paymentIntents.retrieve(intentId);
    if (intent.metadata.claim_operation_key !== saved.paymentOperation?.key || intent.metadata.damage_claim_id !== String(id)
      || intentReference(intent.customer) !== saved.paymentOperation?.customerId || intent.currency !== 'cad' || intent.amount !== op.amountCents)
      throw new DamageClaimError('Withdrawal payment identity needs review.');
    if (intent.status === 'processing') throw new DamageClaimError('The chef payment is processing. The saved withdrawal will refund it when settled.');
    if (intent.status !== 'succeeded' && intent.status !== 'canceled') await stripe!.paymentIntents.cancel(intentId, {}, { idempotencyKey: `${op.key}:cancel` });
    if (intent.status === 'succeeded') {
      if (!op.refundId) retrySafe({ ...op, state: 'pending' });
      op = await db.transaction(async tx => {
        const claim = await locked(id, tx), current = claim.withdrawalOperation!;
        await assertBookingMoneyWritable({ bookingId: claim.kitchenBookingId!, operationKey: supportKey }, tx);
        const next = { ...current, attemptedAt: current.attemptedAt || new Date().toISOString() };
        await tx.update(damageClaims).set({ withdrawalOperation: next }).where(eq(damageClaims.id, id));
        return next;
      });
      const refund = op.refundId ? await stripe!.refunds.retrieve(op.refundId) : await stripe!.refunds.create({ payment_intent: intentId,
        amount: op.amountCents, metadata: { damage_claim_id: String(id), reason: 'admin_withdrawal', funded_by: 'local_cooks' } }, { idempotencyKey: `${op.key}:refund` });
      refundId = refund.id;
      await db.update(damageClaims).set({ withdrawalOperation: { ...op, refundId } }).where(eq(damageClaims.id, id));
      if (refund.status !== 'succeeded') throw new DamageClaimError('The withdrawal refund is pending. Local Cooks will verify it before closing the money action.');
    }
  }
  await db.transaction(async tx => {
    const claim = await locked(id, tx);
    if (claim.paymentTransactionId && refundId) {
      const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, claim.paymentTransactionId)).limit(1);
      if (source) await tx.update(paymentTransactions).set({ status: 'refunded', refundId, refundAmount: String(op.amountCents), netAmount: '0',
        managerRevenue: source.transferId ? source.managerRevenue : '0',
        metadata: { ...(source.metadata as object), withdrawalPlatformCostCents: op.amountCents, kitchenRetainsTransfer: !!source.transferId }, updatedAt: new Date() }).where(eq(paymentTransactions.id, source.id));
    }
    await tx.update(damageClaims).set({ withdrawalOperation: { ...op, state: 'succeeded', refundId }, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    await claimHistory(tx, claim, 'resolved', 'claim_withdrawn', 'system');
  });
  return { refundId: refundId || null };
}

/** No charging/confirmation. Recover only saved transfers, using the indexed pending-decision page. */
export async function recoverDamageClaimMoney(limit = 3) {
  assertWorkerTime();
  const rows = await db.select().from(damageClaims).where(and(workerAfter('claimMoney', damageClaims.id),
    sql`(${damageClaims.transferOperation}->>'state' = 'pending' OR ${damageClaims.compensationOperation}->>'state' = 'pending'
      OR ${damageClaims.withdrawalOperation}->>'state' = 'pending')`))
    .orderBy(asc(damageClaims.id)).limit(Math.min(10, Math.max(1, limit)));
  await workerPageEnd('claimMoney', rows.length);
  if (!rows.length) return;
  for (const claim of rows) {
    await workerRecord('claimMoney', claim.id);
    try {
      if (claim.withdrawalOperation?.state === 'pending') {
        const { supportActions } = await import('@shared/schema');
        const [action] = await db.select().from(supportActions).where(and(eq(supportActions.bookingId, claim.kitchenBookingId!),
          eq(supportActions.actionType, 'claim_withdraw'), sql`${supportActions.beforeState}->>'claimId' = ${String(claim.id)}`)).limit(1);
        if (!action) throw new DamageClaimError('Withdrawal support decision is missing.');
        const receipt = await withdrawClaimMoney(claim.id, action.operationKey);
        await db.update(supportActions).set({ status: 'verified', providerRefs: receipt, error: null, completedAt: new Date() }).where(eq(supportActions.id, action.id));
        continue;
      }
      if (claim.compensationOperation?.state === 'pending') {
        const { supportActions } = await import('@shared/schema');
        const [action] = await db.select().from(supportActions).where(and(eq(supportActions.bookingId, claim.kitchenBookingId!),
          eq(supportActions.actionType, 'claim_compensate'), sql`${supportActions.beforeState}->>'claimId' = ${String(claim.id)}`)).limit(1);
        if (!action) throw new DamageClaimError('Compensation support decision is missing.');
        const transfer = await sendClaimKitchenMoney(claim.id, 'compensation', action.operationKey);
        await db.update(supportActions).set({ status: 'verified', providerRefs: { transferId: transfer.transferId }, error: null,
          completedAt: new Date() }).where(eq(supportActions.id, action.id));
      } else await sendClaimKitchenMoney(claim.id, 'payment');
    } catch (error) { if (isWorkerBudgetError(error)) throw error; (await import('../logger')).logger.error('Saved claim transfer needs retry', { claimId: claim.id }); }
  }
}
/** Staff retries a saved operation, never accepts a new amount/key or creates a second decision. */
export async function retrySavedClaimMoney(bookingId: number, id: number, actorId: number) {
  const { supportActions, damageClaimHistory } = await import('@shared/schema');
  const [claim] = await db.select().from(damageClaims).where(and(eq(damageClaims.id, id), eq(damageClaims.kitchenBookingId, bookingId))).limit(1);
  if (!claim) throw new DamageClaimError('Claim not found.', 404);
  let receipt: { transferId?: string | null; refundId?: string | null };
  if (claim.compensationOperation || claim.withdrawalOperation) {
    const type = claim.withdrawalOperation ? 'claim_withdraw' : 'claim_compensate';
    const [action] = await db.select().from(supportActions).where(and(eq(supportActions.bookingId, bookingId), eq(supportActions.actionType, type),
      sql`${supportActions.beforeState}->>'claimId' = ${String(id)}`)).limit(1);
    if (!action) throw new DamageClaimError('The original support decision is missing.');
    receipt = type === 'claim_withdraw' ? await withdrawClaimMoney(id, action.operationKey) : await sendClaimKitchenMoney(id, 'compensation', action.operationKey);
    await db.update(supportActions).set({ status: 'verified', providerRefs: receipt, error: null, completedAt: new Date() }).where(eq(supportActions.id, action.id));
  } else receipt = await sendClaimKitchenMoney(id, 'payment');
  await db.insert(damageClaimHistory).values({ damageClaimId: id, previousStatus: claim.status, newStatus: claim.status, action: 'money_recovery_checked',
    actionBy: 'admin', actionByUserId: actorId, metadata: receipt });
  return { success: true };
}
