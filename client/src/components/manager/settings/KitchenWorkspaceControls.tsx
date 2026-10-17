import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useImperativeHandle, type Ref } from "react";
import { apiGet, apiPut, apiPutWithMessage } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import BookingRulesSettings, { type BookingPoliciesHandle } from "./BookingRulesSettings";
import { CancellationPolicyEditor } from './CancellationPolicyEditor';
import { SessionExtensionSettingsCard } from './SessionExtensionSettingsCard';
import { ManagerDamagePolicySection } from "./PolicySection";
import { KitchenTermsSection } from "./KitchenTermsSection";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";

/**
 * Effective booking rules for one kitchen. The window/buffer fields (and the read-only cap) arrive
 * from servers that know them; every reader treats them as optional so an older server still works.
 */
interface Policies {
  cancellationPolicyHours: number;
  minimumBookingWindowHours: number;
  defaultDailyBookingLimit: number;
  maxAdvanceBookingDays?: number;
  turnoverBufferEnabled?: boolean;
  bookingBufferMinutes?: number;
  allowMultiDayBookings?: boolean;
  maxBookingDays?: number;
  maxBookingDaysCap?: number;
  weeklyChefHoursLimit?: number | null;
  maxAdvanceBookingDaysCap?: number;
}
type PolicyPatch = {
  cancellationPolicyHours?: number | null;
  minimumBookingWindowHours?: number | null;
  defaultDailyBookingLimit?: number | null;
  maxAdvanceBookingDays?: number | null;
  turnoverBufferEnabled?: boolean | null;
  bookingBufferMinutes?: number | null;
  allowMultiDayBookings?: boolean | null;
  maxBookingDays?: number | null;
  weeklyChefHoursLimit?: number | null;
};
export type PolicySaveScope = "kitchen" | "location";
export interface KitchenPoliciesHandle { saveAllChanges: (scope: PolicySaveScope) => Promise<boolean> }
export interface KitchenWorkspaceSettings {
  kitchen: PolicyPatch & { name?: string; minimumBookingHours: number | null };
  effective: Policies;
  defaults: Policies;
}

/**
 * The kitchen's Booking Policies tab. Order follows how a manager thinks about a booking:
 * when/how long (Booking rules) → getting out of it (Cancellation) → staying longer (Extra time) →
 * after it (Damage and cleaning, read-only) → the paperwork (Terms and conditions).
 * Each section owns at most one save; nothing saves from the page header.
 */
export default function KitchenWorkspaceControls({ kitchenId, location, mode, onDirtyChange, saveRef, onRequestSave, showTerms = false, termsNote }: {
  kitchenId: number;
  location: { id: number; name: string; kitchenTermsUrl?: string | null; kitchenTermsUploadedAt?: string | null };
  mode: "policies";
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<KitchenPoliciesHandle>;
  /** Opens the parent's "which kitchens?" step, which then calls `saveAllChanges(scope)`. */
  onRequestSave?: () => void;
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
    mutationFn: (patch: PolicyPatch & { minimumBookingHours?: number | null }) => apiPut(`/manager/kitchens/${kitchenId}/workspace-settings`, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });
  const policyLocation = useMemo(() => ({ ...location, ...data?.effective }), [location.id, location.name, location.kitchenTermsUrl, data?.effective]);
  if (isLoading) return <SettingsContentSkeleton rows={6} />;
  if (isError || !data) return <Button variant="outline" onClick={() => refetch()}>{mt("retry")}</Button>;

  return (
    <div className="space-y-8">
      <BookingRulesSettings ref={rulesRef} location={policyLocation} hideHeader hideArrivalTimings hideTerms hideDamagePolicy
        kitchenName={data.kitchen.name} policyUpdating={change.isPending} onRequestSave={onRequestSave}
        minimumBookingHours={data.kitchen.minimumBookingHours ?? 0}
        policyOverrides={data.kitchen}
        onResetPolicy={(field) => {
          if (field === "bookingBufferMinutes" || field === "turnoverBufferEnabled") {
            change.mutate({ bookingBufferMinutes: null, turnoverBufferEnabled: null });
            return;
          }
          change.mutate({ [field]: null });
        }}
        onDirtyChange={onDirtyChange} onSave={async (updates) => {
          const patch: PolicyPatch & { minimumBookingHours?: number } = {};
          if (updates.minimumBookingHours !== (data.kitchen.minimumBookingHours ?? 0)) patch.minimumBookingHours = updates.minimumBookingHours;
          for (const field of [
            "cancellationPolicyHours", "minimumBookingWindowHours", "defaultDailyBookingLimit",
            "maxAdvanceBookingDays", "bookingBufferMinutes", "allowMultiDayBookings", "maxBookingDays", "weeklyChefHoursLimit",
          ] as const) {
            // The newer fields are only in `updates` when the server sent them (see BookingRulesSettings).
            if (updates[field] !== undefined && updates[field] !== data.effective[field]) (patch as Record<string, unknown>)[field] = updates[field];
          }
          // Resetting buffer clears both numeric and legacy boolean representations.
          if (patch.bookingBufferMinutes === null) patch.turnoverBufferEnabled = null;
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
      <CancellationPolicyEditor kitchenId={kitchenId} />
      <SessionExtensionSettingsCard kitchenId={kitchenId} />
      <ManagerDamagePolicySection />
      {showTerms && <KitchenTermsSection location={location} note={termsNote} />}
    </div>
  );
}
