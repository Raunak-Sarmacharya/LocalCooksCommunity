import Stripe from 'stripe';
import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { kitchenCheckoutIncidents, kitchenBookings, users, emailLogs } from '@shared/schema';
import { db } from '../db';
import { getAppBaseUrl } from '../config';
import { resolveLocale, tLocale } from '../i18n';
import { notificationService } from './notification.service';
import { operationalEmailAllowed } from './admin-email-preferences';
import { assertWorkerTime, isWorkerBudgetError, workerAfter, workerPageEnd, workerRecord } from './worker-context';

type Incident = typeof kitchenCheckoutIncidents.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const reference = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;
export function checkoutRecoveryStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error('Checkout verification is unavailable');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover', maxNetworkRetries: 0, timeout: 1500 });
}

export async function registerKitchenCheckout(sessionId: string, chefId: number, kitchenId: number, operatingDate: string, quoteSnapshot?: unknown) {
  await db.insert(kitchenCheckoutIncidents).values({ sessionId, chefId, kitchenId, operatingDate, ...(quoteSnapshot != null ? { quoteSnapshot } : {}) })
    .onConflictDoNothing({ target: kitchenCheckoutIncidents.sessionId });
}
export async function checkoutIncident(sessionId: string) {
  const [row] = await db.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, sessionId)).limit(1);
  return row;
}

/** Only provider-verified facts are public; internal errors and secrets never leave the recovery desk. */
export function publicCheckoutOutcome(row: Incident) {
  return { state: row.outcome === 'booking_created' ? 'request_created'
    : row.outcome === 'inventory_conflict' ? 'slot_taken'
    : ['needs_support', 'closed'].includes(row.outcome) ? 'needs_support' : 'verifying',
    sessionId: row.sessionId, bookingId: row.bookingId, paymentIntentId: row.paymentIntentId,
    operatingDate: row.operatingDate, amountCents: row.amountCents, currency: row.currency,
    moneyStatus: row.moneyStatus, refundId: row.refundId, lastCheckedAt: row.lastCheckedAt };
}

export function checkoutOutcomeMessage(row: Incident, locale?: string | null, audience: 'chef' | 'admin' = 'admin') {
  const language = resolveLocale(locale);
  const t = (key: string, options: Record<string, unknown> = {}) => tLocale(language, key, { ns: 'booking', ...options });
  const amount = row.amountCents == null ? '' : new Intl.NumberFormat(language, { style: 'currency', currency: row.currency.toUpperCase() }).format(row.amountCents / 100);
  const money = row.moneyStatus === 'hold_released' ? t('checkoutHoldReleased')
    : row.moneyStatus === 'refunded' ? t('checkoutRefundSent', { amount })
    : row.moneyStatus === 'refund_pending' ? t('checkoutRefundPending', { amount }) : t('checkoutNeedsSupportDetail');
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${row.operatingDate}T12:00:00Z`));
  // Chefs never see payment-provider ids; Local Cooks needs the checkout reference to look the payment up.
  if (audience === 'chef') return `${t(row.inventoryConflict ? 'checkoutSlotTaken' : 'checkoutNeedsSupport')}. ${money} ${t('checkoutDate', { date })}.${row.inventoryConflict ? ` ${t('checkoutOthersUnchanged')}` : ''}`;
  return `${t(row.inventoryConflict ? 'checkoutSlotTaken' : 'checkoutNeedsSupport')}. ${money} ${t('checkoutDate', { date })}. ${t('checkoutReference', { reference: row.sessionId })}.`;
}

/** Queue into the existing outcome email worker and notification bell, atomically once per verified state. */
async function notifyIncident(tx: Tx, row: Incident) {
  if (!['inventory_conflict', 'needs_support'].includes(row.outcome)) return;
  const state = `${row.outcome}:${row.moneyStatus}`;
  if (row.notificationState === state) return;
  const people = await tx.select().from(users).where(or(eq(users.id, row.chefId), eq(users.role, 'admin')));
  for (const person of people) {
    const chef = person.id === row.chefId;
    const path = chef ? `/payment-success?session_id=${encodeURIComponent(row.sessionId)}` : '/admin?section=booking-support';
    const title = tLocale(person.preferredLocale, chef ? row.inventoryConflict ? 'checkoutSlotTaken' : 'checkoutNeedsSupport' : 'checkoutIncidents', { ns: 'booking' });
    const message = checkoutOutcomeMessage(row, person.preferredLocale, chef ? 'chef' : 'admin');
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager', type: 'system_announcement', priority: 'high',
      title, message, actionUrl: path, actionLabel: tLocale(person.preferredLocale, chef ? 'checkoutCheckAgain' : 'checkoutIncidents', { ns: 'booking' }),
      metadata: { checkoutIncidentId: row.id, sessionId: row.sessionId, paymentIntentId: row.paymentIntentId } }, tx);
    if (operationalEmailAllowed(person)) await tx.insert(emailLogs).values({ recipientEmail: person.username, recipientUserId: person.id,
      recipientRole: chef ? 'chef' : 'admin', subject: title, category: 'lifecycle_outcome', status: 'queued',
      trackingId: `checkout-outcome:${row.id}:${state}:${person.id}`, previewText: message,
      textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : 'admin')}${path}` });
  }
  await tx.update(kitchenCheckoutIncidents).set({ notificationState: state }).where(eq(kitchenCheckoutIncidents.id, row.id));
}

