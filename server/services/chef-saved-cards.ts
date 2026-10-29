import Stripe from 'stripe';
import { createHmac } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, storageBookings } from '@shared/schema';
import { logger } from '../logger';

/**
 * A chef's saved cards. Every Stripe Checkout creates its own customer, so one physical card is many PaymentMethods across
 * many bookings. We group them by card fingerprint and show one card; removing it detaches every PaymentMethod in the group
 * and clears this chef's booking references. Nothing is ever charged off-session, so a removed card only means "pay with a new card".
 */
export class SavedCardError extends Error { constructor(message: string, public status = 409) { super(message); } }
export type SavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number; lastUsedAt: string; wallet: string | null; lockedReason: CardLock | null };
type Group = { id: string; card: Omit<SavedCard, 'id' | 'lastUsedAt' | 'lockedReason'>; methods: string[]; lastUsedAt: Date };

const FETCH_CONCURRENCY = 5;
const ref = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;

// Same guard as the storage services: sandbox keys only until live payments are approved.
export function savedCardStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_/.test(key)) throw new SavedCardError('Saved cards are unavailable right now. Please try again later.', 503);
  return new Stripe(key, { apiVersion: '2026-02-25.clover', maxNetworkRetries: 0, timeout: 4000 });
}
type CardStripe = Pick<Stripe, 'paymentMethods'>;

/** Opaque, stable handle: the fingerprint is never sent to the browser. Keyed with the app's existing HMAC secret. */
function handleFor(key: string) {
  const secret = process.env.VISIT_CODE_HMAC_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new SavedCardError('Saved cards are unavailable right now. Please try again later.', 503);
  return createHmac('sha256', secret).update(`saved-card|${key}`).digest('base64url').slice(0, 22);
}

async function chefMethods(chefId: number) {
  const rows = [
    ...await db.select({ customerId: kitchenBookings.stripeCustomerId, methodId: kitchenBookings.stripePaymentMethodId, at: sql<Date | string>`max(${kitchenBookings.updatedAt})` })
      .from(kitchenBookings).where(and(eq(kitchenBookings.chefId, chefId), isNotNull(kitchenBookings.stripePaymentMethodId)))
      .groupBy(kitchenBookings.stripeCustomerId, kitchenBookings.stripePaymentMethodId),
    ...await db.select({ customerId: storageBookings.stripeCustomerId, methodId: storageBookings.stripePaymentMethodId, at: sql<Date | string>`max(${storageBookings.updatedAt})` })
      .from(storageBookings).where(and(eq(storageBookings.chefId, chefId), isNotNull(storageBookings.stripePaymentMethodId)))
      .groupBy(storageBookings.stripeCustomerId, storageBookings.stripePaymentMethodId),
  ];
  const byMethod = new Map<string, { customers: Set<string>; at: Date }>();
  for (const row of rows) {
    const at = new Date(row.at), entry = byMethod.get(row.methodId!) ?? { customers: new Set<string>(), at };
    if (row.customerId) entry.customers.add(row.customerId);
    if (at > entry.at) entry.at = at;
    byMethod.set(row.methodId!, entry);
  }
  return byMethod;
}

// shortcut: one pass over every method the chef has ever used (a few dozen at most); cache or page this if chefs reach hundreds.
async function chefGroups(stripe: CardStripe, chefId: number): Promise<Group[]> {
  const methods = Array.from((await chefMethods(chefId)).entries());
  const groups = new Map<string, Group>();
  let next = 0;
  const worker = async () => {
    while (next < methods.length) {
      const [methodId, { customers, at }] = methods[next++];
      try {
        const method = await stripe.paymentMethods.retrieve(methodId);
        if (method.livemode !== false) throw new SavedCardError('sandbox_only', 503);
        const customer = ref(method.customer);
        // Detached (removed or never kept) or attached to somebody other than the recorded customer: not this chef's saved card.
        if (!customer || !method.card || customers.size && !customers.has(customer)) continue;
        const { brand, last4, exp_month: expMonth, exp_year: expYear, fingerprint, wallet } = method.card;
        const key = fingerprint || `${brand}|${last4}|${expMonth}|${expYear}`;
        const group = groups.get(key) ?? { id: handleFor(key), card: { brand, last4, expMonth, expYear, wallet: wallet?.type ?? null }, methods: [], lastUsedAt: at };
        group.methods.push(methodId);
        if (at > group.lastUsedAt) group.lastUsedAt = at;
        groups.set(key, group);
      } catch (error) {
        if (error instanceof SavedCardError) throw error;
        logger.warn('[Saved cards] A payment method could not be read; skipped', { chefId, code: (error as { code?: string })?.code });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, methods.length) }, worker));
  return Array.from(groups.values()).sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
}

