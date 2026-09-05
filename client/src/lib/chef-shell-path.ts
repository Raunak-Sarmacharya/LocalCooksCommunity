/** Paths that share one ChefDashboardLayout (sidebar/header stay mounted). */
import { stripLocalePrefix } from "@shared/i18n/negotiate";

export function isChefShellPath(pathname: string): boolean {
  const raw = pathname.split("?")[0] || "/";
  const { pathname: path } = stripLocalePrefix(raw);

  if (path === "/dashboard" || path.startsWith("/dashboard/")) return true;
  if (path.startsWith("/book/")) return true;
  if (path.startsWith("/kitchen-preview/") || path.includes("/kitchen-preview/")) return true;
  if (path.startsWith("/booking/") && !path.startsWith("/manager/")) return true;
  if (path.startsWith("/apply-kitchen/")) return true;
  if (path.startsWith("/kitchen-requirements/")) return true;
  return false;
}
