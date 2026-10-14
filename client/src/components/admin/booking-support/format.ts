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
