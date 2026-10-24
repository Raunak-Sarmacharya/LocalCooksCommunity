import { StorageIcon as Package, EquipmentIcon as Wrench } from "@/components/ui/inventory-icons";
import { mt } from "@/i18n/manager";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";
import type { StorageInstructionsHandle } from "@/components/manager/settings/StorageTrackingSetup";
import i18n from "@/i18n";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect, useCallback, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiPutWithMessage } from "@/lib/api";
import { kitchenListingReadinessKey, kitchenSummariesKey } from "@/lib/manager-kitchens-navigation";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AvailabilitySkeleton } from "@/components/manager/AvailabilitySkeleton";
import { Plus, Loader2, Clock, ClipboardCheck, KitchenTour, CalendarClock, Building, CheckCircle, ChevronLeft, ChevronRight } from "@/components/ui/manager-icons";
import { KitchenIcon } from "@/components/ui/kitchen-icon";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { ChefPageHeader } from "@/components/chef/ui";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import KitchenDetailsPricing, { type KitchenDetailsPricingHandle } from "./KitchenDetailsPricing";
import { KitchenEditorHeader } from "./KitchenEditorHeader";
import { KitchenCards, EMPTY_FACTS, type KitchenFacts } from "./KitchenCards";
import { KitchenSectionNav, sectionLabel } from "./KitchenSectionNav";
import KitchenPhotos from "./KitchenPhotos";
import { KitchenSetupForm } from "./KitchenSetupForm";
import { DEFAULT_KITCHEN_SECTION, kitchenSectionFromParams, type KitchenSection, type KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import { KITCHEN_SECTION_GROUPS, sectionSummary } from "@/lib/kitchen-sections";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";
import { cn } from "@/lib/utils";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from "@/pages/KitchenAvailabilityManagement";
import KitchenWorkspaceControls from "./KitchenWorkspaceControls";
import CheckinCheckoutSettings, { type CheckinCheckoutHandle } from "./CheckinCheckoutSettings";
import type { KitchenWorkspaceSettings } from "./KitchenWorkspaceControls";
import type { KitchenPoliciesHandle, PolicySaveScope } from "./KitchenWorkspaceControls";
import ViewingSettingsPanel, { type ViewingSettingsPanelHandle, type ViewingSettingsResponse } from "@/components/manager/ViewingSettingsPanel";
import { copyableTourHours, type WeeklyTourSource } from "@shared/tour-schedule";
import { tourReadiness } from '@shared/tour-readiness';
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
  onReturnToTour?: (tourId: number) => void;
}

