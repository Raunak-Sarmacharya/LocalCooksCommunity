import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";

import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";
import { apiGet } from "@/lib/api";
import { auth } from "@/lib/firebase";
import {
  buildGettingStartedItems,
  summarizeGettingStarted,
  visibleGettingStartedItems,
  type GettingStartedSummary,
} from "@/lib/manager-getting-started";
import { kitchenListingReadinessKey } from "@/lib/manager-kitchens-navigation";
import { useFirebaseAuth } from "./use-auth";
import { useManagerDashboard } from "./use-manager-dashboard";

/** `/api/manager/stripe-connect/status` — Stripe's own verdict on the connected account. */
interface StripeStatusSlice {
  status?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

/**
 * The cheap signals refresh the way the onboarding status does.
 *
 * A host completes these from the PAGES the sidebar links to — verify a phone, connect Stripe,
 * publish — and none of that remounts this hook, so `refetchOnMount` alone would never see it.
 */
const CHEAP_QUERY_OPTIONS = {
  staleTime: 1000 * 30,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
} as const;

/**
 * The readiness payload is deliberately LAZIER, and this is not an oversight.
 *
 * `buildKitchenReadiness` calls Stripe's API live — `getAccountStatus` has no cache at all — so a
 * window-focus refetch would buy a real external round trip every time the host tabs away and back,
 * on a widget that mounts on every manager page. Navigation invalidation is what keeps it current
 * instead (`invalidateGettingStarted`), which is exactly the moment it can have changed.
 *
 * The cost is known and accepted for now; folding these four booleans into an endpoint that does not
 * touch Stripe is the follow-up.
 */
const READINESS_QUERY_OPTIONS = {
  staleTime: 1000 * 60 * 5,
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
} as const;

/**
 * Every query key this hook reads, so a caller can refresh the whole picture at once.
 *
 * Prefixes on purpose — `invalidateQueries` matches by key prefix, so this catches the
 * uid/locationId/kitchenId-suffixed variants without repeating them here.
 */
export const GETTING_STARTED_QUERY_KEYS = [
  "/api/manager/stripe-connect/status",
  "/api/manager/locations",
  "/api/manager/bookings",
  // Catches the kitchenId-suffixed variants — this hook's own, and the listing review's.
  "kitchen-listing-readiness",
] as const;

/**
 * Re-read the Getting Started state.
 *
 * Called on navigation, for the same reason `invalidateOnboardingStatus` is: the rows complete on
 * OTHER pages, and returning to the dashboard does not remount the widget that shows them.
 */
export function invalidateGettingStarted(queryClient: QueryClient): void {
  for (const queryKey of GETTING_STARTED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [queryKey] });
  }
}

export interface ManagerGettingStarted extends GettingStartedSummary {
  isLoading: boolean;
  /**
   * Which stage's rows are being held back, so the UI can name it.
   *
   * The UI says this rather than staying silent: a checklist that simply stops is a dead end, while
   * one that says the road continues is an invitation. `null` means nothing is withheld.
   */
  hiddenStage: "setup" | "live" | null;
  /**
   * The kitchen the listing rows are about, so a caller can send the host to that kitchen's review.
   *
   * `null` when the host has no kitchen yet — the publish row then opens the kitchens page instead.
   */
  primaryKitchenId: number | null;
}

/**
 * The manager dashboard's Getting Started list.
 *
 * ACCOUNT-LEVEL, not per-kitchen. It picks ONE kitchen as the subject (see below) and never restarts
 * for a second one: by then the host has learned the pattern, and kitchen #2's polish is covered,
 * per-kitchen, by the listing review that already exists.
 *
 * Every fact is read from its owner and none is derived here — the item model in
 * `lib/manager-getting-started.ts` holds the rules, and this only gathers the inputs.
 *
 * @param isSetupComplete The WIZARD's verdict, passed in by the caller.
 *
 *   It is deliberately an argument rather than something this hook computes: the dashboard already
 *   has it (`showSetupBanner`'s inverse, from `useOnboardingStatus`), and the setup banner reads the
 *   same value. Deriving a second answer here is exactly how two surfaces come to disagree about
 *   whether a host is set up.
 */
