/**
 * Storage Check-In / Check-Out Settings
 *
 * Enterprise-grade settings page that mirrors the Kitchen Check-In /
 * Check-Out experience exactly, applied to storage bookings. Managers
 * configure BOTH the move-in inspection checklist AND the move-out
 * inspection checklist on a single page, using the same matrix editor
 * pattern as kitchens.
 *
 * This page is the single source of truth for storage inspection
 * configuration — replacing the legacy checkout-only page.
 */

import { useState, useEffect, useCallback, useMemo, useImperativeHandle, type Ref } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Info } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { Button } from "@/components/ui/button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import type {
  ChecklistItem,
  PhotoRequirement,
} from "./shared/ChecklistEditor";
import { unifyStorageInspectionItems, storageInspectionItemsToArrays, validateStorageInspectionItems, type UnifiedStorageInspectionItem } from "./StorageCheckinCheckoutEditor";
import { KitchenCheckinCheckoutEditor } from "./KitchenCheckinCheckoutEditor";
import { ChefPageHeader } from "@/components/chef/ui";
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StorageCheckinCheckoutSettingsData {
  id: number | null;
  locationId: number;
  // Storage check-in (move-in inspection)
  storageCheckinEnabled: boolean;
  storageCheckinItems: ChecklistItem[];
  storageCheckinPhotoRequirements: PhotoRequirement[];
  storageCheckinInstructions: string | null;
  // Storage check-out (move-out inspection)
  storageCheckoutEnabled: boolean;
  storageCheckoutItems: ChecklistItem[];
  storageCheckoutPhotoRequirements: PhotoRequirement[];
  storageCheckoutInstructions: string | null;
}

interface StorageCheckinCheckoutSettingsProps {
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<{ saveAllChanges: () => Promise<boolean> }>;
  location: {
    id: number;
    name: string;
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StorageCheckinCheckoutSettings({
  location,
  onDirtyChange,
  saveRef,
}: StorageCheckinCheckoutSettingsProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing settings from the shared endpoint that also powers the
  // Kitchen Check-In / Check-Out page. We only consume the storage portion.
  const { data, isLoading, isError, refetch } = useQuery<StorageCheckinCheckoutSettingsData>({
    queryKey: ["checkin-checkout-settings", location.id],
    queryFn: () =>
      apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: !!location.id,
  });

  // Local state — single unified list for the editor plus per-stage
  // enable flags & instructions.
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [items, setItems] = useState<UnifiedStorageInspectionItem[]>([]);
  const [checkinInstructions, setCheckinInstructions] = useState<string | null>(
    null,
  );
  const [checkoutInstructions, setCheckoutInstructions] = useState<string | null>(
    null,
  );

  const initialUnifiedItems = useMemo<UnifiedStorageInspectionItem[]>(() => {
    if (!data) return [];
    return unifyStorageInspectionItems({
      checkinItems: Array.isArray(data.storageCheckinItems)
        ? (data.storageCheckinItems as ChecklistItem[])
        : [],
      checkoutItems: Array.isArray(data.storageCheckoutItems)
        ? (data.storageCheckoutItems as ChecklistItem[])
        : [],
      checkinPhotoRequirements: Array.isArray(
        data.storageCheckinPhotoRequirements,
      )
        ? (data.storageCheckinPhotoRequirements as PhotoRequirement[])
        : [],
      checkoutPhotoRequirements: Array.isArray(
        data.storageCheckoutPhotoRequirements,
      )
        ? (data.storageCheckoutPhotoRequirements as PhotoRequirement[])
        : [],
    });
  }, [data]);

  // Sync from server data on first load / when switching locations
  useEffect(() => {
    if (data) {
      setCheckinEnabled(data.storageCheckinEnabled ?? false);
      setCheckoutEnabled(data.storageCheckoutEnabled ?? false);
      setCheckinInstructions(data.storageCheckinInstructions);
      setCheckoutInstructions(data.storageCheckoutInstructions);
      setItems(initialUnifiedItems);
    }
  }, [data, initialUnifiedItems]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      checkinEnabled !== (data.storageCheckinEnabled ?? false) ||
      checkoutEnabled !== (data.storageCheckoutEnabled ?? false) ||
      JSON.stringify(items) !== JSON.stringify(initialUnifiedItems) ||
      (checkinInstructions || null) !==
        (data.storageCheckinInstructions || null) ||
      (checkoutInstructions || null) !==
        (data.storageCheckoutInstructions || null)
    );
  }, [
    data,
    initialUnifiedItems,
    checkinEnabled,
    checkoutEnabled,
    items,
    checkinInstructions,
    checkoutInstructions,
  ]);

  const validationErrors = useMemo(
    () => validateStorageInspectionItems(items),
    [items],
  );
  const dormantCheckin = checkinEnabled ? 0 : items.filter((item) => item.label.trim() && item.requiredOnCheckin).length;
  const dormantCheckout = checkoutEnabled ? 0 : items.filter((item) => item.label.trim() && item.requiredOnCheckout).length;

