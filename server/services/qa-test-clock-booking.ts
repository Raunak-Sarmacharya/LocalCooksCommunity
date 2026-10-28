import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingFlags, bookingLifecycleEvents, commitmentProblems, damageClaims, emailLogs, equipmentBookings, kitchenBookingAttendanceEvents,
  kitchenBookingChanges, kitchenBookingDayAllocations, kitchenBookingDayPayouts, kitchenBookingExtensions, kitchenBookings, kitchenBookingVisits,
  kitchenCheckoutHolds, kitchens, kitchenVisitArrivalChallenges, locations, paymentTransactions,
} from '@shared/schema';
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { calendarDateForBookingTime, type OperatingSlot } from '@shared/operating-hours';
import { savedCloseout, makeCloseoutSnapshot, reduceClockCloseout, visitClockKey, type CloseoutSnapshot } from '@shared/clock-closeout';
import { feedbackReminderMs } from '@shared/booking-feedback';
import { db } from '../db';
import { logger } from '../logger';
import { type ClockStep, jumpGraceMs, jumpStepMs, maxJumpMs, recordJump, remapDates, shiftInstantsInText, shiftRows, TestClockError, type Tx } from './qa-test-clock';

type Booking = typeof kitchenBookings.$inferSelect;
type Visit = typeof kitchenBookingVisits.$inferSelect;
const hour = 3_600_000;
const reminderSources = ['booking', 'booking_review', 'cancellation_review', 'manager_decision'] as const;
const reminderRows = (id: number) => sql`(${sql.join(reminderSources.map(source => sql`${emailLogs.trackingId} LIKE ${`advance:${source}:${id}:%`}`), sql` OR `)})`;
// The reminder records themselves. Send attempts share their tracking id but keep the email's text, not reminder JSON.
const reminderIntents = (id: number) => and(eq(emailLogs.category, 'advance_reminder'), reminderRows(id))!;

