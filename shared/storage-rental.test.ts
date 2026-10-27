import { describe, expect, it } from 'vitest';
import {
  addDays, approvedTermDates, availabilityPhrase, beforeStartRefund, daysBetween, extensionLimit, localToday, occupancyRange, pickFreeUnit,
  reclaimRule, rentalPhase, responseDeadline, storageCancellationSnapshot, termPayoutEligibleAt, termPrice, toDateRange, unusedRefundSplit,
  type PaidTerm, type RentalDates, type RentalState,
} from './storage-rental';

const TZ = 'America/St_Johns';
const rental = (over: Partial<RentalDates> = {}): RentalDates => ({ rentalState: 'active', termStart: '2026-10-01', paidThrough: '2026-10-30', ...over });

describe('calendar days', () => {
  it('adds across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02'); // spans the Nov 1 fall-back
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // spans the Mar 8 spring-forward
    expect(daysBetween('2026-10-25', '2026-11-08')).toBe(14);
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });

  it('reads the kitchen-local day around St. John\'s DST changes', () => {
    expect(localToday(new Date('2026-11-01T02:29:00Z'), TZ)).toBe('2026-10-31'); // 23:59 NDT
    expect(localToday(new Date('2026-11-01T02:30:00Z'), TZ)).toBe('2026-11-01');
    expect(localToday(new Date('2026-11-02T03:29:00Z'), TZ)).toBe('2026-11-01'); // 23:59 NST
    expect(localToday(new Date('2026-11-02T03:30:00Z'), TZ)).toBe('2026-11-02');
    expect(localToday(new Date('2026-03-08T03:29:00Z'), TZ)).toBe('2026-03-07');
    expect(localToday(new Date('2026-03-09T02:29:00Z'), TZ)).toBe('2026-03-08');
    expect(localToday(new Date('2026-03-09T02:30:00Z'), TZ)).toBe('2026-03-09');
    expect(localToday(new Date('2027-01-01T03:29:00Z'), TZ)).toBe('2026-12-31');
  });
});

describe('termPrice', () => {
  it('prices days × daily + HST + injected fee', async () => {
    const price = await termPrice({ days: 10, dailyPriceCents: 300, taxRatePercent: 15, serviceFee: async subtotal => Math.round(subtotal * 0.05) });
    expect(price).toEqual({ days: 10, dailyPriceCents: 300, subtotalCents: 3000, taxCents: 450, serviceFeeCents: 150, totalCents: 3600 });
    await expect(termPrice({ days: 31, dailyPriceCents: 300, taxRatePercent: 15, serviceFee: () => 0 })).rejects.toThrow();
    await expect(termPrice({ days: 0, dailyPriceCents: 300, taxRatePercent: 15, serviceFee: () => 0 })).rejects.toThrow();
  });
});

describe('rentalPhase', () => {
  const r = { ...rental(), dailyPriceCents: 300, taxRatePercent: 15 };
  it.each([
    ['2026-10-23', 'current', 0], ['2026-10-24', 'ending_soon', 0], ['2026-10-30', 'ending_soon', 0],
    ['2026-10-31', 'grace', 0], ['2026-11-04', 'grace', 0], ['2026-11-05', 'holdover', 1],
    ['2026-11-19', 'holdover', 15], ['2026-12-31', 'holdover', 15],
  ])('%s → %s (%i holdover days)', (today, phase, days) => {
    const result = rentalPhase(r, today)!;
    expect(result).toMatchObject({ phase, effectiveEnd: '2026-10-30', graceEndsOn: '2026-11-04', holdoverDays: days });
    expect(result.accruedCents).toBe(days * 300 + Math.round(days * 300 * 0.15));
  });
  it('uses an earlier reclaim date and ignores non-running states', () => {
    expect(rentalPhase({ ...r, reclaimEndOn: '2026-10-20' }, '2026-10-21')).toMatchObject({ phase: 'grace', effectiveEnd: '2026-10-20' });
    expect(rentalPhase({ ...r, rentalState: 'removal_review' }, '2027-01-01')!.holdoverDays).toBe(15);
    expect(rentalPhase({ ...r, rentalState: 'ended' }, '2026-10-10')).toBeNull();
  });
});

