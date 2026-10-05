import { describe, expect, it } from 'vitest';
import { tourAttendance } from './tour-attendance';
import { publicTour } from './tour-outcome';

const now = new Date('2026-10-05T12:00:00Z');
const tour = { id: 1, status: 'confirmed', targetedKitchenId: 2, scheduledAt: new Date('2026-10-05T12:15:00Z'),
  durationMinutes: 30, updatedAt: now };
describe('tour attendance evidence contract', () => {
  it('allows visitor attendance with no optional arrival or departure notes', () => {
    const withoutNotes = { ...tour, arrivalNotes: null, departureNotes: '' };
    expect(tourAttendance(withoutNotes, 15, now).canCheckIn).toBe(true);
    const evidence = { action: 'check_in', actorId: 8, source: 'visitor', actualAt: now.toISOString(),
      recordedAt: now.toISOString(), scheduledAt: tour.scheduledAt.toISOString() };
    expect(tourAttendance({ ...withoutNotes, checkedInAt: now, attendanceHistory: [evidence] }, 15, now).canCheckOut).toBe(true);
  });
  it('uses effective windows including boundaries and does not infer legacy attendance', () => {
    expect(tourAttendance(tour, 15, now).canCheckIn).toBe(true);
    expect(tourAttendance(tour, 5, now).reason).toContain('not opened');
    expect(tourAttendance(tour, 15, new Date('2026-10-05T12:45:00Z')).canCheckIn).toBe(true);
    expect(tourAttendance(tour, 15, new Date('2026-10-05T12:45:00.001Z')).reason).toContain('closed');
    expect(tourAttendance({ ...tour, status: 'completed', checkedInAt: null, attendanceHistory: null }, 15, now))
      .toMatchObject({ checkedInAt: null, checkedOutAt: null, attendanceHistory: [], canCheckIn: false });
  });
  it('keeps attendance through public list projection while omitting internal notes', () => {
    const evidence = { ...tour, checkedInAt: now, attendanceHistory: [{ action: 'check_in', actorId: 8, source: 'visitor', actualAt: now.toISOString(), recordedAt: now.toISOString(), scheduledAt: tour.scheduledAt.toISOString() }], managerNotes: 'private' };
    expect(publicTour(evidence)).toMatchObject({ checkedInAt: now, attendanceHistory: evidence.attendanceHistory });
    expect(publicTour(evidence)).not.toHaveProperty('managerNotes');
    expect(tourAttendance({ ...evidence, scheduledAt: new Date('2026-10-06T12:15:00Z') }, 15, now).safetyReason).toContain('different or unknown');
  });
  const entry = { action: 'check_in', actorId: 8, source: 'visitor', actualAt: now.toISOString(),
    recordedAt: now.toISOString(), scheduledAt: tour.scheduledAt.toISOString() };
  it.each(['confirmed', 'completed', 'no_show', 'cancelled'])('allows departure after matching arrival in %s, before or after the due time', status => {
    for (const clock of [now, new Date('2026-10-06T12:00:00Z')]) {
      expect(tourAttendance({ ...tour, status, disruptionReason: 'weather', checkedInAt: now, attendanceHistory: [entry] }, 15, clock))
        .toMatchObject({ canCheckOut: true, checkOutOpensAt: now.toISOString(), checkOutDueAt: '2026-10-05T12:45:00.000Z' });
    }
  });
  it.each([
    { checkedInAt: now, attendanceHistory: [] },
    { checkedInAt: now, attendanceHistory: [{ ...entry, scheduledAt: '2026-10-06T12:15:00.000Z' }] },
    { checkedInAt: now, attendanceHistory: [null] },
    { checkedInAt: now, attendanceHistory: [{ ...entry, actorId: -1 }] },
    { checkedInAt: now, attendanceHistory: [{ ...entry, actualAt: 'bad' }] },
    { checkedInAt: now, attendanceHistory: [{ ...entry, recordedAt: '2026-10-06T12:00:00Z' }] },
    { checkedInAt: now, attendanceHistory: [entry, entry] },
    { checkedInAt: now, checkedOutAt: new Date(now.getTime() - 1), attendanceHistory: [entry] },
  ])('rejects unsafe stored evidence without enabling a write', evidence => {
    const result = tourAttendance({ ...tour, ...evidence }, 15, now);
    expect(result.canCheckOut).toBe(false); expect(result.canAssistArrival).toBe(false);
    expect(result.departureSafetyReason).toContain('invalid evidence');
  });
  it('requires arrival and separates assistance reason from private metadata', () => {
    expect(tourAttendance(tour, 15, now).checkOutReason).toContain('arrival before departure');
    const assisted = { ...entry, source: 'manager_assisted', actorId: 2, reason: 'Visitor reported lost connection', internalNotes: 'SECRET' };
    const result = tourAttendance({ ...tour, checkedInAt: now, attendanceHistory: [assisted] }, 15, now);
    expect(result.attendanceHistory[0]).toMatchObject({ reason: assisted.reason, source: 'manager_assisted', actorId: 2 });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(publicTour({ ...tour, attendanceHistory: [assisted] }))).not.toContain('SECRET');
  });
});
