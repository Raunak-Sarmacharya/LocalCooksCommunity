import * as React from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { isChefShellPath } from "@/lib/chef-shell-path";
import { isChefUser } from "@/config/chef-onboarding-steps";
import {
  ChefShellContext,
  type ChefShellChrome,
  type ChefShellContextValue,
} from "@/layouts/chef-shell-context";

export { isChefShellPath } from "@/lib/chef-shell-path";
export {
  useChefShellChrome,
  useIsChefShell,
  type ChefShellChrome,
} from "@/layouts/chef-shell-context";

function defaultChrome(navigate: (to: string) => void): ChefShellChrome {
  return {
    activeView: "overview",
    onViewChange: (view: string) => {
      if (view === "overview") navigate("/dashboard");
      else navigate(`/dashboard?view=${view}`);
    },
  };
}

function ChefShellContentLoader() {
  return (
    <div className="space-y-4 py-2" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      <div className="h-64 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function FullPageLoader() {
  const { t } = useTranslation("common");
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-border" />
      <span className="ml-2">{t("loading")}</span>
    </div>
  );
}

/**
 * Keeps ChefDashboardLayout mounted across chef chrome routes so only main content swaps.
 * Owns Suspense so lazy preview/book routes show an in-content loader (sidebar stays).
 */
export function ChefShellProvider({ children }: { children: React.ReactNode }) {
  const { user } = useFirebaseAuth();
  const [location, navigate] = useLocation();
  const pathname = location.split("?")[0] || "/";
  const shellActive = Boolean(user) && isChefUser(user) && isChefShellPath(pathname);

  const [chrome, setChrome] = React.useState<ChefShellChrome>(() =>
    defaultChrome(navigate)
  );

  const setChromeStable = React.useCallback((next: ChefShellChrome) => {
    setChrome((prev) => {
      if (
        prev.activeView === next.activeView &&
        prev.messageBadgeCount === next.messageBadgeCount &&
        prev.onViewChange === next.onViewChange &&
        prev.breadcrumbs === next.breadcrumbs &&
        prev.hiddenItems === next.hiddenItems
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = React.useMemo<ChefShellContextValue>(
    () => ({ isChefShell: true, setChrome: setChromeStable }),
    [setChromeStable]
  );

  const body = (
    <React.Suspense fallback={shellActive ? <ChefShellContentLoader /> : <FullPageLoader />}>
      {children}
    </React.Suspense>
  );

  if (!shellActive) {
    return body;
  }

  return (
    <ChefShellContext.Provider value={value}>
      <ChefDashboardLayout
        activeView={chrome.activeView}
        onViewChange={chrome.onViewChange ?? defaultChrome(navigate).onViewChange!}
        breadcrumbs={chrome.breadcrumbs}
        messageBadgeCount={chrome.messageBadgeCount}
        hiddenItems={chrome.hiddenItems}
      >
        {body}
      </ChefDashboardLayout>
    </ChefShellContext.Provider>
  );
}
