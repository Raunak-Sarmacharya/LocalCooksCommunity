import { describe, expect, it } from 'vitest';
import { buildTourFunnel, tourFunnelRange, type FunnelApplication, type FunnelTour } from './tour-funnel';
import type { VisitEvent } from './tour-visit-evidence';

const now = new Date('2026-10-07T16:00:00Z');
const range = { from: '2026-10-01', to: '2026-10-07' };
const base: FunnelTour = { id: 1, chefId: 10, managerId: 50, locationId: 20, targetedKitchenId: 30, status: 'confirmed', lifecycleState: 'confirmed',
  createdAt: '2026-10-01T12:00:00Z', scheduledAt: '2026-10-02T12:00:00Z', durationMinutes: 30,
  confirmationVerified: true, visitResult: null, visitEvidenceState: 'ready', visitEvidenceMigratedAt: '2026-09-01T00:00:00Z', checkedInAt: null, checkedOutAt: null };
const event = (tour: FunnelTour, result = 'completed', id = tour.id): VisitEvent => ({ id, viewingId: tour.id, kind: 'result', supersedesId: null,
  actorId: 50, actorRole: 'manager', source: 'decision', actualAt: null, recordedAt: '2026-10-02T13:00:00Z',
  scheduledAt: tour.scheduledAt, appointmentRevision: 1, result, sharedExplanation: null, internalNotes: 'Never exposed', data: {} });
const complete = { ...base, status: 'completed', lifecycleState: 'ended', visitResult: 'completed' };
const app: FunnelApplication = { id: 7, chefId: 10, locationId: 20, sourceTourId: 1, createdAt: '2026-10-02T14:00:00Z', status: 'approved', reviewedAt: '2026-10-03T12:00:00Z', current_tier: 3, tier2_completed_at: '2026-10-03T12:00:00Z' };
const booking = { id: 1, chefId: 10, kitchenId: 30, status: 'confirmed', bookingType: 'chef', createdAt: '2026-10-04T12:00:00Z' };
const run = (overrides: Partial<Parameters<typeof buildTourFunnel>[0]> = {}) => buildTourFunnel({ tours: [complete], events: [event(complete)], applications: [app], bookings: [booking], range, now, ...overrides });

