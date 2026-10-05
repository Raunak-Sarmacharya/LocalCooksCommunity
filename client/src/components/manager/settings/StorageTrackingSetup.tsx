import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";
import { auth } from "@/lib/firebase";
import { mt } from "@/i18n/manager";
import { useToast } from "@/hooks/use-toast";
import { isTrackingPromptDismissed, saveTrackingPromptDismissal, trackingSetupSignature } from "@/lib/kitchen-tracking-prompt";
import { ClipboardCheck } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./SettingsRow";
import { SettingsContentSkeleton } from "../SettingsContentSkeleton";
import { hasTrackingNotes } from '@shared/tracking-setup';
import { TrackingWorkflowHelp, type TrackingTimingSettings } from './TrackingWorkflowHelp';

interface StorageTrackingSettings extends TrackingTimingSettings {
  storageCheckinInstructions?: string | null;
  storageCheckoutInstructions?: string | null;
  storageCheckinEnabled: boolean;
  storageCheckoutEnabled: boolean;
  storageCheckinItems: unknown[];
  storageCheckoutItems: unknown[];
  storageCheckinPhotoRequirements: unknown[];
  storageCheckoutPhotoRequirements: unknown[];
}

export function StorageTrackingSetup({ locationId, onConfigure }: { locationId: number; onConfigure: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ["checkin-checkout-settings", locationId];
  const { data, isLoading, isError, refetch } = useQuery<StorageTrackingSettings>({ queryKey: key, queryFn: () => apiGet(`/manager/locations/${locationId}/checkin-checkout-settings`) });
  const enabled = !!(data?.storageCheckinEnabled || data?.storageCheckoutEnabled);
  const configured = !!(data?.storageCheckinEnabled && data.storageCheckoutEnabled && hasTrackingNotes({ ...data }, true));
  const signature = trackingSetupSignature([data?.storageCheckinEnabled, data?.storageCheckoutEnabled, data?.storageCheckinInstructions, data?.storageCheckoutInstructions]);
  const dismissalKey = `storage-tracking-setup:v1:${auth.currentUser?.uid}:${locationId}`;
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (!configured) return;
    setDismissedSignature(null);
    try { window.localStorage.removeItem(dismissalKey); window.sessionStorage.removeItem(dismissalKey); } catch { /* Storage may be unavailable. */ }
  }, [configured, dismissalKey]);
  useEffect(() => { if (!highlight) return; const timer = setTimeout(() => setHighlight(false), 3000); return () => clearTimeout(timer); }, [highlight]);
  let dismissed = dismissedSignature === signature;
  try { dismissed ||= isTrackingPromptDismissed(enabled ? window.localStorage : window.sessionStorage, dismissalKey, signature); } catch { /* Keep the page usable when storage is blocked. */ }
  const change = useMutation({
    mutationFn: (value: boolean) => apiPut(`/manager/locations/${locationId}/checkin-checkout-settings`, { storageCheckinEnabled: value, storageCheckoutEnabled: value }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });
  if (isLoading) return <SettingsContentSkeleton rows={1} />;
  if (isError || !data) return <Button variant="outline" onClick={() => void refetch()}>{mt("retry")}</Button>;
  return <div className="space-y-4">
    {!configured && !dismissed && <Card className="overflow-hidden border-l-[3px] border-l-primary/80 shadow-[0_8px_24px_-18px_hsl(var(--primary)/0.5)]"><CardContent className="relative flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_8px_18px_-12px_hsl(var(--primary)/0.8)]"><ClipboardCheck className="size-5" /></span><div><p className="font-semibold tracking-tight">{mt("storageChecklistBannerTitle")}</p><p className="text-sm text-muted-foreground">{mt("storageChecklistBannerBody")}</p></div></div>
      <div className="flex gap-2"><Button size="sm" onClick={() => { const target = document.getElementById(`storage-tracking-settings-${locationId}`); target?.scrollIntoView({ behavior: "smooth", block: "center" }); target?.focus({ preventScroll: true }); setHighlight(true); }}>{mt("setUpChecklist")}</Button><Button size="sm" variant="ghost" onClick={() => { setDismissedSignature(signature); try { saveTrackingPromptDismissal(enabled ? window.localStorage : window.sessionStorage, dismissalKey, signature); } catch { /* Dismiss for this visit. */ } }}>{mt("dismiss")}</Button></div>
    </CardContent></Card>}
    <Card id={`storage-tracking-settings-${locationId}`} tabIndex={-1} className={`transition-[border-color,box-shadow] duration-500 ${highlight ? "border-primary/70 shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]" : ""}`}><CardContent className="p-0">
      <SettingsRow id={`storage-tracking-${locationId}`} label={mt("navStorageCheckinCheckout")} hint={mt("storageTrackingDescription")} help={<TrackingWorkflowHelp storage settings={data} />}>
        <Switch id={`storage-tracking-${locationId}`} checked={enabled} disabled={change.isPending}
          onCheckedChange={value => value && !hasTrackingNotes({ ...data }, true) ? onConfigure() : change.mutate(value)} />
      </SettingsRow>
      <div className="border-t p-4"><Button variant="outline" onClick={onConfigure}>{mt("kitchenTrackingConfigureShared")}</Button></div>
    </CardContent></Card>
  </div>;
}