export async function updateCheckoutIncident(sessionId: string, patch: Partial<Omit<Incident, 'id' | 'sessionId' | 'chefId' | 'kitchenId'>>) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, sessionId)).for('update');
    if (!current) throw Error('Checkout recovery record missing');
    // A late error cannot replace a completed booking or verified financial outcome.
    if (current.outcome === 'booking_created' && patch.outcome !== 'booking_created') return current;
    const [next] = await tx.update(kitchenCheckoutIncidents).set({ ...patch, updatedAt: new Date() })
      .where(eq(kitchenCheckoutIncidents.id, current.id)).returning();
    await notifyIncident(tx, next);
    return next;
  });
}

/** A conflict is saved while the inventory lock is held, before releasing/refunding any money. */
export async function recordCheckoutConflict(sessionId: string) {
  await db.update(kitchenCheckoutIncidents).set({ inventoryConflict: true, outcome: 'inventory_conflict', updatedAt: new Date() })
    .where(and(eq(kitchenCheckoutIncidents.sessionId, sessionId), sql`${kitchenCheckoutIncidents.bookingId} IS NULL`));
}

export async function resolveCheckoutConflict(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent, stripe: Stripe) {
  // This timestamp must survive a provider timeout followed by a rolled-back receipt transaction.
  await db.update(kitchenCheckoutIncidents).set({ moneyAttemptedAt: sql`COALESCE(${kitchenCheckoutIncidents.moneyAttemptedAt}, now())` })
    .where(eq(kitchenCheckoutIncidents.sessionId, session.id));
  // Serialize recovery around the original financial operation, including webhook/worker races.
  return db.transaction(async tx => {
    const [row] = await tx.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, session.id)).for('update');
    if (!row?.inventoryConflict || row.bookingId) throw Error('Checkout conflict needs review');
    let current = await stripe.paymentIntents.retrieve(intent.id);
    if (current.currency !== session.currency || current.amount !== session.amount_total)
      throw Error('Checkout payment amount or currency needs review');
    let moneyStatus = 'unverified', refundId = row.refundId;
    if (current.status === 'requires_capture') current = await stripe.paymentIntents.cancel(current.id, {}, { idempotencyKey: `kitchen_inventory_release_${session.id}` });
    if (current.status === 'canceled' && current.amount_received === 0) moneyStatus = 'hold_released';
    else if (current.status === 'succeeded') {
      await (await import('./booking-money-guard')).assertBookingMoneyWritable({ paymentIntentId: intent.id }, tx);
      // Recover the original refund even after Stripe's idempotency retention window.
      const receipts = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
      const originals = receipts.data.filter(refund => refund.metadata?.checkout_session_id === session.id);
      if (receipts.has_more || originals.length > 1) throw Error('Checkout refund receipts need review');
      const original = originals[0];
      if (!original && row.moneyAttemptedAt && Date.now() - row.moneyAttemptedAt.getTime() >= 23 * 3600_000)
        throw Error('Original checkout refund attempt needs provider review');
      const refund = original || await stripe.refunds.create({ payment_intent: intent.id, amount: current.amount_received,
        reason: 'requested_by_customer', metadata: { checkout_session_id: session.id } }, { idempotencyKey: `kitchen_inventory_conflict_${session.id}` });
      if (reference(refund.payment_intent) !== intent.id || refund.amount !== current.amount_received || refund.currency !== session.currency)
        throw Error('Checkout refund differs from the original payment');
      refundId = refund.id;
      moneyStatus = refund.status === 'succeeded' ? 'refunded' : refund.status === 'pending' ? 'refund_pending' : 'unverified';
    }
    const [next] = await tx.update(kitchenCheckoutIncidents).set({ outcome: moneyStatus === 'unverified' ? 'needs_support' : 'inventory_conflict',
      paymentIntentId: intent.id, amountCents: current.status === 'canceled' ? current.amount : current.amount_received,
      currency: session.currency || 'cad', moneyStatus, refundId, error: null, lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(kitchenCheckoutIncidents.id, row.id)).returning();
    await notifyIncident(tx, next);
    return null;
  }).catch(async error => {
    if (isWorkerBudgetError(error)) throw error;
    await updateCheckoutIncident(session.id, { outcome: 'needs_support', paymentIntentId: intent.id, error: (error as Error).message });
    throw error;
  });
}

