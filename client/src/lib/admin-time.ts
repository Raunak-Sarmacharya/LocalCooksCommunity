/**
 * Admin screens always show a time together with the zone it is in, so nobody
 * has to guess whether they are reading UTC or kitchen-local time.
 */
export const ADMIN_DEFAULT_TIMEZONE = "America/St_Johns";
export const ADMIN_DEFAULT_ZONE_LABEL = "Newfoundland Time";

export type AdminTimeZone = { timeZone?: string | null; zoneLabel?: string | null };

function resolve(zone?: AdminTimeZone) {
  const timeZone = zone?.timeZone || ADMIN_DEFAULT_TIMEZONE;
  const zoneLabel = zone?.zoneLabel || (zone?.timeZone ? zone.timeZone.replace(/_/g, " ") : ADMIN_DEFAULT_ZONE_LABEL);
  return { timeZone, zoneLabel };
}

/** "Oct 16, 2026, 9:00 a.m. · Newfoundland Time" */
export function formatAdminDateTime(iso: string | null | undefined, zone?: AdminTimeZone, locale = "en-CA"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { timeZone, zoneLabel } = resolve(zone);
  const text = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  return `${text} · ${zoneLabel}`;
}

/** "9:00 a.m. · Newfoundland Time" */
export function formatAdminTimeOnly(iso: string | null | undefined, zone?: AdminTimeZone, locale = "en-CA"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { timeZone, zoneLabel } = resolve(zone);
  return `${new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(date)} · ${zoneLabel}`;
}

export function formatAdminDateOnly(iso: string | null | undefined, zone?: AdminTimeZone, locale = "en-CA"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { timeZone } = resolve(zone);
  return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
}
