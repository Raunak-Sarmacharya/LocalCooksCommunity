import type { TourAttendanceEntry } from './tour-attendance';

export type VisitEvent = {
  id: number; viewingId: number; kind: string; supersedesId: number | null; actorId: number | null;
  actorRole: string | null; source: string; actualAt: Date | string | null; recordedAt: Date | string;
  scheduledAt: Date | string; appointmentRevision: number; result: string | null;
  sharedExplanation: string | null; internalNotes: string | null; data: unknown;
};
const instant = (value: Date | string | null | undefined) => value == null ? null : new Date(value).getTime();

/** Superseded facts remain evidence, but only one effective fact per action is allowed. */
export function projectVisitEvidence(tour: { id: number; scheduledAt: Date | string; appointmentRevision?: number;
  checkedInAt?: Date | string | null; checkedOutAt?: Date | string | null; visitResult?: string | null;
  visitEvidenceState?: string }, events: VisitEvent[], now = new Date()) {
  const superseded = new Set(events.flatMap(event => event.supersedesId == null ? [] : [event.supersedesId]));
  for (const event of events.filter(event => event.kind === 'repair')) {
    const retired = (event.data as { retiredIds?: unknown } | null)?.retiredIds;
    if (event.source === 'admin_repair' && event.actorRole === 'admin' && (event.sharedExplanation?.trim().length || 0) >= 10 && Array.isArray(retired))
      for (const id of retired) if (events.some(other => other.id === id && other.id < event.id && other.viewingId === tour.id)) superseded.add(id);
  }
  const effective = events.filter(event => !superseded.has(event.id) && ['arrival', 'departure', 'result'].includes(event.kind));
  let review = tour.visitEvidenceState === 'review';
  for (const event of events) {
    const parent = event.supersedesId == null ? null : events.find(other => other.id === event.supersedesId);
    if (event.viewingId !== tour.id || event.supersedesId != null && (!parent || parent.kind !== event.kind || parent.id >= event.id)) review = true;
  }
  const facts: TourAttendanceEntry[] = [];
  for (const [kind, action, saved] of [['arrival', 'check_in', tour.checkedInAt], ['departure', 'check_out', tour.checkedOutAt]] as const) {
    const leaves = effective.filter(event => event.kind === kind);
    const event = leaves[0];
    if (leaves.length > 1 || instant(saved) !== instant(event?.actualAt)) review = true;
    if (!event || !event.actualAt) continue;
    const actual = instant(event.actualAt)!, recorded = instant(event.recordedAt)!;
    if (!Number.isFinite(actual) || !Number.isFinite(recorded) || actual > recorded || recorded > now.getTime()
      || instant(event.scheduledAt) !== instant(tour.scheduledAt) || event.appointmentRevision !== (tour.appointmentRevision || 1)
      || !event.actorId || event.actorId <= 0) { review = true; continue; }
    const assisted = event.source !== 'visitor';
    if (assisted && (!event.sharedExplanation || event.sharedExplanation.trim().length < 10)) { review = true; continue; }
    facts.push({ action, actorId: event.actorId, source: assisted ? 'manager_assisted' : 'visitor',
      actualAt: new Date(actual).toISOString(), recordedAt: new Date(recorded).toISOString(),
      scheduledAt: new Date(event.scheduledAt).toISOString(), ...(assisted ? { reason: event.sharedExplanation! } : {}) });
  }
  const arrival = instant(tour.checkedInAt), departure = instant(tour.checkedOutAt);
  if (departure != null && (arrival == null || departure < arrival)) review = true;
  const results = effective.filter(event => event.kind === 'result');
  if (results.length > 1 || (results[0]?.result || null) !== (tour.visitResult || null)) review = true;
  return { attendanceEvidence: facts, visitEvidenceState: review ? 'review' : 'ready',
    visitEvidenceIssue: review ? 'visit_records_review' : null, effective };
}
