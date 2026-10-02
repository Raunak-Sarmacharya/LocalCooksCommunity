import { useCallback, useEffect, useState, useImperativeHandle, type Ref } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "@/components/ui/manager-icons";

interface OverstayPenaltySettingsProps {
  locationId: number;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<{ saveAllChanges: () => Promise<boolean> }>;
  hideSaveActions?: boolean;
}

export function OverstayPenaltySettings({ locationId, onDirtyChange, saveRef, hideSaveActions = false }: OverstayPenaltySettingsProps) {
  const { toast } = useToast();
  const [gracePeriodDays, setGracePeriodDays] = useState<number | null>(null);
  const [penaltyRate, setPenaltyRate] = useState<number | null>(null);
  const [maxPenaltyDays, setMaxPenaltyDays] = useState<number | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [platformDefaults, setPlatformDefaults] = useState<{ gracePeriodDays: number; penaltyRate: number; maxPenaltyDays: number } | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const snapshot = JSON.stringify([gracePeriodDays, penaltyRate, maxPenaltyDays, policyText]);
  const isDirty = Boolean(savedSnapshot) && snapshot !== savedSnapshot;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
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
      setPlatformDefaults(data.platformDefaults ?? null);
      const values = [
        data.locationDefaults.gracePeriodDays,
        data.locationDefaults.penaltyRate != null ? data.locationDefaults.penaltyRate * 100 : null,
        data.locationDefaults.maxPenaltyDays,
        data.locationDefaults.policyText || "",
      ] as const;
      setGracePeriodDays(values[0]);
      setPenaltyRate(values[1]);
      setMaxPenaltyDays(values[2]);
      setPolicyText(values[3]);
      setSavedSnapshot(JSON.stringify(values));
    } catch (error) {
      setLoadError(true);
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
      return true;
    } catch (error) {
      toast({ title: mt("error"), description: error instanceof Error ? error.message : tt("failedToSaveOverstayPenalty"), variant: "destructive" });
      return false;
    } finally {
      setIsSaving(false);
    }
  };
  useImperativeHandle(saveRef, () => ({ saveAllChanges: saveSettings }));

  if (isLoading) {
    return <div className={`divide-y divide-border ${hideSaveActions ? "" : "rounded-xl border"}`} role="status" aria-label={mt("overstaySettingsLoading")} aria-busy="true">{Array.from({ length: 3 }, (_, index) => <div key={index} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-28 max-w-full" /><Skeleton className="h-3 w-40 max-w-full" /></div><Skeleton className="h-10 w-32 shrink-0 rounded-md" /></div>)}<div className="space-y-3 p-4"><Skeleton className="h-4 w-36" /><Skeleton className="h-20 w-full rounded-md" /></div></div>;
  }
  if (loadError) return <div className="rounded-xl border border-destructive/30 p-4"><p className="mb-3 text-sm text-destructive">{tt("failedToFetchOverstayDefaults")}</p><Button variant="outline" onClick={() => void loadSettings()}>{mt("retry")}</Button></div>;

  return (
    <div className="space-y-5">
      <div className={`divide-y divide-border bg-card ${hideSaveActions ? "" : "rounded-xl border"}`}>
        <SettingsRow id="overstay-grace-days" label={mt("gracePeriod")} hint={mt("overstayGraceHint")} help={mt("overstayGraceHelp")}>
          <NumericInput id="overstay-grace-days" suffix={mt("daysUnit")} value={String(gracePeriodDays ?? platformDefaults?.gracePeriodDays ?? "")} onValueChange={(value) => setGracePeriodDays(value === "" ? null : Number(value))} className="w-32" />
        </SettingsRow>
        <SettingsRow id="overstay-penalty-rate" label={mt("penaltyRate")} hint={mt("overstayRateHint")} help={mt("overstayRateHelp")}>
          <NumericInput id="overstay-penalty-rate" suffix="%" allowDecimals value={String(penaltyRate ?? (platformDefaults ? platformDefaults.penaltyRate * 100 : ""))} onValueChange={(value) => setPenaltyRate(value === "" ? null : Number(value))} className="w-32" />
        </SettingsRow>
        <SettingsRow id="overstay-max-days" label={mt("maxPenaltyDays")} hint={mt("overstayMaximumHint")} help={mt("overstayMaximumHelp")}>
          <NumericInput id="overstay-max-days" suffix={mt("daysUnit")} value={String(maxPenaltyDays ?? platformDefaults?.maxPenaltyDays ?? "")} onValueChange={(value) => setMaxPenaltyDays(value === "" ? null : Number(value))} className="w-32" />
        </SettingsRow>
        <SettingsRow id="overstay-policy-text" label={mt("policyTextOptional")} help={mt("overstayPolicyHelp")} layout="stacked">
          <Textarea id="overstay-policy-text" value={policyText} onChange={(event) => setPolicyText(event.target.value)} rows={3} placeholder={mt("customPolicyTextShownToChefsRegardingOverstayPenalties")} />
        </SettingsRow>
      </div>
      {isDirty && !hideSaveActions && <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={!isDirty || isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mt("savePenaltyDefaults")}
        </Button>
      </div>}
    </div>
  );
}