const localParts = (instant: number, timezone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

/**
 * One operating day moved `ms` earlier in its own time zone. Times are resolved the way the app reads them (after midnight
 * belongs to the next calendar day within the operating window, or after `refStart` for legacy rows without a window), moved
 * as instants, and written back as local times, so overnight order and the Nov 1 clock change come out right.
 * shortcut: a time landing in the repeated fall-back hour (1:00-2:00 a.m. Nov 1) may resolve one hour off; no slot starts then today.
 */
export function shiftLocalDay(date: string, windowStart: string | null | undefined, refStart: string, times: string[], timezone: string, ms: number) {
  const instant = (time: string) => createBookingDateTime(windowStart ? calendarDateForBookingTime(date, time, windowStart)
    : time === refStart ? date : calendarDateForBookingTime(date, time, null, refStart), time, timezone).getTime() - ms;
  const anchor = localParts(instant(windowStart || refStart), timezone);
  return { date: anchor.date, windowStart: windowStart ? anchor.time : windowStart ?? null, times: times.map(time => localParts(instant(time), timezone).time) };
}

type Slot = OperatingSlot & Record<string, unknown>;
/** Moves slots that may carry their own operating `date` and `windowStartTime` (multi-day); records old→new dates. */
function shiftSlots(slots: unknown, fallbackDate: string, fallbackWindow: string | null, refStart: string, timezone: string, ms: number, dates: Map<string, string>) {
  if (!Array.isArray(slots)) return slots;
  return (slots as Slot[]).map(slot => {
    const day = slot.date ? String(slot.date).slice(0, 10) : fallbackDate;
    const moved = shiftLocalDay(day, slot.windowStartTime ?? fallbackWindow, refStart, [slot.startTime, slot.endTime], timezone, ms);
    dates.set(day, moved.date);
    return { ...slot, startTime: moved.times[0], endTime: moved.times[1], ...(slot.date ? { date: moved.date } : {}),
      ...(slot.windowStartTime ? { windowStartTime: moved.windowStart } : {}) };
  });
}

/** A change's original/destination: `{ date, slots, windowStart, days?: [...] }`. */
function shiftSchedule(value: any, timezone: string, ms: number, dates: Map<string, string>): any {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  if (typeof value.date === 'string' && Array.isArray(value.slots) && value.slots.length) {
    const ref = value.slots[0].startTime;
    const moved = shiftLocalDay(value.date, value.windowStart, ref, [], timezone, ms);
    next.slots = shiftSlots(value.slots, value.date, value.windowStart ?? null, ref, timezone, ms, dates);
    dates.set(value.date, moved.date); next.date = moved.date;
    if (value.windowStart) next.windowStart = moved.windowStart;
  }
  if (Array.isArray(value.days)) next.days = value.days.map((day: any) => shiftSchedule(day, timezone, ms, dates));
  return next;
}

/** The saved clock's visits move as local days too; their keys (date|hours|block) are remapped wherever they appear. */
function shiftCloseout(saved: CloseoutSnapshot, ms: number, keys: Map<string, string>, dates: Map<string, string>) {
  const visits = saved.visits.map((visit, position) => {
    // Saved instants are the truth here; local fields are rewritten from them. An overnight visit keeps its operating day one before.
    const start = Date.parse(visit.scheduledStartAt) - ms, end = Date.parse(visit.scheduledEndAt) - ms;
    const local = localParts(start, saved.timezone), oldLocal = visit.localDate || localParts(Date.parse(visit.scheduledStartAt), saved.timezone).date;
    // The operating day follows the window start, exactly as the slots and visit rows were just moved, so rows still match.
    const operatingDate = visit.operatingDate && (dates.get(visit.operatingDate)
      ?? new Date(Date.parse(`${local.date}T00:00:00Z`) + Date.parse(`${visit.operatingDate}T00:00:00Z`) - Date.parse(`${oldLocal}T00:00:00Z`)).toISOString().slice(0, 10));
    if (!dates.has(oldLocal)) dates.set(oldLocal, local.date);
    if (visit.operatingDate) dates.set(visit.operatingDate, operatingDate!);
    const endTime = localParts(end, saved.timezone).time;
    const key = visitClockKey(local.date, local.time, endTime, visit.blockIndex ?? position);
    keys.set(visit.key, key);
    return { ...visit, key, startTime: local.time, endTime, ...(visit.localDate ? { localDate: local.date } : {}),
      ...(operatingDate ? { operatingDate } : {}), scheduledStartAt: new Date(start).toISOString(), scheduledEndAt: new Date(end).toISOString() };
  });
  const rekey = <T,>(record?: Record<string, T>) => record && Object.fromEntries(Object.entries(record).map(([key, value]) => [keys.get(key) ?? key, value]));
  const instants = JSON.parse(shiftInstantsInText(JSON.stringify({ serviceEndedAt: saved.serviceEndedAt, nextDueAt: saved.nextDueAt, inspections: saved.inspections }), ms));
  return { ...saved, visits, visitPhases: rekey(saved.visitPhases), ...instants, inspections: rekey(instants.inspections) };
}
const replaceKeys = (text: string, keys: Map<string, string>) => Array.from(keys).reduce((out, [from, to]) => out.split(from).join(to), text);

async function bookingRecord(id: number, reader: Pick<typeof db, 'select'> = db) {
  const [row] = await reader.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, id)).limit(1);
  if (!row) throw new TestClockError(404, 'Booking not found.');
  const visits = await reader.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, id)).orderBy(kitchenBookingVisits.blockIndex);
  return { ...row, timezone: row.timezone || DEFAULT_TIMEZONE, visits };
}

const reminderLabels: Record<string, string> = { preparation: 'Prep reminder (48 h before)', arrival: 'Arrival reminder', checkin_open: 'Check-in opens (in-app reminder)',
  session_ending: 'Session ending reminder', manager_decision: 'Reminder to the kitchen to answer', manager_no_checkin: 'No check-in yet · kitchen alerted',
  deadline: 'Review reminder' };
const live = (status: string) => ['confirmed', 'cancellation_requested', 'completed'].includes(status);

