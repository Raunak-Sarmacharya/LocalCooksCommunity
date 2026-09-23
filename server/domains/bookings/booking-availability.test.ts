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

    it('blocks hourly slots inside an overnight booking on the operating-day timeline', () => {
        const overnight = [{ startTime: '08:00', endTime: '01:00' }];
        expect(hasBookingConflict(overnight, [{ startTime: '10:00', endTime: '11:00' }], false, '08:00')).toBe(true);
        expect(hasBookingConflict(overnight, [{ startTime: '00:00', endTime: '01:00' }], false, '08:00')).toBe(true);
        expect(hasBookingConflict(overnight, [{ startTime: '01:00', endTime: '02:00' }], false, '08:00')).toBe(false);
    });

    it('leaves gaps between separately selected hours available', () => {
        const selectedSlots = [{ startTime: '09:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }];
        const booking = [{ startTime: '09:00', endTime: '15:00', selectedSlots }];
        expect(hasBookingConflict(booking, [{ startTime: '11:00', endTime: '12:00' }], false, '08:00')).toBe(false);
        expect(hasBookingConflict(booking, [{ startTime: '14:00', endTime: '15:00' }], false, '08:00')).toBe(true);
    });
});
