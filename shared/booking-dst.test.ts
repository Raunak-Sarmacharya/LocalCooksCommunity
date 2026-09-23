import { describe, expect, it } from 'vitest';
import { isUnambiguousBookingSlot, matchingLocalInstants } from './booking-dst';

describe('Newfoundland daylight saving booking slots', () => {
  const zone = 'America/St_Johns';
  const slot = (startTime: string, endTime: string) => ({ startTime, endTime });

  it('closes the Saturday operating day at the first Sunday 01:00', () => {
    expect(matchingLocalInstants('2026-11-01', '01:00', zone)).toHaveLength(2);
    expect(isUnambiguousBookingSlot('2026-10-31', slot('00:00', '01:00'), '08:00', zone)).toBe(true);
    expect(isUnambiguousBookingSlot('2026-10-31', slot('01:00', '02:00'), '08:00', zone)).toBe(false);
  });

  it('pauses hours that cross the missing spring hour', () => {
    expect(matchingLocalInstants('2026-03-08', '02:00', zone)).toHaveLength(0);
    expect(isUnambiguousBookingSlot('2026-03-07', slot('01:00', '02:00'), '08:00', zone)).toBe(false);
  });
});
