import { beforeEach, describe, expect, it } from 'vitest';
import { buildDatedDays, datedDayError, dateSelectionReason, readDatedDraft, type DayResources } from './dated-booking-draft';
import { bookingDaysIcs } from '@/lib/booking-ics';

const resources: Record<string, DayResources> = {
  '2030-03-09': { slots: ['22:00', '23:00', '00:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: false })), windowStartTime: '22:00', fullDay: true, equipmentIds: [1, 2] },
  '2030-03-11': { slots: ['09:00', '10:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: false })), fullDay: true, equipmentIds: [1] },
};
beforeEach(() => sessionStorage.clear());
describe('dated drafts', () => {
  it('allows exactly first + 14 through a DST week and refuses + 15, duplicates do not spend the count', () => {
    expect(dateSelectionReason('2030-03-23', ['2030-03-09'], 7)).toBeNull();
    expect(dateSelectionReason('2030-03-24', ['2030-03-09'], 7)).toBe('span');
    expect(dateSelectionReason('2030-03-09', ['2030-03-09'], 1)).toBeNull();
    expect(dateSelectionReason('2030-03-10', ['2030-03-09'], 1)).toBe('count');
    expect(dateSelectionReason('2030-02-23', ['2030-03-09'], 7)).toBeNull();
    expect(dateSelectionReason('2030-02-22', ['2030-03-09'], 7)).toBe('span');
  });
  it('uses per-day opening windows, orders overnight slots and filters unavailable or unticked equipment', () => {
    const days = buildDatedDays(['2030-03-11', '2030-03-09'], { pricingMode: 'hourly', times: ['00:00', '23:00'] },
      { '2030-03-11': { pricingMode: 'daily', times: [] } }, [1, 2], { '2030-03-09': [2] }, resources);
    expect(days[0].slots).toEqual([{ startTime: '23:00', endTime: '00:00' }, { startTime: '00:00', endTime: '01:00' }]);
    expect(days[1].slots).toEqual([{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }]);
    expect(days.map(day => day.equipmentIds)).toEqual([[1], [1]]);
    expect(datedDayError(days[0], resources[days[0].date], 1, 1)).toBeTruthy();
    expect(datedDayError(days[1], resources[days[1].date], 1, 1)).toBeNull(); // full day bypasses hourly cap
    expect(datedDayError(days[1], { ...resources[days[1].date], fullDay: false }, 1, 1)).toBe('fullDay');
  });
  it('rejects malformed saved drafts rather than restoring unchecked hours or calendar dates', () => {
    const draft = { version: 1, dates: ['2030-03-09', '2030-03-11'], template: { pricingMode: 'hourly', times: ['09:00'] }, hours: {}, equipmentIds: [1], excluded: {}, notes: '' };
    sessionStorage.setItem('kitchen_booking_days_4', JSON.stringify(draft)); expect(readDatedDraft(4)).toEqual(draft);
    for (const patch of [{ dates: ['2030-02-30', '2030-03-01'] }, { dates: ['2030-03-09', '2030-03-09'] }, { template: { pricingMode: 'hourly', times: ['99:00'] } }, { equipmentIds: ['1'] }]) {
      sessionStorage.setItem('kitchen_booking_days_4', JSON.stringify({ ...draft, ...patch })); expect(readDatedDraft(4)).toBeNull();
    }
  });
  it('exports independent day events with stable visit UIDs, revision and cancellation state', () => {
    const days = [9, 11].map((date, index) => ({ uid: `booking-4-visit-${index + 1}`, revision: 2, title: 'Harbour Kitchen',
      start: new Date(`2030-03-${date.toString().padStart(2, '0')}T09:00:00Z`), end: new Date(`2030-03-${date.toString().padStart(2, '0')}T10:00:00Z`), cancelled: index === 1 }));
    const ics = bookingDaysIcs(days);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:booking-4-visit-1@localcooks.ca'); expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('STATUS:CANCELLED'); expect(ics).toContain('DTSTART:20300311T090000Z'); expect(ics).not.toContain('20300310');
  });
});
