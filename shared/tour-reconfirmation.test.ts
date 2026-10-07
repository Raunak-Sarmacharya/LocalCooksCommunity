import { expect, it } from 'vitest';
import { resetTourReconfirmation, tourReconfirmation, tourReconfirmationEventKey } from './tour-reconfirmation';
const tour = { status: 'confirmed', scheduledAt: '2026-10-03T12:00:00Z', confirmedAt: '2026-10-01T12:00:00Z', appointmentRevision: 1 };
it('asks24hours before and escalates12hours after ask or6hours before whichever first', () => {
  expect(tourReconfirmation(tour, 2, Date.parse('2026-10-02T11:59:59Z')).canReply).toBe(false);
  expect(tourReconfirmation(tour, 2, Date.parse('2026-10-02T12:00:00Z'))).toMatchObject({ canReply: true, needsStaffAttention: false, escalateAt: '2026-10-03T00:00:00.000Z' });
  expect(tourReconfirmation(tour, 2, Date.parse('2026-10-03T00:00:00Z')).needsStaffAttention).toBe(true);
});
it('starts a short-notice replacement deadline at acceptance, retaining the first confirmation', () => {
  const accepted = new Date('2026-10-03T00:00:00Z');
  const changed = { ...tour, ...resetTourReconfirmation(tour, accepted), scheduledAt: '2026-10-03T20:00:00Z' };
  expect(changed.confirmedAt).toBe(tour.confirmedAt);
  expect(tourReconfirmation(changed, 2, accepted.getTime())).toMatchObject({ askAt: accepted.toISOString(), escalateAt: '2026-10-03T12:00:00.000Z', needsStaffAttention: false });
});
it('pauses reconfirmation while a real time change is awaiting a decision', () => {
  for (const change of [{ requestedRescheduleAt: '2026-10-04T12:00:00Z' }, { rescheduleProposedSlots: ['2026-10-04T12:00:00Z'] }])
    expect(tourReconfirmation({ ...tour, ...change }, 2, Date.parse('2026-10-03T01:00:00Z'))).toMatchObject({ canReply: false, needsStaffAttention: false });
});
it('uses stable outbox keys across note edits and distinct keys for manager and appointment revisions', () => {
  const key = tourReconfirmationEventKey(tour as any, 2, 'reconfirmation_requested');
  expect(tourReconfirmationEventKey({ ...tour, updatedAt: new Date() } as any, 2, 'reconfirmation_requested')).toBe(key);
  expect(tourReconfirmationEventKey(tour as any, 3, 'reconfirmation_requested')).not.toBe(key);
  expect(tourReconfirmationEventKey({ ...tour, ...resetTourReconfirmation(tour) } as any, 2, 'reconfirmation_requested')).not.toBe(key);
});
it('uses elapsed hours across DST and does not apply an overnight quiet-hours delay', () => {
  for (const scheduledAt of ['2026-11-01T06:00:00Z', '2026-03-08T06:00:00Z']) {
    const start = Date.parse(scheduledAt);
    const state = tourReconfirmation({ ...tour, confirmedAt: new Date(start - 72 * 3600000), scheduledAt }, 2, start - 24 * 3600000);
    expect(state.canReply).toBe(true);
    expect(Date.parse(state.askAt!)).toBe(start - 24 * 3600000);
  }
});
it('short notice requests and escalates immediately but silence keeps confirmation', () => {
  const short = { ...tour, confirmedAt: '2026-10-03T10:00:00Z' };
  expect(tourReconfirmation(short, 2, Date.parse(short.confirmedAt))).toMatchObject({ canReply: true, needsStaffAttention: true });
  expect(short.status).toBe('confirmed');
});
it('binds replies to acceptedappointment revision and current location manager, and closes on arrival', () => {
  const replied = { ...tour, reconfirmationReply: 'still_coming', reconfirmationReplyRevision: '1:2', reconfirmationRepliedAt: '2026-10-02T13:00:00Z' };
  expect(tourReconfirmation(replied, 2, Date.parse('2026-10-03T01:00:00Z')).needsStaffAttention).toBe(false);
  expect(tourReconfirmation(replied, 3).reply).toBeNull();
  expect(tourReconfirmation({ ...replied, ...resetTourReconfirmation(replied) }, 2).reply).toBeNull();
  expect(tourReconfirmation({ ...tour, checkedInAt: '2026-10-03T11:55:00Z' }, 2).canReply).toBe(false);
});
