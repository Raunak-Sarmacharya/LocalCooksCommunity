/** Standalone storage. Lock order: rental -> listing -> term -> payment; provider I/O follows the committed decision. */
import Stripe from 'stripe';
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, platformSettings, kitchenCheckoutIncidents } from '@shared/schema';
import { addDays, approvedTermDates, GRACE_DAYS, localDayStart, localToday, MAX_LEAD_DAYS, occupancyRange, pickFreeUnit,
  rentalPhase, REMOVAL_REVIEW_DAYS, responseDeadline, STORAGE_TERMS_VERSION, storageCancellationSnapshot, termPayoutEligibleAt,
  termPrice, toDateRange, daysBetween, EXTEND_WINDOW_DAYS, type RentalDates } from '@shared/storage-rental';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { chefService } from '../domains/users/chef.service';
import { getUserDisplayName } from '../utils/user-display';
import { readClaimBookingHold } from './damage-claims-v2';
import { hasChefUnpaidPenalties } from './overstay-penalty-service';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { publishedCancellationPolicy, cancellationSnapshotMetadata } from './cancellation-policy-settings';
import { queueStorageRentalNotice } from './storage-rental-notices';
import { scheduleStorageTermPayout } from './storage-payouts';
import { scheduleDeadlineTimer } from './deadline-timer';
import { registerKitchenCheckout, resolveCheckoutConflict, updateCheckoutIncident } from './kitchen-checkout-incidents';
import { generateReferenceCode } from '../reference-code';
import { getAppBaseUrl } from '../config';
import { workerAfter, workerPageEnd, workerRecord } from './worker-context';
import { ensureServerI18n, tLocale } from '../i18n';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;
export const STORAGE_DISCLOSURE_VERSION = 'storage-v1';
export class StorageRentalError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
function fail(code: string, status = 409): never { throw new StorageRentalError(code, status); }
const ref = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;
export function storageRentalStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_/.test(key)) fail('sandbox_only', 503);
  return new Stripe(key, { apiVersion: '2026-02-25.clover', maxNetworkRetries: 0, timeout: 1500 });
}
function sandbox(object: { livemode: boolean }) { if (object.livemode !== false) fail('sandbox_only', 503); }
export type RentalInput = { listingId: number; startOn: string; days: number };
export type RentalCheckoutInput = RentalInput & { requestKey: string; expectedTotalCents: number; acceptedTermsVersion: string;
  cancellationPolicyVersion: number; disclosureVersion: string; quotedAt: string };
type FrozenTerms = { version: string; dailyPriceCents: number; taxRatePercent: number; graceDays: number;
  removalReviewAfterDays: number; maxTermDays: number; cancellationPolicySnapshot: CancellationPolicySnapshot;
  acceptedAt: string; disclosureVersion: string };

