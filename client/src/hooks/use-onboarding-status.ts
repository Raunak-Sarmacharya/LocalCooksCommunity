import { logger } from "@/lib/logger";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { auth } from "@/lib/firebase"; // Keep direct auth import for token if needed, or rely on useFirebaseAuth

export interface OnboardingStatus {
    isLoading: boolean;
    // Global
    isStripeComplete: boolean;
    // Location specific
    hasUploadedLicense: boolean;
    hasApprovedLicense: boolean;
    hasPendingLicense: boolean;
    licenseStatus: 'none' | 'pending' | 'approved' | 'rejected';
    hasKitchens: boolean;
    hasAvailability: boolean;
    hasRequirements: boolean;

    // Computed
    isOnboardingComplete: boolean; // All steps done (license uploaded, not necessarily approved)
    isReadyForBookings: boolean;   // Can accept bookings (license approved)
    showOnboardingModal: boolean;
    showSetupBanner: boolean;      // Show setup banner (onboarding incomplete)
    showLicenseReviewBanner: boolean; // Show license under review banner

    // Missing steps for banner
    missingSteps: string[];
    improvementSteps: string[];
    setupSteps: ManagerSetupStep[];
}

export interface ManagerSetupStep {
    id: 'profile' | 'license' | 'kitchen' | 'availability' | 'requirements' | 'payments';
    labelKey: 'onboardingProfileDetails' | 'onboardingKitchenLicense' | 'onboardingKitchenSpace' | 'onboardingAvailability' | 'onboardingChefRequirements' | 'onboardingPayments';
    complete: boolean;
}

export function buildManagerSetupSteps(status: {
    isProfileComplete?: boolean;
    hasUploadedLicense: boolean;
    hasKitchens: boolean;
    hasAvailability: boolean;
    hasRequirements: boolean;
    isStripeComplete: boolean;
}): ManagerSetupStep[] {
    return [
        { id: 'profile', labelKey: 'onboardingProfileDetails', complete: status.isProfileComplete ?? true },
        { id: 'license', labelKey: 'onboardingKitchenLicense', complete: status.hasUploadedLicense },
        { id: 'kitchen', labelKey: 'onboardingKitchenSpace', complete: status.hasKitchens },
        { id: 'availability', labelKey: 'onboardingAvailability', complete: status.hasAvailability },
        { id: 'requirements', labelKey: 'onboardingChefRequirements', complete: status.hasRequirements },
        { id: 'payments', labelKey: 'onboardingPayments', complete: status.isStripeComplete },
    ];
}

/**
 * How the onboarding state stays current.
 *
 * The global QueryClient default is `staleTime: Infinity`, so every query below used to
 * be fetched exactly ONCE per session and never again. But a manager completes onboarding
 * steps FROM the dashboard (upload the license, add a kitchen, connect Stripe), so the
 * setup banner has to be able to see those land.
 *
 *   refetchOnMount: "always"  — a dashboard remount re-reads the state instead of trusting
 *                               a cache that may predate the manager's last action.
 *   refetchOnWindowFocus      — covers returning from a step that runs in another tab
 *                               (Stripe onboarding is exactly that).
 *
 * Both are safe to add ONLY because `isLoading` below no longer keys off `isFetching`: a
 * background revalidation now updates the data without ever flashing the loading state.
 * Adding these while `isFetching` still drove the banner would have made the flicker worse.
 */
const ONBOARDING_QUERY_OPTIONS = {
    staleTime: 1000 * 30,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
} as const;

/**
 * Every query key this hook reads, so a caller can refresh the whole picture at once.
 * Prefixes on purpose — `invalidateQueries` matches by key prefix, so this catches the
 * uid/locationId-suffixed variants without repeating them here.
 */
export const ONBOARDING_QUERY_KEYS = [
    "/api/user/profile",
    "/api/manager/stripe-connect/status",
    "locationDetails",
    "managerKitchens",
    "locationAvailabilityStatus",
    "locationRequirements",
] as const;

/**
 * Re-read the onboarding state.
 *
 * A manager completes these steps from the PAGES the sidebar links to — upload the
 * license, add a kitchen, set availability, configure requirements, connect Stripe — and
 * none of that remounts this hook, so `refetchOnMount` alone would never see it. Calling
 * this on navigation covers every one of those surfaces from a single place, instead of
 * remembering to invalidate inside each step's own save handler (which is where the
 * coverage was patchy: `/api/user/profile` and `locationDetails` were wired up, the
 * kitchens / availability / requirements keys were not).
 */
