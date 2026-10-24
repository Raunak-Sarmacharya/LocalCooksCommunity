import { StorageIcon as Package } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, Settings, Check, Save, AlertCircle, FileText, ChevronRight, Info, Mail, Upload, Image as ImageIcon, Globe, CheckCircle, Plus, Loader2, HelpCircle, Trash2, KitchenTour } from "@/components/ui/manager-icons";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { useLocation, useSearch } from "wouter";
import 'react-calendar/dist/Calendar.css';
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useOnboardingStatus, invalidateOnboardingStatus, SETUP_STEP_WIZARD_STEP } from "@/hooks/use-onboarding-status";
import {
  useManagerGettingStarted,
  invalidateGettingStarted,
} from "@/hooks/use-manager-getting-started";
import type { GettingStartedItemId } from "@/lib/manager-getting-started";
import { toast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from "./KitchenAvailabilityManagement";
import ManagerBookingsPanel from "./ManagerBookingsPanel";
import ManagerStorageBookingsPage from "./ManagerStorageBookingsPage";
import ViewingsDashboard from "@/components/manager/ViewingsDashboard";
import { ManagerKitchenApplicationsContent } from "./ManagerKitchenApplications";
import KitchenDashboardOverview from "@/components/dashboard/KitchenDashboardOverview";
import { CustomersList } from "@/components/manager/customers/CustomersList";
import { DamageClaimQueue } from "@/components/manager/damage-claims/DamageClaimQueue";
import ManagerRevenueDashboard from "./ManagerRevenueDashboard";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import { LicenseSettings, BookingRulesSettings, LocationSettings, KitchensManagement, KitchenListingReview, FacilityDocsSettings, CheckinCheckoutSettings, StorageCheckinCheckoutSettings } from "@/components/manager/settings";
import type { BookingPoliciesHandle, CheckinCheckoutHandle, KitchensHandle } from "@/components/manager/settings";
// The one screen for "no location yet". Nine settings views used to carry their own version of it,
// each saying a location was needed without offering any way to make one.
import { NeedsKitchen, NeedsLocation } from "@/components/manager/locations/NeedsPrerequisite";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import DashboardLayout from "@/layouts/DashboardLayout";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { FormLegend } from "@/components/ui/form-legend";
import ManagerProfileSettings from "@/components/manager/ManagerProfileSettings";
import { useManagerOnboarding } from "@/components/manager/onboarding/ManagerOnboardingContext";
import { OnboardingStatusBanner } from "@/components/manager/OnboardingStatusBanner";
import { getManagerImprovementDestination } from "@/lib/manager-guidance";
import NotificationCenter from "@/components/manager/NotificationCenter";
import { legacyKitchenSection, resolveDestination, type KitchenSection, type ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";
import { ChefPageHeader } from "@/components/chef/ui";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import LocationWorkspace, { type LocationWorkspaceHandle } from "@/components/manager/settings/LocationWorkspace";
import { legacyLocationSection } from "@/lib/manager-location-navigation";
import { DateField } from "@/components/ui/date-field";
import { SessionExtensionRequests } from "@/components/manager/SessionExtensionRequests";

// Helper component for authenticated document links
function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a 
      href={presignedUrl || url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

interface Location {
  id: number;
  name: string;
  address: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number | null;
  notificationEmail?: string;
  notificationPhone?: string;
  minimumBookingWindowHours?: number;
  maxAdvanceBookingDays?: number;
  turnoverBufferEnabled?: boolean;
  bookingBufferMinutes?: number;
  allowMultiDayBookings?: boolean;
  maxBookingDays?: number;
  maxBookingDaysCap?: number;
  maxAdvanceBookingDaysCap?: number;
  logoUrl?: string;
  timezone?: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
  kitchenLicenseExpiry?: string;
  kitchenLicenseUploadedAt?: string;
  kitchenLicensePendingUrl?: string;
  kitchenLicensePendingSubmittedAt?: string;
  kitchenLicenseCurrentUrl?: string;
  kitchenLicensePreviousUrl?: string;
  kitchenTermsUrl?: string;
  kitchenTermsUploadedAt?: string;
  customOnboardingLink?: string;
}

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  locationId: number;
  isActive: boolean;
}


async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;

    if (currentUser?.uid) {
      // Get fresh Firebase token
      try {
        const token = await currentUser.getIdToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }
      } catch (tokenError) {
        logger.error('Failed to get Firebase token:', tokenError);
      }
    }

    // Fallback to localStorage if Firebase auth not ready
    const storedToken = localStorage.getItem('firebaseToken');
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  } catch (error) {
    logger.error('Error getting auth headers:', error);
    // Fallback to localStorage
    const storedToken = localStorage.getItem('firebaseToken');
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  }

  return headers;
}


type KitchenNavigationDestination = { view: ViewType; kitchenId?: number; section?: KitchenSection; focus?: "tracking" | "tour-notes"; returnTourId?: number; historyUrl?: string };

type ViewType = 'my-locations' | 'overview' | 'bookings' | 'storage-bookings' | 'viewings' | 'availability' | 'tour-availability' | 'settings' | 'applications' | 'customers' | 'pricing' | 'storage-listings' | 'equipment-listings' | 'payments' | 'security' | 'revenue' | 'messages' | 'profile' | 'kitchens' | 'listing-review' | 'settings-license' | 'settings-booking-rules' | 'settings-facility-docs' | 'settings-location' | 'settings-checkin-checkout' | 'settings-storage-checkin-checkout' | 'application-requirements' | 'notifications' | 'notification-settings' | 'damage-claims' | 'support' | 'location';


