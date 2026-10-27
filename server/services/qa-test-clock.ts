import { and, eq, getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { emailLogs, kitchenViewings, locations, tourDeliveryEvents, tourFeedbackResponses, tourVisitEvents } from '@shared/schema';
import { tourDueInstants } from '@shared/tour-timers';
import { tourRequestDecision, tourRequestEscalationKey } from '@shared/tour-request-decision';
import { tourReconfirmation } from '@shared/tour-reconfirmation';
import { tourFeedbackReminderMs } from '@shared/tour-feedback';
import { db } from '../db';
import { logger } from '../logger';

/**
 * QA test clock (dev only). Like a Stripe test clock, but scoped to ONE record because the dev database is shared:
 * "jumping" to a future step moves every saved instant of the record earlier by the gap, so the step is due now,
 * then runs the same idempotent handlers the timers and worker run. No business logic lives here.
 */
export class TestClockError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Never production: an explicit flag, a non-production deployment and lifecycle, and a test Stripe key. */
export function testClockEnabled(env: NodeJS.ProcessEnv = process.env) {
  const stripe = env.STRIPE_SECRET_KEY || '';
  return env.QA_TEST_CLOCK_ENABLED === 'true' && env.VERCEL_ENV !== 'production' && env.LIFECYCLE_ENVIRONMENT !== 'production'
    && (!stripe || /^(sk|rk)_test_/.test(stripe));
}

/** Lands just past the step so "now >= due" holds (same grace as the deadline timer). */
export const jumpGraceMs = 5_000;
export const jumpStepMs = 5 * 60_000;
export const maxJumpMs = 60 * 86_400_000;

const isoInstant = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})/g;
// Epoch milliseconds between 2017 and 2046: the only 13-digit numbers our event keys carry.
const epochMs = /\b(?:1[5-9]|2[0-4])\d{11}\b/g;
/** Moves every instant written inside a string. Keys also carry epoch ms (tour decision keys). */
export function shiftInstantsInText(text: string, ms: number, withEpoch = false) {
  const shifted = text.replace(isoInstant, value => new Date(Date.parse(value) - ms).toISOString());
  return withEpoch ? shifted.replace(epochMs, value => String(Number(value) - ms)) : shifted;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Columns are read from the schema, so a timestamp added later moves too. `keep` holds delivery mechanics (leases, retries). */
/** Booking JSON also carries local operating dates ("2026-10-30"); `dates` maps each old one to its moved date. */
export const remapDates = (text: string, dates?: Map<string, string>) => dates?.size ? text.replace(/"(\d{4}-\d{2}-\d{2})"/g, (whole, day) => dates.has(day) ? `"${dates.get(day)}"` : whole) : text;
export async function shiftRows(tx: Tx, table: PgTable, where: SQL, ms: number, { keep = [] as string[], keys = [] as string[], texts = [] as string[], dates = undefined as Map<string, string> | undefined } = {}) {
  const columns = Object.entries(getTableColumns(table)) as Array<[string, { name: string; columnType: string }]>;
  const moved = columns.filter(([key, column]) => ['PgTimestamp', 'PgTimestampString'].includes(column.columnType) && column.name !== 'updated_at' && !keep.includes(key));
  const sets = moved.map(([, column]) => sql`${sql.identifier(column.name)} = ${sql.identifier(column.name)} - make_interval(secs => ${ms / 1000})`);
  if (columns.some(([, column]) => column.name === 'updated_at')) sets.push(sql`updated_at = date_trunc('milliseconds', now())`);
  if (sets.length) await tx.execute(sql`UPDATE ${table} SET ${sql.join(sets, sql`, `)} WHERE ${where}`);
  const rewritten = columns.filter(([key, column]) => !keep.includes(key) && (column.columnType === 'PgJsonb' || keys.includes(key) || texts.includes(key)));
  if (!rewritten.length) return;
  const rows = await tx.select().from(table).where(where) as Array<Record<string, unknown>>;
  const idColumn = (getTableColumns(table) as Record<string, any>).id;
  for (const row of rows) {
    const changes: Record<string, unknown> = {};
    for (const [key, column] of rewritten) {
      const value = row[key];
      if (value == null) continue;
      const next = column.columnType === 'PgJsonb' ? JSON.parse(remapDates(shiftInstantsInText(JSON.stringify(value), ms), dates)) : shiftInstantsInText(String(value), ms, keys.includes(key));
      if (JSON.stringify(next) !== JSON.stringify(value)) changes[key] = next;
    }
    if (Object.keys(changes).length) await tx.update(table).set(changes).where(eq(idColumn, row.id));
  }
}

export type ClockStep = { key: string; label: string; at: string };

/** Every upcoming automatic step of a tour, labelled for QA. A test keeps it a superset of tourDueInstants. */
export function tourClockSteps(tour: Parameters<typeof tourDueInstants>[0] & { id: number; durationMinutes?: number | null; reconfirmationReply?: string | null; reconfirmationReplyRevision?: string | null; appointmentConfirmedAt?: Date | string | null; confirmedAt?: Date | string | null },
  managerId: number | null, reminderDues: string[], now = Date.now(), escalated = false): ClockStep[] {
  const start = new Date(tour.scheduledAt).getTime(), end = start + (tour.durationMinutes ?? 30) * 60_000, hour = 3_600_000;
  const steps: Array<{ key: string; label: string; at: number }> = [];
  const add = (key: string, label: string, at: number | string | null | undefined) => {
    const time = typeof at === 'string' ? Date.parse(at) : at ?? NaN;
    if (Number.isFinite(time)) steps.push({ key, label, at: time });
  };
  const pending = ['pending_local_cooks', 'pending'].includes(tour.status);
  const decision = tourRequestDecision(tour, now);
  // One escalation per decision (overdue or 6 h before, whichever comes first): once sent, neither step fires again.
  if (decision && !escalated && decision.stage !== 'chef_offer') add('answer_window', decision.stage === 'triage' ? 'Local Cooks review window (12 h) ends · overdue alert'
    : 'Kitchen answer window (12 h) ends · overdue alert', decision.dueAt);
  if (decision && !escalated) add('urgent', '6 h before the tour · urgent alert', start - 6 * hour);
  if (pending) add('expires', 'Tour time passes · unanswered request expires', start);
  if (tour.status === 'confirmed') {
    const state = tourReconfirmation(tour as Parameters<typeof tourReconfirmation>[0], managerId, now);
    add('still_coming', '24 h before · "Still coming?" check', start - 24 * hour);
    if (!state.reply) {
      add('no_reply_alert', 'No reply to "Still coming?" · staff alert', state.escalateAt);
      add('no_reply_reminder', 'No reply · reminder to the visitor', state.remindAt);
    }
    reminderDues.forEach((due, index) => add(`arrival_${index}`, 'Arrival reminder with instructions (both sides)', due));
    add('starts', 'Tour starts', start);
    add('ends', 'Tour ends · feedback opens for both sides', end);
    add('auto_close', '24 h after · closes on its own if no result was recorded', end + 24 * hour);
  }
  if (['confirmed', 'completed'].includes(tour.status)) add('feedback_reminder', 'Day 3 · feedback reminder', end + tourFeedbackReminderMs);
  const seen = new Set<string>();
  return steps.filter(step => step.at > now).sort((a, b) => a.at - b.at)
    .filter(step => !seen.has(`${step.key}:${step.at}`) && seen.add(`${step.key}:${step.at}`))
    .map(step => ({ key: step.key, label: step.label, at: new Date(step.at).toISOString() }));
}

async function tourRecord(id: number, reader: Pick<typeof db, 'select'> = db) {
  const [row] = await reader.select({ tour: kitchenViewings, managerId: locations.managerId }).from(kitchenViewings)
    .innerJoin(locations, eq(locations.id, kitchenViewings.locationId)).where(eq(kitchenViewings.id, id)).limit(1);
  if (!row) throw new TestClockError(404, 'Tour not found.');
  return row;
}
const tourReminderRows = (id: number) => and(eq(emailLogs.category, 'advance_reminder'), sql`${emailLogs.trackingId} LIKE ${`advance:tour:${id}:%`}`);

export async function readTourClock(id: number, now = new Date()) {
  const { tour, managerId } = await tourRecord(id);
  const reminders = await db.select({ due: sql<string>`${emailLogs.textBody}::jsonb->'reminder'->>'due'` }).from(emailLogs)
    .where(and(tourReminderRows(id), eq(emailLogs.status, 'scheduled')));
  const [escalation] = await db.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
    .where(eq(tourDeliveryEvents.eventKey, tourRequestEscalationKey(tour))).limit(1);
  return { kind: 'tour' as const, id, reference: `TOUR-${id}`, status: tour.status, scheduledAt: tour.scheduledAt.toISOString(),
    updatedAt: tour.updatedAt.toISOString(), now: now.toISOString(),
    steps: tourClockSteps(tour, managerId, Array.from(new Set(reminders.map(row => row.due).filter(Boolean))), now.getTime(), !!escalation) };
}

const logKey = 'qa_test_clock_log';
/** Who moved what, kept in the database (Vercel Hobby keeps runtime logs for an hour). Last 200 jumps. */
export async function recordJump(tx: Tx, entry: Record<string, unknown>) {
  const [saved] = await tx.execute(sql`SELECT value FROM platform_settings WHERE key = ${logKey} FOR UPDATE`).then(result => result.rows as Array<{ value: string }>);
  const log = [entry, ...(saved ? JSON.parse(saved.value) as unknown[] : [])].slice(0, 200);
  await tx.execute(sql`INSERT INTO platform_settings (key, value, description) VALUES (${logKey}, ${JSON.stringify(log)}, 'QA test clock jumps (dev only)')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
}

/** Walks a tour to `to` one step at a time, as real time would: an earlier step (24 h auto-close) runs before a later one
 * (day-3 reminder) and can cancel it. Stops early inside the Vercel time limit; jumping again continues. */
export async function jumpTour(id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [], reminders: Array<{ kind: string; role: string; channel: string }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await readTourClock(id);
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await jumpTourOnce(id, new Date(next ? Date.parse(next.at) : target), actorId, version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices); reminders.push(...result.reminders);
    if (!next) { reached = null; break; }
  }
  const clock = await readTourClock(id);
  return { movedMs, notices, reminders, clock, ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}

/** Moves one tour (and everything recorded against it) earlier so `to` is now, then runs what became due. */
async function jumpTourOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  // Whole 5-minute moves keep slot times readable (2:45 stays on a 5-minute mark); the step lands 5 s to 5 min after it is due.
  const ms = Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;
  if (!Number.isFinite(to.getTime()) || to.getTime() <= now.getTime() || to.getTime() - now.getTime() > maxJumpMs)
    throw new TestClockError(400, 'Pick a time in the next 60 days.');
  // The report reads what happened from the database: timers and after-response delivery can send before this request does.
  const [{ lastEvent }] = await db.select({ lastEvent: sql<number>`coalesce(max(${tourDeliveryEvents.id}), 0)::int` }).from(tourDeliveryEvents).where(eq(tourDeliveryEvents.viewingId, id));
  const sentBefore = new Set((await db.select({ id: emailLogs.id }).from(emailLogs).where(and(tourReminderRows(id), eq(emailLogs.status, 'sent')))).map(row => row.id));
  await db.transaction(async tx => {
    const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1).for('update');
    if (!tour) throw new TestClockError(404, 'Tour not found.');
    if (tour.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This tour changed. Refresh and try again.');
    // Visit events are immutable evidence matched to the tour's time; lift the guard for this transaction only (rolled back on failure).
    const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM tour_visit_events WHERE viewing_id = ${id}`)).rows as Array<{ count: number }>;
    if (count) await tx.execute(sql`ALTER TABLE tour_visit_events DISABLE TRIGGER tour_visit_events_immutable`);
    await shiftRows(tx, kitchenViewings, eq(kitchenViewings.id, id), ms, { keep: ['intakeData'] });
    if (count) {
      await shiftRows(tx, tourVisitEvents, eq(tourVisitEvents.viewingId, id), ms, { keys: ['eventKey'] });
      await tx.execute(sql`ALTER TABLE tour_visit_events ENABLE TRIGGER tour_visit_events_immutable`);
    }
    await shiftRows(tx, tourFeedbackResponses, eq(tourFeedbackResponses.viewingId, id), ms);
    await shiftRows(tx, tourDeliveryEvents, eq(tourDeliveryEvents.viewingId, id), ms, { keep: ['nextAttemptAt', 'leaseUntil'], keys: ['eventKey'] });
    await shiftRows(tx, emailLogs, sql`${emailLogs.trackingId} LIKE ${`advance:tour:${id}:%`}`, ms, { keep: ['retriedAt'], texts: ['textBody'] });
    // Re-plan reminders on the moved times (sent ones still acknowledge: their saved start/end moved with them).
    await (await import('./advance-reminders')).scheduleAdvanceReminders(tx, 'tour', id);
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'tour', id, to: to.toISOString(), movedMs: ms, table: getTableName(kitchenViewings) });
  });
  const { advanceTour } = await import('./tour-outcome-service');
  const advanced = await advanceTour(id);
  const { dispatchAdvanceReminders } = await import('./advance-reminders');
  const due = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(tourReminderRows(id), eq(emailLogs.status, 'scheduled'),
    sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= now()`));
  for (const row of due) await dispatchAdvanceReminders({ onlyLogId: row.id, limit: 1 });
  await (await import('./tour-delivery-service')).deliverTourEvents(id, 10, 12_000);
  const notices = (await db.select({ payload: tourDeliveryEvents.payload, completedAt: tourDeliveryEvents.completedAt }).from(tourDeliveryEvents)
    .where(and(eq(tourDeliveryEvents.viewingId, id), sql`${tourDeliveryEvents.id} > ${lastEvent}`)).orderBy(tourDeliveryEvents.id))
    .map(row => ({ kind: String((row.payload as { kind?: string })?.kind || 'update'), sent: !!row.completedAt }));
  const reminders = (await db.select({ id: emailLogs.id, textBody: emailLogs.textBody }).from(emailLogs).where(and(tourReminderRows(id), eq(emailLogs.status, 'sent'))))
    .filter(row => !sentBefore.has(row.id)).map(row => { const saved = JSON.parse(row.textBody || '{}'); return { kind: String(saved.reminder?.kind), role: String(saved.reminder?.role), channel: String(saved.channel) }; });
  logger.info('[TestClock] Tour moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, changed: advanced.changed, notices, reminders };
}