describe('explicit tour funnel fixtures', () => {
  it('attributes one application and booking without requiring optional arrival taps', () => {
    const report = run({ bookings: [booking, { ...booking, id: 2 }] });
    expect(report.stages.completed.count).toBe(1); expect(report.stages.feedback.count).toBe(0);
    expect(report.stages.applied.count).toBe(1); expect(report.stages.booked.count).toBe(1);
    expect(report.diagnostics.missingChefFeedback).toBe(0); expect(report.outcomes.resultCoverage.rate).toBe(1);
    expect(JSON.stringify(report)).not.toContain('Never exposed');
  });
  it('uses true first request rather than the first repeat inside range', () => {
    expect(run({ tours: [{ ...base, id: 2, createdAt: '2026-09-25T12:00:00Z' }, complete] }).stages.requested.count).toBe(0);
  });
  it('never infers attendance, absence or completion from elapsed schedules', () => {
    const report = run({ tours: [base], events: [] });
    expect(report.stages.completed.count).toBe(0); expect(report.stages.feedback.count).toBe(0);
    expect(report.outcomes.absent.count).toBe(0); expect(report.diagnostics.awaitingResult).toBe(1);
  });
  it('holds applications pending admin verification even when both parties say the tour happened', () => {
    const feedback = [
      { viewingId: 1, respondentId: 10, respondentRole: 'chef', scheduledAt: base.scheduledAt, appointmentRevision: 1, happened: true, createdAt: '2026-10-02T13:00:00Z' },
      { viewingId: 1, respondentId: 50, respondentRole: 'manager', scheduledAt: base.scheduledAt, appointmentRevision: 1, happened: true, createdAt: '2026-10-02T13:30:00Z' },
    ];
    const pending = run({ tours: [base], events: [], feedback });
    expect(pending.stages.feedback.count).toBe(1);
    expect(pending.stages.applied.count).toBe(0); expect(pending.stages.booked.count).toBe(0);
    expect(pending.diagnostics.pendingApplicationReview).toBe(1); expect(pending.diagnostics.attributionInvalidated).toBe(0);
    const verified = run({ feedback, events: [{ ...event(complete), actorRole: 'admin', recordedAt: '2026-10-03T14:00:00Z' }] });
    expect(verified.stages.applied.count).toBe(1); expect(verified.stages.booked.count).toBe(1);
  });
  it('counts missing and conflicting responses by current appointment and current manager', () => {
    const response = { viewingId: 1, respondentId: 10, respondentRole: 'chef', scheduledAt: base.scheduledAt, appointmentRevision: 1, happened: true, createdAt: '2026-10-02T13:00:00Z' };
    const report = run({ tours: [base], events: [], feedback: [response, { ...response, respondentRole: 'manager', respondentId: 49, happened: false }] });
    expect(report.diagnostics.missingChefFeedback).toBe(0); expect(report.diagnostics.missingManagerFeedback).toBe(1);
    expect(report.diagnostics.feedbackConflicts).toBe(0);
    expect(run({ tours: [base], events: [], feedback: [response, { ...response, respondentRole: 'manager', respondentId: 50, happened: false }] }).diagnostics.feedbackConflicts).toBe(1);
    expect(run({ tours: [base], events: [], feedback: [{ ...response, appointmentRevision: 2 }] }).stages.feedback.count).toBe(0);
  });
  it('closing an unknown outcome ends pending review without proving absence or completion', () => {
    const unknown = { ...base, status: 'cancelled', lifecycleState: 'ended', visitResult: 'unrecorded', disruptionReason: 'outcome_unknown' };
    const report = run({ tours: [unknown], events: [event(unknown, 'unrecorded')] });
    expect(report.diagnostics.unverifiedClosed).toBe(1); expect(report.diagnostics.awaitingResult).toBe(0);
    expect(report.stages.completed.count).toBe(0); expect(report.outcomes.absent.count).toBe(0);
    expect(report.stages.applied.count).toBe(0); expect(report.outcomes.resultCoverage.count).toBe(0);
  });
  it('requires confirmation and coherent current event evidence', () => {
    for (const patch of [{ confirmationVerified: false }, { visitEvidenceMigratedAt: null }, { visitEvidenceState: 'review' }])
      expect(run({ tours: [{ ...complete, ...patch }] }).stages.completed.count).toBe(0);
    expect(run({ events: [{ ...event(complete), appointmentRevision: 2 }] }).stages.completed.count).toBe(0);
    expect(run({ events: [event(complete), event(complete, 'completed', 2)] }).stages.completed.count).toBe(0);
  });
  it('drops conversion after a result correction while retaining attribution coverage', () => {
    const corrected = { ...complete, status: 'no_show', visitResult: 'visitor_absent' };
    const report = run({ tours: [corrected], events: [event(complete), { ...event(corrected, 'visitor_absent', 2), supersedesId: 1 }] });
    expect(report.stages.applied.count).toBe(0); expect(report.stages.booked.count).toBe(0);
    expect(report.diagnostics.attributionInvalidated).toBe(1); expect(report.outcomes.absent.count).toBe(1);
  });
  it('preserves application credit when explained attendance repair emits a later result', () => {
    expect(run({ events: [{ ...event(complete), recordedAt: '2026-10-06T12:00:00Z' }] }).stages.applied.count).toBe(1);
  });
  it('reports preexisting and unattributed apps separately and excludes another chef or location', () => {
    const report = run({ applications: [{ ...app, createdAt: '2026-09-30T12:00:00Z', sourceTourId: null }, { ...app, id: 8, sourceTourId: null },
      { ...app, id: 9, chefId: 12 }, { ...app, id: 10, locationId: 21 }] });
    expect(report.stages.applied.count).toBe(0); expect(report.diagnostics.existingApplications).toBe(1); expect(report.diagnostics.unattributedApplications).toBe(1);
  });
  it('does not credit pre-approval, other-kitchen, external or no-longer-approved bookings', () => {
    for (const patch of [{ createdAt: '2026-10-02T15:00:00Z' }, { kitchenId: 31 }, { bookingType: 'external' }, { status: 'cancelled' }, { chefId: 11 }])
      expect(run({ bookings: [{ ...booking, ...patch }] }).stages.booked.count).toBe(0);
    for (const patch of [{ status: 'inReview' }, { current_tier: 1 }, { tier2_completed_at: null }, { reviewedAt: null }, { tier2_completed_at: '2026-10-05T12:00:00Z' }])
      expect(run({ applications: [{ ...app, ...patch }] }).stages.booked.count).toBe(0);
    expect(run({ tours: [{ ...complete, targetedKitchenId: null }] }).stages.booked.count).toBe(0);
  });
  it('counts failed repeat recovery once per affected journey and keeps absence fact', () => {
    const missed = { ...base, status: 'no_show', lifecycleState: 'ended', visitResult: 'visitor_absent' };
    const later = { ...complete, id: 2, createdAt: '2026-10-03T12:00:00Z', scheduledAt: '2026-10-04T12:00:00Z' };
    const report = run({ tours: [later, missed], events: [event(missed, 'visitor_absent'), { ...event(later), recordedAt: '2026-10-04T13:00:00Z' }], applications: [{ ...app, sourceTourId: 2, createdAt: '2026-10-04T14:00:00Z' }], bookings: [] });
    expect(report.stages.requested.count).toBe(1); expect(report.stages.completed.count).toBe(1);
    expect(report.outcomes.recovered).toEqual({ count: 1, denominator: 1, rate: 1 });
    expect(report.outcomes.absent.count).toBe(1); expect(report.diagnostics.laterCompleted).toBe(1);
  });
  it('recovers after explicit cancellation and expiry without pretending they are absence', () => {
    for (const failure of [{ ...base, status: 'cancelled', cancelledAt: '2026-10-02T13:00:00Z', confirmationVerified: false },
      { ...base, requestExpiredAt: '2026-10-02T12:00:00Z', confirmationVerified: false }]) {
      const later = { ...complete, id: 2, createdAt: '2026-10-03T12:00:00Z' };
      const report = run({ tours: [failure, later], events: [{ ...event(later), recordedAt: '2026-10-04T12:00:00Z' }] });
      expect(report.outcomes.recovered.count).toBe(1); expect(report.outcomes.absent.count).toBe(0);
    }
  });
  it('reports result coverage per visit when a resolved repeat follows an unresolved visit', () => {
    const later = { ...complete, id: 2, createdAt: '2026-10-03T12:00:00Z' };
    const report = run({ tours: [base, later], events: [event(later)] });
    expect(report.outcomes.resultCoverage).toEqual({ count: 1, denominator: 2, rate: 0.5 });
    expect(report.diagnostics.awaitingResult).toBe(1);
  });
  it('uses Newfoundland cohort date and shows no rate for no eligible journeys', () => {
    const report = run({ tours: [{ ...complete, createdAt: '2026-10-01T01:00:00Z' }] });
    expect(report.stages.requested.count).toBe(0); expect(report.stages.applied.rate).toBeNull();
  });
  it('validates bounded local date ranges across DST and invalid/future dates', () => {
    expect(tourFunnelRange(undefined, undefined, now)).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(tourFunnelRange('2025-10-07', '2026-10-07', now)).toEqual({ from: '2025-10-07', to: '2026-10-07' });
    for (const dates of [['2026-02-30', '2026-10-07'], ['2026-10-07', '2026-10-01'], ['2025-10-06', '2026-10-07'], ['2026-10-01', '2026-10-08']])
      expect(() => tourFunnelRange(...dates as [string, string], now)).toThrow();
  });
});
