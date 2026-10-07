import { describe, expect, it } from 'vitest';
import { tourVisitTime, validateTourVisitInput } from './tour-visit-input';

describe('Newfoundland visit time input', () => {
  it('converts calendar input independently of the device timezone', () => {
    expect(tourVisitTime('2026-10-05', '09:25').actual?.toISOString()).toBe('2026-10-05T11:55:00.000Z');
  });
  it('rejects a spring gap and requires a choice for both autumn occurrences', () => {
    expect(tourVisitTime('2026-03-08', '02:30').error).toBe('visit_time_gap');
    expect(tourVisitTime('2026-11-01', '01:30').error).toBe('visit_time_ambiguous');
    expect(tourVisitTime('2026-11-01', '01:30', 'earlier').actual?.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(tourVisitTime('2026-11-01', '01:30', 'later').actual?.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
  it.each([['2026-02-30', '10:00'], ['2026-10-05', '25:00'], ['', '10:00']])('rejects invalid fields %s %s', (date, time) => {
    expect(tourVisitTime(date, time).error).toBeTruthy();
  });
  it('validates explanations, future time and old-client explicit instants without ambiguity', () => {
    const input = { action: 'arrival', actualDate: '2026-10-05', actualTime: '09:25', reason: 'Visitor confirmed the actual arrival' };
    const now = new Date('2026-10-05T12:00:00Z');
    expect(validateTourVisitInput(input, now).actual.toISOString()).toBe('2026-10-05T11:55:00.000Z');
    expect(() => validateTourVisitInput({ ...input, actualTime: '10:00' }, now)).toThrow('visit_time_future');
    expect(() => validateTourVisitInput({ ...input, reason: ' ' }, now)).toThrow('visit_reason_required');
    expect(() => validateTourVisitInput({ ...input, actualAt: '2026-10-05T10:00:00Z' }, now)).toThrow('visit_time_invalid');
    expect(validateTourVisitInput({ action: 'departure', actualAt: '2026-10-05T11:55:00Z', reason: input.reason }, now).actual.toISOString()).toBe('2026-10-05T11:55:00.000Z');
    expect(() => validateTourVisitInput({ action: 'arrival', actualAt: '2026-10-05T11:55:00', reason: input.reason }, now)).toThrow('visit_time_required');
  });
});
