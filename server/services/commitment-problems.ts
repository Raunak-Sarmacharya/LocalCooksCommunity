import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { commitmentProblems, kitchenBookings, kitchenViewings, kitchens, locations, users, emailLogs, bookingLifecycleEvents } from '@shared/schema';
import { problemDestination, problemStatusLabel, problemTransition, type ProblemStatus, type ProblemHistory } from '@shared/commitment-problems';
import { notificationService } from './notification.service';
import { getAppBaseUrl } from '../config';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { reminderVisitTimes } from './advance-reminders';
import { DomainError } from '../shared/errors/domain-error';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Problem = typeof commitmentProblems.$inferSelect;
type Actor = { id: number; role: string | null };
const reject = (message: string, status = 409): never => { throw new DomainError('PROBLEM_ACTION_INVALID', message, status); };

export async function problemContext(tx: Tx, kind: 'booking' | 'tour', id: number) {
  if (kind === 'booking') {
    const [row] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, id)).limit(1);
    if (!row) return undefined;
    // Completion and cancellation-review transitions require a confirmed booking.
    // A cancelled label alone can also represent a declined, never-confirmed request.
    let wasConfirmed = ['confirmed', 'completed', 'cancellation_requested'].includes(row.booking.status);
    if (!wasConfirmed && row.booking.status === 'cancelled') {
      const [confirmation] = await tx.select({ id: bookingLifecycleEvents.id }).from(bookingLifecycleEvents)
        .where(and(eq(bookingLifecycleEvents.bookingId, id), eq(bookingLifecycleEvents.kind, 'confirmed'))).limit(1);
      const decision = row.booking.paymentDecision as { target?: string; state?: string } | null;
      wasConfirmed = !!confirmation || decision?.target === 'confirmed' && decision?.state === 'complete' || !!row.booking.checkedInAt || !!row.booking.checkoutRequestedAt;
    }
    let scheduledStart: Date | null = null;
    try {
      const starts = reminderVisitTimes(row.booking, row.timezone || DEFAULT_TIMEZONE).map(visit => visit.start.getTime());
      if (starts.length && starts.every(Number.isFinite)) scheduledStart = new Date(Math.min(...starts));
    } catch { /* Invalid legacy schedules use general support rather than inventing a start. */ }
    return { chefId: row.booking.chefId, managerId: row.managerId, kitchenId: row.booking.kitchenId,
      status: row.booking.status, wasConfirmed, scheduledStart };
  }
  const [row] = await tx.select({ tour: kitchenViewings, managerId: locations.managerId }).from(kitchenViewings)
    .innerJoin(locations, eq(locations.id, kitchenViewings.locationId)).where(eq(kitchenViewings.id, id)).limit(1);
  return row && { chefId: row.tour.chefId, managerId: row.managerId,
    kitchenId: row.tour.targetedKitchenId, status: row.tour.status, wasConfirmed: hasTourConfirmation(row.tour), scheduledStart: row.tour.scheduledAt };
}

export function authorizeProblem(context: { chefId: number | null; managerId: number | null } | undefined, actor: Actor) {
  if (!context || (actor.role !== 'admin' && actor.id !== context.chefId && actor.id !== context.managerId)) reject('Commitment not found or access denied', 403);
}

export function canReportProblem(context: { chefId: number | null; managerId: number | null; wasConfirmed: boolean; scheduledStart: Date | null } | undefined, actor: Actor) {
  return !!context?.wasConfirmed && !!context.scheduledStart && context.scheduledStart.getTime() <= Date.now()
    && (actor.role === 'chef' && actor.id === context.chefId || actor.role === 'manager' && actor.id === context.managerId);
}