export async function listSavedCards(chefId: number, stripe: CardStripe = savedCardStripe()): Promise<{ cards: SavedCard[] }> {
  const groups = await chefGroups(stripe, chefId);
  const locks = await cardLocks(chefId, groups.flatMap(group => group.methods));
  return { cards: groups.map(group => ({ id: group.id, ...group.card, lastUsedAt: group.lastUsedAt.toISOString(), lockedReason: lockOf(group, locks) })) };
}

export type CardLock = 'pending_request' | 'payment_in_progress';
export const LOCK_MESSAGES: Record<CardLock, string> = {
  pending_request: "This card is holding payment for a request the kitchen hasn't answered yet. You can remove it after they answer.",
  payment_in_progress: 'A payment with this card is still finishing. Try again in a few minutes.',
};

/**
 * Why a chef's payment methods cannot be removed right now. The one source for the list (disabled Remove) and for removal.
 * pending_request: the card is holding an authorized, uncaptured payment for something the kitchen has not answered yet.
 * payment_in_progress: a payment on the card is mid-processing. Rows are matched by the payment method the booking/operation recorded;
 * Checkout-based operations use a new card and are not counted. Request states ended by a decision (accepted, declined, expired) no longer match.
 */
export async function cardLocks(chefId: number, methods: string[]): Promise<Map<string, CardLock>> {
  const locks = new Map<string, CardLock>();
  if (!methods.length) return locks;
  const list = sql.join(methods.map(method => sql`${method}`), sql`, `);
  const result = await db.execute(sql`
    SELECT 'payment_in_progress' AS reason, payment_operation->>'paymentMethodId' AS method_id FROM damage_claims
      WHERE chef_id = ${chefId} AND payment_operation->>'state' IN ('pending', 'cancel_pending', 'ready') AND payment_operation->>'paymentMethodId' IN (${list})
    UNION ALL
    SELECT CASE WHEN status = 'pending' AND payment_status = 'authorized' AND payment_decision IS NULL THEN 'pending_request' ELSE 'payment_in_progress' END, stripe_payment_method_id
      FROM kitchen_bookings
      WHERE chef_id = ${chefId} AND payment_status IN ('authorized', 'processing') AND status NOT IN ('cancelled', 'completed') AND stripe_payment_method_id IN (${list})
    UNION ALL
    SELECT CASE WHEN status = 'pending' AND payment_status = 'authorized' THEN 'pending_request' ELSE 'payment_in_progress' END, stripe_payment_method_id
      FROM storage_bookings
      WHERE chef_id = ${chefId} AND payment_status IN ('authorized', 'processing') AND status NOT IN ('cancelled', 'completed') AND stripe_payment_method_id IN (${list})
    UNION ALL
    SELECT CASE WHEN c.state = 'authorized' THEN 'pending_request' ELSE 'payment_in_progress' END, COALESCE(c.policy->'operation'->>'paymentMethodId', b.stripe_payment_method_id)
      FROM kitchen_booking_changes c JOIN kitchen_bookings b ON b.id = c.booking_id
      WHERE b.chef_id = ${chefId}
        AND (c.state = 'authorized' OR c.state IN ('payment_pending', 'capture_pending') AND c.policy->'operation'->>'checkout' IS DISTINCT FROM 'true')
        AND COALESCE(c.policy->'operation'->>'paymentMethodId', b.stripe_payment_method_id) IN (${list})
    UNION ALL
    SELECT CASE WHEN e.status = 'requested' AND e.authorized_at IS NOT NULL AND e.paid_at IS NULL THEN 'pending_request' ELSE 'payment_in_progress' END, b.stripe_payment_method_id
      FROM kitchen_booking_extensions e JOIN kitchen_bookings b ON b.id = e.booking_id
      WHERE b.chef_id = ${chefId} AND b.stripe_payment_method_id IN (${list})
        AND (e.status = 'requested' AND e.authorized_at IS NOT NULL AND e.paid_at IS NULL
          OR e.operation->>'state' = 'pending' AND e.operation->>'action' IN ('authorize', 'pay', 'capture') AND e.operation->>'checkout' IS DISTINCT FROM 'true')
    UNION ALL
    SELECT CASE WHEN t.status = 'authorized' THEN 'pending_request' ELSE 'payment_in_progress' END, COALESCE(t.operation->>'paymentMethodId', r.stripe_payment_method_id)
      FROM storage_rental_terms t JOIN storage_bookings r ON r.id = t.rental_id
      WHERE r.chef_id = ${chefId} AND COALESCE(t.operation->>'paymentMethodId', r.stripe_payment_method_id) IN (${list})
        AND (t.status = 'authorized' OR t.status = 'awaiting_payment' AND t.operation->>'state' = 'pending' AND t.operation->>'checkout' IS DISTINCT FROM 'true')`);
  for (const row of (result.rows as unknown as Array<{ reason: CardLock; method_id: string }>)) {
    if (locks.get(row.method_id) !== 'pending_request') locks.set(row.method_id, row.reason);
  }
  return locks;
}
const lockOf = (group: Group, locks: Map<string, CardLock>): CardLock | null =>
  group.methods.some(method => locks.get(method) === 'pending_request') ? 'pending_request'
    : group.methods.some(method => locks.has(method)) ? 'payment_in_progress' : null;

