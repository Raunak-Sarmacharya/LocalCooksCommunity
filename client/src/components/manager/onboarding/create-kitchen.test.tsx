import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `createKitchen` has to say whether it created anything.
 *
 * It used to resolve `undefined` in every case — success, a failed request, and a missing
 * location — and the kitchen step's create-and-advance then moved on regardless. The manager
 * landed on Equipment with no kitchen ("No kitchen selected"), and Back from there landed on the
 * step's empty state, because the create form had been closed while `kitchens` was still empty.
 * Two screens deep in a dead end, with the reason only in a toast that had already faded.
 *
 * The contract now: **resolve `true` only when the kitchen exists afterwards.** A boolean is what
 * lets the caller hold the manager on the form instead of advancing on a failed write — the same
 * rule `persistLocation` already follows.
 */
const h = vi.hoisted(() => ({
  locations: [] as any[],
  kitchenCreateOk: true,
  kitchenCreateThrows: false,
  fetch: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({
    user: { uid: "u1", email: "manager@example.com", phoneNumber: "", phoneVerified: false },
  }),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/hooks/use-manager-dashboard", () => ({
  useManagerDashboard: () => ({ locations: h.locations, isLoadingLocations: false }),
}));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: unknown }) => children,
  useLocation: () => ["/manager/setup", vi.fn()],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
  }),
}));
vi.mock("@onboardjs/react", () => ({
  useOnboarding: () => ({
    currentStep: { id: "create-kitchen", payload: {} },
    isCompleted: false,
    next: vi.fn(),
    previous: vi.fn(),
    skip: vi.fn(),
    state: {},
    engine: {
      goToStep: vi.fn(),
      reset: vi.fn(async () => {}),
      addStepCompletedListener: vi.fn(() => vi.fn()),
      addFlowCompletedListener: vi.fn(() => vi.fn()),
    },
  }),
}));

import { ManagerOnboardingLogic, useManagerOnboarding } from "./ManagerOnboardingContext";

let ctx: ReturnType<typeof useManagerOnboarding>;

function Probe() {
  ctx = useManagerOnboarding();
  return null;
}

async function mountAndSettle() {
  render(
    <ManagerOnboardingLogic isOpen={false} setIsOpen={vi.fn()}>
      <Probe />
    </ManagerOnboardingLogic>,
  );
  for (let i = 0; i < 4; i++) await act(async () => {});
}

/** The kitchen POST answers as the case wants; every other call (profile, step record) succeeds. */
function stubFetch() {
  h.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (typeof url === "string" && url.includes("/api/manager/kitchens") && init?.method === "POST") {
      if (h.kitchenCreateThrows) throw new Error("network down");
      return h.kitchenCreateOk
        ? { ok: true, json: async () => ({ id: 99, name: "Harbour Kitchen" }) }
        : { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", h.fetch);
}

beforeEach(() => {
  h.locations = [{ id: 7, name: "Harbour Kitchen", address: "1 Water St" }];
  h.kitchenCreateOk = true;
  h.kitchenCreateThrows = false;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("createKitchen — the return value the caller gates on", () => {
  it("resolves true when the kitchen was created, and puts it in the list", async () => {
    await mountAndSettle();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx.createKitchen();
    });

    expect(result).toBe(true);
    expect(ctx.kitchens.map((k: any) => k.id)).toContain(99);
    expect(ctx.selectedKitchenId).toBe(99);
  });

  it("resolves false when the request is refused, and adds nothing", async () => {
    h.kitchenCreateOk = false;
    await mountAndSettle();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx.createKitchen();
    });

    expect(result).toBe(false);
    expect(ctx.kitchens).toEqual([]);
  });

  it("resolves false when the request throws, and adds nothing", async () => {
    h.kitchenCreateThrows = true;
    await mountAndSettle();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx.createKitchen();
    });

    expect(result).toBe(false);
    expect(ctx.kitchens).toEqual([]);
  });

  it("resolves false — never a silent success — when there is no location to hang it on", async () => {
    /*
     * The old code was `if (!selectedLocationId) return;`. That is indistinguishable from success
     * for the caller, which is how the step advanced with nothing created. Every later step needs
     * a kitchen, so this is a real failure and the manager has to hear about it.
     */
    h.locations = [];
    await mountAndSettle();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx.createKitchen();
    });

    expect(result).toBe(false);
    expect(ctx.kitchens).toEqual([]);
  });

  it("sends NO hourly rate when the kitchen is priced only by the day", async () => {
    /*
     * The listing gate accepts an hourly OR a daily rate — its own label is "Hourly or daily rate"
     * — so a daily-only kitchen is a real kitchen and the form now lets one be created.
     *
     * The request has to carry that honestly. The hourly used to be computed unconditionally:
     * `parseFloat('')` is NaN, `Math.round(NaN)` is NaN, and `JSON.stringify` turns NaN into
     * `null` — which the endpoint rejects ("Hourly rate must be nonnegative integer cents"),
     * because it tests `!== undefined`. So a daily-only create 400'd on a rate the manager never
     * typed. `undefined` is the answer: the field was left blank.
     */
    await mountAndSettle();

    await act(async () => {
      ctx.kitchenForm.setData({
        name: "Harbour Kitchen",
        description: "A bright prep kitchen",
        hourlyRate: "",
        dailyRate: "150.00",
        currency: "CAD",
        minimumBookingHours: "1",
        imageUrl: "https://cdn.example.com/cover.png",
        features: [],
      });
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx.createKitchen();
    });

    expect(result).toBe(true);

    const create = h.fetch.mock.calls.find(
      ([url, init]: any[]) => String(url).includes("/api/manager/kitchens") && init?.method === "POST",
    );
    const body = JSON.parse((create as any[])[1].body);
    expect(body.hourlyRate).toBeUndefined();
    expect(body.dailyRate).toBe(15000);
  });
});
