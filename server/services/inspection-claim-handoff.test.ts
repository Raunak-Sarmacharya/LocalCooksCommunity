import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], inserts: [] as any[], locks: 0 }));
vi.mock('../db', () => {
  const db: any = { select: () => { const q: any = { from: () => q, innerJoin: () => q, where: () => q,
    limit: async () => state.rows.shift() || [], then: (resolve: any) => resolve(state.rows.shift() || []) }; return q; },
    execute: async () => { state.locks++; }, insert: (table: any) => ({ values: (values: any) => {
      state.inserts.push({ table: table[Symbol.for('drizzle:Name')], values });
      return { returning: async () => [{ id: 7, ...values }], then: (resolve: any) => resolve([]) };
    } }) };
  db.transaction = async (run: any) => run(db); return { db };
});
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => 'DC-TEST' }));
vi.mock('./damage-claim-limits-service', () => ({ validateClaimAmount: async () => ({ valid: true }), canFileClaimForBooking: async () => ({ allowed: true }),
  getDamageClaimLimits: async () => ({ claimSubmissionDeadlineDays: 7, chefResponseDeadlineHours: 48, maxClaimsPerBooking: 2 }) }));
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
import { createDamageClaim } from './damage-claim-service';
const input = { bookingType: 'kitchen' as const, kitchenBookingId: 10, kitchenBookingVisitId: 5, managerId: 2,
  claimTitle: 'Cleaning inspection', claimDescription: 'Evidence to be attached before submission', claimedAmountCents: 1000,
  damageDate: '2026-10-04', checkoutHandoffKey: 'kitchen:10:visit:5' };
const booking = { status: 'confirmed', chefId: 3, kitchenId: 4, managerId: 2, bookingDate: new Date(), startTime: '09:00', endTime: '15:00', timezone: 'UTC' };
function context(endTime = '10:00') { state.rows.push([booking], [{ endTime }], [{ id: 5 }], [booking], [{ locationId: 5 }]); }
describe('inspection draft identity and per-visit filing boundary', () => {
  beforeEach(() => { state.rows = []; state.inserts = []; state.locks = 0; });
  it('reuses the recorded inspection draft under the parent lock without another claim/history/charge', async () => {
    context(); state.rows.push([{ claim: { id: 7, status: 'draft', claimedAmountCents: 1000 } }]);
    expect(await createDamageClaim(input)).toMatchObject({ success: true, claim: { id: 7 } });
    expect(state.locks).toBe(1); expect(state.inserts).toEqual([]);
  });
  it('commits a new draft and its handoff identity together without starting submission', async () => {
    context(); state.rows.push([], [{ count: 0 }]);
    expect(await createDamageClaim(input)).toMatchObject({ success: true, claim: { id: 7, status: 'draft' } });
    expect(state.inserts.map(row => row.table)).toEqual(['damage_claims', 'damage_claim_history']);
    expect(state.inserts[1].values.metadata).toEqual({ checkoutHandoffKey: input.checkoutHandoffKey });
  });
  it('rejects a foreign visit and its own expired filing boundary before draft creation', async () => {
    state.rows.push([booking], []);
    expect(await createDamageClaim(input)).toMatchObject({ success: false, error: 'Visit does not belong to this booking' });
    state.rows.push([{ ...booking, bookingDate: new Date('2020-01-01') }], [{ endTime: '10:00' }]);
    expect(await createDamageClaim(input)).toMatchObject({ success: false, error: 'Damage claim filing deadline has passed' });
    expect(state.inserts).toEqual([]); expect(state.locks).toBe(0);
  });
});
