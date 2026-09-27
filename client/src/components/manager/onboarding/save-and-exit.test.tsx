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
    locations: [{ id: 1, name: "Harbour Kitchen", address: "1 Water St" }],
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
