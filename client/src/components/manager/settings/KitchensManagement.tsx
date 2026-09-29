import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect, useCallback, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Storefront, Plus, Loader2, Package, Wrench, Image as Images, Clock, ClipboardCheck } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { ChefPageHeader } from "@/components/chef/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import KitchenDetailsPricing, { type KitchenDetailsPricingHandle } from "./KitchenDetailsPricing";
import { KitchenListingStatus } from "./KitchenListingStatus";
import { KitchenSwitcher } from "./KitchenSwitcher";
import KitchenPhotos from "./KitchenPhotos";
import { KitchenSetupForm } from "./KitchenSetupForm";
import { DEFAULT_KITCHEN_SECTION, kitchenSectionFromParams, type KitchenSection, type KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  locationId: number;
  isActive: boolean;
  galleryImages?: string[];
  minimumBookingHours?: number;
  /** Admin-controlled capability gate. When false, all smart-door UI is hidden. */
  smartLockAvailable?: boolean;
  smartLockEnabled?: boolean;
}

function getInitialKitchenSection(): KitchenSection {
  return kitchenSectionFromParams(new URLSearchParams(window.location.search));
}

interface Location {
  id: number;
  name: string;
}

interface KitchensManagementProps {
  location: Location;
  onNavigate: (view: KitchensNavigationTarget, kitchenId?: number) => void;
  onConfigureRequirements: () => void;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Ref the shell owns so it can persist edits before navigating away. Passed as
   * a plain prop rather than via `forwardRef` to avoid re-indenting the whole
   * component body for a single handle.
   */
  saveRef?: Ref<KitchensHandle>;
  /**
   * Which kitchen to open on, when the manager arrived from a surface that named one — the publish
   * review's rows, for instance.
   *
   * A SEED, not a controlled value: once the page is open the switcher owns the selection. An id
   * that is not one of this location's kitchens is ignored rather than trusted, because the shell
   * remembers the kitchen a review was opened for and the manager can then walk to another location.
   */
  initialKitchenId?: number;
}

export interface KitchensHandle {
  /** Persist pending edits across every card. Resolves `true` when all succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

/**
 * Underline tab bar for the kitchen sections. Three cues mark the active tab —
 * a 2px brand underline, a heavier label and a brand-tinted icon — because NN/g
 * ("Tabs, Used Right") requires at least two. The shared Tabs primitive renders a
 * segmented control, so every default that makes it read as one is overridden here.
 */
// Padding must stay symmetric: tailwind-merge only lets a later `py-*` cancel the
// primitive's `py-1.5`, so `pb-3 pt-1` would leave both rules live and let CSS source
// order pick the winner. One `py-*` keeps exactly one padding rule in the output.
const TAB_TRIGGER =
  "group gap-2 rounded-none border-b-2 border-transparent px-0.5 py-2.5 font-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none";
const TAB_ICON = "h-4 w-4 shrink-0 transition-colors group-data-[state=active]:text-primary";

/** Quiet header link. `ghost` skips the chef CTA surface, but its own hover is
 *  `bg-accent`, which is pure white in both themes — hence the `bg-muted` override. */
const HEADER_LINK = "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

export default function KitchensManagement({ location, onNavigate, onConfigureRequirements, onDirtyChange, saveRef, initialKitchenId }: KitchensManagementProps) {
  
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(initialKitchenId ?? null);
  const [activeSection, setActiveSection] = useState<KitchenSection>(getInitialKitchenSection);

  const detailsRef = useRef<KitchenDetailsPricingHandle>(null);
  const [detailsDirty, setDetailsDirty] = useState(false);
  /** In-page navigation held back until the unsaved-changes question is answered. */
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  const { data: kitchens = [], isLoading: isLoadingKitchens } = useQuery<Kitchen[]>({
    queryKey: ['managerKitchens', location.id],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens/${location.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error(tt('failedToFetchKitchens'));
      return response.json();
    },
    enabled: !!location.id,
  });
  /*
   * The selection is honoured only when it names one of THIS location's kitchens. `initialKitchenId`
   * is seeded by the shell, which remembers the kitchen a publish review was opened for — so it can
   * be stale by the time the manager walks to another location. An id from elsewhere would leave the
   * tabs pointing at a kitchen that is not in the list.
   */
  const selectedKitchen =
    selectedKitchenId != null
      ? kitchens.find((kitchen) => kitchen.id === selectedKitchenId) ?? null
      : null;
  const activeKitchen = selectedKitchen ?? kitchens[0] ?? null;
  const activeKitchenId = activeKitchen?.id ?? null;

  /*
   * The create form takes the CONTENT slot — that is the whole point of it not being a modal. Two
   * ways in, one screen: the switcher's "Add Kitchen", or the empty state's own action. It replaces
   * the tabs while it is up, which is why `kitchensDirty` below is masked by it.
   */
  const showingCreateForm = showCreateKitchen;

  /*
   * The details form only exists while its tab is mounted, so unsaved edits can
   * only exist there. Masking by section also keeps a stale flag from surviving a
   * tab switch, which unmounts the form and drops its state.
   *
   * `!showingCreateForm` is the third mask, and it is not cosmetic: while the create form is up the
   * details tab is UNMOUNTED, so there is nothing left to save — and a live `detailsDirty` would put
   * a "Save changes" button in the header that reports success without writing anything, because
   * `saveAllChanges` falls back to `true` when its ref is null.
   */
  const kitchensDirty =
    activeSection === DEFAULT_KITCHEN_SECTION && detailsDirty && !showingCreateForm;

  useEffect(() => {
    setSelectedKitchenId((current) =>
      kitchens.some((kitchen) => kitchen.id === current) ? current : kitchens[0]?.id ?? null,
    );
  }, [kitchens]);

  /**
   * Publish the kitchen this page is SHOWING into `?kit`.
   *
   * Nothing else owns that parameter, and the shell reads it as the reload fallback for the publish
   * review, so leaving it stale is what made a refresh on the review page land on "No kitchen
   * selected" — `ManagerPageLayout`'s sync effect DELETES a `kit` the sidebar's own selector is not
   * set to, so whether the parameter survived a reload came down to a race between that effect and
   * the location list arriving. This page is the authority on which kitchen is on screen, so it is
   * the right place to make the URL agree.
   *
   * A one-way write. `initialKitchenId` still decides what OPENS, and the effect above still owns
   * the selection against the list, so nothing here can start a fight with either.
   */
  useEffect(() => {
    if (activeKitchenId == null) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("kit") === String(activeKitchenId)) return;
    url.searchParams.set("kit", String(activeKitchenId));
    window.history.replaceState({}, "", url);
  }, [activeKitchenId]);

