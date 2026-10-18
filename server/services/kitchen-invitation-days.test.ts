import { describe, expect, it } from 'vitest';
import { allocateCents } from '@shared/cancellation-policy';
import { allocateInvitationKitchenCents, invitationCheckoutDays, priceInvitationDays, type InvitationDaySnapshot } from './kitchen-invitation-days';
import { verifyInvitationBlock, type PricedBookingDay } from './dated-booking-quote';

const hours = (from: number, to: number) => Array.from({ length: to - from }, (_, i) =>
  ({ startTime: `${String(from + i).padStart(2, '0')}:00`, endTime: `${String(from + i + 1).padStart(2, '0')}:00` }));
const day = (date: string, pricingMode: 'hourly' | 'daily', equipmentIds: number[] = []): any =>
  ({ date, pricingMode, slots: pricingMode === 'hourly' ? hours(9, 11) : hours(9, 17), windowStartTime: '09:00',
    startTime: '09:00', endTime: pricingMode === 'hourly' ? '11:00' : '17:00', equipmentIds });
const listings = [
  { id: 10, equipmentType: 'Mixer', availabilityType: 'rental', sessionRate: '1000' },
  { id: 11, equipmentType: 'Oven', availabilityType: 'included', sessionRate: null },
];
const rates = { hourlyRate: 5_000, dailyRate: 12_000 };

describe('invitation booking-subtotal allocation', () => {
  it('splits the one offered subtotal exactly, using the listed day prices as weights', () => {
    const priced = priceInvitationDays([day('2099-10-05', 'hourly'), day('2099-10-07', 'daily')], rates, listings, 18_000);
    expect(priced.days.map(row => row.listKitchenCents)).toEqual([10_000, 12_000]);
    expect(priced.days.map(row => row.offeredKitchenCents)).toEqual([8_182, 9_818]);
    expect(priced.offeredKitchenCents).toBe(18_000);
    expect(priced.listKitchenCents).toBe(22_000);
  });

  it('breaks ties by date order and matches the shared allocator', () => {
    const days = [day('2099-10-09', 'hourly'), day('2099-10-05', 'hourly'), day('2099-10-07', 'hourly')];
    const priced = priceInvitationDays(days, rates, listings, 10_001);
    const expected = allocateCents(10_001, [10_000, 10_000, 10_000]);
    expect(priced.days.map(row => row.date)).toEqual(['2099-10-05', '2099-10-07', '2099-10-09']);
    expect(priced.days.map(row => row.offeredKitchenCents)).toEqual(expected);
    expect(priced.days.reduce((sum, row) => sum + row.offeredKitchenCents, 0)).toBe(10_001);
  });

  it('never allocates more than a day lists and can leave a day at zero when the offer is $1', () => {
    const priced = priceInvitationDays([day('2099-10-05', 'hourly'), day('2099-10-07', 'daily')], rates, listings, 100);
    expect(priced.offeredKitchenCents).toBe(100);
    expect(priced.days.every(row => row.offeredKitchenCents <= row.listKitchenCents)).toBe(true);
    expect(priced.days.map(row => row.offeredKitchenCents)).toEqual([45, 55]);
  });

  it('prices equipment per selected day and never discounts it', () => {
    const priced = priceInvitationDays([day('2099-10-05', 'hourly', [10, 11]), day('2099-10-07', 'hourly', [10])], rates, listings, 15_000);
    expect(priced.days.map(row => row.equipment.map(item => item.cents))).toEqual([[1_000, 0], [1_000]]);
    expect(priced.listEquipmentCents).toBe(2_000);
    expect(priced.listSubtotalCents).toBe(22_000);
    expect(priced.offeredSubtotalCents).toBe(17_000);
  });

  it('refuses a negative or non-integer offer instead of rounding it', () => {
    expect(() => allocateInvitationKitchenCents([10_000], -1)).toThrow();
    expect(() => allocateInvitationKitchenCents([10_000], 10.5)).toThrow();
  });
});