export function useManagerGettingStarted(isSetupComplete: boolean): ManagerGettingStarted {
  const { user } = useFirebaseAuth();
  // Locations, every kitchen across them, and bookings — all keyed the same way the dashboard page
  // already keys them, so this shares that cache rather than fetching its own copies.
  const {
    kitchens,
    bookings,
    isLoadingKitchens,
    isLoadingLocations,
    isLoadingBookings,
  } = useManagerDashboard();

  /*
   * The host's PRIMARY kitchen — the earliest one they created.
   *
   * Earliest-created rather than "the selected one": the checklist must not move under the host as
   * they switch kitchens, which is exactly the repetitive feel this design is avoiding. It is also
   * the kitchen they set up first, i.e. the one the rows are teaching.
   */
  const primaryKitchen = useMemo(() => {
    if (!kitchens.length) return null;
    return [...kitchens].sort((a, b) => {
      const byDate = String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
      return byDate !== 0 ? byDate : a.id - b.id;
    })[0];
  }, [kitchens]);

  const primaryKitchenId = primaryKitchen?.id ?? null;

  // Stripe's own answer, from the same endpoint the Payments tab reads.
  const { data: stripeStatus, isLoading: isLoadingStripe } = useQuery<StripeStatusSlice | null>({
    queryKey: ["/api/manager/stripe-connect/status", user?.uid],
    queryFn: async () => {
      if (!user) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const res = await fetch("/api/manager/stripe-connect/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok ? res.json() : null;
    },
    enabled: !!user,
    ...CHEAP_QUERY_OPTIONS,
  });

  /*
   * The listing rows' facts — gallery, tours, add-ons.
   *
   * Read from the payload the listing REVIEW renders, never re-derived, so a row here and a row
   * there can never tell a host different things about their own kitchen.
   *
   * **This stores the WHOLE review, exactly as the status bar and the review page do.** It used to
   * return `review.checklist`, i.e. a bare `ListingChecklist`, under a key the other two write the
   * review into — one cache slot, two shapes. React Query keys ARE the identity of their data, so
   * whichever `queryFn` ran first decided what every other reader got; `refetchOnMount: "always"`
   * did not save it, because the cached value is handed to the first render while the refetch is
   * still in flight, and `buildGettingStartedItems` runs in a `useMemo` on that render. The result
   * was `readiness.recommendations` being `undefined` and the whole dashboard dying with
   * "Cannot read properties of undefined (reading 'some')" as soon as a kitchen existed.
   *
   * `KitchenReadinessReview` is now declared once, in `@shared/kitchen-listing-readiness`, so all
   * three readers name the same shape.
   */
  const { data: readinessReview, isLoading: isLoadingReadiness } = useQuery<KitchenReadinessReview>({
    queryKey: kitchenListingReadinessKey(primaryKitchenId ?? 0),
    queryFn: () => apiGet(`/manager/kitchens/${primaryKitchenId}/listing-readiness`),
    enabled: primaryKitchenId != null,
    ...READINESS_QUERY_OPTIONS,
  });

  const isLive = kitchens.some((kitchen) => kitchen.listingStatus === "active");
  // A PROVED number, not a stored one. The number itself is guaranteed — registration requires it —
  // so the only open state is "not yet verified".
  const phoneVerified = user?.phoneVerified === true;

  const items = useMemo(
    () =>
      buildGettingStartedItems({
        isSetupComplete,
        phoneVerified,
        // Charges AND payouts — "submitted to Stripe" is not "can be paid".
        stripeConnected:
          stripeStatus?.status === "complete" &&
          stripeStatus?.chargesEnabled === true &&
          stripeStatus?.payoutsEnabled === true,
        hasPublishedKitchen: isLive,
        // The checklist out of the shared review payload — the same object the review page renders.
        readiness: readinessReview?.checklist ?? null,
        hasConfirmedBooking: bookings.some((booking) => booking.status === "confirmed"),
      }),
    [isSetupComplete, phoneVerified, stripeStatus, isLive, readinessReview, bookings],
  );

  const summary = useMemo(() => {
    /*
     * Progressive disclosure: setup gates the live rows, and being live gates the booked rows. See
     * `isPhaseVisible` — the boundaries are the host's real stages, and each one is a milestone the
     * host earned rather than a row they might never finish.
     *
     * The count is taken over what is SHOWN, so it never claims progress against rows the host
     * cannot see, and it changes only at those milestones.
     */
    const visibleItems = visibleGettingStartedItems(items, {
      isSetupComplete,
      phoneVerified,
      isLive,
    });

    return {
      ...summarizeGettingStarted(visibleItems),
      // Named, not silent: the stage whose rows are waiting, so the UI can say what unlocks them.
      hiddenStage: (isSetupComplete ? (isLive ? null : "live") : "setup") as
        | "setup"
        | "live"
        | null,
    };
  }, [items, isSetupComplete, phoneVerified, isLive]);

  return {
    ...summary,
    primaryKitchenId,
    // Loading means "we do not have the answers yet", so the caller can hold the widget back rather
    // than show a progress count it is about to change.
    isLoading:
      isLoadingStripe ||
      isLoadingLocations ||
      isLoadingKitchens ||
      isLoadingBookings ||
      (primaryKitchenId != null && isLoadingReadiness),
  };
}
