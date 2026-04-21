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

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import type {
  ChecklistItem,
  PhotoRequirement,
} from "./shared/ChecklistEditor";
import {
  StorageCheckinCheckoutEditor,
  unifyStorageInspectionItems,
  storageInspectionItemsToArrays,
  validateStorageInspectionItems,
  type UnifiedStorageInspectionItem,
} from "./StorageCheckinCheckoutEditor";

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
  location: {
    id: number;
    name: string;
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StorageCheckinCheckoutSettings({
  location,
}: StorageCheckinCheckoutSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing settings from the shared endpoint that also powers the
  // Kitchen Check-In / Check-Out page. We only consume the storage portion.
  const { data, isLoading } = useQuery<StorageCheckinCheckoutSettingsData>({
    queryKey: ["checkin-checkout-settings", location.id],
    queryFn: () =>
      apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: !!location.id,
  });

  // Local state — single unified list for the editor plus per-stage
  // enable flags & instructions.
  const [checkinEnabled, setCheckinEnabled] = useState(true);
  const [checkoutEnabled, setCheckoutEnabled] = useState(true);
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
      setCheckinEnabled(data.storageCheckinEnabled ?? true);
      setCheckoutEnabled(data.storageCheckoutEnabled ?? true);
      setCheckinInstructions(data.storageCheckinInstructions);
      setCheckoutInstructions(data.storageCheckoutInstructions);
      setItems(initialUnifiedItems);
    }
  }, [data, initialUnifiedItems]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      checkinEnabled !== (data.storageCheckinEnabled ?? true) ||
      checkoutEnabled !== (data.storageCheckoutEnabled ?? true) ||
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

  // Save — splits the unified list back into the server's legacy four arrays
  // and sends only the storage-related fields. Kitchen fields stay untouched
  // because the server PUT endpoint only updates fields that were provided.
  const saveAction = useStatusButton(
    useCallback(async () => {
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

      toast({
        title: "Settings Saved",
        description:
          "Storage check-in / check-out checklists updated successfully.",
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
    ]),
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Storage Check-In / Check-Out
          </h2>
          <p className="text-muted-foreground">
            Configure the move-in and move-out inspections chefs complete for
            storage bookings.
          </p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Storage Check-In / Check-Out
          </h2>
          <p className="text-muted-foreground">
            Define the move-in and move-out inspections chefs must document for
            storage bookings at this location.
          </p>
        </div>
        {isDirty && (
          <Badge
            variant="outline"
            className="text-amber-700 bg-amber-50 border-amber-200"
          >
            Unsaved changes
          </Badge>
        )}
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
        <Info className="size-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800 space-y-1">
          <p className="font-medium">How this works</p>
          <p>
            Define what chefs document at each stage using the matrix table
            below. Every item can optionally require a photo, and the same
            item can appear on both Check-In and Check-Out. Click{" "}
            <strong>Preview</strong> on either panel to see exactly what the
            chef sees. Check-in photos become the baseline for any damage
            claim filed at checkout — they are auto-attached as{" "}
            <em>photo_before</em> evidence.
          </p>
        </div>
      </div>

      {/* Unified Matrix Editor */}
      <StorageCheckinCheckoutEditor
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

      {/* Save Button */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {data?.id ? "Last saved" : "Not saved yet"} — applies to all storage
          at this location
        </p>
        <StatusButton
          status={saveAction.status}
          onClick={saveAction.execute}
          disabled={
            (!isDirty && data?.id !== null) || validationErrors.length > 0
          }
          labels={{ idle: "Save Settings", loading: "Saving", success: "Saved" }}
        />
      </div>
    </div>
  );
}
