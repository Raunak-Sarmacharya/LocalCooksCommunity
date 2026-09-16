import type { SubdomainType } from "@shared/subdomain-utils";

/**
 * Whether the global PendingSellerJourneySubmitter may auto-submit and jump
 * to the chef dashboard. Kitchen/admin portals and non-chef roles must never
 * be yanked across subdomains by a leftover seller draft.
 */
export function shouldAutoSubmitSellerJourney(opts: {
  subdomain: SubdomainType;
  role?: string | null;
  isManager?: boolean | null;
}): boolean {
  if (opts.subdomain === "kitchen" || opts.subdomain === "admin") return false;
  if (opts.role === "manager" || opts.isManager || opts.role === "admin") return false;
  return true;
}
