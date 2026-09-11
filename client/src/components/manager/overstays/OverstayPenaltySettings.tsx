import { useCallback, useEffect, useState } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "@/components/ui/manager-icons";

interface OverstayPenaltySettingsProps {
  locationId: number;
}

export function OverstayPenaltySettings({ locationId }: OverstayPenaltySettingsProps) {
  const { toast } = useToast();
  const [gracePeriodDays, setGracePeriodDays] = useState<number | null>(null);
  const [penaltyRate, setPenaltyRate] = useState<number | null>(null);
  const [maxPenaltyDays, setMaxPenaltyDays] = useState<number | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const snapshot = JSON.stringify([gracePeriodDays, penaltyRate, maxPenaltyDays, policyText]);
  const isDirty = Boolean(savedSnapshot) && snapshot !== savedSnapshot;

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/manager/locations/${locationId}/overstay-penalty-defaults`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error(tt("failedToFetchOverstayDefaults"));
      const data = await response.json();
      const values = [
        data.locationDefaults.gracePeriodDays,
        data.locationDefaults.penaltyRate ? data.locationDefaults.penaltyRate * 100 : null,
        data.locationDefaults.maxPenaltyDays,
        data.locationDefaults.policyText || "",
      ] as const;
      setGracePeriodDays(values[0]);
      setPenaltyRate(values[1]);
      setMaxPenaltyDays(values[2]);
      setPolicyText(values[3]);
      setSavedSnapshot(JSON.stringify(values));
    } catch (error) {
      logger.error("Error fetching overstay penalty defaults:", error);
      toast({ title: mt("error"), description: error instanceof Error ? error.message : tt("failedToFetchOverstayDefaults"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [locationId, toast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/manager/locations/${locationId}/overstay-penalty-defaults`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          gracePeriodDays,
          penaltyRate: penaltyRate !== null ? penaltyRate / 100 : null,
          maxPenaltyDays,
          policyText: policyText || null,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || tt("failedToSaveOverstayPenalty"));
      }
      setSavedSnapshot(snapshot);
      toast({ title: mt("success"), description: mt("overstayPenaltyDefaultsUpdatedSuccessfully") });
    } catch (error) {
      toast({ title: mt("error"), description: error instanceof Error ? error.message : tt("failedToSaveOverstayPenalty"), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="overstay-grace-period">{mt("gracePeriod")}</Label>
          <NumericInput id="overstay-grace-period" suffix="days" value={gracePeriodDays == null ? "" : String(gracePeriodDays)} onValueChange={(value) => setGracePeriodDays(value === "" ? null : parseInt(value, 10))} placeholder={mt("platformDefault")} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{mt("daysBeforePenaltiesApply014")}</p>
        </div>
        <div>
          <Label htmlFor="overstay-penalty-rate">{mt("penaltyRate")}</Label>
          <NumericInput id="overstay-penalty-rate" suffix="%" value={penaltyRate == null ? "" : String(penaltyRate)} onValueChange={(value) => setPenaltyRate(value === "" ? null : parseInt(value, 10))} placeholder={mt("platformDefault")} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">% of daily rate per day (0–50%)</p>
        </div>
        <div>
          <Label htmlFor="overstay-max-days">{mt("maxPenaltyDays")}</Label>
          <NumericInput id="overstay-max-days" suffix="days" value={maxPenaltyDays == null ? "" : String(maxPenaltyDays)} onValueChange={(value) => setMaxPenaltyDays(value === "" ? null : parseInt(value, 10))} placeholder={mt("platformDefault")} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{mt("maxDaysToChargePenalties190")}</p>
        </div>
      </div>
      <div>
        <Label htmlFor="overstay-policy-text">{mt("policyTextOptional")}</Label>
        <Textarea id="overstay-policy-text" value={policyText} onChange={(event) => setPolicyText(event.target.value)} rows={3} className="mt-1.5" placeholder={mt("customPolicyTextShownToChefsRegardingOverstayPenalties")} />
      </div>
      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={!isDirty || isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mt("savePenaltyDefaults")}
        </Button>
      </div>
    </div>
  );
}
