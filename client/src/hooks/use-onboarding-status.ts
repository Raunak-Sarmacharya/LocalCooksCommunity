import { logger } from "@/lib/logger";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { auth } from "@/lib/firebase"; // Keep direct auth import for token if needed, or rely on useFirebaseAuth
import { mt } from "@/i18n/manager";

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
    /**
     * The short action phrase, e.g. "Upload your license".
     *
     * One label, used by BOTH the sidebar checklist and the dashboard banner. They used
     * to hold separate lists — the checklist read `managerSetupStep*`, the banner held
     * its own English sentences — and they could disagree: the checklist said "Verify
     * your email address" while the banner said "Create a Kitchen" and its button went
     * to the profile view. A step's name and its destination now come from one place.
     */
    labelKey: 'managerSetupStepProfile' | 'managerSetupStepLicense' | 'managerSetupStepKitchen' | 'managerSetupStepAvailability' | 'managerSetupStepRequirements' | 'managerSetupStepPayments';
    complete: boolean;
}

/**
 * Which wizard step a dashboard setup step corresponds to.
 *
 * The licence is not its own wizard step — it is part three of the Business step, so
 * "Upload your license" opens the Business step. `profile` is null because the dashboard
 * already routes it to its own profile view rather than into the wizard.
 *
 * This map exists so the banner's destination is derived from the SAME list as its copy.
 * The two used to be computed separately and could name different steps.
 */
export const SETUP_STEP_WIZARD_STEP: Record<ManagerSetupStep["id"], string | null> = {
    profile: null,
    license: 'location',
    kitchen: 'create-kitchen',
    availability: 'availability',
    requirements: 'application-requirements',
    payments: 'payment-setup',
};

