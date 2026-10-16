/** Lock order: rental -> listing -> term -> payment. Workers only reconcile committed attempts; they never charge. */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../db';
import { kitchens, locations, paymentTransactions, storageBookings, storageListings, storageRentalTerms } from '@shared/schema';
import { addDays, extensionLimit, localDayStart, localToday, occupancyRange, rangesOverlap, termPayoutEligibleAt,
  termPrice, toDateRange, type RentalDates } from '@shared/storage-rental';
import { assertBookingMoneyWritable, BookingMoneyFrozen } from './booking-money-guard';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { queueStorageRentalNotice } from './storage-rental-notices';
import { storageSettings } from './storage-settings';
import { readRental, storageRentalStripe, StorageRentalError } from './storage-rentals';
import { getAppBaseUrl } from '../config';
import { ensureServerI18n, tLocale } from '../i18n';
import { isWorkerBudgetError, workerAfter, workerPageEnd, workerRecord } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;
type Term = typeof storageRentalTerms.$inferSelect;
export type StorageExtensionStripe = Pick<Stripe, 'paymentIntents' | 'checkout' | 'paymentMethods'>;
type Operation = { key: string; attemptKey: string; action: 'pay'; state: 'pending' | 'done'; decidedAt: string;
  checkout: boolean; customerId: string | null; paymentMethodId: string | null; locale: string;
  previousOccupancy: string | null; previousState: string };
export type ExtensionInput = { days: number; expectedTotalCents: number; requestKey: string; useSavedCard: boolean };
const opOf = (term: Term) => term.operation as Operation;
const ref = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;
function fail(code: string, status = 409): never { throw new StorageRentalError(code, status); }
function sandbox(value: { livemode: boolean }) { if (value.livemode !== false) fail('sandbox_only', 503); }

async function context(reader: Reader, rentalId: number, chefId?: number, lock = false) {
  let [rental] = await reader.select().from(storageBookings).where(eq(storageBookings.id, rentalId));
  if (!rental || chefId !== undefined && rental.chefId !== chefId) fail('not_found', 404);
  if (lock) {
    await reader.execute(sql`SELECT id FROM storage_bookings WHERE id = ${rentalId} FOR UPDATE`);
    await reader.execute(sql`SELECT id FROM storage_listings WHERE id = ${rental.storageListingId} FOR UPDATE`);
    [rental] = await reader.select().from(storageBookings).where(eq(storageBookings.id, rentalId));
    if (!rental || chefId !== undefined && rental.chefId !== chefId) fail('not_found', 404);
  }
  const [place] = await reader.select({ listing: storageListings, kitchen: kitchens, managerId: locations.managerId })
    .from(storageListings).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageListings.id, rental.storageListingId));
  if (!place?.managerId || !rental.chefId || !rental.timezone || !rental.termStart || !rental.paidThrough || !rental.unitIndex) fail('unavailable');
  return { rental, chefId: rental.chefId, ...place };
}
type Context = Awaited<ReturnType<typeof context>>;

