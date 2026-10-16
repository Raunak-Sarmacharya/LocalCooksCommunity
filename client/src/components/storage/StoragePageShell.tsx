import { useCallback, useMemo, type ReactNode } from "react"
import { useLocation } from "wouter"
import { useTranslation } from "react-i18next"
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout"
import { useChefShellChrome } from "@/layouts/chef-shell-context"

/** Chef chrome for the storage pages: "My storage" active in the nav, an optional detail crumb, the same layout as bookings. */
export function StoragePageShell({ crumb, children }: { crumb?: string; children: ReactNode }) {
  const [, navigate] = useLocation()
  const { t } = useTranslation("chef")
  const onViewChange = useCallback((view: string) =>
    navigate(view === "storage" ? "/storage" : view === "overview" ? "/dashboard" : `/dashboard?view=${view}`), [navigate])
  const breadcrumbs = useMemo(() => [{ label: t("shellMyStorage" as never), navId: "storage", onClick: () => navigate("/storage") },
    ...(crumb ? [{ label: crumb }] : [])], [crumb, t, navigate])
  const inShell = useChefShellChrome({ activeView: "storage", onViewChange, breadcrumbs })
  const body = <div className="mx-auto w-full max-w-[720px] space-y-5 pb-28 sm:pb-10">{children}</div>
  return inShell ? body : <ChefDashboardLayout activeView="storage" onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{body}</ChefDashboardLayout>
}
