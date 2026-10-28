import { and, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { bookingFlags, commitmentProblems, damageClaims, emailLogs, paymentTransactions, storageBookings, storageOverstayHistory, storageOverstayRecords, storageRentalTerms } from '@shared/schema';
import { addDays, daysBetween, GRACE_DAYS, localDayStart, localToday, occupancyRange, rangesOverlap, rentalPhase, REMOVAL_REVIEW_DAYS, toDateRange, type RentalDates } from '@shared/storage-rental';
import { readVisitDuties } from '@shared/visit-duties';
import { db } from '../db';
import { logger } from '../logger';
import type { ReminderSource } from './advance-reminders';
import { type ClockStep, jumpGraceMs, jumpStepMs, maxJumpMs, recordJump, shiftRows, TestClockError, type Tx } from './qa-test-clock';

type Rental = typeof storageBookings.$inferSelect;
type Frozen = { dailyPriceCents?: number; taxRatePercent?: number; cancellationPolicySnapshot?: { sessions?: Array<{ startAt: string }> } };
type Review = { finalNoticeAt?: string; perishablesAfter?: string; othersAfter?: string; items?: Array<{ perishable: boolean; removedAt?: string }> };
const OCCUPYING = ['requested', 'reserved', 'active', 'move_out_requested', 'removal_review'];
const CAPTURED = ['succeeded', 'partially_refunded', 'refunded'] as Array<typeof paymentTransactions.$inferSelect['status']>;
const holds = (rental: Pick<Rental, 'rentalState' | 'needsCleaning'>) => OCCUPYING.includes(rental.rentalState) || rental.needsCleaning;
const storagePayments = (id: number) => and(eq(paymentTransactions.bookingId, id), eq(paymentTransactions.bookingType, 'storage'))!;

// Local dates written inside JSON ("2026-11-04", or inside keys like "ending:7:2026-11-04"); instants (followed by "T") are left alone.
const dateInText = /(?<=["':])\d{4}-\d{2}-\d{2}(?=["':])/g;
export const shiftDatesInText = (text: string, days: number) => days ? text.replace(dateInText, day => { try { return addDays(day, -days); } catch { return day; } }) : text;

async function rentalRecord(id: number, reader: Pick<typeof db, 'select'> = db) {
  const [rental] = await reader.select().from(storageBookings).where(eq(storageBookings.id, id)).limit(1);
  if (!rental?.termStart || !rental.paidThrough || !rental.timezone || !rental.rentalTerms) throw new TestClockError(404, 'Storage rental not found.');
  return { rental, timezone: rental.timezone, termStart: rental.termStart, paidThrough: rental.paidThrough, frozen: rental.rentalTerms as Frozen };
}

// Most reminder sources are keyed by the rental; the holdover-charge warning is keyed by its overstay record.
async function reminderTargets(reader: Pick<typeof db, 'select'>, id: number) {
  const records = await reader.select({ id: storageOverstayRecords.id }).from(storageOverstayRecords).where(eq(storageOverstayRecords.storageBookingId, id));
  return [...(['storage_arrival', 'storage_review', 'storage_cancellation_review'] as const).map(source => [source, id] as const),
    ...records.map(record => ['penalty', record.id] as const)] as Array<readonly [ReminderSource, number]>;
}
const reminderRows = (targets: Array<readonly [ReminderSource, number]>) => sql`(${sql.join(targets.map(([source, target]) => sql`${emailLogs.trackingId} LIKE ${`advance:${source}:${target}:%`}`), sql` OR `)})`;
// The reminder records themselves. Send attempts share their tracking id but keep the email's text, not reminder JSON.
const reminderIntents = (targets: Array<readonly [ReminderSource, number]>) => and(eq(emailLogs.category, 'advance_reminder'), reminderRows(targets))!;
const reminderLabel = (source: ReminderSource) => source === 'storage_arrival' ? 'Start-day reminder (customer)' : source === 'storage_review' ? 'Move-out inspection reminder (kitchen)'
  : source === 'penalty' ? 'Holdover charge: dispute-window reminder (customer)' : 'Cancellation review reminder (kitchen)';

/** Every upcoming automatic step of one standalone rental, labelled for QA. Date-based steps fall due at the start of the kitchen-local day. */
export async function readStorageClock(id: number, now = new Date()) {
  const { rental, timezone, termStart, paidThrough, frozen } = await rentalRecord(id);
  const steps: Array<{ key: string; label: string; at: number }> = [];
  const add = (key: string, label: string, at: string | number | Date | null | undefined) => {
    const time = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at ?? NaN;
    if (Number.isFinite(time) && time > now.getTime()) steps.push({ key, label, at: time });
  };
  const dayStart = (day: string) => localDayStart(day, timezone).getTime(), state = rental.rentalState;
  if (state === 'requested') add('response_deadline', 'Kitchen answer deadline · unanswered request expires (card hold released)', rental.responseDeadline);
  if (state === 'reserved') {
    for (const n of [1, 3]) add(`move_in_${n}`, `Move-in reminder · day ${n} after the start`, dayStart(addDays(termStart, n)));
    add('not_moved_in', 'Not moved in · day 7 (kitchen can release the unit)', dayStart(addDays(termStart, 7)));
  }
  if (state === 'active') {
    const end = rentalPhase({ ...rental, rentalState: 'active', termStart, paidThrough, dailyPriceCents: frozen.dailyPriceCents ?? 0, taxRatePercent: frozen.taxRatePercent ?? 0 }, localToday(now, timezone))!.effectiveEnd;
    // Same rule as the sweep: no ending reminder in the first half of a term.
    const half = addDays(termStart, Math.ceil(daysBetween(termStart, end) / 2));
    for (const n of [14, 7, 2, 0]) if (addDays(end, -n) >= half) add(`ending_${n}`, n ? `Ending reminder · ${n} days before the end` : 'Ending reminder · last paid day', dayStart(addDays(end, -n)));
    add('grace_1', 'Paid time ends · grace period starts (day 1 notice)', dayStart(addDays(end, 1)));
    for (const n of [3, 5]) add(`grace_${n}`, `Grace notice · day ${n}`, dayStart(addDays(end, n)));
    add('holdover', 'Holdover starts (daily charge builds)', dayStart(addDays(end, GRACE_DAYS + 1)));
    add('removal_review', `Removal review opens (${REMOVAL_REVIEW_DAYS} days of holdover)`, dayStart(addDays(end, GRACE_DAYS + REMOVAL_REVIEW_DAYS)));
  }
  if (state === 'move_out_requested' && rental.checkoutStatus === 'checkout_requested' && rental.checkoutRequestedAt) {
    const minutes = readVisitDuties(rental.visitDuties)?.checkoutReviewWindowMinutes
      ?? (await (await import('./damage-claim-limits-service')).getStorageCheckoutSettings()).reviewWindowHours * 60;
    add('checkout_review', 'Move-out inspection window ends · clears on its own if the kitchen has not answered', rental.checkoutRequestedAt.getTime() + minutes * 60_000);
  }
  const review = rental.removalReview as Review | null, open = (review?.items ?? []).filter(item => !item.removedAt);
  if (state === 'removal_review' && review?.finalNoticeAt) {
    if (open.some(item => item.perishable)) add('dispose_perishables', 'Kitchen may record removal of perishables (no automatic action)', review.perishablesAfter);
    if (open.some(item => !item.perishable)) add('dispose_others', 'Kitchen may record removal of other items (no automatic action)', review.othersAfter);
  }
  for (const record of await db.select({ status: storageOverstayRecords.status, deadline: storageOverstayRecords.chefDisputeDeadline, disputed: storageOverstayRecords.chefDisputedAt })
    .from(storageOverstayRecords).where(eq(storageOverstayRecords.storageBookingId, id)))
    if (record.status === 'penalty_approved' && !record.disputed) add('holdover_dispute', 'Holdover charge: pay-or-dispute window ends (no automatic action: the customer pays when they choose)', record.deadline);
  for (const payout of await db.select({ eligible: paymentTransactions.payoutEligibleAt }).from(paymentTransactions)
    .where(and(storagePayments(id), eq(paymentTransactions.payoutTiming, 'storage_term'), isNull(paymentTransactions.transferId), isNull(paymentTransactions.payoutReleasedAt), inArray(paymentTransactions.status, CAPTURED))))
    add('payout', 'Payout released to the kitchen (Stripe sandbox transfer)', payout.eligible);
  const { currentReminders } = await import('./advance-reminders');
  for (const [source, target] of await reminderTargets(db, id)) for (const reminder of await currentReminders(db as never, source, target, undefined, now).catch(() => []))
    add(`${source}:${reminder.kind}`, reminderLabel(source), reminder.due);
  const seen = new Set<string>();
  return { kind: 'storage' as const, id, reference: rental.referenceCode || `#${id}`, status: state, updatedAt: rental.updatedAt.toISOString(), now: now.toISOString(),
    steps: steps.sort((a, b) => a.at - b.at).filter(step => !seen.has(`${step.label}:${step.at}`) && seen.add(`${step.label}:${step.at}`))
      .map(step => ({ key: step.key, label: step.label, at: new Date(step.at).toISOString() })) as ClockStep[] };
}

/** Narrow: a payment the storage code is still finishing. Jumping mid-flight would race it. */
async function moneyInFlight(tx: Tx, rental: Rental) {
  const terms = await tx.select({ status: storageRentalTerms.status, operation: storageRentalTerms.operation }).from(storageRentalTerms).where(eq(storageRentalTerms.rentalId, rental.id));
  if (terms.some(term => (term.operation as { state?: string } | null)?.state === 'pending')) return 'A payment decision on this rental is still finishing. Try again in a minute.';
  if (terms.some(term => term.status === 'awaiting_payment')) return 'A payment on this rental is still open. Finish or cancel it, then try again.';
  if ((rental.reclaim as { pending?: boolean } | null)?.pending) return 'A refund on this rental is still being verified. Try again in a minute.';
  return null;
}

/** Walks a rental to `to` one step at a time, like jumpBooking. */
export async function jumpStorage(id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [], reminders: Array<{ kind: string; role: string; channel: string }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await readStorageClock(id);
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await jumpStorageOnce(id, new Date(next ? Date.parse(next.at) : target), actorId, version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices); reminders.push(...result.reminders);
    if (!next) { reached = null; break; }
  }
  // Emails that didn't fit in the request finish right after it, as after any storage action.
  if (notices.some(notice => !notice.sent)) (await import('./outcome-delivery')).attemptOutcomeDeliveryAfterResponse();
  return { movedMs, notices, reminders, clock: await readStorageClock(id), ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}

/**
 * Moves one rental and everything recorded against it `ms` earlier, then runs what became due for this rental only.
 * Instants move by `ms`; kitchen-local dates (and the dates written inside notice markers and keys) move by the number of
 * local calendar days the jump crosses, so an already-sent reminder is not sent again.
 */
async function jumpStorageOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const ms = Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;
  const mail = like(emailLogs.trackingId, `storage-rental:${id}:%`);
  const [{ lastMail }] = await db.select({ lastMail: sql<number>`coalesce(max(${emailLogs.id}), 0)::int` }).from(emailLogs).where(mail);
  const sentBefore = new Set((await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderIntents(await reminderTargets(db, id)), eq(emailLogs.status, 'sent')))).map(row => row.id));
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${id} FOR UPDATE`);
      const { rental, timezone, termStart, paidThrough, frozen } = await rentalRecord(id, tx);
      if (rental.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This rental changed. Refresh and try again.');
      await tx.execute(sql`SELECT id FROM storage_listings WHERE id = ${rental.storageListingId} FOR UPDATE`);
      const busy = await moneyInFlight(tx, rental);
      if (busy) throw new TestClockError(409, busy);
      // Moving the dates of an unanswered request would leave the held payment quoted for dates that no longer exist.
      if (rental.rentalState === 'requested' && (!rental.responseDeadline || now.getTime() + ms < rental.responseDeadline.getTime()))
        throw new TestClockError(409, 'Accept or decline this request first. To test it going unanswered, jump to the answer deadline.');

      const today = localToday(now, timezone), days = daysBetween(today, localToday(new Date(now.getTime() + ms), timezone));
      const shiftDay = (day: string | null) => day && addDays(day, -days);
      const moved = { termStart: shiftDay(termStart)!, paidThrough: shiftDay(paidThrough)!, reclaimEndOn: shiftDay(rental.reclaimEndOn), releasedOn: shiftDay(rental.releasedOn) };
      const range = occupancyRange({ ...moved, rentalState: rental.rentalState, reclaim: rental.reclaim, needsCleaning: rental.needsCleaning });
      if (range && holds(rental) && rental.unitIndex) {
        const others = await tx.select().from(storageBookings).where(and(eq(storageBookings.storageListingId, rental.storageListingId),
          eq(storageBookings.unitIndex, rental.unitIndex), ne(storageBookings.id, id)));
        const clash = others.find(other => holds(other) && other.termStart && other.paidThrough && (theirs => !!theirs && rangesOverlap(range, theirs))(occupancyRange(other as RentalDates, today)));
        if (clash) throw new TestClockError(409, `Moving this rental would put it on top of ${clash.referenceCode || `rental #${clash.id}`}, which holds the same unit. Pick an earlier step, or a rental whose unit is free before it.`);
      }

      // Reminders exist before their time in real life; plan them now so the move carries them instead of inventing late ones.
      const { scheduleAdvanceReminders, currentReminders, reminderKey } = await import('./advance-reminders');
      for (const [source, target] of await reminderTargets(tx, id)) await scheduleAdvanceReminders(tx, source, target, undefined, now);

      await shiftRows(tx, storageBookings, eq(storageBookings.id, id), ms);
      const [shifted] = await tx.select().from(storageBookings).where(eq(storageBookings.id, id));
      const json = <T,>(value: T): T => value == null ? value : JSON.parse(shiftDatesInText(JSON.stringify(value), days));
      const dayStart = (day: string) => localDayStart(day, timezone);
      // Instants that are the start of a local day stay the start of the (moved) day, not an arbitrary hour of it.
      const startFollows = rental.startDate.getTime() === dayStart(termStart).getTime(), endFollows = rental.endDate.getTime() === dayStart(addDays(paidThrough, 1)).getTime();
      const terms = json(shifted.rentalTerms) as Frozen, session = frozen.cancellationPolicySnapshot?.sessions?.[0];
      if (session?.startAt === dayStart(termStart).toISOString() && terms.cancellationPolicySnapshot?.sessions?.[0])
        terms.cancellationPolicySnapshot.sessions = [{ ...terms.cancellationPolicySnapshot.sessions[0], startAt: dayStart(moved.termStart).toISOString() }];
      await tx.update(storageBookings).set({ ...moved, occupancy: range ? toDateRange(range) : null, rentalTerms: terms, removalReview: json(shifted.removalReview),
        visitDuties: json(shifted.visitDuties), reclaim: json(shifted.reclaim),
        ...(startFollows ? { startDate: dayStart(moved.termStart) } : {}), ...(endFollows ? { endDate: dayStart(addDays(moved.paidThrough, 1)) } : {}) }).where(eq(storageBookings.id, id));

      await shiftRows(tx, storageRentalTerms, eq(storageRentalTerms.rentalId, id), ms);
      if (days) await tx.execute(sql`UPDATE storage_rental_terms SET starts_on = starts_on - ${days}::int, ends_on = ends_on - ${days}::int WHERE rental_id = ${id}`);
      const records = await tx.select({ id: storageOverstayRecords.id, key: storageOverstayRecords.idempotencyKey }).from(storageOverstayRecords).where(eq(storageOverstayRecords.storageBookingId, id));
      await shiftRows(tx, storageOverstayRecords, eq(storageOverstayRecords.storageBookingId, id), ms);
      if (records.length) await shiftRows(tx, storageOverstayHistory, inArray(storageOverstayHistory.overstayRecordId, records.map(record => record.id)), ms);
      // The holdover key carries the paid-through date (it matches the charges already settled for that end); earliest first so a new key never lands on an unmoved one.
      for (const record of records.sort((a, b) => a.key.localeCompare(b.key))) {
        const key = shiftDatesInText(record.key, days);
        if (key !== record.key) await tx.update(storageOverstayRecords).set({ idempotencyKey: key }).where(eq(storageOverstayRecords.id, record.id));
      }
      await shiftRows(tx, paymentTransactions, storagePayments(id), ms);
      await shiftRows(tx, damageClaims, eq(damageClaims.storageBookingId, id), ms);
      await shiftRows(tx, commitmentProblems, eq(commitmentProblems.storageBookingId, id), ms);
      await shiftRows(tx, bookingFlags, eq(bookingFlags.storageBookingId, id), ms);

      // Reminder intents move too. A reminder's key hashes the times it was planned for, so carry each unsent one to its moved key;
      // a fresh key whose time has just passed would count as a missed lead and never send.
      const targets = await reminderTargets(tx, id);
      await shiftRows(tx, emailLogs, reminderRows(targets), ms, { keep: ['retriedAt'], texts: ['textBody'] });
      for (const [source, target] of targets) {
        const current = await currentReminders(tx, source, target);
        for (const row of await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'advance_reminder'), like(emailLogs.trackingId, `advance:${source}:${target}:%`), inArray(emailLogs.status, ['scheduled', 'failed'])))) {
          const saved = JSON.parse(row.textBody || '{}') as { reminder?: { resource: string; kind: string; recipientId: number; due: string }; channel?: 'email' | 'notification' };
          const match = saved.reminder && saved.channel && current.find(reminder => reminder.resource === saved.reminder!.resource && reminder.kind === saved.reminder!.kind
            && reminder.recipientId === saved.reminder!.recipientId && Date.parse(reminder.due) === Date.parse(saved.reminder!.due));
          if (match && reminderKey(match, saved.channel!) !== row.trackingId)
            await tx.update(emailLogs).set({ trackingId: reminderKey(match, saved.channel!), textBody: JSON.stringify({ reminder: match, channel: saved.channel }) }).where(eq(emailLogs.id, row.id));
        }
        await scheduleAdvanceReminders(tx, source, target);
      }
      await recordJump(tx, { at: now.toISOString(), actorId, kind: 'storage', id, to: to.toISOString(), movedMs: ms, days });
    });
  } catch (error) {
    // The unit's exclusion constraint is the backstop for the check above (23P01 = exclusion_violation).
    if ((error as { code?: string; cause?: { code?: string } })?.code === '23P01' || (error as { cause?: { code?: string } })?.cause?.code === '23P01')
      throw new TestClockError(409, 'Moving this rental would put it on top of another rental of the same unit. Pick an earlier step.');
    throw error;
  }

  // The same idempotent per-item work the worker runs; each re-checks its own state under lock.
  const step = async (name: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { logger.error('[TestClock] Storage step failed; the worker retries it', { id, name, error }); }
  };
  // A request past its deadline expires here too (the sweep hands it to expireRental).
  await step('sweep', async () => (await import('./storage-rental-lifecycle')).sweepStorageRental(id, new Date()));
  const [current] = await db.select().from(storageBookings).where(eq(storageBookings.id, id)).limit(1);
  if (current.rentalState === 'move_out_requested' && current.checkoutStatus === 'checkout_requested' && current.checkoutRequestedAt) await step('move_out', async () => {
    const minutes = readVisitDuties(current.visitDuties)?.checkoutReviewWindowMinutes ?? (await (await import('./damage-claim-limits-service')).getStorageCheckoutSettings()).reviewWindowHours * 60;
    await (await import('./storage-checkout-service')).autoCleanExpiredCheckout(id, current.chefId, current.checkoutRequestedAt, minutes / 60, true);
  });
  await step('payout', async () => {
    const { releaseStorageTermPayout } = await import('./storage-payouts');
    // The worker's own pick: due, already decided, or cleared; the release re-checks holds and eligibility under lock.
    for (const row of await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(storagePayments(id), eq(paymentTransactions.payoutTiming, 'storage_term'),
      isNull(paymentTransactions.transferId), inArray(paymentTransactions.status, CAPTURED), sql`COALESCE(${paymentTransactions.metadata}->>'payoutNoEntitlement', 'false') <> 'true'`,
      sql`(${paymentTransactions.payoutEligibleAt} <= now() OR ${paymentTransactions.payoutReleasedAt} IS NOT NULL
        OR EXISTS (SELECT 1 FROM storage_bookings s WHERE s.id = ${paymentTransactions.bookingId} AND s.end_reason IN ('cleared', 'auto_cleared', 'claim')))`)))
      await releaseStorageTermPayout(row.id, 'storage_sweep');
  });
  const { dispatchAdvanceReminders } = await import('./advance-reminders');
  const targets = await reminderTargets(db, id);
  for (const row of await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderIntents(targets), eq(emailLogs.status, 'scheduled'),
    sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= now()`)))
    await step('reminder', () => dispatchAdvanceReminders({ onlyLogId: row.id, limit: 1 }));
  const { deliverOutcomeEmails } = await import('./outcome-delivery');
  for (const row of (await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.category, 'lifecycle_outcome'), mail, inArray(emailLogs.status, ['queued', 'failed'])))).slice(0, 10))
    await step('notices', () => deliverOutcomeEmails(1, 4_000, row.id));

  // One entry per notice (the chef, kitchen and admins each get a row): sent once every row went out.
  const queued = await db.select({ trackingId: emailLogs.trackingId, status: emailLogs.status }).from(emailLogs)
    .where(and(eq(emailLogs.category, 'lifecycle_outcome'), mail, sql`${emailLogs.id} > ${lastMail}`)).orderBy(emailLogs.id);
  const grouped = new Map<string, { kind: string; sent: boolean }>();
  for (const row of queued) {
    const key = row.trackingId!.replace(/:\d+$/, ''), saved = grouped.get(key);
    // Skipped on purpose (a test address, or email turned off) is done, not pending.
    grouped.set(key, { kind: key.split(':')[2], sent: (saved?.sent ?? true) && ['sent', 'skipped_policy', 'skipped_preference'].includes(row.status) });
  }
  const reminders = (await db.select({ id: emailLogs.id, textBody: emailLogs.textBody }).from(emailLogs).where(and(reminderIntents(targets), eq(emailLogs.status, 'sent'))))
    .filter(row => !sentBefore.has(row.id)).map(row => { const saved = JSON.parse(row.textBody || '{}'); return { kind: String(saved.reminder?.kind), role: String(saved.reminder?.role), channel: String(saved.channel) }; });
  logger.info('[TestClock] Storage rental moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, notices: Array.from(grouped.values()), reminders };
}