  useEffect(() => {
    onDirtyChange?.(kitchensDirty);
  }, [kitchensDirty, onDirtyChange]);

  // Cover browser refresh / tab close, which the in-app guard cannot intercept.
  useEffect(() => {
    if (!kitchensDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [kitchensDirty]);

  /** Throws on failure so the header status button can report the error state. */
  const saveAll = useCallback(async () => {
    const saved = (await detailsRef.current?.saveAllChanges()) ?? true;
    if (!saved) throw new Error("save-failed");
  }, []);

  const saveAction = useStatusButton(saveAll);

  // Keep the action mounted through its success animation, even after the save
  // clears the dirty flag.
  const showSaveAction = kitchensDirty || saveAction.status !== "idle";

  // The shell's guard needs a non-throwing variant so it can decide whether it
  // is safe to navigate away.
  const saveAllChanges = useCallback(async () => {
    try {
      await saveAll();
      return true;
    } catch {
      return false;
    }
  }, [saveAll]);

  useImperativeHandle(saveRef, () => ({ saveAllChanges }), [saveAllChanges]);

  /**
   * Run an in-page navigation, asking about unsaved edits first. Switching tabs
   * or kitchens both unmount the details form, so they need the same protection
   * the shell applies to leaving the page entirely.
   */
  const guardNavigation = (action: () => void) => {
    if (!kitchensDirty) {
      action();
      return;
    }
    setPendingNav(() => action);
  };

  const discardPendingNav = () => {
    const action = pendingNav;
    setPendingNav(null);
    action?.();
  };

  const saveThenPendingNav = async () => {
    const action = pendingNav;
    if (!action) return;
    if (!(await saveAllChanges())) return;
    setPendingNav(null);
    action();
  };

  const handleSectionChange = (section: string) => {
    const nextSection = section as KitchenSection;
    guardNavigation(() => {
      setActiveSection(nextSection);
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'kitchens');
      if (nextSection === DEFAULT_KITCHEN_SECTION) url.searchParams.delete('section');
      else url.searchParams.set('section', nextSection);
      window.history.replaceState({}, '', url);
    });
  };

  useEffect(() => {
    const syncSectionFromUrl = () => setActiveSection(kitchenSectionFromParams(new URLSearchParams(window.location.search)));
    window.addEventListener('popstate', syncSectionFromUrl);
    return () => window.removeEventListener('popstate', syncSectionFromUrl);
  }, []);

  /**
   * Open the create form, asking about unsaved edits first.
   *
   * The form takes the content slot, so opening it unmounts the details tab — which makes this a
   * NAVIGATION rather than a reveal, and it needs the same protection switching tabs or kitchens
   * gets. Without it, "Add Kitchen" silently threw away whatever the manager had typed in Details.
   */
  const openCreateKitchen = () => guardNavigation(() => setShowCreateKitchen(true));

  /**
   * Leave the create form without creating anything.
   *
   * Nothing to restore: the form is unmounted while it is closed, so its half-filled fields are
   * already gone. This only puts the content slot back.
   */
  const closeCreateKitchen = () => setShowCreateKitchen(false);

  /**
   * The kitchen switcher, rendered as the IDENTITY at the head of the listing-status bar rather than
   * as a header control. That bar answers "which kitchen, and where does it stand", so the two belong
   * on one line, and it keeps the status visible on every tab instead of only the Details tab.
   *
   * The control itself lives in `KitchenSwitcher` so the harness can render the REAL thing — a
   * stand-in there could only ever confirm the copy, never the affordance. Switching is wrapped in
   * `guardNavigation` at this call site because the unsaved-changes question belongs to this page.
   */
  const kitchenSwitcher = activeKitchen ? (
    <KitchenSwitcher
      kitchens={kitchens}
      activeKitchenId={activeKitchen.id}
      onSelect={(kitchenId) => guardNavigation(() => setSelectedKitchenId(kitchenId))}
      onAddKitchen={openCreateKitchen}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={mt("navSpaces")}
        description={mt("myKitchensDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={onConfigureRequirements}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" />{mt("navApplicationRequirements")}
            </Button>
            <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={() => onNavigate('availability')}>
              <Clock className="mr-1.5 h-4 w-4" />{mt("navAvailability")}
            </Button>

            {/* Page-level save. Rendered only while something is unsaved, so the
                header stays quiet at rest — the same convention as Booking Policies. */}
            {showSaveAction && (
              <StatusButton
                status={saveAction.status}
                onClick={saveAction.execute}
                labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }}
              />
            )}
          </div>
        }
      />

      {/*
        * Kitchen List — or the create form, in the SAME slot.
        *
        * The form is not an overlay on this page, it is this page's content while it is open. That
        * is the whole reason it is not a dialog any more: the old one dimmed a page it was asking
        * the manager to leave, and the wizard's kitchen part had already made the opposite call for
        * the same fields. See `KitchenSetupForm`.
        *
        * Three branches, in this order: still loading; the create form; the empty state; the page.
        * The empty state survives in front of the form rather than being replaced by it, because
        * that is the shape the location prerequisite already uses on the dashboard — a notice that
        * says what the thing unlocks, and then the form in the same slot. See `NeedsPrerequisite`.
        */}
      {isLoadingKitchens ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : showingCreateForm ? (
        <KitchenSetupForm
          locationId={location.id}
          onCancel={closeCreateKitchen}
          onCreated={closeCreateKitchen}
        />
      ) : kitchens.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Storefront className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">{mt("noKitchensYet")}</h3>
            <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">{mt("addYourFirstKitchenToStartManagingPhotosDescriptionsAndAccep")}</p>
            <Button onClick={openCreateKitchen} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />{mt("addYourFirstKitchen")}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/*
            The kitchen bar and the section tabs are ONE panel, not two stacked blocks: the tab
            bar's own bottom border is the header's divider, which is the entity-header shape GitHub
            and Vercel use. Any gap between them makes the header float as a notice about the page
            again, which is what it is not.

            The bar stays OUTSIDE the tabs on purpose: the listing status belongs to the KITCHEN,
            so inside a tab it disappeared the moment a manager looked at Photos or Storage. It is
            also the only always-mounted observer of the readiness checklist while the tabs are the
            things that save, so unmounting it here would silently bring back the stale-status bug.
          */}
          {activeKitchen && (
            <KitchenListingStatus
              kitchenId={activeKitchen.id}
              locationId={location.id}
              selector={kitchenSwitcher}
              onNavigate={onNavigate}
            />
          )}

          <Tabs value={activeSection} onValueChange={handleSectionChange}>
            <TabsList className="mb-6 h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
              <TabsTrigger value="details" className={TAB_TRIGGER}>
                <Storefront className={TAB_ICON} />{mt("details")} &amp; {mt("navPricing")}
              </TabsTrigger>
              <TabsTrigger value="photos" className={TAB_TRIGGER}>
                <Images className={TAB_ICON} />{mt("photos")}
              </TabsTrigger>
              <TabsTrigger value="storage" className={TAB_TRIGGER}>
                <Package className={TAB_ICON} />{mt("navStorage")}
              </TabsTrigger>
              <TabsTrigger value="equipment" className={TAB_TRIGGER}>
                <Wrench className={TAB_ICON} />{mt("navEquipment")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-0">
              {activeKitchen && (
                <KitchenDetailsPricing
                  ref={detailsRef}
                  locationId={location.id}
                  kitchen={activeKitchen}
                  onDirtyChange={setDetailsDirty}
                />
              )}
            </TabsContent>

            <TabsContent value="photos" className="mt-0">
              {activeKitchen && (
                <KitchenPhotos locationId={location.id} kitchen={activeKitchen} />
              )}
            </TabsContent>

            <TabsContent value="storage" className="mt-0">
              <StorageListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>

            <TabsContent value="equipment" className="mt-0">
              <EquipmentListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>

          </Tabs>
        </>
      )}

      {/*
        * In-page navigation guard. Switching tabs or kitchens unmounts the
        * details form, so this runs through the shared confirmation — one dialog
        * for every surface that can hold edits.
        */}
      <UnsavedChangesDialog
        open={pendingNav !== null}
        onOpenChange={(open) => !open && setPendingNav(null)}
        description={mt("kitchenUnsavedChangesDescription")}
        onDiscard={discardPendingNav}
        onSave={saveThenPendingNav}
      />
    </div>
  );
}
