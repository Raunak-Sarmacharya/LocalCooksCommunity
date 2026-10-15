import { describe, it, expect } from 'vitest';
import { settingImpact, type ImpactBooking } from './setting-impact';
const row: ImpactBooking = { kitchenId: 1, status: 'confirmed', bookingDate: '2026-10-14', startTime: '10:00', timezone: 'America/St_Johns' };
describe('settingImpact', () => {
  it('counts future confirmed, checked-in and pending bookings only within the kitchen', () => {
    expect(settingImpact([row, row, row, { ...row, checkinStatus: 'checked_in' }, { ...row, status: 'pending' },
      { ...row, kitchenId: 2 }, { ...row, status: 'cancelled' }], 1, new Date('2026-10-14T09:00:00Z')))
      .toEqual({ upcoming: 3, inSession: 1, pending: 1 });
  });
  it('uses the operating day for overnight visits and never guesses a missing timezone', () => {
    expect(settingImpact([{ ...row, startTime: '00:15', operatingWindowStartTime: '06:00' }], 1, new Date('2026-10-15T01:00:00Z')).upcoming).toBe(1);
    expect(settingImpact([{ ...row, timezone: null }], 1).upcoming).toBe(0);
    expect(settingImpact([], 1)).toEqual({ upcoming: 0, inSession: 0, pending: 0 });
  });
});