export function invalidateOnboardingStatus(queryClient: QueryClient): void {
    for (const queryKey of ONBOARDING_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [queryKey] });
    }
}

/**
 * Whether the sidebar should carry the "Getting started" checklist.
 *
 * The dashboard banner and this checklist read the same status, so they have to agree — and
 * they did not. The gate required a SELECTED LOCATION for the setup banner to reach the
 * checklist, while the banner itself has no such requirement. A manager who left the wizard
 * at step one ("Maybe later") has a verified email and no location, so BOTH clauses failed:
 *
 *   profile step complete  -> first clause false   (they registered, so the email is verified)
 *   no selectedLocation    -> second clause false  (the wizard never created one)
 *
 * …and the checklist was hidden while the banner directly above it said "Continue setup".
 * The manager with nothing set up yet is precisely the one who needs the checklist.
 *
 * `improvementSteps` (logo, cover photo, kitchen descriptions) stay location-scoped — they
 * are about a listing, and there is no listing to improve without a location.
 */
export function shouldShowSidebarGuidance(input: {
  isLoading: boolean;
  setupSteps: ManagerSetupStep[];
  hasSelectedLocation: boolean;
  showSetupBanner: boolean;
  improvementStepCount: number;
}): boolean {
  if (input.isLoading) return false;
  return (
    input.setupSteps.some((step) => step.id === "profile" && !step.complete) ||
    input.showSetupBanner ||
    (input.hasSelectedLocation && input.improvementStepCount > 0)
  );
}

