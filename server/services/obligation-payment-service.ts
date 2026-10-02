import type Stripe from 'stripe';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, storageOverstayRecords } from '@shared/schema';

type ObligationKind = 'damage_claim' | 'overstay_penalty';
const tableFor = (kind: ObligationKind) => kind === 'damage_claim' ? damageClaims : storageOverstayRecords;
async function getObligation(kind: ObligationKind, id: number) {
  const table = tableFor(kind);
  const [record] = await db.select({ route: table.paymentRoute, intentId: table.stripePaymentIntentId,
    sessionId: table.stripeCheckoutSessionId, attempt: table.checkoutAttempt }).from(table).where(eq(table.id, id)).limit(1);
  if (!record) throw new Error('Payment obligation not found');
  return record;
}

/** Persist the intent before confirming it; retries always retrieve that same intent. */
export async function chargeObligation(stripe: Stripe, kind: ObligationKind, id: number,
  params: Stripe.PaymentIntentCreateParams): Promise<Stripe.PaymentIntent> {
  const table = tableFor(kind);
  const record = await getObligation(kind, id);
  if (record.route === 'checkout') throw new Error('A self-service payment is already in progress');
  let intent: Stripe.PaymentIntent;
  if (record.intentId) {
    intent = await stripe.paymentIntents.retrieve(record.intentId);
    if (intent.amount !== params.amount || intent.currency !== params.currency) throw new Error('Existing payment amount differs; admin reconciliation required');
  } else {
    if (record.route === 'off_session') throw new Error('Original payment creation needs admin reconciliation');
    const [acquired] = await db.update(table).set({ paymentRoute: 'off_session' })
      .where(and(eq(table.id, id), isNull(table.paymentRoute), isNull(table.stripePaymentIntentId),
        sql`${table.status}::text IN ('charge_pending','charge_failed','approved','partially_approved','chef_accepted','penalty_approved','escalated')`,
        ...(kind === 'overstay_penalty' ? [sql`${storageOverstayRecords.itemsRemovedAt} IS NOT NULL
          AND ${storageOverstayRecords.chefDisputeDeadline} <= CURRENT_TIMESTAMP
          AND (${storageOverstayRecords.chefDisputedAt} IS NULL OR ${storageOverstayRecords.disputeReviewedAt} IS NOT NULL)`] : [])))
      .returning({ id: table.id });
    if (!acquired) throw new Error('Payment creation is in progress or needs admin reconciliation');
    const { off_session: _offSession, confirm: _confirm, ...createParams } = params;
    intent = await stripe.paymentIntents.create(createParams, { idempotencyKey: `${kind}_${id}_intent` });
    await db.update(table).set({ stripePaymentIntentId: intent.id }).where(eq(table.id, id));
  }
  if (['succeeded', 'processing', 'requires_action'].includes(intent.status)) return intent;
  if (intent.status === 'canceled') throw new Error('Original payment was cancelled; use self-service checkout');
  return stripe.paymentIntents.confirm(intent.id, { payment_method: params.payment_method as string,
    off_session: true }, { idempotencyKey: `${kind}_${id}_confirm_${params.payment_method}` });
}

/** Coordinate checkout with saved-card charging and reuse an existing open session. */
export async function checkoutObligation(stripe: Stripe, kind: ObligationKind, id: number,
  params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  const table = tableFor(kind);
  const record = await getObligation(kind, id);
  let attempt = record.attempt;
  if (record.sessionId) {
    const session = await stripe.checkout.sessions.retrieve(record.sessionId);
    if (session.status === 'open') return session;
    if (session.status === 'complete') throw new Error('Payment completed; reconciliation is in progress');
    const [released] = await db.update(table).set({ stripeCheckoutSessionId: null, paymentRoute: null,
      checkoutAttempt: sql`${table.checkoutAttempt} + 1` })
      .where(and(eq(table.id, id), eq(table.stripeCheckoutSessionId, record.sessionId))).returning({ id: table.id });
    if (!released) throw new Error('Payment changed; reload before paying');
    attempt++;
  } else if (record.route === 'checkout') throw new Error('Checkout creation is in progress or needs admin reconciliation');
  if (record.intentId) {
    const intent = await stripe.paymentIntents.retrieve(record.intentId);
    if (['succeeded', 'processing'].includes(intent.status)) throw new Error('Existing payment is successful or processing; no additional payment is allowed');
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
  } else if (record.route === 'off_session') throw new Error('Original payment creation needs admin reconciliation');
  const [acquired] = await db.update(table).set({ paymentRoute: 'checkout' })
    .where(and(eq(table.id, id), or(isNull(table.paymentRoute), eq(table.paymentRoute, 'off_session')),
      isNull(table.stripeCheckoutSessionId),
      sql`${table.status}::text IN ('charge_failed','approved','partially_approved','chef_accepted','penalty_approved','escalated')`,
      ...(kind === 'overstay_penalty' ? [sql`${storageOverstayRecords.itemsRemovedAt} IS NOT NULL
        AND ${storageOverstayRecords.chefDisputeDeadline} <= CURRENT_TIMESTAMP
        AND (${storageOverstayRecords.chefDisputedAt} IS NULL OR ${storageOverstayRecords.disputeReviewedAt} IS NOT NULL)`] : [])))
    .returning({ id: table.id });
  if (!acquired) throw new Error('Another payment is already in progress');
  const session = await stripe.checkout.sessions.create({ ...params, payment_intent_data: {
    ...params.payment_intent_data, metadata: { ...params.metadata, ...params.payment_intent_data?.metadata,
      obligation_checkout_attempt: String(attempt) },
  } }, { idempotencyKey: `${kind}_${id}_checkout_${attempt}` });
  await db.update(table).set({ stripeCheckoutSessionId: session.id }).where(eq(table.id, id));
  return session;
}

