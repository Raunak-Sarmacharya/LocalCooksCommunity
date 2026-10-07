import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, tourVisitEvents } from '@shared/schema';
import { projectVisitEvidence } from '@shared/tour-visit-evidence';
import type { TourAttendanceEntry } from '@shared/tour-attendance';
import { validateTourVisitInput } from '@shared/tour-visit-input';
import { tourAttendance } from '@shared/tour-attendance';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { DomainError } from '../shared/errors/domain-error';
import { createHash } from 'node:crypto';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = Transaction | typeof db;
type Tour = typeof kitchenViewings.$inferSelect;

export async function visitEvents(connection: Connection, id: number) {
  return connection.select().from(tourVisitEvents).where(eq(tourVisitEvents.viewingId, id)).orderBy(tourVisitEvents.id);
}
export async function withVisitEvidence(connection: Connection, tour: Tour) {
  // Old fixtures can characterize pre-migration behavior; persisted rows always have this column.
  if (tour.visitEvidenceMigratedAt === undefined) return tour;
  if (!tour.visitEvidenceMigratedAt) return { ...tour, visitEvidenceState: 'review', visitEvidenceIssue: 'visit_records_review', attendanceEvidence: [] };
  const { effective: _effective, ...evidence } = projectVisitEvidence(tour, await visitEvents(connection, tour.id));
  return { ...tour, ...evidence };
}
export async function appendVisitTime(tx: Transaction, tour: Tour, entry: TourAttendanceEntry, actorRole?: string) {
  if (tour.visitEvidenceMigratedAt === undefined) return;
  await tx.insert(tourVisitEvents).values({ viewingId: tour.id, kind: entry.action === 'check_in' ? 'arrival' : 'departure',
    eventKey: `attendance:${tour.id}:${entry.action}:${entry.recordedAt}`, actorId: entry.actorId,
    actorRole: actorRole || (entry.source === 'visitor' ? 'chef' : 'manager'), source: entry.source,
    actualAt: new Date(entry.actualAt), recordedAt: new Date(entry.recordedAt), scheduledAt: tour.scheduledAt,
    appointmentRevision: tour.appointmentRevision || 1, sharedExplanation: entry.reason || null });
}
export async function appendVisitResult(tx: Transaction, before: Tour, after: Tour, actorId?: number, actorRole?: string | null) {
  if (after.visitEvidenceMigratedAt === undefined) return;
  const result = after.status === 'completed' ? 'completed' : after.status === 'no_show' ? 'visitor_absent'
    : after.disruptionReason === 'outcome_unknown' ? 'unrecorded' : after.disruptionReason ? 'disrupted' : null;
  const lifecycleState = result ? 'ended' : after.status === 'confirmed' ? 'confirmed' : after.status === 'cancelled' ? 'closed' : 'pending';
  const patch = { visitResult: result, lifecycleState, confirmationVerified: after.confirmationVerified || after.status === 'confirmed' };
  await tx.update(kitchenViewings).set(patch).where(eq(kitchenViewings.id, after.id));
  Object.assign(after, patch);
  if (!result || after.visitEvidenceMigratedAt === undefined) return;
  const events = await visitEvents(tx, after.id);
  const current = projectVisitEvidence(after, events).effective.filter(event => event.kind === 'result');
  if (current.length > 1) throw Error('visit_records_review');
  await tx.insert(tourVisitEvents).values({ viewingId: after.id, kind: 'result',
    eventKey: `result:${after.id}:${after.updatedAt.toISOString()}`, supersedesId: current[0]?.id || null,
    actorId: actorId || null, actorRole: actorRole || null, source: 'decision', recordedAt: after.updatedAt,
    scheduledAt: after.scheduledAt, appointmentRevision: after.appointmentRevision || 1, result,
    sharedExplanation: after.sharedManagerNotes, internalNotes: after.managerNotes,
    data: { previousResult: before.visitResult, disruptionReason: after.disruptionReason, noShowReason: after.noShowReason } });
}

