import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the Business step's contact part opens with.
 *
 * The reported bug: a manager registers with an email and a phone, and the contact part of the
 * Business step is supposed to open with them already in place. On a resume it opened blank —
 * and the email row is a LOCKED, read-only value, so Continue was disabled with "add a contact
 * email" and no field to add it in. A dead end.
 *
 * The cause was not the prefill effects; it was the order they ran in. The auto-select effect
 * that seeds the form from the fetched location runs LAST in the commit and wrote
 * `loc.contactEmail || ""` — so a location whose row never stored the contact details CLOBBERED
 * the account values the two effects above had just written. The phone effect could not recover
 * either, because its own dependency (`contactPhone`) had not changed from its point of view.
 *
 * The rule now: **the record wins when it has an answer; the ACCOUNT answers when it does not.**
 * `""` is not an answer — a location row that was never given a contact email is silent, not
 * empty, which is the same distinction the listing gate draws between "no row" and "a row that
 * says no".
 *
 * The context is rendered for real; onboardjs, auth, react-query, the dashboard hook and the
 * router are mocked, because none of them is the rule under test.
 */
const h = vi.hoisted(() => ({
  locations: [] as any[],
  account: { uid: "u1", email: "", phoneNumber: "", phoneVerified: false },
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: h.account }) }));
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

let ctx: ReturnType<typeof useManagerOnboarding>;

function Probe() {
  ctx = useManagerOnboarding();
  return null;
}

/**
 * Mount and let the prefill and seeding effects settle.
 *
 * More than one pass on purpose: those effects write the same two fields, so the value that
 * survives is whatever the LAST writer leaves. A single flush would show the first writer and
 * hide the clobbering this file exists to catch.
 */
async function mountAndSettle() {
  render(
    <ManagerOnboardingLogic isOpen={false} setIsOpen={vi.fn()}>
      <Probe />
    </ManagerOnboardingLogic>,
  );
  for (let i = 0; i < 6; i++) await act(async () => {});
}

const contact = () => ({
  email: ctx.locationForm.contactEmail,
  phone: ctx.locationForm.contactPhone,
});

/** A location row, with the contact columns as the caller wants them. */
function location(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "Harbour Kitchen",
    address: "1 Water St",
    logoUrl: "https://cdn.example.com/logo.png",
    preferredContactMethod: "email",
    contactEmail: "manager@example.com",
    contactPhone: "+17095551234",
    ...overrides,
  };
}

beforeEach(() => {
  h.locations = [];
  h.account = { uid: "u1", email: "manager@example.com", phoneNumber: "+17095551234", phoneVerified: true };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Business step — the contact part's opening values", () => {
  it("opens with the account's email and phone for a manager with no location yet", async () => {
    await mountAndSettle();

    expect(contact()).toEqual({ email: "manager@example.com", phone: "+17095551234" });
  });

  it("opens with the ACCOUNT's values when the location's row never stored any", async () => {
    /*
     * The regression. This is the state a resume lands in: part 1 saved the business details, so
     * a location exists, but nothing has written the contact columns yet.
     */
    h.locations = [location({ contactEmail: null, contactPhone: null })];
    await mountAndSettle();

    expect(contact()).toEqual({ email: "manager@example.com", phone: "+17095551234" });
  });

  it("opens with the RECORD's values when the row has them, even where they differ from the account", async () => {
    /*
     * The other half of the rule, and the reason the fallback is a fallback. A location can be
     * reached on a different address or number than the account holds — that is the whole point
     * of storing them per location — so a record that HAS an answer must never be overridden by
     * the account. Values differ from `h.account` deliberately: equal ones would pass either way.
     */
    h.locations = [location({ contactEmail: "kitchen@example.com", contactPhone: "+17095559999" })];
    await mountAndSettle();

    expect(contact()).toEqual({ email: "kitchen@example.com", phone: "+17095559999" });
  });

  it("leaves the fields blank when neither the record nor the account has an answer", async () => {
    /*
     * Negative half of the fallback: it must not invent a value. Without this, "the account fills
     * the gap" would also pass for code that hard-codes the account over the record.
     */
    h.account = { uid: "u1", email: "", phoneNumber: "", phoneVerified: false };
    h.locations = [location({ contactEmail: null, contactPhone: null })];
    await mountAndSettle();

    expect(contact()).toEqual({ email: "", phone: "" });
  });
});