export interface KitchensHandle {
  /** Persist pending edits across every card. Resolves `true` when all succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

/** Quiet header link. `ghost` skips the chef CTA surface, but its own hover is
 *  `bg-accent`, which is pure white in both themes — hence the `bg-muted` override. */
const HEADER_LINK = "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

export default function KitchensManagement({ location, onNavigate, onConfigureRequirements, onDirtyChange, saveRef, initialKitchenId, onReturnToTour }: KitchensManagementProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(initialKitchenId ?? null);
  const appliedInitialKitchenId = useRef<number>();
  const [activeSection, setActiveSection] = useState<KitchenSection>(getInitialKitchenSection);
  const returnTourId = Number(new URLSearchParams(window.location.search).get('returnTour'));
  // Several kitchens and no kitchen or section asked for: open on the kitchen cards, like Airbnb's Listings.
  const [browsing, setBrowsing] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return initialKitchenId == null && !params.has('kit') && !params.has('section');
  });
  // Phones show the section list first; a link that names a section opens straight on it.
  const [mobileList, setMobileList] = useState(() => !new URLSearchParams(window.location.search).has('section'));

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
  const [tourSetupSection, setTourSetupSection] = useState<{ kitchenId: number; section: 'weekly' | 'instructions' }>();
  const [tourInfoOpen, setTourInfoOpen] = useState(false);
  const [tourSource, setTourSource] = useState<"booking" | "separate">("booking");
  const [policiesDirty, setPoliciesDirty] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const arrivalRef = useRef<CheckinCheckoutHandle>(null);
  const [arrivalDirty, setArrivalDirty] = useState(false);
  const [storageDirty, setStorageDirty] = useState(false);
  const storageRef = useRef<StorageInstructionsHandle>(null);
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
  const showIndex = browsing && kitchens.length > 1;
  const activeKitchen = showIndex ? null : selectedKitchen ?? kitchens[0] ?? null;
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
  // One checklist drives the section marks, the header's List button and the cards, so they can't disagree.
  const { data: review } = useQuery<KitchenReadinessReview>({
    queryKey: kitchenListingReadinessKey(activeKitchenId ?? 0),
    queryFn: () => apiGet(`/manager/kitchens/${activeKitchenId}/listing-readiness`),
    enabled: activeKitchenId != null,
    refetchOnMount: "always",
  });
  const cardReviews = useQueries({
    queries: (showIndex ? kitchens : []).map(kitchen => ({
      queryKey: kitchenListingReadinessKey(kitchen.id),
      queryFn: (): Promise<KitchenReadinessReview> => apiGet(`/manager/kitchens/${kitchen.id}/listing-readiness`),
    })),
  });
  const { data: summaries } = useQuery<{ timezone: string; kitchens: KitchenFacts[] }>({
    queryKey: kitchenSummariesKey(location.id),
    queryFn: () => apiGet(`/manager/locations/${location.id}/kitchen-summaries`),
    enabled: kitchens.length > 0,
    staleTime: 30_000,
  });
  const factsFor = (kitchenId: number) => Array.isArray(summaries?.kitchens) ? summaries.kitchens.find(row => row.kitchenId === kitchenId) ?? EMPTY_FACTS(kitchenId) : undefined;
  // Old links now open the instructions tab instead of a removed switch.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!activeKitchenId || url.searchParams.get('focus') !== 'tracking') return;
    const requestedKitchen = url.searchParams.get('kit');
    if (requestedKitchen && Number(requestedKitchen) !== activeKitchenId) return;
    url.searchParams.delete('focus');
    url.searchParams.set('section', 'arrival-departure');
    setActiveSection('arrival-departure');
    window.history.replaceState({}, '', url);
  }, [activeKitchenId]);
  const { data: tourSettings, isLoading: isLoadingTours, isError: toursError, refetch: refetchTours } = useQuery<ViewingSettingsResponse>({
    queryKey: [`/api/viewings/settings/${activeKitchenId}`],
    queryFn: () => apiGet(`/viewings/settings/${activeKitchenId}`),
    enabled: activeKitchenId != null,
    staleTime: 10000,
  });
  const toursEnabled = tourSettings?.settings?.isActive === true;
  const toursScheduled = tourSettings?.availability?.some((slot) => slot.isAvailable) === true;
  const tourSetupReadiness = tourReadiness(tourSettings?.settings, tourSettings?.availability ?? []);
  const toursReady = tourSetupReadiness.ready;
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
      void queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/api/viewings/manager') });
      setTourInfoOpen(false);
      setTourSetupSection({ kitchenId, section: tourReadiness(result.settings, result.availability).schedule ? 'instructions' : 'weekly' });
      handleSectionChange("tours");
    },
    onError: (error: Error, { kitchenId }) => {
      void queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${kitchenId}`] });
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });
  const requestPolicySave = useCallback(() => new Promise<boolean>((resolve) => {
    if (policySaveResolver.current) { resolve(false); return; }
    // One kitchen: the rules can only apply to this location, so there is nothing to choose.
    if (kitchens.length <= 1) {
      void (async () => {
        setPolicyScopeSaving(true);
        const saved = (await policiesRef.current?.saveAllChanges("location")) ?? false;
        setPolicyScopeSaving(false);
        if (saved) toast({ title: mt("bookingRulesSavedToast") });
        resolve(saved);
      })();
      return;
    }
    policySaveResolver.current = resolve;
    setPolicyScope(kitchens.length > 1 ? "kitchen" : "location");
    setPolicyScopeOpen(true);
  }), [kitchens.length, toast]);
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
    toast({ title: mt("bookingRulesSavedToast") });
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
        settings, availability: old?.availability ?? [], blackouts: old?.blackouts ?? [], timezone: old?.timezone,
      }));
      void queryClient.invalidateQueries({ queryKey: [`/api/viewings/kitchen/${kitchenId}/is-active`] });
      void queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness", kitchenId] });
      void queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/api/viewings/manager') });
      toast({ title: mt('tourPausedToast') });
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
      || (activeSection === "arrival-departure" && arrivalDirty)
      || (activeSection === "storage" && storageDirty));

  useEffect(() => {
    const applyInitial = initialKitchenId !== appliedInitialKitchenId.current && kitchens.some((kitchen) => kitchen.id === initialKitchenId);
    if (applyInitial) {
      appliedInitialKitchenId.current = initialKitchenId;
      setBrowsing(false);
    }
    setSelectedKitchenId((current) => applyInitial ? initialKitchenId!
      : kitchens.some((kitchen) => kitchen.id === current) ? current : kitchens[0]?.id ?? null);
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

  // A new screen (cards, a kitchen, a phone section) starts at its top, not where the last one was scrolled.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
  }, [showIndex, activeKitchenId, mobileList, activeSection]);

  // Browser Back from a kitchen opened off the cards returns to the cards. The shell has already
  // asked about unsaved edits before this runs.
  useEffect(() => {
    const backToCards = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") === "kitchens" && !params.has("kit") && !params.has("section")) { setBrowsing(true); setMobileList(true); }
    };
    window.addEventListener("popstate", backToCards);
    return () => window.removeEventListener("popstate", backToCards);
  }, []);

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
      ? (await storageRef.current?.save()) ?? true
      : activeSection === "arrival-departure"
      ? (await arrivalRef.current?.save()) ?? true
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

  useEffect(() => {
    const syncSectionFromUrl = (event: PopStateEvent) => {
      const url = new URL(window.location.href);
      // The shell guards view, location and kitchen changes. This guard owns section changes.
      if (url.searchParams.get("view") !== "kitchens"
        || (url.searchParams.has("kit") && Number(url.searchParams.get("kit")) !== activeKitchenId)
        || (url.searchParams.has("locationId") && Number(url.searchParams.get("locationId")) !== location.id)) return;
      const section = kitchenSectionFromParams(url.searchParams);
      if (section === activeSection) return;
      if (!kitchensDirty || event.state?.managerKitchenNavigationApproved) { setActiveSection(section); return; }
      const destination = url.toString();
      if (activeSection === DEFAULT_KITCHEN_SECTION) url.searchParams.delete("section");
      else url.searchParams.set("section", activeSection);
      window.history.replaceState(window.history.state, "", url);
      setPendingNav(() => () => {
        window.history.replaceState(window.history.state, "", destination);
        setActiveSection(section);
      });
    };
    window.addEventListener('popstate', syncSectionFromUrl);
    return () => window.removeEventListener('popstate', syncSectionFromUrl);
  }, [activeSection, activeKitchenId, location.id, kitchensDirty]);

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

  const applySection = (nextSection: KitchenSection, focus?: "tracking") => {
    setActiveSection(nextSection);
    const url = new URL(window.location.href);
    if (focus) url.searchParams.set('focus', focus);
    url.searchParams.set('view', 'kitchens');
    if (activeKitchenId) url.searchParams.set('kit', String(activeKitchenId));
    url.searchParams.set('locationId', String(location.id));
    if (nextSection === DEFAULT_KITCHEN_SECTION) url.searchParams.delete('section');
    else url.searchParams.set('section', nextSection);
    window.history.replaceState({}, '', url);
    // Extras change outside the readiness checklist; refresh the counts the section list shows.
    void queryClient.invalidateQueries({ queryKey: kitchenSummariesKey(location.id) });
  };
  const handleSectionChange = (section: string, focus?: "tracking") => guardNavigation(() => applySection(section as KitchenSection, focus));
  // From the section list: on a phone this also opens the section full-screen.
  const openSection = (section: KitchenSection) => guardNavigation(() => { if (section !== activeSection) applySection(section); setMobileList(false); });
  const backToSections = () => guardNavigation(() => {
    setMobileList(true);
    applySection(DEFAULT_KITCHEN_SECTION);
  });

  /** Open one kitchen from the cards. Pushed, so the browser's Back returns to the cards. */
  const openKitchen = (kitchenId: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('kit', String(kitchenId));
    url.searchParams.delete('section');
    window.history.pushState({}, '', url);
    setSelectedKitchenId(kitchenId);
    setActiveSection(DEFAULT_KITCHEN_SECTION);
    setMobileList(true);
    setBrowsing(false);
  };
  const backToKitchens = () => guardNavigation(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('kit');
    url.searchParams.delete('section');
    window.history.pushState({}, '', url);
    setActiveSection(DEFAULT_KITCHEN_SECTION);
    setMobileList(true);
    setBrowsing(true);
  });

  const shareKitchen = shareableKitchen && activeKitchen?.listingStatus === "active" && activeKitchen.isActive ? async () => {
    try {
      const url = chefKitchenShareUrl(kitchenPreviewHref(shareableKitchen.locationSlug, shareableKitchen.kitchen), window.location, i18n.language);
      const result = await shareKitchenLink(url, shareableKitchen.kitchen.name);
      if (result === "copied") toast({ title: mt("kitchenLinkCopied") });
    } catch {
      toast({ title: mt("kitchenShareFailed"), variant: "destructive" });
    }
  } : undefined;
  const viewListing = shareKitchen && shareableKitchen ? () => {
    window.open(chefKitchenShareUrl(kitchenPreviewHref(shareableKitchen.locationSlug, shareableKitchen.kitchen), window.location, i18n.language), "_blank", "noopener");
  } : undefined;

  const sectionInputs = {
    review,
    bookingHours: Array.isArray(bookingHours) ? bookingHours : undefined,
    extras: activeKitchenId != null ? factsFor(activeKitchenId) : undefined,
    tours: tourSettings ? { enabled: toursEnabled, ready: toursReady, scheduled: toursScheduled } : undefined,
    locale: i18n.language || "en-CA",
  };
  const summariesBySection = Object.fromEntries(KITCHEN_SECTION_GROUPS.flatMap(group => group.sections)
    .map(section => [section, sectionSummary(section, sectionInputs)])) as Record<KitchenSection, ReturnType<typeof sectionSummary>>;

  /* Page-level save. Rendered only while something is unsaved, so the header stays quiet at rest.
     Booking policies is the exception: each of its sections owns its one save. */
  const saveButton = activeSection === "policies" || !showSaveAction ? null : (
    <StatusButton status={saveAction.status} onClick={saveAction.execute}
      labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }} />
  );

  const pageHeader = (
    <ChefPageHeader
      title={mt("navSpaces")}
      description={mt("myKitchensDescription")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={onConfigureRequirements}>
            <ClipboardCheck className="mr-1.5 h-4 w-4" />{mt("navApplicationRequirements")}
          </Button>
          {showIndex && !showingCreateForm && <Button size="sm" onClick={openCreateKitchen}><Plus className="mr-1.5 h-4 w-4" />{mt("addKitchen")}</Button>}
        </div>
      }
    />
  );

  return (
    <div ref={rootRef} className="w-full min-w-0 max-w-full scroll-mt-4 space-y-6">
      {/*
        * Loading; the create form (it takes the page's slot rather than sitting over it); no kitchens yet;
        * the kitchen cards (several kitchens); or one kitchen's editor.
        */}
      {isLoadingKitchens ? (
        <div className="space-y-6" role="status" aria-label="Loading kitchens" aria-busy="true">
          <div className="flex items-center gap-4"><Skeleton className="h-[4.5rem] w-24 rounded-2xl" /><div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-40" /></div></div>
          <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="space-y-2">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-12 rounded-xl" />)}</div>
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </div>
      ) : showingCreateForm ? (
        <>
          {pageHeader}
          <KitchenSetupForm
            locationId={location.id}
            onCancel={closeCreateKitchen}
            onCreated={async (kitchenId) => {
              // Open the new kitchen once the list has it, so the editor lands on what was just made.
              await queryClient.refetchQueries({ queryKey: ['managerKitchens', location.id] });
              closeCreateKitchen();
              if (kitchenId) openKitchen(kitchenId);
            }}
          />
        </>
      ) : kitchens.length === 0 ? (
        <>
          {pageHeader}
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
        </>
      ) : showIndex ? (
        <>
          {pageHeader}
          <KitchenCards
            kitchens={kitchens}
            locationName={location.name}
            reviews={Object.fromEntries(kitchens.map((kitchen, index) => [kitchen.id, cardReviews[index]?.data]))}
            facts={Object.fromEntries(kitchens.map(kitchen => [kitchen.id, factsFor(kitchen.id)]))}
            timezone={summaries?.timezone}
            onOpen={openKitchen}
            onAdd={openCreateKitchen}
          />
        </>
      ) : activeKitchen && (
        <>
          <KitchenEditorHeader
            kitchen={activeKitchen}
            locationId={location.id}
            locationName={location.name}
            review={review}
            facts={factsFor(activeKitchen.id)}
            timezone={summaries?.timezone}
            onAllKitchens={kitchens.length > 1 ? backToKitchens : undefined}
            onList={() => onNavigate("listing-review", activeKitchen.id)}
            onAddKitchen={openCreateKitchen}
            onOpenRequests={() => onNavigate("bookings")}
            onShare={shareKitchen}
            onViewListing={viewListing}
            saveAction={saveButton}
          />

          {/* Vertical tabs: the section list on the left, the open section on the right. On a phone the
              list is the first screen and a section opens full-screen with a way back. */}
          <Tabs value={activeSection} onValueChange={value => openSection(value as KitchenSection)} orientation="vertical"
            className="grid w-full min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
            <KitchenSectionNav
              className={cn("lg:sticky lg:top-4 lg:block", mobileList ? "block" : "hidden")}
              summaries={summariesBySection}
              review={review}
              locationName={location.name}
              onNavigate={view => onNavigate(view)}
              onSelect={openSection}
            />
            <div className={cn("min-w-0 lg:block", mobileList ? "hidden" : "block")}>
              <div className="mb-4 flex items-center gap-2 lg:hidden">
                <Button variant="ghost" size="sm" className="-ml-2 !min-h-0 h-9 rounded-full px-2" onClick={backToSections}>
                  <ChevronLeft className="mr-0.5 size-5" />{mt("ksAllSections")}
                </Button>
                <h2 className="ml-auto truncate text-base font-semibold">{sectionLabel(activeSection)}</h2>
              </div>

            <TabsContent value="details" className="mt-0 space-y-4">
              {activeKitchen && (
                <KitchenDetailsPricing
                  ref={detailsRef}
                  locationId={location.id}
                  locationName={location.name}
                  kitchen={activeKitchen}
                  onDirtyChange={setDetailsDirty}
                />
              )}
            </TabsContent>

            <TabsContent value="arrival-departure" className="mt-0 space-y-4">
              {activeKitchen && <>
                <p className="text-sm text-muted-foreground">{mt("kitchenArrivalDepartureScope", { location: location.name })}</p>
                <CheckinCheckoutSettings
                  // A draft never follows the manager to another kitchen or scope.
                  key={`${location.id}-${activeKitchen.id}`}
                  mode="instructions"
                  location={location}
                  kitchenContext={{ id: activeKitchen.id, name: activeKitchen.name }}
                  saveRef={arrivalRef}
                  onDirtyChange={setArrivalDirty}
                  onOpenTasks={() => onNavigate("settings-checkin-checkout", activeKitchen.id)}
                  onNavigate={() => handleSectionChange("policies")}
                />
              </>}
            </TabsContent>

            <TabsContent value="photos" className="mt-0">
              {activeKitchen && (
                <KitchenPhotos locationId={location.id} kitchen={activeKitchen} />
              )}
            </TabsContent>

            <TabsContent value="storage" className="mt-0 space-y-4">
              <StorageListingContent key={`${location.id}-${activeKitchenId}`} selectedLocationId={location.id} selectedKitchenId={activeKitchenId} onConfigureInspections={() => onNavigate("settings-storage-checkin-checkout", activeKitchenId ?? undefined)} onListingsChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ["managerWorkspaceNavigation"] });
                void queryClient.invalidateQueries({ queryKey: kitchenSummariesKey(location.id) });
              }}
                onInstructionsDirtyChange={setStorageDirty} instructionsSaveRef={storageRef} />
              {/* Set up here, run on the Storage page (Airbnb's editor vs Reservations; Food Corridor's settings vs clients). */}
              {(factsFor(activeKitchen.id)?.storage.total ?? 0) > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{mt("ksStorageRentalsNote")}</span>
                  <button type="button" onClick={() => onNavigate("storage-bookings")} className="!min-h-0 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {mt("ksOpenStorageRentals")}<ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="availability" className="mt-0 space-y-4">
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
              {isLoadingTours && <AvailabilitySkeleton />}
              {toursError && <Button variant="outline" onClick={() => refetchTours()}>{mt("retry")}</Button>}
              {/* Tours were never set up: say what they are, and start with the schedule choice. */}
              {!isLoadingTours && !toursError && !toursScheduled && !toursEnabled && (
                <Card className="overflow-hidden"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex min-w-0 items-center gap-3.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><KitchenTour className="size-5" /></span>
                    <div className="min-w-0"><p className="font-semibold tracking-tight">{mt("ksToursSetUpTitle")}</p><p className="max-w-prose text-sm text-muted-foreground">{mt("ksToursSetUpBody")}</p></div></div>
                  <Button size="sm" onClick={() => { setTourSource("booking"); setTourInfoOpen(true); }}>{mt("ksToursSetUpAction")}</Button>
                </CardContent></Card>
              )}
              {activeKitchenId && !isLoadingTours && !toursError && <ViewingSettingsPanel key={activeKitchenId} ref={toursRef} kitchenId={activeKitchenId} facilityKitchenCount={kitchens.length}
                onReturnToTour={Number.isSafeInteger(returnTourId) && returnTourId > 0 && onReturnToTour ? () => guardNavigation(() => onReturnToTour(returnTourId)) : undefined}
                onPrepareSchedule={!toursScheduled && hasSavedBookingHours ? () => { setTourSource('booking'); setTourInfoOpen(true); } : undefined}
                onPauseTours={() => toggleTours.mutate({ kitchenId: activeKitchenId, isActive: false })}
                initialSection={tourSetupSection?.kitchenId === activeKitchenId ? tourSetupSection.section : undefined}
                disabled={toggleTours.isPending}
                kitchenIsListed={activeKitchen?.listingStatus === 'active' && activeKitchen.isActive}
                kitchenName={activeKitchen?.name} onDirtyChange={setToursDirty} hideSaveActions />}
            </TabsContent>
            <TabsContent value="policies" className="mt-0">
              {activeKitchenId && <KitchenWorkspaceControls key={activeKitchenId} kitchenId={activeKitchenId} location={location}
                mode="policies" showTerms onDirtyChange={setPoliciesDirty} saveRef={policiesRef}
                kitchenCount={kitchens.length}
                onEditLocation={() => navigateNotificationHref(`/manager/dashboard?view=settings&tab=booking&locationId=${location.id}`)}
                onRequestSave={() => { if (!policyScopeSaving && !policyScopeOpen) void requestPolicySave(); }} />}
            </TabsContent>

            <TabsContent value="equipment" className="mt-0">
              <EquipmentListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>
            </div>
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
                <p className="text-xs leading-5 text-muted-foreground">{mt('tourSetupVisibilityNote')}</p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4 sm:px-6"><Button variant="ghost" onClick={() => setTourInfoOpen(false)}>{mt("cancel")}</Button>
                <Button disabled={setupTours.isPending || bookingHoursLoading || activeKitchenId == null} onClick={() => {
                  if (activeKitchenId == null) return;
                  if (toursScheduled) { setTourInfoOpen(false); handleSectionChange("tours"); return; }
                  setupTours.mutate({ kitchenId: activeKitchenId, scheduleSource: canCopyBookingHours ? tourSource : "separate" });
                }}>{setupTours.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}{mt("enableAndSetUpTours")}</Button></div>
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
