/**
 * Manager Overstays Page
 * 
 * Page wrapper for the OverstayPenaltyQueue component.
 * Accessible at /manager/overstays
 */

import { OverstayPenaltyQueue } from "@/components/manager/overstays/OverstayPenaltyQueue";
import { useTranslation } from "react-i18next";
import ManagerHeader from "@/components/layout/ManagerHeader";

export default function ManagerOverstaysPage() {
  const { t } = useTranslation("manager");

  return (
    <div className="min-h-screen bg-background">
      <ManagerHeader />
      <main className="container mx-auto px-4 py-8">
        <OverstayPenaltyQueue />
      </main>
    </div>
  );
}
