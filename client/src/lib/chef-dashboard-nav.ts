export function chefDashboardHref(view: string): string {
  if (!view || view === "overview") return "/dashboard";
  return `/dashboard?view=${encodeURIComponent(view)}`;
}