/** Storage flags must apply even before WP-ST6's shared money guard learns the standalone storage parent. */
async function moneyWritable(reader: Reader, row: Context) {
  try { await assertBookingMoneyWritable({ paymentIntentId: row.rental.paymentIntentId ?? undefined }, reader); }
  catch (error) { if (error instanceof BookingMoneyFrozen) fail('payment_review'); throw error; }
  const blocked = await reader.execute(sql`SELECT id FROM booking_flags WHERE storage_booking_id = ${row.rental.id} AND resolved_at IS NULL
    UNION ALL SELECT id FROM support_actions WHERE storage_booking_id = ${row.rental.id} AND status IN ('executing','recovery_required') LIMIT 1`);
  if (blocked.rows.length) fail('payment_review');
}
async function quote(reader: Reader, row: Context, days: number, now: Date) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) fail('invalid_details', 400);
  const { rental } = row, today = localToday(now, rental.timezone!);
  const others = await reader.select().from(storageBookings).where(and(eq(storageBookings.storageListingId, rental.storageListingId),
    eq(storageBookings.unitIndex, rental.unitIndex!)));
  const occupied = others.filter(other => other.id !== rental.id && other.termStart && other.paidThrough && other.rentalState)
    .flatMap(other => { const range = occupancyRange(other as RentalDates, today); return range ? [range] : []; });
  const nextReservationStart = occupied.filter(range => range.from > rental.paidThrough!).map(range => range.from).sort()[0] ?? null;
  const limit = extensionLimit(rental as RentalDates, today, { platformMaxDays: (await storageSettings(reader)).maxTermDays,
    listingMaxDays: row.listing.maxTermDays, nextReservationStart });
  const newPaidThrough = addDays(rental.paidThrough!, days);
  // Removal review can only be left once every day through today has been paid.
  if (rental.rentalState === 'removal_review' && newPaidThrough < today) fail('invalid_details', 400);
  const frozen = rental.rentalTerms as { dailyPriceCents: number; taxRatePercent: number };
  if (!frozen) fail('unavailable');
  const price = await termPrice({ days, dailyPriceCents: frozen.dailyPriceCents, taxRatePercent: frozen.taxRatePercent,
    serviceFee: async (subtotal, tax) => (await calculateCheckoutFeesAsync(subtotal, { taxAmountCents: tax })).platformCommissionInCents });
  const range = occupancyRange({ ...rental, rentalState: rental.rentalState === 'removal_review' ? 'active' : rental.rentalState,
    paidThrough: newPaidThrough } as RentalDates, today);
  return { ...price, maxDays: limit.maxDays, limitReason: limit.reason, newPaidThrough,
    fits: days <= limit.maxDays && !!range && !occupied.some(other => rangesOverlap(range, other)) };
}
export async function quoteExtension(rentalId: number, chefId: number, days: number, stripe = storageRentalStripe(), now = new Date()) {
  const row = await context(db, rentalId, chefId), q = await quote(db, row, days, now);
  let card: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;
  if (row.rental.stripeCustomerId && row.rental.stripePaymentMethodId) {
    const method = await stripe.paymentMethods.retrieve(row.rental.stripePaymentMethodId);
    sandbox(method);
    if (ref(method.customer) === row.rental.stripeCustomerId && method.card)
      card = { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year };
  }
  const { fits, ...result } = q;
  return { ...result, subtotal: q.subtotalCents, tax: q.taxCents, fee: q.serviceFeeCents, total: q.totalCents, card };
}
const metadata = (term: Term, chefId: number) => ({ type: 'storage_term', storage_term_id: String(term.id), rental_id: String(term.rentalId),
  chef_id: String(chefId), attempt_key: opOf(term).attemptKey });
function matches(term: Term, m: Stripe.Metadata | null | undefined) {
  return m?.type === 'storage_term' && m.storage_term_id === String(term.id) && m.rental_id === String(term.rentalId)
    && m.attempt_key === opOf(term)?.attemptKey;
}
/** Read-only recovery of a lost create response. Never starts another payment. */
export async function findTermIntent(stripe: StorageExtensionStripe, term: Term) {
  const op = opOf(term);
  if (!op?.attemptKey) fail('payment_review');
  const found = await stripe.paymentIntents.search({ query: `metadata['storage_term_id']:'${term.id}' AND metadata['attempt_key']:'${op.attemptKey}'`, limit: 10 });
  const matchesFound = found.data.filter(intent => matches(term, intent.metadata));
  if (matchesFound.length > 1 || found.has_more) fail('payment_review');
  return matchesFound[0];
}
function verifyIntent(intent: Stripe.PaymentIntent, term: Term, row: Context) {
  const op = opOf(term);
  sandbox(intent);
  if (!matches(term, intent.metadata) || intent.metadata.chef_id !== String(row.rental.chefId) || intent.amount !== term.totalCents
    || intent.currency !== 'cad' || intent.capture_method !== 'automatic' || op.customerId && ref(intent.customer) !== op.customerId
    || !op.checkout && !['requires_payment_method', 'canceled'].includes(intent.status) && ref(intent.payment_method) !== op.paymentMethodId
    || term.paymentIntentId && term.paymentIntentId !== intent.id)
    fail('payment_review');
}
async function savedTerm(reader: Reader, termId: number) {
  const [term] = await reader.select().from(storageRentalTerms).where(eq(storageRentalTerms.id, termId));
  if (!term || term.kind !== 'extension') fail('not_found', 404);
  return term;
}
async function result(term: Term, now: Date) {
  if (term.status === 'paid') return { paid: true as const, rental: await readRental(term.rentalId, { id: (await context(db, term.rentalId)).chefId, role: 'chef' }, now) };
  if (['failed', 'cancelled'].includes(term.status)) return { cardFailed: true as const };
  return fail('decision_pending');
}

