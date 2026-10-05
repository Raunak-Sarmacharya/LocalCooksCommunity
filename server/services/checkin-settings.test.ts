import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][] }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: async () => state.rows.shift() ?? [],
    then: (resolve: any) => resolve(state.rows.shift() ?? []) };
  return chain;
} } }));
import { getCheckinSettings, validateRequiredChecklistItems, validateRequiredPhotos } from './kitchen-checkout-service';
describe('configured kitchen windows', () => {
  beforeEach(() => { state.rows = []; });
  it('ignores retired access settings even when their persisted values are invalid', async () => {
    state.rows.push([{ key: 'kitchen_access_code_valid_before_minutes', value: 'invalid' },
      { key: 'kitchen_access_code_valid_after_minutes', value: '-42' },
      { key: 'kitchen_checkin_window_minutes_before', value: '0' }]);
    expect(await getCheckinSettings()).toEqual({ checkinWindowMinutesBefore: 0, noShowGraceMinutes: 30,
      checkoutReviewWindowMinutes: 60 });
  });
  it('applies location overrides only to check-in and no-show windows', async () => {
    state.rows.push([{ key: 'kitchen_checkout_review_window_minutes', value: '90' }],
      [{ checkinWindowMinutesBefore: 5, noShowGraceMinutes: 0 }]);
    expect(await getCheckinSettings(1)).toMatchObject({ checkinWindowMinutesBefore: 5, noShowGraceMinutes: 0,
      checkoutReviewWindowMinutes: 90 });
  });
  it('rejects malformed persisted windows instead of truncating them', async () => {
    state.rows.push([{ key: 'kitchen_no_show_grace_minutes', value: '30.5' }]);
    await expect(getCheckinSettings()).rejects.toThrow(/Invalid setting/);
  });
  it('rejects invalid location overrides', async () => {
    state.rows.push([], [{ noShowGraceMinutes: -1, checkinWindowMinutesBefore: null }]);
    await expect(getCheckinSettings(1)).rejects.toThrow(/Invalid location/);
  });
  it('inherits saved platform arrival timing when the location override is absent', async () => {
    state.rows.push([{ key: 'kitchen_checkin_window_minutes_before', value: '25' }],
      [{ checkinWindowMinutesBefore: null, noShowGraceMinutes: null }]);
    expect(await getCheckinSettings(33)).toMatchObject({ checkinWindowMinutesBefore: 25 });
  });
  it('does not require legacy access tasks or their photos while still enforcing safety tasks', async () => {
    const row = { checkinEnabled: true, checkinItems: [
      { id: 'lock', label: 'Enter door code', category: 'smart_lock', required: true },
      { id: 'safety', label: 'Inspect equipment', category: 'safety', required: true },
    ], checkinPhotoRequirements: [{ id: 'lock', required: true }, { id: 'safety', required: true }] };
    state.rows.push([row]);
    expect(await validateRequiredChecklistItems(1, 'checkin', [
      { id: 'safety', label: 'Inspect equipment', checked: true },
    ])).toEqual({ valid: true });
    state.rows.push([row]);
    expect(await validateRequiredChecklistItems(1, 'checkin', [])).toEqual({
      valid: false, error: 'Please complete all required checklist items. Unchecked: Inspect equipment',
    });
    state.rows.push([row]);
    expect(await validateRequiredPhotos(1, 'checkin', ['https://example.test/safety.jpg'])).toEqual({ valid: true });
    state.rows.push([row]);
    expect(await validateRequiredPhotos(1, 'checkin', [])).toMatchObject({ valid: false,
      error: 'Please upload one photo for each required item (1 required, 0 provided)' });
  });
});
