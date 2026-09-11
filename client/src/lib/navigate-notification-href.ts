/**
 * Navigate from an in-app notification click.
 * Search-param-only changes on the same path need pushState + popstate
 * because wouter does not re-run effects for query-only updates.
 */
export function navigateNotificationHref(href: string): void {
  if (!href) return;

  if (href.startsWith("http://") || href.startsWith("https://")) {
    window.location.href = href;
    return;
  }

  try {
    const next = new URL(href, window.location.origin);
    const samePath = next.pathname === window.location.pathname;
    if (samePath) {
      window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
  } catch {
    // fall through
  }

  window.location.assign(href);
}
