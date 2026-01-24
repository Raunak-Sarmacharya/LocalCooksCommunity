
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

    // 4. Fetch Availability (New Check)
    // We need a way to check if ANY availability exists for these kitchens.
    // Assuming we have an endpoint or we check via a new query.
    // For now, let's assume if they have kitchens, they MIGHT have availability, 
    // but ideally we check `kitchen_availability` table count.
    // Let's verify if we can check this via an existing endpoint or adding a light one.
    // "KitchenAvailabilityManagement" uses `useQuery` for availability.

    // Placeholder for robust availability check:
    const hasAvailability = true; // TODO: Implement actual check

    // --- Logic ---

    const isStripeComplete = userData?.stripe_connect_onboarding_status === 'complete' || userData?.stripeConnectOnboardingStatus === 'complete';
    const hasApprovedLicense = locationData?.kitchen_license_status === 'approved' || locationData?.kitchenLicenseStatus === 'approved'; // handle snake/camel
    const hasKitchens = (kitchens?.length || 0) > 0;

    // Ready State
    const isReadyForBookings =
        isStripeComplete &&
        hasApprovedLicense &&
        hasKitchens &&
        hasAvailability;

    const missingSteps = [];
    if (!isStripeComplete) missingSteps.push("Connect Stripe");
    if (!hasApprovedLicense) missingSteps.push("Upload Kitchen License");
    if (!hasKitchens) missingSteps.push("Create a Kitchen");
    // if (!hasAvailability) missingSteps.push("Set Availability");

    const showOnboardingModal =
        !userData?.manager_onboarding_completed &&
        !userData?.has_seen_welcome;

    const showSetupBanner = !isReadyForBookings && !showOnboardingModal;

    const isLoading = isLoadingUser || (!!locationId && (isLoadingLocation || isLoadingKitchens));

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
