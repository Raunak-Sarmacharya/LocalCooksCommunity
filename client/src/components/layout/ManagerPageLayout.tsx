import { ManagerShell, type ManagerShellScope } from "@/layouts/ManagerShell"

/**
 * ManagerPageLayout — legacy adapter over `ManagerShell`.
 *
 * This used to be a SECOND manager shell: a `ResizablePanelGroup` with its own `Sheet` drawer, its
 * own `md:hidden` header, and its own location/kitchen picker. Two navigation models in one app
 * meant two sets of mobile bugs, so the shell now lives in `layouts/ManagerShell.tsx` and this file
 * only keeps the render-prop contract its callers were written against.
 *
 * `showScopePicker` is on because that picker is the one thing these routes genuinely had and the
 * sidebar does not provide — `AppSidebar` takes `locations`/`selectedLocation` but ignores them.
 *
 * Kept rather than deleted because four call sites still import it; the two that are reachable
 * (`/manager/applications`) and the ones that are dead legacy defaults can be inlined in a follow-up.
 */
interface ManagerPageLayoutProps {
  children: (props: ManagerShellScope) => React.ReactNode;
  title?: string;
  description?: string;
  showKitchenSelector?: boolean;
  /** Nav key to highlight. Defaults to `kitchens`, which is where pricing/equipment/storage live. */
  activeView?: string;
}

export function ManagerPageLayout({
  children,
  title,
  description,
  showKitchenSelector = true,
  activeView = "kitchens",
}: ManagerPageLayoutProps) {
  return (
    <ManagerShell
      activeView={activeView}
      title={title}
      description={description}
      showScopePicker
      showKitchenSelector={showKitchenSelector}
    >
      {children}
    </ManagerShell>
  )
}

export default ManagerPageLayout
