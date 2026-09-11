/**
 * Locale-aware formatting — never hardcode en-CA inside call sites.
 * Currency policy remains CAD; timezone is independent of language.
 */

import { DEFAULT_LOCALE, type AppLocale, isAppLocale } from "./locales";

export const DEFAULT_TIMEZONE = "America/St_Johns";
export const DEFAULT_CURRENCY = "CAD";

function localeOrDefault(locale?: string | null): string {
  if (locale && isAppLocale(locale)) return locale;
  if (locale) return locale;
  return DEFAULT_LOCALE;
}

export function formatCurrency(
  amountInCents: number,
  options?: {
    locale?: string | null;
    currency?: string;
  }
): string {
  const locale = localeOrDefault(options?.locale);
  const currency = options?.currency ?? DEFAULT_CURRENCY;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountInCents / 100);
}

export function formatNumber(
  value: number,
  options?: { locale?: string | null }
): string {
  return new Intl.NumberFormat(localeOrDefault(options?.locale)).format(value);
}

export function formatPercent(
  value: number,
  options?: { locale?: string | null; decimals?: number; signed?: boolean }
): string {
  const decimals = options?.decimals ?? 1;
  const locale = localeOrDefault(options?.locale);
  const formatted = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);

  if (options?.signed && value > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

export type DateFormatStyle = "short" | "long" | "full";

export function formatDate(
  dateStr: string | Date,
  options?: {
    locale?: string | null;
    style?: DateFormatStyle;
    timeZone?: string;
  }
): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const locale = localeOrDefault(options?.locale);
  const timeZone = options?.timeZone ?? DEFAULT_TIMEZONE;
  const style = options?.style ?? "short";

  const formatOptions: Record<DateFormatStyle, Intl.DateTimeFormatOptions> = {
    short: { month: "short", day: "numeric", year: "numeric", timeZone },
    long: {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    },
    full: {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone,
    },
  };

  return new Intl.DateTimeFormat(locale, formatOptions[style]).format(date);
}

export function formatDateTime(
  dateStr: string | Date,
  options?: {
    locale?: string | null;
    timeZone?: string;
  }
): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return new Intl.DateTimeFormat(localeOrDefault(options?.locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options?.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}

/**
 * Format HH:MM to locale-aware 12/24h display.
 */
export function formatTimeOfDay(
  time: string,
  options?: { locale?: string | null }
): string {
  const [hours, minutes] = time.split(":").map((x) => Number.parseInt(x, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return new Intl.DateTimeFormat(localeOrDefault(options?.locale), {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(
  dateStr: string | Date,
  options?: { locale?: string | null; now?: Date }
): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const now = options?.now ?? new Date();
  const locale = localeOrDefault(options?.locale);
  const diffMs = date.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (absSec < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
  const diffYear = Math.round(diffDay / 365);
  return rtf.format(diffYear, "year");
}

export function formatList(
  items: string[],
  options?: { locale?: string | null; type?: "conjunction" | "disjunction" }
): string {
  return new Intl.ListFormat(localeOrDefault(options?.locale), {
    style: "long",
    type: options?.type ?? "conjunction",
  }).format(items);
}

export function compareStrings(
  a: string,
  b: string,
  locale?: string | null
): number {
  return new Intl.Collator(localeOrDefault(locale), {
    sensitivity: "base",
  }).compare(a, b);
}

/** Helper for call sites that already know AppLocale */
export function withLocale(locale: AppLocale | string | null | undefined) {
  const resolved = localeOrDefault(locale);
  return {
    currency: (cents: number, currency = DEFAULT_CURRENCY) =>
      formatCurrency(cents, { locale: resolved, currency }),
    number: (value: number) => formatNumber(value, { locale: resolved }),
    date: (d: string | Date, style?: DateFormatStyle, timeZone?: string) =>
      formatDate(d, { locale: resolved, style, timeZone }),
    dateTime: (d: string | Date, timeZone?: string) =>
      formatDateTime(d, { locale: resolved, timeZone }),
    relative: (d: string | Date) =>
      formatRelativeTime(d, { locale: resolved }),
  };
}
