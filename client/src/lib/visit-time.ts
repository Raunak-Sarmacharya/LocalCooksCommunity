import { friendlyTimezoneName } from '@shared/timezone-utils';

export function formatVisitTime(value: string, timezone: string, locale = 'en-CA', date = true): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone, ...(date ? { year: 'numeric', month: 'short', day: 'numeric' } as const : {}),
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value));
}

export { friendlyTimezoneName };