async function context(listingId: number, reader: Reader) {
  const [listing] = await reader.select().from(storageListings).where(eq(storageListings.id, listingId));
  // Same visibility rule as the chef listing pages: an approved or active listing is live.
  if (!listing || !listing.isActive || !['approved', 'active'].includes(listing.status) || listing.pricingModel !== 'daily') fail('unavailable');
  const [place] = await reader.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, listing.kitchenId));
  if (!place?.location.managerId) fail('unavailable');
  return { listing, ...place, timezone: place.location.timezone || 'America/St_Johns' };
}
async function eligible(chefId: number, ctx: Awaited<ReturnType<typeof context>>) {
  if (!(await chefService.getApplicationStatusForBooking(chefId, ctx.location.id, ctx.kitchen.id)).canBook) fail('approval_required', 403);
  if ((await readClaimBookingHold(chefId)).held) fail('claim_hold', 403);
  if (await hasChefUnpaidPenalties(chefId)) fail('unpaid_holdover', 403);
}
async function freeUnit(reader: Reader, listingId: number, count: number, dates: RentalDates, today: string, excludeId?: number, chosen?: number) {
  const rows = await reader.select().from(storageBookings).where(eq(storageBookings.storageListingId, listingId));
  const occupied = rows.filter(row => row.id !== excludeId && row.unitIndex && row.termStart && row.paidThrough && row.rentalState)
    .flatMap(row => {
      const range = occupancyRange(row as RentalDates, today);
      return range ? [{ ...range, unitIndex: row.unitIndex! }] : [];
    });
  const range = occupancyRange(dates)!;
  if (chosen !== undefined) {
    if (!Number.isInteger(chosen) || chosen < 1 || chosen > count) fail('full');
    return pickFreeUnit(1, occupied.filter(row => row.unitIndex === chosen).map(row => ({ ...row, unitIndex: 1 })), range) ? chosen : null;
  }
  return pickFreeUnit(count, occupied, range);
}
async function quote(chefId: number, input: RentalInput, reader: Reader, now: Date) {
  const ctx = await context(input.listingId, reader);
  await eligible(chefId, ctx);
  const today = localToday(now, ctx.timezone);
  let endOn: string;
  try { endOn = addDays(input.startOn, input.days - 1); } catch { return fail('invalid_details', 400); }
  const [setting] = await reader.select().from(platformSettings).where(eq(platformSettings.key, 'storage_max_term_days'));
  const platformMax = Number(setting?.value ?? 30);
  if (!Number.isInteger(platformMax) || platformMax < 1 || platformMax > 30) fail('unavailable');
  const maxTermDays = Math.min(platformMax, ctx.listing.maxTermDays ?? 30);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > maxTermDays || input.startOn < today || input.startOn > addDays(today, MAX_LEAD_DAYS)) fail('invalid_details', 400);
  const unitIndex = await freeUnit(reader, input.listingId, ctx.listing.unitCount,
    { rentalState: 'requested', termStart: input.startOn, paidThrough: endOn }, today);
  if (!unitIndex) fail('full');
  const policy = await publishedCancellationPolicy(ctx.kitchen.id, reader);
  const taxRatePercent = Number(ctx.kitchen.taxRatePercent ?? 0);
  const price = await termPrice({ days: input.days, dailyPriceCents: Number(ctx.listing.basePrice), taxRatePercent,
    serviceFee: async (subtotal, tax) => (await calculateCheckoutFeesAsync(subtotal, { taxAmountCents: tax })).platformCommissionInCents });
  return { ctx, policy, price, endOn, unitIndex, taxRatePercent, maxTermDays };
}
export async function quoteRental(chefId: number, input: RentalInput, now = new Date()) {
  const q = await quote(chefId, input, db, now);
  return { ...input, ...q.price, endOn: q.endOn, maxTermDays: q.maxTermDays, taxRatePercent: q.taxRatePercent,
    quotedAt: now.toISOString(),
    acceptedTermsVersion: STORAGE_TERMS_VERSION, disclosureVersion: STORAGE_DISCLOSURE_VERSION,
    cancellationPolicy: { version: q.policy.version, noticeHours: q.policy.noticeHours, lateChargePercent: q.policy.lateChargePercent } };
}
export function assertRentalAcceptance(input: RentalCheckoutInput, totalCents: number, policyVersion: number) {
  if (input.expectedTotalCents !== totalCents) fail('price_changed');
  if (input.acceptedTermsVersion !== STORAGE_TERMS_VERSION || input.cancellationPolicyVersion !== policyVersion
    || input.disclosureVersion !== STORAGE_DISCLOSURE_VERSION) fail('policy_changed');
}
export async function createRentalCheckout(chefId: number, input: RentalCheckoutInput, stripe = storageRentalStripe(), now = new Date(), locale = 'en-CA') {
  const q = await quote(chefId, input, db, now);
  assertRentalAcceptance(input, q.price.totalCents, q.policy.version);
  // Echo the quote clock so retries with one requestKey have identical Stripe parameters, without pre-webhook rows.
  const quotedAt = new Date(input.quotedAt);
  if (!Number.isFinite(quotedAt.getTime()) || quotedAt.getTime() > now.getTime() + 60_000
    || now.getTime() - quotedAt.getTime() > 60_000) fail('quote_expired');
  const cancellation = storageCancellationSnapshot({ policyId: q.policy.id, version: q.policy.version, noticeHours: q.policy.noticeHours,
    lateChargePercent: q.policy.lateChargePercent, disclosureVersion: input.disclosureVersion, acceptedAt: quotedAt.toISOString() }, input.startOn, q.ctx.timezone);
  const metadata = { type: 'storage_rental', chef_id: String(chefId), kitchen_id: String(q.ctx.kitchen.id), listing_id: String(input.listingId),
    start_on: input.startOn, days: String(input.days), quote_total_cents: String(q.price.totalCents), terms_version: STORAGE_TERMS_VERSION,
    request_key: input.requestKey, daily_price_cents: String(q.price.dailyPriceCents), tax_cents: String(q.price.taxCents),
    service_fee_cents: String(q.price.serviceFeeCents), tax_rate: String(q.taxRatePercent), max_term_days: String(q.maxTermDays),
    disclosure_version: input.disclosureVersion, ...cancellationSnapshotMetadata(cancellation) };
  const item = (name: string, cents: number): Stripe.Checkout.SessionCreateParams.LineItem =>
    ({ price_data: { currency: 'cad', unit_amount: cents, product_data: { name } }, quantity: 1 });
  await ensureServerI18n();
  const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], customer_creation: 'always',
    expires_at: Math.floor(quotedAt.getTime() / 1000) + 32 * 60,
    payment_intent_data: { capture_method: 'manual', setup_future_usage: 'on_session', metadata }, metadata,
    line_items: [item(`${q.ctx.listing.name} · ${q.ctx.kitchen.name} · ${input.startOn}–${q.endOn} (${tLocale(locale, 'stCheckoutDays', { ns: 'storage', count: input.days })})`, q.price.subtotalCents),
      ...(q.price.taxCents ? [item(tLocale(locale, 'stCheckoutTax', { ns: 'storage' }), q.price.taxCents)] : []), ...(q.price.serviceFeeCents ? [item(tLocale(locale, 'stCheckoutServiceFee', { ns: 'storage' }), q.price.serviceFeeCents)] : [])],
    success_url: `${getAppBaseUrl('chef')}/storage?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getAppBaseUrl('chef')}/storage/new?kitchenId=${q.ctx.kitchen.id}&listingId=${input.listingId}` },
  { idempotencyKey: `storage-rental:${chefId}:${input.requestKey}` });
  sandbox(session);
  return { checkoutUrl: session.url };
}

