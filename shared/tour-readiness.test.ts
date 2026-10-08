import { describe, expect, it } from 'vitest';
import { hasTourInstructions, tourReadiness } from './tour-readiness';

const notes = { arrivalNotes: 'Meet at reception', departureNotes: 'Return badge' };
const hours = [{ dayOfWeek: 1, startTime: '09:00', endTime: '09:45', isAvailable: true }];

describe('tour activation requirements', () => {
  it('requires both real instructions and a usable schedule without treating readiness as activation', () => {
    expect(hasTourInstructions({ ...notes, arrivalNotes: '  ' })).toBe(false);
    expect(tourReadiness(null, []).ready).toBe(false);
    expect(tourReadiness({ ...notes, departureNotes: null }, hours).ready).toBe(false);
    expect(tourReadiness(notes, []).ready).toBe(false);
    expect(tourReadiness({ ...notes, isActive: false }, hours)).toMatchObject({ ready: true, completed: 3 });
  });
  it('includes tour duration and buffers, rejects malformed hours, and supports overnight windows', () => {
    expect(tourReadiness({ ...notes, bufferBeforeMinutes: 1 }, hours).ready).toBe(false);
    expect(tourReadiness(notes, [{ ...hours[0], endTime: '09:00' }]).ready).toBe(false);
    expect(tourReadiness(notes, [{ ...hours[0], startTime: '25:00' }]).ready).toBe(false);
    expect(tourReadiness(notes, [{ ...hours[0], isAvailable: false }]).ready).toBe(false);
    expect(tourReadiness(notes, [{ ...hours[0], startTime: '23:30', endTime: '00:15' }]).ready).toBe(true);
  });
});