describe('occupancy', () => {
  it.each<[RentalState, Partial<RentalDates>, ReturnType<typeof occupancyRange>]>([
    ['requested', {}, { from: '2026-10-01', to: '2026-11-05' }],
    ['reserved', {}, { from: '2026-10-01', to: '2026-11-05' }],
    ['active', {}, { from: '2026-10-01', to: '2026-11-05' }],
    ['move_out_requested', {}, { from: '2026-10-01', to: '2026-11-05' }],
    ['active', { reclaimEndOn: '2026-10-20' }, { from: '2026-10-01', to: '2026-10-26' }],
    ['removal_review', {}, { from: '2026-10-01', to: null }],
    ['ended', { releasedOn: '2026-10-12' }, { from: '2026-10-01', to: '2026-10-12' }],
    ['ended', { releasedOn: '2026-10-12', needsCleaning: true }, { from: '2026-10-01', to: null }],
    ['ended', { releasedOn: null }, null],
    ['declined', {}, null], ['expired', {}, null], ['withdrawn', {}, null],
  ])('%s %o', (state, over, expected) => expect(occupancyRange(rental({ rentalState: state, ...over }))).toEqual(expected));

  it('keeps a chef past grace on the unit when today is given', () => {
    expect(occupancyRange(rental(), '2026-11-10')).toEqual({ from: '2026-10-01', to: '2026-11-11' });
    expect(occupancyRange(rental(), '2026-10-10')).toEqual({ from: '2026-10-01', to: '2026-11-05' });
    expect(toDateRange({ from: '2026-10-01', to: null })).toBe('[2026-10-01,)');
  });

  it('picks the lowest free unit; adjacent ranges do not overlap', () => {
    const occupied = [{ unitIndex: 1, from: '2026-10-01', to: '2026-11-05' }, { unitIndex: 2, from: '2026-10-20', to: null }];
    expect(pickFreeUnit(2, occupied, { from: '2026-11-05', to: '2026-11-15' })).toBe(1);
    expect(pickFreeUnit(2, occupied, { from: '2026-11-04', to: '2026-11-15' })).toBeNull();
    expect(pickFreeUnit(3, occupied, { from: '2026-11-04', to: '2026-11-15' })).toBe(3);
    expect(pickFreeUnit(2, occupied, { from: '2026-10-05', to: '2026-10-20' })).toBe(2);
  });

  it('phrases availability', () => {
    const occupied = [{ unitIndex: 1, from: '2026-10-01', to: '2026-10-20' }, { unitIndex: 1, from: '2026-10-20', to: '2026-10-25' },
      { unitIndex: 2, from: '2026-10-05', to: '2026-10-28' }];
    expect(availabilityPhrase(2, occupied, '2026-10-10')).toEqual({ from: '2026-10-25' });
    expect(availabilityPhrase(3, occupied, '2026-10-10')).toBe('now');
    expect(availabilityPhrase(1, [{ unitIndex: 1, from: '2026-10-01', to: null }], '2026-10-10')).toBe('full');
  });
  it('"now" only when a 1-day rental and its grace days fit before the next one', () => {
    // Next rental starts Oct 13; a rental starting today (Oct 10) would hold the unit through its grace into Oct 16.
    expect(availabilityPhrase(1, [{ unitIndex: 1, from: '2026-10-13', to: '2026-10-20' }], '2026-10-10')).toEqual({ from: '2026-10-20' });
    expect(availabilityPhrase(1, [{ unitIndex: 1, from: '2026-10-20', to: '2026-10-25' }], '2026-10-10')).toBe('now');
  });
});

