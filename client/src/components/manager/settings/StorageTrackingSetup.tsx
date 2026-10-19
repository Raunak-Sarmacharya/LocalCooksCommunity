import { useEffect, useState } from "react";
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

export function StorageTrackingSetup({ locationId, onConfigure }: { locationId: number; onConfigure: () => void }) {
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
  if (isLoading) return <SettingsContentSkeleton rows={2} />;
  if (isError || !data) return <Button variant="outline" onClick={() => void refetch()}>{mt("retry")}</Button>;
  const dirty = moveIn !== (data.storageCheckinInstructions ?? "") || moveOut !== (data.storageCheckoutInstructions ?? "");
  return <Card><CardContent className="space-y-4 p-4">
    <div><h3 className="text-sm font-medium">{mt("slInstructions")}</h3><p className="text-sm text-muted-foreground">{mt("slInstructionsHint")}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`storage-move-in-${locationId}`}>{mt("slMoveInInstructions")}</Label>
        <Textarea id={`storage-move-in-${locationId}`} required value={moveIn} onChange={event => setMoveIn(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`storage-move-out-${locationId}`}>{mt("slMoveOutInstructions")}</Label>
        <Textarea id={`storage-move-out-${locationId}`} required value={moveOut} onChange={event => setMoveOut(event.target.value)} /></div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={!dirty || !moveIn.trim() || !moveOut.trim() || change.isPending} onClick={() => change.mutate()}>{mt("saveChanges")}</Button>
      <Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={onConfigure}>{mt("slOptionalChecklist")}</Button>
    </div>
  </CardContent></Card>;
}
