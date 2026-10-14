import { describe, expect, it } from 'vitest';
import { isBookingListPast } from './booking-list-split';

const now = Date.parse('2026-10-14T15:00:00Z');
const endAt = (iso: string) => new Date(iso);

describe('isBookingListPast', () => {
  it('keeps a future confirmed visit upcoming', () => {
    expect(isBookingListPast({ status: 'confirmed', endAt: endAt('2026-10-16T14:00:00Z'), now })).toBe(false);
  });
  it('moves a visit past its end into past', () => {
    expect(isBookingListPast({ status: 'confirmed', endAt: endAt('2026-10-14T14:00:00Z'), now })).toBe(true);
  });
  it('treats completed and cancelled as past whatever the clock says', () => {
    expect(isBookingListPast({ status: 'completed', endAt: endAt('2026-10-20T14:00:00Z'), now })).toBe(true);
    expect(isBookingListPast({ status: 'cancelled', endAt: endAt('2026-10-20T14:00:00Z'), now })).toBe(true);
  });
  it('treats a checked-out visit that is still DB-confirmed as past', () => {
    expect(isBookingListPast({ status: 'confirmed', checkinStatus: 'checked_out', endAt: endAt('2026-10-14T16:00:00Z'), now })).toBe(true);
  });
  it('keeps pending requests and in-session visits upcoming while time remains', () => {
    expect(isBookingListPast({ status: 'pending', endAt: endAt('2026-10-14T18:00:00Z'), now })).toBe(false);
    expect(isBookingListPast({ status: 'confirmed', checkinStatus: 'checked_in', endAt: endAt('2026-10-14T18:00:00Z'), now })).toBe(false);
  });
  it('stays upcoming when the end cannot be resolved', () => {
    expect(isBookingListPast({ status: 'confirmed', endAt: null, now })).toBe(false);
  });
});
