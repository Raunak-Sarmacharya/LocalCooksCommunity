import { StorageIcon as Package, EquipmentIcon as Wrench } from "@/components/ui/inventory-icons";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect, useCallback, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiPutWithMessage } from "@/lib/api";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";
import { TRACKING_PROMPT_DISMISS_MS, isTrackingPromptDismissed, saveTrackingPromptDismissal, trackingPromptKey, trackingSetupSignature } from "@/lib/kitchen-tracking-prompt";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { AvailabilitySkeleton } from "@/components/manager/AvailabilitySkeleton";
import { SettingsRow } from "./SettingsRow";
import { Plus, Loader2, Image as Images, Clock, ClipboardCheck, KitchenTour, CalendarClock, Building, CheckCircle, Copy } from "@/components/ui/manager-icons";
import { KitchenIcon } from "@/components/ui/kitchen-icon";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { ChefPageHeader } from "@/components/chef/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import KitchenDetailsPricing, { type KitchenDetailsPricingHandle } from "./KitchenDetailsPricing";
import { KitchenListingStatus } from "./KitchenListingStatus";
import { KitchenSwitcher } from "./KitchenSwitcher";
import KitchenPhotos from "./KitchenPhotos";
import { KitchenSetupForm } from "./KitchenSetupForm";
import { DEFAULT_KITCHEN_SECTION, kitchenSectionFromParams, type KitchenSection, type KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from "@/pages/KitchenAvailabilityManagement";
import KitchenWorkspaceControls from "./KitchenWorkspaceControls";
import type { KitchenWorkspaceSettings } from "./KitchenWorkspaceControls";
import type { KitchenPoliciesHandle, PolicySaveScope } from "./KitchenWorkspaceControls";
import ViewingSettingsPanel, { type ViewingSettingsPanelHandle, type ViewingSettingsResponse } from "@/components/manager/ViewingSettingsPanel";
import { copyableTourHours, type WeeklyTourSource } from "@shared/tour-schedule";
import { chefKitchenShareUrl, kitchenPreviewHref, shareKitchenLink } from "@/lib/kitchen-preview-url";

interface Kitchen {
  id: number;
  name: string;
  slug?: string | null;
  listingStatus?: "draft" | "active";
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
  slug?: string | null;
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
  "group shrink-0 gap-2 rounded-none border-b-2 border-transparent px-0.5 py-2.5 font-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none";
const TAB_ICON = "h-4 w-4 shrink-0 transition-colors group-data-[state=active]:text-primary";

/** Quiet header link. `ghost` skips the chef CTA surface, but its own hover is
 *  `bg-accent`, which is pure white in both themes — hence the `bg-muted` override. */
const HEADER_LINK = "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

export default function KitchensManagement({ location, onNavigate, onConfigureRequirements, onDirtyChange, saveRef, initialKitchenId }: KitchensManagementProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(initialKitchenId ?? null);
  const appliedInitialKitchenId = useRef<number>();
  const [activeSection, setActiveSection] = useState<KitchenSection>(getInitialKitchenSection);

  const detailsRef = useRef<KitchenDetailsPricingHandle>(null);
  const availabilityRef = useRef<KitchenAvailabilityManagementHandle>(null);
  const [availabilityDirty, setAvailabilityDirty] = useState(false);
  const policiesRef = useRef<KitchenPoliciesHandle>(null);
  const policySaveResolver = useRef<((saved: boolean) => void) | null>(null);
  const [policyScopeOpen, setPolicyScopeOpen] = useState(false);
  const [policyScopeSaving, setPolicyScopeSaving] = useState(false);
  const [policyScope, setPolicyScope] = useState<PolicySaveScope>("kitchen");
  const toursRef = useRef<ViewingSettingsPanelHandle>(null);
  const [toursDirty, setToursDirty] = useState(false);
  const [tourInfoOpen, setTourInfoOpen] = useState(false);
  const [tourSource, setTourSource] = useState<"booking" | "separate">("booking");
  const [sessionTrackingDismissal, setSessionTrackingDismissal] = useState<{ key: string; signature: string; dismissedAt: number } | null>(null);
  const [dismissalCheckedAt, setDismissalCheckedAt] = useState(Date.now);
  useEffect(() => {
    // The previous unbounded, account-agnostic dismissal must never suppress this prompt.
    try { window.localStorage.removeItem("dismissed-kitchen-tracking-setup"); } catch { /* Storage may be unavailable. */ }
    const refresh = () => setDismissalCheckedAt(Date.now());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const [highlightTracking, setHighlightTracking] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);
  const [policiesDirty, setPoliciesDirty] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [storagePenaltyDirty, setStoragePenaltyDirty] = useState(false);
  const storagePenaltyRef = useRef<{ saveAllChanges: () => Promise<boolean> }>(null);
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
  const { data: shareableKitchen } = useQuery({
    queryKey: ['publicKitchenShare', location.id, activeKitchenId, activeKitchen?.listingStatus, activeKitchen?.isActive],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${location.id}/details`);
      if (!response.ok) return null;
      const publicLocation = await response.json();
      const kitchen = publicLocation.kitchens?.find((item: Kitchen) => item.id === activeKitchenId);
      return publicLocation.slug && kitchen?.slug ? { locationSlug: publicLocation.slug as string, kitchen: kitchen as Kitchen } : null;
    },
    enabled: activeKitchenId != null && activeKitchen?.listingStatus === 'active' && activeKitchen.isActive,
    staleTime: 30_000,
  });
  const { data: workspaceSettings } = useQuery<KitchenWorkspaceSettings>({
    queryKey: kitchenWorkspaceSettingsKey(activeKitchenId ?? 0),
    queryFn: () => apiGet(`/manager/kitchens/${activeKitchenId}/workspace-settings`),
    enabled: activeKitchenId != null,
  });
  const { data: checklistSettings } = useQuery<{
    checkinEnabled: boolean; checkoutEnabled: boolean;
    checkinItems: unknown[]; checkoutItems: unknown[];
    checkinPhotoRequirements: unknown[]; checkoutPhotoRequirements: unknown[];
    checkinInstructions: string | null; checkoutInstructions: string | null;
  }>({
    queryKey: ["checkin-checkout-settings", location.id],
    queryFn: () => apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: activeKitchenId != null,
  });
  const trackingConfigured = workspaceSettings?.kitchen?.checkinCheckoutEnabled === true
    && checklistSettings?.checkinEnabled === true && checklistSettings?.checkoutEnabled === true
    && Boolean(checklistSettings.checkinItems?.length || checklistSettings.checkinPhotoRequirements?.length || checklistSettings.checkinInstructions?.trim())
    && Boolean(checklistSettings.checkoutItems?.length || checklistSettings.checkoutPhotoRequirements?.length || checklistSettings.checkoutInstructions?.trim());
  const trackingEnabled = workspaceSettings?.kitchen?.checkinCheckoutEnabled === true;
  const trackingUid = auth.currentUser?.uid;
  const trackingDismissalKey = trackingUid && activeKitchenId != null ? trackingPromptKey(trackingUid, activeKitchenId) : null;
  const trackingSignature = workspaceSettings?.kitchen && checklistSettings ? trackingSetupSignature([
    workspaceSettings.kitchen.checkinCheckoutEnabled,
    checklistSettings.checkinEnabled, checklistSettings.checkoutEnabled,
    checklistSettings.checkinItems, checklistSettings.checkoutItems,
    checklistSettings.checkinPhotoRequirements, checklistSettings.checkoutPhotoRequirements,
    checklistSettings.checkinInstructions, checklistSettings.checkoutInstructions,
  ]) : null;
  let persistedTrackingDismissed = false;
  if (trackingDismissalKey && trackingSignature) {
    try {
      const storage = trackingEnabled ? window.localStorage : window.sessionStorage;
      persistedTrackingDismissed = isTrackingPromptDismissed(storage, trackingDismissalKey, trackingSignature, Math.max(Date.now(), dismissalCheckedAt));
    } catch { /* Private browsing can disable storage. */ }
  }
  const trackingDismissed = Boolean(persistedTrackingDismissed || (trackingDismissalKey && trackingSignature
    && sessionTrackingDismissal?.key === trackingDismissalKey && sessionTrackingDismissal.signature === trackingSignature
    && Date.now() - sessionTrackingDismissal.dismissedAt < TRACKING_PROMPT_DISMISS_MS));
  useEffect(() => {
    if (!trackingDismissalKey || !trackingSignature) return;
    if (trackingConfigured || !trackingDismissed) {
      try { window.localStorage.removeItem(trackingDismissalKey); } catch { /* Storage may be unavailable. */ }
      try { window.sessionStorage.removeItem(trackingDismissalKey); } catch { /* Storage may be unavailable. */ }
    }
    if (trackingConfigured || !trackingDismissed) {
      setSessionTrackingDismissal((current) => current?.key === trackingDismissalKey ? null : current);
    }
  }, [trackingConfigured, trackingDismissalKey, trackingSignature, trackingDismissed, dismissalCheckedAt]);
  const { data: tourSettings, isLoading: isLoadingTours, isError: toursError, refetch: refetchTours } = useQuery<ViewingSettingsResponse>({
    queryKey: [`/api/viewings/settings/${activeKitchenId}`],
    queryFn: () => apiGet(`/viewings/settings/${activeKitchenId}`),
    enabled: activeKitchenId != null,
    staleTime: 10000,
  });
  const toursEnabled = tourSettings?.settings?.isActive === true;
  const toursScheduled = tourSettings?.availability?.some((slot) => slot.isAvailable) === true;
  const { data: bookingHours, isLoading: bookingHoursLoading, isError: bookingHoursError, refetch: refetchBookingHours } = useQuery<WeeklyTourSource[]>({
    queryKey: ["/api/manager/availability", activeKitchenId],
    queryFn: () => apiGet(`/manager/availability/${activeKitchenId}`),
    enabled: activeKitchenId != null,
  });
  const hasSavedBookingHours = Array.isArray(bookingHours) && bookingHours.some((day) => day.isAvailable);
  const copiedTourHours = copyableTourHours(Array.isArray(bookingHours) ? bookingHours : [],
    tourSettings?.settings?.defaultDurationMinutes ?? 30,
    tourSettings?.settings?.bufferBeforeMinutes ?? 0,
    tourSettings?.settings?.bufferAfterMinutes ?? 15);
  const canCopyBookingHours = !toursScheduled && copiedTourHours.length > 0;
  useEffect(() => {
    if (tourInfoOpen && !bookingHoursLoading && !canCopyBookingHours) setTourSource("separate");
  }, [tourInfoOpen, bookingHoursLoading, canCopyBookingHours]);
  const setupTours = useMutation({
    mutationFn: ({ kitchenId, scheduleSource }: { kitchenId: number; scheduleSource: "booking" | "separate" }) =>
      apiPutWithMessage(`/viewings/setup/${kitchenId}`, { scheduleSource }),
    onSuccess: (result: ViewingSettingsResponse, { kitchenId }) => {
      queryClient.setQueryData([`/api/viewings/settings/${kitchenId}`], result);
      void queryClient.invalidateQueries({ queryKey: [`/api/viewings/kitchen/${kitchenId}/is-active`] });
      void queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness", kitchenId] });
      setTourInfoOpen(false);
      handleSectionChange("tours");
    },
    onError: (error: Error, { kitchenId }) => {
      void queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${kitchenId}`] });
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });
  const requestPolicySave = useCallback(() => new Promise<boolean>((resolve) => {
    if (policySaveResolver.current) { resolve(false); return; }
    policySaveResolver.current = resolve;
    setPolicyScope(kitchens.length > 1 ? "kitchen" : "location");
    setPolicyScopeOpen(true);
  }), [kitchens.length]);
  const closePolicyScope = () => {
    if (policyScopeSaving) return;
    setPolicyScopeOpen(false);
    policySaveResolver.current?.(false);
    policySaveResolver.current = null;
  };
  const confirmPolicyScope = async () => {
    if (policyScopeSaving) return;
    setPolicyScopeSaving(true);
    const saved = (await policiesRef.current?.saveAllChanges(kitchens.length > 1 ? policyScope : "location")) ?? false;
    setPolicyScopeSaving(false);
    if (!saved) return;
    setPolicyScopeOpen(false);
    policySaveResolver.current?.(true);
    policySaveResolver.current = null;
  };
  const toggleTours = useMutation({
    mutationFn: ({ kitchenId, isActive }: { kitchenId: number; isActive: boolean }) =>
      apiPut(`/viewings/settings/${kitchenId}`, { isActive }),
    onSuccess: (settings, { kitchenId }) => {
      // The request's kitchen owns the response, even if the manager switched kitchens meanwhile.
      queryClient.setQueryData<ViewingSettingsResponse>([`/api/viewings/settings/${kitchenId}`], (old) => ({
        settings, availability: old?.availability ?? [], blackouts: old?.blackouts ?? [],
      }));
      void queryClient.invalidateQueries({ queryKey: [`/api/viewings/kitchen/${kitchenId}/is-active`] });
      void queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness", kitchenId] });
    },
    onError: (error: Error) => toast({ title: mt("error"), description: error.message, variant: "destructive" }),
  });

  /*
   * The create form takes the CONTENT slot — that is the whole point of it not being a modal. Two
   * ways in, one screen: the visible "Add Kitchen" action beside the selector, or the empty state's action. It replaces
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
    !showingCreateForm && ((activeSection === DEFAULT_KITCHEN_SECTION && detailsDirty)
      || (activeSection === "availability" && availabilityDirty)
      || (activeSection === "tours" && toursDirty)
      || (activeSection === "policies" && policiesDirty)
      || (activeSection === "storage" && storagePenaltyDirty));

  useEffect(() => {
    setSelectedKitchenId((current) => {
      if (initialKitchenId !== appliedInitialKitchenId.current && kitchens.some((kitchen) => kitchen.id === initialKitchenId)) {
        appliedInitialKitchenId.current = initialKitchenId;
        return initialKitchenId!;
      }
      return kitchens.some((kitchen) => kitchen.id === current) ? current : kitchens[0]?.id ?? null;
    });
  }, [kitchens, initialKitchenId]);

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
    const saved = activeSection === "availability"
      ? (await availabilityRef.current?.saveAllChanges()) ?? true
      : activeSection === "tours"
      ? (await toursRef.current?.saveChanges()) ?? true
      : activeSection === "policies"
      ? await requestPolicySave()
      : activeSection === "storage"
      ? (await storagePenaltyRef.current?.saveAllChanges()) ?? true
      : (await detailsRef.current?.saveAllChanges()) ?? true;
    if (!saved) throw new Error("save-failed");
  }, [activeSection, requestPolicySave]);

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
    // The scope choice is itself a dialog. Close this confirmation before it opens.
    if (activeSection === "policies") setPendingNav(null);
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
    if (activeSection !== "tours" || tourSettings === undefined || toursEnabled || toursDirty) return;
    // Disabled legacy links lead to the control that enables tours, rather than an empty tab.
    setActiveSection("availability");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "kitchens");
    url.searchParams.set("section", "availability");
    url.searchParams.delete("tab");
    window.history.replaceState({}, "", url);
  }, [activeSection, tourSettings, toursEnabled, toursDirty]);

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
    <div className="w-full min-w-0 max-w-full space-y-6">
      <ChefPageHeader
        title={mt("navSpaces")}
        description={mt("myKitchensDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={onConfigureRequirements}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" />{mt("navApplicationRequirements")}
            </Button>
            {!showingCreateForm && activeKitchen?.listingStatus === "active" && activeKitchen.isActive && shareableKitchen && <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={async () => {
              try {
                const url = chefKitchenShareUrl(kitchenPreviewHref(shareableKitchen.locationSlug, shareableKitchen.kitchen), window.location, i18n.language);
                const result = await shareKitchenLink(url, shareableKitchen.kitchen.name);
                if (result === "copied") toast({ title: mt("kitchenLinkCopied") });
              } catch {
                toast({ title: mt("kitchenShareFailed"), variant: "destructive" });
              }
            }}><Copy className="mr-1.5 h-4 w-4" />{mt("shareKitchen")}</Button>}

            {/* Page-level save. Rendered only while something is unsaved, so the
                header stays quiet at rest — the same convention as Booking Policies. */}
            {activeSection === "policies" && kitchensDirty ? (
              <Button disabled={policyScopeSaving || policyScopeOpen} onClick={() => void requestPolicySave()}>{mt("saveChanges")}</Button>
            ) : showSaveAction && (
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
        <div className="space-y-6" role="status" aria-label="Loading kitchens" aria-busy="true">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="flex gap-6 border-b pb-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-5 w-20" />)}</div>
          <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div>
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
              <KitchenIcon className="h-6 w-6 text-muted-foreground" />
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

          <Tabs value={activeSection} onValueChange={handleSectionChange} className="w-full min-w-0">
            <TabsList className="mb-6 h-auto w-full min-w-0 max-w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
              <TabsTrigger value="details" className={TAB_TRIGGER}>
                <KitchenIcon className={TAB_ICON} />{mt("details")} &amp; {mt("navPricing")}
              </TabsTrigger>
              <TabsTrigger value="photos" className={TAB_TRIGGER}>
                <Images className={TAB_ICON} />{mt("photos")}
              </TabsTrigger>
              <TabsTrigger value="availability" className={TAB_TRIGGER}>
                <Clock className={TAB_ICON} />{mt("navAvailability")}
              </TabsTrigger>
              <TabsTrigger value="policies" className={TAB_TRIGGER}>
                <ClipboardCheck className={TAB_ICON} />{mt("navBookingRules")}
              </TabsTrigger>
              <TabsTrigger value="storage" className={TAB_TRIGGER}>
                <Package className={TAB_ICON} />{mt("navStorage")}
              </TabsTrigger>
              <TabsTrigger value="equipment" className={TAB_TRIGGER}>
                <Wrench className={TAB_ICON} />{mt("navEquipment")}
              </TabsTrigger>
              {toursEnabled && <TabsTrigger value="tours" className={TAB_TRIGGER}>
                <KitchenTour className={TAB_ICON} />{mt("kitchenTours")}
              </TabsTrigger>}
            </TabsList>

            <TabsContent value="details" className="mt-0 space-y-4">
              {activeKitchenId && workspaceSettings && checklistSettings && !trackingConfigured && !trackingDismissed &&
                <Card className="overflow-hidden border-l-[3px] border-l-primary/80 shadow-[0_8px_24px_-18px_hsl(var(--primary)/0.5)]"><CardContent className="relative flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_8px_18px_-12px_hsl(var(--primary)/0.8)]"><ClipboardCheck className="size-5" /></span>
                    <div><p className="font-semibold tracking-tight">{mt("trackingSetupTitle")}</p><p className="text-sm text-muted-foreground">{mt("trackingSetupDescription")}</p></div></div>
                  <div className="flex gap-2"><Button size="sm" onClick={() => {
                    const target = document.getElementById("tracking-settings");
                    target?.scrollIntoView({ behavior: "smooth", block: "center" });
                    target?.focus({ preventScroll: true });
                    setHighlightTracking(true);
                    if (highlightTimer.current) clearTimeout(highlightTimer.current);
                    highlightTimer.current = setTimeout(() => setHighlightTracking(false), 3000);
                   }}>{mt("setUpChecklist")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      if (!trackingDismissalKey || !trackingSignature) return;
                      setSessionTrackingDismissal({ key: trackingDismissalKey, signature: trackingSignature, dismissedAt: Date.now() });
                      try { saveTrackingPromptDismissal(trackingEnabled ? window.localStorage : window.sessionStorage, trackingDismissalKey, trackingSignature); }
                      catch { /* Still dismissed for this visit if storage is blocked. */ }
                    }}>{mt("dismiss")}</Button></div>
                </CardContent></Card>}
              {activeKitchen && (
                <KitchenDetailsPricing
                  ref={detailsRef}
                  locationId={location.id}
                  locationName={location.name}
                  kitchen={activeKitchen}
                  highlightTracking={highlightTracking}
                  onConfigureTracking={() => onNavigate("settings-checkin-checkout", activeKitchen.id)}
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
              <StorageListingContent key={`${location.id}-${activeKitchenId}`} selectedLocationId={location.id} selectedKitchenId={activeKitchenId} onPenaltyDirtyChange={setStoragePenaltyDirty} penaltySaveRef={storagePenaltyRef} onConfigureInspections={() => onNavigate("settings-storage-checkin-checkout", activeKitchenId ?? undefined)} onListingsChanged={() => void queryClient.invalidateQueries({ queryKey: ["managerWorkspaceNavigation"] })} />
            </TabsContent>

            <TabsContent value="availability" className="mt-0 space-y-4">
              {isLoadingTours ? <Skeleton className="h-20" /> : toursError ?
                <Button variant="outline" onClick={() => refetchTours()}>{mt("retry")}</Button> :
                hasSavedBookingHours && (!toursEnabled || !toursScheduled) && <Card className="overflow-hidden border-l-[3px] border-l-primary/80 shadow-[0_8px_24px_-18px_hsl(var(--primary)/0.5)]"><CardContent className="relative flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_8px_18px_-12px_hsl(var(--primary)/0.8)]"><KitchenTour className="size-5" /></span>
                    <div><p className="font-semibold tracking-tight">{mt("tourSetupTitle")}</p><p className="text-sm text-muted-foreground">{mt("tourSetupDescription")}</p></div></div>
                  <Button size="sm" onClick={() => { setTourSource("booking"); setTourInfoOpen(true); }}>{mt("learnHowToursWork")}</Button>
                </CardContent></Card>}
              {activeKitchenId && <KitchenAvailabilityManagement
                key={activeKitchenId}
                ref={availabilityRef}
                embedded
                initialLocationId={location.id}
                initialKitchenId={activeKitchenId}
                hideWeeklyScheduleSaveButton
                onDirtyChange={setAvailabilityDirty}
              />}
            </TabsContent>
            <TabsContent value="tours" className="mt-0 space-y-4">
              {activeKitchenId && <Card><CardContent className="p-0"><SettingsRow id="kitchen-tours-enabled" label={mt("kitchenTours")} hint={mt("tourEnabledHint")}>
                <Switch id="kitchen-tours-enabled" checked={toursEnabled} disabled={toggleTours.isPending}
                  onCheckedChange={(isActive) => toggleTours.mutate({ kitchenId: activeKitchenId, isActive })} />
              </SettingsRow></CardContent></Card>}
              {isLoadingTours && <AvailabilitySkeleton />}
              {toursError && <Button variant="outline" onClick={() => refetchTours()}>{mt("retry")}</Button>}
              {activeKitchenId && (toursEnabled || toursDirty) && <ViewingSettingsPanel key={activeKitchenId} ref={toursRef} kitchenId={activeKitchenId} facilityKitchenCount={kitchens.length}
                kitchenName={activeKitchen?.name} onDirtyChange={setToursDirty} hideSaveActions />}
            </TabsContent>
            <TabsContent value="policies" className="mt-0">
              {activeKitchenId && <KitchenWorkspaceControls key={activeKitchenId} kitchenId={activeKitchenId} location={location}
                mode="policies" showTerms onDirtyChange={setPoliciesDirty} saveRef={policiesRef} />}
            </TabsContent>

            <TabsContent value="equipment" className="mt-0">
              <EquipmentListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>

          </Tabs>
          <Dialog open={tourInfoOpen} onOpenChange={setTourInfoOpen}>
            <DialogContent showCloseButton className="gap-0 overflow-hidden rounded-[1.25rem] border-border/70 p-0 shadow-[0_28px_90px_-35px_rgba(15,23,42,0.45)] sm:max-w-[32rem]">
              <div className="flex items-start gap-3.5 px-5 pb-4 pt-6 sm:px-6"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_10px_25px_-16px_hsl(var(--primary)/0.9)]"><KitchenTour className="size-5" /></span>
                <DialogHeader className="space-y-1 pr-5 text-left"><DialogTitle className="text-xl leading-tight tracking-tight">{mt("tourSetupTitle")}</DialogTitle>
                  <DialogDescription className="leading-5">{mt("tourSetupModalDescription")}</DialogDescription></DialogHeader></div>
              <div className="space-y-2 px-5 pb-5 sm:px-6">
                {!toursScheduled && <div className="grid gap-2" role="radiogroup" aria-label={mt("tourSetupScheduleChoice")}>
                  {bookingHoursLoading ? <Skeleton className="h-20" /> : bookingHoursError ?
                    <Button variant="outline" onClick={() => void refetchBookingHours()}>{mt("retry")}</Button> : canCopyBookingHours &&
                    <label className={`group relative flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-[border-color,box-shadow] hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 ${tourSource === "booking" ? "border-primary/75 shadow-[0_8px_24px_-20px_hsl(var(--primary)/0.8)]" : "border-border"}`}>
                      <input type="radio" name="tour-source" checked={tourSource === "booking"} onChange={() => setTourSource("booking")} className="sr-only" />
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="size-4.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{mt("tourUseBookingHours")}</span>
                        <span className="block text-xs leading-5 text-muted-foreground">{mt("tourUseBookingHoursDetail", { count: copiedTourHours.length })}</span></span>
                      <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${tourSource === "booking" ? "border-primary bg-primary text-white" : "border-muted-foreground/35"}`}>{tourSource === "booking" && <CheckCircle className="size-3.5" />}</span>
                    </label>}
                  <label className={`group relative flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-[border-color,box-shadow] hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 ${tourSource === "separate" || !canCopyBookingHours ? "border-primary/75 shadow-[0_8px_24px_-20px_hsl(var(--primary)/0.8)]" : "border-border"}`}>
                    <input type="radio" name="tour-source" checked={tourSource === "separate" || !canCopyBookingHours} onChange={() => setTourSource("separate")} className="sr-only" />
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Clock className="size-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{mt("tourSetSeparateHours")}</span>
                      <span className="block text-xs leading-5 text-muted-foreground">{mt("tourSetSeparateHoursDetail")}</span></span>
                    <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${tourSource === "separate" || !canCopyBookingHours ? "border-primary bg-primary text-white" : "border-muted-foreground/35"}`}>{(tourSource === "separate" || !canCopyBookingHours) && <CheckCircle className="size-3.5" />}</span>
                  </label>
                </div>}
                {toursScheduled && <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">{mt("tourExistingHoursNote")}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4 sm:px-6"><Button variant="ghost" onClick={() => setTourInfoOpen(false)}>{mt("cancel")}</Button>
                <Button disabled={setupTours.isPending || bookingHoursLoading || activeKitchenId == null} onClick={() => {
                  if (activeKitchenId == null) return;
                  if (toursEnabled && (toursScheduled || tourSource === "separate")) { setTourInfoOpen(false); handleSectionChange("tours"); return; }
                  setupTours.mutate({ kitchenId: activeKitchenId, scheduleSource: canCopyBookingHours ? tourSource : "separate" });
                }}>{setupTours.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}{toursEnabled && (toursScheduled || tourSource === "separate") ? mt("goToTourSettings") : mt("enableAndSetUpTours")}</Button></div>
            </DialogContent>
          </Dialog>
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
      <Dialog open={policyScopeOpen} onOpenChange={(open) => !open && closePolicyScope()}>
        <DialogContent className="gap-0 overflow-hidden rounded-[1.25rem] border-border/70 p-0 shadow-[0_28px_90px_-35px_rgba(15,23,42,0.45)] sm:max-w-[32rem]">
          <div className="flex items-start gap-3.5 px-5 pb-4 pt-6 sm:px-6"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_10px_25px_-16px_hsl(var(--primary)/0.9)]"><ClipboardCheck className="size-5" /></span>
            <DialogHeader className="space-y-1 pr-5 text-left"><DialogTitle className="text-xl leading-tight tracking-tight">{mt("policySaveScopeTitle")}</DialogTitle>
              <DialogDescription className="leading-5">{mt(kitchens.length > 1 ? "policySaveScopeDescription" : "policySaveSingleKitchenDescription")}</DialogDescription></DialogHeader></div>
          <div className="grid gap-2 px-5 pb-5 sm:px-6" role={kitchens.length > 1 ? "radiogroup" : undefined} aria-label={kitchens.length > 1 ? mt("policySaveScopeTitle") : undefined}>
            {kitchens.length > 1 ? (["kitchen", "location"] as const).map((scope) => <label key={scope} className={`group relative flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-[border-color,box-shadow] hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 ${policyScope === scope ? "border-primary/75 shadow-[0_8px_24px_-20px_hsl(var(--primary)/0.8)]" : "border-border"}`}>
              <input type="radio" name="policy-scope" checked={policyScope === scope} onChange={() => setPolicyScope(scope)} className="sr-only" />
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${scope === "kitchen" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{scope === "kitchen" ? <KitchenIcon className="size-4.5" /> : <Building className="size-4.5" />}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{mt(scope === "kitchen" ? "policySaveThisKitchen" : "policySaveAllKitchens", { count: kitchens.length })}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{mt(scope === "kitchen" ? "policySaveThisKitchenDetail" : "policySaveAllKitchensDetail")}</span></span>
              <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${policyScope === scope ? "border-primary bg-primary text-white" : "border-muted-foreground/35"}`}>{policyScope === scope && <CheckCircle className="size-3.5" />}</span>
            </label>) : <div className="flex min-h-[72px] items-center gap-3 rounded-xl border border-primary/50 px-3.5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building className="size-4.5" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{mt("policySaveLocation")}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{mt("policySaveSingleKitchenDetail")}</span></span>
              <CheckCircle className="size-5 text-primary" />
            </div>}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4 sm:px-6"><Button variant="ghost" disabled={policyScopeSaving} onClick={closePolicyScope}>{mt("cancel")}</Button>
            <Button disabled={policyScopeSaving} onClick={() => void confirmPolicyScope()}>{policyScopeSaving && <Loader2 className="mr-2 size-4 animate-spin" />}{mt(kitchens.length === 1 ? "policySaveLocation" : policyScope === "kitchen" ? "policySaveThisKitchen" : "policySaveAllKitchens", { count: kitchens.length })}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
