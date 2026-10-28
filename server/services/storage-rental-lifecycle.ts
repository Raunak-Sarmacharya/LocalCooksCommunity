/**
 * Standalone storage lifecycle (WP-ST7): reminders, grace, holdover, removal review, final notice, kitchen-recorded removal.
 * Rides the 30-minute worker tick (<= 3 rentals per task, no new cron). Lock order: rental -> overstay records.
 * Nothing here charges a card: a holdover charge is a request the chef pays on-session (or disputes), or the kitchen waives.
 */
import { and, asc, eq, like, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, storageBookings, storageListings, storageOverstayHistory, storageOverstayRecords } from '@shared/schema';
import { addDays, daysBetween, DISPOSAL_OTHER_DAYS, DISPOSAL_PERISHABLE_HOURS, localDayStart, localToday, occupancyRange,
  REMOVAL_REVIEW_DAYS, rentalPhase, termPrice, toDateRange } from '@shared/storage-rental';
import { logger } from '../logger';
import { generateReferenceCode } from '../reference-code';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { processManagerDecision } from './overstay-penalty-service';
import { storageSettings } from './storage-settings';
import { queueStorageRentalNotice, type StorageNoticeEvent, type StorageNoticeFacts } from './storage-rental-notices';
import { expireRental, StorageRentalError } from './storage-rentals';
import { workerAfter, workerPageEnd, workerRecord } from './worker-context';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Rental = typeof storageBookings.$inferSelect;
type Frozen = { dailyPriceCents: number; taxRatePercent: number; maxTermDays: number; noticesSent?: string[] };
export type RemovalItem = { name: string; qty: number; perishable: boolean; removedAt?: string; removedBy?: number };
type Review = { openedAt: string; openedBy: number | null; items: RemovalItem[]; photos: string[]; finalNoticeAt?: string;
  perishablesAfter?: string; othersAfter?: string; actions: Array<Record<string, unknown>>; history?: unknown[]; closedAt?: string; closedReason?: string };

const HOLDOVER_DISPUTE_HOURS = 72;
const OPEN_HOLDOVER = ['detected', 'grace_period', 'pending_review', 'penalty_approved', 'charge_pending', 'charge_failed', 'escalated'];
const SETTLED_HOLDOVER = ['charge_succeeded', 'penalty_waived', 'resolved'];
const fail = (code: string, status = 409): never => { throw new StorageRentalError(code, status); };

const dates = (r: Rental) => ({ rentalState: r.rentalState!, termStart: r.termStart!, paidThrough: r.paidThrough!, reclaimEndOn: r.reclaimEndOn, reclaim: r.reclaim,
  releasedOn: r.releasedOn, needsCleaning: r.needsCleaning });
function phaseOf(r: Rental, today: string) {
  const f = r.rentalTerms as Frozen;
  return rentalPhase({ ...dates(r), dailyPriceCents: f.dailyPriceCents, taxRatePercent: f.taxRatePercent }, today)!; // callers lock reserved, active or removal_review rentals
}
const withTax = (baseCents: number, taxRatePercent: number) => baseCents + Math.round((baseCents * taxRatePercent) / 100);
/** Largest pre-tax amount whose total with tax does not exceed what the kitchen entered. */
export function holdoverBaseCents(totalCents: number, taxRatePercent: number) {
  let base = Math.round(totalCents / (1 + taxRatePercent / 100));
  while (withTax(base + 1, taxRatePercent) <= totalCents) base++;
  while (base > 0 && withTax(base, taxRatePercent) > totalCents) base--;
  return base;
}

async function lockRental(tx: Tx, id: number) {
  const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, id)).for('update');
  if (!rental?.rentalState || !rental.termStart || !rental.paidThrough || !rental.timezone || !rental.rentalTerms) fail('not_found', 404);
  return rental;
}
async function assertManager(reader: Pick<typeof db, 'select'>, rental: Rental, managerId: number) {
  const [place] = await reader.select({ managerId: locations.managerId }).from(storageListings)
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(storageListings.id, rental.storageListingId));
  if (place?.managerId !== managerId) fail('not_found', 404);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------------------------------------------------

/** One notice per event and key; `sent` holds `${event}:${key}` markers on the rental's terms JSON. */
type Planned = { event: StorageNoticeEvent; key: string; facts: Omit<StorageNoticeFacts, 'eventKey'> };
function plan(sent: Set<string>, event: StorageNoticeEvent, reached: Array<{ key: string; facts: Planned['facts'] }>, out: Planned[]) {
  // Every reached step is marked; only the latest unsent one is announced, so a late sweep sends one notice, not a burst.
  const last = reached.at(-1);
  if (last && !sent.has(`${event}:${last.key}`)) out.push({ event, ...last });
  for (const step of reached) sent.add(`${event}:${step.key}`);
}