export function buildManagerSetupSteps(status: {
    isProfileComplete?: boolean;
    hasUploadedLicense: boolean;
    hasKitchens: boolean;
    /**
     * Whether the availability step is BEHIND the manager — not whether an open day exists.
     *
     * The row is labelled "Set your availability & booking policies" and sits under Getting
     * started beside kitchen / requirements / payments, so it is a PROGRESS row: the manager
     * has been through the step, accepted the pre-filled policies, and is done with it. Its
     * two halves are the schedule AND the policies, and most managers take the policies as
     * given — so a row that only counted open days told them to set availability they had
     * already dealt with, and sent them back into the step they had finished (2026-09-26).
     *
     * `hasOpenDays` below is the OTHER question — "is there anything to book?" — and it is
     * the one the publish/booking gate asks. Keep them apart: one flag cannot answer both.
     */
    availabilityStepDone: boolean;
    /**
     * Whether the Requirements step is BEHIND the manager — not whether a saved row exists.
     *
     * Same distinction as `availabilityStepDone` above, for the same reason. The step ships
     * with the platform defaults already filled in, so the common path is a manager who reads
     * them, changes nothing, and moves on — and no row is ever written. `hasRequirements` means
     * "a `location_requirements` row exists (`id > 0`)", so reading it alone kept this row
     * `complete: false` on the dashboard banner ("Your next setup step — Chef requirements")
     * after the manager had finished the step AND the wizard's own rail had ticked it
     * (2026-09-26).
     *
     * The two ways in are the same two as the context's `isRequirementsStepBehindUs`: a saved
     * row, or the step's completion in the durable record — which the engine POSTs when the
     * manager leaves the step's review. Keep this and that predicate in step; they answer one
     * question and a third spelling of it is what caused the bug.
     */
    requirementsStepDone: boolean;
    isStripeComplete: boolean;
}): ManagerSetupStep[] {
    return [
        { id: 'profile', labelKey: 'managerSetupStepProfile', complete: status.isProfileComplete ?? true },
        { id: 'license', labelKey: 'managerSetupStepLicense', complete: status.hasUploadedLicense },
        { id: 'kitchen', labelKey: 'managerSetupStepKitchen', complete: status.hasKitchens },
        { id: 'availability', labelKey: 'managerSetupStepAvailability', complete: status.availabilityStepDone },
        { id: 'requirements', labelKey: 'managerSetupStepRequirements', complete: status.requirementsStepDone },
        { id: 'payments', labelKey: 'managerSetupStepPayments', complete: status.isStripeComplete },
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

    /*
     * [ENTERPRISE OPTIMIZATION] Skip Kitchens, Availability and Requirements queries once
     * onboarding is marked complete — those were verified when the flag was set, and nothing
     * can un-verify them afterwards.
     *
     * STRIPE IS THE EXCEPTION, and deliberately so. It used to be skipped under the same
     * assumption ("verified during onboarding"), but that assumption is now FALSE: a manager
     * can legitimately finish onboarding with Stripe merely SUBMITTED, because Stripe's own
     * verification takes days and it is not ours to make them wait. So the flag no longer
     * implies a connected account, and this row has to ask Stripe rather than infer.
     *
     * Skipping it here ticked the Getting Started "payments" row for a manager who could not
     * yet be paid — which is exactly the claim the dashboard must never make.
     */
    const shouldSkipDetailedQueries = isOnboardingMarkedComplete;

    // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
    // ALWAYS fetched: the account can still be mid-verification after onboarding completes.
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

    /*
     * Whether the availability step is BEHIND the manager — the progress question, which is
     * NOT the same as `hasAvailability` ("is there an open day to book?").
     *
     * The durable record is the authority: the engine POSTs the step's completion when the
     * manager leaves its review, and `/api/user/profile` returns it as
     * `managerOnboardingStepsCompleted`. Both spellings are read because the wizard's own
     * context reads the snake_case one, which the profile endpoint does not actually send —
     * so at least one of these two readers is wrong, and guessing which would be the third
     * time this codebase has shipped a definition of a fact that nothing can satisfy.
     *
     * `hasAvailability` is kept in the OR: a manager who set a real schedule but whose session
     * predates the durable write is still plainly done with the step.
     */
    const completedStepMap =
        (userData?.managerOnboardingStepsCompleted as Record<string, boolean> | undefined) ??
        (userData?.manager_onboarding_steps_completed as Record<string, boolean> | undefined) ??
        {};
    /*
     * A location-scoped key counts for ANY location, not just the selected one — the wizard
     * writes `availability_location_<id>` and the manager may have since switched. The pattern
     * is the same one the wizard's own normaliser uses, so the two cannot drift.
     */
    const availabilityStepDone =
        Object.entries(completedStepMap).some(
            ([key, done]) => !!done && /^availability(?:_location_\d+)?$/.test(key),
        ) || hasAvailability;

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

    /*
     * The other half of the Requirements question, derived the same way as `availabilityStepDone`.
     *
     * `hasRequirements` is "a row was saved". The step is also DONE when the manager reached its
     * review and accepted the pre-filled defaults, which writes no row — the engine records that
     * in `managerOnboardingStepsCompleted` instead. Reading only the row flag is what kept the
     * dashboard's setup banner offering "Chef requirements" after the step was finished and its
     * rail was ticked (2026-09-26). Same regex shape as the availability key above, so the two
     * derivations cannot drift apart.
     */
    const requirementsStepDone =
        Object.entries(completedStepMap).some(
            ([key, done]) => !!done && /^application-requirements(?:_location_\d+)?$/.test(key),
        ) || hasRequirements;

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
        availabilityStepDone: shouldSkipDetailedQueries || availabilityStepDone,
        requirementsStepDone: shouldSkipDetailedQueries || requirementsStepDone,
        isStripeComplete,
    });

    /*
     * Onboarding Complete = every step the wizard asks for has been done, with the licence
     * UPLOADED (not necessarily approved).
     *
     * The availability term is the STEP being behind the manager, not an open day existing. It
     * used to be `hasAvailability`, which made this disagree with the wizard: the wizard let the
     * manager finish by accepting the pre-filled policies without a schedule, ticked the step,
     * and then this said onboarding was incomplete — the dashboard banner kept offering a step
     * that was already finished, and the manager could loop (2026-09-26). Same defect shape as
     * the Stripe connected/initiated split, one layer further out.
     *
     * `isReadyForBookings` below still reads `hasAvailability`, because THAT question really is
     * "is there anything to book" — a kitchen with no hours cannot take a booking.
     *
     * The requirements term follows the same rule for the same reason: `requirementsStepDone`
     * (a saved row OR the step's completion in the durable record), never `hasRequirements`,
     * which demands a row a manager who accepted the defaults never writes.
     */
    const isOnboardingComplete = shouldSkipDetailedQueries 
        ? true 
        : (isStripeComplete &&
           hasUploadedLicense && // Just needs to be uploaded
           hasKitchens &&
           availabilityStepDone &&
           requirementsStepDone);

    // Ready for Bookings = Can accept bookings (license must be APPROVED)
    // Even when onboarding is complete, license approval determines booking readiness
    const isReadyForBookings = shouldSkipDetailedQueries
        ? hasApprovedLicense  // Only license approval matters post-onboarding
        : (isStripeComplete &&
           hasApprovedLicense && // Must be approved to accept bookings
           hasKitchens &&
           hasAvailability &&
           hasRequirements);

    /*
     * The banner's task line, read off the checklist instead of computed again.
     *
     * These were two parallel lists with their own order and their own copy, and they
     * could disagree — see `ManagerSetupStep.labelKey`. Deriving it means the sentence
     * the banner shows and the step its button opens can never describe different work.
     */
    const missingSteps: string[] = setupSteps
        .filter((step) => !step.complete)
        .map((step) => mt(step.labelKey));

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
