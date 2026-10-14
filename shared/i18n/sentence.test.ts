import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { collapseDoublePeriods, sentencePostProcessor } from './sentence';
import booking from './locales/en-CA/booking.json';
import chef from './locales/en-CA/chef.json';

describe('sentences ending with a localized time', () => {
  it('collapses exactly two periods and never touches an ellipsis', () => {
    expect(collapseDoublePeriods('You have until 7:55 p.m..')).toBe('You have until 7:55 p.m.');
    expect(collapseDoublePeriods('The request closes at 6:21 p.m.. Their card is safe.')).toBe('The request closes at 6:21 p.m.. Their card is safe.'.replace('p.m..', 'p.m.'));
    expect(collapseDoublePeriods('Saving...')).toBe('Saving...');
    expect(collapseDoublePeriods('Choose a time…')).toBe('Choose a time…');
    expect(collapseDoublePeriods('Ends 18 h 30.')).toBe('Ends 18 h 30.');
  });
  it('applies to every translated string through the i18next post-processor (real en-CA copy)', async () => {
    const i18n = i18next.createInstance();
    await i18n.use(ICU).use(sentencePostProcessor).init({ lng: 'en-CA', resources: { 'en-CA': { booking, chef } }, postProcess: ['sentence'], interpolation: { escapeValue: false } });
    const time = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date('2026-10-14T19:55:00Z'));
    expect(time.endsWith('.')).toBe(true); // "7:55 p.m." — the reason this exists
    expect(i18n.t('sxbApproved', { ns: 'booking', chef: 'Maya', time })).toBe(`Approved. Maya has until ${time}`);
    expect(i18n.t('sxbRequestHint', { ns: 'booking', amount: '$15.01', expires: time })).toMatch(/closes at 7:55\sp\.m\.$/);
    expect(i18n.t('kciBookingStillEnds', { ns: 'chef', end: time })).not.toMatch(/\.\.$/);
    // Defaults rendered through t() are covered too.
    expect(i18n.t('missingKey', { ns: 'booking', defaultValue: 'Until {time}.', time })).toBe(`Until ${time}`);
  });
});
