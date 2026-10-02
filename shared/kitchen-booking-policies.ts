interface KitchenPolicies {
  minimumBookingHours?: number | null;
  cancellationPolicyHours?: number | null;
  minimumBookingWindowHours?: number | null;
  defaultDailyBookingLimit?: number | null;
}

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
