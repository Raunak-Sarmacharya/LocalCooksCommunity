import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Save & exit" must write the part the manager is on.
 *
 * The reported bug: a manager filled in part 1 of the Business step, pressed "Save & exit", and
 * came back to an empty form for a step the wizard called done. The button writes only the STEP
 * record — which is a different thing from the manager's work, and the footer only calls it
 * "Save & exit" while there IS unsaved work to write (`hasUnsavedWork`).
 *
 * The step registers a save callback for exactly this purpose (`registerStepSave`), and Back,
 * Skip and jump-to-step already run it through `guardLeave`. This file pins the exit path, which
 * was the one that did not.
 *
 * The context is rendered for real — the rule lives inside `saveAndExit`, and a mocked context
 * would only prove the mock. Everything the context reaches for that is not the rule under test
 * (onboardjs, auth, react-query, the dashboard hook, the router) is mocked.
 */
const h = vi.hoisted(() => ({
  /** The step's registered save. Resolves `true` unless a case says otherwise. */
  partSave: vi.fn<() => Promise<boolean>>(async () => true),
  setLocation: vi.fn(),
  fetch: vi.fn(),
  /** The manager's locations. What `completedSteps` derives from, so cases vary it. */
  locations: [] as any[],
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({
    user: { uid: "u1", email: "manager@example.com", phoneNumber: "", phoneVerified: false },
  }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("@/hooks/use-manager-dashboard", () => ({
  useManagerDashboard: () => ({
    locations: h.locations,
    isLoadingLocations: false,
  }),
}));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: unknown }) => children,
  useLocation: () => ["/manager/setup", h.setLocation],
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
    currentStep: { id: "location", payload: {} },
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

type Ctx = ReturnType<typeof useManagerOnboarding>;
let ctx: Ctx;

function Probe() {
  ctx = useManagerOnboarding();
  return null;
}

/** Every write the exit makes, so a case can assert on the whole shape of it. */
function stepRecordPosts() {
  return h.fetch.mock.calls.filter(
    ([url]) => typeof url === "string" && url.includes("/api/manager/onboarding/step"),
  );
}

async function renderExit() {
  render(
    <ManagerOnboardingLogic isOpen={false} setIsOpen={vi.fn()}>
      <Probe />
    </ManagerOnboardingLogic>,
  );
  await act(async () => {});
}

beforeEach(() => {
  h.locations = [{ id: 1, name: "Harbour Kitchen", address: "1 Water St" }];
  h.partSave = vi.fn(async () => true);
  h.setLocation.mockClear();
  h.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Save & exit — the part is written before leaving", () => {
  it("saves the part, then records the step, then leaves", async () => {
    /*
     * The ORDER is the point: the part is written BEFORE the record and before leaving, so the
     * record can never describe work that was not stored.
     *
     * The location carries a licence because the Business step's completion IS the licence being on
     * the record — without one there is nothing to record, which is the next block's subject.
     */
    h.locations = [{
      id: 1,
      name: "Harbour Kitchen",
      address: "1 Water St",
      kitchenLicenseUrl: "https://cdn.example.com/license.pdf",
      kitchenLicenseExpiry: "2027-03-01",
    }];
    await renderExit();

    await act(async () => {
      ctx.registerStepSave(h.partSave);
      ctx.setUnsavedChanges(true);
    });

    await act(async () => {
      await ctx.saveAndExit();
    });

    expect(h.partSave).toHaveBeenCalledTimes(1);
    expect(stepRecordPosts()).toHaveLength(1);
    expect(h.setLocation).toHaveBeenCalledTimes(1);
  });

  it("does not write the part when there is nothing to write", async () => {
    /*
     * The negative half of the rule above, and the one that keeps it honest: a clean part must
     * not be re-saved just because the manager is leaving. Without this, "the part is saved"
     * would also pass for code that saves unconditionally — which is the round-trip that made a
     * revisit of a finished step feel like setting it up again.
     */
    await renderExit();

    await act(async () => {
      ctx.registerStepSave(h.partSave);
      ctx.setUnsavedChanges(false);
    });

    await act(async () => {
      await ctx.saveAndExit();
    });

    expect(h.partSave).not.toHaveBeenCalled();
    expect(h.setLocation).toHaveBeenCalledTimes(1);
  });

  it("stays put when the part fails to save, rather than dropping the work", async () => {
    /*
     * The label just promised the work would be kept. Leaving on a failed save makes that a lie
     * in the worst direction — the manager believes it is stored and it is gone — so the exit
     * has to be abandoned, and the step has already said why.
     */
    h.partSave = vi.fn(async () => false);
    await renderExit();

    await act(async () => {
      ctx.registerStepSave(h.partSave);
      ctx.setUnsavedChanges(true);
    });

    await act(async () => {
      await ctx.saveAndExit();
    });

    expect(h.partSave).toHaveBeenCalledTimes(1);
    expect(h.setLocation).not.toHaveBeenCalled();
  });
});

/**
 * What the exit RECORDS, which is a different question from what it saves.
 *
 * The record used to be written for whatever step the manager was standing on, so leaving a step
 * said "I was here" and every progress surface read it as "I finished". That is why opening
 * Availability or Booking Requirements and pressing Exit ticked them off, and why the wizard's rail
 * and the dashboard's banner disagreed about the Business step — the rail ORs the flag into a
 * licence check the banner cannot see.
 *
 * The other half is the trap this must not re-open: `ManagerProtectedRoute` reads the record's
 * NON-EMPTINESS as "has started onboarding". Stop writing it entirely and "Maybe later" bounces a
 * manager straight back to the wizard, twice in a row.
 */
describe("Save & exit — what it records", () => {
  it("records NOTHING for a step the manager has not finished", async () => {
    // The Business step's completion is the licence being on the record, and this location has none.
    await renderExit();
    await act(async () => { await ctx.saveAndExit(); });

    expect(stepRecordPosts()).toHaveLength(0);
    // Still leaves — the record is not what lets them out of the wizard.
    expect(h.setLocation).toHaveBeenCalledTimes(1);
  });

  it("records the step when it IS finished", async () => {
    h.locations = [{
      id: 1,
      name: "Harbour Kitchen",
      address: "1 Water St",
      kitchenLicenseUrl: "https://cdn.example.com/license.pdf",
      kitchenLicenseExpiry: "2027-03-01",
    }];
    await renderExit();
    await act(async () => { await ctx.saveAndExit(); });

    expect(stepRecordPosts()).toHaveLength(1);
    expect(JSON.parse(stepRecordPosts()[0][1].body).stepId).toBe("location");
  });

  it("records `welcome` with no location, so the manager can still reach the dashboard", async () => {
    /*
     * With no location there is no step that could be complete, and `welcome` is honestly what
     * "started onboarding" means — the wizard's own comment calls the step complete once a manager
     * has left it. Recording nothing here is what trapped managers on the welcome screen.
     */
    h.locations = [];
    await renderExit();
    await act(async () => { await ctx.saveAndExit(); });

    expect(stepRecordPosts()).toHaveLength(1);
    expect(JSON.parse(stepRecordPosts()[0][1].body).stepId).toBe("welcome");
    expect(h.setLocation).toHaveBeenCalledTimes(1);
  });
});