/** Every upcoming automatic step of one booking, labelled for QA. A test keeps it a superset of what the timers and sweeps use. */
export async function readBookingClock(id: number, now = new Date()) {
  const { booking, timezone, locationId, visits } = await bookingRecord(id);
  const steps: Array<{ key: string; label: string; at: number }> = [];
  const add = (key: string, label: string, at: string | number | Date | null | undefined) => {
    const time = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at ?? NaN;
    if (Number.isFinite(time) && time > now.getTime()) steps.push({ key, label, at: time });
  };
  const multi = booking.scheduleRevision > 0;
  if (booking.status === 'pending' && booking.paymentStatus === 'authorized') {
    const partial = booking.partialAcceptance as { deadlineAt?: string; answeredAt?: string } | null;
    if (partial?.deadlineAt && !partial.answeredAt) add('partial_deadline', "Customer's answer to the partial acceptance · request expires", partial.deadlineAt);
    else add('response_deadline', 'Kitchen answer deadline · unanswered request expires (card hold released)',
      await (await import('./booking-response-deadline')).getBookingResponseDeadline(booking));
  }
  const { currentReminders } = await import('./advance-reminders');
  // checkin_open is the same moment as the clock's own check-in step below.
  for (const source of reminderSources) for (const reminder of (await currentReminders(db as never, source, id, undefined, now).catch(() => [])).filter(r => r.kind !== 'checkin_open'))
    add(`${source}:${reminder.kind}`, source === 'cancellation_review' ? 'Cancellation review reminder (kitchen)' : source === 'booking_review' ? 'Inspection reminder (kitchen)'
      : reminderLabels[reminder.kind] || reminder.kind, reminder.due);
  const snapshot = booking.cancellationPolicySnapshot as { noticeHours?: number; sessions?: Array<{ startAt: string }> } | null;
  const first = snapshot?.sessions?.reduce((min, session) => Math.min(min, Date.parse(session.startAt)), Infinity);
  if (['pending', 'confirmed'].includes(booking.status) && first && Number.isFinite(first) && snapshot?.noticeHours != null)
    add('free_cancellation', 'Free cancellation ends (no automatic action: test a late cancellation after this)', first - snapshot.noticeHours * hour);
  if (live(booking.status) || booking.status === 'pending') {
    const { closeoutTiming } = await import('./clock-closeout');
    const timing = await closeoutTiming(locationId);
    const saved = savedCloseout(booking.visitDuties) || makeCloseoutSnapshot(booking, timezone, timing, visits);
    const settings = await (await import('./lifecycle-settings')).getLifecycleSettings();
    const release = (await import('./visit-duties')).bookingInstructionRelease(booking, timezone, visits, settings.preparationReminderHours, saved.checkinWindowMinutesBefore, now);
    if (booking.status !== 'pending') add('instructions', 'Arrival instructions released to the customer', release.instructionsReleaseAt || null);
    if (live(booking.status)) for (const [index, visit] of Array.from(reduceClockCloseout(booking, visits, saved, now).visits.entries())) {
      const day = saved.visits.length > 1 ? `Day ${index + 1} · ` : '';
      const start = Date.parse(visit.scheduledStartAt), end = Date.parse(visit.scheduledEndAt);
      add(`checkin_${index}`, `${day}Check-in opens`, start - saved.checkinWindowMinutesBefore * 60_000);
      add(`start_${index}`, `${day}Booked time starts`, start);
      add(`end_${index}`, `${day}Booked time ends`, end);
      add(`service_end_${index}`, `${day}Grace period over${index === saved.visits.length - 1 ? ' · booking completes' : ''}`, end + saved.serviceEndGraceMinutes * 60_000);
      add(`inspection_due_${index}`, `${day}Kitchen inspection opens`, visit.inspection.dueAt);
      add(`inspection_close_${index}`, `${day}Inspection closes on its own if nothing is reported`, visit.inspection.deadline);
    }
  }
  const sources = await db.select({ eligible: paymentTransactions.payoutEligibleAt }).from(paymentTransactions)
    .where(and(eq(paymentTransactions.bookingId, id), inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), isNull(paymentTransactions.transferId), isNull(paymentTransactions.payoutReleasedAt)));
  for (const source of sources) add('payout', 'Payout released to the kitchen (Stripe sandbox transfer)', source.eligible);
  if (multi) for (const payout of await db.select({ eligible: kitchenBookingDayPayouts.eligibleAt }).from(kitchenBookingDayPayouts)
    .innerJoin(kitchenBookingVisits, eq(kitchenBookingVisits.id, kitchenBookingDayPayouts.visitId))
    .where(and(eq(kitchenBookingVisits.bookingId, id), isNull(kitchenBookingDayPayouts.releasedAt)))) add('day_payout', 'Day payout released to the kitchen', payout.eligible);
  if (booking.status === 'completed' && booking.feedbackRequestedAt && !booking.feedbackRemindedAt)
    add('feedback_reminder', 'Day 3 · feedback reminder', booking.feedbackRequestedAt.getTime() + feedbackReminderMs);
  for (const change of await db.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, id),
    inArray(kitchenBookingChanges.state, ['requested', 'payment_pending', 'awaiting_payment'])))) {
    add('change_decision', 'Time change: kitchen answer deadline', change.state === 'requested' ? change.decisionBy : null);
    add('change_payment', 'Time change: payment deadline', change.paymentBy);
  }
  for (const extension of await db.select({ expiresAt: kitchenBookingExtensions.expiresAt, kind: kitchenBookingExtensions.kind }).from(kitchenBookingExtensions)
    .where(and(eq(kitchenBookingExtensions.bookingId, id), inArray(kitchenBookingExtensions.status, ['requested', 'offered']))))
    add('extension', extension.kind === 'extra_time' ? 'Extra time charge: answer deadline' : 'Extra time request expires', extension.expiresAt);
  const seen = new Set<string>();
  return { kind: 'booking' as const, id, reference: booking.referenceCode || `#${id}`, status: booking.status, multiDay: multi,
    scheduledAt: (savedCloseout(booking.visitDuties)?.visits[0]?.scheduledStartAt) ?? null, updatedAt: booking.updatedAt.toISOString(), now: now.toISOString(),
    steps: steps.sort((a, b) => a.at - b.at).filter(step => !seen.has(`${step.label}:${step.at}`) && seen.add(`${step.label}:${step.at}`))
      .map(step => ({ key: step.key, label: step.label, at: new Date(step.at).toISOString() })) as ClockStep[] };
}