export async function payExtension(rentalId: number, chefId: number, input: ExtensionInput, stripe = storageRentalStripe(), now = new Date(), locale = 'en-CA') {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey) || !Number.isSafeInteger(input.expectedTotalCents) || input.expectedTotalCents < 0
    || typeof input.useSavedCard !== 'boolean') fail('invalid_details', 400);
  const term = await db.transaction(async tx => {
    const row = await context(tx, rentalId, chefId, true);
    const [prior] = await tx.select().from(storageRentalTerms).where(eq(storageRentalTerms.requestKey, input.requestKey));
    if (prior) {
      if (prior.rentalId !== rentalId || prior.kind !== 'extension' || prior.days !== input.days || prior.totalCents !== input.expectedTotalCents) fail('price_changed');
      return prior;
    }
    const q = await quote(tx, row, input.days, now);
    // Say the real limit; "full" only when another rental is in the way.
    if (!q.fits) fail(input.days > q.maxDays && q.limitReason && q.limitReason !== 'reservation' ? `extend_${q.limitReason}` : 'full');
    if (q.totalCents !== input.expectedTotalCents) fail('price_changed');
    await moneyWritable(tx, row);
    const terms = await tx.select().from(storageRentalTerms).where(eq(storageRentalTerms.rentalId, rentalId));
    if (terms.some(term => ['awaiting_payment', 'authorized'].includes(term.status))) fail('decision_pending');
    const [created] = await tx.insert(storageRentalTerms).values({ rentalId, kind: 'extension', seq: Math.max(0, ...terms.map(term => term.seq)) + 1,
      startsOn: addDays(row.rental.paidThrough!, 1), endsOn: q.newPaidThrough, days: q.days, dailyPriceCents: q.dailyPriceCents,
      subtotalCents: q.subtotalCents, taxCents: q.taxCents, serviceFeeCents: q.serviceFeeCents, totalCents: q.totalCents,
      status: 'awaiting_payment', requestKey: input.requestKey, createdAt: now }).returning();
    const operation: Operation = { key: `storage-term:${created.id}`, attemptKey: randomUUID(), action: 'pay', state: 'pending', decidedAt: now.toISOString(),
      checkout: !input.useSavedCard || !row.rental.stripeCustomerId || !row.rental.stripePaymentMethodId,
      customerId: row.rental.stripeCustomerId, paymentMethodId: row.rental.stripePaymentMethodId, locale,
      previousOccupancy: row.rental.occupancy, previousState: row.rental.rentalState! };
    await tx.update(storageRentalTerms).set({ operation }).where(eq(storageRentalTerms.id, created.id));
    await tx.update(storageBookings).set({ occupancy: toDateRange(occupancyRange({ ...row.rental, paidThrough: q.newPaidThrough } as RentalDates,
      localToday(now, row.rental.timezone!))!), updatedAt: now }).where(eq(storageBookings.id, rentalId));
    return { ...created, operation };
  });
  if (opOf(term)?.state !== 'pending') return result(term, now);
  if (opOf(term).checkout) return checkoutExtension(stripe, term, now);
  return reconcileStorageTerm(stripe, term.id, now, true);
}