export async function fulfillRentalCheckout(session: Stripe.Checkout.Session, stripe = storageRentalStripe()) {
  sandbox(session);
  const m = session.metadata || {};
  const intent = typeof session.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
  if (!intent) fail('payment_review');
  sandbox(intent);
  const chefId = Number(m.chef_id), listingId = Number(m.listing_id), kitchenId = Number(m.kitchen_id), days = Number(m.days);
  if (m.type !== 'storage_rental' || session.status !== 'complete' || session.currency !== 'cad' || intent.currency !== 'cad'
    || session.amount_total !== intent.amount || intent.amount !== Number(m.quote_total_cents)
    || ![chefId, listingId, kitchenId].every(id => Number.isSafeInteger(id) && id > 0) || !m.request_key) fail('payment_review');
  await registerKitchenCheckout(session.id, chefId, kitchenId, m.start_on);
  const result = await db.transaction(async tx => {
    // Listing serialization also makes different event IDs for one Checkout harmless.
    await tx.select({ id: storageListings.id }).from(storageListings).where(eq(storageListings.id, listingId)).for('update');
    const [existing] = await tx.select().from(storageRentalTerms).where(or(eq(storageRentalTerms.paymentIntentId, intent.id),
      eq(storageRentalTerms.requestKey, `storage-rental:${chefId}:${m.request_key}`)));
    if (existing?.paymentIntentId === intent.id) return { id: existing.rentalId };
    const [incident] = await tx.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, session.id));
    if (incident?.inventoryConflict) return { conflict: true };
    let q: Awaited<ReturnType<typeof quote>>, cancellation: CancellationPolicySnapshot;
    try {
      if (existing) fail('not_requested'); // The same request key can never create another rental after Stripe's key expires.
      q = await quote(chefId, { listingId, startOn: m.start_on, days }, tx, new Date());
      if (q.ctx.kitchen.id !== kitchenId || intent.status !== 'requires_capture') fail('payment_review');
      assertRentalAcceptance({ listingId, startOn: m.start_on, days, requestKey: m.request_key, expectedTotalCents: Number(m.quote_total_cents),
        acceptedTermsVersion: m.terms_version, cancellationPolicyVersion: Number(m.cancellation_policy_version), disclosureVersion: m.disclosure_version,
        quotedAt: m.cancellation_accepted_at }, q.price.totalCents, q.policy.version);
      if (Number(m.daily_price_cents) !== q.price.dailyPriceCents || Number(m.tax_cents) !== q.price.taxCents
        || Number(m.service_fee_cents) !== q.price.serviceFeeCents || Number(m.tax_rate) !== q.taxRatePercent) fail('price_changed');
      if (Number(m.max_term_days) !== q.maxTermDays) fail('policy_changed');
      // The booking decoder accepts booking disclosures only; storage has its own consent wording.
      if (Number(m.cancellation_policy_id) !== q.policy.id || Number(m.cancellation_notice) !== q.policy.noticeHours
        || Number(m.cancellation_charge) !== q.policy.lateChargePercent || m.cancellation_timezone !== q.ctx.timezone
        || m.cancellation_disclosure !== STORAGE_DISCLOSURE_VERSION || !Number.isFinite(Date.parse(m.cancellation_accepted_at))) fail('policy_changed');
      cancellation = storageCancellationSnapshot({ policyId: q.policy.id, version: q.policy.version, noticeHours: q.policy.noticeHours,
        lateChargePercent: q.policy.lateChargePercent, disclosureVersion: m.disclosure_version, acceptedAt: m.cancellation_accepted_at }, m.start_on, q.ctx.timezone);
    } catch (error) {
      if (!(error instanceof StorageRentalError)) throw error;
      // Durable under the listing lock: another webhook must never resurrect a rejected Checkout.
      await tx.update(kitchenCheckoutIncidents).set({ inventoryConflict: true, outcome: 'inventory_conflict',
        paymentIntentId: intent.id, error: error.code, updatedAt: new Date() }).where(eq(kitchenCheckoutIncidents.sessionId, session.id));
      return { conflict: true };
    }
    const ctx = q.ctx;
    const createdAt = new Date(), deadline = responseDeadline(createdAt);
    const terms: FrozenTerms = { version: STORAGE_TERMS_VERSION, dailyPriceCents: q.price.dailyPriceCents, taxRatePercent: q.taxRatePercent,
      graceDays: GRACE_DAYS, removalReviewAfterDays: REMOVAL_REVIEW_DAYS, maxTermDays: q.maxTermDays,
      cancellationPolicySnapshot: cancellation, acceptedAt: cancellation.acceptedAt!, disclosureVersion: m.disclosure_version };
    const dates: RentalDates = { rentalState: 'requested', termStart: m.start_on, paidThrough: q.endOn };
    const [rental] = await tx.insert(storageBookings).values({ referenceCode: await generateReferenceCode('storage_booking'), chefId,
      storageListingId: listingId, ...dates, unitIndex: q.unitIndex, timezone: ctx.timezone, rentalTerms: terms, responseDeadline: deadline,
      startDate: localDayStart(m.start_on, ctx.timezone), endDate: localDayStart(addDays(q.endOn, 1), ctx.timezone),
      occupancy: toDateRange(occupancyRange(dates)!), status: 'pending', paymentStatus: 'authorized', paymentIntentId: intent.id,
      totalPrice: String(q.price.subtotalCents), serviceFee: String(q.price.serviceFeeCents), pricingModel: 'daily', createdAt,
      stripeCustomerId: ref(intent.customer), stripePaymentMethodId: ref(intent.payment_method) }).returning();
    const [term] = await tx.insert(storageRentalTerms).values({ rentalId: rental.id, seq: 1, kind: 'first', startsOn: m.start_on, endsOn: q.endOn,
      ...q.price, status: 'authorized', requestKey: `storage-rental:${chefId}:${m.request_key}`, checkoutSessionId: session.id, paymentIntentId: intent.id }).returning();
    const [payment] = await tx.insert(paymentTransactions).values({ bookingId: rental.id, bookingType: 'storage', chefId, managerId: ctx.location.managerId,
      amount: String(intent.amount), baseAmount: String(q.price.subtotalCents + q.price.taxCents), taxAmount: String(q.price.taxCents),
      serviceFee: String(q.price.serviceFeeCents), managerRevenue: String(q.price.subtotalCents + q.price.taxCents), netAmount: String(intent.amount),
      paymentIntentId: intent.id, paymentMethodId: ref(intent.payment_method), status: 'authorized', stripeStatus: intent.status,
      payoutTiming: 'storage_term', metadata: { storageTermId: term.id, checkout_session_id: session.id, platformCommission: q.price.serviceFeeCents } }).returning();
    await tx.update(storageRentalTerms).set({ paymentTransactionId: payment.id }).where(eq(storageRentalTerms.id, term.id));
    await queueStorageRentalNotice(tx, rental.id, 'requested', { eventKey: 'first', startOn: m.start_on, endOn: q.endOn,
      deadline, days, amountCents: intent.amount, timezone: ctx.timezone });
    await tx.update(kitchenCheckoutIncidents).set({ outcome: 'closed', moneyStatus: 'authorized', paymentIntentId: intent.id,
      lastCheckedAt: createdAt, updatedAt: createdAt }).where(eq(kitchenCheckoutIncidents.sessionId, session.id));
    return { id: rental.id, deadline };
  });
  if (result.conflict) {
    await resolveCheckoutConflict(session, intent, stripe);
    return { full: true };
  }
  // booking_id on incidents is kitchen-only; the term links storage Checkout to its rental.
  const [rental] = await db.select().from(storageBookings).where(eq(storageBookings.id, result.id!));
  if (rental.rentalState === 'requested') scheduleDeadlineTimer('storage_request', rental.id, rental.responseDeadline);
  const [term] = await db.select().from(storageRentalTerms).where(eq(storageRentalTerms.paymentIntentId, intent.id));
  const op = term?.operation as Decision | null;
  if (op?.state === 'pending') await decideRental(rental.id, op.action, undefined, {}, stripe);
  return { rentalId: rental.id };
}