async function queueProblemNotice(tx: Tx, problem: Problem, action: string) {
  const kind = problem.bookingId ? 'booking' : 'tour', id = problem.bookingId || problem.viewingId!;
  const context = await problemContext(tx, kind, id);
  if (!context) throw Error('Problem commitment context missing');
  const people = await tx.select().from(users).where(or(context.chefId ? eq(users.id, context.chefId) : undefined,
    context.managerId ? eq(users.id, context.managerId) : undefined, eq(users.role, 'admin')));
  const title = `${kind === 'booking' ? 'Booking' : 'Tour'} #${id}: support request ${problemStatusLabel(problem.status).toLowerCase()}`;
  const last = (problem.history as ProblemHistory[]).at(-1);
  const message = `${problem.description}\n${last?.action === 'report' ? 'Report received.' : last?.note || ''}\n${problem.status === 'resolved' ? 'This support request has been resolved. View the response in your booking or tour.' : 'Follow your support request for updates and replies.'}`;
  const assignmentOnly = ['claim', 'reassign'].includes(action);
  for (const person of people) {
    const role = person.role === 'admin' ? 'admin' : person.id === context.chefId ? 'chef' : 'manager';
    // Internal assignment changes do not ask participants to act or change their report's public status.
    if (assignmentOnly && role !== 'admin') continue;
    const path = problemDestination(kind, id, role);
    await notificationService.create({ userId: person.id, target: role === 'chef' ? 'chef' : 'manager', type: 'system_announcement',
      priority: 'high', title, message,
      actionUrl: path, actionLabel: role === 'admin' ? 'Claim or review problem' : 'View problem', metadata: { problemId: problem.id, revision: problem.revision } }, tx);
    // Admin bell/queue is shared; SMTP goes only to the published support mailbox and actual participants.
    if (role === 'admin') continue;
    await tx.insert(emailLogs).values({ recipientEmail: person.username || '', recipientUserId: person.id, recipientRole: role,
      subject: title, category: 'lifecycle_outcome', status: 'queued', previewText: message,
      trackingId: `problem-outcome:${problem.id}:${problem.revision}:${person.id}`,
      textBody: `${message}\n\n${getAppBaseUrl(role === 'chef' ? 'chef' : 'kitchen')}${path}` });
  }
  if (!assignmentOnly) await tx.insert(emailLogs).values({ recipientEmail: 'support@localcook.shop', recipientRole: 'admin',
    subject: title, category: 'lifecycle_outcome', status: 'queued', previewText: message,
    trackingId: `problem-outcome:${problem.id}:${problem.revision}:support`,
    textBody: `${message}\n\n${getAppBaseUrl('admin')}/admin?section=live-problems` });
}