async function suggestedExtension(f: Frozen) {
  const days = Math.max(1, Math.min(7, f.maxTermDays || 7));
  const price = await termPrice({ days, dailyPriceCents: f.dailyPriceCents, taxRatePercent: f.taxRatePercent,
    serviceFee: async (subtotal, tax) => (await calculateCheckoutFeesAsync(subtotal, { taxAmountCents: tax })).platformCommissionInCents });
  return { days, amountCents: price.totalCents };
}

async function openReview(tx: Tx, rental: Rental, today: string, now: Date, openedBy: number | null) {
  const previous = rental.removalReview as Review | null;
  const review: Review = { openedAt: now.toISOString(), openedBy, items: [], photos: [], actions: [],
    ...(previous ? { history: [...(previous.history ?? []), { ...previous, history: undefined }] } : {}) };
  await tx.update(storageBookings).set({ rentalState: 'removal_review', removalReview: review, updatedAt: now,
    occupancy: toDateRange(occupancyRange({ ...dates(rental), rentalState: 'removal_review' })!) }).where(eq(storageBookings.id, rental.id));
  await queueStorageRentalNotice(tx, rental.id, 'removal_review', { eventKey: `opened:${today}`, date: today, timezone: rental.timezone! });
}

async function sweepOne(id: number, now: Date) {
  const [pending] = await db.select({ state: storageBookings.rentalState }).from(storageBookings).where(eq(storageBookings.id, id));
  if (pending?.state === 'requested') { await expireRental(id, now); return; }
  await db.transaction(async tx => {
    const rental = await lockRental(tx, id);
    if (!['reserved', 'active'].includes(rental.rentalState!)) return;
    const f = rental.rentalTerms as Frozen, timezone = rental.timezone!, today = localToday(now, timezone);
    const sent = new Set(f.noticesSent ?? []), due: Planned[] = [];
    if (rental.rentalState === 'reserved') {
      const since = daysBetween(rental.termStart!, today);
      const reach = (steps: number[]) => steps.filter(n => since >= n).map(n => ({ key: `${n}:${rental.termStart}`, facts: { startOn: rental.termStart! } }));
      plan(sent, 'move_in_due', reach([1, 3]), due);
      plan(sent, 'not_moved_in', reach([7]), due);
    } else {
      const phase = phaseOf(rental, today);
      const end = phase.effectiveEnd, base = { paidThrough: end, timezone };
      if (phase.phase === 'current' || phase.phase === 'ending_soon') {
        // No "ending" reminder in a term's first half: a 7-day rental isn't told to extend the day it starts.
        const half = addDays(rental.termStart!, Math.ceil(daysBetween(rental.termStart!, end) / 2));
        const steps = [14, 7, 2, 0].filter(n => today >= addDays(end, -n) && addDays(end, -n) >= half);
        // Price the suggested extension only when a reminder is actually going out.
        const latest = steps.at(-1);
        const ext = latest !== undefined && !sent.has(`ending:${latest}:${end}`) ? await suggestedExtension(f) : { days: 0, amountCents: 0 };
        plan(sent, 'ending', steps.map(n => ({ key: `${n}:${end}`, facts: { ...base, ...ext } })), due);
      } else if (phase.phase === 'grace') {
        plan(sent, 'grace_started', [1, 3, 5].filter(n => today >= addDays(end, n))
          .map(n => ({ key: `${n}:${end}`, facts: { ...base, graceEndsOn: phase.graceEndsOn } })), due);
      } else if (phase.holdoverDays >= REMOVAL_REVIEW_DAYS) {
        // Holdover reached 15 days: accrual is frozen by the phase rules and the unit stays held open-ended.
        await openReview(tx, rental, today, now, null);
        return;
      } else {
        plan(sent, 'holdover_started', [{ key: phase.graceEndsOn, facts: { ...base, graceEndsOn: phase.graceEndsOn,
          dailyCents: withTax(f.dailyPriceCents, f.taxRatePercent) } }], due);
      }
    }
    for (const item of due) await queueStorageRentalNotice(tx, id, item.event, { timezone, ...item.facts, eventKey: item.key });
    if (sent.size !== (f.noticesSent ?? []).length) await tx.update(storageBookings).set({ rentalTerms: { ...f, noticesSent: Array.from(sent) } }).where(eq(storageBookings.id, id));
  });
}

