import { hasTourConfirmation } from './tour-outcome';
import { projectVisitEvidence, type VisitEvent } from './tour-visit-evidence';

type Instant = Date | string | null;
export type FunnelTour = {
  id: number; chefId: number; locationId: number; targetedKitchenId: number | null;
  status: string; lifecycleState: string; disruptionReason?: string | null;
  createdAt: Date | string; scheduledAt: Date | string; durationMinutes: number;
  appointmentRevision?: number; confirmationVerified: boolean; requestExpiredAt?: Instant;
  cancelledAt?: Instant; visitResult: string | null; visitEvidenceState: string;
  managerId?: number | null;
  visitEvidenceMigratedAt: Instant; checkedInAt: Instant; checkedOutAt: Instant;
};
export type FunnelApplication = {
  id: number; chefId: number; locationId: number; sourceTourId: number | null;
  createdAt: Date | string; status: string; reviewedAt: Instant;
  current_tier: number; tier2_completed_at: Instant;
};
export type FunnelBooking = { id: number; chefId: number | null; kitchenId: number;
  status: string; bookingType: string; createdAt: Date | string };
export type FunnelFeedback = { viewingId: number; respondentId: number; respondentRole: string;
  scheduledAt: Date | string; appointmentRevision: number; happened: boolean; createdAt: Date | string };
export type TourFunnelRange = { from: string; to: string };
export type FunnelMetric = { count: number; denominator: number; rate: number | null };
const ms = (value: Instant | undefined) => value == null ? NaN : new Date(value).getTime();

export function tourFunnelLocalDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-');
}
export function tourFunnelRange(from?: unknown, to?: unknown, now = new Date()): TourFunnelRange {
  const today = tourFunnelLocalDate(now);
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Choose valid cohort dates');
    const instant = Date.parse(`${value}T12:00:00Z`);
    if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) throw Error('Choose valid cohort dates');
    return instant;
  };
  const end = to === undefined ? today : to;
  const endTime = parse(end);
  const start = from === undefined ? new Date(endTime - 29 * 86400000).toISOString().slice(0, 10) : from;
  const startTime = parse(start);
  if (startTime > endTime || endTime - startTime >= 366 * 86400000 || (end as string) > today) throw Error('Choose up to 366 past or current cohort dates');
  return { from: start as string, to: end as string };
}

