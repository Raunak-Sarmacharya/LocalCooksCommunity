import { describe, expect, it } from 'vitest';
import { publicBookingResponse } from './booking-attendance-privacy';
describe('shared kitchen attendance response privacy', () => {
  it('redacts private notes in nested booking and visit responses, preserving originals', () => {
    const booking = { bookingDate: '2026-10-02', startTime: '09:00', checkoutNotes: 'Historical review by admin 1: SECRET',
      visits: [{ bookingId: 1, blockIndex: 0, checkedInMethod: 'manager', checkinNotes: 'SECRET', checkoutNotes: 'Manager: SECRET' }] };
    const result = publicBookingResponse({ bookings: [booking] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(booking.checkoutNotes).toContain('SECRET');
  });
  it('preserves explicitly labelled manager messages and chef evidence', () => {
    const booking = { bookingDate: '2026-10-02', startTime: '09:00', checkedInMethod: 'self', checkinNotes: 'Chef arrived',
      checkoutApprovedAt: new Date(), checkoutNotes: 'Message from kitchen manager: Thank you' };
    expect(publicBookingResponse(booking)).toEqual(booking);
  });
});