/** Called by webhook and bounded backstop, never by an unverified browser result. */
export async function reconcileKitchenCheckout(sessionId: string, stripe = checkoutRecoveryStripe()) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  const row = await checkoutIncident(sessionId);
  if (row && session.metadata?.type === 'storage_rental') {
    if (session.metadata.chef_id !== String(row.chefId) || session.metadata.kitchen_id !== String(row.kitchenId))
      throw Error('Checkout identity needs review');
    return (await import('./storage-rentals')).fulfillRentalCheckout(session, stripe);
  }
  if (!row || session.metadata?.type !== 'kitchen_booking' || session.metadata.chef_id !== String(row.chefId)
    || session.metadata.kitchen_id !== String(row.kitchenId)) throw Error('Checkout identity needs review');
  if (session.status !== 'complete') {
    if (session.status === 'expired') await updateCheckoutIncident(sessionId, { outcome: 'closed', lastCheckedAt: new Date() });
    return;
  }
  const intent = session.payment_intent;
  if (!intent || typeof intent === 'string') throw Error('Checkout payment evidence is unavailable');
  const [booking] = await db.select().from(kitchenBookings).where(and(eq(kitchenBookings.paymentIntentId, intent.id), eq(kitchenBookings.chefId, row.chefId))).limit(1);
  if (booking) {
    await updateCheckoutIncident(sessionId, { outcome: 'booking_created', bookingId: booking.id, paymentIntentId: intent.id, lastCheckedAt: new Date() });
    if (booking.invitationId && booking.status === 'pending' && booking.paymentStatus === 'authorized' && !booking.paymentDecision)
      await (await import('./booking-checkout-fulfillment')).fulfillQuotedKitchenBooking(session, intent, stripe);
    return;
  }
  if (row.inventoryConflict) return resolveCheckoutConflict(session, intent, stripe);
  if (!['requires_capture', 'succeeded'].includes(intent.status)) throw Error('Completed checkout payment needs review');
  if (!session.metadata.addon_prices) throw Error('Legacy checkout requires Local Cooks review of its quoted items');
  return (await import('./booking-checkout-fulfillment')).fulfillQuotedKitchenBooking(session, intent, stripe);
}