type DecisionTarget = 'reserved' | 'declined' | 'expired' | 'withdrawn';
type Decision = { key: string; action: DecisionTarget; state: 'pending' | 'complete'; actorId?: number; reason?: string;
  unitIndex: number; termStart: string; paidThrough: string; startedAt: string };
export type RentalActor = { id: number; role: 'chef' | 'manager' };
async function owned(reader: Reader, id: number, actor?: RentalActor, lock = false) {
  const query = reader.select().from(storageBookings).where(eq(storageBookings.id, id));
  const [rental] = lock ? await query.for('update') : await query;
  if (!rental?.rentalState || !rental.termStart || !rental.paidThrough || !rental.timezone) fail('not_found', 404);
  if (actor?.role === 'chef' && rental.chefId !== actor.id) fail('not_found', 404);
  if (actor?.role === 'manager') {
    const [place] = await reader.select({ managerId: locations.managerId }).from(storageListings)
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(storageListings.id, rental.storageListingId));
    if (place?.managerId !== actor.id) fail('not_found', 404);
  }
  return rental;
}
export async function decideRental(id: number, target: DecisionTarget, actor?: RentalActor,
  options: { unitIndex?: number; reason?: string; now?: Date; onlyIfDue?: boolean } = {}, stripe = storageRentalStripe()) {
  const now = options.now ?? new Date();
  const prepared = await db.transaction(async tx => {
    const rental = await owned(tx, id, actor, true);
    if (actor?.role === 'chef' && target !== 'withdrawn' || actor?.role === 'manager' && !['reserved', 'declined'].includes(target)) fail('forbidden', 403);
    await tx.select({ id: storageListings.id }).from(storageListings).where(eq(storageListings.id, rental.storageListingId)).for('update');
    const [term] = await tx.select().from(storageRentalTerms).where(and(eq(storageRentalTerms.rentalId, id), eq(storageRentalTerms.seq, 1))).for('update');
    if (!term) fail('payment_review');
    const previous = term.operation as Decision | null;
    if (previous) {
      if (previous.action !== target) {
        if (options.onlyIfDue) return null;
        fail('decision_pending');
      }
      if (options.unitIndex !== undefined && options.unitIndex !== previous.unitIndex) fail('decision_pending');
      return { rental, term, decision: previous };
    }
    if (rental.rentalState !== 'requested') { if (options.onlyIfDue) return null; fail('not_requested'); }
    if (options.onlyIfDue && (!rental.responseDeadline || now < rental.responseDeadline)) return null;
    if (target === 'reserved' && (!rental.responseDeadline || now >= rental.responseDeadline)) fail('deadline_passed');
    let dates = { termStart: rental.termStart!, paidThrough: rental.paidThrough! }, unitIndex = rental.unitIndex!;
    if (target === 'reserved') {
      const ctx = await context(rental.storageListingId, tx);
      dates = approvedTermDates(rental.termStart!, term.days, localToday(now, rental.timezone!));
      unitIndex = await freeUnit(tx, ctx.listing.id, ctx.listing.unitCount, { ...dates, rentalState: 'reserved' }, localToday(now, rental.timezone!), id, options.unitIndex) ?? fail('full');
      // Reserve shifted inventory BEFORE capture, so a new checkout cannot take it during provider I/O.
      await tx.update(storageBookings).set({ ...dates, unitIndex, occupancy: toDateRange(occupancyRange({ ...dates, rentalState: 'requested' })!),
        startDate: localDayStart(dates.termStart, rental.timezone!), endDate: localDayStart(addDays(dates.paidThrough, 1), rental.timezone!) }).where(eq(storageBookings.id, id));
    }
    const decision: Decision = { key: `storage-decision:${id}:${target}`, action: target, state: 'pending', actorId: actor?.id,
      reason: options.reason, ...dates, unitIndex, startedAt: now.toISOString() };
    await tx.update(storageRentalTerms).set({ operation: decision }).where(eq(storageRentalTerms.id, term.id));
    return { rental, term, decision };
  });
  if (!prepared) return { changed: false };
  const { rental, term, decision } = prepared;
  if (decision.state === 'complete') return { changed: false, state: rental.rentalState };
  try {
    let intent = await stripe.paymentIntents.retrieve(term.paymentIntentId!);
    sandbox(intent);
    if (intent.amount !== term.totalCents || intent.currency !== 'cad') fail('payment_review');
    if (intent.status === 'requires_capture') {
      try {
        intent = target === 'reserved' ? await stripe.paymentIntents.capture(intent.id, { amount_to_capture: term.totalCents }, { idempotencyKey: decision.key })
          : await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: decision.key });
      } catch (error) {
        // A timeout is ambiguous. Only a verified cancellation expires the rental; retries keep the same operation.
        intent = await stripe.paymentIntents.retrieve(intent.id);
        if (target === 'reserved' && (error as { type?: string }).type === 'StripeCardError' && intent.status === 'requires_capture')
          intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${decision.key}:failed` });
        if (!['succeeded', 'canceled'].includes(intent.status)) throw error;
      }
    }
    if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status))
      intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${decision.key}:failed` });
    if (intent.status === 'canceled' && intent.amount_received !== 0) fail('payment_review');
    const captured = intent.status === 'succeeded' && intent.amount_received === term.totalCents;
    if (!(captured && target === 'reserved') && intent.status !== 'canceled') fail('payment_review');
    const state = captured ? 'reserved' as const : target === 'reserved' ? 'expired' as const : target;
    const result = await db.transaction(async tx => {
      const current = await owned(tx, id, undefined, true);
      const [saved] = await tx.select().from(storageRentalTerms).where(eq(storageRentalTerms.id, term.id)).for('update');
      const op = saved.operation as Decision;
      if (op.key !== decision.key) fail('decision_pending');
      if (op.state === 'complete') return { changed: false, state: current.rentalState };
      const paidAt = captured ? new Date() : null;
      const frozen = current.rentalTerms as FrozenTerms;
      const cancellation = storageCancellationSnapshot(frozen.cancellationPolicySnapshot, decision.termStart, current.timezone!);
      await tx.update(storageBookings).set({ rentalState: state, status: captured ? 'confirmed' : 'cancelled', paymentStatus: captured ? 'paid' : 'failed',
        approvedAt: captured ? now : null, decidedBy: decision.actorId, declineReason: decision.reason, updatedAt: new Date(),
        rentalTerms: { ...frozen, cancellationPolicySnapshot: cancellation },
        ...(!captured ? { occupancy: null } : {}) }).where(eq(storageBookings.id, id));
      await tx.update(storageRentalTerms).set({ operation: { ...op, state: 'complete' }, status: captured ? 'paid' : 'cancelled', paidAt,
        startsOn: decision.termStart, endsOn: decision.paidThrough }).where(eq(storageRentalTerms.id, term.id));
      await tx.update(paymentTransactions).set({ status: captured ? 'succeeded' : 'canceled', stripeStatus: intent.status, paidAt,
        payoutTiming: 'storage_term', payoutEligibleAt: paidAt ? termPayoutEligibleAt({ endsOn: decision.paidThrough, paidAt }, { timezone: current.timezone! }) : null,
        updatedAt: new Date() }).where(eq(paymentTransactions.id, term.paymentTransactionId!));
      if (captured) await scheduleStorageTermPayout(id, tx);
      await queueStorageRentalNotice(tx, id, captured ? 'approved' : state === 'expired' && (target === 'reserved' || decision.reason === 'authorization_lapsed') ? 'authorization_lapsed'
        : state === 'expired' ? 'expired' : state === 'withdrawn' ? 'withdrawn' : 'declined', {
        eventKey: decision.key, startOn: decision.termStart, endOn: decision.paidThrough, unitLabel: String(decision.unitIndex),
        days: term.days, amountCents: term.totalCents, timezone: current.timezone! });
      if (term.checkoutSessionId) await tx.update(kitchenCheckoutIncidents).set({ outcome: 'closed',
        moneyStatus: captured ? 'paid' : 'hold_released', error: null, lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(kitchenCheckoutIncidents.sessionId, term.checkoutSessionId));
      return { changed: true, state };
    });
    return result;
  } catch (error) {
    if (term.checkoutSessionId) await updateCheckoutIncident(term.checkoutSessionId, { outcome: 'needs_support',
      moneyStatus: 'unverified', error: 'Storage payment decision needs reconciliation', lastCheckedAt: new Date() });
    throw error;
  }
}
export const expireRental = (id: number, now = new Date(), stripe = storageRentalStripe()) =>
  decideRental(id, 'expired', undefined, { now, onlyIfDue: true }, stripe);