/** Caller holds the tour row/kitchen locks and has verified current role ownership. */
export async function changeVisitEvidence(tx: Transaction, tour: Tour, input: Record<string, unknown>,
  actorId: number, role: 'manager' | 'admin', earlyMinutes: number, repair: boolean, now = new Date()) {
  if (typeof input.requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey))
    throw new DomainError('TOUR_INPUT_INVALID', 'visit_command_required', 400);
  const eventKey = `${repair ? 'repair' : 'correction'}:${tour.id}:${input.requestKey}`;
  const timeFields = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(['actualAt', 'actualDate', 'actualTime', 'actualOccurrence'].map(key => [key, (value as Record<string, unknown>)[key]])) : value;
  const commandHash = createHash('sha256').update(JSON.stringify({ actorId, role,
    input: Object.fromEntries(['requestKey', 'action', 'reason', 'scheduledAt', 'expectedUpdatedAt', 'confirmationVerified', 'actualAt', 'actualDate', 'actualTime', 'actualOccurrence', 'arrival', 'departure']
      .map(key => [key, key === 'arrival' || key === 'departure' ? timeFields(input[key]) : input[key]])) })).digest('hex');
  const events = await visitEvents(tx, tour.id);
  const previous = events.find(event => event.eventKey === eventKey);
  if (previous) {
    if ((previous.data as { commandHash?: string })?.commandHash !== commandHash) throw new DomainError('TOUR_CHANGED', 'visit_command_changed', 409);
    return { tour: await withVisitEvidence(tx, tour), changed: false };
  }
  if (input.expectedUpdatedAt !== tour.updatedAt.toISOString() || input.scheduledAt !== tour.scheduledAt.toISOString())
    throw new DomainError('TOUR_CHANGED', 'visit_changed', 409);
  const evidence = projectVisitEvidence(tour, events, now);
  if (!repair && evidence.visitEvidenceState === 'review') throw new DomainError('TOUR_CHANGED', 'visit_records_review', 409);
  if (repair && role !== 'admin') throw new DomainError('FORBIDDEN', 'visit_records_review', 403);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10 || reason.length > 2000) throw new DomainError('TOUR_INPUT_INVALID', 'visit_reason_required', 400);
  if (!hasTourConfirmation(tour) && !(repair && input.confirmationVerified === true))
    throw new DomainError('TOUR_CHANGED', 'visit_confirmation_unknown', 409);
  const parse = (action: 'arrival' | 'departure', value: Record<string, unknown>) => {
    try { return validateTourVisitInput({ ...value, action, reason }, now).actual; }
    catch (error) { throw new DomainError('TOUR_INPUT_INVALID', (error as Error).message, 400); }
  };
  let arrival = tour.checkedInAt, departure = tour.checkedOutAt;
  const kind = input.action === 'arrival' ? 'arrival' : input.action === 'departure' ? 'departure' : null;
  if (repair) {
    if (!('arrival' in input) || !('departure' in input)) throw new DomainError('TOUR_INPUT_INVALID', 'visit_repair_selection', 400);
    for (const field of ['arrival', 'departure'] as const)
      if (input[field] !== null && (typeof input[field] !== 'object' || Array.isArray(input[field]))) throw new DomainError('TOUR_INPUT_INVALID', 'visit_repair_selection', 400);
    arrival = input.arrival === null ? null : parse('arrival', input.arrival as Record<string, unknown>);
    departure = input.departure === null ? null : parse('departure', input.departure as Record<string, unknown>);
  } else {
    if (!kind || !(kind === 'arrival' ? arrival : departure)) throw new DomainError('TOUR_INPUT_INVALID', 'visit_time_missing', 400);
    if (kind === 'arrival') arrival = parse(kind, input); else departure = parse(kind, input);
  }
  const attendance = tourAttendance({ ...tour, attendanceEvidence: evidence.attendanceEvidence }, earlyMinutes, now);
  if (arrival && (arrival < new Date(attendance.checkInOpensAt) || arrival > new Date(attendance.checkInClosesAt)))
    throw new DomainError('TOUR_INPUT_INVALID', 'visit_arrival_window', 400);
  if (departure && (!arrival || departure < arrival)) throw new DomainError('TOUR_INPUT_INVALID', 'visit_departure_chronology', 400);
  const values = { viewingId: tour.id, actorId, actorRole: role, source: repair ? 'admin_repair' : 'correction',
    recordedAt: now, scheduledAt: tour.scheduledAt, appointmentRevision: tour.appointmentRevision || 1,
    sharedExplanation: reason, data: { commandHash } };
  if (repair) {
    await tx.insert(tourVisitEvents).values({ ...values, kind: 'repair', eventKey,
      data: { commandHash, retiredIds: events.filter(event => ['arrival', 'departure', 'result'].includes(event.kind)).map(event => event.id),
        previousEvidenceState: tour.visitEvidenceState, confirmationAttested: input.confirmationVerified === true } });
    for (const [eventKind, actual] of [['arrival', arrival], ['departure', departure]] as const)
      if (actual) await tx.insert(tourVisitEvents).values({ ...values, kind: eventKind, actualAt: actual, eventKey: `${eventKey}:${eventKind}` });
    if (tour.visitResult) await tx.insert(tourVisitEvents).values({ ...values, kind: 'result', result: tour.visitResult, eventKey: `${eventKey}:result`,
      data: { resultPreserved: true } });
  } else {
    const current = evidence.effective.find(event => event.kind === kind);
    if (!current) throw new DomainError('TOUR_CHANGED', 'visit_records_review', 409);
    await tx.insert(tourVisitEvents).values({ ...values, kind: kind!, eventKey, supersedesId: current.id,
      actualAt: kind === 'arrival' ? arrival : departure });
  }
  const [saved] = await tx.update(kitchenViewings).set({ checkedInAt: arrival, checkedOutAt: departure,
    ...(repair ? { visitEvidenceState: 'ready', visitEvidenceIssue: null, confirmationVerified: true } : {}),
    updatedAt: new Date(Math.max(now.getTime(), tour.updatedAt.getTime() + 1)) }).where(eq(kitchenViewings.id, tour.id)).returning();
  return { tour: await withVisitEvidence(tx, saved), changed: true };
}
