interface KitchenPolicies {
  maxAdvanceBookingDays?: number | null;
  turnoverBufferEnabled?: boolean | null;
  minimumBookingHours?: number | null;
  cancellationPolicyHours?: number | null;
  minimumBookingWindowHours?: number | null;
  defaultDailyBookingLimit?: number | null;
}

export const PRE_CONFIRMATION_REFUND_POLICY =
  'Withdraw before the kitchen confirms. No payment is taken; your whole card hold is released.';

export const CONFIRMED_BOOKING_REFUND_POLICY =
  'After confirmation, you can cancel immediately under your booking’s saved policy. Any refund keeps the actual card processing fee. Review the exact dollars before cancelling.';

export function isKitchenBookingDurationValid(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  return (kitchen.minimumBookingHours ?? 0) <= resolveKitchenBookingPolicies(kitchen, location).defaultDailyBookingLimit;
}

export function effectiveBookingWindowDays(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined, cap = 90) {
  return Math.min(kitchen.maxAdvanceBookingDays ?? location?.maxAdvanceBookingDays ?? 30, cap);
}

export function effectiveTurnoverBuffer(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  return kitchen.turnoverBufferEnabled ?? location?.turnoverBufferEnabled ?? false;
}

export function validBookingWindowDays(value: unknown, cap: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= cap;
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

export function resolveKitchenBookingPolicies(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined, cap = 90) {
  return {
    maxAdvanceBookingDays: effectiveBookingWindowDays(kitchen, location, cap),
    turnoverBufferEnabled: effectiveTurnoverBuffer(kitchen, location),
    maxAdvanceBookingDaysCap: cap,
    cancellationPolicyHours: kitchen.cancellationPolicyHours ?? location?.cancellationPolicyHours ?? 24,
    minimumBookingWindowHours: kitchen.minimumBookingWindowHours ?? location?.minimumBookingWindowHours ?? 1,
    defaultDailyBookingLimit: kitchen.defaultDailyBookingLimit ?? location?.defaultDailyBookingLimit ?? 2,
  };
}
