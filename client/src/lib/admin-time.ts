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

/**
 * "Wed, Oct 14, 2026 · 10:00–11:00 a.m." A same-day range shows its date once and the a.m./p.m. once
 * when both ends share it. A range over midnight keeps both full dates.
 */
export function formatAdminRange(startIso: string, endIso: string, zone?: AdminTimeZone, locale = "en-CA"): string {
  const start = new Date(startIso), end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const { timeZone } = resolve(zone);
  const dateFmt = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" });
  if (dateFmt.format(start) !== dateFmt.format(end)) return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${dateFmt.format(end)} · ${timeFmt.format(end)}`;
  const parts = (d: Date) => timeFmt.formatToParts(d);
  const period = (d: Date) => parts(d).find((p) => p.type === "dayPeriod")?.value;
  let from = timeFmt.format(start);
  if (period(start) && period(start) === period(end)) {
    from = parts(start).filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  }
  return `${dateFmt.format(start)} · ${from}–${timeFmt.format(end)}`;
}
