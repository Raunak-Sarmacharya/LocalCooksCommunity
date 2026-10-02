export function resolveKitchenTracking(
  enabled: boolean | undefined,
  checklist: { checkinEnabled?: boolean | null; checkoutEnabled?: boolean | null } | null | undefined,
  checkinStatus?: string | null,
) {
  // Finish visits already underway if the kitchen is subsequently opted out.
  const started = ["checked_in", "checkout_requested", "checkout_claim_filed"].includes(checkinStatus ?? "");
  return {
    checkinEnabled: enabled === true && checklist?.checkinEnabled === true,
    checkoutEnabled: (enabled === true || started) && checklist?.checkoutEnabled === true,
  };
}
