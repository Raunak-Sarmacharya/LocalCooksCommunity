
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

    // 1. Fetch User Profile (Global)
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

    // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
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
        enabled: !!firebaseUser,
        staleTime: 1000 * 30, // Cache for 30 seconds
    });

    // 2. Fetch Location Details (License)
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

    // 3. Fetch Kitchens (Pricing & Count)
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
    });

    // 4. Fetch Availability (Check if any kitchen has days set)
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
        enabled: !!locationId && !!kitchens?.length,
    });

    const hasAvailability = !!availabilityData;

    // 5. Fetch Requirements Status
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
        enabled: !!locationId,
    });

    const hasRequirements = !!(requirementsData && Number(requirementsData.id) > 0);

    // --- Logic ---

    // Use Stripe API status (more accurate) - account is complete only when charges AND payouts are enabled
    const isStripeComplete = stripeConnectStatus?.status === 'complete' && 
        stripeConnectStatus?.chargesEnabled && stripeConnectStatus?.payoutsEnabled;
    
    // License status logic - handle snake_case and camelCase
    const rawLicenseStatus = locationData?.kitchen_license_status || locationData?.kitchenLicenseStatus;
    const licenseUrl = locationData?.kitchen_license_url || locationData?.kitchenLicenseUrl;
    
    // Determine license states
    const hasUploadedLicense = !!licenseUrl;
    const hasApprovedLicense = rawLicenseStatus === 'approved';
    const hasPendingLicense = hasUploadedLicense && rawLicenseStatus === 'pending';
    const licenseStatus: 'none' | 'pending' | 'approved' | 'rejected' = 
        !hasUploadedLicense ? 'none' :
        rawLicenseStatus === 'approved' ? 'approved' :
        rawLicenseStatus === 'rejected' ? 'rejected' : 'pending';
    
    const hasKitchens = (kitchens?.length || 0) > 0;

    // Onboarding Complete = All steps done with license UPLOADED (not necessarily approved)
    const isOnboardingComplete =
        isStripeComplete &&
        hasUploadedLicense && // Just needs to be uploaded
        hasKitchens &&
        hasAvailability &&
        hasRequirements;

    // Ready for Bookings = Can accept bookings (license must be APPROVED)
    const isReadyForBookings =
        isStripeComplete &&
        hasApprovedLicense && // Must be approved to accept bookings
        hasKitchens &&
        hasAvailability &&
        hasRequirements;

    // Missing steps for setup banner (only show if onboarding not complete)
    const missingSteps: string[] = [];
    if (!hasUploadedLicense) missingSteps.push("Upload Kitchen License");
    if (!hasKitchens) missingSteps.push("Create a Kitchen");
    if (!hasAvailability) missingSteps.push("Set Availability");
    if (!hasRequirements) missingSteps.push("Configure Application Requirements");
    if (!isStripeComplete) missingSteps.push("Connect Stripe");

    const showOnboardingModal =
        !userData?.manager_onboarding_completed &&
        !userData?.has_seen_welcome;

    // Show setup banner only if onboarding is NOT complete
    const showSetupBanner = !isOnboardingComplete;
    
    // Show license review banner if onboarding is complete but license is pending
    const showLicenseReviewBanner = isOnboardingComplete && hasPendingLicense;

    const isLoading = isLoadingUser || isLoadingStripe || (!!locationId && (isLoadingLocation || isLoadingKitchens));

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
