import { and, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { damageClaimHistory, damageClaims, damageEvidence, emailLogs } from '@shared/schema';
import { CLAIM_BOOKING_HOLD_MS, claimBookingHeld } from '@shared/damage-claims';
import { db } from '../db';
import { logger } from '../logger';
import { type ClockStep, jumpGraceMs, jumpStepMs, maxJumpMs, recordJump, shiftRows, TestClockError } from './qa-test-clock';

const reminderRows = (id: number) => like(emailLogs.trackingId, `advance:claim:${id}:%`);
// The reminder records themselves. Send attempts share their tracking id but keep the email's text, not reminder JSON.
const reminderIntents = (id: number) => and(eq(emailLogs.category, 'advance_reminder'), reminderRows(id))!;
const waitingOnPeople = ['in_review', 'awaiting_kitchen', 'under_review'];

async function claimRecord(id: number) {
  const [claim] = await db.select().from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
  if (!claim) throw new TestClockError(404, 'Damage claim not found.');
  return claim;
}

/** Every upcoming automatic step of one damage claim, labelled for QA. Review by Local Cooks is a person's step, so it has none. */
export async function readClaimClock(id: number, now = new Date()) {
  const claim = await claimRecord(id);
  const steps: Array<{ key: string; label: string; at: number }> = [];
  const add = (key: string, label: string, at: Date | string | null | undefined) => {
    const time = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : NaN;
    if (Number.isFinite(time) && time > now.getTime()) steps.push({ key, label, at: time });
  };
  if (claim.status === 'submitted') {
    const { currentReminders } = await import('./advance-reminders');
    for (const reminder of await currentReminders(db as never, 'claim', id, undefined, now).catch(() => []))
      add(`claim:${reminder.kind}`, 'Reminder to the customer: pay or dispute the claim', reminder.due);
    add('response_deadline', "Customer's pay-or-dispute deadline · unanswered claim goes to Local Cooks review", claim.chefResponseDeadline);
  }
  // Every condition but the time: the far-future date asks "would this claim pause bookings once 7 days pass?".
  if (claim.upheldAt && claimBookingHeld(claim, new Date(8.64e15))) add('booking_hold', "7 days unpaid · customer's new bookings pause (notice to the customer)", new Date(claim.upheldAt.getTime() + CLAIM_BOOKING_HOLD_MS));
  const seen = new Set<string>();
  return { kind: 'claim' as const, id, reference: claim.referenceCode || `#${id}`, status: claim.status, updatedAt: claim.updatedAt.toISOString(), now: now.toISOString(),
    note: !steps.length && waitingOnPeople.includes(claim.status) ? 'Waiting on a Local Cooks review. That is a person\'s step: do it at the real time; nothing here runs on its own.' : null,
    steps: steps.sort((a, b) => a.at - b.at).filter(step => !seen.has(`${step.label}:${step.at}`) && seen.add(`${step.label}:${step.at}`))
      .map(step => ({ key: step.key, label: step.label, at: new Date(step.at).toISOString() })) as ClockStep[] };
}

/** Narrow: a money action the claim code is still finishing. Moving its saved times mid-flight would age an attempt that must stay retry-safe. */
function moneyInFlight(claim: typeof damageClaims.$inferSelect) {
  if (['pending', 'cancel_pending'].includes(claim.paymentOperation?.state ?? '')) return "The customer's payment on this claim is still being set up or cancelled. Try again in a minute.";
  if (claim.transferOperation?.state === 'pending' || claim.compensationOperation?.state === 'pending') return 'A payment to the kitchen on this claim is still finishing. Try again in a minute.';
  if (claim.withdrawalOperation?.state === 'pending') return 'A withdrawal on this claim is still finishing. Try again in a minute.';
  return null;
}

/** Walks a claim to `to` one step at a time, like jumpStorage. */
export async function jumpClaim(id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [], reminders: Array<{ kind: string; role: string; channel: string }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await readClaimClock(id);
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await jumpClaimOnce(id, new Date(next ? Date.parse(next.at) : target), actorId, version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices); reminders.push(...result.reminders);
    if (!next) { reached = null; break; }
  }
  // Emails that didn't fit in the request finish right after it, as after any claim action.
  if (notices.some(notice => !notice.sent)) (await import('./outcome-delivery')).attemptOutcomeDeliveryAfterResponse();
  return { movedMs, notices, reminders, clock: await readClaimClock(id), ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}

/** Moves one claim (its history, evidence and scheduled reminders) `ms` earlier, then runs what became due for this claim only. The booking or rental it belongs to stays put. */
async function jumpClaimOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const ms = Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;
  const mail = like(emailLogs.trackingId, `claim-outcome:${id}:%`);
  const [{ lastHistory }] = await db.select({ lastHistory: sql<number>`coalesce(max(${damageClaimHistory.id}), 0)::int` }).from(damageClaimHistory).where(eq(damageClaimHistory.damageClaimId, id));
  const sentBefore = new Set((await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderIntents(id), eq(emailLogs.status, 'sent')))).map(row => row.id));
  await db.transaction(async tx => {
    // Same order as the claim money code: the booking or rental row, then the claim.
    const [parent] = await tx.select({ kitchen: damageClaims.kitchenBookingId, storage: damageClaims.storageBookingId }).from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
    if (parent?.storage) await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${parent.storage} FOR UPDATE`);
    else if (parent?.kitchen) await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${parent.kitchen} FOR UPDATE`);
    const [claim] = await tx.select().from(damageClaims).where(eq(damageClaims.id, id)).limit(1).for('update');
    if (!claim) throw new TestClockError(404, 'Damage claim not found.');
    if (claim.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This claim changed. Refresh and try again.');
    const busy = moneyInFlight(claim);
    if (busy) throw new TestClockError(409, busy);

    // Reminders exist before their time in real life; plan them now so the move carries them instead of inventing late ones.
    const { scheduleAdvanceReminders, currentReminders, reminderKey } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'claim', id, undefined, now);
    await shiftRows(tx, damageClaims, eq(damageClaims.id, id), ms);
    // A kitchen reply's evidence and its history row share one instant (the claim view matches them), so both move by the same amount.
    await shiftRows(tx, damageClaimHistory, eq(damageClaimHistory.damageClaimId, id), ms);
    await shiftRows(tx, damageEvidence, eq(damageEvidence.damageClaimId, id), ms);
    // A reminder's key hashes the times it was planned for. Carry each unsent one to its moved key, so the re-plan keeps it
    // (a fresh key whose time has just passed would count as a missed lead and never send).
    await shiftRows(tx, emailLogs, reminderRows(id), ms, { keep: ['retriedAt'], texts: ['textBody'] });
    const current = await currentReminders(tx, 'claim', id);
    for (const row of await tx.select().from(emailLogs).where(and(reminderIntents(id), inArray(emailLogs.status, ['scheduled', 'failed'])))) {
      const saved = JSON.parse(row.textBody || '{}') as { reminder?: { resource: string; kind: string; recipientId: number; due: string }; channel?: 'email' | 'notification' };
      const match = saved.reminder && saved.channel && current.find(reminder => reminder.resource === saved.reminder!.resource && reminder.kind === saved.reminder!.kind
        && reminder.recipientId === saved.reminder!.recipientId && Date.parse(reminder.due) === Date.parse(saved.reminder!.due));
      if (match && reminderKey(match, saved.channel!) !== row.trackingId)
        await tx.update(emailLogs).set({ trackingId: reminderKey(match, saved.channel!), textBody: JSON.stringify({ reminder: match, channel: saved.channel }) }).where(eq(emailLogs.id, row.id));
    }
    await scheduleAdvanceReminders(tx, 'claim', id);
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'claim', id, to: to.toISOString(), movedMs: ms });
  });

  // The same idempotent per-claim work the sweeps run; each re-checks its own state under lock.
  const step = async (name: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { logger.error('[TestClock] Claim step failed; the worker retries it', { id, name, error }); }
  };
  const claims = await import('./damage-claims-v2');
  await step('escalate', () => claims.escalateDamageClaim(id, new Date()));
  await step('hold', () => claims.notifyDamageClaimBookingHold(id, new Date()));
  const { dispatchAdvanceReminders } = await import('./advance-reminders');
  for (const row of await db.select({ id: emailLogs.id }).from(emailLogs).where(and(reminderIntents(id), eq(emailLogs.status, 'scheduled'),
    sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= now()`)))
    await step('reminder', () => dispatchAdvanceReminders({ onlyLogId: row.id, limit: 1 }));
  // Delivery needs a 12 s reserve inside its budget (storage's 4 s never starts); a few here, the rest after the response.
  const { deliverOutcomeEmails } = await import('./outcome-delivery');
  for (const row of (await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.category, 'lifecycle_outcome'), mail, inArray(emailLogs.status, ['queued', 'failed'])))).slice(0, 3))
    await step('notices', () => deliverOutcomeEmails(1, 13_000, row.id));

  // One entry per notice (the customer, kitchen and admins can each get a row): sent once every row went out.
  const made = await db.select({ id: damageClaimHistory.id, action: damageClaimHistory.action }).from(damageClaimHistory)
    .where(and(eq(damageClaimHistory.damageClaimId, id), gt(damageClaimHistory.id, lastHistory))).orderBy(damageClaimHistory.id);
  const queued = await db.select({ trackingId: emailLogs.trackingId, status: emailLogs.status }).from(emailLogs).where(and(eq(emailLogs.category, 'lifecycle_outcome'), mail));
  // Skipped on purpose (a test address, or email turned off) is done, not pending.
  const notices = made.map(history => ({ kind: history.action, sent: queued.filter(row => row.trackingId!.split(':')[2] === String(history.id))
    .every(row => ['sent', 'skipped_policy', 'skipped_preference'].includes(row.status)) }));
  const reminders = (await db.select({ id: emailLogs.id, textBody: emailLogs.textBody }).from(emailLogs).where(and(reminderIntents(id), eq(emailLogs.status, 'sent'))))
    .filter(row => !sentBefore.has(row.id)).map(row => { const saved = JSON.parse(row.textBody || '{}'); return { kind: String(saved.reminder?.kind), role: String(saved.reminder?.role), channel: String(saved.channel) }; });
  logger.info('[TestClock] Damage claim moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, notices, reminders };
}
