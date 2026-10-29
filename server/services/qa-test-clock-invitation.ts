import { and, eq, gt, sql } from 'drizzle-orm';
import { kitchenCustomerInvites, kitchenInvitationEvents, kitchenInvitations } from '@shared/schema';
import { db } from '../db';
import { logger } from '../logger';
import { type ClockStep, jumpGraceMs, jumpStepMs, maxJumpMs, recordJump, shiftRows, TestClockError } from './qa-test-clock';

const day = 86_400_000;
type Clock = { updatedAt: string; steps: ClockStep[] };

/** Walks one record to `to` a step at a time within the request budget, like jumpClaim. */
async function walk<T extends Clock>(read: () => Promise<T>, once: (to: Date, version: string) => Promise<{ movedMs: number; notices: Array<{ kind: string; sent: boolean }> }>,
  to: Date, expectedUpdatedAt: string, budgetMs: number) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await read();
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await once(new Date(next ? Date.parse(next.at) : target), version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices);
    if (!next) { reached = null; break; }
  }
  return { movedMs, notices, clock: await read(), ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}
const moveBy = (to: Date, now: Date) => Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;

async function invitationRecord(id: string) {
  const [row] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, id)).limit(1);
  if (!row) throw new TestClockError(404, 'Invitation not found.');
  return row;
}

/** Upcoming automatic steps of one booking invitation. Only a still-open ('sent') one has any. */
export async function readInvitationClock(id: string, now = new Date()) {
  const row = await invitationRecord(id);
  const steps: ClockStep[] = [];
  const open = row.status === 'sent' && !row.expiryNotifiedAt;
  const remindAt = row.expiresAt.getTime() - day;
  if (open && !row.reminderSentAt && row.expiresAt.getTime() - row.createdAt.getTime() > day && remindAt > now.getTime())
    steps.push({ key: 'reminder', label: 'Reminder to the customer: invitation expires in 24 hours', at: new Date(remindAt).toISOString() });
  if (open && row.expiresAt.getTime() > now.getTime())
    steps.push({ key: 'expires', label: 'Invitation expires · customer and kitchen are told', at: row.expiresAt.toISOString() });
  return { kind: 'invitation' as const, id, reference: row.id, status: row.status, updatedAt: row.updatedAt.toISOString(), now: now.toISOString(),
    note: steps.length ? null : row.status === 'accepted_pending_payment' ? 'The customer is in checkout, so the clock is paused until they pay or leave.'
      : 'Nothing on this invitation runs on its own.', steps };
}

export const jumpInvitation = (id: string, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) =>
  walk(() => readInvitationClock(id), (target, version) => jumpInvitationOnce(id, target, actorId, version), to, expectedUpdatedAt, budgetMs);

/** Moves one invitation (and its notice queue) earlier, then runs the sweep's per-invitation work for it. The booked date and time stay put. */
async function jumpInvitationOnce(id: string, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const ms = moveBy(to, now);
  const [{ lastEvent }] = await db.select({ lastEvent: sql<number>`coalesce(max(${kitchenInvitationEvents.id}), 0)::int` }).from(kitchenInvitationEvents).where(eq(kitchenInvitationEvents.invitationId, id));
  await db.transaction(async tx => {
    const [row] = await tx.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, id)).limit(1).for('update');
    if (!row) throw new TestClockError(404, 'Invitation not found.');
    if (row.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This invitation changed. Refresh and try again.');
    if (row.status === 'accepted_pending_payment') throw new TestClockError(409, 'The customer is in checkout on this invitation. Try again once they pay or leave.');
    // createdAt and expiresAt both move, so the lifetime (and the 24 h reminder rule) stays the same.
    await shiftRows(tx, kitchenInvitations, eq(kitchenInvitations.id, id), ms, { keep: ['selectedSlots', 'daysSnapshot', 'bookingRuleOverrides'] });
    await shiftRows(tx, kitchenInvitationEvents, eq(kitchenInvitationEvents.invitationId, id), ms);
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'invitation', id, to: to.toISOString(), movedMs: ms });
  });

  const invitations = await import('./kitchen-invitations');
  const step = async (name: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { logger.error('[TestClock] Invitation step failed; the worker retries it', { id, name, error }); }
  };
  await step('reminder', () => invitations.remindKitchenInvitation(id));
  await step('expiry', () => invitations.expireKitchenInvitation(id));
  // A few notices inline; the rest go out with the worker.
  await step('notices', () => invitations.deliverKitchenInvitationEvents(3, id));

  // Test addresses are skipped inside delivery and still mark the event delivered, so delivered means done.
  const notices = (await db.select({ kind: kitchenInvitationEvents.kind, deliveredAt: kitchenInvitationEvents.deliveredAt }).from(kitchenInvitationEvents)
    .where(and(eq(kitchenInvitationEvents.invitationId, id), gt(kitchenInvitationEvents.id, lastEvent))).orderBy(kitchenInvitationEvents.id))
    .map(row => ({ kind: row.kind, sent: !!row.deliveredAt }));
  logger.info('[TestClock] Invitation moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, notices };
}

async function customerInviteRecord(id: number) {
  const [row] = await db.select().from(kitchenCustomerInvites).where(eq(kitchenCustomerInvites.id, id)).limit(1);
  if (!row) throw new TestClockError(404, 'Customer link not found.');
  return row;
}

/** The kitchen's "add customer" link: expiry is passive (the page reads it), so the one step is the moment it stops working. */
export async function readCustomerInviteClock(id: number, now = new Date()) {
  const row = await customerInviteRecord(id);
  const steps: ClockStep[] = row.status === 'sent' && row.expiresAt.getTime() > now.getTime()
    ? [{ key: 'expires', label: "Link expires · the customer sees 'This invitation has expired'", at: row.expiresAt.toISOString() }] : [];
  // This table has no updated_at, so the expiry instant is the version: every jump changes it.
  return { kind: 'customer_invite' as const, id, reference: row.fullName, status: row.status === 'sent' && !steps.length ? 'expired' : row.status,
    updatedAt: row.expiresAt.toISOString(), now: now.toISOString(), note: steps.length ? null : 'Nothing on this link runs on its own.', steps };
}

export const jumpCustomerInvite = (id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) =>
  walk(() => readCustomerInviteClock(id), (target, version) => jumpCustomerInviteOnce(id, target, actorId, version), to, expectedUpdatedAt, budgetMs);

async function jumpCustomerInviteOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const ms = moveBy(to, now);
  await db.transaction(async tx => {
    const [row] = await tx.select().from(kitchenCustomerInvites).where(eq(kitchenCustomerInvites.id, id)).limit(1).for('update');
    if (!row) throw new TestClockError(404, 'Customer link not found.');
    if (row.expiresAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This link changed. Refresh and try again.');
    await shiftRows(tx, kitchenCustomerInvites, eq(kitchenCustomerInvites.id, id), ms);
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'customer_invite', id, to: to.toISOString(), movedMs: ms });
  });
  logger.info('[TestClock] Customer link moved', { id, actorId, movedMs: ms });
  return { movedMs: ms, notices: [] };
}
