import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EnhancedAuthPage from "./EnhancedAuthPage";
import { saveSellerJourneyDraft } from "@/lib/seller-journey";

const state = vi.hoisted(() => ({
  user: null as any,
  firebase: { currentUser: null as any },
  logout: vi.fn(),
  updateUserVerification: vi.fn(),
  end: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({ auth: state.firebase }));
vi.mock("firebase/auth", () => ({ isSignInWithEmailLink: () => false }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({
  user: state.user, loading: false, authPhase: "idle", logout: state.logout,
  updateUserVerification: state.updateUserVerification,
  handleEmailLinkSignIn: async () => {}, refreshUserData: async () => null,
}) }));
vi.mock("@/components/auth/AuthTransition", () => ({
  useAuthTransition: () => ({ begin: vi.fn(), end: state.end }),
}));
vi.mock("@/components/ui/custom-alerts", () => ({ useCustomAlerts: () => ({ showAlert: vi.fn() }) }));
vi.mock("@/components/SEO/SEOHead", () => ({ default: () => null }));
vi.mock("@/components/ui/logo", () => ({ default: () => null }));
vi.mock("@/components/auth/ChefAuthShowcase", () => ({ default: () => null }));
vi.mock("@/pages/welcome-screen", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthFlow", () => ({ default: ({ step, registerProps }: any) => (
  <div data-testid="auth-flow" data-step={step}
    data-terms-inline={String(registerProps.showTermsInline)}
    data-terms-accepted={String(registerProps.initialTermsAccepted)} />
) }));

beforeEach(() => {
  localStorage.clear();
  state.user = null;
  state.firebase.currentUser = null;
  state.logout.mockReset();
  state.updateUserVerification.mockReset();
  window.history.replaceState({}, "", "/auth?tab=register");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    email: "wrong@example.com", is_verified: false, termsAccepted: false,
  }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("Auth registration terms and recovery", () => {
  it("does not require an inline checkbox or silently record acceptance on ordinary /auth", async () => {
    render(<EnhancedAuthPage />);
    const flow = await screen.findByTestId("auth-flow");
    expect(flow).toHaveAttribute("data-terms-inline", "false");
    expect(flow).toHaveAttribute("data-terms-accepted", "false");
  });

  it("keeps inline acceptance for a seller journey without a previously accepted draft", async () => {
    window.history.replaceState({}, "", "/auth?tab=register&journey=seller");
    render(<EnhancedAuthPage />);
    expect(await screen.findByTestId("auth-flow")).toHaveAttribute("data-terms-inline", "true");
  });

  it("reuses explicit acceptance from the seller draft", async () => {
    window.history.replaceState({}, "", "/auth?tab=register&journey=seller");
    saveSellerJourneyDraft({ fullName: "Chef", email: "chef@example.com", phone: "4165551234",
      kitchenPreference: "commercial", termsAccepted: true, termsAcceptedAt: Date.now() });
    render(<EnhancedAuthPage />);
    const flow = await screen.findByTestId("auth-flow");
    expect(flow).toHaveAttribute("data-terms-inline", "false");
    expect(flow).toHaveAttribute("data-terms-accepted", "true");
  });

  it("signs out the unverified session and stays on the empty identifier gate after a failed verification check", async () => {
    state.user = { uid: "wrong-user", email: "wrong@example.com", emailVerified: false };
    state.firebase.currentUser = { ...state.user, getIdToken: async () => "fixture-token" };
    state.updateUserVerification.mockResolvedValue({ is_verified: false });
    let finishLogout!: () => void;
    state.logout.mockImplementation(() => new Promise<void>(resolve => {
      finishLogout = () => { state.user = null; state.firebase.currentUser = null; resolve(); };
    }));
    const view = render(<EnhancedAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "I have verified my email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("haven't detected verification yet");
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(state.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("auth-flow")).not.toBeInTheDocument();
    finishLogout();
    await waitFor(() => expect(screen.getByTestId("auth-flow")).toHaveAttribute("data-step", "identifier"));
    view.rerender(<EnhancedAuthPage />);
    expect(screen.queryByRole("button", { name: "I have verified my email" })).not.toBeInTheDocument();
  });
});
