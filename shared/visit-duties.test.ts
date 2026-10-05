import { describe, expect, it } from 'vitest';
import { makeVisitDuties, readVisitDuties, validateDutySection } from './visit-duties';
const settings = { checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 0 };
describe('versioned visit duties and supported tracking matrix', () => {
  it.each([false, true])('supports kitchen gate %s without enabling mandatory tracking', enabled => {
    for (const arrival of [false, true]) for (const departure of [false, true]) {
      const duties = makeVisitDuties({ checkinEnabled: arrival, checkoutEnabled: departure }, enabled, false, settings, 'confirmation');
      expect(duties.arrival.enabled).toBe(enabled && arrival);
      expect(duties.departure.enabled).toBe(enabled && departure);
      expect(readVisitDuties(duties)).toBe(duties);
    }
  });
  it('keeps storage independent of the kitchen tracking gate', () => {
    const duties = makeVisitDuties({ storageCheckinEnabled: false, storageCheckoutEnabled: true }, false, true, settings, 'legacy_first_action');
    expect(duties.arrival.enabled).toBe(false); expect(duties.departure.enabled).toBe(true);
  });
  it('does not require generic photos, disabled duties or optional items', () => {
    const duties = makeVisitDuties({ checkinEnabled: true, checkinItems: [{ id: 'note', label: 'Optional note', required: false }] }, true, false, settings, 'confirmation');
    expect(validateDutySection(duties.arrival)).toEqual({ valid: true });
    expect(validateDutySection({ ...duties.arrival, enabled: false, photos: [{ id: 'p', label: 'Photo' }] })).toEqual({ valid: true });
  });
  it('enforces required items and distinct photos while removing retired access duties', () => {
    const duties = makeVisitDuties({ checkinEnabled: true,
      checkinItems: [{ id: 'lock', category: 'smart_lock', label: 'Door code' }, { id: 'safety', label: 'Safety', required: true }],
      checkinPhotoRequirements: [{ id: 'lock', label: 'Code' }, { id: 'safety', label: 'Safety' }, { id: 'clean', label: 'Clean' }] }, true, false, settings, 'confirmation');
    expect(duties.arrival.items).toHaveLength(1); expect(duties.arrival.photos).toHaveLength(2);
    expect(validateDutySection(duties.arrival, ['same', 'same'], [{ id: 'safety', checked: true }]).valid).toBe(false);
    expect(validateDutySection(duties.arrival, ['a', 'b'], [{ id: 'safety', checked: true }])).toEqual({ valid: true });
  });
  it('fails explicitly for an unknown snapshot version instead of applying current requirements', () => {
    expect(() => readVisitDuties({ version: 2 })).toThrow(/Local Cooks review/);
  });
});