export const withdrawRental = (id: number, chefId: number, stripe = storageRentalStripe()) =>
  decideRental(id, 'withdrawn', { id: chefId, role: 'chef' }, {}, stripe);

/** An unsolicited provider cancellation may precede the response deadline; a pending decision keeps its ownership. */
export async function rentalIntentCanceled(intent: Stripe.PaymentIntent, stripe = storageRentalStripe()) {
  sandbox(intent);
  const [term] = await db.select().from(storageRentalTerms).where(eq(storageRentalTerms.paymentIntentId, intent.id));
  if (!term) return;
  const op = term.operation as Decision | null;
  return decideRental(term.rentalId, op?.action ?? 'expired', undefined, op ? {} : { reason: 'authorization_lapsed' }, stripe);
}
export { storageTermStillEligible } from './storage-payouts';

export async function sweepStorageRentalRequests(limit = 3, now = new Date(), stripe = storageRentalStripe()) {
  const key = 'storageRequests', size = Math.min(3, limit);
  const rows = await db.select({ id: storageBookings.id }).from(storageBookings).where(and(workerAfter(key, storageBookings.id),
    eq(storageBookings.rentalState, 'requested'), or(lte(storageBookings.responseDeadline, now),
      sql`EXISTS (SELECT 1 FROM ${storageRentalTerms} t WHERE t.rental_id = ${storageBookings.id} AND t.operation->>'state' = 'pending')`)))
    .orderBy(asc(storageBookings.id)).limit(size);
  await workerPageEnd(key, rows.length, size);
  for (const row of rows) {
    await workerRecord(key, row.id);
    const [term] = await db.select().from(storageRentalTerms).where(and(eq(storageRentalTerms.rentalId, row.id), eq(storageRentalTerms.seq, 1)));
    const op = term?.operation as Decision | null;
    if (op?.state === 'pending') await decideRental(row.id, op.action, undefined, {}, stripe);
    else await expireRental(row.id, now, stripe);
  }
  return { checked: rows.length };
}
/**
 * Kitchen/chef DTO for one rental. `chef` names the occupant (kitchens see the chef's name, chefs see their own),
 * and each term carries the payout status the kitchen screen shows: eligible date, released date, hold reason.
 * `resolvedChefName` lets `listRentals` name every occupant with one lookup per chef instead of one per row.
 */
