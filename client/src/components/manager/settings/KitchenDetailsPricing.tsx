import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Trash2, Loader2 } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KitchenPricingContent, type KitchenPricingHandle } from "@/pages/KitchenPricingManagement";
import { invalidateKitchenListingState } from "@/lib/manager-kitchens-navigation";
import { SettingsRow } from "./SettingsRow";

/**
 * The subset of a kitchen this tab reads. Declared structurally rather than
 * imported so the parent can pass its own kitchen shape without the two modules
 * depending on each other.
 */
export interface KitchenDetailsTarget {
  id: number;
  name: string;
  description?: string;
  smartLockAvailable?: boolean;
  smartLockEnabled?: boolean;
}

export interface KitchenDetailsPricingHandle {
  /** Persist pending edits across both cards. Resolves `true` when all succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

interface KitchenDetailsPricingProps {
  locationId: number;
  kitchen: KitchenDetailsTarget;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Quiet destructive action. `ghost` avoids the chef CTA surface entirely, and
 *  the base pill radius is overridden so it reads as a settings control. */
const DESTRUCTIVE_ACTION =
  "rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive";

/**
 * The "Details & Pricing" tab.
 *
 * One card per concern — the kitchen's identity, its rates, and the destructive
 * actions — instead of a heading per field. Every card is committed by the
 * parent's single save action through `saveAllChanges`, so the tab never grows a
 * row of buttons in the middle of the page. The smart-door-lock switch is the
 * deliberate exception: a boolean toggle saves on change, like every other
 * toggle in the product.
 */
const KitchenDetailsPricing = forwardRef<
  KitchenDetailsPricingHandle,
  KitchenDetailsPricingProps
>(function KitchenDetailsPricing({ locationId, kitchen, onDirtyChange }, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState(kitchen.name);
  const [description, setDescription] = useState(kitchen.description ?? '');

  const pricingRef = useRef<KitchenPricingHandle>(null);
  const [pricingDirty, setPricingDirty] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
  }, [name, description, detailsDirty, kitchen.id, invalidateKitchenCaches, toast]);

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

  const handleSmartLockToggle = async (enabled: boolean) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await currentFirebaseUser.getIdToken();

      const response = await fetch(`/api/manager/kitchens/${kitchen.id}/details`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ smartLockEnabled: enabled }),
      });
      if (!response.ok) throw new Error(tt('failedToUpdateGeneric'));

      await invalidateKitchenCaches();
      toast({ title: enabled ? mt("smartLockEnabledToast") : mt("smartLockDisabledToast") });
    } catch (error) {
      logger.error('Smart lock toggle error:', error);
      toast({ title: mt("failedToUpdate"), variant: "destructive" });
    }
  };

  // Ask the server what this delete would actually destroy, so the confirmation
  // can name the real number instead of warning in the abstract.
  useEffect(() => {
    if (!showDelete) {
      setDeleteImpact(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
        const token = await currentFirebaseUser.getIdToken();

        const response = await fetch(`/api/manager/kitchens/${kitchen.id}/delete-impact`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include',
        });
        if (!response.ok) throw new Error('delete-impact-unavailable');

        const data = await response.json();
        if (!cancelled) setDeleteImpact(Number(data.bookings ?? 0));
      } catch (error) {
        logger.error('Kitchen delete impact error:', error);
        if (!cancelled) setDeleteImpact(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showDelete, kitchen.id]);

  const handleDeleteKitchen = async () => {
    setIsDeleting(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await currentFirebaseUser.getIdToken();

      const response = await fetch(`/api/manager/kitchens/${kitchen.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || tt("failedToDeleteKitchen"));
      }

      await invalidateKitchenCaches();
      setShowDelete(false);
      toast({
        title: mt("kitchenDeleted"),
        description: mt("kitchenHasBeenSuccessfullyRemoved"),
      });
    } catch (error: any) {
      logger.error('Kitchen delete error:', error);
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteWarning =
    deleteImpact === null
      ? mt("deleteKitchenWarningUnknown")
      : deleteImpact === 0
        ? mt("deleteKitchenWarningNoBookings")
        : mt("deleteKitchenWarningBookings", { count: deleteImpact });

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

          {kitchen.smartLockAvailable && (
            <SettingsRow
              label={mt("smartDoorLock")}
              hint={mt("enableIfThisKitchenHasAKeypadOrSmartLockYouCanSetAccessCodes")}
              help={
                kitchen.smartLockEnabled
                  ? mt("configureAccessCodeInCheckinSettings", { section: mt("navCheckinCheckout") })
                  : undefined
              }
            >
              <Switch
                checked={kitchen.smartLockEnabled || false}
                onCheckedChange={handleSmartLockToggle}
                aria-label={mt("smartDoorLock")}
              />
            </SettingsRow>
          )}
        </CardContent>
      </Card>

      <KitchenPricingContent
        ref={pricingRef}
        selectedLocationId={locationId}
        selectedKitchenId={kitchen.id}
        onDirtyChange={setPricingDirty}
      />

      <Card className="border-destructive/25">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("dangerZone")}</CardTitle>
          <CardDescription>{mt("dangerZoneDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{mt("deleteKitchenRowTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {mt("deleteKitchenRowHint")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className={DESTRUCTIVE_ACTION}
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {mt("deleteKitchen")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mt("deleteKitchenTitle", { name: kitchen.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>{deleteWarning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{mt("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteKitchen();
              }}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mt("deleteKitchen")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

KitchenDetailsPricing.displayName = "KitchenDetailsPricing";

export default KitchenDetailsPricing;
