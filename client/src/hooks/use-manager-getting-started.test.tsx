import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard crash: "Cannot read properties of undefined (reading 'some')".
 *
 * Three surfaces read the ONE cache slot `kitchenListingReadinessKey(kitchenId)` — the status bar in
 * My Kitchens, the publish review, and this hook. The first two store the WHOLE
 * `KitchenReadinessReview`; this hook stored a bare `ListingChecklist`. A query key is the identity
 * of its data, so whichever `queryFn` ran first decided what every other reader got — and
 * `refetchOnMount: "always"` does not save the first paint, because React Query hands the component
 * the CACHED value while the refetch is in flight and `buildGettingStartedItems` runs in a `useMemo`
 * on that render.
 *
 * So the reproduction is: seed the cache exactly as the status bar seeds it, then mount the hook.
 * That is not a contrived state — it is the normal one after the manager has looked at My Kitchens.
 */
const h = vi.hoisted(() => ({
  kitchens: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  apiGet: vi.fn(),
}));

/*
 * A wrapper, not `apiGet: h.apiGet`. The mock factory runs ONCE, so handing it the current function
 * would freeze the reference and every `beforeEach` reassignment would be invisible to the module
 * under test — the call would go to a stale mock and the assertion would fail for the wrong reason.
 */
vi.mock("@/lib/api", () => ({ apiGet: (...args: unknown[]) => h.apiGet(...args) }));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("./use-auth", () => ({
  useFirebaseAuth: () => ({ user: { uid: "uid-1", phoneVerified: false } }),
}));
vi.mock("./use-manager-dashboard", () => ({
  useManagerDashboard: () => ({
    kitchens: h.kitchens,
    bookings: h.bookings,
    isLoadingKitchens: false,
    isLoadingLocations: false,
    isLoadingBookings: false,
  }),
}));

import { useManagerGettingStarted } from "./use-manager-getting-started";
import { kitchenListingReadinessKey } from "@/lib/manager-kitchens-navigation";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";

/** The endpoint's real payload: the whole review, `checklist` nested inside it. */
const REVIEW: KitchenReadinessReview = {
  checklist: {
    requirements: [],
    recommendations: [
      { id: "gallery", met: true },
      { id: "tours", met: false },
      { id: "equipment", met: false },
      { id: "storage", met: true },
    ],
    canPublish: false,
    missingRequirementIds: [],
    openRecommendationIds: ["tours", "equipment"],
  },
  details: {
    kitchenName: "Harbour Kitchen",
    locationName: "Downtown",
    description: "A bright prep kitchen",
    hourlyRateCents: 2500,
    dailyRateCents: null,
    coverPhotoUrl: "https://cdn.example.com/cover.png",
    galleryImageCount: 3,
    availabilityDayCount: 5,
    licenseStatus: "approved",
    stripeAccountId: null,
    hasApplicationRequirements: true,
    termsUploadedAt: null,
    toursEnabled: false,
    cancellationPolicyHours: 24,
    dailyBookingLimit: 2,
    minimumBookingWindowHours: 1,
    minimumBookingHours: 1,
  },
  listingStatus: "draft",
  adminHidden: false,
};

const KITCHEN_ID = 42;

/**
 * `staleTime: Infinity` plus a seeded entry makes the fetch a no-op, so the assertion is about what
 * the hook does with the CACHED value — which is the whole bug.
 */
function mount({ seed }: { seed: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (seed) client.setQueryData(kitchenListingReadinessKey(KITCHEN_ID), REVIEW);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useManagerGettingStarted(true), { wrapper });
}

const item = (result: { current: ReturnType<typeof useManagerGettingStarted> }, id: string) =>
  result.current.items.find((entry) => entry.id === id);

