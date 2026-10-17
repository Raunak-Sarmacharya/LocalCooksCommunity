import { describe, expect, it, vi } from 'vitest';
const capacity = vi.hoisted(() => ({ holds: vi.fn(async () => []), override: vi.fn(async () => ({ isAvailable: true, startTime: '08:00', endTime: '18:00' })) }));
vi.mock('../../db', () => ({ db: { select: () => { const query: any = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => [{ timezone: 'America/St_Johns' }], then: (resolve: any) => resolve([]) }; return query; } } }));
vi.mock('../kitchens/kitchen.service', () => ({ kitchenService: { getKitchenDateOverrideForDate: capacity.override, getKitchenById: async () => ({ id: 4 }),
  getMonthAvailability: async () => Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2099-10-${String(i + 1).padStart(2, '0')}`, true])),
  getKitchenAvailability: async () => Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isAvailable: true, startTime: '08:00', endTime: '18:00' })),
  getKitchenDateOverrides: async () => [] } }));
vi.mock('../../services/kitchen-checkout-holds', () => ({ getActiveKitchenHolds: capacity.holds }));
vi.mock('../../services/booking-policy-settings', () => ({ kitchenBookingPolicies: async () => policy }));
const policy = { maxAdvanceBookingDays: 100000, turnoverBufferEnabled: false, timezone: 'America/St_Johns' };
import { bookingService, slotConflict } from './booking.service';
import { datedOccupiedSlots } from '@shared/booking-occupancy';
import { addHour } from '@shared/operating-hours';

// Replaces the date-blind hasBookingConflict: every occupied slot is dated and anchored (later days included).
describe('slotConflict', () => {
    const context = { current: 0, candidate: 0, ignoreBuffer: false, timezone: 'America/St_Johns' };
    const entries = (booking: { startTime: string; endTime: string; selectedSlots?: unknown; operatingWindowStartTime?: string }) =>
        datedOccupiedSlots({ bookingDate: '2099-10-04', ...booking }).map(slot => ({ slot, buffer: null, kind: 'booked' as const }));
    const at = (startTime: string, endTime: string, windowStartTime = '08:00') => ({ date: '2099-10-04', windowStartTime, startTime, endTime });

    it('blocks overlapping slots but allows adjacent hourly slots', () => {
        const existing = entries({ startTime: '10:00', endTime: '11:00', operatingWindowStartTime: '08:00' });
        expect(slotConflict(existing, at('10:00', '11:00'), context)).toEqual({ source: 'booked', buffer: false });
        expect(slotConflict(existing, at('11:00', '12:00'), context)).toBeNull();
    });

    it('blocks hourly slots inside an overnight booking on the operating-day timeline', () => {
        const overnight = entries({ startTime: '08:00', endTime: '01:00', operatingWindowStartTime: '08:00' });
        expect(slotConflict(overnight, at('10:00', '11:00'), context)).not.toBeNull();
        expect(slotConflict(overnight, at('00:00', '01:00'), context)).not.toBeNull();
        expect(slotConflict(overnight, at('01:00', '02:00'), context)).toBeNull();
    });

    it('leaves gaps between separately selected hours available', () => {
        const selectedSlots = [{ startTime: '09:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }];
        const booking = entries({ startTime: '09:00', endTime: '15:00', selectedSlots, operatingWindowStartTime: '08:00' });
        expect(slotConflict(booking, at('11:00', '12:00'), context)).toBeNull();
        expect(slotConflict(booking, at('14:00', '15:00'), context)).not.toBeNull();
    });

    it('reads a later dated day from its own slot, not the booking\'s first date', () => {
        const dated = datedOccupiedSlots({ bookingDate: '2099-10-01', startTime: '10:00', endTime: '12:00', operatingWindowStartTime: '08:00',
            selectedSlots: [{ date: '2099-10-01', windowStartTime: '08:00', startTime: '10:00', endTime: '11:00' },
                { date: '2099-10-04', windowStartTime: '09:00', startTime: '11:00', endTime: '12:00' }] })
            .map(slot => ({ slot, buffer: null, kind: 'booked' as const }));
        expect(slotConflict(dated, at('11:00', '12:00'), context)).not.toBeNull();
        expect(slotConflict(dated, at('10:00', '11:00'), context)).toBeNull();
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

it('rejects chef creation and availability beyond the window but permits a kitchen move', async () => {
    policy.maxAdvanceBookingDays = 1;
    const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([]);
    const date = new Date('2099-10-04T12:00:00Z');
    await expect(bookingService.createKitchenBooking({ kitchenId: 4, chefId: 3, bookingDate: date, startTime: '10:00', endTime: '11:00' } as any)).rejects.toThrow('This kitchen takes bookings up to 1 days ahead.');
    expect(await bookingService.getAvailableTimeSlots(4, date)).toEqual([]);
    expect(await bookingService.getAllTimeSlotsWithBookingInfo(4, date)).toEqual([]);
    expect(await bookingService.validateBookingAvailability(4, date, '10:00', '11:00')).toMatchObject({ valid: false, error: 'This kitchen takes bookings up to 1 days ahead.' });
    expect(await bookingService.validateBookingAvailability(4, date, '10:00', '11:00', { excludeBookingId: 1 })).toMatchObject({ valid: true });
    policy.maxAdvanceBookingDays = 100000;
    bookings.mockRestore();
});
it('pads active bookings and pending holds only when turnover is enabled, across overnight dates', async () => {
    const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([
      { id: 1, bookingDate: new Date('2099-10-03T12:00:00Z'), status: 'pending', startTime: '23:00', endTime: '08:30', operatingWindowStartTime: '22:00' },
    ] as any);
    const date = new Date('2099-10-04T12:00:00Z');
    policy.turnoverBufferEnabled = false;
    expect(await bookingService.validateBookingAvailability(4, date, '09:00', '10:00')).toMatchObject({ valid: true });
    expect(await bookingService.getAvailableTimeSlots(4, date)).toContain('09:00');
    policy.turnoverBufferEnabled = true;
    expect(await bookingService.validateBookingAvailability(4, date, '09:00', '10:00')).toMatchObject({ valid: false });
    expect(await bookingService.getAvailableTimeSlots(4, date)).not.toContain('09:00');
    expect(await bookingService.validateBookingAvailability(4, date, '09:00', '10:00', { excludeBookingId: 2 })).toMatchObject({ valid: false });
    expect(await bookingService.validateBookingAvailability(4, date, '10:00', '11:00')).toMatchObject({ valid: true });
    bookings.mockResolvedValue([]);
    capacity.holds.mockResolvedValueOnce([{ id: 'hold', operatingDate: '2099-10-04', windowStartTime: '08:00', selectedSlots: [{ startTime: '10:30', endTime: '11:30' }] }] as never[]);
    expect(await bookingService.validateBookingAvailability(4, date, '09:00', '10:00')).toMatchObject({ valid: false, error: expect.stringContaining('reserved') });
    policy.turnoverBufferEnabled = false;
    bookings.mockRestore();
});

it('marks dates beyond the effective window unavailable in the booking-wizard month API', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2099-10-01T12:00:00Z'));
  const bookings = vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue([]);
  policy.maxAdvanceBookingDays = 2;
  try {
    const month = await bookingService.getMonthBookableAvailability(4, 2099, 9);
    expect(month['2099-10-03']).toBe(true);
    expect(month['2099-10-04']).toBe(false);
  } finally { policy.maxAdvanceBookingDays = 100000; bookings.mockRestore(); vi.useRealTimers(); }
});
