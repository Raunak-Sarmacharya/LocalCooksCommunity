import { describe, expect, it } from 'vitest';
import { canChefRequestReschedule, canManagerProposeReschedule, tourRescheduleCutoff } from './tour-reschedule';

describe('Newfoundland tour reschedule policy', () => {
  it.each([
    ['2026-10-10T12:30:00Z', '2026-10-10T02:30:00.000Z'],
    ['2026-12-10T13:30:00Z', '2026-12-10T03:30:00.000Z'],
    ['2026-11-01T13:30:00Z', '2026-11-01T02:30:00.000Z'],
  ])('closes at the local visit-day midnight across daylight saving boundaries', (scheduledAt, cutoff) => {
    expect(tourRescheduleCutoff(scheduledAt).toISOString()).toBe(cutoff);
    const tour = { status: 'confirmed', scheduledAt };
    expect(canChefRequestReschedule(tour, new Date(Date.parse(cutoff) - 1))).toBe(true);
    expect(canChefRequestReschedule(tour, new Date(cutoff))).toBe(false);
    expect(canManagerProposeReschedule(tour, new Date(cutoff))).toBe(true);
  });
  it('blocks parallel requests and changes after arrival or the confirmed start', () => {
    const tour = { status: 'confirmed', scheduledAt: '2026-10-10T12:30:00Z' }, now = new Date('2026-10-09T12:00:00Z');
    for (const extra of [{ checkedInAt: now }, { requestedRescheduleAt: now }, { rescheduleProposedSlots: ['2026-10-11T12:30:00Z'] }, { status: 'cancelled' }]) {
      expect(canChefRequestReschedule({ ...tour, ...extra }, now)).toBe(false);
      expect(canManagerProposeReschedule({ ...tour, ...extra }, now)).toBe(false);
    }
    expect(canManagerProposeReschedule(tour, new Date(tour.scheduledAt))).toBe(false);
  });
  it.each(['pending_local_cooks', 'pending'])('allows editing the %s requested time until its start', status => {
    const scheduledAt = '2026-10-10T12:30:00Z';
    expect(canChefRequestReschedule({ status, scheduledAt }, new Date('2026-10-10T12:29:59Z'))).toBe(true);
    expect(canChefRequestReschedule({ status, scheduledAt }, new Date(scheduledAt))).toBe(false);
  });
  it('allows manager alternatives after triage, with parallel chef edits blocked', () => {
    const tour = { status: 'pending', scheduledAt: '2026-10-10T12:30:00Z' }, now = new Date('2026-10-09T12:00:00Z');
    expect(canManagerProposeReschedule(tour, now)).toBe(true);
    expect(canManagerProposeReschedule({ ...tour, status: 'pending_local_cooks' }, now)).toBe(false);
    expect(canChefRequestReschedule({ ...tour, rescheduleProposedSlots: ['2026-10-11T12:30:00Z'] }, now)).toBe(false);
  });
});
