/**
 * Issues & Refunds Component
 * 
 * Combined chef interface for viewing:
 * - Damage claims filed against them
 * - Overstay penalties requiring payment
 */

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useChefResolutionCenter } from "@/hooks/use-chef-resolution-center";
import { useTranslation } from "react-i18next";
import { ChefPageHeader } from "@/components/chef/ui";

// Import existing components
import { PendingDamageClaims } from "./PendingDamageClaims";
import { OverstayPenaltiesTable } from "./OverstayPenaltiesTable";

export function IssuesAndRefunds() {
  const [activeTab, setActiveTab] = useState<string>("damage-claims");
  const {
    pendingDamageClaims,
    pendingPenalties,
    totalDamageClaims,
    totalPenalties,
  } = useChefResolutionCenter();
  const { t } = useTranslation("chef");

  return (
    <div className="space-y-6">
      {/* Header */}
      <ChefPageHeader
        title={t("resolutionCenterTitle", "Resolution center")}
        description={t("resolutionCenterDesc", "Damage claims and overstay penalties that need a response.")}
      />

      {/* Tabs for switching between damage claims and overstay penalties */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted p-1 mb-6">
          <TabsTrigger 
            value="damage-claims" 
            className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background"
          >
            <FileText className="h-4 w-4" />
            <span>{t("damageClaimsTab", "Damage Claims")}</span>
            {pendingDamageClaims > 0 && (
              <Badge variant="destructive" className="ml-1">
                {pendingDamageClaims}
              </Badge>
            )}
            {pendingDamageClaims === 0 && totalDamageClaims > 0 && (
              <Badge variant="count" className="ml-1">
                {totalDamageClaims}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="overstay-penalties" 
            className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background"
          >
            <Clock className="h-4 w-4" />
            <span>{t("overstayPenaltiesTab", "Overstay Penalties")}</span>
            {pendingPenalties > 0 && (
              <Badge variant="destructive" className="ml-1">
                {pendingPenalties}
              </Badge>
            )}
            {pendingPenalties === 0 && totalPenalties > 0 && (
              <Badge variant="count" className="ml-1">
                {totalPenalties}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="damage-claims" className="mt-0">
          <PendingDamageClaims />
        </TabsContent>

        <TabsContent value="overstay-penalties" className="mt-0">
          <OverstayPenaltiesTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default IssuesAndRefunds;