/** One rental's sweep (the QA test clock runs it for a single record). */
export const sweepStorageRental = sweepOne;

/** Cursor-paged: at most 3 rentals per tick; only rentals whose dates can have something due are selected. */
export async function sweepStorageRentals(limit = 3, now = new Date()) {
  const key = 'storageRentals', size = Math.min(3, limit), utc = localToday(now, 'UTC');
  const rows = await db.select({ id: storageBookings.id }).from(storageBookings).where(and(workerAfter(key, storageBookings.id),
    or(and(eq(storageBookings.rentalState, 'requested'), lte(storageBookings.responseDeadline, now)),
      // Move-in reminders end on day 7; the date window keeps finished reminders from clogging the cursor.
      and(eq(storageBookings.rentalState, 'reserved'), lte(storageBookings.termStart, addDays(utc, 1)), sql`${storageBookings.termStart} >= ${addDays(utc, -9)}::date`),
      and(eq(storageBookings.rentalState, 'active'),
        sql`LEAST(${storageBookings.paidThrough}, COALESCE(${storageBookings.reclaimEndOn}, ${storageBookings.paidThrough})) <= ${addDays(utc, 15)}::date`))))
    .orderBy(asc(storageBookings.id)).limit(size);
  await workerPageEnd(key, rows.length, size);
  let errors = 0;
  for (const row of rows) {
    await workerRecord(key, row.id);
    try { await sweepOne(row.id, now); }
    catch (error) { errors++; logger.error('[StorageLifecycle] Rental sweep failed', { rentalId: row.id, error: error instanceof Error ? error.message : 'unknown' }); }
  }
  return { checked: rows.length, errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// Holdover: a request the chef pays (or disputes) on-session, or the kitchen waives. Never an off-session charge.
// ---------------------------------------------------------------------------------------------------------------------

async function holdoverState(tx: Pick<typeof db, 'select'>, rental: Rental, now: Date) {
  if (!['active', 'removal_review'].includes(rental.rentalState!)) fail('not_active');
  const f = rental.rentalTerms as Frozen, phase = phaseOf(rental, localToday(now, rental.timezone!));
  if (phase.holdoverDays < 1) fail('holdover_not_started');
  const records = await tx.select({ status: storageOverstayRecords.status, days: storageOverstayRecords.daysOverdue, key: storageOverstayRecords.idempotencyKey })
    .from(storageOverstayRecords).where(and(eq(storageOverstayRecords.storageBookingId, rental.id), like(storageOverstayRecords.idempotencyKey, `holdover:${rental.id}:%`)));
  if (records.some(r => OPEN_HOLDOVER.includes(r.status))) fail('holdover_request_open');
  const prefix = `holdover:${rental.id}:${phase.effectiveEnd}:`;
  const covered = Math.max(0, ...records.filter(r => SETTLED_HOLDOVER.includes(r.status) && r.key.startsWith(prefix)).map(r => r.days));
  const newDays = phase.holdoverDays - covered;
  if (newDays < 1) fail('holdover_not_started');
  const capBase = newDays * f.dailyPriceCents;
  return { f, phase, key: `${prefix}${phase.holdoverDays}`, newDays, capBase, capTotal: withTax(capBase, f.taxRatePercent) };
}
/** Same eligibility used by the kitchen routes; read-only and safe outside a transaction. */
export async function storageLifecycleActions(rental: Rental, now = new Date(), reader: Pick<typeof db, 'select'> = db) {
  const actions: string[] = [];
  let holdoverChargeCents = 0;
  if (['active', 'removal_review'].includes(rental.rentalState!)) {
    try {
      const state = await holdoverState(reader, rental, now);
      holdoverChargeCents = state.capTotal;
      actions.push('holdover-charge', 'holdover-waive');
    } catch (error) { if (!(error instanceof StorageRentalError)) throw error; }
  }
  const review = rental.removalReview as Review | null;
  const removalItemIndexes = rental.rentalState === 'removal_review' && review?.finalNoticeAt && (await storageSettings(reader)).kitchenDisposalEnabled
    ? review.items.flatMap((item, index) => !item.removedAt && now >= new Date(item.perishable ? review.perishablesAfter! : review.othersAfter!) ? [index] : []) : [];
  if (removalItemIndexes.length) actions.push('removal/record');
  return { actions, holdoverChargeCents, removalItemIndexes };
}
const recordValues = (rental: Rental, s: Awaited<ReturnType<typeof holdoverState>>) => ({ storageBookingId: rental.id,
  endDate: localDayStart(addDays(s.phase.effectiveEnd, 1), rental.timezone!), daysOverdue: s.phase.holdoverDays,
  gracePeriodEndsAt: localDayStart(addDays(s.phase.graceEndsOn, 1), rental.timezone!), calculatedPenaltyCents: s.capBase,
  dailyRateCents: s.f.dailyPriceCents, penaltyRate: '0', idempotencyKey: s.key });

/** amountCents is the most the chef will pay including HST; it cannot exceed what has built up since the last settled request. */
export async function raiseHoldoverCharge(rentalId: number, managerId: number, input: { amountCents: number; note?: string }, now = new Date()) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) fail('invalid_details', 400);
  const referenceCode = await generateReferenceCode('overstay_penalty');
  return db.transaction(async tx => {
    const rental = await lockRental(tx, rentalId);
    await assertManager(tx, rental, managerId);
    const s = await holdoverState(tx, rental, now);
    if (input.amountCents > s.capTotal) fail('exceeds_accrued', 400);
    const base = holdoverBaseCents(input.amountCents, s.f.taxRatePercent);
    if (base < 1) fail('invalid_details', 400);
    const deadline = new Date(now.getTime() + HOLDOVER_DISPUTE_HOURS * 3600000);
    const [record] = await tx.insert(storageOverstayRecords).values({ ...recordValues(rental, s), referenceCode, status: 'penalty_approved',
      finalPenaltyCents: base, penaltyApprovedBy: managerId, penaltyApprovedAt: now, penaltyNoticeSentAt: now, chefDisputeDeadline: deadline,
      managerNotes: input.note?.trim() || null }).returning();
    // Written directly: the legacy outcome mail is English and cannot say this is a storage holdover.
    await tx.insert(storageOverstayHistory).values({ overstayRecordId: record.id, previousStatus: null, newStatus: 'penalty_approved',
      eventType: 'penalty_approved', eventSource: 'manager', description: `Holdover charge raised for ${s.newDays} day(s)`,
      metadata: { rentalId, days: s.newDays, baseCents: base }, createdBy: managerId });
    const totalCents = withTax(base, s.f.taxRatePercent);
    await queueStorageRentalNotice(tx, rentalId, 'holdover_charge', { eventKey: s.key, timezone: rental.timezone!, amountCents: totalCents,
      days: s.newDays, deadline, paidThrough: s.phase.effectiveEnd });
    return { overstayId: record.id, amountCents: totalCents, days: s.newDays, chefDisputeDeadline: deadline };
  });
}

