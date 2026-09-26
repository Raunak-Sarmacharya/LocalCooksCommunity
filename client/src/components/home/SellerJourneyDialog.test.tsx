import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SellerJourneyDialog from "./SellerJourneyDialog";
import { getSellerJourneyDraft, saveSellerJourneyDraft } from "@/lib/seller-journey";

const { account, flags, beginHandoff, navigateMock } = vi.hoisted(() => ({
  account: {
    uid: "chef-1",
    email: "chef@example.com",
    displayName: "Ada Cook",
    phoneNumber: "+17095550123",
    is_verified: true,
    phoneVerified: false,
  },
  // Pinned so the phone branch does not depend on whether a local .env sets the flag.
  flags: { phoneAuth: true },
  beginHandoff: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({ user: account, loading: false, refreshUserData: vi.fn() }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { emailVerified: true, getIdToken: vi.fn().mockResolvedValue("token") } },
}));
vi.mock("@/components/auth/KitchenJourneyAuth", () => ({
  default: () => <div>Account form</div>,
}));
vi.mock("@/lib/feature-flags", () => ({
  get PHONE_AUTH_ENABLED() { return flags.phoneAuth; },
}));
// The cross-route handoff lives above the router in the app; here it is a spy.
vi.mock("@/components/auth/AuthTransition", () => ({
  useAuthTransition: () => ({ begin: beginHandoff, end: vi.fn(), isHolding: false }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", navigateMock] }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** First call is the existing-application check, second is the POST itself. */
function stubSubmit(existing: unknown[] = [], submitOk = true) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/firebase/applications/my") return { ok: true, json: async () => existing };
    if (url === "/api/firebase/applications") return { ok: submitOk, text: async () => "" };
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function submittedBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/firebase/applications");
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

const submitButton = () => screen.getByRole("button", { name: "Submit application" });

describe("seller journey review", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    account.phoneVerified = false;
    flags.phoneAuth = true;
    beginHandoff.mockReset();
    navigateMock.mockReset();
    saveSellerJourneyDraft({
      fullName: "",
      email: "",
      phone: "",
      kitchenPreference: "commercial",
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("prefills the name as an editable field and keeps the email read-only", () => {
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Cook");
    expect(screen.getByTestId("seller-journey-review")).toHaveTextContent("chef@example.com");
    // The email is the account's identity anchor, so it is never an editable control.
    expect(screen.queryByDisplayValue("chef@example.com")).not.toBeInTheDocument();
  });

  it("blocks submission when the name is cleared and keeps the draft", async () => {
    const fetchMock = stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "   " } });
    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Add your full name before submitting.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSellerJourneyDraft()).not.toBeNull();
  });

  it("submits the edited name rather than the account name", async () => {
    const fetchMock = stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText("Application submitted")).toBeInTheDocument());
    expect(submittedBody(fetchMock).fullName).toBe("Ada Lovelace");
    expect(submittedBody(fetchMock).email).toBe("chef@example.com");
  });

  it("blocks the whole dialog behind the overlay while the submit is in flight", async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown[]> }>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => gate.promise)
      .mockImplementation(async () => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());

    expect(await screen.findByText("Checking your applications…")).toBeInTheDocument();
    // The dialog is closed while `status !== "idle"`, which is what makes the
    // body-level overlay genuinely blocking and its controls clickable.
    expect(screen.queryByTestId("seller-journey-review")).not.toBeInTheDocument();

    gate.resolve({ ok: true, json: async () => [] });
    await waitFor(() => expect(screen.getByText("Application submitted")).toBeInTheDocument());
  });

  it("offers both hand-offs once submitted, and marks the journey as submitted", async () => {
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText("Application submitted")).toBeInTheDocument());
    expect(getSellerJourneyDraft()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View my application" }));

    expect(sessionStorage.getItem("localcooks:seller-journey-result")).toBe("submitted");
    expect(beginHandoff).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/dashboard?view=applications&journey=submitted");
  });

  it("sends the dashboard hand-off without the documents marker", async () => {
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText("Application submitted")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));

    expect(sessionStorage.getItem("localcooks:seller-journey-result")).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("retains the draft when submission fails", async () => {
    stubSubmit([], false);
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your draft is saved"));
    expect(getSellerJourneyDraft()).not.toBeNull();
  });

  it("stops at the existing application instead of submitting a second one", async () => {
    const fetchMock = stubSubmit([{ status: "pending" }]);
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());

    expect(await screen.findByText(/already have an active application/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/firebase/applications")).toHaveLength(0);
  });

  it("offers to verify an unproved number and explains why", () => {
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("seller-journey-review")).toHaveTextContent("(709) 555-0123");
    expect(screen.getByRole("button", { name: "Verify number" })).toBeInTheDocument();
    expect(screen.getByText(/sign in with it next time/i)).toBeInTheDocument();
  });

  it("renders a proved phone read-only, with no verify affordance", () => {
    account.phoneVerified = true;
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("seller-journey-review")).toHaveTextContent("(709) 555-0123");
    expect(screen.queryByRole("button", { name: "Verify number" })).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in with it next time/i)).not.toBeInTheDocument();
  });

  it("falls back to the account profile when phone auth is switched off", () => {
    flags.phoneAuth = false;
    account.phoneNumber = "";
    stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("link", { name: "account profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a phone number" })).not.toBeInTheDocument();
  });

  it("blocks submission when the account has no number, since the schema requires one", async () => {
    account.phoneNumber = "";
    const fetchMock = stubSubmit();
    render(<SellerJourneyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Add a phone number before submitting.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
