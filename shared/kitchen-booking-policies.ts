interface KitchenPolicies {
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

export function resolveKitchenBookingPolicies(kitchen: KitchenPolicies, location: KitchenPolicies | null | undefined) {
  return {
    cancellationPolicyHours: kitchen.cancellationPolicyHours ?? location?.cancellationPolicyHours ?? 24,
    minimumBookingWindowHours: kitchen.minimumBookingWindowHours ?? location?.minimumBookingWindowHours ?? 1,
    defaultDailyBookingLimit: kitchen.defaultDailyBookingLimit ?? location?.defaultDailyBookingLimit ?? 2,
  };
}
