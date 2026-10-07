import { expect, it } from 'vitest';
import { projectVisitEvidence, type VisitEvent } from './tour-visit-evidence';
import { publicTourAttendanceState, tourAttendance } from './tour-attendance';
import { tourHistory } from './tour-history';
const now = new Date('2026-10-05T14:00:00Z'), start = '2026-10-05T12:10:00Z';
const event: VisitEvent = { id: 1, viewingId: 10, kind: 'arrival', supersedesId: null, actorId: 8, actorRole: 'chef', source: 'visitor',
  actualAt: '2026-10-05T12:00:00Z', recordedAt: '2026-10-05T12:00:00Z', scheduledAt: start, appointmentRevision: 1,
  result: null, sharedExplanation: null, internalNotes: null, data: {} };
const tour = { id: 10, status: 'confirmed', targetedKitchenId: 40, durationMinutes: 30, updatedAt: now, scheduledAt: start, checkedInAt: event.actualAt, visitResult: null };
it('uses only the effective corrected fact and keeps the original event', () => {
  const correction = { ...event, id: 2, supersedesId: 1, actualAt: '2026-10-05T12:05:00Z', recordedAt: now,
    source: 'correction', actorRole: 'manager', sharedExplanation: 'The visitor verified the actual time.' };
  const projection = projectVisitEvidence({ ...tour, checkedInAt: correction.actualAt }, [event, correction], now);
  expect(projection.visitEvidenceState).toBe('ready'); expect(projection.attendanceEvidence).toHaveLength(1);
  expect(projection.attendanceEvidence[0].actualAt).toBe('2026-10-05T12:05:00.000Z'); expect(event.actualAt).toBe('2026-10-05T12:00:00Z');
});
it.each(['scalar', 'duplicate', 'schedule', 'future', 'result'])('quarantines %s disagreement without exposing unverified times', problem => {
  const events = problem === 'duplicate' ? [event, { ...event, id: 2 }] : [{ ...event,
    ...(problem === 'schedule' ? { scheduledAt: '2026-10-06T12:10:00Z' } : {}), ...(problem === 'future' ? { recordedAt: '2030-01-01T12:00:00Z' } : {}) }];
  const input = { ...tour, ...(problem === 'scalar' ? { checkedInAt: '2026-10-05T12:06:00Z' } : {}), ...(problem === 'result' ? { visitResult: 'completed' } : {}) };
  const evidence = projectVisitEvidence(input, events, now); expect(evidence.visitEvidenceState).toBe('review');
  const publicState = publicTourAttendanceState(tourAttendance({ ...input, ...evidence }, 20, now));
  expect(publicState).toMatchObject({ checkedInAt: null, canCheckOut: false, canCheckIn: false, attendanceHistory: [] });
});
it('an explained admin repair explicitly retires old facts while preserving all evidence', () => {
  const repair = { ...event, id: 2, kind: 'repair', source: 'admin_repair', actorRole: 'admin', actualAt: null,
    sharedExplanation: 'No reliable arrival can be established.', data: { retiredIds: [1] } };
  const result = projectVisitEvidence({ ...tour, checkedInAt: null }, [event, repair], now);
  expect(result.visitEvidenceState).toBe('ready'); expect(result.attendanceEvidence).toEqual([]);
  expect(projectVisitEvidence({ ...tour, checkedInAt: null }, [event, { ...repair, actorRole: 'chef' }], now).visitEvidenceState).toBe('review');
});
it('public history projects correction facts without raw provenance or invented result timestamps', () => {
  const corrected = { ...event, id: 2, source: 'correction', supersedesId: 1, sharedExplanation: 'Shared explanation', internalNotes: 'PRIVATE', data: { secret: 'PRIVATE' } };
  const unknown = { ...event, id: 3, kind: 'result', result: 'completed', actualAt: null, data: { timestampUnknown: true } };
  const history = tourHistory({}, [], [event, corrected, unknown]);
  expect(history.events.map(event => event.kind)).toEqual(['visitor_checkin', 'attendance_corrected']);
  expect(JSON.stringify(history)).not.toMatch(/PRIVATE|actorId|supersedesId/);
});
