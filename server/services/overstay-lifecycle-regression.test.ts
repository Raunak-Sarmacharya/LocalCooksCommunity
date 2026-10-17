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
import { processManagerDecision, disputeOverstayPenalty, reviewOverstayDispute, resolveOverstay } from './overstay-penalty-service';

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

  it('rejects final approval before physical removal is confirmed', async () => {
    state.rows.push([{ id: 1, storageBookingId: 10, status: 'pending_review', itemsRemovedAt: null, idempotencyKey: 'overstay:10:1' }]);
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
