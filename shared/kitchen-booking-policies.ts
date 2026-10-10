interface KitchenPolicies {
  minimumBookingHours?: number | null;
  cancellationPolicyHours?: number | null;
  minimumBookingWindowHours?: number | null;
  defaultDailyBookingLimit?: number | null;
}

export const PRE_CONFIRMATION_REFUND_POLICY =
  'Cancel before your booking is confirmed for a 100% refund of any amount paid, including taxes and fees. ';

export const CONFIRMED_BOOKING_REFUND_POLICY =
  'After confirmation, the saved cancellation deadline applies. Cancellation and any refund are reviewed separately; processing costs and platform service fees may be retained. Review your cancellation and refund outcome for the exact amount.';

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
