import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useImperativeHandle, type Ref } from "react";
import { apiGet, apiPut, apiPutWithMessage } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import BookingRulesSettings, { type BookingPoliciesHandle } from "./BookingRulesSettings";
import type { resolveKitchenBookingPolicies } from "@shared/kitchen-booking-policies";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";
import { SettingsRow } from "./SettingsRow";
import { TrackingWorkflowHelp, type TrackingTimingSettings } from './TrackingWorkflowHelp';
import { hasTrackingNotes } from '@shared/tracking-setup';
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";

type Policies = ReturnType<typeof resolveKitchenBookingPolicies>;
type PolicyPatch = Partial<{ [K in keyof Policies]: number | null }>;
export type PolicySaveScope = "kitchen" | "location";
export interface KitchenPoliciesHandle { saveAllChanges: (scope: PolicySaveScope) => Promise<boolean> }
export interface KitchenWorkspaceSettings {
  kitchen: PolicyPatch & { name?: string; checkinCheckoutEnabled: boolean; minimumBookingHours: number | null };
  effective: Policies;
  defaults: Policies;
}

export default function KitchenWorkspaceControls({ kitchenId, location, mode, onConfigure, highlight, onDirtyChange, saveRef, showTerms = false, termsNote }: {
  kitchenId: number;
  location: { id: number; name: string; kitchenTermsUrl?: string | null };
  mode: "tracking" | "policies";
  onConfigure?: () => void;
  highlight?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<KitchenPoliciesHandle>;
  showTerms?: boolean;
  termsNote?: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = kitchenWorkspaceSettingsKey(kitchenId);
  const rulesRef = useRef<BookingPoliciesHandle>(null);
  const { data: visitSetup, isLoading: setupLoading } = useQuery<Record<string, unknown>>({
    queryKey: ['checkin-checkout-settings', location.id],
    queryFn: () => apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: mode === 'tracking',
  });
  const scopeRef = useRef<PolicySaveScope>("kitchen");
  useImperativeHandle(saveRef, () => ({ saveAllChanges: async (scope) => {
    scopeRef.current = scope;
    return (await rulesRef.current?.saveAllChanges()) ?? false;
  } }), []);
  const { data, isLoading, isError, refetch } = useQuery<KitchenWorkspaceSettings>({
    queryKey: key,
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/workspace-settings`),
  });
  const refresh = (updated: KitchenWorkspaceSettings) => {
    queryClient.setQueryData(key, updated);
    for (const queryKey of [["managerKitchens", location.id], ["/api/manager/all-kitchens"], ["/api/manager/bookings"], ["managerBookings"], ["location-checklist"], ['checkin-checkout-settings', location.id], ["kitchen-listing-readiness", kitchenId]]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  const change = useMutation({
    mutationFn: (patch: PolicyPatch & { checkinCheckoutEnabled?: boolean; minimumBookingHours?: number }) => apiPut(`/manager/kitchens/${kitchenId}/workspace-settings`, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });
  const policyLocation = useMemo(() => ({ ...location, ...data?.effective }), [location.id, location.name, location.kitchenTermsUrl, data?.effective]);
  if (isLoading) return <SettingsContentSkeleton rows={mode === "tracking" ? 1 : 6} />;
  if (isError || !data) return <Button variant="outline" onClick={() => refetch()}>{mt("retry")}</Button>;

  if (mode === "tracking") return (
    <Card id="tracking-settings" tabIndex={-1} className={`transition-[border-color,box-shadow] duration-500 ${highlight ? "border-primary/70 shadow-[0_0_0_3px_hsl(var(--primary)/0.18),0_18px_36px_-24px_hsl(var(--primary)/0.65)]" : ""}`}><CardContent className="p-0">
      <SettingsRow id={`kitchen-tracking-${kitchenId}`} label={mt("navCheckinCheckout")}
        hint={mt("kitchenTrackingSharedDescription")}
        help={<TrackingWorkflowHelp settings={visitSetup as TrackingTimingSettings | undefined} />}>
        <Switch id={`kitchen-tracking-${kitchenId}`} checked={data.kitchen.checkinCheckoutEnabled}
          disabled={change.isPending || setupLoading} onCheckedChange={(checkinCheckoutEnabled) =>
            checkinCheckoutEnabled && !hasTrackingNotes(visitSetup) ? onConfigure?.() : change.mutate({ checkinCheckoutEnabled })} />
      </SettingsRow>
      <div className="border-t p-4"><Button variant="outline" onClick={onConfigure}>{mt("kitchenTrackingConfigureShared")}</Button></div>
    </CardContent></Card>
  );

  return (
    <div className="space-y-4">
      <BookingRulesSettings ref={rulesRef} location={policyLocation} hideHeader hideArrivalTimings hideTerms={!showTerms} termsNote={termsNote}
        kitchenName={data.kitchen.name} policyUpdating={change.isPending}
        minimumBookingHours={data.kitchen.minimumBookingHours ?? 0}
        policyOverrides={data.kitchen}
        onResetPolicy={(field) => change.mutate({ [field]: null })}
        onDirtyChange={onDirtyChange} onSave={async (updates) => {
          const patch: Partial<Policies> & { minimumBookingHours?: number } = {};
          if (updates.minimumBookingHours !== (data.kitchen.minimumBookingHours ?? 0)) patch.minimumBookingHours = updates.minimumBookingHours;
          for (const field of ["cancellationPolicyHours", "minimumBookingWindowHours", "defaultDailyBookingLimit"] as const) {
            if (updates[field] !== data.effective[field]) patch[field] = updates[field];
          }
          if (!Object.keys(patch).length) return;
          if (scopeRef.current === "location") {
            try { await apiPutWithMessage(`/manager/locations/${location.id}/kitchen-booking-policies`, patch); }
            catch (error) {
              toast({ title: mt("error"), description: error instanceof Error ? error.message : mt("error"), variant: "destructive" });
              throw error;
            }
            await queryClient.invalidateQueries({ queryKey: ["managerKitchenWorkspace"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
            await queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
            await queryClient.invalidateQueries({ queryKey: ["managerKitchens", location.id] });
            await queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness"] });
          } else await change.mutateAsync(patch);
        }} />
    </div>
  );
}
