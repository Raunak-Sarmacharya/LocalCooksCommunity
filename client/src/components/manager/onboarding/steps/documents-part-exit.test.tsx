import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Save & exit" on the documents part must write the expiry date the manager entered.
 *
 * The reported bug: upload the licence, pick an expiry date, press "Save & exit" — and the app
 * demands a date that is already on screen. Two layers were involved:
 *
 * 1. `LocationStep` registered its leave-the-step save in an effect whose deps were
 *    `[..., partSignature, documentsDirty]`. `documentsDirty` is a BOOLEAN over two independent
 *    facts: uploading the licence flips it false → true, and setting the expiry date leaves it
 *    TRUE. So the second edit re-registered nothing, and the registered save stayed the closure
 *    from the moment the upload finished — the one where the expiry was still `""`.
 * 2. `persistLocation` only includes `kitchenLicenseExpiry` when it is truthy, so the PUT carried
 *    `kitchenLicenseUrl` with no expiry. The server refuses that by design
 *    (`server/routes/manager.ts`: "A license expiry date is required when uploading a kitchen
 *    license") and the manager was told to enter a date they had already entered.
 *
 * Only the REGISTERED save was stale — Continue calls `saveLocationFull` from the current render.
 * The exit button is what started using the registered one.
 *
 * The assertion is on the REQUEST BODY, not on the UI: the bug was invisible on screen, and the
 * body is what the server judges.
 */
const h = vi.hoisted(() => ({
  toasts: [] as any[],
  setLocation: vi.fn(),
  locations: [] as any[],
  fetch: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => (key === "continue" ? "Continue" : key) }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: any) => h.toasts.push(t) }),
}));
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
  Link: ({ children }: any) => children,
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
vi.mock("@/hooks/useSessionFileUpload", () => ({
  useSessionFileUpload: () => ({ uploadFile: vi.fn(async () => ({ url: "https://cdn.example.com/logo.png" })) }),
}));
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  LogoPhotoField: () => null,
}));
vi.mock("@/components/auth/PhoneSignInSettings", () => ({ default: () => null }));
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({ labels, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>{labels?.idle}</button>
  ),
}));

import { ManagerOnboardingLogic, useManagerOnboarding } from "../ManagerOnboardingContext";
import LocationStep from "./LocationStep";

let ctx: any;
function Probe() {
  ctx = useManagerOnboarding();
  return null;
}

/** A location with everything EXCEPT the licence, so the step opens on the documents part. */
function locationWithoutLicence() {
  return {
    id: 7,
    name: "Harbour Kitchen",
    address: "1 Water St",
    logoUrl: "https://cdn.example.com/logo.png",
    preferredContactMethod: "email",
    contactEmail: "manager@example.com",
    contactPhone: "",
    kitchenLicenseUrl: null,
    kitchenLicenseExpiry: null,
  };
}

async function mount() {
  render(
    <ManagerOnboardingLogic isOpen={false} setIsOpen={vi.fn()}>
      <Probe />
      <LocationStep />
    </ManagerOnboardingLogic>,
  );
  for (let i = 0; i < 6; i++) await act(async () => {});
}

beforeEach(() => {
  h.toasts = [];
  h.setLocation.mockClear();
  h.locations = [locationWithoutLicence()];
  h.fetch = vi.fn(async (url: string, init?: any) => {
    if (typeof url === "string" && url.includes("/api/files/upload-file")) {
      return { ok: true, json: async () => ({ url: "https://cdn.example.com/license.pdf" }) };
    }
    /*
     * The location write, answered the way the SERVER answers it.
     *
     * The rule is real and lives in `server/routes/manager.ts`: a licence URL with no expiry is
     * refused, because a licence nobody can date cannot be reviewed or warned about. Encoding the
     * server's own sentence here is what makes this file catch the regression whatever the
     * client-side cause — the bug was invisible on screen and only the response revealed it.
     */
    if (typeof url === "string" && url.includes("/api/manager/locations")) {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (body.kitchenLicenseUrl && !body.kitchenLicenseExpiry) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "A license expiry date is required when uploading a kitchen license.",
          }),
        };
      }
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The body the exit wrote to the location record. */
function locationWriteBody(): any {
  const call = h.fetch.mock.calls.find(
    (c: any) => String(c[0]).includes("/api/manager/locations") && c[1]?.method === "PUT",
  );
  return call ? JSON.parse(call[1].body) : null;
}

/** The exit button, which is only named "Save & exit" while the part actually holds edits. */
function exitButton() {
  const button = screen.queryByRole("button", { name: "saveAndExitButton" });
  expect(button).not.toBeNull();
  return button!;
}

describe("Business step — Save & exit from the documents part", () => {
  /** The manager's two edits, in the order they actually make them. */
  async function uploadLicenceThenSetDate() {
    await act(async () => {
      await ctx.licenseForm.uploadFile(new File(["x"], "license.pdf", { type: "application/pdf" }));
    });
    await act(async () => {
      ctx.licenseForm.setExpiryDate("2027-03-01");
    });
  }

  it("writes the licence AND the expiry date the manager just entered", async () => {
    /*
     * The date must be the one on screen at exit time, not the one the form held when the upload
     * finished. Setting the date does not change the dirty flag (it is already true from the
     * upload), so a dependency-array registration never refreshed and kept the empty expiry.
     */
    await mount();
    await uploadLicenceThenSetDate();

    await act(async () => {
      fireEvent.click(exitButton());
    });

    expect(locationWriteBody()).toMatchObject({
      kitchenLicenseUrl: "https://cdn.example.com/license.pdf",
      kitchenLicenseExpiry: "2027-03-01",
    });
  });

  it("is not told to enter a date it has already been given", async () => {
    /*
     * What the manager actually experienced. The server's refusal is the visible half; the body
     * above is the cause, and the two are asserted separately so a failure says which one broke.
     */
    await mount();
    await uploadLicenceThenSetDate();
    h.toasts = [];

    await act(async () => {
      fireEvent.click(exitButton());
    });

    expect(h.toasts.map((t) => t.description)).not.toContain(
      "A license expiry date is required when uploading a kitchen license.",
    );
  });
});
