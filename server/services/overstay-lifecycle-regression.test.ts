import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as any[][], writes: [] as any[] }));
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), queueOverstayOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
vi.mock('../db', () => { const db: any = {
  select: () => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
      orderBy: () => chain, limit: async () => state.rows.shift() || [],
      then: (resolve: any) => resolve(state.rows.shift() || []) };
    return chain;
  },
  update: () => ({ set: (value: any) => { state.writes.push(value);
    return { where: () => ({ then: (resolve: any) => resolve(undefined), returning: async () => [{ id: 1 }] }) };
  } }),
  insert: () => ({ values: (value: any) => ({ returning: async () => [{ id: 1, ...value }], then: (resolve: any) => resolve(undefined) }) }),
}; db.transaction = (run: any) => run(db); return { db }; });
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('./notification.service', () => ({ notificationService: { createForManager: vi.fn(), createForChef: vi.fn() } }));
vi.mock('./overstay-defaults-service', () => ({ getEffectivePenaltyConfig: async () => ({
  gracePeriodDays: 99, penaltyRate: 9, maxPenaltyDays: 99 }), getOverstayPlatformDefaults: vi.fn() }));
import { detectOverstays, processManagerDecision, disputeOverstayPenalty, reviewOverstayDispute, resolveOverstay } from './overstay-penalty-service';

const terms = { version: 1, gracePeriodDays: 3, penaltyRate: 0.1, maxPenaltyDays: 30,
  dailyRateCents: 2000, pricingModel: 'daily', timezone: 'America/St_Johns',
  policyText: null, quotedAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-01T00:00:00Z' };
function scenario(overrides: any = {}, recordOverrides: any = {}) {
  state.rows.push([{ id: 10, chefId: null, status: 'confirmed', endDate: new Date('2026-09-20T02:30:00Z'),
    checkoutStatus: null, overstayTerms: terms, timezone: 'America/St_Johns', ...overrides }],
    [{ id: 1, status: 'pending_review', daysOverdue: 1, itemsRemovedAt: null, ...recordOverrides }]);
}
describe('real overstay lifecycle with a mocked database', () => {
  beforeEach(() => { state.rows.length = 0; state.writes.length = 0;
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T16:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('rejects extension resolution when the booking end has not changed', async () => {
    state.rows.push([{ id: 1, storageBookingId: 10, status: 'pending_review', endDate: new Date('2026-09-20') }],
      [{ endDate: new Date('2026-09-20') }]);
    expect((await resolveOverstay(1, 'extended', 'Items remain')).error).toMatch(/actual booking extension/);
    expect(state.writes).toEqual([]);
  });

  it('keeps accruing after a chef requests checkout, using the agreed rates', async () => {
    scenario({ checkoutStatus: 'checkout_requested' });
    const [result] = await detectOverstays();
    expect(result).toMatchObject({ daysOverdue: 10, calculatedPenaltyCents: 15400, dailyRateCents: 2000 });
    expect(state.writes[0].itemsRemovedAt).toBeNull();
  });
  it('freezes accrual at manager-confirmed removal rather than today', async () => {
    const removedAt = new Date('2026-09-25T16:00:00Z');
    scenario({ status: 'completed', checkoutStatus: 'completed', checkoutApprovedBy: 5, checkoutApprovedAt: removedAt });
    const [result] = await detectOverstays();
    expect(result).toMatchObject({ daysOverdue: 5, calculatedPenaltyCents: 4400 });
    expect(state.writes.at(-1)).toMatchObject({ itemsRemovedAt: removedAt, calculatedPenaltyCents: 4400 });
  });
  it('does not infer manager-confirmed removal from automatic checkout clearance', async () => {
    scenario({ status: 'completed', checkoutStatus: 'completed', checkoutApprovedAt: new Date() });
    expect(await detectOverstays()).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it('caps the amount at the agreed maximum number of days', async () => {
    scenario({ endDate: new Date('2026-01-01T03:30:00Z') });
    expect((await detectOverstays())[0].calculatedPenaltyCents).toBe(66000);
  });
  it('rejects final approval before physical removal is confirmed', async () => {
    state.rows.push([{ id: 1, storageBookingId: 10, status: 'pending_review', itemsRemovedAt: null }]);
    expect(await processManagerDecision({ overstayRecordId: 1, managerId: 5, action: 'approve' }))
      .toMatchObject({ success: false, error: expect.stringMatching(/Confirm.*removed/) });
    expect(state.writes).toEqual([]);
  });
  it('records a timely owner dispute and pauses collection', async () => {
    state.rows.push([{ id: 1, status: 'penalty_approved', storageBookingId: 10,
      chefDisputeDeadline: new Date('2026-10-01T16:00:00Z') }], [{ chefId: 8 }], []);
    expect(await disputeOverstayPenalty(1, 8, 'The removal date is incorrect')).toEqual({ success: true });
    expect(state.writes[0]).toMatchObject({ status: 'escalated', chefDisputeReason: 'The removal date is incorrect' });
  });
  it('rejects a dispute from another chef', async () => {
    state.rows.push([{ id: 1, status: 'penalty_approved', storageBookingId: 10,
      chefDisputeDeadline: new Date('2026-10-01T16:00:00Z') }], [{ chefId: 8 }]);
    expect((await disputeOverstayPenalty(1, 9, 'The removal date is incorrect')).error).toMatch(/unauthorized/);
    expect(state.writes).toEqual([]);
  });
  it('rejects a dispute after the saved deadline', async () => {
    state.rows.push([{ id: 1, status: 'penalty_approved', chefDisputeDeadline: new Date('2026-09-29') }]);
    expect((await disputeOverstayPenalty(1, 8, 'The removal date is incorrect')).error).toMatch(/window/);
    expect(state.writes).toEqual([]);
  });
  it('prevents an admin from increasing a disputed award', async () => {
    state.rows.push([{ id: 1, status: 'escalated', chefDisputedAt: new Date(), finalPenaltyCents: 1000 }]);
    expect((await reviewOverstayDispute(1, 2, 1001, 'Reviewed the booking evidence')).error).toMatch(/disputed final amount/);
    expect(state.writes).toEqual([]);
  });
  it('records a zero admin award as a waiver', async () => {
    state.rows.push([{ id: 1, storageBookingId: 10, status: 'escalated', chefDisputedAt: new Date(), finalPenaltyCents: 1000 }], [{ chefId: 8 }]);
    expect(await reviewOverstayDispute(1, 2, 0, 'Reviewed evidence; penalty is waived')).toEqual({ success: true });
    expect(state.writes[0]).toMatchObject({ status: 'penalty_waived', finalPenaltyCents: 0, disputeReviewedBy: 2 });
  });
});
