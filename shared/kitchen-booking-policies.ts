interface KitchenPolicies {
  maxAdvanceBookingDays?: number | null;
  turnoverBufferEnabled?: boolean | null;
  bookingBufferMinutes?: number | null;
  maxBookingDays?: number | null;
  allowMultiDayBookings?: boolean | null;
  weeklyChefHoursLimit?: number | null;
  minimumBookingHours?: number | null;
  cancellationPolicyHours?: number | null;
  minimumBookingWindowHours?: number | null;
  defaultDailyBookingLimit?: number | null;
}

export const BOOKING_BUFFER_MINUTES = [0, 60, 120] as const;
export type BookingBufferMinutes = (typeof BOOKING_BUFFER_MINUTES)[number];
export const DEFAULT_MAX_BOOKING_DAYS = 7;
export const DEFAULT_BOOKING_DAYS_CAP = 14;

export const PRE_CONFIRMATION_REFUND_POLICY =
  'Withdraw before the kitchen confirms. No payment is taken; your whole card hold is released.';

export const CONFIRMED_BOOKING_REFUND_POLICY =
  'After confirmation, you can cancel immediately under your booking’s saved policy. Any refund keeps the actual card processing fee. Review the exact dollars before cancelling.';

export function isKitchenBookingDurationValid(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  const limit = resolveKitchenBookingPolicies(kitchen, location).defaultDailyBookingLimit;
  // NULL = no longest-booking cap; any minimum is fine.
  if (limit == null) return true;
  return (kitchen.minimumBookingHours ?? 0) <= limit;
}

export function effectiveBookingWindowDays(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined, cap = 90) {
  return Math.min(kitchen.maxAdvanceBookingDays ?? location?.maxAdvanceBookingDays ?? 30, cap);
}

/** Legacy boolean buffer: true when effective spacing is at least one hour. */
export function effectiveTurnoverBuffer(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  return effectiveBookingBufferMinutes(kitchen, location) > 0;
}

/**
 * Resolve Off/1 h/2 h buffer minutes.
 * Kitchen numeric → kitchen legacy boolean → location numeric → location legacy boolean → 0.
 */
export function effectiveBookingBufferMinutes(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined): BookingBufferMinutes {
  if (isBookingBufferMinutes(kitchen.bookingBufferMinutes)) return kitchen.bookingBufferMinutes;
  if (kitchen.turnoverBufferEnabled != null) return kitchen.turnoverBufferEnabled ? 60 : 0;
  if (isBookingBufferMinutes(location?.bookingBufferMinutes)) return location!.bookingBufferMinutes!;
  if (location?.turnoverBufferEnabled != null) return location.turnoverBufferEnabled ? 60 : 0;
  return 0;
}

/** The current buffer from a resolved policy (older readers only carry the legacy boolean). */
export const policyBufferMinutes = (policy: { bookingBufferMinutes?: number | null; turnoverBufferEnabled?: boolean | null }) =>
  policy.bookingBufferMinutes ?? (policy.turnoverBufferEnabled ? 60 : 0);

export function isBookingBufferMinutes(value: unknown): value is BookingBufferMinutes {
  return value === 0 || value === 60 || value === 120;
}

export function validBookingWindowDays(value: unknown, cap: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= cap;
}

export function validBookingDays(value: unknown, cap: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= cap;
}

export function validWeeklyChefHoursLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 168;
}

export function effectiveMaxBookingDaysSetting(
  kitchen: KitchenPolicies,
  location: KitchenPolicies | null | undefined,
  cap = DEFAULT_BOOKING_DAYS_CAP,
) {
  return Math.min(kitchen.maxBookingDays ?? location?.maxBookingDays ?? DEFAULT_MAX_BOOKING_DAYS, cap);
}

export function effectiveAllowMultiDayBookings(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  return kitchen.allowMultiDayBookings ?? location?.allowMultiDayBookings ?? true;
}

/**
 * Apply a buffer write. Prefer numeric; translate stale boolean so a 2 h setting is not erased.
 * Null clears both representations (kitchen override reset).
 */
export function bufferWritePatch(
  current: { bookingBufferMinutes?: number | null; turnoverBufferEnabled?: boolean | null },
  input: { bookingBufferMinutes?: number | null; turnoverBufferEnabled?: boolean | null },
): { bookingBufferMinutes: number | null; turnoverBufferEnabled: boolean | null } | { error: string } {
  if (input.bookingBufferMinutes !== undefined) {
    if (input.bookingBufferMinutes === null) {
      return { bookingBufferMinutes: null, turnoverBufferEnabled: null };
    }
    if (!isBookingBufferMinutes(input.bookingBufferMinutes)) {
      return { error: 'Buffer must be off, 1 hour, or 2 hours.' };
    }
    return {
      bookingBufferMinutes: input.bookingBufferMinutes,
      turnoverBufferEnabled: input.bookingBufferMinutes > 0,
    };
  }
  if (input.turnoverBufferEnabled !== undefined) {
    if (input.turnoverBufferEnabled === null) {
      return { bookingBufferMinutes: null, turnoverBufferEnabled: null };
    }
    if (typeof input.turnoverBufferEnabled !== 'boolean') {
      return { error: 'Invalid turnoverBufferEnabled' };
    }
    if (input.turnoverBufferEnabled) {
      // Keep an explicit 2 h (or 1 h) numeric; only promote legacy Off/null to 60.
      const existing = isBookingBufferMinutes(current.bookingBufferMinutes) ? current.bookingBufferMinutes : null;
      const minutes: BookingBufferMinutes = existing === 60 || existing === 120 ? existing : 60;
      return { bookingBufferMinutes: minutes, turnoverBufferEnabled: true };
    }
    return { bookingBufferMinutes: 0, turnoverBufferEnabled: false };
  }
  return { bookingBufferMinutes: current.bookingBufferMinutes ?? null, turnoverBufferEnabled: current.turnoverBufferEnabled ?? null };
}

/** Calendar days in the kitchen timezone, including the last bookable date. */
export function bookingWindowLastDate(days: number, timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  const maximumDays = Math.floor((Date.UTC(9999, 11, 31, 12) - date.getTime()) / 86400000);
  date.setUTCDate(date.getUTCDate() + Math.min(days, maximumDays));
  return date.toISOString().slice(0, 10);
}

export function resolveKitchenBookingPolicies(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined, cap = 90, daysCap = DEFAULT_BOOKING_DAYS_CAP) {
  const bookingBufferMinutes = effectiveBookingBufferMinutes(kitchen, location);
  const allowMultiDayBookings = effectiveAllowMultiDayBookings(kitchen, location);
  const maxBookingDays = effectiveMaxBookingDaysSetting(kitchen, location, daysCap);
  return {
    maxAdvanceBookingDays: effectiveBookingWindowDays(kitchen, location, cap),
    turnoverBufferEnabled: bookingBufferMinutes > 0,
    bookingBufferMinutes,
    maxAdvanceBookingDaysCap: cap,
    maxBookingDays,
    maxBookingDaysCap: daysCap,
    allowMultiDayBookings,
    weeklyChefHoursLimit: kitchen.weeklyChefHoursLimit ?? null,
    cancellationPolicyHours: kitchen.cancellationPolicyHours ?? location?.cancellationPolicyHours ?? 24,
    minimumBookingWindowHours: kitchen.minimumBookingWindowHours ?? location?.minimumBookingWindowHours ?? 1,
    // NULL at both levels = no per-request hours cap (opening hours only).
    defaultDailyBookingLimit: kitchen.defaultDailyBookingLimit ?? location?.defaultDailyBookingLimit ?? null,
  };
}