export async function waiveHoldover(rentalId: number, managerId: number, input: { reason: string }, now = new Date()) {
  const reason = input.reason?.trim();
  if (!reason) fail('invalid_details', 400);
  const referenceCode = await generateReferenceCode('overstay_penalty');
  // processManagerDecision decides pending_review records, so the waiver is recorded as one and decided at once.
  const { id, days, key, timezone } = await db.transaction(async tx => {
    const rental = await lockRental(tx, rentalId);
    await assertManager(tx, rental, managerId);
    const s = await holdoverState(tx, rental, now);
    const [record] = await tx.insert(storageOverstayRecords).values({ ...recordValues(rental, s), referenceCode, status: 'pending_review' }).returning();
    return { id: record.id, days: s.newDays, key: s.key, timezone: rental.timezone! };
  });
  const decision = await processManagerDecision({ overstayRecordId: id, managerId, action: 'waive', waiveReason: reason });
  if (!decision.success) {
    // A waiver that cannot be decided must not leave an open record blocking the chef's future rentals.
    await db.delete(storageOverstayRecords).where(eq(storageOverstayRecords.id, id));
    return fail('unavailable', 500);
  }
  await db.transaction(tx => queueStorageRentalNotice(tx, rentalId, 'holdover_waived', { eventKey: key, timezone, days }));
  return { overstayId: id, days };
}

// ---------------------------------------------------------------------------------------------------------------------
// Removal review
// ---------------------------------------------------------------------------------------------------------------------

/** Admin can open the review before 15 holdover days, but never while the chef is still inside paid or grace time. */
export async function openRemovalReview(rentalId: number, now = new Date()) {
  return db.transaction(async tx => {
    const rental = await lockRental(tx, rentalId);
    if (rental.rentalState !== 'active') fail('not_active');
    const today = localToday(now, rental.timezone!);
    if (phaseOf(rental, today).phase !== 'holdover') fail('holdover_not_started');
    await openReview(tx, rental, today, now, null);
    return { state: 'removal_review' as const };
  });
}

