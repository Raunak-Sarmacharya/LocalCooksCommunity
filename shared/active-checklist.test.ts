import { describe, expect, it } from 'vitest';
import { activeChecklist } from './active-checklist';

describe('legacy checklist compatibility', () => {
  it.each(['checkin', 'checkout', 'storageCheckin', 'storageCheckout'])('removes retired %s tasks without changing the stored row', section => {
    const kept = { id: 'clean', category: 'general', label: 'Clean work surface', required: true };
    const items = [kept, { id: 'code', category: 'smart_lock', label: 'Enter code', required: true }];
    const photos = [{ id: 'clean' }, { id: 'code' }, { id: 'room' }];
    const row = { [`${section}Items`]: items, [`${section}PhotoRequirements`]: photos, checkinEnabled: true };
    expect(activeChecklist(row)).toEqual({ ...row, [`${section}Items`]: [kept],
      [`${section}PhotoRequirements`]: [{ id: 'clean' }, { id: 'room' }] });
    expect(row[`${section}Items`]).toBe(items);
    expect(items).toHaveLength(2);
  });
  it('preserves partial updates and ordinary photo requirements', () => {
    const row = { checkinPhotoRequirements: [{ id: 'room' }], checkoutItems: null, checkinInstructions: 'Meet the host' };
    expect(activeChecklist(row)).toEqual(row);
  });
});
