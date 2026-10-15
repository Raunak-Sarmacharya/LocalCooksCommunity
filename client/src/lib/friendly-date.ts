/**
 * People-style dates for the booking page: "Oct 15", "Oct 15 at 8:00 p.m."; the year only when it isn't this year
 * (in the kitchen's zone). fr-CA "15 oct. à 20 h 00", uk "15 жовт. о 20:00". Display only.
 */
const AT: Record<string, string> = { en: 'at', fr: 'à', uk: 'о' };

function yearOf(at: Date, timeZone?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(at);
}

export function friendlyDate(value: Date | string, locale: string, timeZone?: string, now: Date = new Date()) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return '';
  const withYear = yearOf(at, timeZone) !== yearOf(now, timeZone);
  return new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}) }).format(at);
}

export function friendlyTime(value: Date | string, locale: string, timeZone?: string) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit', hour12: locale.toLowerCase().startsWith('en') ? true : undefined }).format(at);
}

export function friendlyDateTime(value: Date | string, locale: string, timeZone?: string, now: Date = new Date()) {
  const date = friendlyDate(value, locale, timeZone, now);
  if (!date) return '';
  const word = AT[(locale || 'en').toLowerCase().split('-')[0]] ?? AT.en;
  return `${date} ${word} ${friendlyTime(value, locale, timeZone)}`;
}