export async function removeSavedCard(chefId: number, id: string, stripe: CardStripe = savedCardStripe()): Promise<{ removed: true }> {
  // Only a handle that matches one of this chef's own current groups counts; the client never names a Stripe id.
  const group = (await chefGroups(stripe, chefId)).find(candidate => candidate.id === id);
  if (!group) throw new SavedCardError('That card is already removed.', 404);
  const reason = lockOf(group, await cardLocks(chefId, group.methods));
  if (reason) throw new SavedCardError(LOCK_MESSAGES[reason], 409);
  const detached: string[] = [];
  let failed = false;
  for (const methodId of group.methods) {
    try { await stripe.paymentMethods.detach(methodId); detached.push(methodId); }
    catch (error) {
      const code = (error as { code?: string })?.code, message = String((error as Error)?.message ?? '');
      if (code === 'resource_missing' || /not attached|already been detached/i.test(message)) detached.push(methodId);
      else { failed = true; logger.error('[Saved cards] Detach failed', { chefId, code }); }
    }
  }
  // Clear only what Stripe confirmed gone, on this chef's rows only; updated_at is left alone (booking versions depend on it).
  if (detached.length) await db.transaction(async tx => {
    await tx.update(kitchenBookings).set({ stripePaymentMethodId: null })
      .where(and(eq(kitchenBookings.chefId, chefId), inArray(kitchenBookings.stripePaymentMethodId, detached)));
    await tx.update(storageBookings).set({ stripePaymentMethodId: null })
      .where(and(eq(storageBookings.chefId, chefId), inArray(storageBookings.stripePaymentMethodId, detached)));
  });
  logger.info('[Saved cards] Card removed', { chefId, count: detached.length, last4: group.card.last4, complete: !failed });
  if (failed) throw new SavedCardError('We could not remove every copy of this card. Please try again.', 503);
  return { removed: true };
}
