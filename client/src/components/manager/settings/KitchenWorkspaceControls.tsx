import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useImperativeHandle, type Ref } from "react";
import { apiGet, apiPut, apiPutWithMessage } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import BookingRulesSettings, { type BookingPoliciesHandle } from "./BookingRulesSettings";
import { CancellationPolicyEditor } from './CancellationPolicyEditor';
import type { resolveKitchenBookingPolicies } from "@shared/kitchen-booking-policies";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";

type Policies = ReturnType<typeof resolveKitchenBookingPolicies>;
type PolicyPatch = Partial<{ [K in keyof Policies]: number | null }>;
export type PolicySaveScope = "kitchen" | "location";
export interface KitchenPoliciesHandle { saveAllChanges: (scope: PolicySaveScope) => Promise<boolean> }
export interface KitchenWorkspaceSettings {
  kitchen: PolicyPatch & { name?: string; minimumBookingHours: number | null };
  effective: Policies;
  defaults: Policies;
}

export default function KitchenWorkspaceControls({ kitchenId, location, mode, onDirtyChange, saveRef, showTerms = false, termsNote }: {
  kitchenId: number;
  location: { id: number; name: string; kitchenTermsUrl?: string | null };
  mode: "policies";
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<KitchenPoliciesHandle>;
  showTerms?: boolean;
  termsNote?: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = kitchenWorkspaceSettingsKey(kitchenId);
  const rulesRef = useRef<BookingPoliciesHandle>(null);
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
    mutationFn: (patch: PolicyPatch & { minimumBookingHours?: number }) => apiPut(`/manager/kitchens/${kitchenId}/workspace-settings`, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });
  const policyLocation = useMemo(() => ({ ...location, ...data?.effective }), [location.id, location.name, location.kitchenTermsUrl, data?.effective]);
  if (isLoading) return <SettingsContentSkeleton rows={6} />;
  if (isError || !data) return <Button variant="outline" onClick={() => refetch()}>{mt("retry")}</Button>;

  return (
    <div className="space-y-4">
      <CancellationPolicyEditor kitchenId={kitchenId} />
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