  // Save — splits the unified list back into the server's legacy four arrays
  // and sends only the storage-related fields. Kitchen fields stay untouched
  // because the server PUT endpoint only updates fields that were provided.
  const saveSettings = useCallback(async () => {
      if (validationErrors.length > 0) {
        throw new Error(validationErrors[0]);
      }

      const {
        checkinItems: outCheckinItems,
        checkoutItems: outCheckoutItems,
        checkinPhotoRequirements: outCheckinPhotos,
        checkoutPhotoRequirements: outCheckoutPhotos,
      } = storageInspectionItemsToArrays(items);

      await apiPut(
        `/manager/locations/${location.id}/checkin-checkout-settings`,
        {
          storageCheckinEnabled: checkinEnabled,
          storageCheckinItems: outCheckinItems,
          storageCheckinPhotoRequirements: outCheckinPhotos,
          storageCheckinInstructions: checkinInstructions || null,
          storageCheckoutEnabled: checkoutEnabled,
          storageCheckoutItems: outCheckoutItems,
          storageCheckoutPhotoRequirements: outCheckoutPhotos,
          storageCheckoutInstructions: checkoutInstructions || null,
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["checkin-checkout-settings", location.id],
      });

      toast({ title: mt("settingsSaved"),
        description: mt("storageCheckInCheckOutChecklistsUpdatedSuccessfully"),
      });
    }, [
      location.id,
      checkinEnabled,
      checkoutEnabled,
      items,
      checkinInstructions,
      checkoutInstructions,
      validationErrors,
      queryClient,
      toast,
    ]);
  const saveAction = useStatusButton(saveSettings);
  useImperativeHandle(saveRef, () => ({ saveAllChanges: async () => {
    try { await saveSettings(); return true; } catch { return false; }
  } }), [saveSettings]);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ChefPageHeader title={mt("navStorageCheckinCheckout")} description={mt("storageChecklistPageDescription")} />
        <SettingsContentSkeleton rows={6} />
      </div>
    );
  }
  if (isError) return <div className="rounded-xl border p-6"><p className="mb-3 text-sm text-destructive">{mt("overviewActivityError")}</p><Button variant="outline" onClick={() => void refetch()}>{mt("retry")}</Button></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <ChefPageHeader
        title={mt("navStorageCheckinCheckout")}
        description={mt("storageChecklistPageDescription")}
        actions={isDirty ? (
          <Badge
            variant="outline"
            className="text-amber-700 bg-amber-50 border-amber-200"
          >{mt("unsavedChanges")}</Badge>
        ) : undefined}
      />


      {!validationErrors.length && (dormantCheckin > 0 || dormantCheckout > 0) && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3"><Info className="mt-0.5 size-4 shrink-0 text-amber-600" /><div className="space-y-0.5 text-xs text-amber-900">
        {dormantCheckin > 0 && <p>{mt("checklistDormantCheckin", { count: dormantCheckin })}</p>}
        {dormantCheckout > 0 && <p>{mt("checklistDormantCheckout", { count: dormantCheckout })}</p>}
      </div></div>}
      <KitchenCheckinCheckoutEditor
        title={mt("storageCheckInCheckOutChecklists")}
        smartLockAvailable={false}
        smartLockInstructions={null}
        onSmartLockInstructionsChange={() => {}}
        onFlowToggleMouseDown={(event) => event.preventDefault()}
        onFlowToggleClick={(event) => (event.currentTarget.closest("[data-stage-panel]") as HTMLElement | null)?.focus({ preventScroll: true })}
        onFlowToggleKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) (event.currentTarget.closest("[data-stage-panel]") as HTMLElement | null)?.focus({ preventScroll: true }); }}
        items={items}
        onItemsChange={setItems}
        checkinEnabled={checkinEnabled}
        onCheckinEnabledChange={setCheckinEnabled}
        checkoutEnabled={checkoutEnabled}
        onCheckoutEnabledChange={setCheckoutEnabled}
        checkinInstructions={checkinInstructions}
        onCheckinInstructionsChange={setCheckinInstructions}
        checkoutInstructions={checkoutInstructions}
        onCheckoutInstructionsChange={setCheckoutInstructions}
      />
      
      {/* Save Settings Button */}
      {(isDirty || saveAction.status !== 'idle') && <div className="flex justify-end">
        <StatusButton
          status={saveAction.status}
          onClick={saveAction.execute}
          disabled={
            (!isDirty && data?.id !== null) || validationErrors.length > 0
          }
          labels={{ idle: mt("saveStorageChecklists"), loading: mt("savingShort"), success: mt("saved") }}
        />
      </div>}

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-xs text-destructive space-y-0.5">
            {validationErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