describe('extensionLimit', () => {
  const blocks = { platformMaxDays: 30, listingMaxDays: null, nextReservationStart: null };
  it('is limited by the platform or kitchen max', () => {
    expect(extensionLimit(rental(), '2026-10-20', blocks)).toEqual({ maxDays: 30, reason: 'max_term' });
    expect(extensionLimit(rental(), '2026-10-20', { ...blocks, listingMaxDays: 7 })).toEqual({ maxDays: 7, reason: 'max_term' });
    expect(extensionLimit(rental(), '2026-10-20', { ...blocks, platformMaxDays: 20, listingMaxDays: 30 })).toEqual({ maxDays: 20, reason: 'max_term' });
  });
  it('opens only when 14 or fewer paid days remain', () => {
    expect(extensionLimit(rental(), '2026-10-15', blocks)).toEqual({ maxDays: 0, reason: 'window' });
    expect(extensionLimit(rental(), '2026-10-16', blocks)).toEqual({ maxDays: 30, reason: 'max_term' });
    expect(extensionLimit(rental({ rentalState: 'removal_review' }), '2026-11-25', blocks).maxDays).toBe(30);
  });
  it('is clipped by a later reservation on the unit (including its grace)', () => {
    expect(extensionLimit(rental(), '2026-10-20', { ...blocks, nextReservationStart: '2026-11-15' })).toEqual({ maxDays: 10, reason: 'reservation' });
    expect(extensionLimit(rental(), '2026-10-20', { ...blocks, nextReservationStart: '2026-11-05' })).toEqual({ maxDays: 0, reason: 'reservation' });
  });
  it('cannot pass a move-out-by date', () => {
    expect(extensionLimit(rental({ reclaimEndOn: '2026-11-03' }), '2026-10-20', blocks)).toEqual({ maxDays: 4, reason: 'reclaim' });
    expect(extensionLimit(rental({ reclaimEndOn: '2026-10-25' }), '2026-10-20', blocks)).toEqual({ maxDays: 0, reason: 'reclaim' });
  });
  it('refuses ended or pending rentals', () => {
    expect(extensionLimit(rental({ rentalState: 'requested' }), '2026-10-20', blocks)).toEqual({ maxDays: 0, reason: 'not_extendable' });
  });
});

describe('reclaimRule', () => {
  it('30-day rental reclaimed on day 10 with 7 days notice leaves 13 unused days', () => {
    expect(reclaimRule(rental(), '2026-10-10', '2026-10-17')).toEqual({ allowed: true, minDate: '2026-10-17', unusedDays: 13, mode: 'reclaim' });
    expect(reclaimRule(rental(), '2026-10-10', '2026-10-16').allowed).toBe(false);
  });
  it('notice is the time left when under 7 days', () => {
    expect(reclaimRule(rental(), '2026-10-27', '2026-10-29')).toEqual({ allowed: false, minDate: '2026-10-30', unusedDays: 1, mode: 'reclaim' });
    expect(reclaimRule(rental(), '2026-10-27', '2026-10-30')).toMatchObject({ allowed: true, mode: 'nudge', unusedDays: 0 });
  });
  it('a span of 7 days or less cannot be reclaimed by the kitchen', () => {
    const short = rental({ termStart: '2026-10-01', paidThrough: '2026-10-07' });
    expect(reclaimRule(short, '2026-10-01', '2026-10-06')).toMatchObject({ allowed: false, mode: 'reclaim' });
    expect(reclaimRule(rental({ termStart: '2026-10-01', paidThrough: '2026-10-08' }), '2026-10-01', '2026-10-07')).toMatchObject({ allowed: false });
    expect(reclaimRule(rental({ termStart: '2026-10-01', paidThrough: '2026-10-09' }), '2026-10-01', '2026-10-08')).toMatchObject({ allowed: true, unusedDays: 1 });
    expect(reclaimRule(short, '2026-10-03', '2026-10-09')).toMatchObject({ allowed: true, mode: 'nudge' });
  });
});

describe('unusedRefundSplit', () => {
  const terms: PaidTerm[] = [
    { id: 1, startsOn: '2026-10-01', endsOn: '2026-10-30', days: 30, subtotalCents: 9000, taxCents: 1350, serviceFeeCents: 457, totalCents: 10807 },
    { id: 2, startsOn: '2026-10-31', endsOn: '2026-11-06', days: 7, subtotalCents: 2100, taxCents: 315, serviceFeeCents: 107, totalCents: 2522 },
  ];
  it('refunds everything from the first day, latest first, and sums to the charges', () => {
    const split = unusedRefundSplit(terms, '2026-10-01');
    expect(split.map(item => item.termId)).toEqual([2, 1]);
    expect(split.reduce((sum, item) => sum + item.customer, 0)).toBe(10807 + 2522);
    for (const item of split) expect(item.managerDebited + item.platformServiceFeeReturned).toBe(item.customer);
  });
  it('pro-rates a partial term by days', () => {
    const split = unusedRefundSplit(terms, '2026-10-18');
    expect(split).toEqual([
      { termId: 2, unusedDays: 7, customer: 2522, managerDebited: 2415, platformServiceFeeReturned: 107 },
      { termId: 1, unusedDays: 13, customer: Math.round(10807 * 13 / 30), managerDebited: Math.round(10807 * 13 / 30) - Math.round(457 * 13 / 30),
        platformServiceFeeReturned: Math.round(457 * 13 / 30) },
    ]);
    expect(unusedRefundSplit(terms, '2026-11-07')).toEqual([]);
  });
});

