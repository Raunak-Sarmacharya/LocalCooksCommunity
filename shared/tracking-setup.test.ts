import { describe, expect, it } from 'vitest';
import { hasTrackingNotes, normalizeTrackingSetup } from './tracking-setup';

describe('one tracking choice and required notes', () => {
  const kitchen = { checkinInstructions: 'Use the front entrance', checkoutInstructions: 'Return keys to reception' };
  const storage = { storageCheckinInstructions: 'Use shelf A', storageCheckoutInstructions: 'Remove all containers' };
  it('accepts enabled empty checklists with both saved notes', () => {
    const result = normalizeTrackingSetup({ checkinEnabled: true, checkinItems: [], checkoutItems: [] }, kitchen);
    expect(result.error).toBeUndefined();
    expect(result.patch).toMatchObject({ checkinEnabled: true, checkoutEnabled: true, checkinItems: [], checkoutItems: [] });
  });
  it('enables both storage actions together and leaves kitchen configuration untouched', () => {
    const result = normalizeTrackingSetup({ storageCheckoutEnabled: true }, storage);
    expect(result.patch).toEqual({ storageCheckinEnabled: true, storageCheckoutEnabled: true });
  });
  it('blocks missing or whitespace notes even with duties or photos', () => {
    for (const note of [null, '', '  ']) expect(normalizeTrackingSetup({ storageCheckinEnabled: true,
      storageCheckinInstructions: note, storageCheckinItems: [{ id: 'photo' }] }, storage).error).toMatch(/Save arrival and departure notes/);
  });
  it('accepts typing and enabling notes in one save', () => {
    expect(normalizeTrackingSetup({ storageCheckinEnabled: true, ...storage }, null).patch)
      .toMatchObject({ storageCheckinEnabled: true, storageCheckoutEnabled: true });
  });
  it('allows disabling without deleting notes or duties', () => {
    expect(normalizeTrackingSetup({ storageCheckinEnabled: false }, { storageCheckinEnabled: true,
      storageCheckoutEnabled: true, storageCheckinItems: [{ id: 'keep' }] }).patch)
      .toEqual({ storageCheckinEnabled: false, storageCheckoutEnabled: false });
  });
  it('rejects conflicting or non-boolean stage choices', () => {
    expect(normalizeTrackingSetup({ checkinEnabled: true, checkoutEnabled: false }, kitchen).error).toBeTruthy();
    expect(normalizeTrackingSetup({ checkinEnabled: 'true' }, kitchen).error).toBeTruthy();
  });
  it('prevents clearing notes for an enabled workflow but permits disabled drafts', () => {
    expect(normalizeTrackingSetup({ checkoutInstructions: '' }, { ...kitchen, checkinEnabled: true, checkoutEnabled: true }).error).toBeTruthy();
    expect(normalizeTrackingSetup({ checkoutInstructions: '' }, kitchen).error).toBeUndefined();
  });
  it('does not conflate kitchen and storage notes or validate untouched legacy groups', () => {
    expect(hasTrackingNotes(kitchen, true)).toBe(false);
    expect(normalizeTrackingSetup({ timeWindowSettings: {} }, { storageCheckinEnabled: true }).patch)
      .toEqual({ timeWindowSettings: {} });
  });
});
