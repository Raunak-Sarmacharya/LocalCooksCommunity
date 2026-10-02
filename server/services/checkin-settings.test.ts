import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][] }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: async () => state.rows.shift() ?? [],
    then: (resolve: any) => resolve(state.rows.shift() ?? []) };
  return chain;
} } }));
import { getCheckinSettings } from './kitchen-checkout-service';
describe('configured kitchen windows', () => {
  beforeEach(() => { state.rows = []; });
  it('uses persisted admin access-code windows and preserves zero', async () => {
    state.rows.push([{ key: 'kitchen_access_code_valid_before_minutes', value: '0' },
      { key: 'kitchen_access_code_valid_after_minutes', value: '42' }]);
    expect(await getCheckinSettings()).toMatchObject({ accessCodeValidBeforeMinutes: 0, accessCodeValidAfterMinutes: 42 });
  });
  it('applies location overrides only to check-in and no-show windows', async () => {
    state.rows.push([{ key: 'kitchen_checkout_review_window_minutes', value: '90' }],
      [{ checkinWindowMinutesBefore: 5, noShowGraceMinutes: 0 }]);
    expect(await getCheckinSettings(1)).toMatchObject({ checkinWindowMinutesBefore: 5, noShowGraceMinutes: 0,
      checkoutReviewWindowMinutes: 90, accessCodeValidBeforeMinutes: 15 });
  });
  it('rejects malformed persisted windows instead of truncating them', async () => {
    state.rows.push([{ key: 'kitchen_no_show_grace_minutes', value: '30.5' }]);
    await expect(getCheckinSettings()).rejects.toThrow(/Invalid setting/);
  });
  it('rejects invalid location overrides', async () => {
    state.rows.push([], [{ noShowGraceMinutes: -1, checkinWindowMinutesBefore: null }]);
    await expect(getCheckinSettings(1)).rejects.toThrow(/Invalid location/);
  });
});
