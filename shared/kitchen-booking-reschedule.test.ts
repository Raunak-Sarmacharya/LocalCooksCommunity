import { describe, expect, it } from 'vitest';
import { changeQuoteFingerprint, changeResponseDeadline, freeCancelDeadline, movedPolicySessions, publicChangeMoney, RESCHEDULE_MESSAGES,
  rescheduleEligibility, rescheduleMoney, termsTotal, type PriceTerms } from './kitchen-booking-reschedule';

const hours = (n: number) => n * 3_600_000;
const now = new Date('2026-11-01T12:00:00Z');
const at = (offsetHours: number) => new Date(now.getTime() + hours(offsetHours));
const terms = (kitchenCents: number, taxCents: number, feeCents: number): PriceTerms => ({ kitchenCents, taxCents, feeCents });
const base = { status: 'confirmed', checkedIn: false, freeCancelHours: 24, now, multiVisit: false, linkedItems: false } as const;

describe('rescheduleMoney', () => {
  const old = terms(10_000, 1_500, 500); // 12,000

  it('price up: the chef pays only the difference and nothing is refunded', () => {
    const money = rescheduleMoney({ oldTerms: old, newTerms: terms(14_000, 2_100, 700), currency: 'CAD', processingFeeCents: 0, capturedCents: 0 });
    expect(money).toMatchObject({ oldTotalCents: 12_000, newTotalCents: 16_800, payCents: 4_800, refundCents: 0, feeKeptCents: 0 });
    expect(money.lines.map(line => line.key)).toEqual(['old_total', 'new_total', 'pay']);
  });

  it('price down: refund is the difference minus the pro-rata processing fee, as its own line', () => {
    // 12,000 captured, Stripe kept 378 -> 3.15% of anything handed back is not returned.
    const money = rescheduleMoney({ oldTerms: old, newTerms: terms(5_000, 750, 250), currency: 'CAD', processingFeeCents: 378, capturedCents: 12_000 });
    expect(money.payCents).toBe(0);
    expect(money.newTotalCents).toBe(6_000);
    expect(money.feeKeptCents).toBe(Math.round(378 * 6_000 / 12_000)); // 189
    expect(money.refundCents).toBe(6_000 - 189);
    expect(money.lines.map(line => [line.key, line.cents])).toEqual([['old_total', 12_000], ['new_total', 6_000], ['difference', 6_000], ['fee_kept', -189], ['refund', 5_811]]);
  });

  it('price down: the kitchen is debited its own part and Local Cooks returns only the service fee that goes away', () => {
    const money = rescheduleMoney({ oldTerms: old, newTerms: terms(5_000, 750, 250), currency: 'CAD', processingFeeCents: 378, capturedCents: 12_000 });
    expect(money.platformReturnCents).toBe(250); // 500 -> 250
    expect(money.kitchenDebitCents).toBe(money.refundCents - 250);
    // The customer receives exactly what the two sides give back.
    expect(money.kitchenDebitCents + money.platformReturnCents).toBe(money.refundCents);
  });

  it('price down never keeps more than the difference and never refunds a negative amount', () => {
    const money = rescheduleMoney({ oldTerms: old, newTerms: terms(9_990, 1_499, 500), currency: 'CAD', processingFeeCents: 20_000, capturedCents: 12_000 });
    expect(money.feeKeptCents).toBeLessThanOrEqual(money.oldTotalCents - money.newTotalCents);
    expect(money.refundCents).toBeGreaterThanOrEqual(0);
  });

  it('same price: no money moves and no fee is kept', () => {
    const money = rescheduleMoney({ oldTerms: old, newTerms: { ...old }, currency: 'CAD', processingFeeCents: 378, capturedCents: 12_000 });
    expect(money).toMatchObject({ payCents: 0, refundCents: 0, feeKeptCents: 0, kitchenDebitCents: 0, platformReturnCents: 0 });
    expect(money.lines.map(line => line.key)).toEqual(['old_total', 'new_total', 'same']);
  });

  it('refuses amounts that are not whole cents', () => {
    expect(() => rescheduleMoney({ oldTerms: terms(10.5, 0, 0), newTerms: old, currency: 'CAD', processingFeeCents: 0, capturedCents: 0 })).toThrow('review');
    expect(() => rescheduleMoney({ oldTerms: old, newTerms: old, currency: 'CAD', processingFeeCents: -1, capturedCents: 0 })).toThrow('review');
  });

  it('the public money never exposes the internal split', () => {
    const money = rescheduleMoney({ oldTerms: old, newTerms: terms(5_000, 750, 250), currency: 'CAD', processingFeeCents: 378, capturedCents: 12_000 });
    expect(Object.keys(publicChangeMoney(money)).sort()).toEqual(['currency', 'feeKeptCents', 'lines', 'newTotalCents', 'oldTotalCents', 'payCents', 'refundCents']);
    expect(termsTotal(old)).toBe(12_000);
  });
});