export async function recoverKitchenCheckouts(limit = 3) {
  const key = 'checkoutRecovery', pageSize = Math.min(limit, 3);
  const rows = await db.select().from(kitchenCheckoutIncidents).where(and(
    or(notInArray(kitchenCheckoutIncidents.outcome, ['booking_created', 'closed']),
      and(eq(kitchenCheckoutIncidents.outcome, 'booking_created'), sql`EXISTS (SELECT 1 FROM ${kitchenBookings}
        WHERE ${kitchenBookings.id} = ${kitchenCheckoutIncidents.bookingId} AND ${kitchenBookings.invitationId} IS NOT NULL
        AND ${kitchenBookings.status} = 'pending' AND ${kitchenBookings.paymentStatus} = 'authorized'
        AND ${kitchenBookings.paymentDecision} IS NULL)`)),
    or(eq(kitchenCheckoutIncidents.moneyStatus, 'unverified'), eq(kitchenCheckoutIncidents.moneyStatus, 'refund_pending')),
    workerAfter(key, kitchenCheckoutIncidents.id))).orderBy(asc(kitchenCheckoutIncidents.id)).limit(pageSize);
  await workerPageEnd(key, rows.length, pageSize);
  let recovered = 0, errors = 0;
  for (const row of rows) {
    assertWorkerTime(2500);
    try { await reconcileKitchenCheckout(row.sessionId); recovered++; }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      await updateCheckoutIncident(row.sessionId, { outcome: 'needs_support', error: (error as Error).message, lastCheckedAt: row.lastCheckedAt || new Date() });
      errors++;
    }
    await workerRecord(key, row.id);
  }
  return { recovered, errors };
}

export async function listCheckoutIncidents(query = '') {
  return db.select().from(kitchenCheckoutIncidents).where(and(inArray(kitchenCheckoutIncidents.outcome, ['inventory_conflict', 'needs_support', 'verifying']),
    query ? or(eq(kitchenCheckoutIncidents.sessionId, query), eq(kitchenCheckoutIncidents.paymentIntentId, query)) : undefined))
    .orderBy(sql`CASE WHEN ${kitchenCheckoutIncidents.outcome} = 'needs_support' THEN 0
      WHEN ${kitchenCheckoutIncidents.moneyStatus} IN ('unverified', 'refund_pending') THEN 1 ELSE 2 END`, asc(kitchenCheckoutIncidents.id)).limit(50);
}

/** Ownership is checked before returning any payment or incident reference, including legacy sessions. */
export async function readKitchenCheckoutResult(sessionId: string, chefId: number) {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || sessionId.length > 255) return null;
  let row = await checkoutIncident(sessionId);
  if (row && row.chefId !== chefId) return null;
  if (!row) {
    const session = await checkoutRecoveryStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.type !== 'kitchen_booking' || session.metadata.chef_id !== String(chefId)) return null;
    const kitchenId = Number(session.metadata.kitchen_id), date = session.metadata.booking_date?.slice(0, 10);
    if (!Number.isSafeInteger(kitchenId) || kitchenId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    await registerKitchenCheckout(sessionId, chefId, kitchenId, date);
    const intentId = reference(session.payment_intent);
    const [booking] = intentId ? await db.select().from(kitchenBookings)
      .where(and(eq(kitchenBookings.paymentIntentId, intentId), eq(kitchenBookings.chefId, chefId))).limit(1) : [];
    row = await updateCheckoutIncident(sessionId, { paymentIntentId: intentId || null,
      ...(booking ? { outcome: 'booking_created', bookingId: booking.id } : {}), lastCheckedAt: new Date() });
  }
  if (!row) return null;
  // The chef sees our booking reference (KB-…) once the request exists; the Stripe id is kept only for support cases.
  const [booking] = row.bookingId ? await db.select({ referenceCode: kitchenBookings.referenceCode }).from(kitchenBookings)
    .where(and(eq(kitchenBookings.id, row.bookingId), eq(kitchenBookings.chefId, chefId))).limit(1) : [];
  return { ...publicCheckoutOutcome(row), referenceCode: booking?.referenceCode ?? null };
}

export async function retryCheckoutIncidentForAdmin(sessionId: string, actorId: number, note: string) {
  const row = await checkoutIncident(sessionId);
  if (!row) return null;
  await db.update(kitchenCheckoutIncidents).set({ recoveryHistory: sql`${kitchenCheckoutIncidents.recoveryHistory} || ${JSON.stringify([{ actorId, note, action: 'retry_original_checkout', at: new Date().toISOString() }])}::jsonb` })
    .where(eq(kitchenCheckoutIncidents.id, row.id));
  try { await reconcileKitchenCheckout(sessionId); }
  catch (error) { await updateCheckoutIncident(sessionId, { outcome: 'needs_support', error: (error as Error).message }); }
  return checkoutIncident(sessionId);
}
