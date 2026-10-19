export function fmtMoney(cents: number | null | undefined, currency = "CAD", locale = "en-CA"): string {
  if (cents == null) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

/** "Oct 16, 2026" for the recorded operating date (stored at midnight UTC, so read it in UTC). */
export function fmtOperatingDate(iso: string, locale = "en-CA"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(d);
}

/** "Mon, Nov 2" for a booking day (a date-only value, read in UTC). */
export const adminDay = (date: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${String(date).slice(0, 10)}T12:00:00Z`));

/** Like fmtMoney, but a whole-dollar amount drops the cents ("$25"). */
export function fmtMoneyWhole(cents: number | null | undefined, currency = "CAD", locale = "en-CA"): string {
  if (cents == null) return "";
  if (cents % 100 !== 0) return fmtMoney(cents, currency, locale);
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}
