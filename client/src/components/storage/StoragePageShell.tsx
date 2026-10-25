import { useCallback, useMemo, type ReactNode } from "react"
import { useLocation } from "wouter"
import { useTranslation } from "react-i18next"
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout"
import { useChefShellChrome } from "@/layouts/chef-shell-context"

type Crumb = { label: string; onClick?: () => void; navId?: string }
/**
 * Chef chrome for the storage pages: "My storage" active in the nav, an optional detail crumb, the same layout as bookings.
 * `parent` replaces "My storage" when the page belongs elsewhere: renting starts from a kitchen, so the request page sits
 * under Kitchens › {kitchen} (the rental joins My storage once it's requested).
 */
export function StoragePageShell({ crumb, parent, children }: { crumb?: string; parent?: { activeView: string; trail: Crumb[] }; children: ReactNode }) {
  const [, navigate] = useLocation()
  const { t } = useTranslation("chef")
  const onViewChange = useCallback((view: string) =>
    navigate(view === "storage" ? "/storage" : view === "overview" ? "/dashboard" : `/dashboard?view=${view}`), [navigate])
  const breadcrumbs = useMemo(() => [...(parent?.trail ?? [{ label: t("shellStorage" as never), navId: "storage", onClick: () => navigate("/storage") }]),
    ...(crumb ? [{ label: crumb }] : [])], [crumb, parent, t, navigate])
  const activeView = parent?.activeView ?? "storage"
  const inShell = useChefShellChrome({ activeView, onViewChange, breadcrumbs })
  const body = <div className="mx-auto w-full max-w-[720px] space-y-5 pb-28 sm:pb-10">{children}</div>
  return inShell ? body : <ChefDashboardLayout activeView={activeView} onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{body}</ChefDashboardLayout>
}
