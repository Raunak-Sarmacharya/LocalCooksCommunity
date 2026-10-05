import { describe, expect, it } from 'vitest';
import { assertKitchenChange, changeDeadline, kitchenChangeQuote, readKitchenChangePolicy, type ChangeSchedule } from './kitchen-booking-change';
const original: ChangeSchedule = { date: '2026-11-10', windowStart: '08:00', slots: [
  { startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }] };
const destination = { ...original, date: '2026-11-15' };
const base = { kind: 'move' as const, original, destination, status: 'confirmed', checkinStatus: 'not_checked_in', visitCount: 0,
  pricingMode: 'hourly', now: Date.parse('2026-11-01T12:00:00Z') };
describe('confirmed kitchen change policy and money', () => {
  it('preserves original hours and prices on a current-rate extension', () => {
    expect(kitchenChangeQuote('extend', 10000, 6000, 2, 3, 'CAD', { taxRate: 15, feeCents: 300 })).toMatchObject({
      retainedKitchenCents: 16000, addedKitchenCents: 6000, taxCents: 900, feeCents: 300, payableCents: 7200 });
  });
  it('quotes every cheaper move with its original-tax refund and retained service fee', () => {
    expect(kitchenChangeQuote('move', 10000, 4000, 2, 2, 'CAD', { taxRate: 30, feeCents: 0, originalTaxCents: 1500 })).toMatchObject({
      currentKitchenCents: 8000, retainedKitchenCents: 8000, addedKitchenCents: 0, payableCents: 0, refundKitchenCents: 2000, refundTaxCents: 300, refundableCents: 2300 });
  });
  it('charges the positive date/same-day move difference', () => {
    expect(kitchenChangeQuote('move', 10000, 6000, 2, 2, 'CAD', { taxRate: 15, feeCents: 100 })).toMatchObject({ addedKitchenCents: 2000, payableCents: 2400 });
  });
  it('leaves taxes and fees unresolved rather than assuming zero', () => {
    expect(kitchenChangeQuote('move', 10000, 6000, 2, 2, 'CAD')).toMatchObject({ addedKitchenCents: 2000, taxCents: null, feeCents: null, payableCents: null });
    expect(readKitchenChangePolicy(null)).toBeNull();
    expect(readKitchenChangePolicy({ version: 1, sameDayMove: 'current_floor' })).toBeNull();
  });
  it('permits only a future unchanged-duration whole booking', () => { expect(() => assertKitchenChange(base)).not.toThrow(); });
  it('rejects rescheduling at the original cancellation cutoff and caps pending approval there', () => {
    const cutoff = Date.parse('2026-11-09T12:30:00Z');
    expect(() => assertKitchenChange({ ...base, cancellationPolicyHours: 24, now: cutoff - 1 })).not.toThrow();
    expect(() => assertKitchenChange({ ...base, cancellationPolicyHours: 24, now: cutoff })).toThrow('cancellation period');
    expect(changeDeadline('move', original, destination, 24, cutoff - 3600_000, 24).getTime()).toBe(cutoff);
  });
  it.each(['cancellation_requested', 'completed', 'cancelled'])('rejects %s', status => {
    expect(() => assertKitchenChange({ ...base, status })).toThrow('confirmed');
  });
  it('allows continuous shortening and rejects removing a middle hour', () => {
    expect(() => assertKitchenChange({ ...base, destination: { ...destination, slots: destination.slots.slice(0, 1) } })).not.toThrow();
    expect(() => assertKitchenChange({ ...base, destination: { ...destination, slots: [destination.slots[0], { startTime: '12:00', endTime: '13:00' }] } })).toThrow('consecutive');
  });
  it('checks evidence and saved visits beyond the displayed booking label', () => {
    expect(() => assertKitchenChange({ ...base, checkedInAt: new Date() })).toThrow('arrival');
    expect(() => assertKitchenChange({ ...base, visitCount: 2 })).toThrow('separate visits');
  });
  it('requires active recorded arrival and rejects departure/end-time extensions', () => {
    const extension = { ...base, kind: 'extend' as const, now: Date.parse('2026-11-10T14:00:00Z'), checkinStatus: 'checked_in', checkedInAt: new Date(),
      destination: { ...original, slots: [...original.slots, { startTime: '11:00', endTime: '12:00' }] } };
    expect(() => assertKitchenChange(extension)).not.toThrow();
    expect(() => assertKitchenChange({ ...extension, checkoutRequestedAt: new Date() })).toThrow('before checkout');
    expect(() => assertKitchenChange({ ...extension, now: Date.parse('2026-11-10T14:30:00Z') })).toThrow('scheduled end');
    expect(() => assertKitchenChange({ ...extension, pricingMode: 'daily' })).toThrow('whole operating day');
  });
  it('allows a future adjacent extension only before the strict saved cutoff', () => {
    const extension = { ...base, kind: 'extend' as const, cancellationPolicyHours: 24,
      destination: { ...original, slots: [...original.slots, { startTime: '11:00', endTime: '12:00' }] } };
    expect(() => assertKitchenChange(extension)).not.toThrow();
    const cutoff = Date.parse('2026-11-09T12:30:00Z');
    expect(() => assertKitchenChange({ ...extension, now: cutoff })).toThrow('cancellation period');
    expect(changeDeadline('extend', original, extension.destination, 24, cutoff - 1000, 24).getTime()).toBe(cutoff);
  });
  it('rejects extension changes to original hours or another date', () => {
    expect(() => assertKitchenChange({ ...base, kind: 'extend', now: Date.parse('2026-11-10T14:00:00Z'), checkedInAt: new Date(), checkinStatus: 'checked_in',
      destination: { ...destination, slots: [...original.slots, { startTime: '11:00', endTime: '12:00' }] } })).toThrow('keeping every original hour');
  });
  it('caps explicit business deadlines at the actual eligibility boundary', () => {
    expect(changeDeadline('move', original, destination, 24, Date.parse('2026-11-10T11:00:00Z')).toISOString()).toBe('2026-11-10T12:30:00.000Z');
  });
  it('handles adjacent operating-day hours across midnight', () => {
    const night = { date: original.date, windowStart: '20:00', slots: [{ startTime: '23:00', endTime: '00:00' }, { startTime: '00:00', endTime: '01:00' }] };
    expect(() => assertKitchenChange({ ...base, original: night, destination: { ...night, date: destination.date } })).not.toThrow();
  });
  it('does not guess same-day policy or a DST occurrence', () => {
    expect(() => assertKitchenChange({ ...base, destination: { ...original, slots: [{ startTime: '13:00', endTime: '14:00' }, { startTime: '14:00', endTime: '15:00' }] } })).toThrow('owner policy');
    const repeated = { date: '2026-11-01', windowStart: '00:00', slots: [{ startTime: '01:00', endTime: '02:00' }, { startTime: '02:00', endTime: '03:00' }] };
    expect(() => assertKitchenChange({ ...base, destination: repeated })).toThrow('ambiguous');
  });
  // Coordinating review: a daily reservation means the destination's whole
  // operating day, not the original day's fixed number of hourly intervals.
  it('allows daily-to-daily moves across different whole-day opening lengths', () => {
    const shorterDay = { ...destination, pricingMode: 'daily' as const, slots: destination.slots.slice(0, 1) };
    expect(() => assertKitchenChange({ ...base, original: { ...original, pricingMode: 'daily' },
      pricingMode: 'daily', destination: shorterDay })).not.toThrow();
  });
  // Latest explicit owner decision: whole moves recalculate kitchen tax,
  // settling only its net difference. The current incremental-only model fails this.
  it.fails('OWNER POLICY GAP: settles $9 tax difference when a $100 plus $15 tax booking moves to $120 at 20% tax', () => {
    expect(kitchenChangeQuote('move', 10000, 6000, 2, 2, 'CAD', {
      taxRate: 20, feeCents: 100, originalTaxCents: 1500,
    })).toMatchObject({ addedKitchenCents: 2000, taxCents: 900, payableCents: 3000 });
  });
});