export async function createProblem(tx: Tx, input: { kind: 'live' | 'schedule'; commitment: 'booking' | 'tour'; id: number; actor: Actor; description: string; sourceKey: string }) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.sourceKey}, 0))`);
  const [prior] = await tx.select().from(commitmentProblems).where(eq(commitmentProblems.sourceKey, input.sourceKey)).limit(1);
  if (prior) {
    if (prior.description !== input.description || prior.reportedBy !== input.actor.id) reject('This report key already belongs to another submission');
    return prior;
  }
  const context = await problemContext(tx, input.commitment, input.id);
  if (input.kind === 'live') authorizeProblem(context, input.actor);
  if (input.kind === 'live' && !canReportProblem(context, input.actor)) reject('The booking chef or current kitchen manager can report from the scheduled start onwards, after confirmation. Contact Support before then or if the schedule or confirmation cannot be verified.');
  if (input.kind === 'schedule' && context?.status !== 'confirmed') reject('Only a confirmed commitment can receive schedule recovery');
  const history: ProblemHistory[] = [{ revision: 1, actorId: input.actor.id, actorRole: input.actor.role || undefined, at: new Date().toISOString(), action: 'report', note: 'Report received' }];
  const [problem] = await tx.insert(commitmentProblems).values({ sourceKey: input.sourceKey, kind: input.kind,
    bookingId: input.commitment === 'booking' ? input.id : null, viewingId: input.commitment === 'tour' ? input.id : null,
    kitchenId: context!.kitchenId, reportedBy: input.actor.id, description: input.description, history }).returning();
  await queueProblemNotice(tx, problem, 'report');
  return problem;
}

export async function reportProblem(commitment: 'booking' | 'tour', id: number, actor: Actor, description: string, requestKey: string) {
  if (!Number.isSafeInteger(id) || id <= 0 || typeof description !== 'string' || description.trim().length < 10 || description.length > 2000 ||
    typeof requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) reject('Describe the problem in 10–2000 characters and supply a valid retry key', 400);
  return db.transaction(async tx => {
    await tx.execute(commitment === 'booking' ? sql`SELECT id FROM kitchen_bookings WHERE id = ${id} FOR UPDATE` : sql`SELECT id FROM kitchen_viewings WHERE id = ${id} FOR UPDATE`);
    authorizeProblem(await problemContext(tx, commitment, id), actor);
    return createProblem(tx, { kind: 'live', commitment, id, actor, description: description.trim(), sourceKey: `live:${commitment}:${id}:${actor.id}:${requestKey}` });
  });
}

export async function updateProblem(id: number, actor: Actor, input: { action: string; expectedRevision: number; note?: string }) {
  if (actor.role !== 'admin' && input.action !== 'reply') reject('Local Cooks staff must claim and respond to this task', 403);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(commitmentProblems).where(eq(commitmentProblems.id, id)).limit(1).for('update');
    if (!row) reject('Problem not found', 404);
    if (actor.role !== 'admin') {
      const context = await problemContext(tx, row.bookingId ? 'booking' : 'tour', row.bookingId || row.viewingId!);
      authorizeProblem(context, actor);
      if (actor.role !== 'chef' && actor.role !== 'manager') reject('Only reservation participants can reply', 403);
      if (row.status === 'resolved') reject('This request is resolved. Create a new report if you need further help.');
    }
    if (row.revision !== input.expectedRevision) reject('This problem changed; refresh before responding');
    if (input.action === 'claim' && (row.claimedBy && row.claimedBy !== actor.id || row.status === 'resolved')) reject('Task already claimed or resolved');
    if (input.action === 'claim' && row.claimedBy === actor.id) return row;
    if (input.note !== undefined && typeof input.note !== 'string') reject('Write a text response', 400);
    const note = input.note?.trim() || '';
    if (note.length > 2000) reject('Keep responses within 2000 characters', 400);
    let status: ProblemStatus;
    try {
      if (actor.role !== 'admin') {
        if (!note) reject('Write a reply before sending', 400);
        status = row.status as ProblemStatus;
      } else status = problemTransition(row.status as ProblemStatus, input.action, row.claimedBy, actor.id, note);
    }
    catch (error) { return reject((error as Error).message); }
    const revision = row.revision + 1, now = new Date();
    const [updated] = await tx.update(commitmentProblems).set({ status, claimedBy: actor.role === 'admin' ? actor.id : row.claimedBy, revision, updatedAt: now,
      history: [...row.history as ProblemHistory[], { revision, at: now.toISOString(), actorId: actor.id, actorRole: actor.role || undefined, action: input.action, note: note || 'Assigned to support staff' }] })
      .where(eq(commitmentProblems.id, id)).returning();
    await queueProblemNotice(tx, updated, input.action);
    return updated;
  });
}

export async function listProblems(actor: Actor, commitment?: 'booking' | 'tour', id?: number) {
  return db.transaction(async tx => {
    if (commitment && id) authorizeProblem(await problemContext(tx, commitment, id), actor);
    const rows = await tx.select().from(commitmentProblems).where(commitment && id
      ? commitment === 'booking' ? eq(commitmentProblems.bookingId, id) : eq(commitmentProblems.viewingId, id)
      : undefined).orderBy(desc(commitmentProblems.id));
    const visible = [];
    for (const row of rows) {
      const context = await problemContext(tx, row.bookingId ? 'booking' : 'tour', row.bookingId || row.viewingId!);
      if (actor.role === 'admin' || actor.id === context?.chefId || actor.id === context?.managerId) visible.push(row);
    }
    return visible;
  });
}

/** Called inside the schedule mutation's existing locks/transaction. A semantic key
 * survives retries/re-acknowledgments. Contact and resolution remain separate tasks. */
export async function queueScheduleProblems(tx: Tx, input: { kitchenId: number; actorId: number; bookingIds?: number[]; tourIds?: number[]; change: unknown; description: string }) {
  const digest = createHash('sha256').update(JSON.stringify(input.change)).digest('hex').slice(0, 24);
  for (const [commitment, ids] of [['booking', input.bookingIds || []], ['tour', input.tourIds || []]] as const) {
    for (const id of Array.from(new Set(ids))) {
      const context = await problemContext(tx, commitment, id);
      if (context?.status !== 'confirmed' || context.kitchenId !== input.kitchenId) continue;
      const sourceKey = `schedule:${input.kitchenId}:${commitment}:${id}:${digest}`;
      const [prior] = await tx.select().from(commitmentProblems).where(eq(commitmentProblems.sourceKey, sourceKey)).limit(1);
      if (prior) continue;
      await createProblem(tx, { kind: 'schedule', commitment, id, actor: { id: input.actorId, role: 'manager' }, sourceKey,
        description: input.description });
    }
  }
}

export async function affectedTours(tx: Tx, kitchenId: number, dates?: string[], weekdays?: number[]) {
  const rows = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.targetedKitchenId, kitchenId), eq(kitchenViewings.status, 'confirmed')));
  return rows.filter(tour => {
    if (tour.scheduledAt.getTime() + tour.durationMinutes * 60000 <= Date.now()) return false;
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tour.scheduledAt);
    // Include the previous operating day for overnight windows/closures.
    const previous = new Date(`${key}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    return (!dates && !weekdays) || dates?.some(date => date === key || date === previous.toISOString().slice(0, 10)) ||
      weekdays?.some(day => day === new Date(`${key}T12:00:00Z`).getUTCDay() || day === previous.getUTCDay());
  }).map(row => row.id);
}