beforeEach(() => {
  /*
   * LIVE, not draft, and that is load-bearing for the assertions below: the `get-booked` rows are
   * withheld until a kitchen is published (`isPhaseVisible`), and `summarizeGettingStarted` counts
   * over what is SHOWN — so a draft kitchen would leave `photos`/`tours`/`add-ons` absent from the
   * returned list and every assertion here would read `undefined`.
   */
  h.kitchens = [
    { id: KITCHEN_ID, name: "Harbour Kitchen", createdAt: "2026-09-01T00:00:00.000Z", listingStatus: "active" },
  ];
  h.bookings = [];
  h.apiGet = vi.fn(async () => REVIEW);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});

describe("useManagerGettingStarted — the shared readiness cache slot", () => {
  it("survives a review payload already cached under the shared key", () => {
    /*
     * THE crash. Seeded by `KitchenListingStatus` on any visit to My Kitchens, so this is the
     * ordinary state — and the hook used to read `.recommendations` off the review object, which is
     * `undefined`, inside a `useMemo`, which took the whole dashboard down with an error boundary.
     */
    expect(() => mount({ seed: true })).not.toThrow();
  });

  it("reads the checklist OUT of the review, not the review itself", () => {
    const { result } = mount({ seed: true });

    // `gallery` is met; `tours` is not; `storage` is met. Equipment and storage are SEPARATE rows.
    expect(item(result, "photos")?.complete).toBe(true);
    expect(item(result, "tours")?.complete).toBe(false);
    expect(item(result, "storage")?.complete).toBe(true);
    expect(item(result, "equipment")?.complete).toBe(false);
  });

  it("does the same when it has to fetch for itself", async () => {
    const { result } = mount({ seed: false });

    await waitFor(() => expect(item(result, "photos")?.complete).toBe(true));
    expect(item(result, "tours")?.complete).toBe(false);
    expect(h.apiGet).toHaveBeenCalledWith(`/manager/kitchens/${KITCHEN_ID}/listing-readiness`);
  });

  it("fetches nothing, and shows no listing rows, when there is no kitchen yet", () => {
    h.kitchens = [];
    const { result } = mount({ seed: false });

    // No kitchen means the readiness query is disabled, so there is no payload to mis-read...
    expect(h.apiGet).not.toHaveBeenCalled();
    // ...and the `get-booked` rows are withheld rather than reported as unmet work.
    expect(item(result, "photos")).toBeUndefined();
    expect(item(result, "equipment")).toBeUndefined();
  });
});

describe("the readiness cache slot has ONE declared shape", () => {
  /*
   * The behavioural tests above pin the bug; this pins the INVARIANT, because the bug's root cause
   * was three readers each declaring their own idea of one cache slot and nothing type-checking a
   * cache read (`useQuery<T>` is a cast). A future reader that invents a fourth shape would pass
   * `tsc` and only fail in the browser.
   */
  const readers = [
    "client/src/hooks/use-manager-getting-started.ts",
    "client/src/components/manager/settings/KitchenListingStatus.tsx",
    "client/src/components/manager/settings/KitchenListingReview.tsx",
  ];

  it("names `KitchenReadinessReview` in every reader of `kitchenListingReadinessKey`", () => {
    for (const file of readers) {
      const source = readFileSync(join(process.cwd(), file), "utf8");

      // Each one must actually read the shared key...
      expect(source, `${file} no longer reads the shared key`).toContain("kitchenListingReadinessKey(");
      // ...and must type that read with the shared interface, not a local one.
      expect(
        /useQuery<KitchenReadinessReview>/.test(source),
        `${file} must type its readiness query as KitchenReadinessReview`,
      ).toBe(true);
    }
  });

  it("declares that interface exactly once, in the shared module", () => {
    const shared = readFileSync(
      join(process.cwd(), "shared/kitchen-listing-readiness.ts"),
      "utf8",
    );
    expect(shared).toContain("export interface KitchenReadinessReview");

    // No reader may re-declare it. This is the regression: two near-identical local copies is how
    // the third one drifted into a different shape entirely.
    for (const file of readers) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(
        /interface\s+KitchenReadinessReview\b/.test(source),
        `${file} re-declares KitchenReadinessReview`,
      ).toBe(false);
    }
  });
});
