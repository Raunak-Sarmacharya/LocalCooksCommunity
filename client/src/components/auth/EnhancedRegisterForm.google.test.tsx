import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EnhancedRegisterForm from "./EnhancedRegisterForm";
import { markPendingGoogleRegistration, setGoogleRegistrationActive } from "@/lib/pending-google-registration";

const { currentUser, syncUserWithBackend } = vi.hoisted(() => ({
  currentUser: { uid: "google-user", email: "chef@example.com", displayName: "Google Chef" },
  syncUserWithBackend: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser } }));
vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({ user: null, loading: false, error: null, syncUserWithBackend }),
}));
vi.mock("@/components/ui/custom-alerts", () => ({
  useCustomAlerts: () => ({ showAlert: vi.fn() }),
}));

describe("Google registration details", () => {
  beforeEach(() => {
    localStorage.clear();
    syncUserWithBackend.mockReset();
    markPendingGoogleRegistration({ uid: currentUser.uid, email: currentUser.email, createdIdentity: true });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setGoogleRegistrationActive(null);
  });

  it("shows the verified Google address in the locked field without a duplicate notice", () => {
    render(<EnhancedRegisterForm animateEntrance={false} />);

    expect(screen.getByRole("textbox", { name: /full name/i })).toHaveValue("Google Chef");
    expect(screen.getByRole("textbox", { name: /email address/i })).toHaveValue("chef@example.com");
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeDisabled();
    expect(screen.getByText("From your Google account, which is already verified.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /phone number/i })).toBeRequired();
    expect(screen.queryByText(/Google connected as/)).not.toBeInTheDocument();
  });

  it("does not create an account before the required phone is supplied", async () => {
    render(<EnhancedRegisterForm animateEntrance={false} />);

    fireEvent.submit(screen.getByRole("button", { name: /create account/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Phone number is required")).toBeInTheDocument());
    expect(syncUserWithBackend).not.toHaveBeenCalled();
  });
});
