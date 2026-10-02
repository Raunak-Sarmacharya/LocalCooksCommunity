/**
 * Manager Overstays Page
 *
 * Page wrapper for the OverstayPenaltyQueue component.
 * Accessible at /manager/overstays
 *
 * This used to render a bare `<ManagerHeader />` with no sidebar mounted, so on a phone the page
 * had no navigation at all — no drawer, no way back to anything. It now mounts `ManagerShell` like
 * every other manager route, which also gives it the shared header, command menu and notifications.
 */

import { OverstayPenaltyQueue } from "@/components/manager/overstays/OverstayPenaltyQueue";
import { ManagerShell } from "@/layouts/ManagerShell";
import { mt } from "@/i18n/manager";

export default function ManagerOverstaysPage() {
  return (
    <ManagerShell
      activeView="overstays"
      title={mt("navOverstayPenalties")}
      description={mt("overstaysPageDescription")}
    >
      <OverstayPenaltyQueue />
    </ManagerShell>
  );
}
