import { getSubdomainFromHostname } from "@shared/subdomain-utils";

/**
 * Where to land after terms are accepted — anchored to the CURRENT subdomain,
 * never just the role.
 *
 * kitchen.localhost and chef.localhost are separate origins with separate
 * Firebase sessions. A chef `/dashboard` fallback would hard-redirect a kitchen
 * manager to chef.localhost, where they have no session, and dump them on chef
 * `/auth`. On the kitchen/admin portals a manager always resolves to a manager
 * path; the chef path is only ever produced on the chef origin.
 */
export function postTermsRedirect(opts: {
  hostname: string;
  redirectParam?: string | null;
  role?: string | null;
  isManager?: boolean | null;
  chefFallback?: string;
}): string {
  const { hostname, redirectParam, role, isManager, chefFallback = "/dashboard" } = opts;

  // An explicit, non-generic target always wins (e.g. /manager/dashboard).
  if (redirectParam && redirectParam !== "/dashboard") return redirectParam;

  const subdomain = getSubdomainFromHostname(hostname);
  const manager = role === "manager" || isManager === true;

  if (subdomain === "kitchen") return "/manager/dashboard";
  if (subdomain === "admin") return role === "admin" ? "/admin" : "/manager/dashboard";
  if (manager) return "/manager/dashboard";
  if (role === "admin") return "/admin";
  return chefFallback;
}