/** Narrow: a card operation the payment code is still finishing. Jumping mid-flight would race it. */
async function moneyInFlight(tx: Tx, booking: Booking) {
  if ((booking.paymentDecision as { state?: string } | null)?.state === 'pending') return 'A payment decision on this booking is still finishing. Try again in a minute.';
  const changes = await tx.select({ policy: kitchenBookingChanges.policy }).from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, booking.id));
  if (changes.some(change => (change.policy as { operation?: { state?: string } | null })?.operation?.state === 'pending')) return 'A time-change payment on this booking is still finishing. Try again in a minute.';
  const extensions = await tx.select({ operation: kitchenBookingExtensions.operation }).from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, booking.id));
  if (extensions.some(extension => extension.operation?.state === 'pending')) return 'An extra-time payment on this booking is still finishing. Try again in a minute.';
  return null;
}

/** Walks a booking to `to` one step at a time, like jumpTour. */
export async function jumpBooking(id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [], reminders: Array<{ kind: string; role: string; channel: string }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await readBookingClock(id);
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await jumpBookingOnce(id, new Date(next ? Date.parse(next.at) : target), actorId, version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices); reminders.push(...result.reminders);
    if (!next) { reached = null; break; }
  }
  return { movedMs, notices, reminders, clock: await readBookingClock(id), ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}

