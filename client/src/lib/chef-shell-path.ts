/** Paths that share one ChefDashboardLayout (sidebar/header stay mounted). */
import { stripLocalePrefix } from "@shared/i18n/negotiate";

export function isChefShellPath(pathname: string): boolean {
  const raw = pathname.split("?")[0] || "/";
  const { pathname: path } = stripLocalePrefix(raw);

  if (path === "/dashboard" || path.startsWith("/dashboard/")) return true;
  if (path.startsWith("/book/")) return true;
  if (path === "/storage" || path.startsWith("/storage/")) return true;
  if (path.startsWith("/kitchen-preview/") || path.includes("/kitchen-preview/") || path.startsWith("/kitchen/") || path.includes("/kitchen/")) return true;
  if (path.startsWith("/booking/") && !path.startsWith("/manager/")) return true;
  // Not /apply-kitchen/: the request to cook is one focused page for signed-in and signed-out customers alike, and
  // signing in on it must not swap the shell in (that remounted the page and lost the answers).
  if (path.startsWith("/request-tour/")) return true;
  if (path.startsWith("/kitchen-requirements/")) return true;
  return false;
}
