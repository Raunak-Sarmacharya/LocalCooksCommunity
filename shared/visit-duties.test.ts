import { describe, expect, it } from 'vitest';
import { makeVisitDuties, readVisitDuties, tickTasks, validateDutySection } from './visit-duties';
const settings = { checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 0 };
describe('versioned visit duties and supported tracking matrix', () => {
  it.each([false, true])('keeps both steps regardless of legacy flags (%s)', enabled => {
    for (const arrival of [false, true]) for (const departure of [false, true]) {
      const duties = makeVisitDuties({ checkinEnabled: arrival, checkoutEnabled: departure }, false, settings, 'confirmation');
      expect(duties.arrival.workflowEnabled).toBe(true);
      expect(duties.arrival.enabled).toBe(true);
      expect(duties.arrival.tasksRequired).toBe(false);
      expect(duties.departure.workflowEnabled).toBe(true);
      expect(readVisitDuties(duties)).toBe(duties);
    }
  });
  it('keeps storage independent of the kitchen tracking gate', () => {
    const duties = makeVisitDuties({ storageCheckinEnabled: false, storageCheckoutEnabled: true }, true, settings, 'legacy_first_action');
    expect(duties.arrival.enabled).toBe(false); expect(duties.departure.enabled).toBe(true);
  });
  it('does not require generic photos, disabled duties or optional items', () => {
    const duties = makeVisitDuties({ checkinEnabled: true, checkinItems: [{ id: 'note', label: 'Optional note', required: false }] }, false, settings, 'confirmation');
    expect(validateDutySection(duties.arrival)).toEqual({ valid: true });
    expect(validateDutySection({ ...duties.arrival, enabled: false, photos: [{ id: 'p', label: 'Photo' }] })).toEqual({ valid: true });
  });
  it('enforces required items and distinct photos while removing retired access duties', () => {
    const duties = makeVisitDuties({ checkinEnabled: true,
      checkinItems: [{ id: 'lock', category: 'smart_lock', label: 'Door code' }, { id: 'safety', label: 'Safety', required: true }],
      checkinPhotoRequirements: [{ id: 'lock', label: 'Code' }, { id: 'safety', label: 'Safety' }, { id: 'clean', label: 'Clean' }] }, false, settings, 'confirmation');
    expect(duties.arrival.items).toHaveLength(1); expect(duties.arrival.photos).toHaveLength(2);
    expect(validateDutySection(duties.arrival, ['same', 'same'], [{ id: 'safety', checked: true }]).valid).toBe(false);
    expect(validateDutySection(duties.arrival, ['a', 'b'], [{ id: 'safety', checked: true }])).toEqual({ valid: true });
  });
  it('treats a task with a photo slot as done by its photo, not by a tick (owner Oct 29)', () => {
    const section = { enabled: true, instructions: null, items: [{ id: 'wipe', label: 'Wipe' }, { id: 'station', label: 'Station photo' }], photos: [{ id: 'station', label: 'Station photo' }] };
    expect(tickTasks(section.items, section.photos).map(item => item.id)).toEqual(['wipe']);
    expect(validateDutySection(section, ['https://x/a.jpg'], [{ id: 'wipe', checked: true }]).valid).toBe(true);
    expect(validateDutySection(section, [], [{ id: 'wipe', checked: true }, { id: 'station', checked: true }]).fieldErrors?.photos).toBeTruthy();
    expect(validateDutySection(section, ['https://x/a.jpg'], []).fieldErrors?.items).toContain('Wipe');
  });
  it('fails explicitly for an unknown snapshot version instead of applying current requirements', () => {
    expect(() => readVisitDuties({ version: 2 })).toThrow(/Local Cooks review/);
  });
  it('reads a disabled version-one snapshot without adding fields or rewriting its requirements', () => {
    const section = { enabled: false, instructions: 'Original', items: [{ id: 'legacy', label: 'Original task', required: false }], photos: [] };
    const legacy = { version: 1, source: 'confirmation', capturedAt: '2026-10-01T00:00:00Z', arrival: section, departure: section, ...settings };
    const before = JSON.stringify(legacy);
    expect(readVisitDuties(legacy)).toBe(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(section).not.toHaveProperty('workflowEnabled');
  });
});
