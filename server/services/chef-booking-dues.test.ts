import { describe, expect, it, vi, beforeEach } from 'vitest';

const results: unknown[][] = [];
vi.mock('../db', () => ({ db: { select: () => ({ from: () => ({ where: () => Promise.resolve(results.shift() ?? []) }) }) } }));
vi.mock('./damage-claims-v2', () => ({ chefCanSeeClaim: (claim: { chefVisibleAt?: Date | null }) => !!claim.chefVisibleAt }));

import { readChefBookingDues } from './chef-booking-dues';

const claim = (overrides: Record<string, unknown>) => ({ id: 1, kitchenBookingId: 10, claimVersion: 2, chefVisibleAt: new Date(), status: 'approved',
  chefOwes: true, resolvedAt: null, chargeSucceededAt: null, compensationOperation: null, finalAmountCents: 4200, claimedAmountCents: 5000, ...overrides });

beforeEach(() => { results.length = 0; });

describe('readChefBookingDues (read-only list facts)', () => {
  it('reports a payable v2 claim the chef can see, then an open extra-time charge', async () => {
    results.push([claim({}), claim({ id: 2, kitchenBookingId: 11, chefVisibleAt: null })], [{ bookingId: 12, amountCents: 1500 }, { bookingId: 10, amountCents: 900 }]);
    const dues = await readChefBookingDues(7, [10, 11, 12]);
    expect(dues.get(10)).toEqual({ kind: 'claim', amountCents: 4200 });
    expect(dues.has(11)).toBe(false);
    expect(dues.get(12)).toEqual({ kind: 'extra_time', amountCents: 1500 });
  });

  it('ignores settled, legacy, not-owed and in-flight claims', async () => {
    results.push([
      claim({ id: 3, status: 'charge_succeeded' }), claim({ id: 4, kitchenBookingId: 11, claimVersion: 1 }),
      claim({ id: 5, kitchenBookingId: 12, chefOwes: false }), claim({ id: 6, kitchenBookingId: 13, compensationOperation: { state: 'pending' } }),
    ], []);
    expect((await readChefBookingDues(7, [10, 11, 12, 13])).size).toBe(0);
  });

  it('does not query without bookings', async () => {
    expect((await readChefBookingDues(7, [])).size).toBe(0);
  });
});
