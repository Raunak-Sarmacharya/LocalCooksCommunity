import { describe, expect, it } from 'vitest';
import { hasBookingConflict } from './booking.service';

describe('hasBookingConflict', () => {
    const existing = [{ startTime: '10:00', endTime: '11:00' }];

    it('blocks a full-day booking when any slot is already allotted', () => {
        expect(hasBookingConflict(existing, [{ startTime: '09:00', endTime: '17:00' }], true)).toBe(true);
    });

    it('blocks overlapping slots but allows adjacent hourly slots', () => {
        expect(hasBookingConflict(existing, [{ startTime: '10:00', endTime: '11:00' }])).toBe(true);
        expect(hasBookingConflict(existing, [{ startTime: '11:00', endTime: '12:00' }])).toBe(false);
    });
});