/** One chef/location journey, selected by its true first request, observed as of now. */
export function buildTourFunnel(input: { tours: FunnelTour[]; events: VisitEvent[];
  applications: FunnelApplication[]; bookings: FunnelBooking[]; feedback?: FunnelFeedback[]; range: TourFunnelRange; now?: Date }) {
  const now = input.now || new Date();
  const groups = new Map<string, FunnelTour[]>();
  const byTour = new Map<number, VisitEvent[]>();
  for (const event of input.events) {
    const events = byTour.get(event.viewingId) || []; events.push(event); byTour.set(event.viewingId, events);
  }
  for (const tour of input.tours) {
    if (ms(tour.createdAt) > now.getTime() || !Number.isFinite(ms(tour.createdAt))) continue;
    const key = `${tour.chefId}:${tour.locationId}`;
    const tours = groups.get(key) || []; tours.push(tour); groups.set(key, tours);
  }
  const totals = { requested: 0, confirmed: 0, feedbackReceived: 0, completed: 0, applied: 0, booked: 0,
    absent: 0, affected: 0, recovered: 0, existingApplications: 0, unattributedApplications: 0,
    attributionInvalidated: 0, repeatJourneys: 0, laterCompleted: 0, evidenceReview: 0,
    missingChefFeedback: 0, missingManagerFeedback: 0, feedbackConflicts: 0, unverifiedClosed: 0, pendingApplicationReview: 0,
    awaitingResult: 0, resolvedVisitResults: 0, elapsedConfirmedVisits: 0, elapsedConfirmedJourneys: 0 };
  for (const group of Array.from(groups.values())) {
    group.sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id - b.id);
    const first = group[0];
    const day = tourFunnelLocalDate(new Date(first.createdAt));
    if (day < input.range.from || day > input.range.to) continue;
    totals.requested++;
    if (group.length > 1) totals.repeatJourneys++;
    const facts = group.map(tour => {
      const evidence = projectVisitEvidence(tour, byTour.get(tour.id) || [], now);
      const ready = !!tour.visitEvidenceMigratedAt && evidence.visitEvidenceState === 'ready';
      const result = evidence.effective.find(event => event.kind === 'result');
      const validResult = ready && tour.lifecycleState === 'ended' && !!result && ms(result.recordedAt) <= now.getTime()
        && ms(result.scheduledAt) === ms(tour.scheduledAt) && result.appointmentRevision === (tour.appointmentRevision || 1);
      const confirmed = hasTourConfirmation(tour);
      const completed = validResult && confirmed && tour.status === 'completed' && tour.visitResult === 'completed' && !tour.disruptionReason;
      const absent = validResult && confirmed && tour.status === 'no_show' && tour.visitResult === 'visitor_absent';
      const disrupted = validResult && confirmed && tour.status === 'cancelled' && tour.visitResult === 'disrupted' && !!tour.disruptionReason;
      const unverifiedClosed = validResult && confirmed && tour.status === 'cancelled' && tour.visitResult === 'unrecorded';
      const responses = (input.feedback || []).filter(response => response.viewingId === tour.id
        && response.appointmentRevision === (tour.appointmentRevision || 1) && ms(response.scheduledAt) === ms(tour.scheduledAt)
        && ms(response.createdAt) <= now.getTime());
      const chefResponse = responses.find(response => response.respondentRole === 'chef' && response.respondentId === tour.chefId);
      const managerResponse = responses.find(response => response.respondentRole === 'manager' && response.respondentId === tour.managerId);
      return { tour, ready, confirmed, chefResponse, managerResponse, unverifiedClosed,
        completed, absent, resolved: completed || absent || disrupted, resultAt: ms(result?.recordedAt),
        failedAt: absent || disrupted ? ms(result?.recordedAt)
          : ms(tour.requestExpiredAt || (tour.status === 'cancelled' ? tour.cancelledAt : null)),
        elapsed: confirmed && ms(tour.scheduledAt) + tour.durationMinutes * 60000 <= now.getTime() };
    });
    const completed = facts.filter(fact => fact.completed);
    const confirmed = facts.some(fact => fact.confirmed);
    if (confirmed) totals.confirmed++;
    if (facts.some(fact => fact.elapsed && fact.chefResponse && fact.managerResponse)) totals.feedbackReceived++;
    if (completed.length) totals.completed++;
    if (facts.some(fact => fact.absent)) totals.absent++;
    const failures = facts.filter(fact => Number.isFinite(fact.failedAt) && fact.failedAt <= now.getTime());
    if (failures.length) totals.affected++;
    if (completed.some(success => failures.some(failed => ms(success.tour.createdAt) > ms(failed.tour.createdAt) && success.resultAt > failed.failedAt))) totals.recovered++;
    if (facts.slice(1).some(fact => fact.completed)) totals.laterCompleted++;
    if (facts.some(fact => !fact.ready)) totals.evidenceReview++;
    totals.elapsedConfirmedVisits += facts.filter(fact => fact.elapsed).length;
    if (facts.some(fact => fact.elapsed)) totals.elapsedConfirmedJourneys++;
    if (facts.some(fact => fact.elapsed && !fact.chefResponse && !fact.resolved && !fact.unverifiedClosed)) totals.missingChefFeedback++;
    if (facts.some(fact => fact.elapsed && !fact.managerResponse && !fact.resolved && !fact.unverifiedClosed)) totals.missingManagerFeedback++;
    if (facts.some(fact => fact.chefResponse && fact.managerResponse && fact.chefResponse.happened !== fact.managerResponse.happened)) totals.feedbackConflicts++;
    if (facts.some(fact => fact.unverifiedClosed)) totals.unverifiedClosed++;
    if (facts.some(fact => fact.elapsed && !fact.resolved && !fact.unverifiedClosed)) totals.awaitingResult++;
    totals.resolvedVisitResults += facts.filter(fact => fact.elapsed && fact.resolved).length;

    const applications = input.applications.filter(app => app.chefId === first.chefId && app.locationId === first.locationId && ms(app.createdAt) <= now.getTime());
    if (applications.some(app => ms(app.createdAt) < ms(first.createdAt))) totals.existingApplications++;
    // The source was authorized at creation; a later factual repair must not erase it.
    const attributed = applications.filter(app => completed.some(fact => app.sourceTourId === fact.tour.id && ms(app.createdAt) >= ms(fact.tour.createdAt)));
    if (attributed.length) totals.applied++;
    if (applications.some(app => app.sourceTourId == null && ms(app.createdAt) >= ms(first.createdAt))) totals.unattributedApplications++;
    const pending = applications.filter(app => facts.some(fact => app.sourceTourId === fact.tour.id
      && fact.tour.status === 'confirmed' && fact.elapsed && !fact.tour.visitResult));
    if (pending.length) totals.pendingApplicationReview++;
    if (applications.some(app => facts.some(fact => app.sourceTourId === fact.tour.id) && !attributed.includes(app) && !pending.includes(app))) totals.attributionInvalidated++;
    if (attributed.some(app => app.status === 'approved' && app.current_tier >= 3 && app.tier2_completed_at
      && Number.isFinite(ms(app.tier2_completed_at)) && ms(app.tier2_completed_at) <= now.getTime()
      && Number.isFinite(ms(app.reviewedAt)) && ms(app.reviewedAt) >= ms(app.createdAt) && ms(app.reviewedAt) <= now.getTime()
      && input.bookings.some(booking => booking.chefId === first.chefId && booking.bookingType === 'chef'
        && ['confirmed', 'completed'].includes(booking.status) && ms(booking.createdAt) >= Math.max(ms(app.reviewedAt), ms(app.tier2_completed_at))
        && ms(booking.createdAt) <= now.getTime() && booking.kitchenId === facts.find(fact => fact.tour.id === app.sourceTourId)?.tour.targetedKitchenId))) totals.booked++;
  }
  const metric = (count: number, denominator: number): FunnelMetric => ({ count, denominator, rate: denominator ? count / denominator : null });
  return { range: input.range, asOf: now.toISOString(), timezone: 'America/St_Johns' as const,
    stages: { requested: metric(totals.requested, totals.requested), confirmed: metric(totals.confirmed, totals.requested),
      feedback: metric(totals.feedbackReceived, totals.elapsedConfirmedJourneys), completed: metric(totals.completed, totals.confirmed),
      applied: metric(totals.applied, totals.completed), booked: metric(totals.booked, totals.applied) },
    outcomes: { absent: metric(totals.absent, totals.confirmed), recovered: metric(totals.recovered, totals.affected),
      resultCoverage: metric(totals.resolvedVisitResults, totals.elapsedConfirmedVisits) }, diagnostics: totals };
}
export type TourFunnel = ReturnType<typeof buildTourFunnel>;
