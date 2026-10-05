import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ storage: {} as any, managerId: 2, writes: [] as any[], queue: vi.fn(), capture: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: async () => [], select: (projection: any) => { const query: any = {
    from: () => query, innerJoin: () => query, where: () => query,
    limit: async () => [projection ? { storage: state.storage, managerId: state.managerId } : state.storage],
  }; return query; }, update: () => ({ set: (value: any) => ({ where: async () => { state.writes.push(value); } }) }) };
  db.transaction = async (run: any) => run(db); return { db };
});
vi.mock('./visit-duties', () => ({ storageDuties: state.capture }));
vi.mock('./outcome-delivery', () => ({ queueStorageVisitAction: state.queue, attemptOutcomeDelivery: async () => {} }));
vi.mock('./booking-lifecycle-delivery', () => ({}));
import { assistStorageVisit } from './visit-assistance';
const input = { action: 'departure' as const, reason: 'Manager witnessed storage removal after parent visit', actualAt: '2026-10-02T19:30:00Z',
  expectedUpdatedAt: '2026-10-02T18:00:00Z', expectedBookingUpdatedAt: '' };
describe('independent storage assistance', () => {
  beforeEach(() => {
    state.storage = { id: 30, kitchenBookingId: 10, status: 'confirmed', checkoutStatus: 'active', checkinStatus: null,
      startDate: new Date('2026-10-01'), updatedAt: new Date(input.expectedUpdatedAt), assistanceHistory: [{ action: 'prior' }],
      checkoutPhotoUrls: ['chef-evidence'], checkoutNotes: 'chef statement' };
    state.writes = []; state.managerId = 2; vi.clearAllMocks(); state.capture.mockResolvedValue({ version: 1 });
  });
  it('uses its own reservation after parent completion and never invents arrival or money', async () => {
    await assistStorageVisit(30, 2, input);
    expect(state.writes[0]).toMatchObject({ checkoutStatus: 'checkout_requested', assistanceHistory: [expect.anything(), expect.objectContaining({ actorId: 2, action: 'departure' })] });
    for (const key of ['status', 'paymentStatus', 'checkoutApprovedBy', 'checkinStatus', 'checkoutPhotoUrls', 'checkoutNotes']) expect(state.writes[0]).not.toHaveProperty(key);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), 30, 'departure', 2, expect.objectContaining({ reason: input.reason }));
  });
  it('records physical removal after automatic inspection without changing inspection or financial state', async () => {
    Object.assign(state.storage, { status: 'completed', checkoutStatus: 'completed', checkoutApprovedBy: null, checkoutApprovedAt: new Date('2026-10-02T18:10:00Z') });
    await assistStorageVisit(30, 2, { ...input, action: 'confirm_removal' });
    expect(state.writes[0]).toMatchObject({ checkoutApprovedBy: 2, checkoutApprovedAt: new Date(input.actualAt) });
    expect(state.writes[0]).not.toHaveProperty('checkoutStatus'); expect(state.writes[0]).not.toHaveProperty('status');
    expect(state.queue.mock.calls[0][2]).toBe('removal');
  });
  it('allows physical removal after draft handoff while preserving the claim', async () => {
    Object.assign(state.storage, { status: 'completed', checkoutStatus: 'checkout_claim_filed', checkoutApprovedBy: null });
    await assistStorageVisit(30, 2, { ...input, action: 'confirm_removal' });
    expect(state.writes[0].checkoutApprovedBy).toBe(2);
    expect(state.writes[0]).not.toHaveProperty('checkoutStatus');
  });
  it.each(['departure', 'confirm_removal'] as const)('rejects %s before the recorded arrival without changing evidence', async action => {
    state.storage.checkinCompletedAt = new Date('2026-10-02T20:00:00Z');
    if (action === 'confirm_removal') Object.assign(state.storage, { status: 'completed', checkoutStatus: 'completed', checkoutApprovedBy: null });
    await expect(assistStorageVisit(30, 2, { ...input, action })).rejects.toThrow(/cannot precede.*arrival/);
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.capture).not.toHaveBeenCalled();
  });
  it.each(['checkout_requested', 'checkout_claim_filed', 'completed'])('preserves competing %s inspection', async checkoutStatus => {
    state.storage.checkoutStatus = checkoutStatus;
    await expect(assistStorageVisit(30, 2, input)).rejects.toThrow(/inspection/);
    expect(state.writes).toEqual([]); expect(state.capture).not.toHaveBeenCalled();
  });
  it('rejects another manager, stale actions and dates before its own storage start', async () => {
    await expect(assistStorageVisit(30, 999, input)).rejects.toThrow(/not found/);
    await expect(assistStorageVisit(30, 2, { ...input, expectedUpdatedAt: '2026-10-01' })).rejects.toThrow(/changed/);
    await expect(assistStorageVisit(30, 2, { ...input, actualAt: '2026-09-30T19:30:00Z' })).rejects.toThrow(/own start/);
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
});