export async function sendFinalNotice(rentalId: number, adminId: number, input: { photos: string[]; items: Array<{ name: string; qty: number; perishable: boolean }> }, now = new Date()) {
  const items = (Array.isArray(input.items) ? input.items : []).map(item => ({ name: String(item?.name ?? '').trim(), qty: item?.qty, perishable: item?.perishable === true }));
  const photos = Array.isArray(input.photos) ? input.photos.filter(url => typeof url === 'string' && url) : [];
  if (!items.length || items.length > 100 || !photos.length || photos.length > 20
    || items.some(item => !item.name || item.name.length > 200 || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 9999)) fail('invalid_details', 400);
  return db.transaction(async tx => {
    const rental = await lockRental(tx, rentalId);
    const review = rental.removalReview as Review | null;
    if (rental.rentalState !== 'removal_review' || !review) fail('not_active');
    if (review!.finalNoticeAt) fail('final_notice_sent');
    const perishablesAfter = new Date(now.getTime() + DISPOSAL_PERISHABLE_HOURS * 3600000);
    const othersAfter = new Date(now.getTime() + DISPOSAL_OTHER_DAYS * 86400000);
    await tx.update(storageBookings).set({ updatedAt: now, removalReview: { ...review, items, photos, finalNoticeAt: now.toISOString(),
      perishablesAfter: perishablesAfter.toISOString(), othersAfter: othersAfter.toISOString(),
      actions: [...review!.actions, { at: now.toISOString(), actorId: adminId, role: 'admin', type: 'final_notice' }] } }).where(eq(storageBookings.id, rentalId));
    // The chef's copy is a legal notice: chefs and kitchens are never filtered out of the email.
    await queueStorageRentalNotice(tx, rentalId, 'final_notice', { eventKey: 'final', timezone: rental.timezone!, photos: photos.length,
      perishablesAfter, othersAfter, date: now });
    return { perishablesAfter, othersAfter };
  });
}

/** A kitchen may record removal only after the matching deadline and while the platform toggle is on; an admin always may. */
export async function recordRemoval(rentalId: number, actor: { id: number; role: 'manager' | 'admin' }, input: { itemIndexes?: number[]; all?: boolean; note?: string }, now = new Date()) {
  return db.transaction(async tx => {
    const rental = await lockRental(tx, rentalId);
    if (actor.role === 'manager') await assertManager(tx, rental, actor.id);
    const review = rental.removalReview as Review | null;
    if (rental.rentalState !== 'removal_review' || !review) fail('not_active');
    if (!review!.finalNoticeAt) fail('final_notice_required');
    if (actor.role === 'manager') {
      if (!(await storageSettings(tx)).kitchenDisposalEnabled) fail('disposal_disabled', 403);
    }
    const open = review!.items.map((item, index) => ({ item, index })).filter(({ item }) => !item.removedAt);
    const chosen = input.all ? open : (input.itemIndexes ?? []).map(index => open.find(entry => entry.index === index) ?? fail('invalid_details', 400));
    if (!chosen.length || new Set(chosen.map(entry => entry.index)).size !== chosen.length) fail('invalid_details', 400);
    for (const { item } of chosen) {
      const after = new Date(item.perishable ? review!.perishablesAfter! : review!.othersAfter!);
      if (now < after) fail('removal_too_early');
    }
    const items = review!.items.map((item, index) => chosen.some(entry => entry.index === index) ? { ...item, removedAt: now.toISOString(), removedBy: actor.id } : item);
    const allGone = items.every(item => item.removedAt);
    const today = localToday(now, rental.timezone!);
    const ended = { ...dates(rental), rentalState: 'ended' as const, releasedOn: today, needsCleaning: false };
    const range = allGone ? occupancyRange(ended) : null;
    await tx.update(storageBookings).set({ updatedAt: now,
      removalReview: { ...review, items, actions: [...review!.actions, { at: now.toISOString(), actorId: actor.id, role: actor.role, type: 'record_removal',
        itemIndexes: chosen.map(entry => entry.index), note: input.note?.trim() || null }] },
      ...(allGone ? { rentalState: 'ended' as const, endReason: 'cleared' as const, releasedOn: today, status: 'completed' as const,
        needsCleaning: false, occupancy: range ? toDateRange(range) : null } : {}) }).where(eq(storageBookings.id, rentalId));
    await queueStorageRentalNotice(tx, rentalId, 'removal_recorded', { eventKey: `${review!.actions.length}`, timezone: rental.timezone!, date: now });
    return { state: allGone ? 'ended' as const : 'removal_review' as const, remaining: items.filter(item => !item.removedAt).length };
  });
}
