import { describe, expect, it } from 'vitest';
import { bookingCancelCause } from './booking-cancel-cause';

describe('bookingCancelCause', () => {
  it('is null unless the booking is cancelled', () => {
    expect(bookingCancelCause({ status: 'confirmed', paymentDecision: { target: 'cancelled', actorId: 1 } })).toBeNull();
  });
  it('reads a chef-made decision as withdrawn', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7, paymentDecision: { target: 'cancelled', actorId: 7 } })).toBe('withdrawn');
  });
  it('reads another actor as the kitchen declining', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7, paymentDecision: { target: 'cancelled', actorId: 9 } })).toBe('declined');
  });
  it('reads a release recorded for a replacement request as "replaced", before any actor rule', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7, paymentDecision: { target: 'cancelled', actorId: 7, replacedBy: { bookingId: 12 } } })).toBe('replaced');
  });
  it('reads a decision without an actor as the 24 h expiry', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7, paymentDecision: { target: 'cancelled' } })).toBe('expired');
  });
  it('reads a confirmed target on a cancelled booking as cancelled after confirmation', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7, paymentDecision: { target: 'confirmed', actorId: 9 } })).toBe('cancelled_after_confirmation');
  });
  it('falls back to plain cancelled without a decision', () => {
    expect(bookingCancelCause({ status: 'cancelled', chefId: 7 })).toBe('cancelled');
  });
  it('honours explicit expired and declined statuses', () => {
    expect(bookingCancelCause({ status: 'expired' })).toBe('expired');
    expect(bookingCancelCause({ status: 'rejected' })).toBe('declined');
  });
});
