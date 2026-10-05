import { describe, expect, it, vi } from 'vitest';
const capacity = vi.hoisted(() => ({ holds: vi.fn(async () => []), override: vi.fn(async () => ({ isAvailable: true, startTime: '08:00', endTime: '18:00' })) }));
vi.mock('../../db', () => ({ db: { select: () => { const query: any = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => [{ timezone: 'America/St_Johns' }] }; return query; } } }));
vi.mock('../kitchens/kitchen.service', () => ({ kitchenService: { getKitchenDateOverrideForDate: capacity.override } }));
vi.mock('../../services/kitchen-checkout-holds', () => ({ getActiveKitchenHolds: capacity.holds }));
import { bookingService, hasBookingConflict } from './booking.service';
import { addHour } from '@shared/operating-hours';

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

it('rejects new manipulated gaps and malformed slots before inventory lookup', async () => {
    const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([]);
    for (const selectedSlots of [
        [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }],
        [{ startTime: '09:00', endTime: '10:00' }, { startTime: '09:00', endTime: '10:00' }],
        [{ startTime: '25:00', endTime: '26:00' }], null, '09:00,11:00',
    ]) {
        expect(await bookingService.validateBookingAvailability(4, new Date('2099-10-04T12:00:00Z'), '09:00', '12:00', { selectedSlots: selectedSlots as any })).toMatchObject({ valid: false });
    }
    expect(bookings).not.toHaveBeenCalled();
    bookings.mockRestore();
});

it('accepts adjacent overnight and daily requests but rejects an intervening hold', async () => {
    capacity.override.mockResolvedValueOnce({ isAvailable: true, startTime: '22:00', endTime: '02:00' });
    const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([]);
    const date = new Date('2099-10-04T12:00:00Z');
    expect(await bookingService.validateBookingAvailability(4, date, '23:00', '01:00', {
        selectedSlots: ['00:00', '23:00'].map(startTime => ({ startTime, endTime: addHour(startTime) })),
    })).toMatchObject({ valid: true, slots: [{ startTime: '23:00', endTime: '00:00' }, { startTime: '00:00', endTime: '01:00' }] });
    expect(await bookingService.validateBookingAvailability(4, date, '08:00', '18:00', { fullDay: true })).toMatchObject({ valid: true });
    capacity.holds.mockResolvedValueOnce([{ operatingDate: '2099-10-04', windowStartTime: '08:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }] }] as never[]);
    expect(await bookingService.validateBookingAvailability(4, date, '09:00', '12:00')).toMatchObject({ valid: false, error: expect.stringContaining('reserved') });
    bookings.mockRestore();
});

it('paid availability ignores a tour commitment but rejects competing paid inventory and holds', async () => {
    // A tour is deliberately absent from the paid repository/hold ledgers: it consumes no paid capacity.
    const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([]);
    const validate = () => bookingService.validateBookingAvailability(4, new Date('2099-10-04T12:00:00Z'), '10:00', '11:00');
    expect(await validate()).toMatchObject({ valid: true });
    bookings.mockResolvedValue([{ bookingDate: new Date('2099-10-04T12:00:00Z'), status: 'confirmed', startTime: '10:00', endTime: '11:00' }] as any);
    expect(await validate()).toMatchObject({ valid: false, error: expect.stringContaining('no longer available') });
    bookings.mockResolvedValue([]);
    capacity.holds.mockResolvedValue([{ operatingDate: '2099-10-04', windowStartTime: '08:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }] }] as never[]);
    expect(await validate()).toMatchObject({ valid: false, error: expect.stringContaining('temporarily reserved') });
    bookings.mockRestore();
    capacity.holds.mockResolvedValue([]);
});
