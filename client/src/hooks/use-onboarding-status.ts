
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase"; // Keep direct auth import for token if needed, or rely on useFirebaseAuth

export interface OnboardingStatus {
    isLoading: boolean;
    // Global
    isStripeComplete: boolean;
    // Location specific
    hasApprovedLicense: boolean;
    hasKitchens: boolean;
    hasAvailability: boolean;

    // Computed
    isReadyForBookings: boolean;
    showOnboardingModal: boolean;
    showSetupBanner: boolean;

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

    // --- Logic ---

    // Use Stripe API status (more accurate) - account is complete only when charges AND payouts are enabled
    const isStripeComplete = stripeConnectStatus?.status === 'complete' && 
        stripeConnectStatus?.chargesEnabled && stripeConnectStatus?.payoutsEnabled;
    const hasApprovedLicense = locationData?.kitchen_license_status === 'approved' || locationData?.kitchenLicenseStatus === 'approved'; // handle snake/camel
    const hasKitchens = (kitchens?.length || 0) > 0;

    // Ready State
    const isReadyForBookings =
        isStripeComplete &&
        hasApprovedLicense &&
        hasKitchens &&
        hasAvailability;

    const missingSteps = [];
    if (!hasApprovedLicense) missingSteps.push("Upload Kitchen License");
    if (!hasKitchens) missingSteps.push("Create a Kitchen");
    // if (!hasAvailability) missingSteps.push("Set Availability");
    if (!isStripeComplete) missingSteps.push("Connect Stripe");

    const showOnboardingModal =
        !userData?.manager_onboarding_completed &&
        !userData?.has_seen_welcome;

    const showSetupBanner = !isReadyForBookings;

    const isLoading = isLoadingUser || isLoadingStripe || (!!locationId && (isLoadingLocation || isLoadingKitchens));

    return {
        isLoading,
        isStripeComplete,
        hasApprovedLicense,
        hasKitchens,
        hasAvailability,
        isReadyForBookings,
        showOnboardingModal,
        showSetupBanner,
        missingSteps
    };
}