/** Reconcile verified Stripe success events even if the charging request crashed. */
export async function reconcileObligationPayment(intent: Stripe.PaymentIntent) {
  const kind = intent.metadata.type;
  if (!['damage_claim', 'overstay_penalty'].includes(kind)) return null;
  if (intent.status !== 'succeeded') throw new Error('Payment has not succeeded');
  const id = Number(kind === 'damage_claim' ? intent.metadata.damage_claim_id
    : intent.metadata.overstay_record_id || intent.metadata.overstayRecordId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid payment obligation ID');
  const table = tableFor(kind as ObligationKind);
  const [record] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!record) throw new Error('Payment obligation not found');
  const isClaim = 'claimedAmountCents' in record;
  if (record.paymentRoute === 'checkout' && intent.metadata.obligation_checkout_attempt !== String(record.checkoutAttempt))
    throw new Error('Payment does not match the active checkout attempt');
  const baseCents = isClaim ? record.finalAmountCents : record.finalPenaltyCents;
  const taxCents = isClaim ? 0 : Number(intent.metadata.penalty_tax_cents || 0);
  if (!Number.isSafeInteger(baseCents) || !baseCents || baseCents <= 0 || !Number.isSafeInteger(taxCents)
    || taxCents < 0 || intent.amount_received !== baseCents + taxCents || intent.currency !== 'cad') {
    throw new Error('Payment amount does not match the approved obligation');
  }
  if (record.stripePaymentIntentId && record.stripePaymentIntentId !== intent.id &&
    !(record.paymentRoute === 'checkout' && intent.metadata.obligation_checkout_attempt === String(record.checkoutAttempt))) {
    throw new Error('Payment does not match the active obligation attempt');
  }
  const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
  const [settled] = await db.update(table).set({ status: 'charge_succeeded', stripePaymentIntentId: intent.id,
    stripeChargeId: chargeId || null, chargeSucceededAt: new Date(), resolvedAt: new Date(),
    resolutionType: 'paid', updatedAt: new Date() })
    .where(and(eq(table.id, id), or(eq(table.status, 'charge_succeeded'),
      sql`${table.status}::text IN ('charge_pending','charge_failed','escalated','approved','partially_approved','chef_accepted','penalty_approved')`)))
      .returning({ id: table.id });
  if (!settled) throw new Error('Payment obligation changed; admin reconciliation required');
  if (record.status !== 'charge_succeeded') {
    const { damageClaimHistory, storageOverstayHistory } = await import('@shared/schema');
    if (isClaim) await db.insert(damageClaimHistory).values({ damageClaimId: id, previousStatus: record.status as any,
      newStatus: 'charge_succeeded', action: 'charge_attempt', actionBy: 'stripe_webhook',
      notes: `Stripe payment reconciled: ${intent.id}`, metadata: { paymentIntentId: intent.id } });
    else await db.insert(storageOverstayHistory).values({ overstayRecordId: id, previousStatus: record.status as any,
      newStatus: 'charge_succeeded', eventType: 'charge_attempt', eventSource: 'stripe_webhook',
      description: `Stripe payment reconciled: ${intent.id}`, metadata: { paymentIntentId: intent.id } });
  }
  const bookingId = isClaim ? (record.storageBookingId || record.kitchenBookingId)! : record.storageBookingId;
  const chefId = isClaim ? record.chefId : Number(intent.metadata.chef_id || intent.metadata.chefId) || null;
  const managerId = isClaim ? record.managerId : Number(intent.metadata.manager_id || intent.metadata.managerId) || null;
  return { bookingId, bookingType: (isClaim ? record.bookingType : 'storage') as 'kitchen' | 'storage', chefId, managerId,
    amount: intent.amount_received, baseAmount: baseCents, taxAmount: taxCents, serviceFee: 0,
    managerRevenue: intent.amount_received, currency: 'CAD', paymentIntentId: intent.id, chargeId,
    status: 'succeeded' as const, stripeStatus: intent.status, metadata: { ...intent.metadata, createdFrom: 'obligation_webhook_recovery' } };
}
