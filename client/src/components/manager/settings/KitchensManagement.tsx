import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect, useCallback, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Storefront, Plus, Loader2, Package, Wrench, Image as Images, Clock, ClipboardCheck, Check, ChevronDown } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { ChefPageHeader } from "@/components/chef/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CurrencyInput } from "@/components/ui/currency-input";
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import KitchenDetailsPricing, { type KitchenDetailsPricingHandle } from "./KitchenDetailsPricing";
import KitchenPhotos from "./KitchenPhotos";
import { DEFAULT_KITCHEN_SECTION, kitchenSectionFromParams, type KitchenSection } from "@/lib/manager-kitchens-navigation";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  onNavigate: (view: 'availability') => void;
  onConfigureRequirements: () => void;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Ref the shell owns so it can persist edits before navigating away. Passed as
   * a plain prop rather than via `forwardRef` to avoid re-indenting the whole
   * component body for a single handle.
   */
  saveRef?: Ref<KitchensHandle>;
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

/** Opts a Button out of the chef marketing CTA surface — pill radius, layered
 *  shadow and lift-on-hover — so dialogs read as product UI, not a promo. */
const QUIET_ACTION = "rounded-lg shadow-none hover:shadow-none hover:translate-y-0 active:translate-y-0";

export default function KitchensManagement({ location, onNavigate, onConfigureRequirements, onDirtyChange, saveRef }: KitchensManagementProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [newKitchenDescription, setNewKitchenDescription] = useState('');
  const [newKitchenImageUrl, setNewKitchenImageUrl] = useState('');
  const [newKitchenHourlyRate, setNewKitchenHourlyRate] = useState('');
  const [newKitchenMinimumHours, setNewKitchenMinimumHours] = useState('1');
  const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
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
  const activeKitchenId = selectedKitchenId ?? kitchens[0]?.id ?? null;
  const activeKitchen = kitchens.find((kitchen) => kitchen.id === activeKitchenId) ?? null;
  const hourlyRateValue = Number.parseFloat(newKitchenHourlyRate);
  const newKitchenIncomplete = !newKitchenName.trim() || !newKitchenDescription.trim()
    || !newKitchenImageUrl || !(hourlyRateValue > 0);

  // The details form only exists while its tab is mounted, so unsaved edits can
  // only exist there. Masking by section also keeps a stale flag from surviving a
  // tab switch, which unmounts the form and drops its state.
  const kitchensDirty = activeSection === DEFAULT_KITCHEN_SECTION && detailsDirty;

  useEffect(() => {
    setSelectedKitchenId((current) =>
      kitchens.some((kitchen) => kitchen.id === current) ? current : kitchens[0]?.id ?? null,
    );
  }, [kitchens]);

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

  const handleCreateKitchen = async () => {
    // Guard on the parsed rate, not the raw string: "abc" is truthy but
    // serialises to null and comes back as a 400 from the pricing validation.
    if (newKitchenIncomplete) {
      toast({ title: mt("error"),
        description: mt("completeKitchenEssentials"),
        variant: "destructive",
      });
      return;
    }

    setIsCreatingKitchen(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();

      const response = await fetch('/api/manager/kitchens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          locationId: location.id,
          name: newKitchenName.trim(),
          description: newKitchenDescription.trim(),
          imageUrl: newKitchenImageUrl,
          hourlyRate: Math.round(hourlyRateValue * 100),
          currency: "CAD",
          minimumBookingHours: parseInt(newKitchenMinimumHours, 10) || 1,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create kitchen');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      // Also refresh the all-kitchens cache used by ManagerPageLayout (Availability page sidebar)
      queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });

      toast({ title: mt("success"),
        description: mt("kitchenCreatedSuccessfully"),
      });

      setNewKitchenName('');
      setNewKitchenDescription('');
      setNewKitchenImageUrl('');
      setNewKitchenHourlyRate('');
      setNewKitchenMinimumHours('1');
      setShowCreateKitchen(false);
    } catch (error: any) {
      logger.error('Kitchen creation error:', error);
      toast({ title: mt("error"),
        description: error.message || tt("failedToCreateKitchen"),
        variant: "destructive",
      });
    } finally {
      setIsCreatingKitchen(false);
    }
  };

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

            {/* Kitchen switcher. Always present — it is the only place the kitchen's
                name appears when a location has a single kitchen, and it owns "Add
                kitchen" so the page header keeps one subject and one control.

                `modal={false}` because a modal menu wraps itself in react-remove-scroll,
                which sets `overflow: hidden` on <body> and so makes the page scrollbar
                vanish for as long as the menu is open. Non-modal leaves the page
                scrollable; dismissal, Escape and keyboard navigation come from the menu's
                own layer either way, so nothing else changes. */}
            {activeKitchen && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-lg border bg-background px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-medium text-primary">
                      {activeKitchen.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate font-medium">{activeKitchen.name}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>{mt("kitchen")}</DropdownMenuLabel>
                  {kitchens.map((kitchen) => (
                    <DropdownMenuItem
                      key={kitchen.id}
                      onSelect={() => guardNavigation(() => setSelectedKitchenId(kitchen.id))}
                      className="gap-2 focus:bg-muted focus:text-foreground"
                    >
                      <Check className={cn("h-4 w-4 shrink-0 text-primary", kitchen.id !== activeKitchenId && "opacity-0")} />
                      <span className="truncate">{kitchen.name}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setShowCreateKitchen(true)}
                    className="gap-2 focus:bg-muted focus:text-foreground"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    {mt("addKitchen")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

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

      <Dialog open={showCreateKitchen} onOpenChange={setShowCreateKitchen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mt("newKitchen")}</DialogTitle>
            <DialogDescription>{mt("newKitchenDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kitchen-name">{mt("kitchenName")} *</Label>
              <Input
                id="kitchen-name"
                value={newKitchenName}
                onChange={(e) => setNewKitchenName(e.target.value)}
                placeholder={mt("eGMainKitchenPrepKitchen")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kitchen-desc">{mt("description")} *</Label>
              <Textarea
                id="kitchen-desc"
                value={newKitchenDescription}
                onChange={(e) => setNewKitchenDescription(e.target.value)}
                placeholder={mt("placeholderKitchenDescription")}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>{mt("coverPhoto")} *</Label>
              <ImageWithReplace imageUrl={newKitchenImageUrl || undefined} onImageChange={(url) => setNewKitchenImageUrl(url || '')} onRemove={() => setNewKitchenImageUrl('')} fieldName="new-kitchen-cover" aspectRatio="16/9" className="h-48 rounded-lg object-cover" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kitchen-rate">{mt("hourlyRate")} (CAD) *</Label>
                <CurrencyInput
                  id="kitchen-rate"
                  value={newKitchenHourlyRate}
                  onValueChange={setNewKitchenHourlyRate}
                  placeholder="25.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kitchen-minimum">{mt("minimumBooking")} ({mt("hoursSuffix")})</Label>
                <Input id="kitchen-minimum" type="number" min="1" max="24" step="1" value={newKitchenMinimumHours} onChange={(event) => setNewKitchenMinimumHours(event.target.value)} />
              </div>
            </div>
            {newKitchenIncomplete && (
              <p className="text-xs text-muted-foreground">{mt("completeKitchenEssentials")}</p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShowCreateKitchen(false)}>{mt("cancel")}</Button>
            <StatusButton
              onClick={handleCreateKitchen}
              status={isCreatingKitchen ? "loading" : "idle"}
              disabled={newKitchenIncomplete}
              labels={{ idle: mt("createKitchen"), loading: mt("creating"), success: mt("created") }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kitchen List */}
      {isLoadingKitchens ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : kitchens.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Storefront className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">{mt("noKitchensYet")}</h3>
            <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">{mt("addYourFirstKitchenToStartManagingPhotosDescriptionsAndAccep")}</p>
            <Button onClick={() => setShowCreateKitchen(true)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />{mt("addYourFirstKitchen")}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
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
        </div>
      )}

      {/* In-page navigation guard. Switching tabs or kitchens unmounts the details
          form, so without this the unsaved edits would disappear with no warning. */}
      <AlertDialog open={pendingNav !== null} onOpenChange={(open) => !open && setPendingNav(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("unsavedChanges")}</AlertDialogTitle>
            <AlertDialogDescription>{mt("kitchenUnsavedChangesDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
            <Button
              variant="outline"
              className={QUIET_ACTION}
              onClick={discardPendingNav}
            >
              {mt("discardChanges")}
            </Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void saveThenPendingNav();
              }}
            >
              {mt("saveChanges")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
