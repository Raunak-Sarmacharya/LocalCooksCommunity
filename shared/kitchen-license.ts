/**
 * Kitchen license lifecycle — the single source of truth.
 *
 * Before this file the rule was duplicated and inconsistent: the server gated on
 * `kitchenLicenseStatus === 'approved'` (which silently rejected `pending_update`,
 * hiding the listing during a replacement review) and the client had its own
 * `isLicenseExpired` used only to paint a badge. Neither consulted the expiry date
 * against today, so an expired license kept accepting bookings forever.
 *
 * Two rules now live here and nowhere else:
 *
 *   1. `kitchenLicenseState` — what the manager should be told.
 *   2. `licenseAllowsBookings` — whether the listing may take bookings.
 *
 * The governing idea is that a listing is gated by "is there a VALID license on
 * file?", not by "is the newest submission approved?". A replacement uploaded while
 * the current license is still inside its dates does not interrupt bookings — the
 * old document is still legally valid, and suspending on upload would punish a
 * manager for renewing early. That matches Airbnb: they pause the listing when the
 * document EXPIRES, not when a renewal is submitted.
 *
 * Dates are compared as calendar dates, never as Date objects. `kitchen_license_expiry`
 * is a Postgres `date`, so it arrives as 'YYYY-MM-DD'. `new Date('2026-03-03')` parses
 * as UTC midnight and then renders in local time — in America/St_Johns (UTC-3:30) that
 * is 2026-03-02 20:30, which is why the page showed "3/2/2026" for a license that
 * expires on March 3rd.
 */

/** A license inside this window is still valid but should be renewed now. */
export const LICENSE_EXPIRING_SOON_DAYS = 30;

/** Last-chance window before the listing is paused. */
export const LICENSE_FINAL_WARNING_DAYS = 7;

export type KitchenLicenseState =
  | "not_uploaded"
  | "under_review"
  | "rejected"
  | "active"
  | "expiring_soon"
  | "expired";

/** Which reminder email (if any) a location is due. */
export type LicenseReminderStage = "30_day" | "7_day" | "expired";

export interface KitchenLicenseFields {
  kitchenLicenseUrl?: string | null;
  kitchenLicenseStatus?: string | null;
  kitchenLicenseExpiry?: string | null;
  kitchenLicensePendingUrl?: string | null;
  kitchenLicensePendingExpiry?: string | null;
}

/** Local calendar date as YYYY-MM-DD. */
export function toCalendarDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Accepts a `date` column value, an ISO timestamp, or a Date; returns YYYY-MM-DD or null. */
function toDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : toCalendarDate(value);
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** UTC midnight for a YYYY-MM-DD string — pure arithmetic, so DST cannot shift the result. */
function utcMidnight(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole days from `now` to `expiry`. 0 = expires today, negative = already past.
 * A license is valid THROUGH its expiry date, so the day it expires is not yet expired.
 */
export function daysUntilExpiry(
  expiry?: string | Date | null,
  now: Date = new Date(),
): number | null {
  const target = toDateOnly(expiry);
  if (!target) return null;
  return Math.round((utcMidnight(target) - utcMidnight(toCalendarDate(now))) / 86_400_000);
}

/**
 * A `date` column value as a LOCAL Date at midnight, for display.
 *
 * Never use `new Date("2026-03-03")` for this — it parses as UTC midnight and then
 * renders a day early anywhere west of Greenwich. In America/St_Johns (UTC-3:30) that
 * is 2026-03-02 20:30, which is exactly why the manager license page showed
 * "3/2/2026" for a license the database records as expiring on March 3rd.
 */
export function parseLicenseDate(value?: string | Date | null): Date | null {
  const only = toDateOnly(value);
  if (!only) return null;
  const [y, m, d] = only.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Approved with no expiry on record — nothing can warn about it or expire it. */
export function licenseHasNoExpiryDate(fields: KitchenLicenseFields): boolean {
  return !!fields.kitchenLicenseUrl && !fields.kitchenLicenseExpiry;
}

/** A replacement document is queued for review. The live license still governs. */
export function isReplacementUnderReview(fields: KitchenLicenseFields): boolean {
  return !!fields.kitchenLicensePendingUrl;
}

export function kitchenLicenseState(
  fields: KitchenLicenseFields,
  now: Date = new Date(),
): KitchenLicenseState {
  if (!fields.kitchenLicenseUrl) return "not_uploaded";

  const status = (fields.kitchenLicenseStatus || "pending").toLowerCase();

  if (status === "rejected") return "rejected";

  // 'pending_update' means a live approved license plus a queued replacement, so it
  // is evaluated against the LIVE expiry exactly like 'approved'.
  if (status === "approved" || status === "pending_update") {
    const days = daysUntilExpiry(fields.kitchenLicenseExpiry, now);
    if (days === null) return "active";
    if (days < 0) return "expired";
    if (days <= LICENSE_EXPIRING_SOON_DAYS) return "expiring_soon";
    return "active";
  }

  return "under_review";
}

/**
 * Whether the listing may take bookings.
 *
 * `expiring_soon` is deliberately true — the license is still valid, so bookings are
 * allowed while we warn. Only `expired` stops the listing.
 */
export function licenseAllowsBookings(
  fields: KitchenLicenseFields,
  now: Date = new Date(),
): boolean {
  const state = kitchenLicenseState(fields, now);
  return state === "active" || state === "expiring_soon";
}

/**
 * The reminder this location is due right now, or null.
 *
 * Callers are expected to make the send idempotent with a tracking id derived from
 * `(stage, locationId, expiry)` — the stage stays the same for the whole window, so a
 * stable tracking id means one email per window per document rather than one per day.
 */
export function licenseReminderStage(
  fields: KitchenLicenseFields,
  now: Date = new Date(),
): LicenseReminderStage | null {
  if (!fields.kitchenLicenseUrl) return null;

  const status = (fields.kitchenLicenseStatus || "").toLowerCase();
  if (status !== "approved" && status !== "pending_update") return null;

  const days = daysUntilExpiry(fields.kitchenLicenseExpiry, now);
  if (days === null) return null;

  if (days < 0) return "expired";
  if (days <= LICENSE_FINAL_WARNING_DAYS) return "7_day";
  if (days <= LICENSE_EXPIRING_SOON_DAYS) return "30_day";
  return null;
}
