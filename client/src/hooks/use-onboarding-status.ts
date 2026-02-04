
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
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
    });

    // [ENTERPRISE OPTIMIZATION] Check if onboarding is already marked complete in the database
    // If true, skip all the detailed API calls - they're not needed for the dashboard
    const isOnboardingMarkedComplete = !!userData?.manager_onboarding_completed;

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
        staleTime: 1000 * 30, // Cache for 30 seconds
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
        enabled: !!locationId && !shouldSkipDetailedQueries,
    });

    // 4. Fetch Availability (Check if any kitchen has days set)
    // SKIP when onboarding is complete - this is the most expensive query (multiple requests)
    const { data: availabilityData } = useQuery({
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
    });

    const hasAvailability = shouldSkipDetailedQueries ? true : !!availabilityData;

    // 5. Fetch Requirements Status
    // SKIP when onboarding is complete
    const { data: requirementsData } = useQuery({
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
    
    const hasKitchens = shouldSkipDetailedQueries ? true : (kitchens?.length || 0) > 0;

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

    const showOnboardingModal =
        !userData?.manager_onboarding_completed &&
        !userData?.has_seen_welcome;

    // Show setup banner only if onboarding is NOT complete (DB flag not set)
    const showSetupBanner = !isOnboardingMarkedComplete && !isOnboardingComplete;
    
    // Show license review banner if onboarding is complete but license is pending
    // This banner still shows even after onboarding is marked complete in DB
    const showLicenseReviewBanner = (isOnboardingMarkedComplete || isOnboardingComplete) && hasPendingLicense;

    // Simplified loading state when onboarding is complete
    const isLoading = shouldSkipDetailedQueries 
        ? (isLoadingUser || (!!locationId && isLoadingLocation))  // Only 2 queries
        : (isLoadingUser || isLoadingStripe || (!!locationId && (isLoadingLocation || isLoadingKitchens)));

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
        missingSteps
    };
}
