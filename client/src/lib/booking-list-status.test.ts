import { describe, expect, it } from 'vitest';
import { bookingListPhase, bookingPhasePillKey, showArrivalLine } from './booking-list-status';

const base = { bookingDate: '2026-10-14T12:00:00.000Z', startTime: '09:30', endTime: '10:30', locationTimezone: 'America/St_Johns' };
// 9:30 a.m. NDT = 13:00Z; 10:30 = 14:00Z
const after = Date.parse('2026-10-14T20:00:00Z');
const before = Date.parse('2026-10-10T20:00:00Z');

describe('bookingListPhase', () => {
  it('shows a completed booking as completed, never pending', () => {
    expect(bookingListPhase({ ...base, status: 'completed', checkinStatus: 'checked_out' }, after)).toBe('completed');
    expect(bookingPhasePillKey('completed', true)).toBe('bdhPill_completed');
  });
  it('shows a DB-confirmed checked-out booking as completed', () => {
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_out' }, after)).toBe('completed');
  });
  it('shows a confirmed booking past its end as visit ended', () => {
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'not_checked_in' }, after)).toBe('visit_ended');
  });
  it('keeps pending, confirmed, in session and checkout review apart', () => {
    expect(bookingListPhase({ ...base, status: 'pending' }, before)).toBe('pending');
    expect(bookingListPhase({ ...base, status: 'confirmed' }, before)).toBe('confirmed');
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_in' }, Date.parse('2026-10-14T13:30:00Z'))).toBe('in_session');
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checkout_requested' }, after)).toBe('checkout_review');
  });
  it('maps phases to the same pill words as the details header', () => {
    expect(bookingPhasePillKey('checkin_open', true)).toBe('bdhPill_today');
    expect(bookingPhasePillKey('time_ended_in_session', true)).toBe('bdhPill_in_session');
    expect(bookingPhasePillKey('checkout_review', true)).toBe('bdhPill_checkout_review');
    expect(bookingPhasePillKey('checkout_review', false)).toBe('bdhPill_checkout_submitted');
  });
  it('shows the arrival line only when useful', () => {
    expect(showArrivalLine('in_session')).toBe(true);
    expect(showArrivalLine('completed')).toBe(true);
    expect(showArrivalLine('pending')).toBe(false);
    expect(showArrivalLine('confirmed')).toBe(false);
  });
  it('survives an unreadable schedule', () => {
    expect(bookingListPhase({ status: 'confirmed', bookingDate: 'x', startTime: 'y', endTime: 'z' }, after)).toBe('confirmed');
  });
});