describe('invitation checkout days', () => {
  const snapshot = priceInvitationDays([day('2099-10-05', 'hourly', [10, 11]), day('2099-10-07', 'daily', [11])], rates, listings, 15_000).days;

  it('keeps the frozen dates, hours and modes and defaults equipment to the kitchen offer', () => {
    expect(invitationCheckoutDays(snapshot, undefined)).toEqual([
      { date: '2099-10-05', pricingMode: 'hourly', slots: hours(9, 11), equipmentIds: [10, 11] },
      { date: '2099-10-07', pricingMode: 'daily', slots: hours(9, 17), equipmentIds: [11] },
    ]);
  });

  it('changes only the equipment of a named day', () => {
    expect(invitationCheckoutDays(snapshot, [{ date: '2099-10-07', equipmentIds: [10, 10] }])[1].equipmentIds).toEqual([10]);
    expect(invitationCheckoutDays(snapshot, [{ date: '2099-10-07', equipmentIds: [10] }])[0].equipmentIds).toEqual([10, 11]);
  });

  it('refuses a date the kitchen did not invite, duplicates and malformed ids', () => {
    expect(() => invitationCheckoutDays(snapshot, [{ date: '2099-10-06', equipmentIds: [] }])).toThrow();
    expect(() => invitationCheckoutDays(snapshot, [{ date: '2099-10-05', equipmentIds: [] }, { date: '2099-10-05', equipmentIds: [] }])).toThrow();
    expect(() => invitationCheckoutDays(snapshot, [{ date: '2099-10-05', equipmentIds: ['10'] }])).toThrow();
  });
});

describe('invitation quote evidence', () => {
  const priced: PricedBookingDay[] = priceInvitationDays([day('2099-10-05', 'hourly'), day('2099-10-07', 'daily')], rates, listings, 18_000).days
    .map(row => ({ ...row, kitchenCents: row.offeredKitchenCents, rateCents: row.pricingMode === 'daily' ? 12_000 : 5_000, equipmentIds: [] }));
  const block = { id: 'invite-1', version: 3, listKitchenCents: 22_000, offeredKitchenCents: 18_000,
    days: [{ date: '2099-10-05', listKitchenCents: 10_000, offeredKitchenCents: 8_182 },
      { date: '2099-10-07', listKitchenCents: 12_000, offeredKitchenCents: 9_818 }] };

  it('accepts the deterministic split', () => {
    expect(() => verifyInvitationBlock(block, priced)).not.toThrow();
  });

  it.each([
    { name: 'above-list offer', patch: { offeredKitchenCents: 22_001, days: [{ date: '2099-10-05', listKitchenCents: 10_000, offeredKitchenCents: 10_001 }, { date: '2099-10-07', listKitchenCents: 12_000, offeredKitchenCents: 12_000 }] } },
    { name: 'below-$1 offer', patch: { offeredKitchenCents: 99, days: [{ date: '2099-10-05', listKitchenCents: 10_000, offeredKitchenCents: 45 }, { date: '2099-10-07', listKitchenCents: 12_000, offeredKitchenCents: 54 }] } },
    { name: 'a day above its listed price', patch: { days: [{ date: '2099-10-05', listKitchenCents: 10_000, offeredKitchenCents: 10_001 }, { date: '2099-10-07', listKitchenCents: 12_000, offeredKitchenCents: 7_999 }] } },
  ])('refuses $name', ({ patch }) => {
    const tampered = { ...block, ...patch } as typeof block;
    expect(() => verifyInvitationBlock(tampered, priced.map((row, i) => ({ ...row, kitchenCents: tampered.days[i].offeredKitchenCents })))).toThrow();
  });

  it('refuses a hand-picked split that is not the largest-remainder allocation', () => {
    const skewed = { ...block, days: [{ date: '2099-10-05', listKitchenCents: 10_000, offeredKitchenCents: 8_000 },
      { date: '2099-10-07', listKitchenCents: 12_000, offeredKitchenCents: 10_000 }] };
    expect(() => verifyInvitationBlock(skewed, priced.map((row, i) => ({ ...row, kitchenCents: skewed.days[i].offeredKitchenCents })))).toThrow();
  });

  it('refuses a changed date set', () => {
    expect(() => verifyInvitationBlock({ ...block, days: [block.days[0]] }, priced)).toThrow();
  });
});
