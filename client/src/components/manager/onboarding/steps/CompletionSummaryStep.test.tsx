import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CompletionSummaryStep from "./CompletionSummaryStep";

const state = vi.hoisted(() => ({ connected: false, submitted: false, goToStep: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/manager/setup", vi.fn()] }));
vi.mock("../ManagerOnboardingContext", () => ({ useManagerOnboarding: () => ({
  selectedLocation: { id: 1, name: "Kitchen", kitchenLicenseStatus: "approved" },
  kitchens: [{ id: 1 }],
  isStripeConnected: state.connected,
  isStripeOnboardingComplete: state.submitted,
  isAvailabilityComplete: true,
  isRequirementsComplete: true,
  goToStep: state.goToStep,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Payouts can be left for later (owner, Oct 24): setup still finishes, and the row says listing needs them.
it.each([
  { connected: true, submitted: true, label: "onboardingStripeConnected" },
  { connected: false, submitted: true, label: "verificationPending" },
  { connected: false, submitted: false, label: "onboardingPayoutsLater" },
])("shows Stripe status in the summary: $label", ({ connected, submitted, label }) => {
  state.connected = connected;
  state.submitted = submitted;
  render(<CompletionSummaryStep />);
  expect(screen.queryByText("onboardingPayments")).toBeNull();
  expect(screen.getByText(label, { selector: connected ? "span" : "button" }).closest("li")?.parentElement?.tagName).toBe("OL");
  if (!connected) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(state.goToStep).toHaveBeenCalledWith("payment-setup");
    expect(screen.queryByText("kitchenReadyForBookings")).toBeNull();
  }
  if (!submitted) expect(screen.getByText("onboardingPayoutsLaterBody")).toBeInTheDocument();
  expect(screen.getByText("goToDashboard")).toBeInTheDocument();
});