describe('beforeStartRefund (kitchen booking cancellation policy)', () => {
  const policy = { policyId: 4, version: 2, noticeHours: 48, lateChargePercent: 50, disclosureVersion: 'food-corridor-v3', acceptedAt: '2026-10-20T12:00:00Z' };
  const snapshot = storageCancellationSnapshot(policy, '2026-11-03', TZ);
  const term = { subtotalCents: 3000, taxCents: 450, serviceFeeCents: 150, totalCents: 3600 };
  const quote = (cancelAt: string) => beforeStartRefund(snapshot, { cancelAt: new Date(cancelAt), approvedAt: new Date('2026-10-20T12:00:00Z'), term, processingFeeCents: 134 });

  it('measures notice from local midnight of the first day (after the Nov 1 fall-back)', () => {
    expect(snapshot.sessions[0].startAt).toBe('2026-11-03T03:30:00.000Z');
  });
  it('refunds in full minus the card fee with enough notice', () => {
    expect(quote('2026-11-01T03:30:00Z')).toMatchObject({ quoteReady: true, refundPercent: 100, chefRefundCents: 3466, kitchenRefundCents: 3316, platformRefundCents: 150, feeRetainedCents: 134 });
  });
  it('applies the late charge inside the notice window', () => {
    expect(quote('2026-11-02T00:00:00Z')).toMatchObject({ refundPercent: 50, chefRefundCents: 1733, kitchenRefundCents: 1658, platformRefundCents: 75 });
  });
  it('refunds nothing once the rental has started', () => {
    expect(quote('2026-11-03T04:00:00Z')).toMatchObject({ chefRefundCents: 0, reasonCode: 'no_refund' });
  });
  it('waits for the actual card fee', () => {
    expect(beforeStartRefund(snapshot, { cancelAt: new Date('2026-11-01T00:00:00Z'), approvedAt: new Date('2026-10-20T12:00:00Z'), term, processingFeeCents: null }))
      .toEqual({ reasonCode: 'processing_fee_pending', quoteReady: false });
  });
});

describe('termPayoutEligibleAt (end of each paid term)', () => {
  const paidAt = new Date('2026-10-01T12:00:00Z');
  it('is the start of the day after the last paid day, across both DST changes', () => {
    expect(termPayoutEligibleAt({ endsOn: '2026-10-31', paidAt }, { timezone: TZ }).toISOString()).toBe('2026-11-01T02:30:00.000Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-11-01', paidAt }, { timezone: TZ }).toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-03-07', paidAt: new Date('2026-03-01T00:00:00Z') }, { timezone: TZ }).toISOString()).toBe('2026-03-08T03:30:00.000Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-03-08', paidAt: new Date('2026-03-01T00:00:00Z') }, { timezone: TZ }).toISOString()).toBe('2026-03-09T02:30:00.000Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-12-31', paidAt }, { timezone: TZ }).toISOString()).toBe('2027-01-01T03:30:00.000Z');
  });
  it('is the move-out clear when that is earlier, never before payment', () => {
    const clearedAt = new Date('2026-10-12T15:00:00Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-10-30', paidAt }, { timezone: TZ, clearedAt })).toEqual(clearedAt);
    expect(termPayoutEligibleAt({ endsOn: '2026-10-10', paidAt }, { timezone: TZ, clearedAt }).toISOString()).toBe('2026-10-11T02:30:00.000Z');
    expect(termPayoutEligibleAt({ endsOn: '2026-10-30', paidAt: new Date('2026-10-14T00:00:00Z') }, { timezone: TZ, clearedAt }).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('request timing', () => {
  it('gives the kitchen 24 hours and shifts a late approval', () => {
    expect(responseDeadline(new Date('2026-10-31T12:00:00Z')).toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(approvedTermDates('2026-10-20', 10, '2026-10-21')).toEqual({ termStart: '2026-10-21', paidThrough: '2026-10-30', shifted: true });
    expect(approvedTermDates('2026-12-25', 10, '2026-12-24')).toEqual({ termStart: '2026-12-25', paidThrough: '2027-01-03', shifted: false });
  });
});
