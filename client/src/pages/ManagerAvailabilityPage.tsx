/**
 * Manager Availability Page
 *
 * Route wrapper for `/manager/availability`.
 *
 * `KitchenAvailabilityManagement` is a content component — it renders its own `ChefPageHeader` and
 * its own kitchen picker, and is embedded as-is inside the dashboard, the kitchen settings tabs and
 * the onboarding wizard. It has never owned a shell, so the standalone route had no navigation at
 * all: no drawer, no header, no way back on a phone.
 *
 * So this adds the shell chrome ONLY. No `title`/`description` (the page supplies both) and no
 * `showScopePicker` (the page supplies its own kitchen picker) — either would render twice.
 */

import KitchenAvailabilityManagement from "@/pages/KitchenAvailabilityManagement";
import { ManagerShell } from "@/layouts/ManagerShell";

export default function ManagerAvailabilityPage() {
  return (
    <ManagerShell activeView="availability">
      <KitchenAvailabilityManagement />
    </ManagerShell>
  );
}
