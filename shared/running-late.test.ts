import { describe, expect, it } from 'vitest';
import { canReportRunningLate, cleanRunningLateNote, isRunningLateMinutes, runningLateExpectedAt, RUNNING_LATE_NOTE_MAX } from './running-late';

const start = new Date('2026-10-14T13:00:00Z'), end = new Date('2026-10-14T17:00:00Z');
const base = { status: 'confirmed', checkedIn: false, start, end };

describe('running late window', () => {
  it('opens 30 minutes before start and closes at the booked end', () => {
    expect(canReportRunningLate(base, start.getTime() - 31 * 60_000)).toBe(false);
    expect(canReportRunningLate(base, start.getTime() - 30 * 60_000)).toBe(true);
    expect(canReportRunningLate(base, start.getTime() + 60 * 60_000)).toBe(true);
    expect(canReportRunningLate(base, end.getTime())).toBe(false);
  });
  it('is closed once checked in or when the booking is not confirmed', () => {
    expect(canReportRunningLate({ ...base, checkedIn: true }, start.getTime())).toBe(false);
    expect(canReportRunningLate({ ...base, status: 'cancelled' }, start.getTime())).toBe(false);
    expect(canReportRunningLate({ ...base, status: 'pending' }, start.getTime())).toBe(false);
  });
});

describe('running late input', () => {
  it('accepts only the quick choices', () => {
    expect([15, 30, 60].every(isRunningLateMinutes)).toBe(true);
    expect([0, 10, 45, '15', null].some(isRunningLateMinutes)).toBe(false);
  });
  it('cleans the note', () => {
    expect(cleanRunningLateNote('  Stuck   in\n traffic ')).toBe('Stuck in traffic');
    expect(cleanRunningLateNote('   ')).toBeNull();
    expect(cleanRunningLateNote(5)).toBeNull();
    expect(cleanRunningLateNote('x'.repeat(500))).toHaveLength(RUNNING_LATE_NOTE_MAX);
  });
  it('computes the expected arrival from when the chef told the kitchen', () => {
    expect(runningLateExpectedAt('2026-10-14T13:22:00Z', 30).toISOString()).toBe('2026-10-14T13:52:00.000Z');
  });
});
