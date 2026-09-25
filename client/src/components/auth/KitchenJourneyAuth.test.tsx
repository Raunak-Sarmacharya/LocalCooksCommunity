import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KitchenJourneyAuth from "./KitchenJourneyAuth";
import { kitchenJourneyEmailKey } from "@/lib/kitchen-journey-email";
import { isMissingProfileError } from "@/lib/login-challenge";
import { setGoogleRegistrationActive } from "@/lib/pending-google-registration";

const authState = vi.hoisted(() => ({
  user: null as null | { email: string; is_verified: boolean },
  loading: false,
  authenticateWithGoogle: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({
    ...authState,
    authenticateWithGoogle: authState.authenticateWithGoogle,
    updateUserVerification: vi.fn(),
    refreshUserData: vi.fn(),
    discardPendingGoogleRegistration: vi.fn(),
  }),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("./AuthFlow", () => ({
  default: ({ initialIdentifier, onGoogleSignIn }: { initialIdentifier: string; onGoogleSignIn: () => Promise<void> }) => (
    <div data-testid="auth-flow">{initialIdentifier}<button onClick={() => void onGoogleSignIn().catch((error) => {
      if (isMissingProfileError(error)) document.body.dataset.googleRegistration = "ready";
    })}>Continue with Google</button></div>
  ),
}));

describe("KitchenJourneyAuth verification return", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authState.user = null;
    authState.loading = false;
    authState.authenticateWithGoogle.mockReset();
    delete document.body.dataset.googleRegistration;
    setGoogleRegistrationActive(null);
    window.history.replaceState({}, "", "/request-tour/42?kitchenId=17");
  });
  afterEach(cleanup);

  it("uses the same saved email before and after a verification query parameter", () => {
    const key = kitchenJourneyEmailKey(window.location.pathname, window.location.search);
    localStorage.setItem(key, "chef@example.com");
    window.history.replaceState({}, "", "/request-tour/42?kitchenId=17&verified=true");

    render(<KitchenJourneyAuth title="Continue your tour request" />);

    expect(screen.getByText(/Your email is verified/)).toHaveTextContent("chef@example.com");
    expect(screen.getByTestId("auth-flow")).toHaveTextContent("chef@example.com");
    expect(localStorage.getItem(key)).toBe("chef@example.com");
  });

  it("keeps the email while signed out and lets the chef resume sign-in in place", () => {
    localStorage.setItem(kitchenJourneyEmailKey("/apply-kitchen/42", ""), "chef@example.com");
    window.history.replaceState({}, "", "/apply-kitchen/42");

    render(<KitchenJourneyAuth title="Continue your access request" />);

    expect(screen.getByText(/Open the verification link/)).toHaveTextContent("chef@example.com");
    fireEvent.click(screen.getByRole("button", { name: /I verified my email/ }));
    expect(screen.getByTestId("auth-flow")).toHaveTextContent("chef@example.com");
  });

  it("prefills a seller email without mistaking it for a pending verification", () => {
    window.history.replaceState({}, "", "/?journey=seller");
    render(<KitchenJourneyAuth title="Continue your seller journey" initialEmail="chef@example.com" />);

    expect(screen.getByTestId("auth-flow")).toHaveTextContent("chef@example.com");
    expect(screen.queryByText(/Open the verification link/)).not.toBeInTheDocument();
  });

  it.each(["/request-tour/42?kitchenId=17", "/apply-kitchen/42?kitchenId=17"])(
    "takes a new Google chef into registration without losing %s",
    async (path) => {
      window.history.replaceState({}, "", path);
      authState.authenticateWithGoogle.mockResolvedValue({ existing: false, email: "google@example.com", displayName: "Google Chef" });
      render(<KitchenJourneyAuth title="Continue your request" />);

      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

      await waitFor(() => expect(authState.authenticateWithGoogle).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(document.body.dataset.googleRegistration).toBe("ready"));
      expect(window.location.pathname + window.location.search).toBe(path);
    },
  );
});