/** Moves one booking and everything recorded against it `ms` earlier, then runs what became due for this booking only. */
async function jumpBookingOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const ms = Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;
  const [{ lastEvent }] = await db.select({ lastEvent: sql<number>`coalesce(max(${bookingLifecycleEvents.id}), 0)::int` }).from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, id));
  const sentBefore = new Set((await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderRows(id), eq(emailLogs.status, 'sent')))).map(row => row.id));
  const kitchenChange = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${id} FOR UPDATE`);
    const { booking, timezone, visits } = await bookingRecord(id, tx);
    if (booking.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This booking changed. Refresh and try again.');
    const busy = await moneyInFlight(tx, booking);
    if (busy) throw new TestClockError(409, busy);
    // Reminders exist before their time in real life; plan them now so the move carries them instead of inventing late ones.
    const { scheduleAdvanceReminders, currentReminders, reminderKey } = await import('./advance-reminders');
    for (const source of reminderSources) await scheduleAdvanceReminders(tx, source, id, undefined, now);
    const response = booking.status === 'pending' && booking.paymentStatus === 'authorized'
      ? await (await import('./booking-response-deadline')).getBookingResponseDeadline(booking, tx, timezone) : null;
    // The paid multi-day quote is locked to its original dates, so a moved request could no longer be accepted.
    if (booking.scheduleRevision > 0 && response && now.getTime() + ms < response.getTime())
      throw new TestClockError(409, "Accept or decline this multi-day request first: its paid quote is locked to the original dates. To test it going unanswered, jump to the answer deadline.");

    const dates = new Map<string, string>(), keys = new Map<string, string>();
    const bookingDay = booking.bookingDate.toISOString().slice(0, 10);
    const day = shiftLocalDay(bookingDay, booking.operatingWindowStartTime, booking.startTime,
      [booking.startTime, booking.endTime, ...(booking.actualStartTime ? [booking.actualStartTime] : []), ...(booking.actualEndTime ? [booking.actualEndTime] : [])], timezone, ms);
    dates.set(bookingDay, day.date);
    const slots = shiftSlots(booking.selectedSlots, bookingDay, booking.operatingWindowStartTime, booking.startTime, timezone, ms, dates);
    const saved = savedCloseout(booking.visitDuties);
    const duties = saved ? { ...(booking.visitDuties as object), clockCloseout: shiftCloseout(saved, ms, keys, dates) } : booking.visitDuties;
    const snapshot = booking.cancellationPolicySnapshot as { sessions?: unknown } | null;

    // Same lock order as checkout, over the old and new days; refuse a move onto another booking or hold.
    const movedDays = new Map<string, OperatingSlot[]>();
    for (const slot of (Array.isArray(slots) && slots.length ? slots : [{ startTime: day.times[0], endTime: day.times[1] }]) as Slot[]) {
      const key = String(slot.date ?? day.date);
      movedDays.set(key, [...movedDays.get(key) ?? [], slot]);
    }
    const { lockKitchenInventory, hasInventoryConflict } = await import('./kitchen-checkout-holds');
    await lockKitchenInventory(tx, booking.kitchenId, Array.from(dates.keys()).concat(Array.from(dates.values())));
    // Only days from today on can take availability from someone; a day moved into the past can sit beside old bookings.
    const today = localParts(Date.now(), timezone).date;
    // The booking's own holds (an open time change, a pending extra-time request) move with it, so they never block it (QA walk Oct 28).
    const ownHolds = [...(await tx.select({ holdId: kitchenBookingChanges.holdId }).from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, id))).map(row => row.holdId),
      ...(await tx.select({ id: kitchenBookingExtensions.id, holdId: kitchenBookingExtensions.holdId }).from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, id)))
        .map(row => row.holdId || `session-extension:${row.id}`)].filter((hold): hold is string => !!hold);
    if (['pending', 'confirmed', 'cancellation_requested'].includes(booking.status)) for (const [date, daySlots] of Array.from(movedDays).filter(([date]) => date >= today))
      if (await hasInventoryConflict(booking.kitchenId, date, daySlots, String((daySlots[0] as Slot).windowStartTime ?? day.windowStart ?? '00:00'),
        ownHolds, id, tx, booking.bufferMinutesSnapshot))
        throw new TestClockError(409, `Moving this booking would put it on top of another booking in this kitchen on ${date}. Pick an earlier step, or a booking with a free day before it.`);

    await shiftRows(tx, kitchenBookings, eq(kitchenBookings.id, id), ms,
      { keep: ['bookingDate', 'selectedSlots', 'visitDuties', 'cancellationPolicySnapshot', 'bookingRuleOverrides', 'storageItems', 'equipmentItems'], dates });
    await tx.update(kitchenBookings).set({ bookingDate: new Date(`${day.date}${booking.bookingDate.toISOString().slice(10)}`),
      startTime: day.times[0], endTime: day.times[1], operatingWindowStartTime: day.windowStart, selectedSlots: slots, visitDuties: duties,
      ...(booking.actualStartTime ? { actualStartTime: day.times[2] } : {}), ...(booking.actualEndTime ? { actualEndTime: day.times[booking.actualStartTime ? 3 : 2] } : {}),
      // The accepted policy terms are immutable (trigger); only the session times they are measured from may move.
      ...(snapshot?.sessions ? { cancellationPolicySnapshot: { ...snapshot, sessions: JSON.parse(shiftInstantsInText(JSON.stringify(snapshot.sessions), ms)) } } : {}),
    }).where(eq(kitchenBookings.id, id));

    // Earliest day first: when moving earlier, each row's new date is free before the next row takes the old one.
    for (const visit of [...visits].sort((a, b) => String(a.visitDate ?? '').localeCompare(String(b.visitDate ?? '')) || a.blockIndex - b.blockIndex)) {
      const visitDay = visit.visitDate ? String(visit.visitDate).slice(0, 10) : bookingDay;
      const ref = visit.visitDate ? visit.startTime : booking.startTime, window = visit.operatingWindowStartTime ?? booking.operatingWindowStartTime;
      const moved = shiftLocalDay(visitDay, window, ref, [visit.startTime, visit.endTime, ...[visit.actualStartTime, visit.actualEndTime].filter((t): t is string => !!t)], timezone, ms);
      dates.set(visitDay, moved.date);
      await shiftRows(tx, kitchenBookingVisits, eq(kitchenBookingVisits.id, visit.id), ms, { keep: ['selectedSlots'], dates });
      await tx.update(kitchenBookingVisits).set({ startTime: moved.times[0], endTime: moved.times[1], operatingWindowStartTime: visit.operatingWindowStartTime ? moved.windowStart : null,
        ...(visit.visitDate ? { visitDate: moved.date } : {}), selectedSlots: shiftSlots(visit.selectedSlots, visitDay, window, ref, timezone, ms, new Map()),
        ...(visit.actualStartTime ? { actualStartTime: moved.times[2] } : {}), ...(visit.actualEndTime ? { actualEndTime: moved.times[visit.actualStartTime ? 3 : 2] } : {}),
      }).where(eq(kitchenBookingVisits.id, visit.id));
    }
    const visitIds = visits.map(visit => visit.id);
    if (visitIds.length) {
      await shiftRows(tx, kitchenBookingDayPayouts, inArray(kitchenBookingDayPayouts.visitId, visitIds), ms, { dates });
      await shiftRows(tx, kitchenBookingDayAllocations, inArray(kitchenBookingDayAllocations.visitId, visitIds), ms, { dates });
    }
    const changes = await tx.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, id));
    for (const change of changes) {
      await shiftRows(tx, kitchenBookingChanges, eq(kitchenBookingChanges.id, change.id), ms, { keep: ['original', 'destination'], dates });
      await tx.update(kitchenBookingChanges).set({ original: shiftSchedule(change.original, timezone, ms, dates), destination: shiftSchedule(change.destination, timezone, ms, dates) })
        .where(eq(kitchenBookingChanges.id, change.id));
      if (change.holdId) for (const hold of await tx.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, change.holdId))) {
        const moved = shiftLocalDay(hold.operatingDate, hold.windowStartTime, (hold.selectedSlots as Slot[])?.[0]?.startTime ?? hold.windowStartTime, [], timezone, ms);
        await shiftRows(tx, kitchenCheckoutHolds, eq(kitchenCheckoutHolds.id, hold.id), ms, { keep: ['selectedSlots', 'quoteSnapshot'] });
        await tx.update(kitchenCheckoutHolds).set({ operatingDate: moved.date, windowStartTime: moved.windowStart ?? hold.windowStartTime,
          selectedSlots: shiftSlots(hold.selectedSlots, hold.operatingDate, hold.windowStartTime, hold.windowStartTime, timezone, ms, new Map()) }).where(eq(kitchenCheckoutHolds.id, hold.id));
      }
    }
    await shiftRows(tx, kitchenBookingExtensions, eq(kitchenBookingExtensions.bookingId, id), ms, { dates });
    for (const extension of await tx.select({ id: kitchenBookingExtensions.id, holdId: kitchenBookingExtensions.holdId }).from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, id)))
      for (const hold of await tx.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, extension.holdId || `session-extension:${extension.id}`))) {
        const moved = shiftLocalDay(hold.operatingDate, hold.windowStartTime, (hold.selectedSlots as Slot[])?.[0]?.startTime ?? hold.windowStartTime, [], timezone, ms);
        await shiftRows(tx, kitchenCheckoutHolds, eq(kitchenCheckoutHolds.id, hold.id), ms, { keep: ['selectedSlots', 'quoteSnapshot'] });
        await tx.update(kitchenCheckoutHolds).set({ operatingDate: moved.date, windowStartTime: moved.windowStart ?? hold.windowStartTime,
          selectedSlots: shiftSlots(hold.selectedSlots, hold.operatingDate, hold.windowStartTime, hold.windowStartTime, timezone, ms, new Map()) }).where(eq(kitchenCheckoutHolds.id, hold.id));
      }
    for (const extension of await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, id)))
      await tx.update(kitchenBookingExtensions).set({ originalEndTime: localParts(extension.originalEndAt.getTime(), timezone).time, endTime: localParts(extension.endAt.getTime(), timezone).time })
        .where(eq(kitchenBookingExtensions.id, extension.id));
    await shiftRows(tx, kitchenVisitArrivalChallenges, eq(kitchenVisitArrivalChallenges.bookingId, id), ms, { dates });
    await shiftRows(tx, kitchenBookingAttendanceEvents, eq(kitchenBookingAttendanceEvents.bookingId, id), ms, { dates });
    // Lifecycle metadata also carries saved visit keys; leases and retry times are delivery mechanics and stay.
    await shiftRows(tx, bookingLifecycleEvents, eq(bookingLifecycleEvents.bookingId, id), ms, { keep: ['leaseUntil', 'nextAttemptAt'], dates });
    if (keys.size) for (const event of await tx.select({ id: bookingLifecycleEvents.id, metadata: bookingLifecycleEvents.metadata }).from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, id))) {
      const text = JSON.stringify(event.metadata), next = replaceKeys(text, keys);
      if (next !== text) await tx.update(bookingLifecycleEvents).set({ metadata: JSON.parse(next) }).where(eq(bookingLifecycleEvents.id, event.id));
    }
    // The dated quote is hash-locked and stays as quoted; the rest of the payment record moves.
    const payments = and(eq(paymentTransactions.bookingId, id), inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']))!;
    await shiftRows(tx, paymentTransactions, payments, ms, { keep: ['metadata'] });
    for (const payment of await tx.select({ id: paymentTransactions.id, metadata: paymentTransactions.metadata }).from(paymentTransactions).where(payments)) {
      const { datedQuote, ...rest } = (payment.metadata ?? {}) as Record<string, unknown>;
      const moved = JSON.parse(remapDates(shiftInstantsInText(JSON.stringify(rest), ms), dates));
      await tx.update(paymentTransactions).set({ metadata: datedQuote === undefined ? moved : { ...moved, datedQuote } }).where(eq(paymentTransactions.id, payment.id));
    }
    await shiftRows(tx, equipmentBookings, eq(equipmentBookings.kitchenBookingId, id), ms, { dates });
    await shiftRows(tx, damageClaims, eq(damageClaims.kitchenBookingId, id), ms, { dates });
    await shiftRows(tx, commitmentProblems, eq(commitmentProblems.bookingId, id), ms, { dates });
    await shiftRows(tx, bookingFlags, eq(bookingFlags.bookingId, id), ms, { dates });
    // Reminder intents: their saved start/end move so sent ones still acknowledge the same visit after the re-plan.
    await shiftRows(tx, emailLogs, reminderRows(id), ms, { keep: ['retriedAt'], texts: ['textBody'] });
    // A reminder's key hashes the times it was planned for. Carry each unsent one to its moved key, so the re-plan keeps it
    // (a fresh key whose time has just passed would count as a missed lead and never send).
    for (const source of reminderSources) {
      const current = await currentReminders(tx, source, id);
      for (const row of await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'advance_reminder'), sql`${emailLogs.trackingId} LIKE ${`advance:${source}:${id}:%`}`, inArray(emailLogs.status, ['scheduled', 'failed'])))) {
        // Same reminder = same visit, kind, person and (already moved) due time; the 12 h and 2 h kitchen reminders share a kind.
        const saved = JSON.parse(row.textBody || '{}') as { reminder?: { resource: string; kind: string; recipientId: number; due: string }; channel?: 'email' | 'notification' };
        const resource = saved.reminder && replaceKeys(saved.reminder.resource, keys);
        const match = saved.reminder && saved.channel && current.find(reminder => reminder.resource === resource && reminder.kind === saved.reminder!.kind
          && reminder.recipientId === saved.reminder!.recipientId && Date.parse(reminder.due) === Date.parse(saved.reminder!.due));
        if (match && reminderKey(match, saved.channel!) !== row.trackingId)
          await tx.update(emailLogs).set({ trackingId: reminderKey(match, saved.channel!), textBody: JSON.stringify({ reminder: match, channel: saved.channel }) }).where(eq(emailLogs.id, row.id));
      }
      await scheduleAdvanceReminders(tx, source, id);
    }
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'booking', id, to: to.toISOString(), movedMs: ms });
    return changes.some(change => ['requested', 'payment_pending', 'awaiting_payment'].includes(change.state));
  });

  // The same idempotent per-item work the exact timers run; each re-checks its own state under lock.
  const { runDeadlineExpiry } = await import('./deadline-timer');
  const step = async (name: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { logger.error('[TestClock] Booking step failed; the worker retries it', { id, name, error }); }
  };
  const [current] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
  if (current.status === 'pending') await step('booking_request', () => runDeadlineExpiry('booking_request', id));
  await step('closeout', () => runDeadlineExpiry('closeout', id));
  if (kitchenChange) await step('kitchen_change', () => runDeadlineExpiry('kitchen_change', id));
  for (const extension of await db.select({ id: kitchenBookingExtensions.id }).from(kitchenBookingExtensions)
    .where(and(eq(kitchenBookingExtensions.bookingId, id), inArray(kitchenBookingExtensions.status, ['requested', 'offered']))))
    await step('extension', () => runDeadlineExpiry('extension', extension.id));
  await step('payout', async () => {
    const payouts = await import('./kitchen-payout-service');
    const due = await db.select({ id: paymentTransactions.id, extensionId: sql<string | null>`${paymentTransactions.metadata}->>'sessionExtensionId'` }).from(paymentTransactions)
      .where(and(eq(paymentTransactions.bookingId, id), inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.payoutTiming, 'after_closeout'),
        isNull(paymentTransactions.transferId), sql`${paymentTransactions.payoutEligibleAt} <= now()`));
    if (due.some(row => !row.extensionId)) await payouts.releaseKitchenPayout(id, 'closeout_sweep');
    for (const row of due.filter(row => row.extensionId)) await (await import('./session-extension-payout')).releaseSessionExtensionPayoutForSource(row.id);
    // Multi-day bookings pay per day; each installment re-checks its own eligibility under lock before any transfer.
    const [dayDue] = await db.select({ id: kitchenBookingDayPayouts.id }).from(kitchenBookingDayPayouts)
      .innerJoin(kitchenBookingVisits, eq(kitchenBookingVisits.id, kitchenBookingDayPayouts.visitId))
      .where(and(eq(kitchenBookingVisits.bookingId, id), isNull(kitchenBookingDayPayouts.releasedAt), isNull(kitchenBookingDayPayouts.transferId),
        sql`${kitchenBookingDayPayouts.eligibleAt} <= now()`)).limit(1);
    if (dayDue) await (await import('./kitchen-day-payouts')).releaseBookingDayPayouts(id);
    await payouts.flushReleasedPayoutNotices(id);
  });
  await step('feedback', async () => (await import('./booking-feedback-service')).remindBookingFeedback(id));
  const { dispatchAdvanceReminders } = await import('./advance-reminders');
  for (const row of await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderIntents(id), eq(emailLogs.status, 'scheduled'),
    sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= now()`)))
    await step('reminder', () => dispatchAdvanceReminders({ onlyLogId: row.id, limit: 1 }));
  await step('notices', async () => (await import('./booking-lifecycle-delivery')).deliverBookingLifecycleEvents(10, 12_000, id));

  const notices = (await db.select({ kind: bookingLifecycleEvents.kind, completedAt: bookingLifecycleEvents.completedAt }).from(bookingLifecycleEvents)
    .where(and(eq(bookingLifecycleEvents.bookingId, id), sql`${bookingLifecycleEvents.id} > ${lastEvent}`)).orderBy(bookingLifecycleEvents.id))
    .map(row => ({ kind: row.kind, sent: !!row.completedAt }));
  const reminders = (await db.select({ id: emailLogs.id, textBody: emailLogs.textBody }).from(emailLogs).where(and(reminderIntents(id), eq(emailLogs.status, 'sent'))))
    .filter(row => !sentBefore.has(row.id)).map(row => { const saved = JSON.parse(row.textBody || '{}'); return { kind: String(saved.reminder?.kind), role: String(saved.reminder?.role), channel: String(saved.channel) }; });
  logger.info('[TestClock] Booking moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, notices, reminders };
}
