import { describe, expect, it } from 'vitest';
import en from '@shared/i18n/locales/en-CA/chef.json';
import fr from '@shared/i18n/locales/fr-CA/chef.json';
import uk from '@shared/i18n/locales/uk/chef.json';
import { bookingStatusLabel } from './booking-status-label';

const statuses = ['pending', 'confirmed', 'cancelled', 'completed', 'cancellation_requested'];
describe('booking status label', () => {
  it.each([['en-CA', en, 'Completed'], ['fr-CA', fr, 'Terminée'], ['uk', uk, 'Завершено']] as const)(
    'is localized and capitalized for every status in %s', (_locale, resources, completed) => {
      const t = (key: string) => (resources as Record<string, string>)[key];
      expect(bookingStatusLabel('completed', t)).toBe(completed);
      for (const status of statuses) {
        const label = bookingStatusLabel(status, t);
        expect(label).toBeTruthy();
        expect(label).not.toBe(status);
        expect(label.charAt(0)).toBe(label.charAt(0).toLocaleUpperCase());
        expect(label).not.toMatch(/_/);
      }
    });
  it('humanizes an unknown status instead of printing the raw value', () => {
    expect(bookingStatusLabel('no_show', () => '')).toBe('No show');
  });
});
