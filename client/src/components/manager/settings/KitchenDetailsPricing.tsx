import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { KitchenPricingContent, type KitchenPricingHandle } from "@/pages/KitchenPricingManagement";
import { invalidateKitchenListingState } from "@/lib/manager-kitchens-navigation";
import { SettingsRow } from "./SettingsRow";
import { useListingImpactConfirm } from "@/components/manager/ListingImpactConfirm";

/**
 * The subset of a kitchen this tab reads. Declared structurally rather than
 * imported so the parent can pass its own kitchen shape without the two modules
 * depending on each other.
 */
export interface KitchenDetailsTarget {
  id: number;
  name: string;
  description?: string;
}

export interface KitchenDetailsPricingHandle {
  /** Persist pending edits across both cards. Resolves `true` when all succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

interface KitchenDetailsPricingProps {
  locationId: number;
  locationName: string;
  kitchen: KitchenDetailsTarget;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}

const KitchenDetailsPricing = forwardRef<
  KitchenDetailsPricingHandle,
  KitchenDetailsPricingProps
>(function KitchenDetailsPricing({ locationId, locationName, kitchen, onDirtyChange }, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listingImpact = useListingImpactConfirm();

  const [name, setName] = useState(kitchen.name);
  const [description, setDescription] = useState(kitchen.description ?? '');

  const pricingRef = useRef<KitchenPricingHandle>(null);
  const [pricingDirty, setPricingDirty] = useState(false);

  // Re-seed the form when the parent switches to a different kitchen.
  useEffect(() => {
    setName(kitchen.name);
    setDescription(kitchen.description ?? '');
  }, [kitchen.id, kitchen.name, kitchen.description]);

  // Trimmed comparison: trailing whitespace is not an edit worth saving.
  const detailsDirty =
    name.trim() !== kitchen.name || description.trim() !== (kitchen.description ?? '');
  const isDirty = detailsDirty || pricingDirty;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const invalidateKitchenCaches = useCallback(async () => {
    /*
     * Description and rates are checklist items, so a save here changes what the status banner and the
     * publish review report. `invalidateKitchenListingState` covers the checklist (keyed by kitchen) as
     * well as the two kitchen lists (keyed by location, one of which the Availability sidebar reads).
     */
    invalidateKitchenListingState(queryClient, kitchen.id, locationId);
  }, [queryClient, kitchen.id, locationId]);

  /**
   * Persist the identity fields. Throws on failure so the caller's status button
   * can report it; the toast carries the detail.
   */
  const saveDetails = useCallback(async () => {
    const nextName = name.trim();
    const nextDescription = description.trim();

    if (!nextName) {
      toast({
        title: mt("validationError"),
        description: mt("kitchenNameRequired"),
        variant: "destructive",
      });
      throw new Error("name-required");
    }

    if (!detailsDirty) return;
    if (!await listingImpact.confirm(kitchen.id, !nextDescription)) throw new Error("Save cancelled");

    const currentFirebaseUser = auth.currentUser;
    if (!currentFirebaseUser) throw new Error(tt("firebaseUserNotAvailable"));
    const token = await currentFirebaseUser.getIdToken();

    const response = await fetch(`/api/manager/kitchens/${kitchen.id}/details`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ name: nextName, description: nextDescription }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || tt("failedToUpdateKitchenDescription"));
    }

    await invalidateKitchenCaches();
    toast({ title: mt("success"), description: mt("kitchenDetailsUpdated") });
  }, [name, description, detailsDirty, kitchen.id, invalidateKitchenCaches, toast, listingImpact.confirm]);

  useImperativeHandle(
    ref,
    () => ({
      saveAllChanges: async () => {
        try {
          await saveDetails();
        } catch {
          return false;
        }
        return (await pricingRef.current?.saveAllChanges()) ?? true;
      },
    }),
    [saveDetails],
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("kitchenDetails")}</CardTitle>
          <CardDescription>{mt("kitchenDetailsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          <SettingsRow
            id="kitchen-name"
            label={mt("kitchenName")}
            hint={mt("kitchenNameHint")}
          >
            <Input
              id="kitchen-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className="w-full max-w-xs"
            />
          </SettingsRow>

          <SettingsRow
            id="kitchen-description"
            layout="stacked"
            label={mt("description")}
            hint={mt("kitchenDescriptionHint")}
          >
            <Textarea
              id="kitchen-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={mt("placeholderKitchenDescriptionLong")}
              rows={3}
              className="max-w-2xl resize-none"
            />
          </SettingsRow>

        </CardContent>
      </Card>

      <KitchenPricingContent
        hideMinimumBookingDuration
        ref={pricingRef}
        selectedLocationId={locationId}
        selectedKitchenId={kitchen.id}
        locationName={locationName}
        onDirtyChange={setPricingDirty}
      />

      {listingImpact.dialog}
    </div>
  );
});

KitchenDetailsPricing.displayName = "KitchenDetailsPricing";

export default KitchenDetailsPricing;