async function checkoutExtension(stripe: StorageExtensionStripe, term: Term, now: Date) {
  const op = opOf(term), row = await context(db, term.rentalId);
  if (term.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(term.checkoutSessionId);
    if (session.status !== 'open') return reconcileStorageTerm(stripe, term.id, now);
    if (!session.url) fail('unavailable', 503);
    return { checkoutUrl: session.url };
  }
  // Replaying this committed Checkout create is allowed only on the chef's tap, within its original lifetime.
  if (now.getTime() >= Date.parse(op.decidedAt) + 32 * 60_000) return reconcileStorageTerm(stripe, term.id, now);
  await moneyWritable(db, row);
  await ensureServerI18n();
  const m = metadata(term, row.chefId), url = `${getAppBaseUrl('chef')}/storage/${term.rentalId}?storageTerm=${term.id}`;
  const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'],
    ...(op.customerId ? { customer: op.customerId } : { customer_creation: 'always' }), metadata: m,
    expires_at: Math.floor(Date.parse(op.decidedAt) / 1000) + 32 * 60,
    line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: term.totalCents,
      product_data: { name: `${row.listing.name} · ${row.kitchen.name} · ${term.startsOn}–${term.endsOn} (${tLocale(op.locale, 'stCheckoutDays', { ns: 'storage', count: term.days })})` } } }],
    payment_intent_data: { capture_method: 'automatic', setup_future_usage: 'on_session', metadata: m },
    success_url: url, cancel_url: `${url}&cancelled=1` }, { idempotencyKey: `${op.key}:checkout` });
  sandbox(session);
  await db.update(storageRentalTerms).set({ checkoutSessionId: session.id }).where(and(eq(storageRentalTerms.id, term.id), sql`${storageRentalTerms.operation}->>'key' = ${op.key}`));
  if (!session.url) fail('unavailable', 503);
  return { checkoutUrl: session.url };
}

