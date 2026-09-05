/** Landing-page CTA destinations — logged-in users go to their app home, not /apply. */

export type LandingUser = {
  role?: string | null;
  isManager?: boolean | null;
} | null | undefined;

/** Role home: admin / manager / chef dashboard. Guests have no path (caller sends to auth). */
export function landingDashboardPath(user: LandingUser): string {
  if (!user) return "/auth";
  if (user.role === "admin") return "/admin";
  if (user.role === "manager" || user.isManager) return "/manager/dashboard";
  return "/dashboard";
}

/** Browse kitchens: Discover in chef dashboard when signed in; public compare otherwise. */
export function landingBrowseKitchensPath(user: LandingUser): string {
  if (user) return "/dashboard?view=discover-kitchens";
  return "/compare-kitchens";
}

/** Kitchen-owner list CTA: manager dashboard when signed in as manager; else manager login. */
export function landingListKitchenPath(user: LandingUser): string {
  if (user?.role === "manager" || user?.isManager) return "/manager/dashboard";
  if (user) return landingDashboardPath(user);
  return "/manager/login";
}
