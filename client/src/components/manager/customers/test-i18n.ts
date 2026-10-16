import { IntlMessageFormat } from 'intl-messageformat';
import en from '@shared/i18n/locales/en-CA/manager.json';
import fr from '@shared/i18n/locales/fr-CA/manager.json';
import uk from '@shared/i18n/locales/uk/manager.json';

const bundles = { 'en-CA': en, 'fr-CA': fr, uk } as unknown as Record<string, Record<string, string>>;

/** A `mt` for tests that formats ICU the way the app does (plurals, {placeholders}) against the real locale files. */
export function createMt(locale = 'en-CA') {
  return (key: string, options: Record<string, unknown> = {}) => {
    const message = bundles[locale][key];
    if (message === undefined) return key;
    return String(new IntlMessageFormat(message, locale).format(options as never));
  };
}