export default function ManagerBookingDashboard() {
  const { t: st } = useTranslation("storage");
  
  const queryClient = useQueryClient();
  const [currentPath, setLocation] = useLocation();
  const currentSearch = useSearch();
  const routeTourId = /^\/manager\/tours\/([^/]+)$/.exec(currentPath)?.[1];
  const detailTourId = routeTourId || new URLSearchParams(currentSearch).get('viewing');
  const tourNavigationGuard = useRef<((navigate: () => void) => boolean) | null>(null);
  const { locations, isLoadingLocations, isErrorLocations, kitchens: managerKitchens, isLoadingKitchens, isErrorKitchens, bookings: managerBookings } = useManagerDashboard();
  const { startNewLocation } = useManagerOnboarding();
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [reviewedApplicationName, setReviewedApplicationName] = useState<string | null>(null);
  const showApplicationsListRef = useRef<() => void>(() => {});

  // Tab state - check URL params first, then default to 'overview'
  const [activeView, setActiveView] = useState<ViewType>(() => {
    if (routeTourId) return 'viewings';
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const validViews: ViewType[] = ['my-locations', 'overview', 'bookings', 'storage-bookings', 'viewings', 'availability', 'tour-availability', 'settings', 'applications', 'customers', 'pricing', 'storage-listings', 'equipment-listings', 'payments', 'revenue', 'messages', 'profile', 'kitchens', 'listing-review', 'settings-license', 'settings-booking-rules', 'settings-facility-docs', 'settings-location', 'settings-checkin-checkout', 'settings-storage-checkin-checkout', 'application-requirements', 'notifications', 'notification-settings', 'damage-claims', 'support', 'location'];
    // Older location views (Kitchen License, Facility documents, the old Settings page, Profile › Location) open Location.
    if (legacyLocationSection(view, params.get('tab'))) return 'location';
    if (view === 'settings' && params.get('tab') === 'requirements') return 'application-requirements';
    // Back-compat: redirect legacy 'settings-storage-checkout' URLs to the new combined page.
    if (view === 'my-locations') return 'profile';
    if (view === 'settings-storage-checkout') {
      return 'settings-storage-checkin-checkout';
    }
    if (legacyKitchenSection(view, params.get("tab"))) {
      return 'kitchens';
    }
    if (view && validViews.includes(view as ViewType)) {
      return view as ViewType;
    }
    return 'overview';
  });
  /**
   * The kitchen the publish review is for.
   *
   * Carried EXPLICITLY from the card that opens it, not read out of the URL. An earlier version read
   * `window.location.search`, and that was wrong twice over: the app's URLs differ between
   * environments, and `ManagerPageLayout` writes `kit` with `history.replaceState`, which never
   * notifies wouter, so the router's idea of the URL and `window.location` can disagree.
   *
   * The URL is kept only as a FALLBACK, so a reload while the review is open still resolves a
   * kitchen rather than falling back to "no kitchen selected".
   */
  const [reviewKitchenId, setReviewKitchenId] = useState<number | null>(null);
  const kitchenForReview =
    reviewKitchenId ??
    (() => {
      const raw = new URLSearchParams(window.location.search).get("kit");
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();

  const availabilityRef = useRef<KitchenAvailabilityManagementHandle>(null);
  const bypassAvailabilityGuard = useRef(false);
  const [availabilityDirty, setAvailabilityDirty] = useState(false);
  const [pendingAvailabilityView, setPendingAvailabilityView] = useState<ViewType | null>(null);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const bookingPoliciesRef = useRef<BookingPoliciesHandle>(null);
  const bypassBookingPoliciesGuard = useRef(false);
  const [bookingPoliciesDirty, setBookingPoliciesDirty] = useState(false);
  const [pendingBookingPoliciesView, setPendingBookingPoliciesView] = useState<ViewType | null>(null);
  const kitchensSaveRef = useRef<KitchensHandle>(null);
  // Location page: the same unsaved-changes guard as My Kitchens.
  const locationSaveRef = useRef<LocationWorkspaceHandle | null>(null);
  const bypassLocationGuard = useRef(false);
  const [locationDirty, setLocationDirty] = useState(false);
  const [pendingLocationView, setPendingLocationView] = useState<ViewType | null>(null);
  const [pendingLocationHistory, setPendingLocationHistory] = useState<string | null>(null);
  const bypassKitchensGuard = useRef(false);
  const [kitchensDirty, setKitchensDirty] = useState(false);
  const [pendingKitchensView, setPendingKitchensView] = useState<KitchenNavigationDestination | null>(null);
  const checkinCheckoutRef = useRef<CheckinCheckoutHandle>(null);
  const storageChecklistRef = useRef<{ saveAllChanges: () => Promise<boolean> }>(null);
  const bypassCheckinCheckoutGuard = useRef(false);
  const [checkinCheckoutDirty, setCheckinCheckoutDirty] = useState(false);
  const [pendingCheckinCheckoutView, setPendingCheckinCheckoutView] = useState<KitchenNavigationDestination | null>(null);
  const requirementsRef = useRef<ApplicationRequirementsWizardHandle>(null);
  const bypassRequirementsGuard = useRef(false);
  const [requirementsDirty, setRequirementsDirty] = useState(false);
  const [pendingRequirementsView, setPendingRequirementsView] = useState<ViewType | null>(null);

  // Handle locationId from URL for direct navigation (e.g., returning from setup, notification links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locationIdFromUrl = params.get('locationId');
    if (locationIdFromUrl && !selectedLocation && locations.length > 0) {
      const locationId = parseInt(locationIdFromUrl, 10);
      const foundLocation = locations.find((l: Location) => l.id === locationId);
      if (foundLocation) {
        setSelectedLocation(foundLocation);
      }
      if (params.get('view') === 'kitchens' || params.get('view') === 'settings-checkin-checkout') return;
      // Clean up URL param after use — it's a one-time signal, not persistent state
      params.delete('locationId');
      const remaining = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : ''));
    }
  }, [locations, selectedLocation]);


  // Check onboarding status using Firebase auth
  const { user: firebaseUser } = useFirebaseAuth();
  const { data: workspaceNavigation, isLoading: workspaceNavigationLoading, isError: workspaceNavigationError } = useQuery<{
    showBookings: boolean;
    showTours?: boolean;
    toursNeedingAction?: number;
    showStorageBookings: boolean;
    showApplications: boolean;
    showRevenue: boolean;
    hasRevenueHistory: boolean;
  }>({
    queryKey: ["managerWorkspaceNavigation", firebaseUser?.uid],
    queryFn: async () => {
      const response = await fetch("/api/manager/workspace-navigation", { headers: await getAuthHeaders() });
      if (!response.ok) throw new Error("Failed to load workspace navigation");
      return response.json();
    },
    enabled: !!firebaseUser,
    staleTime: 0,
  });

  // A running server may still return the older navigation response during a client update.
  // Check applications directly in that case so neither a new account nor a manager with
  // past applicants gets the wrong sidebar state.
  const legacyApplications = useQuery<unknown[]>({
    queryKey: ["managerLegacyApplicationVisibility", firebaseUser?.uid],
    queryFn: async () => {
      const response = await fetch("/api/manager/kitchen-applications", { headers: await getAuthHeaders() });
      if (!response.ok) throw new Error("Failed to load application visibility");
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!firebaseUser && !!workspaceNavigation && workspaceNavigation.showApplications === undefined,
    staleTime: 5 * 60_000,
  });

  const { data: userData } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) return null;
        return response.json();
      } catch (error) {
        logger.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
  });

  // Get manager ID from userData
  const managerId = userData?.id || null;

  // [REF] Use new hook for consolidated status
  const {
    isLoading: isLoadingOnboardingStatus,
    showSetupBanner,
    showLicenseReviewBanner,
    isReadyForBookings,
    missingSteps,
    improvementSteps,
    setupSteps,
    // For the publish review's empty state: a manager who has a kitchen but no review target
    // needs different words from one who has no kitchen at all.
    hasKitchens,
  } = useOnboardingStatus(selectedLocation?.id);

  /**
   * What a view that needs a kitchen should show instead, when the prerequisites are not there.
   *
   * Two levels, in the order they are needed: a location first, then a kitchen inside it. Views
   * rendered with only a location id used to fall through to their own copy — "select a location and
   * kitchen from the sidebar" — which named an action the sidebar cannot perform.
   *
   * Returns null when both are present, so a caller reads as
   * `kitchenPrerequisite ?? <the real view>`.
   */
  // Still loading (or about to pick the first location) is not "no location": a placeholder, never the add-location screen.
  const locationPending = isLoadingLocations || (locations.length > 0 && !selectedLocation);
  const needsLocation = locationPending ? <SettingsContentSkeleton /> : <NeedsLocation />;
  const kitchenPrerequisite = !selectedLocation ? needsLocation
  : isLoadingOnboardingStatus ? <SettingsContentSkeleton />
  : !hasKitchens ? (
    //  because this branch only runs when there is none.
    <NeedsKitchen hasKitchen={false} onGoToKitchens={() => handleViewChange('kitchens')} />
  ) : null;

  // Sync activeView with URL parameters. Listens to popstate so back/forward
  // through the pushed tab history correctly updates the active view.
  const [deepLinkTourId, setDeepLinkTourId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('tour'));
  const [deepLinkConversationId, setDeepLinkConversationId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("conversation")
  );
  const acceptedHistoryUrl = useRef(window.location.href);
  const historyGuard = useRef<() => boolean>(() => true);
  historyGuard.current = () => {
    if (window.location.href === acceptedHistoryUrl.current) return true;
    const destination = { view: activeView, historyUrl: window.location.href };
    if (activeView === 'kitchens' && kitchensDirty && !bypassKitchensGuard.current) {
      setPendingKitchensView(destination);
    } else if (activeView === 'settings-checkin-checkout' && checkinCheckoutDirty && !bypassCheckinCheckoutGuard.current) {
      setPendingCheckinCheckoutView(destination);
    } else if (activeView === 'location' && locationDirty && !bypassLocationGuard.current) {
      setPendingLocationHistory(destination.historyUrl);
    } else return true;
    // Keep the draft's URL/context while the existing leave confirmation is open.
    window.history.replaceState(window.history.state, '', acceptedHistoryUrl.current);
    return false;
  };

  useEffect(() => {
    const handleLocationChange = () => {
      if (!historyGuard.current()) return;
      if (/^\/manager\/tours\/[^/]+$/.test(window.location.pathname)) { setActiveView('viewings'); return; }
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      const kitchenId = Number(params.get('kit'));
      setReviewKitchenId(Number.isSafeInteger(kitchenId) && kitchenId > 0 ? kitchenId : null);
      const location = locations.find(location => location.id === Number(params.get('locationId')));
      if (location) setSelectedLocation(location);
      setDeepLinkConversationId(params.get("conversation"));
      setDeepLinkTourId(params.get("tour"));
      const validViews: ViewType[] = ['my-locations', 'overview', 'bookings', 'storage-bookings', 'viewings', 'availability', 'tour-availability', 'settings', 'applications', 'customers', 'pricing', 'storage-listings', 'equipment-listings', 'payments', 'revenue', 'messages', 'profile', 'kitchens', 'listing-review', 'settings-license', 'settings-booking-rules', 'settings-facility-docs', 'settings-location', 'settings-checkin-checkout', 'settings-storage-checkin-checkout', 'application-requirements', 'notifications', 'notification-settings', 'damage-claims', 'support', 'location'];
      const locationSection = legacyLocationSection(view, params.get('tab'));
      if (locationSection) {
        params.set('view', 'location');
        params.set('section', locationSection);
        params.delete('tab');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        setActiveView('location');
        return;
      }
      if (view === 'settings' && params.get('tab') === 'requirements') {
        params.set('view', 'application-requirements');
        params.delete('tab');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        setActiveView('application-requirements');
        return;
      }
      // Back-compat: redirect legacy URL to the new combined page.
      if (view === 'my-locations') {
        params.set('view', 'profile');
        params.set('tab', 'location');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        setActiveView('profile');
        return;
      }
      if (view === 'settings-storage-checkout') {
        setActiveView('settings-storage-checkin-checkout');
        return;
      }
      const legacySection = legacyKitchenSection(view, params.get("tab"));
      if (legacySection) {
        params.set('view', 'kitchens');
        params.set('section', legacySection);
        params.delete('tab');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        setActiveView('kitchens');
        return;
      }
      if (view && validViews.includes(view as ViewType)) {
        setActiveView(view as ViewType);
      } else if (!view) {
        // No ?view param — bare /manager/booking-dashboard URL. Snap back
        // to the overview so back-button traversal stays in sync.
        setActiveView('overview');
      }
    };

    // Check on mount and when URL might have changed externally
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [currentPath, locations]);

  // Section changes within My Kitchens use replaceState; remember those too.
  useEffect(() => { acceptedHistoryUrl.current = window.location.href; });

  // Centralised tab-change handler. Pushes the new view into browser history
  // so the back button walks through the user's tab journey instead of always
  // returning to whatever tab was last viewed before opening a sub-page.
  const handleViewChange = (view: ViewType, kitchenId?: number, section?: KitchenSection, focus?: 'tracking' | 'tour-notes', returnTourId?: number) => {
    if (activeView === 'viewings' && tourNavigationGuard.current?.(() => handleViewChange(view, kitchenId, section, focus, returnTourId)) === false) return;
    void queryClient.invalidateQueries({ queryKey: ["managerWorkspaceNavigation"] });
    // Remember which kitchen a task view belongs to. Held in state rather than the URL so opening
    // the publish review never depends on the URL shape, which differs between environments.
    /*
     * `resolveDestination` turns both spellings of a Kitchens-tab destination — an explicit
     * `section`, and a legacy view alias — into the one shape `KitchensManagement` reads. A request
     * that names only `"kitchens"` resolves to no section, i.e. "whatever tab the URL already held".
     */
    const targetSection = resolveDestination(view, section).section;
    const locationSection = view === 'location' ? null : legacyLocationSection(view, null);
    const profileTab =
      view === 'payments' ? 'payments'
      : view === 'notification-settings' ? 'notifications'
      // "Sign-in & security" — where Google, phone and password are rows, and the only page that
      // can complete the Getting Started backup-sign-in row.
      : view === 'security' ? 'account'
      : null;
    const availabilityTab = view === 'tour-availability' ? 'tours' : null;
    const nextView = targetSection
      ? 'kitchens'
      : availabilityTab
        ? 'tour-availability'
        : profileTab
          ? 'profile'
          : view;
    const isSameDestination = nextView === activeView && !availabilityTab && !profileTab && !targetSection && !kitchenId
      && !(nextView === 'viewings' && detailTourId);
    if (isSameDestination) return;
    if ((activeView === 'availability' || activeView === 'tour-availability') && availabilityDirty && !bypassAvailabilityGuard.current) {
      setPendingAvailabilityView(view);
      return;
    }
    if (activeView === 'settings-booking-rules' && bookingPoliciesDirty && !bypassBookingPoliciesGuard.current) {
      setPendingBookingPoliciesView(view);
      return;
    }
    if (activeView === 'kitchens' && kitchensDirty && !bypassKitchensGuard.current) {
      setPendingKitchensView({ view, kitchenId, section, focus, returnTourId });
      return;
    }
    if (activeView === 'location' && locationDirty && !bypassLocationGuard.current) {
      setPendingLocationView(view);
      return;
    }
    if ((activeView === 'settings-checkin-checkout' || activeView === 'settings-storage-checkin-checkout') && checkinCheckoutDirty && !bypassCheckinCheckoutGuard.current) {
      setPendingCheckinCheckoutView({ view, kitchenId, section, focus, returnTourId });
      return;
    }
    if (activeView === 'application-requirements' && requirementsDirty && !bypassRequirementsGuard.current) {
      setPendingRequirementsView(view);
      return;
    }
    // After every guard: an older location view name opens its Location section.
    if (locationSection) { navigateToLocation(locationSection); return; }
    // A manager completes onboarding steps from the pages the sidebar links to — upload the
    // license, add a kitchen, set availability, connect Stripe — and none of that remounts
    // `useOnboardingStatus`, so `refetchOnMount` alone would never notice. Re-reading here
    // covers every one of those surfaces from a single place, rather than relying on each
    // step's own save handler to remember (which is where the coverage was patchy: the
    // profile and location keys were invalidated, the kitchens / availability /
    // requirements keys were not).
    invalidateOnboardingStatus(queryClient);
    // Same reason, for the Getting Started list: its rows complete on the pages the sidebar links
    // to, and returning to a page does not remount the widget that shows them.
    invalidateGettingStarted(queryClient);

    if (kitchenId) setReviewKitchenId(kitchenId);
    // My Kitchens with no kitchen named opens on the kitchen cards (several kitchens) or the only kitchen.
    else if (nextView === 'kitchens' && !targetSection) setReviewKitchenId(null);
    setActiveView(nextView);
    const url = new URL(window.location.href);
    if (/^\/manager\/tours\//.test(url.pathname)) url.pathname = '/manager/dashboard';
    if (focus === 'tracking' && nextView === 'kitchens' && targetSection === 'details') url.searchParams.set('focus', 'tracking');
    else if (focus === 'tour-notes' && nextView === 'kitchens' && targetSection === 'tours') url.searchParams.set('focus', 'tour-notes');
    else url.searchParams.delete('focus');
    if (focus === 'tour-notes' && returnTourId) url.searchParams.set('returnTour', String(returnTourId));
    else url.searchParams.delete('returnTour');
    if (kitchenId && (nextView === "kitchens" || nextView === "listing-review" || nextView === "settings-storage-checkin-checkout" || nextView === "settings-checkin-checkout")) {
      url.searchParams.set("kit", String(kitchenId));
    } else if (nextView === 'kitchens' && !targetSection) {
      url.searchParams.delete('kit');
    } else if (nextView !== "kitchens" && nextView !== "listing-review" && nextView !== "settings-storage-checkin-checkout" && nextView !== "settings-checkin-checkout") {
      url.searchParams.delete("kit");
    }
    if (selectedLocation && (nextView === 'kitchens' || nextView === 'settings-checkin-checkout')) url.searchParams.set('locationId', String(selectedLocation.id));
    if (nextView !== 'applications') url.searchParams.delete('application');
    // The Customers list keeps its filters in the URL; they must not leak onto other views.
    if (activeView === 'customers' && nextView !== 'customers') for (const key of ['status', 'q', 'sort', 'pages', 'location']) url.searchParams.delete(key);
    url.searchParams.delete('viewing');
    if (nextView !== 'damage-claims') url.searchParams.delete('claim');
    if (nextView !== 'storage-bookings') url.searchParams.delete('storageBooking');
    if (targetSection) {
      url.searchParams.set('view', 'kitchens');
      url.searchParams.set('section', targetSection);
      url.searchParams.delete('tab');
    } else if (nextView === 'overview') {
      url.searchParams.delete('view');
      url.searchParams.delete('section');
    } else {
      url.searchParams.set('view', nextView);
      if (profileTab) url.searchParams.set('tab', profileTab);
      else if (availabilityTab) url.searchParams.set('tab', availabilityTab);
      else if (nextView !== 'profile') url.searchParams.delete('tab');
      if (nextView !== 'kitchens' && nextView !== 'location') url.searchParams.delete('section');
      // Opening Location from elsewhere starts on Details; a section only carries over within Location.
      if (nextView === 'location' && activeView !== 'location') url.searchParams.delete('section');
    }
    const nextUrl = url.toString();
    if (nextUrl !== window.location.href) {
      window.history.pushState({}, '', nextUrl);
    }

    /*
     * Tell the URL-backed children the URL moved.
     *
     * `history.pushState` does NOT fire `popstate` — that is the spec, not a quirk — so a component
     * that reads its state from the query string ONCE at mount never hears about a change made while
     * it stays mounted. That was the reported bug: "Offer equipment add-ons" / "Offer storage add-ons"
     * / "Add more photos" landed on the wrong tab from My Kitchens, but worked from Revenue. From
     * Revenue the Kitchens page MOUNTS and reads `?section=`; already on it, the page kept whatever
     * section it was on because nothing re-read the URL.
     *
     * `KitchensManagement` already subscribes to `popstate` for exactly this reason (as does the
     * shell's own URL→view sync below), so dispatching it is the established channel here — not a
     * new one. Doing it at this single navigation entry point means every URL-backed child gets it,
     * rather than each caller remembering to notify the page it happens to be standing on.
     *
     * Safe to fire unconditionally: listeners only re-read the URL, and the URL is already the one
     * we just wrote, so a listener cannot loop back into a navigation.
     */
    acceptedHistoryUrl.current = window.location.href;
    window.dispatchEvent(new PopStateEvent("popstate", { state: { managerKitchenNavigationApproved: true } }));
  };

  const continueToDestination = (destination: KitchenNavigationDestination) => {
    if (!destination.historyUrl) {
      handleViewChange(destination.view, destination.kitchenId, destination.section, destination.focus, destination.returnTourId);
      return;
    }
    acceptedHistoryUrl.current = destination.historyUrl;
    window.history.replaceState(window.history.state, '', destination.historyUrl);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { managerKitchenNavigationApproved: true } }));
  };

  const handleManagerLocationChange = (location: Location) => {
    if (location.id === selectedLocation?.id) return;
    if (activeView !== 'kitchens' && activeView !== 'settings-checkin-checkout') {
      setSelectedLocation(location);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('locationId', String(location.id));
    url.searchParams.delete('kit');
    const destination = { view: activeView, historyUrl: url.toString() };
    if (activeView === 'kitchens' && kitchensDirty) setPendingKitchensView(destination);
    else if (activeView === 'settings-checkin-checkout' && checkinCheckoutDirty) setPendingCheckinCheckoutView(destination);
    else continueToDestination(destination);
  };

  const continueFromAvailability = (view: ViewType) => {
    bypassAvailabilityGuard.current = true;
    setAvailabilityDirty(false);
    setPendingAvailabilityView(null);
    handleViewChange(view);
    bypassAvailabilityGuard.current = false;
  };

  const saveAndLeaveAvailability = async () => {
    if (!pendingAvailabilityView) return;
    setIsSavingBeforeLeave(true);
    const saved = await availabilityRef.current?.saveAllChanges();
    setIsSavingBeforeLeave(false);
    if (saved) continueFromAvailability(pendingAvailabilityView);
  };

  const continueFromBookingPolicies = (view: ViewType) => {
    bypassBookingPoliciesGuard.current = true;
    setBookingPoliciesDirty(false);
    setPendingBookingPoliciesView(null);
    handleViewChange(view);
    bypassBookingPoliciesGuard.current = false;
  };

  const saveAndLeaveBookingPolicies = async () => {
    if (!pendingBookingPoliciesView) return;
    setIsSavingBeforeLeave(true);
    const saved = await bookingPoliciesRef.current?.saveAllChanges();
    setIsSavingBeforeLeave(false);
    if (saved) continueFromBookingPolicies(pendingBookingPoliciesView);
  };

  /** Open a Location section (pushes history like other views; children re-read ?section on popstate). */
  const navigateToLocation = (locationSection: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'location');
    url.searchParams.set('section', locationSection);
    for (const key of ['tab', 'kit', 'focus', 'returnTour', 'application', 'claim', 'storageBooking', 'viewing']) url.searchParams.delete(key);
    if (url.toString() !== window.location.href) window.history.pushState({}, '', url.toString());
    acceptedHistoryUrl.current = window.location.href;
    setActiveView('location');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const continueFromLocation = () => {
    const view = pendingLocationView, historyUrl = pendingLocationHistory;
    bypassLocationGuard.current = true;
    setLocationDirty(false);
    setPendingLocationView(null);
    setPendingLocationHistory(null);
    if (view) handleViewChange(view);
    else if (historyUrl) { window.history.pushState({}, '', historyUrl); window.dispatchEvent(new PopStateEvent('popstate')); }
    bypassLocationGuard.current = false;
  };

  const saveAndLeaveLocation = async () => {
    setIsSavingBeforeLeave(true);
    const saved = await locationSaveRef.current?.saveAllChanges();
    setIsSavingBeforeLeave(false);
    if (saved) continueFromLocation();
  };

  const continueFromKitchens = (destination: KitchenNavigationDestination) => {
    bypassKitchensGuard.current = true;
    setKitchensDirty(false);
    setPendingKitchensView(null);
    continueToDestination(destination);
    bypassKitchensGuard.current = false;
  };

  const saveAndLeaveKitchens = async () => {
    const destination = pendingKitchensView;
    if (!destination) return;
    // My Kitchens may ask which kitchens a policy change should affect. Let its
    // scope dialog open cleanly, without stacking this unsaved-changes dialog.
    setPendingKitchensView(null);
    setIsSavingBeforeLeave(true);
    const saved = await kitchensSaveRef.current?.saveAllChanges();
    setIsSavingBeforeLeave(false);
    if (saved) continueFromKitchens(destination);
    else setPendingKitchensView(destination);
  };

  const continueFromCheckinCheckout = (destination: KitchenNavigationDestination) => {
    bypassCheckinCheckoutGuard.current = true;
    setCheckinCheckoutDirty(false);
    setPendingCheckinCheckoutView(null);
    continueToDestination(destination);
    bypassCheckinCheckoutGuard.current = false;
  };

  const saveAndLeaveCheckinCheckout = async () => {
    if (!pendingCheckinCheckoutView) return;
    setIsSavingBeforeLeave(true);
    if (activeView === 'settings-storage-checkin-checkout') {
      const saved = (await storageChecklistRef.current?.saveAllChanges()) ?? false;
      setIsSavingBeforeLeave(false);
      if (saved) continueFromCheckinCheckout(pendingCheckinCheckoutView);
      return;
    }
    const saved = (await checkinCheckoutRef.current?.save()) ?? false;
    setIsSavingBeforeLeave(false);
    if (saved) continueFromCheckinCheckout(pendingCheckinCheckoutView);
  };

  const continueFromRequirements = (view: ViewType) => {
    bypassRequirementsGuard.current = true;
    setRequirementsDirty(false);
    setPendingRequirementsView(null);
    handleViewChange(view);
    bypassRequirementsGuard.current = false;
  };

  /**
   * The requirements handle resolves `void` and *rejects* on failure, unlike the
   * `saveAllChanges(): Promise<boolean>` handles the other pages expose. Bridge
   * the two here rather than in the wizard, so the shared handle contract stays
   * in one shape and each page keeps its own semantics.
   */
  const saveAndLeaveRequirements = async () => {
    if (!pendingRequirementsView) return;
    setIsSavingBeforeLeave(true);
    let saved = false;
    try {
      await requirementsRef.current?.save();
      saved = true;
    } catch {
      saved = false;
    }
    setIsSavingBeforeLeave(false);
    if (saved) continueFromRequirements(pendingRequirementsView);
  };

  /*
   * The kitchen the Customer tasks page was opened from. Only one of the selected location's
   * kitchens counts: a stale or foreign `kit` is reported on the page instead of quietly
   * returning the manager to some other kitchen.
   */
  const setupKitchen = selectedLocation
    ? managerKitchens.find(kitchen => kitchen.id === kitchenForReview && kitchen.locationId === selectedLocation.id)
    : undefined;
  const setupKitchenMissing = kitchenForReview != null && !setupKitchen && !isLoadingKitchens && !isErrorKitchens;

  const kitchenChildLabel: Partial<Record<ViewType, string>> = {
    "tour-availability": mt("kitchenTours"),
    availability: mt("navAvailability"),
    "settings-booking-rules": mt("navBookingRules"),
    "settings-checkin-checkout": mt("setupUx.tasksStep"),
    // The publish review is a task reached from a kitchen, not a sidebar destination — the
    // breadcrumb is what tells the manager it belongs under My Kitchens.
    "listing-review": mt("listingReviewPageTitle"),
    "settings-storage-checkin-checkout": mt("navStorageCheckinCheckout"),
  };
  const applicationChildLabel: Partial<Record<ViewType, string>> = {
    "application-requirements": mt("navApplicationRequirements"),
  };
  const messageChildLabel: Partial<Record<ViewType, string>> = {};
  const storageChildLabel: Partial<Record<ViewType, string>> = {
  };
  const isKitchenChild = Boolean(kitchenChildLabel[activeView]);
  const isBookingChild = activeView === 'damage-claims';
  const isStorageChild = Boolean(storageChildLabel[activeView]);
  const isApplicationChild = Boolean(applicationChildLabel[activeView]);
  const isMessageChild = Boolean(messageChildLabel[activeView]);
  const shellActiveView = isKitchenChild ? 'kitchens' : isBookingChild ? 'bookings' : isStorageChild ? 'storage-bookings' : isApplicationChild ? 'applications' : isMessageChild ? 'messages' : activeView;
  const viewLabels: Record<ViewType, string> = {
    'my-locations': 'navMyLocations', overview: 'navDashboard', bookings: 'navBookings',
    'storage-bookings': 'navStorage', viewings: 'navViewings', availability: 'navAvailability',
    'tour-availability': 'kitchenTours', settings: 'navSettings', applications: 'navRequests', customers: 'navCustomers', pricing: 'navPricing',
    'storage-listings': 'navStorage', 'equipment-listings': 'navEquipment', payments: 'navPayments',
    security: 'navAccount', revenue: 'navRevenue', messages: 'navMessages', profile: 'shellProfile',
    kitchens: 'navSpaces', 'listing-review': 'listingReviewPageTitle', 'settings-license': 'kitchenLicense',
    'settings-booking-rules': 'navBookingRules', 'settings-facility-docs': 'facilityDocuments',
    'settings-location': 'navPropertySettings', 'settings-checkin-checkout': 'setupUx.tasksStep',
    'settings-storage-checkin-checkout': 'navStorageCheckinCheckout', 'application-requirements': 'navApplicationRequirements',
    notifications: 'navNotifications', 'notification-settings': 'navNotificationSettings',
    'damage-claims': 'navDamageClaims', support: 'navSupport', location: 'navLocation',
  };
  const breadcrumbs: ManagerBreadcrumb[] = activeView === 'viewings' && detailTourId
    ? [{ label: mt('navViewings'), navId: 'viewings', onClick: () => handleViewChange('viewings') }, { label: `TOUR-${detailTourId}` }]
    : activeView === 'applications' && reviewedApplicationName
    ? [
        { label: mt("navRequests"), navId: "applications", onClick: () => showApplicationsListRef.current() },
        { label: reviewedApplicationName },
      ]
    : activeView === 'kitchens'
    ? [{ label: mt("navSpaces"), navId: "kitchens" }]
    : isBookingChild
      ? [
          { label: mt("navBookings"), navId: "bookings", onClick: () => handleViewChange('bookings') },
          { label: mt("navDamageClaims"), navId: "damage-claims" },
        ]
    : isKitchenChild
      ? [
          { label: mt("navSpaces"), navId: "kitchens", onClick: () => handleViewChange('kitchens', activeView === 'settings-checkin-checkout' ? setupKitchen?.id : kitchenForReview ?? undefined, activeView === 'settings-checkin-checkout' ? (setupKitchen ? 'arrival-departure' : 'details') : undefined) },
          ...(activeView === 'settings-checkin-checkout' && setupKitchen ? [{ label: mt("navKitchenArrivalDeparture"), onClick: () => handleViewChange('kitchens', setupKitchen.id, 'arrival-departure') }] : []),
          ...(activeView === 'settings-storage-checkin-checkout' ? [{ label: mt("navStorage"), onClick: () => handleViewChange('kitchens', kitchenForReview ?? undefined, 'storage') }] : []),
          ...(activeView === 'tour-availability' ? [{ label: mt("navAvailability"), navId: "availability", onClick: () => handleViewChange('kitchens', kitchenForReview ?? undefined, 'availability') }] : []),
          { label: kitchenChildLabel[activeView]!, navId: activeView },
        ]
      : activeView === 'storage-bookings'
        ? [{ label: mt("navStorage"), navId: "storage-bookings" }]
        : isStorageChild
          ? [
              { label: mt("navStorage"), navId: "storage-bookings", onClick: () => handleViewChange('storage-bookings') },
              { label: storageChildLabel[activeView]!, navId: activeView },
            ]
          : isApplicationChild
            ? [
                { label: mt("navRequests"), navId: "applications", onClick: () => handleViewChange('applications') },
                { label: applicationChildLabel[activeView]!, navId: activeView },
              ]
            : isMessageChild
              ? [
                  { label: mt("navMessages"), navId: "messages", onClick: () => handleViewChange('messages') },
                  { label: messageChildLabel[activeView]!, navId: activeView },
                ]
          : [{ label: mt(viewLabels[activeView]), navId: activeView }];

  // Handle Stripe Connect Return
  useEffect(() => {
    const handleStripeReturn = async () => {
      // Check if we are on the return path
      if (window.location.pathname.includes('/manager/stripe-connect/return')) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('success') === 'true') {
          // Calls the backend to sync status with Stripe
          try {
            const { auth } = await import('@/lib/firebase');
            const token = await auth.currentUser?.getIdToken();
            if (token) {
              const response = await fetch('/api/manager/stripe-connect/sync', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });

              if (!response.ok) {
                const err = await response.text();
                logger.error("Sync response not OK:", response.status, err);
                throw new Error(`Sync failed: ${response.status}`);
              }

              logger.info("Stripe status synced successfully via return handler");
            } else {
              logger.error("No token available for sync");
              throw new Error(tt("authMissing"));
            }
          } catch (e) {
            logger.error("Failed to sync stripe status:", e);
            toast({ title: mt("syncWarning"),
              description: mt("toastStripeSyncWarningDesc"),
              variant: "destructive"
            });
            // Don't return early - still allow navigation, but maybe don't broadcast success if we aren't sure?
            // Actually, if sync failed, we shouldn't broadcast success.
            return;
          }

          // Show success message
          toast({ title: mt("stripeConnectedSuccessfully"),
            description: mt("yourAccountIsNowReadyToReceivePayments"),
            variant: "default",
          });

          // Force refresh of user profile and stripe status to get the new connected status
          await queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
          await queryClient.invalidateQueries({ queryKey: ['/api/manager/stripe-connect/status'] });

          // Return to the Payments tab inside the profile page.
          setActiveView('profile');

          // Clean up URL
          window.history.replaceState({}, '', '/manager/dashboard?view=profile&tab=payments');

          // [NEW] Broadcast success to other tabs
          const channel = new BroadcastChannel('stripe_onboarding_channel');
          channel.postMessage({ type: 'STRIPE_SETUP_COMPLETE' });
          channel.close();
        }
      }
    };

    handleStripeReturn();
  }, [toast, queryClient]);

  /**
   * Select a location as soon as one exists — the FIRST one, not only when there is exactly one.
   *
   * The `=== 1` this replaces left a manager with two or more locations looking at "Select a
   * Location" until they picked one, and there is no picker on most of those screens. The wizard
   * already resolves this the same way for kitchens ("Auto-select first kitchen … works for 1
   * kitchen (obvious) and 2+ kitchens (gives a starting point)"), so this matches it.
   *
   * The point is what the condition MEANS afterwards. With this, `selectedLocation === null` is no
   * longer "hasn't chosen yet" — it is exactly "has no location at all". That is the only reading
   * the empty states below can act on, and it is why they can now say one thing.
   *
   * `?locationId=` still wins: that effect runs first and sets a specific location, so by the time
   * this runs `selectedLocation` is already set and this is a no-op.
   */
  useEffect(() => {
    if (!isLoadingLocations && locations.length > 0 && !selectedLocation) {
      const locationId = Number(new URLSearchParams(window.location.search).get('locationId'));
      setSelectedLocation(locations.find(location => location.id === locationId) ?? locations[0]);
    }
  }, [locations, isLoadingLocations, selectedLocation]);

  // Fetch location details with cancellation policy
  const { data: locationDetails } = useQuery<Location | null>({
    queryKey: ['locationDetails', selectedLocation?.id],
    queryFn: async (): Promise<Location | null> => {
      if (!selectedLocation?.id) return null;
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = tt("failedToFetchLocations");
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (_error) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (_error) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      const locations = await response.json();
      const location = locations.find((l: any) => l.id === selectedLocation.id);
      if (location) {
        // Map snake_case to camelCase if needed
        // notification_email column from DB should be mapped to notificationEmail
        const mappedLocation = {
          ...location,
          notificationEmail: location.notificationEmail || location.notification_email || undefined,
          cancellationPolicyHours: location.cancellationPolicyHours ?? location.cancellation_policy_hours,
          cancellationPolicyMessage: location.cancellationPolicyMessage || location.cancellation_policy_message,
          defaultDailyBookingLimit: location.defaultDailyBookingLimit || location.default_daily_booking_limit,
        } as Location;

        logger.info('Fetched location details:', {
          id: mappedLocation.id,
          notificationEmail: mappedLocation.notificationEmail,
          rawData: location
        });

        return mappedLocation;
      }
      return selectedLocation;
    },
    enabled: !!selectedLocation?.id,
  });

  // Update location settings mutation
  const updateLocationSettings = useMutation({
    mutationFn: async ({ locationId, name, address, cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours, maxAdvanceBookingDays, turnoverBufferEnabled, bookingBufferMinutes, allowMultiDayBookings, maxBookingDays, notificationEmail, notificationPhone, logoUrl, customOnboardingLink, timezone, checkinWindowMinutesBefore, noShowGraceMinutes }: {
      locationId: number;
      name?: string;
      address?: string;
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number | null;
      minimumBookingWindowHours?: number;
      maxAdvanceBookingDays?: number;
      turnoverBufferEnabled?: boolean;
      bookingBufferMinutes?: number;
      allowMultiDayBookings?: boolean;
      maxBookingDays?: number;
      notificationEmail?: string;
      notificationPhone?: string;
      logoUrl?: string;
      customOnboardingLink?: string;
      timezone?: string;
      checkinWindowMinutesBefore?: number | null;
      noShowGraceMinutes?: number | null;
    }) => {
      const payload = {
        name, address, cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours,
        maxAdvanceBookingDays, turnoverBufferEnabled, bookingBufferMinutes, allowMultiDayBookings, maxBookingDays,
        notificationEmail, notificationPhone, logoUrl, customOnboardingLink, timezone, checkinWindowMinutesBefore, noShowGraceMinutes,
      };
      logger.info('📡 Sending PUT request to:', `/api/manager/locations/${locationId}/cancellation-policy`);
      logger.info('📡 Request body:', payload);
      logger.info('📡 LogoUrl in payload:', logoUrl, 'type:', typeof logoUrl);

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/cancellation-policy`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to update location settings';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (_error) {
          // If response isn't JSON, try to get text
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (_error) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // If response isn't JSON, return the text or empty object
        const text = await response.text();
        result = text ? JSON.parse(text) : {};
      }

      logger.info('✅ Save response:', result);
      return { result, payload };
    },
    onSuccess: (data, variables) => {
      const { result, payload } = data;

      // Get current location data from cache before updating
      const currentLocation = queryClient.getQueryData<Location>(['locationDetails', variables.locationId]) || selectedLocation;

      // Determine which fields changed
      const changedFields: string[] = [];

      if (payload.timezone !== undefined && payload.timezone !== (currentLocation?.timezone || DEFAULT_TIMEZONE)) {
        changedFields.push('timezone');
      }
      if (payload.cancellationPolicyHours !== undefined && payload.cancellationPolicyHours !== (currentLocation?.cancellationPolicyHours ?? 24)) {
        changedFields.push('cancellationPolicy');
      }
      if (payload.cancellationPolicyMessage !== undefined && payload.cancellationPolicyMessage !== (currentLocation?.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.")) {
        changedFields.push('cancellationPolicy');
      }
      if (payload.defaultDailyBookingLimit !== undefined && payload.defaultDailyBookingLimit !== (currentLocation?.defaultDailyBookingLimit ?? null)) {
        changedFields.push('bookingLimits');
      }
      if (payload.minimumBookingWindowHours !== undefined && payload.minimumBookingWindowHours !== (currentLocation?.minimumBookingWindowHours ?? 1)) {
        changedFields.push('bookingLimits');
      }
      if (payload.notificationEmail !== undefined && payload.notificationEmail !== (currentLocation?.notificationEmail || '')) {
        changedFields.push('notifications');
      }
      if (payload.notificationPhone !== undefined && payload.notificationPhone !== (currentLocation?.notificationPhone || '')) {
        changedFields.push('notifications');
      }
      if (payload.logoUrl !== undefined && payload.logoUrl !== (currentLocation?.logoUrl || '')) {
        changedFields.push('logo');
      }

      // Remove duplicates
      const uniqueChangedFields = Array.from(new Set(changedFields));

      // Determine success message based on what changed
      let successMessage = "Location settings updated successfully";
      if (uniqueChangedFields.length === 1) {
        const field = uniqueChangedFields[0];
        switch (field) {
          case 'timezone':
            successMessage = "Timezone updated successfully";
            break;
          case 'cancellationPolicy':
            successMessage = "Cancellation policy updated successfully";
            break;
          case 'bookingLimits':
            successMessage = "Booking limits updated successfully";
            break;
          case 'notifications':
            successMessage = "Notification settings updated successfully";
            break;
          case 'logo':
            successMessage = "Logo updated successfully";
            break;
        }
      } else if (uniqueChangedFields.length > 1) {
        successMessage = "Settings updated successfully";
      }

      // Update the location details cache with the returned data
      if (result) {
        queryClient.setQueryData(['locationDetails', variables.locationId], (oldData: Location | null) => {
          if (oldData) {
            return { ...oldData, ...result };
          }
          return result;
        });
        queryClient.setQueryData<Location[]>(['/api/manager/locations'], (oldData = []) =>
          oldData.map((location) =>
            location.id === variables.locationId ? { ...location, ...result } : location,
          ),
        );
      }

      // Update selected location state
      if (result) {
        setSelectedLocation((prev) => {
          if (prev && prev.id === result.id) {
            return { ...prev, ...result };
          }
          return prev;
        });
      }

      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['locationDetails', variables.locationId] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
      queryClient.invalidateQueries({ queryKey: ['managerKitchenWorkspace'] });

      toast({ title: mt("success"),
        description: successMessage,
      });
    },
    onError: (error: Error) => {
      toast({ title: mt("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });



  /* New Setup Handler — pass selected locationId so setup opens the correct location */
  const handleContinueSetup = () => {
    const step = setupSteps.find((candidate) => !candidate.complete);

    /*
     * The profile row is the one setup step the wizard does not own — an unverified email
     * is fixed in the dashboard's own profile view, so it never enters the wizard.
     */
    if (!step || step.id === "profile") {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'profile');
      url.searchParams.delete('tab');
      window.history.pushState({}, '', url);
      setActiveView('profile');
      return;
    }

    /*
     * Tell the wizard which step the banner just named.
     *
     * The wizard can derive a resume point on its own, but deriving the same answer
     * twice is how the banner came to say "Connect Stripe" and the wizard opened the
     * Business step. The destination comes from the SAME list as the banner's copy, so
     * the sentence and the step cannot describe different work.
     */
    const params = new URLSearchParams();
    const locId = selectedLocation?.id;
    if (locId) params.set('locationId', String(locId));
    const wizardStep = SETUP_STEP_WIZARD_STEP[step.id];
    if (wizardStep) params.set('step', wizardStep);

    const query = params.toString();
    setLocation(`/manager/setup${query ? `?${query}` : ''}`);
  };

  const handleImprovementTask = (task: string) => {
    const destination = getManagerImprovementDestination(task);
    const view: ViewType = destination.view === "settings" ? "profile" : destination.view;
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (destination.view === "settings") {
      url.searchParams.set("tab", "location");
      url.searchParams.delete("section");
    } else {
      url.searchParams.delete("tab");
      url.searchParams.delete("section");
    }
    window.history.pushState({}, "", url);
    setActiveView(view);
    // Settings may already be mounted, so notify its URL-backed tab state too.
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  /*
   * Setup is complete when the setup BANNER has nothing left to say.
   *
   * Read from the same verdict the banner renders (`showSetupBanner`) rather than re-derived, so the
   * two surfaces cannot disagree about whether a host is set up — and `isLoadingOnboardingStatus`
   * stops an unknown answer being read as "done", which would flash the wrong stage.
   */
  const isSetupComplete = !isLoadingOnboardingStatus && !showSetupBanner;
  const gettingStarted = useManagerGettingStarted(isSetupComplete);

  /**
   * Where each Getting Started row goes.
   *
   * Every destination is an EXISTING view: the checklist is a map of the dashboard, not a second
   * copy of it, so no row re-implements a page. `handleViewChange` is what runs, so a row inherits
   * the dirty-form guards rather than navigating away from unsaved work.
   */
  const handleGettingStartedItem = (id: GettingStartedItemId) => {
    switch (id) {
      case "finish-setup":
        // The wizard owns the setup work; this row is the door to it. `handleContinueSetup` already
        // names the step in the URL, so the wizard opens where the host left off rather than at the
        // top — which is what made "Add your kitchen" feel like it went to the wrong place.
        handleContinueSetup();
        break;
      case "phone":
        // "Sign-in & security" — the tab where Google, phone and password are rows.
        handleViewChange("security");
        break;
      case "stripe":
        handleViewChange("payments");
        break;
      case "publish-kitchen":
        // The listing REVIEW is the page that shows what is still blocking, and it carries Go live.
        if (gettingStarted.primaryKitchenId != null) {
          handleViewChange("listing-review", gettingStarted.primaryKitchenId);
        } else {
          handleViewChange("kitchens");
        }
        break;
      case "photos":
        handleViewChange("kitchens", gettingStarted.primaryKitchenId ?? undefined, "photos");
        break;
      case "tours":
        handleViewChange("tour-availability");
        break;
      case "equipment":
        // Each add-on has its own tab on My Kitchens, so each row opens its own.
        handleViewChange("kitchens", gettingStarted.primaryKitchenId ?? undefined, "equipment");
        break;
      case "storage":
        handleViewChange("kitchens", gettingStarted.primaryKitchenId ?? undefined, "storage");
        break;
      case "first-booking":
        // A milestone, so it is never a button — but if it ever is, this is the sensible landing.
        handleViewChange("bookings");
        break;
    }
  };

  return (
    <DashboardLayout
      showBookings={workspaceNavigationError || workspaceNavigation?.showBookings === true || activeView === "bookings"}
      // An older server without the flag keeps tours visible rather than hiding them.
      showTours={workspaceNavigationError || workspaceNavigation?.showTours !== false || activeView === "viewings"}
      toursNeedingAction={workspaceNavigation?.toursNeedingAction ?? 0}
      showStorageBookings={workspaceNavigationError || workspaceNavigation?.showStorageBookings === true || activeView === "storage-bookings"}
      showApplications={workspaceNavigationError || workspaceNavigation?.showApplications === true || managerKitchens.some((kitchen) => kitchen.listingStatus === 'active') || (workspaceNavigation?.showApplications === undefined && (legacyApplications.data?.length ?? 0) > 0) || legacyApplications.isError || activeView === "applications"}
      showRevenue={workspaceNavigationError || workspaceNavigation?.showRevenue === true || managerKitchens.some((kitchen) => kitchen.listingStatus === 'active') || managerBookings.length > 0 || activeView === "revenue"}
      activeView={shellActiveView}
      onViewChange={(view) => handleViewChange(view as ViewType)}
      locations={locations}
      selectedLocation={selectedLocation}
      onLocationChange={(loc) => handleManagerLocationChange(loc as Location)}
      onCreateLocation={startNewLocation}
      breadcrumbs={breadcrumbs}
      // The widget gates itself: it renders nothing once every row is done, and nothing while the
      // answers are still loading. It used to be gated on the WIZARD's state — the coupling this
      // change removes, and with it the `shouldShowSidebarGuidance` helper, which is now deleted.
      managerGettingStarted={{
        items: gettingStarted.items,
        completed: gettingStarted.completed,
        total: gettingStarted.total,
        hiddenStage: gettingStarted.hiddenStage,
        isLoading: isLoadingOnboardingStatus || gettingStarted.isLoading,
        onSelectItem: handleGettingStartedItem,
      }}
    >
      {/* Onboarding Status Banners */}
      <OnboardingStatusBanner
        isLoading={isLoadingOnboardingStatus}
        showSetupBanner={showSetupBanner}
        showLicenseReviewBanner={showLicenseReviewBanner}
        isReadyForBookings={isReadyForBookings}
        missingSteps={missingSteps}
        improvementSteps={improvementSteps}
        onContinueSetup={handleContinueSetup}
        onImproveListing={handleImprovementTask}
      />

      {activeView === 'profile' && (
        <ManagerProfileSettings
          location={locationDetails || selectedLocation}
          onSaveLocationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
          notificationLocation={locationDetails || selectedLocation}
          onSaveNotificationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
        />
      )}

      {/*
        * Support. Shares `SupportPageShell` with the chef page — same contact
        * cards and FAQ layout — but supplies manager answers, because the chef
        * FAQ is about booking a kitchen rather than running one.
        */}
      {activeView === 'support' && (
        <div>
          <ManagerSupportPage />
        </div>
      )}

      {activeView === 'overview' && (
        <div className="space-y-6">
          <SessionExtensionRequests />
          {isLoadingLocations || (locations.length > 0 && isLoadingKitchens) ? (
            <div className="space-y-5" role="status" aria-label="Loading dashboard"><div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)}</div><Skeleton className="h-72 w-full rounded-xl" /></div>
          ) : isErrorLocations || isErrorKitchens ? (
            <Card><CardContent className="space-y-3 p-6">
              <h1 className="text-lg font-semibold">{mt("overviewLoadErrorTitle")}</h1>
              <p className="text-sm text-muted-foreground">{mt("overviewLoadErrorBody")}</p>
              <Button variant="outline" onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
                void queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });
              }}>{mt("retry")}</Button>
            </CardContent></Card>
          ) : locations.length > 0 ? <KitchenDashboardOverview
            selectedLocation={selectedLocation}
            locations={locations}
            kitchens={managerKitchens}
            onNavigate={(view, kitchenId) => handleViewChange(view as ViewType, kitchenId)}
            onSelectLocation={(location) => setSelectedLocation(location as Location)}
          /> : (
            needsLocation
          )}
        </div>
      )}

      {(activeView === 'bookings' || activeView === 'viewings') && (
        <div className="space-y-6">
          {!(activeView === 'viewings' && detailTourId) && <ChefPageHeader
            title={activeView === 'bookings' ? mt("bookingRequests") : mt("tlTitle")}
            description={activeView === 'bookings' ? mt("reviewAndManageChefBookingRequests") : mt("tlDescription")}
            // Only once storage is listed, like the sidebar's Storage item.
            actions={activeView === 'bookings' && workspaceNavigation?.showStorageBookings ? (
              <Button variant="outline" size="sm" onClick={() => handleViewChange('storage-bookings')}>
                <Package className="mr-2 h-4 w-4" />{mt("navStorage")}
              </Button>
            ) : undefined}
          />}
          {activeView === 'bookings' ? <ManagerBookingsPanel embedded={true} onGoToKitchens={() => handleViewChange('kitchens')} /> : (
            <ViewingsDashboard
                tourId={routeTourId}
                navigationGuardRef={tourNavigationGuard}
                onOpenTour={id => setLocation(`/manager/tours/${id}`)}
                onBackToTours={() => { setLocation('/manager/dashboard?view=viewings'); setActiveView('viewings'); }}
                onConfigureNotes={(kitchenId, locationId, tourId) => {
                  const location = locations.find((item: Location) => item.id === locationId);
                  if (location) setSelectedLocation(location);
                  handleViewChange('kitchens', kitchenId, 'tours', 'tour-notes', tourId);
                }}
                locationId={selectedLocation?.id}
                onSelectTourLocation={id => {
                  const location = locations.find((item: Location) => item.id === id);
                  if (location) setSelectedLocation(location);
                }}
                hasKitchen={managerKitchens.length > 0}
                onConfigureTours={() => handleViewChange('kitchens', managerKitchens[0]?.id, managerKitchens.length ? 'tours' : undefined)}
              />
          )}
        </div>
      )}

      {activeView === 'storage-bookings' && (
        <div className="space-y-6">
          <ChefPageHeader
            title={st("stBoardTitle")}
            description={st("stBoardSubtitle")}
          />
          <ManagerStorageBookingsPage />
        </div>
      )}



      {activeView === 'customers' && (
        <CustomersList locations={locations} selectedLocationId={selectedLocation?.id ?? null} />
      )}

      {activeView === 'applications' && (
        <ManagerKitchenApplicationsContent
          selectedLocationId={selectedLocation?.id ?? null}
          isLayoutLoading={isLoadingLocations}
          setLocation={setLocation}
          onNavigateToView={(view: string) => handleViewChange(view as ViewType)}
          onApplicationChange={setReviewedApplicationName}
          onRegisterListAction={(showList) => { showApplicationsListRef.current = showList; }}
        />
      )}

      {activeView === 'settings' && selectedLocation && (
        <CompactSettingsView
          location={(locationDetails || selectedLocation) as Location}
          onUpdateSettings={updateLocationSettings}
          isUpdating={updateLocationSettings.isPending}
        />
      )}

      {activeView === 'settings' && !selectedLocation && (
        needsLocation
      )}

      {activeView === 'revenue' && (
        <ManagerRevenueDashboard
          selectedLocation={selectedLocation}
          locations={locations}
          hasPublishedKitchen={managerKitchens.some((kitchen) => kitchen.listingStatus === 'active')}
          hasRevenueHistory={managerBookings.length > 0 ? true : workspaceNavigationLoading ? undefined : workspaceNavigation?.hasRevenueHistory ?? false}
          isHistoryLoading={workspaceNavigationLoading}
          onNavigate={(view) => handleViewChange(view as ViewType)}
        />
      )}

      {activeView === 'messages' && (
        managerId ? (
          <div className="h-[calc(100vh-8rem)]">
            <UnifiedChatView userId={managerId} role="manager" initialConversationId={deepLinkConversationId} initialTourId={deepLinkTourId} onNavigate={(view) => handleViewChange(view as ViewType)} managerHasKitchen={managerKitchens.length > 0} />
          </div>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-6" role="status" aria-label={mt("loadingYourProfile")}>
              <Skeleton className="h-7 w-1/2" />
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)}
            </CardContent>
          </Card>
        )
      )}

      {activeView === 'payments' && (
        <ManagerProfileSettings
          location={locationDetails || selectedLocation}
          onSaveLocationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
          notificationLocation={locationDetails || selectedLocation}
          onSaveNotificationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
        />
      )}


      {activeView === 'damage-claims' && (
        <div>
          <DamageClaimQueue />
        </div>
      )}

      {/* New Settings Views - Enterprise-grade modular architecture */}
      {activeView === 'kitchens' && selectedLocation && (
        <KitchensManagement
          location={locationDetails || selectedLocation}
          onNavigate={handleViewChange}
          onConfigureRequirements={() => handleViewChange('application-requirements')}
          saveRef={kitchensSaveRef}
          onDirtyChange={setKitchensDirty}
          /*
           * A review row sends the manager here for ONE kitchen. Without this the tabbed section
           * seeds itself from `kitchens[0]`, so a location holding several kitchens opens the wrong
           * one — which is what every row on the publish review used to do.
           */
          initialKitchenId={kitchenForReview ?? undefined}
          onReturnToTour={id => setLocation(`/manager/tours/${id}`)}
        />
      )}

      {activeView === 'kitchens' && !selectedLocation && (
        needsLocation
      )}

      {activeView === 'listing-review' && kitchenForReview && (
        <KitchenListingReview
          kitchenId={kitchenForReview}
          locationId={selectedLocation?.id}
          onNavigate={handleViewChange}
          // Listing is the end of the task, so the manager lands back on the kitchen rather than
          // being left staring at a page whose only action is now done.
          onListed={() => handleViewChange('kitchens')}
        />
      )}

      {/*
        * The publish review is per-kitchen, and it resolves its target from an explicit choice or
        * the URL — so this is reached either with no kitchen at all, or with one the review was
        * never told to open. "Please select a kitchen first" covered both and offered neither a
        * kitchen to select nor a way to make one.
        *
        * Both cases route to the Kitchens view, which is where a kitchen is created AND where one
        * is chosen, and which already seeds itself from the first kitchen.
        */}
      {activeView === 'listing-review' && !kitchenForReview && (isLoadingOnboardingStatus ? <SettingsContentSkeleton /> :
        <NeedsKitchen
          hasKitchen={hasKitchens}
          onGoToKitchens={() => handleViewChange('kitchens')}
        />
      )}





      {activeView === 'location' && selectedLocation && (
        <LocationWorkspace
          location={locationDetails || selectedLocation}
          onSaveLocation={(updates) => updateLocationSettings.mutateAsync(updates)}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['locationDetails', selectedLocation.id] });
            queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
          }}
          onOpenRequirements={() => handleViewChange('application-requirements')}
          onDirtyChange={setLocationDirty}
          saveRef={locationSaveRef}
        />
      )}

      {activeView === 'location' && !selectedLocation && (
        needsLocation
      )}

      {activeView === 'application-requirements' && selectedLocation && (
        <div className="space-y-6">
          <ChefPageHeader title={mt("navApplicationRequirements")} description={mt("configureWhatInformationChefsNeedToProvideWhenApplyingToYour")} />
          <LocationRequirementsSettings
            ref={requirementsRef}
            locationId={selectedLocation.id}
            onDirtyChange={setRequirementsDirty}
          />
        </div>
      )}

      {activeView === 'application-requirements' && !selectedLocation && (
        needsLocation
      )}

      {activeView === 'notifications' && (
        <NotificationCenter locationId={selectedLocation?.id} variant="page" />
      )}

      {activeView === 'notification-settings' && (
        <ManagerProfileSettings
          location={locationDetails || selectedLocation}
          onSaveLocationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
          notificationLocation={locationDetails || selectedLocation}
          onSaveNotificationSettings={(updates) => updateLocationSettings.mutateAsync(updates)}
        />
      )}

      {activeView === 'settings-checkin-checkout' && selectedLocation && (
        <CheckinCheckoutSettings
          key={`${selectedLocation.id}-${setupKitchen?.id ?? 'shared'}`}
          mode="tasks"
          location={locationDetails || selectedLocation}
          saveRef={checkinCheckoutRef}
          onDirtyChange={setCheckinCheckoutDirty}
          onNavigate={handleViewChange}
          kitchenContext={setupKitchen}
          kitchenMissing={setupKitchenMissing}
          onReturnToKitchen={kitchenForReview != null && !setupKitchen ? undefined : () => setupKitchen
            ? handleViewChange('kitchens', setupKitchen.id, 'arrival-departure')
            : handleViewChange('kitchens')}
        />
      )}

      {activeView === 'settings-checkin-checkout' && !selectedLocation && (
        needsLocation
      )}

      {activeView === 'settings-storage-checkin-checkout' && selectedLocation && (
        <StorageCheckinCheckoutSettings
          location={locationDetails || selectedLocation}
          onDirtyChange={setCheckinCheckoutDirty}
          saveRef={storageChecklistRef}
        />
      )}

      {activeView === 'settings-storage-checkin-checkout' && !selectedLocation && (
        needsLocation
      )}

      <UnsavedChangesDialog
        open={pendingAvailabilityView !== null}
        onOpenChange={(open) => !open && setPendingAvailabilityView(null)}
        description={mt("availabilityUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={() => pendingAvailabilityView && continueFromAvailability(pendingAvailabilityView)}
        onSave={saveAndLeaveAvailability}
      />

      <UnsavedChangesDialog
        open={pendingBookingPoliciesView !== null}
        onOpenChange={(open) => !open && setPendingBookingPoliciesView(null)}
        description={mt("bookingPoliciesUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={() => pendingBookingPoliciesView && continueFromBookingPolicies(pendingBookingPoliciesView)}
        onSave={saveAndLeaveBookingPolicies}
      />

      <UnsavedChangesDialog
        open={pendingLocationView !== null || pendingLocationHistory !== null}
        onOpenChange={(open) => { if (!open) { setPendingLocationView(null); setPendingLocationHistory(null); } }}
        description={mt("locationUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={continueFromLocation}
        onSave={saveAndLeaveLocation}
      />

      <UnsavedChangesDialog
        open={pendingKitchensView !== null}
        onOpenChange={(open) => !open && setPendingKitchensView(null)}
        description={mt("kitchenUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={() => pendingKitchensView && continueFromKitchens(pendingKitchensView)}
        onSave={saveAndLeaveKitchens}
      />

      <UnsavedChangesDialog
        open={pendingCheckinCheckoutView !== null}
        onOpenChange={(open) => !open && setPendingCheckinCheckoutView(null)}
        description={mt("checkinCheckoutUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={() => pendingCheckinCheckoutView && continueFromCheckinCheckout(pendingCheckinCheckoutView)}
        onSave={saveAndLeaveCheckinCheckout}
      />

      <UnsavedChangesDialog
        open={pendingRequirementsView !== null}
        onOpenChange={(open) => !open && setPendingRequirementsView(null)}
        description={mt("applicationRequirementsUnsavedChangesDescription")}
        isSaving={isSavingBeforeLeave}
        onDiscard={() => pendingRequirementsView && continueFromRequirements(pendingRequirementsView)}
        onSave={saveAndLeaveRequirements}
      />

    </DashboardLayout>
  );
}

// [PARKED] CreateLocationDialog — Multi-location "Add New Location" is parked with Coming Soon badges.
// This component will be re-enabled when the full multi-location onboarding flow is implemented.
// See gap analysis: engine.reset(), per-location completedSteps scoping, hasPerformedInitialAutoSkip reset.
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLocationSchema, type CreateLocationFormValues } from "@/schemas/locationSchema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { tt } from "@/i18n/common-ns";
import ManagerSupportPage from "@/components/manager/ManagerSupportPage";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CreateLocationDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) {
  const [licenseFile, setLicenseFile] = useState<File | null>(null);

  const form = useForm<CreateLocationFormValues>({
    resolver: zodResolver(createLocationSchema),
    defaultValues: {
      name: "",
      address: "",
      notificationEmail: "",
      notificationPhone: "",
    },
  });

  const onSubmit = async (data: CreateLocationFormValues) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/manager/locations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: data.name,
          address: data.address,
          notification_email: data.notificationEmail,
          notification_phone: data.notificationPhone
        })
      });

      if (res.ok) {
        const newLoc = await res.json();

        // Handle license upload if exists
        if (licenseFile && newLoc.id) {
          const currentFirebaseUser = auth.currentUser;
          if (currentFirebaseUser) {
            const token = await currentFirebaseUser.getIdToken();
            const formData = new FormData();
            formData.append('file', licenseFile);

            const uploadRes = await fetch('/api/upload-file', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });

            if (uploadRes.ok) {
              const { url } = await uploadRes.json();
              await fetch(`/api/manager/locations/${newLoc.id}`, {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ kitchenLicenseUrl: url, kitchenLicenseStatus: 'pending' })
              });
            }
          }
        }

        toast({ title: mt("locationCreatedSuccessfully") });
        onSuccess();
        onOpenChange(false);
        form.reset();
        setLicenseFile(null);
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create location");
      }
    } catch (error: any) {
      toast({ title: mt("errorCreatingLocation"),
        description: error.message,
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="sm:max-w-xl p-0">
        <ScrollArea className="h-full">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-1">{mt("addNewLocation")}</h2>
            <p className="text-sm text-muted-foreground mb-6">{mt("enterTheDetailsForYourNewKitchenLocation")}</p>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{mt("locationName")}</FormLabel>
                      <FormControl>
                        <Input placeholder={mt("eGDowntownKitchen")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{mt("address")}</FormLabel>
                      <FormControl>
                        <Input placeholder={mt("fullAddress")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="notificationEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("notificationEmail")}</FormLabel>
                        <FormControl>
                          <Input placeholder={mt("bookingsExampleCom")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notificationPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("notificationPhone")}</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 (555) 000-0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-4 border-t">
                  <FormLabel className="mb-2 block">{mt("kitchenLicense")}</FormLabel>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 bg-muted/30 hover:bg-muted/50 transition-colors text-center cursor-pointer relative group">
                    <input
                      type="file"
                      id="license-upload-dialog-form"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLicenseFile(file);
                          toast({ title: mt("fileAttached"),
                            description: file.name
                          });
                        }
                      }}
                    />
                    <label htmlFor="license-upload-dialog-form" className="cursor-pointer block w-full h-full">
                      <div className="flex flex-col items-center gap-2">
                        <div className="p-3 bg-background rounded-full shadow-sm group-hover:scale-110 transition-transform">
                          <Upload className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-primary">{mt("clickToUpload")}</span>
                          <span className="text-muted-foreground"> or drag and drop</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{mt("pDFJPGOrPNGMax5MB2")}</p>
                        {licenseFile && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-full mx-auto w-fit">
                            <Check className="h-4 w-4" />
                            {licenseFile.name}
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                  <FormDescription className="mt-2">{mt("uploadYourBusinessLicenseOrFoodSafetyCertificate")}</FormDescription>
                </div>

                <Button
                  type="submit"
                  className="w-full mt-6"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mt("createLocation")}
                </Button>
              </form>
            </Form>
          </div>
        </ScrollArea>
      </AppDialogContent>
    </Dialog>
  );
}

// Original settings view remains below...




// Settings View Component
interface SettingsViewProps {
  location: Location;
  onUpdateSettings: any;
  isUpdating: boolean;
}

function CompactSettingsView({ location, onUpdateSettings }: SettingsViewProps) {
  const queryClient = useQueryClient();
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useState(
    ["location", "booking", "documents", "requirements"].includes(initialTab || "")
      ? initialTab!
      : "location",
  );

  const changeTab = (value: string) => {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState({}, "", url);
  };

  const save = (updates: any) => onUpdateSettings.mutateAsync(updates);
  const tabs = ["location", "booking", "documents", "requirements"];
  const activeIndex = Math.max(0, tabs.indexOf(tab));

  return (
    <div className="space-y-4">
      <ChefPageHeader
        title={mt("settings")}
        description={`Manage ${location.name} from one place.`}
      />
      <TabGroup index={activeIndex} onIndexChange={(index) => changeTab(tabs[index])}>
        <TabList variant="line" className="mt-2">
          <Tab>Location</Tab>
          <Tab>{mt("navBookingRules")}</Tab>
          <Tab>Documents</Tab>
          <Tab>Requirements</Tab>
        </TabList>
        <TabPanels className="mt-4">
        <TabPanel>
          <LocationSettings location={location} onSave={save} />
        </TabPanel>
        <TabPanel>
          <BookingRulesSettings location={location} onSave={save} />
        </TabPanel>
        <TabPanel className="space-y-4">
          <LicenseSettings
            location={location}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
              queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
            }}
          />
          <FacilityDocsSettings location={location} />
        </TabPanel>
        <TabPanel>
          <LocationRequirementsSettings locationId={location.id} />
        </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}

// Component for managing kitchen gallery images
function KitchenGalleryImages({
  kitchenId,
  galleryImages,
  locationId
}: {
  kitchenId: number;
  galleryImages: string[];
  locationId: number;
}) {
  const queryClient = useQueryClient();
  const [currentGalleryImages, setCurrentGalleryImages] = useState<string[]>(galleryImages || []);

  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: async (response) => {
      const newGalleryImages = [...currentGalleryImages, response.url];
      await updateGalleryImages(newGalleryImages);
    },
    onError: (error) => {
      toast({ title: mt("uploadFailed2"),
        description: error,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setCurrentGalleryImages(galleryImages || []);
  }, [galleryImages]);

  const updateGalleryImages = async (newGalleryImages: string[]) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/gallery`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ galleryImages: newGalleryImages }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update gallery images');
      }

      setCurrentGalleryImages(newGalleryImages);
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', locationId] });

      toast({ title: mt("success"),
        description: mt("galleryImagesUpdatedSuccessfully"),
      });
    } catch (error: any) {
      logger.error('Gallery images update error:', error);
      toast({ title: mt("error"),
        description: error.message || "Failed to update gallery images",
        variant: "destructive",
      });
    }
  };

  const handleRemoveImage = async (imageUrl: string) => {
    const newGalleryImages = currentGalleryImages.filter(img => img !== imageUrl);
    await updateGalleryImages(newGalleryImages);

    // Delete from R2
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        return;
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      await fetch('/api/manager/files', {
        method: 'DELETE',
        headers,
        credentials: 'include',
        body: JSON.stringify({ fileUrl: imageUrl }),
      });
    } catch (error) {
      logger.error('Error deleting file from R2:', error);
      // Continue even if R2 deletion fails
    }
  };

  const handleReplaceImage = async (oldUrl: string, newUrl: string) => {
    const newGalleryImages = currentGalleryImages.map(img => img === oldUrl ? newUrl : img);
    await updateGalleryImages(newGalleryImages);

    // Delete old image from R2
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        return;
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      await fetch('/api/manager/files', {
        method: 'DELETE',
        headers,
        credentials: 'include',
        body: JSON.stringify({ fileUrl: oldUrl }),
      });
    } catch (error) {
      logger.error('Error deleting old file from R2:', error);
      // Continue even if R2 deletion fails
    }
  };

  return (
    <div className="space-y-3">
      {/* Existing Gallery Images */}
      {currentGalleryImages.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {currentGalleryImages.map((imageUrl, index) => (
            <ImageWithReplace
              key={index}
              imageUrl={imageUrl}
              onImageChange={(newUrl) => {
                if (newUrl) {
                  handleReplaceImage(imageUrl, newUrl);
                } else {
                  handleRemoveImage(imageUrl);
                }
              }}
              onRemove={() => handleRemoveImage(imageUrl)}
              alt={`Gallery image ${index + 1}`}
              className="h-32"
              containerClassName="w-full"
              aspectRatio="1/1"
              showReplaceButton={true}
              showRemoveButton={true}
            />
          ))}
        </div>
      )}

      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-gray-400 transition-colors">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              uploadFile(file);
              e.target.value = ''; // Reset input
            }
          }}
          className="hidden"
          id={`gallery-upload-${kitchenId}`}
          disabled={isUploading}
        />
        <label
          htmlFor={`gallery-upload-${kitchenId}`}
          className={`flex flex-col items-center justify-center cursor-pointer ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isUploading ? (
            <>
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-sm text-gray-600">Uploading... {Math.round(uploadProgress)}%</span>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-sm font-medium text-gray-700 mb-1">{mt("clickToAddGalleryImage")}</span>
              <span className="text-xs text-gray-500">{mt("jPGPNGWebPMax45MB")}</span>
            </>
          )}
        </label>
      </div>
    </div>
  );
}
