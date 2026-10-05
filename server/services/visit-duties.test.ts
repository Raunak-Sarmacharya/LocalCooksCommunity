import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, checklist: {} as any, enabled: true, writes: [] as any[] }));
vi.mock('../db', () => ({ db: {
  select: () => { const q: any = { from: () => q, innerJoin: () => q, leftJoin: () => q, where: () => q,
    limit: async () => [{ booking: state.booking, kitchen: { locationId: 5, checkinCheckoutEnabled: state.enabled }, checklist: state.checklist }] }; return q; },
  update: () => ({ set: (values: any) => ({ where: async () => { state.writes.push(values); Object.assign(state.booking, values); } }) }),
} }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 }) }));
vi.mock('./damage-claim-limits-service', () => ({ getStorageCheckoutSettings: async () => ({ reviewWindowHours: 2 }) }));
import { kitchenDuties, storageDuties } from './visit-duties';
describe('snapshot service (mocked database)', () => {
  beforeEach(() => { state.booking = { id: 10, visitDuties: null }; state.enabled = true; state.writes = [];
    state.checklist = { checkinEnabled: true, checkoutEnabled: true, checkoutItems: [{ id: 'clean', label: 'Original cleaning', required: true }],
      storageCheckinEnabled: false, storageCheckoutEnabled: true }; });
  it('keeps read-only legacy previews unsaved until the first actual action', async () => {
    expect((await kitchenDuties(10)).source).toBe('legacy_first_action'); expect(state.writes).toEqual([]);
    const captured = await kitchenDuties(10, undefined, 'legacy_first_action');
    expect(state.booking.visitDuties).toEqual(captured);
  });
  it.each(['not_checked_in', 'checked_in'])('retains confirmation duties before or after start (%s)', async checkinStatus => {
    state.booking.checkinStatus = checkinStatus;
    const captured = await kitchenDuties(10, undefined, 'confirmation');
    state.enabled = false; state.checklist = { checkoutEnabled: false, checkoutItems: [{ id: 'extra', label: 'New duty' }] };
    expect(await kitchenDuties(10)).toEqual(captured);
    expect((await kitchenDuties(10)).departure.items[0].label).toBe('Original cleaning');
    expect(state.writes).toHaveLength(1);
  });
  it('captures independent storage requirements and actual storage review window', async () => {
    const captured = await storageDuties(30, undefined, 'confirmation');
    expect(captured.arrival.enabled).toBe(false); expect(captured.departure.enabled).toBe(true);
    expect(captured.checkoutReviewWindowMinutes).toBe(120);
    state.checklist.storageCheckoutEnabled = false;
    expect(await storageDuties(30)).toEqual(captured);
  });
});
