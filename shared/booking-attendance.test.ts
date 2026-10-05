import { describe, expect, it } from 'vitest';
import { bookingAttendanceEnd, bookingOperationsComplete, hasBookingAttendanceEvidence, publicBookingAttendanceNotes, visitAttendanceEnd } from './booking-attendance';

describe('Newfoundland booking attendance', () => {
  const booking = { bookingDate: '2026-10-02', startTime: '09:00', endTime: '17:00', status: 'confirmed' };
  it('keeps scheduled completion independent of attendance and inspection', () => {
    expect(bookingOperationsComplete(booking, new Date('2026-10-02T19:29:59Z'))).toBe(false);
    expect(bookingOperationsComplete(booking, new Date('2026-10-02T19:30:00Z'))).toBe(true);
    expect(bookingOperationsComplete({ ...booking, status: 'cancelled' }, new Date('2026-10-03'))).toBe(false);
  });
  it.each([
    ['2026-01-10', '09:00', '17:00', undefined, '2026-01-10T20:30:00.000Z'],
    ['2026-07-10', '09:00', '17:00', undefined, '2026-07-10T19:30:00.000Z'],
    ['2026-03-08', '00:00', '04:00', undefined, '2026-03-08T06:30:00.000Z'],
    ['2026-11-01', '00:00', '04:00', undefined, '2026-11-01T07:30:00.000Z'],
    ['2026-10-31', '20:00', '01:00', '20:00', '2026-11-01T03:30:00.000Z'],
    ['2026-10-02', '20:00', '02:00', '20:00', '2026-10-03T04:30:00.000Z'],
    ['2026-10-02', '20:00', '02:00', undefined, '2026-10-03T04:30:00.000Z'],
  ])('resolves %s end %s–%s across DST and overnight boundaries', (bookingDate, startTime, endTime, operatingWindowStartTime, expected) => {
    expect(bookingAttendanceEnd({ bookingDate, startTime, endTime, operatingWindowStartTime }).toISOString()).toBe(expected);
  });
  it('does not normalize a nonexistent spring end into another scheduled time', () => {
    expect(() => bookingAttendanceEnd({ bookingDate: '2026-03-08', startTime: '00:00', endTime: '02:00' })).toThrow(/not a valid Newfoundland/);
  });
  it('ends each separated overnight visit on its own operating-day boundary', () => {
    const parent = { bookingDate: '2026-10-31', startTime: '20:00', endTime: '04:00', operatingWindowStartTime: '20:00' };
    expect(visitAttendanceEnd(parent, { startTime: '20:00', endTime: '22:00' }).toISOString()).toBe('2026-11-01T00:30:00.000Z');
    expect(visitAttendanceEnd(parent, { startTime: '01:00', endTime: '02:00' }).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it.each(['checkedInAt', 'checkoutRequestedAt', 'checkedOutAt', 'checkoutApprovedAt', 'actualStartTime', 'actualEndTime', 'checkinNotes'])('treats %s as contradictory evidence', key => {
    expect(hasBookingAttendanceEvidence({ checkinStatus: 'not_checked_in', [key]: 'evidence' })).toBe(true);
  });
  it('keeps optional missing attendance unknown and missing checkout as evidence of attendance', () => {
    expect(hasBookingAttendanceEvidence({ checkinStatus: null })).toBe(false);
    expect(hasBookingAttendanceEvidence({ checkinStatus: 'checked_in' })).toBe(true);
    expect(hasBookingAttendanceEvidence({ checkinStatus: 'not_checked_in', checkinPhotoUrls: ['photo'] })).toBe(true);
  });
  it('protects historical and unlabelled manager notes without editing source evidence', () => {
    const source = { checkedInMethod: 'manager', checkinNotes: 'Private manager evidence', checkoutNotes: 'Historical review by admin 1: private' };
    expect(publicBookingAttendanceNotes(source)).toMatchObject({ checkinNotes: null, checkoutNotes: null });
    expect(source.checkoutNotes).toContain('private');
    expect(publicBookingAttendanceNotes({ checkinNotes: 'Message from kitchen manager: Hello' }).checkinNotes).toContain('Hello');
  });
  it('retains chef checkout messages after new reviews without sharing old internal notes', () => {
    expect(publicBookingAttendanceNotes({ checkoutNotes: 'Chef message', checkoutApprovedAt: new Date(), checkoutManagerMessage: '' }).checkoutNotes).toBe('Chef message');
    expect(publicBookingAttendanceNotes({ checkoutNotes: 'Legacy private text', checkoutApprovedAt: new Date(), checkoutManagerMessage: null }).checkoutNotes).toBeNull();
  });
});