export async function readRental(id: number, actor: RentalActor, now = new Date(), resolvedChefName?: string) {
  const rental = await owned(db, id, actor);
  const ctx = await contextForRead(rental.storageListingId);
  const terms = await db.select().from(storageRentalTerms).where(eq(storageRentalTerms.rentalId, id)).orderBy(asc(storageRentalTerms.seq));
  const frozen = rental.rentalTerms as FrozenTerms;
  const phase = rentalPhase({ ...rental, ...frozen } as RentalDates & FrozenTerms, localToday(now, rental.timezone!));
  const pending = terms.some(term => (term.operation as Decision | null)?.state === 'pending');
  const actions = rental.rentalState === 'requested' && !pending
    ? actor.role === 'chef' ? ['withdraw'] : rental.responseDeadline && now < rental.responseDeadline ? ['approve', 'decline'] : ['decline'] : [];
  const paymentIds = terms.flatMap(term => (typeof term.paymentTransactionId === 'number' ? [term.paymentTransactionId] : []));
  const payments = paymentIds.length
    ? await db.select({ id: paymentTransactions.id, payoutEligibleAt: paymentTransactions.payoutEligibleAt,
        payoutReleasedAt: paymentTransactions.payoutReleasedAt, payoutHoldReason: paymentTransactions.payoutHoldReason, managerRevenue: paymentTransactions.managerRevenue })
        .from(paymentTransactions).where(inArray(paymentTransactions.id, paymentIds))
    : [];
  const payoutById = new Map(payments.map(payment => [payment.id, payment]));
  const chefName = resolvedChefName ?? (rental.chefId ? await getUserDisplayName(rental.chefId) : '');
  const { storageRentalVisitActions, storageRentalRelet } = await import('./storage-checkout-service');
  actions.push(...storageRentalVisitActions(rental, actor.role, now, rental.rentalState === 'ended' && await storageRentalRelet(rental)));
  if (rental.termStart! <= localToday(now, rental.timezone!) && !['requested', 'declined', 'expired', 'withdrawn'].includes(rental.rentalState!)) actions.push('report_problem');
  // The extend sheet quotes the exact limit (max term, reclaim, next renter); this only gates the button.
  if (actor.role === 'chef' && !pending && ['reserved', 'active', 'removal_review'].includes(rental.rentalState!)
    && daysBetween(localToday(now, rental.timezone!), rental.paidThrough!) <= EXTEND_WINDOW_DAYS) actions.push('extend');
  return { id, ref: rental.referenceCode, kitchen: { id: ctx.kitchen.id, name: ctx.kitchen.name },
    listing: { id: ctx.listing.id, name: ctx.listing.name }, chef: { id: rental.chefId ?? null, name: chefName },
    unitLabel: String(rental.unitIndex), state: rental.rentalState, timezone: rental.timezone,
    phase: phase?.phase ?? null, startOn: rental.termStart, paidThrough: rental.paidThrough,
    graceEndsOn: phase?.graceEndsOn ?? addDays(rental.paidThrough!, GRACE_DAYS), holdoverDays: phase?.holdoverDays ?? 0,
    accruedCents: phase?.accruedCents ?? 0, responseDeadline: rental.responseDeadline, declineReason: rental.declineReason, rentalTerms: frozen, actions,
    terms: terms.map(({ id, seq, kind, startsOn, endsOn, days, dailyPriceCents, subtotalCents, taxCents, serviceFeeCents, totalCents, status, paidAt, paymentTransactionId }) => {
      const payout = paymentTransactionId ? payoutById.get(paymentTransactionId) : undefined;
      return { id, seq, kind, startsOn, endsOn, days, dailyPriceCents, subtotalCents, taxCents, serviceFeeCents, totalCents, status, paidAt,
        payoutEligibleAt: payout?.payoutEligibleAt ?? null, payoutReleasedAt: payout?.payoutReleasedAt ?? null, payoutHoldReason: payout?.payoutHoldReason ?? null,
        payoutCents: payout ? Math.round(Number(payout.managerRevenue)) : null };
    }),
    noBaseline: (rental.rentalTerms as { noBaseline?: boolean })?.noBaseline ?? false, needsCleaning: rental.needsCleaning, releasedOn: rental.releasedOn,
    evidence: { checkinPhotoUrls: rental.checkinPhotoUrls, handoverPhotoUrls: rental.handoverPhotoUrls, checkoutPhotoUrls: rental.checkoutPhotoUrls } };
}
async function contextForRead(listingId: number) {
  const [row] = await db.select({ listing: storageListings, kitchen: kitchens }).from(storageListings)
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).where(eq(storageListings.id, listingId));
  if (!row) fail('not_found', 404);
  return row;
}
export async function listRentals(actor: RentalActor) {
  const rows = await db.select({ id: storageBookings.id, chefId: storageBookings.chefId }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(isNotNull(storageBookings.rentalTerms), actor.role === 'chef' ? eq(storageBookings.chefId, actor.id) : eq(locations.managerId, actor.id)))
    .orderBy(asc(storageBookings.id));
  const names = new Map<number, string>();
  for (const chefId of Array.from(new Set(rows.flatMap(row => (row.chefId ? [row.chefId] : []))))) names.set(chefId, await getUserDisplayName(chefId));
  return Promise.all(rows.map(row => readRental(row.id, actor, new Date(), row.chefId ? names.get(row.chefId) : '')));
}