describe('changeResponseDeadline: min(now+24h, free-cancel deadline - 1h, start)', () => {
  it('a far-away booking gets the full 24 hours', () => {
    expect(changeResponseDeadline({ now, startAt: at(24 * 10), freeCancelHours: 24 })).toEqual(at(24));
  });
  it('is capped one hour before the chef’s free-cancellation deadline', () => {
    // start in 30h, free cancel until now+6h -> deadline now+5h
    expect(changeResponseDeadline({ now, startAt: at(30), freeCancelHours: 24 })).toEqual(at(5));
  });
  it('is refused when less than 30 minutes would remain', () => {
    // free cancel ends in 1h20m -> cap 20 minutes away
    expect(changeResponseDeadline({ now, startAt: new Date(now.getTime() + hours(24) + 80 * 60_000), freeCancelHours: 24 })).toBeNull();
  });
  it('is allowed when exactly enough time remains', () => {
    const startAt = new Date(now.getTime() + hours(24) + 90 * 60_000); // cap = 30 minutes away
    const deadline = changeResponseDeadline({ now, startAt, freeCancelHours: 24 });
    expect(deadline?.getTime()).toBe(now.getTime() + 30 * 60_000);
  });
  it('never passes the booked start, even with no notice hours', () => {
    const deadline = changeResponseDeadline({ now, startAt: at(3), freeCancelHours: 0 });
    expect(deadline!.getTime()).toBeLessThanOrEqual(at(3).getTime());
    expect(deadline!.getTime()).toBe(at(2).getTime());
  });
  it('an unknown notice falls back to the 24-hour default', () => {
    expect(changeResponseDeadline({ now, startAt: at(30), freeCancelHours: null })).toEqual(changeResponseDeadline({ now, startAt: at(30), freeCancelHours: 24 }));
  });
});

describe('rescheduleEligibility', () => {
  const startAt = at(24 * 5);
  it('allows a confirmed single-visit booking before its free-cancellation deadline and reports the deadline', () => {
    const result = rescheduleEligibility({ ...base, startAt });
    expect(result.allowed).toBe(true);
    expect(result.until).toBe(freeCancelDeadline(startAt, 24).toISOString());
    expect(result.decisionBy).toEqual(at(24));
  });
  it('refuses multi-visit bookings with the contact line', () => {
    expect(rescheduleEligibility({ ...base, startAt, multiVisit: true })).toMatchObject({ allowed: false, reason: RESCHEDULE_MESSAGES.contactKitchen });
    expect(RESCHEDULE_MESSAGES.contactKitchen).toBe('To change these dates, message the kitchen or contact Local Cooks.');
  });
  it('refuses a booking with storage or equipment attached', () => {
    expect(rescheduleEligibility({ ...base, startAt, linkedItems: true }).reason).toBe('To change a booking with storage, contact Local Cooks.');
  });
  it('refuses once the free-cancellation deadline has passed', () => {
    expect(rescheduleEligibility({ ...base, startAt: at(23) })).toMatchObject({ allowed: false, reason: RESCHEDULE_MESSAGES.tooClose });
    expect(RESCHEDULE_MESSAGES.tooClose).toBe("It's too close to your cancellation deadline to change this booking. Message the kitchen or cancel under your policy.");
  });
  it('refuses when the kitchen would have under 30 minutes to answer', () => {
    expect(rescheduleEligibility({ ...base, startAt: new Date(now.getTime() + hours(24) + 80 * 60_000) }).reason).toBe(RESCHEDULE_MESSAGES.tooClose);
  });
  it('refuses a booking that is not confirmed, started, or checked in', () => {
    expect(rescheduleEligibility({ ...base, startAt, status: 'pending' }).reason).toBe(RESCHEDULE_MESSAGES.notConfirmed);
    expect(rescheduleEligibility({ ...base, startAt, status: 'cancelled' }).allowed).toBe(false);
    expect(rescheduleEligibility({ ...base, startAt, checkedIn: true }).reason).toBe(RESCHEDULE_MESSAGES.started);
    expect(rescheduleEligibility({ ...base, startAt: at(-1) }).reason).toBe(RESCHEDULE_MESSAGES.started);
  });
  it('allows only one open change at a time', () => {
    expect(rescheduleEligibility({ ...base, startAt, openChange: true })).toMatchObject({ allowed: false, reason: RESCHEDULE_MESSAGES.open });
  });
  it('follows the booking’s own notice hours, not a fixed 24', () => {
    expect(rescheduleEligibility({ ...base, startAt: at(60), freeCancelHours: 72 }).allowed).toBe(false);
    expect(rescheduleEligibility({ ...base, startAt: at(60), freeCancelHours: 12 }).allowed).toBe(true);
  });
});

describe('moved policy snapshot and quote fingerprint', () => {
  it('rewrites only the first session’s timing and leaves everything else alone', () => {
    const sessions = [{ startAt: '2026-11-10T14:00:00.000Z', endAt: '2026-11-10T16:00:00.000Z', label: 'a' }, { startAt: '2026-11-12T14:00:00.000Z', label: 'b' }];
    expect(movedPolicySessions(sessions, '2026-11-20T15:00:00.000Z', '2026-11-20T18:00:00.000Z')).toEqual([
      { startAt: '2026-11-20T15:00:00.000Z', endAt: '2026-11-20T18:00:00.000Z', label: 'a' }, sessions[1]]);
    expect(sessions[0].startAt).toBe('2026-11-10T14:00:00.000Z');
  });
  it('the fingerprint changes with the destination or the money and nothing else', () => {
    const destination = { date: '2026-11-20', windowStart: '08:00', slots: [{ startTime: '09:00', endTime: '10:00' }] };
    const money = rescheduleMoney({ oldTerms: terms(10_000, 1_500, 500), newTerms: terms(14_000, 2_100, 700), currency: 'CAD', processingFeeCents: 0, capturedCents: 0 });
    const first = changeQuoteFingerprint({ bookingId: 7, destination, money });
    expect(changeQuoteFingerprint({ bookingId: 7, destination, money: { ...money, lines: [] } })).toBe(first);
    expect(changeQuoteFingerprint({ bookingId: 8, destination, money })).not.toBe(first);
    expect(changeQuoteFingerprint({ bookingId: 7, destination: { ...destination, date: '2026-11-21' }, money })).not.toBe(first);
    expect(changeQuoteFingerprint({ bookingId: 7, destination, money: { ...money, payCents: money.payCents + 1 } })).not.toBe(first);
  });
});
