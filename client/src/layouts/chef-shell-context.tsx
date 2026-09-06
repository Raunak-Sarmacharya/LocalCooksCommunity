import * as React from "react";
import type { ChefBreadcrumb } from "@/lib/chef-nav-sections";

export type ChefShellChrome = {
  activeView: string;
  onViewChange?: (view: string) => void;
  breadcrumbs?: ChefBreadcrumb[];
  messageBadgeCount?: number;
  hiddenItems?: string[];
};

export type ChefShellContextValue = {
  isChefShell: true;
  setChrome: (chrome: ChefShellChrome) => void;
};

export const ChefShellContext = React.createContext<ChefShellContextValue | null>(null);

/**
 * Publish chrome (active nav + breadcrumbs) into the persistent shell.
 * Call from page bodies that used to wrap ChefDashboardLayout themselves.
 */
export function useChefShellChrome(chrome: ChefShellChrome): boolean {
  const ctx = React.useContext(ChefShellContext);

  React.useEffect(() => {
    if (!ctx) return;
    ctx.setChrome(chrome);
  }, [
    ctx,
    chrome.activeView,
    chrome.messageBadgeCount,
    chrome.breadcrumbs,
    chrome.hiddenItems,
    chrome.onViewChange,
  ]);

  return ctx != null;
}

export function useIsChefShell(): boolean {
  return React.useContext(ChefShellContext) != null;
}

const shellUiFallback: ChefShellContextValue = {
  isChefShell: true,
  setChrome: () => {},
};

/** Ensures CTA button styling inside ChefDashboardLayout even without the outer route shell. */
export function ChefShellUiProvider({ children }: { children: React.ReactNode }) {
  const existing = React.useContext(ChefShellContext);
  if (existing) return <>{children}</>;
  return (
    <ChefShellContext.Provider value={shellUiFallback}>{children}</ChefShellContext.Provider>
  );
}
