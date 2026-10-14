/** Kitchen workflow exists independently of instructions, tasks and legacy flags. */
export function resolveKitchenTracking() {
  return { checkinEnabled: true, checkoutEnabled: true };
}