/** Retrieve provider truth, validate it, then apply the term and its separately gated payment in one transaction. */
export async function reconcileStorageTerm(stripe: StorageExtensionStripe, termId: number, now = new Date(), onSession = false): Promise<
  { paid: true; rental: Awaited<ReturnType<typeof readRental>> } | { cardFailed: true } | { requiresAction: true; clientSecret: string; termId: number }> {
  const term = await savedTerm(db, termId), op = opOf(term);
  if (!op || op.state === 'done') return result(term, now);
  const row = await context(db, term.rentalId);
  let intent: Stripe.PaymentIntent | undefined, session: Stripe.Checkout.Session | undefined;
  if (term.paymentIntentId) intent = await stripe.paymentIntents.retrieve(term.paymentIntentId);
  if (op.checkout && (term.checkoutSessionId || !intent)) {
    if (term.checkoutSessionId) session = await stripe.checkout.sessions.retrieve(term.checkoutSessionId);
    else {
      const found = await stripe.checkout.sessions.list({ created: { gte: Math.floor(Date.parse(op.decidedAt) / 1000) - 1 },
        ...(op.customerId ? { customer: op.customerId } : {}), limit: 100 });
      const sessions = found.data.filter(value => matches(term, value.metadata));
      if (sessions.length > 1 || found.has_more) fail('payment_review');
      session = sessions[0];
    }
    if (session) {
      sandbox(session);
      if (!matches(term, session.metadata) || op.customerId && ref(session.customer) !== op.customerId) fail('payment_review');
      await db.update(storageRentalTerms).set({ checkoutSessionId: session.id }).where(eq(storageRentalTerms.id, termId));
      const intentId = ref(session.payment_intent);
      if (intentId) intent = await stripe.paymentIntents.retrieve(intentId);
    }
  }
  if (!intent && term.paymentIntentId) intent = await stripe.paymentIntents.retrieve(term.paymentIntentId);
  if (!intent && !op.checkout && onSession && now.getTime() - Date.parse(op.decidedAt) < 60 * 60_000) {
    await moneyWritable(db, row);
    try {
      intent = await stripe.paymentIntents.create({ amount: term.totalCents, currency: 'cad', customer: op.customerId!, payment_method: op.paymentMethodId!,
        payment_method_types: ['card'], capture_method: 'automatic', confirm: true, off_session: false, use_stripe_sdk: true,
        metadata: metadata(term, row.chefId) }, { idempotencyKey: op.key });
    } catch (error) {
      intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
      if (!intent?.id) throw error;
    }
  } else if (!intent) intent = await findTermIntent(stripe, term);
  if (intent) {
    verifyIntent(intent, term, row);
    // A declined or abandoned intent must be terminal before its unit hold is released. Checkout owns its retries until expiry.
    const open = ['requires_payment_method', 'requires_action', 'requires_confirmation'].includes(intent.status);
    const abandoned = now.getTime() - Date.parse(op.decidedAt) >= 60 * 60_000;
    if (open && (op.checkout ? session?.status === 'expired' : intent.status === 'requires_payment_method' || abandoned))
      intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel` });
    verifyIntent(intent, term, row);
  }
  const settled = intent;
  await db.transaction(async tx => {
    const currentRow = await context(tx, term.rentalId, undefined, true), current = await savedTerm(tx, termId);
    if (opOf(current)?.key !== op.key || opOf(current).state === 'done') return;
    if (settled) await tx.update(storageRentalTerms).set({ paymentIntentId: settled.id }).where(eq(storageRentalTerms.id, termId));
    if (settled?.status === 'succeeded') {
      if (settled.amount_received !== current.totalCents || currentRow.rental.paidThrough !== addDays(current.startsOn, -1)
        || !['reserved', 'active', 'removal_review'].includes(currentRow.rental.rentalState!)) fail('payment_review');
      const paidAt = now;
      const [payment] = await tx.insert(paymentTransactions).values({ bookingId: current.rentalId, bookingType: 'storage', chefId: currentRow.rental.chefId,
        managerId: currentRow.managerId, amount: String(current.totalCents), baseAmount: String(current.subtotalCents + current.taxCents),
        taxAmount: String(current.taxCents), serviceFee: String(current.serviceFeeCents), managerRevenue: String(current.subtotalCents + current.taxCents),
        netAmount: String(current.totalCents), currency: 'CAD', paymentIntentId: settled.id, chargeId: ref(settled.latest_charge),
        paymentMethodId: ref(settled.payment_method), status: 'succeeded', stripeStatus: settled.status, paidAt,
        payoutTiming: 'storage_term', payoutEligibleAt: termPayoutEligibleAt({ endsOn: current.endsOn, paidAt }, { timezone: currentRow.rental.timezone! }),
        metadata: { type: 'storage_term', storageTermId: current.id, approvedSubtotal: current.subtotalCents, approvedTax: current.taxCents,
          platformCommission: current.serviceFeeCents, capturedAmount: current.totalCents } }).returning();
      const rentalState = currentRow.rental.rentalState === 'removal_review' && current.endsOn >= localToday(now, currentRow.rental.timezone!) ? 'active' : currentRow.rental.rentalState;
      await tx.update(storageBookings).set({ paidThrough: current.endsOn, endDate: localDayStart(addDays(current.endsOn, 1), currentRow.rental.timezone!),
        rentalState, occupancy: toDateRange(occupancyRange({ ...currentRow.rental, rentalState, paidThrough: current.endsOn } as RentalDates,
          localToday(now, currentRow.rental.timezone!))!), stripeCustomerId: ref(settled.customer), stripePaymentMethodId: ref(settled.payment_method), updatedAt: now })
        .where(eq(storageBookings.id, term.rentalId));
      await tx.update(storageRentalTerms).set({ status: 'paid', paidAt, paymentTransactionId: payment.id, operation: { ...op, state: 'done' } })
        .where(eq(storageRentalTerms.id, termId));
      await queueStorageRentalNotice(tx, term.rentalId, 'extended', { eventKey: `term:${termId}`, paidThrough: current.endsOn,
        startOn: current.startsOn, endOn: current.endsOn, days: current.days, amountCents: current.totalCents });
    } else if (settled?.status === 'canceled' || !settled && (session?.status === 'expired'
      || !session && now.getTime() - Date.parse(op.decidedAt) >= 60 * 60_000)) {
      await tx.update(storageRentalTerms).set({ status: 'failed', operation: { ...op, state: 'done' } }).where(eq(storageRentalTerms.id, termId));
      // A lifecycle transition made while payment was pending owns its occupancy; never undo it.
      if (currentRow.rental.rentalState === op.previousState && currentRow.rental.paidThrough === addDays(current.startsOn, -1))
        await tx.update(storageBookings).set({ occupancy: op.previousOccupancy, updatedAt: now }).where(eq(storageBookings.id, term.rentalId));
    }
  });
  const latest = await savedTerm(db, termId);
  if (latest.status === 'awaiting_payment' && settled?.status === 'requires_action' && !op.checkout && settled.client_secret)
    return { requiresAction: true, clientSecret: settled.client_secret, termId };
  return result(latest, now);
}
export async function syncStorageTerm(rentalId: number, termId: number, chefId: number, stripe = storageRentalStripe(), now = new Date()) {
  await context(db, rentalId, chefId);
  const term = await savedTerm(db, termId);
  if (term.rentalId !== rentalId) fail('not_found', 404);
  return reconcileStorageTerm(stripe, termId, now);
}
export async function handleStorageTermWebhook(stripe: StorageExtensionStripe, object: Stripe.PaymentIntent | Stripe.Checkout.Session) {
  if (object.metadata?.type !== 'storage_term') return;
  const id = Number(object.metadata.storage_term_id);
  if (!Number.isSafeInteger(id) || id < 1) fail('payment_review');
  const term = await savedTerm(db, id);
  if (!matches(term, object.metadata)) fail('payment_review');
  if (opOf(term).state === 'done') return result(term, new Date());
  // Bind the identity from the signed event only after retrieving provider truth, avoiding search-index lag.
  const row = await context(db, term.rentalId);
  let paymentIntentId: string | undefined, checkoutSessionId: string | undefined;
  if (object.object === 'checkout.session') {
    const session = await stripe.checkout.sessions.retrieve(object.id);
    sandbox(session);
    if (!opOf(term).checkout || !matches(term, session.metadata) || term.checkoutSessionId && term.checkoutSessionId !== session.id
      || opOf(term).customerId && ref(session.customer) !== opOf(term).customerId) fail('payment_review');
    checkoutSessionId = session.id;
    paymentIntentId = ref(session.payment_intent);
  } else paymentIntentId = object.id;
  if (paymentIntentId) verifyIntent(await stripe.paymentIntents.retrieve(paymentIntentId), term, row);
  await db.transaction(async tx => {
    await context(tx, term.rentalId, undefined, true);
    const current = await savedTerm(tx, id);
    if (opOf(current).state === 'done') return;
    if (current.paymentIntentId && paymentIntentId && current.paymentIntentId !== paymentIntentId) fail('payment_review');
    await tx.update(storageRentalTerms).set({ ...(paymentIntentId ? { paymentIntentId } : {}), ...(checkoutSessionId ? { checkoutSessionId } : {}) })
      .where(eq(storageRentalTerms.id, id));
  });
  return reconcileStorageTerm(stripe, id);
}
export async function recoverStorageTerms(stripe: StorageExtensionStripe, limit = 3, now = new Date()) {
  const size = Math.min(3, Math.max(1, limit));
  const terms = await db.select().from(storageRentalTerms).where(and(eq(storageRentalTerms.kind, 'extension'),
    inArray(storageRentalTerms.status, ['awaiting_payment', 'authorized']), sql`${storageRentalTerms.operation}->>'state' = 'pending'`,
    sql`(${storageRentalTerms.operation}->>'decidedAt')::timestamptz < ${new Date(now.getTime() - 15 * 60_000).toISOString()}`,
    workerAfter('storageTermRecovery', storageRentalTerms.id))).orderBy(asc(storageRentalTerms.id)).limit(size);
  await workerPageEnd('storageTermRecovery', terms.length, size);
  let errors = 0;
  for (const term of terms) {
    await workerRecord('storageTermRecovery', term.id);
    try { await reconcileStorageTerm(stripe, term.id, now); }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      if (!(error instanceof StorageRentalError && error.code === 'decision_pending')) { errors++; logger.error('[Storage term] Payment needs recovery', { termId: term.id }); }
    }
  }
  return { processed: terms.length, errors };
}