export function useOnboardingStatus(locationId?: number): OnboardingStatus {
    const { user: firebaseUser } = useFirebaseAuth();

    // 1. Fetch User Profile (Global) - ALWAYS fetch to check manager_onboarding_completed
    const { data: userData, isLoading: isLoadingUser } = useQuery({
        queryKey: ["/api/user/profile", firebaseUser?.uid],
        queryFn: async () => {
            if (!firebaseUser) return null;
            const token = await auth.currentUser?.getIdToken();
            if (!token) return null;
            const res = await fetch("/api/user/profile", {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!firebaseUser,
        ...ONBOARDING_QUERY_OPTIONS,
    });

    // [ENTERPRISE OPTIMIZATION] Check if onboarding is already marked complete in the database
    // If true, skip all the detailed API calls - they're not needed for the dashboard
    // Note: Drizzle ORM returns camelCase field names (managerOnboardingCompleted)
    const isOnboardingMarkedComplete = !!userData?.managerOnboardingCompleted;

    // Debug logging for early-exit optimization
    if (userData) {
        logger.info('[useOnboardingStatus] Early-exit check:', {
            managerOnboardingCompleted: userData.managerOnboardingCompleted,
            isOnboardingMarkedComplete,
            willSkipDetailedQueries: isOnboardingMarkedComplete
        });
    }

    // 2. Fetch Location Details (License) - ALWAYS fetch for license status banner
    // This is a lightweight call needed even after onboarding is complete
    const { data: locationData, isLoading: isLoadingLocation } = useQuery({
        queryKey: ['locationDetails', locationId],
        queryFn: async () => {
            if (!locationId) return null;
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`/api/manager/locations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return null;
            const locations = await res.json();
            return locations.find((l: any) => l.id === locationId);
        },
        enabled: !!locationId,
        ...ONBOARDING_QUERY_OPTIONS,
    });

    // [ENTERPRISE OPTIMIZATION] Skip Stripe, Kitchens, Availability, Requirements queries
    // when onboarding is already complete - these are only needed during setup
    const shouldSkipDetailedQueries = isOnboardingMarkedComplete;

    // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
    // SKIP when onboarding is complete - Stripe status was already verified during onboarding
    const { data: stripeConnectStatus, isLoading: isLoadingStripe } = useQuery({
        queryKey: ['/api/manager/stripe-connect/status', firebaseUser?.uid],
        queryFn: async () => {
            if (!firebaseUser) return null;
            const token = await auth.currentUser?.getIdToken();
            if (!token) return null;
            const res = await fetch('/api/manager/stripe-connect/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!firebaseUser && !shouldSkipDetailedQueries,
        // This is the SAME endpoint the Payments tab reads, so it shares one policy —
        // the 30s staleTime that used to sit here now lives in ONBOARDING_QUERY_OPTIONS.
        ...ONBOARDING_QUERY_OPTIONS,
    });

    // 3. Fetch Kitchens (Pricing & Count)
    // SKIP when onboarding is complete
    const { data: kitchens, isLoading: isLoadingKitchens } = useQuery({
        queryKey: ['managerKitchens', locationId],
        queryFn: async () => {
            if (!locationId) return [];
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`/api/manager/kitchens/${locationId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!locationId,
        ...ONBOARDING_QUERY_OPTIONS,
    });

    // 4. Fetch Availability (Check if any kitchen has days set)
    // SKIP when onboarding is complete - this is the most expensive query (multiple requests)
    const { data: availabilityData, isLoading: isLoadingAvailability } = useQuery({
        queryKey: ['locationAvailabilityStatus', locationId, kitchens?.map((k: any) => k.id)],
        queryFn: async () => {
            if (!kitchens?.length) return false;
            const token = await auth.currentUser?.getIdToken();
            if (!token) return false;

            // Check each kitchen for availability
            for (const kitchen of kitchens) {
                const res = await fetch(`/api/manager/availability/${kitchen.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    // If any day is available, return true
                    if (Array.isArray(data) && data.some((d: any) => d.isAvailable || d.is_available)) {
                        return true;
                    }
                }
            }
            return false;
        },
        enabled: !!locationId && !!kitchens?.length && !shouldSkipDetailedQueries,
        ...ONBOARDING_QUERY_OPTIONS,
    });

    const hasAvailability = shouldSkipDetailedQueries ? true : !!availabilityData;

    // 5. Fetch Requirements Status
    // SKIP when onboarding is complete
    const { data: requirementsData, isLoading: isLoadingRequirements } = useQuery({
        queryKey: ['locationRequirements', locationId],
        queryFn: async () => {
            if (!locationId) return null;
            const token = await auth.currentUser?.getIdToken();
            if (!token) return null;
            const res = await fetch(`/api/manager/locations/${locationId}/requirements`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!locationId && !shouldSkipDetailedQueries,
        ...ONBOARDING_QUERY_OPTIONS,
    });

    const hasRequirements = shouldSkipDetailedQueries ? true : !!(requirementsData && Number(requirementsData.id) > 0);

    // --- Logic ---

    // License status logic - handle snake_case and camelCase
    // This is needed even for completed onboarding (for license review banner)
    const rawLicenseStatus = locationData?.kitchen_license_status || locationData?.kitchenLicenseStatus;
    const licenseUrl = locationData?.kitchen_license_url || locationData?.kitchenLicenseUrl;
    
    // Determine license states
    const hasUploadedLicense = !!licenseUrl;
    const hasApprovedLicense = rawLicenseStatus === 'approved';
    const hasPendingLicense = hasUploadedLicense && (rawLicenseStatus === 'pending' || !rawLicenseStatus);
    const licenseStatus: 'none' | 'pending' | 'approved' | 'rejected' = 
        !hasUploadedLicense ? 'none' :
        rawLicenseStatus === 'approved' ? 'approved' :
        rawLicenseStatus === 'rejected' ? 'rejected' : 'pending';

    // [ENTERPRISE OPTIMIZATION] When onboarding is already marked complete in DB:
    // - Skip detailed status checks (Stripe, kitchens, availability, requirements)
    // - These were verified when manager_onboarding_completed was set to true
    // - Only license status is checked for showLicenseReviewBanner
    const isStripeComplete = shouldSkipDetailedQueries 
        ? true  // Was verified during onboarding
        : (stripeConnectStatus?.status === 'complete' && 
           stripeConnectStatus?.chargesEnabled && stripeConnectStatus?.payoutsEnabled);
    
    const hasKitchens = (kitchens?.length || 0) > 0;
    const setupSteps = buildManagerSetupSteps({
        // This row is specifically about the email address, because an unverified
        // address blocks every operational action. Name and phone are handled by
        // their own surfaces and never gate anything.
        isProfileComplete: hasVerifiedEmail(firebaseUser, userData),
        hasUploadedLicense: shouldSkipDetailedQueries || hasUploadedLicense,
        hasKitchens: shouldSkipDetailedQueries || hasKitchens,
        hasAvailability,
        hasRequirements,
        isStripeComplete,
    });

    // Onboarding Complete = All steps done with license UPLOADED (not necessarily approved)
    // When DB flag is set, trust it (manager already completed all required steps)
    const isOnboardingComplete = shouldSkipDetailedQueries 
        ? true 
        : (isStripeComplete &&
           hasUploadedLicense && // Just needs to be uploaded
           hasKitchens &&
           hasAvailability &&
           hasRequirements);

    // Ready for Bookings = Can accept bookings (license must be APPROVED)
    // Even when onboarding is complete, license approval determines booking readiness
    const isReadyForBookings = shouldSkipDetailedQueries
        ? hasApprovedLicense  // Only license approval matters post-onboarding
        : (isStripeComplete &&
           hasApprovedLicense && // Must be approved to accept bookings
           hasKitchens &&
           hasAvailability &&
           hasRequirements);

    // Missing steps for setup banner (only show if onboarding not complete)
    const missingSteps: string[] = [];
    if (!shouldSkipDetailedQueries) {
        if (!hasUploadedLicense) missingSteps.push("Upload Kitchen License");
        if (!hasKitchens) missingSteps.push("Create a Kitchen");
        if (!hasAvailability) missingSteps.push("Set Availability");
        if (!hasRequirements) missingSteps.push("Configure Application Requirements");
        if (!isStripeComplete) missingSteps.push("Connect Stripe");
    }

    const improvementSteps: string[] = [];
    if (!locationData?.logoUrl && !locationData?.logo_url) improvementSteps.push("Add your location logo");
    if (hasKitchens && kitchens?.some((kitchen: any) => !kitchen.imageUrl)) improvementSteps.push("Add a cover photo to every kitchen");
    if (hasKitchens && kitchens?.some((kitchen: any) => !kitchen.description?.trim())) improvementSteps.push("Describe every kitchen");

    const showOnboardingModal =
        !userData?.managerOnboardingCompleted &&
        !userData?.has_seen_welcome;

    // Show setup banner only if onboarding is NOT complete (DB flag not set)
    const showSetupBanner = !isOnboardingMarkedComplete && !isOnboardingComplete;
    
    // Show license review banner if onboarding is complete but license is pending
    // This banner still shows even after onboarding is marked complete in DB
    const showLicenseReviewBanner = (isOnboardingMarkedComplete || isOnboardingComplete) && hasPendingLicense;

    // "Loading" means WE DO NOT HAVE THE DATA YET — not "a request is in flight".
    //
    // This read `isFetching`, which is true during ANY background refetch. So every time
    // one of these queries revalidated — an invalidation from another surface, a window
    // refocus, a stale window expiring — `isLoading` flipped true for a moment and the
    // dashboard's onboarding banner unmounted and came straight back. That is the flicker.
    // `isLoading` is `isPending && isFetching`, i.e. the FIRST load only, which is what a
    // loading state is supposed to mean.
    const isLoading = shouldSkipDetailedQueries
        ? (isLoadingUser || (!!locationId && (isLoadingLocation || isLoadingKitchens)))
        : (isLoadingUser || isLoadingStripe || (!!locationId && (
            isLoadingLocation ||
            isLoadingKitchens ||
            (!!kitchens?.length && (isLoadingAvailability || isLoadingRequirements))
        )));

    // Debug logging for final values
    if (userData && !isLoading) {
        logger.info('[useOnboardingStatus] Final status:', {
            isOnboardingMarkedComplete,
            showSetupBanner,
            showLicenseReviewBanner,
            isOnboardingComplete,
            isReadyForBookings,
            hasPendingLicense,
            licenseStatus
        });
    }

    return {
        isLoading,
        isStripeComplete,
        hasUploadedLicense,
        hasApprovedLicense,
        hasPendingLicense,
        licenseStatus,
        hasKitchens,
        hasAvailability,
        hasRequirements,
        isOnboardingComplete,
        isReadyForBookings,
        showOnboardingModal,
        showSetupBanner,
        showLicenseReviewBanner,
        missingSteps,
        improvementSteps,
        setupSteps,
    };
}
