import { describe, expect, it } from 'vitest';
import { instructionReleaseAt, isInstructionReleased } from './instruction-release';
import { createBookingDateTime } from './timezone-utils';

describe('instruction release instants', () => {
  it('releases at the exact configured preparation instant', () => {
    const start = new Date('2026-10-20T12:00:00Z');
    const at = instructionReleaseAt(start, 48);
    expect(at.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(isInstructionReleased(new Date(at.getTime() - 1), start, 48)).toBe(false);
    expect(isInstructionReleased(at, start, 48)).toBe(true);
    expect(isInstructionReleased(start, start, 48)).toBe(true);
  });
  it('uses elapsed hours across Newfoundland DST and the half-hour timezone', () => {
    const start = createBookingDateTime('2026-11-01', '10:00', 'America/St_Johns');
    expect(start.toISOString()).toBe('2026-11-01T13:30:00.000Z');
    expect(instructionReleaseAt(start, 48).toISOString()).toBe('2026-10-30T13:30:00.000Z');
  });
});
