import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsContentSkeleton } from "../SettingsContentSkeleton";
import type { StorageInstructions } from "@shared/storage-listing-readiness";

export type StorageInstructionsHandle = { save: () => Promise<boolean> };

/**
 * The kitchen's storage move-in/move-out instructions (one set per location).
 * Inside My Kitchens the page frame owns saving: pass `onDirtyChange` + `saveRef` and its header "Save changes" and
 * leave guard cover these fields like every other tab. Elsewhere (onboarding) the form shows its own Save, only once
 * something changed.
 */
export function StorageTrackingSetup({ locationId, onConfigure, onDirtyChange, saveRef }: {
  locationId: number; onConfigure: () => void; onDirtyChange?: (dirty: boolean) => void; saveRef?: Ref<StorageInstructionsHandle>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ["checkin-checkout-settings", locationId];
  const { data, isLoading, isError, refetch } = useQuery<StorageInstructions>({ queryKey: key, queryFn: () => apiGet(`/manager/locations/${locationId}/checkin-checkout-settings`) });
  const [moveIn, setMoveIn] = useState("");
  const [moveOut, setMoveOut] = useState("");
  useEffect(() => {
    setMoveIn(data?.storageCheckinInstructions ?? "");
    setMoveOut(data?.storageCheckoutInstructions ?? "");
  }, [data, locationId]);
  const change = useMutation({
    mutationFn: () => apiPut(`/manager/locations/${locationId}/checkin-checkout-settings`, {
      storageCheckinInstructions: moveIn.trim(), storageCheckoutInstructions: moveOut.trim(),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast({ title: mt("saved") });
    },
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });
  const dirty = !!data && (moveIn !== (data.storageCheckinInstructions ?? "") || moveOut !== (data.storageCheckoutInstructions ?? ""));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useImperativeHandle(saveRef, () => ({
    save: async () => {
      if (!dirty) return true;
      // Both are required for storage to be listed; refuse to save a blank one rather than silently dropping it.
      if (!moveIn.trim() || !moveOut.trim()) { toast({ title: mt("error"), description: mt("slInstructionsRequired"), variant: "destructive" }); return false; }
      try { await change.mutateAsync(); return true; } catch { return false; }
    },
  }), [dirty, moveIn, moveOut, change, toast]);
  if (isLoading) return <SettingsContentSkeleton rows={2} />;
  if (isError || !data) return <Button variant="outline" onClick={() => void refetch()}>{mt("retry")}</Button>;
  const reset = () => { setMoveIn(data.storageCheckinInstructions ?? ""); setMoveOut(data.storageCheckoutInstructions ?? ""); };
  return <Card><CardContent className="space-y-4 p-4">
    <div><h3 className="text-sm font-medium">{mt("slInstructions")}</h3><p className="text-sm text-muted-foreground">{mt("slInstructionsHint")}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`storage-move-in-${locationId}`}>{mt("slMoveInInstructions")}</Label>
        <Textarea id={`storage-move-in-${locationId}`} required value={moveIn} onChange={event => setMoveIn(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`storage-move-out-${locationId}`}>{mt("slMoveOutInstructions")}</Label>
        <Textarea id={`storage-move-out-${locationId}`} required value={moveOut} onChange={event => setMoveOut(event.target.value)} /></div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {!saveRef && dirty && <>
        <Button size="sm" disabled={!moveIn.trim() || !moveOut.trim() || change.isPending} onClick={() => change.mutate()}>{mt("saveChanges")}</Button>
        <Button size="sm" variant="ghost" disabled={change.isPending} onClick={reset}>{mt("discardChanges")}</Button>
      </>}
      <Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={onConfigure}>{mt("slOptionalChecklist")}</Button>
    </div>
  </CardContent></Card>;
}
