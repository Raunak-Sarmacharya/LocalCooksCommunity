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

it.each([
  { connected: true, submitted: true, label: "onboardingStripeConnected" },
  { connected: false, submitted: true, label: "verificationPending" },
  { connected: false, submitted: false, label: "onboardingConnectStripe" },
])("shows Stripe status in the summary: $label", ({ connected, submitted, label }) => {
  state.connected = connected;
  state.submitted = submitted;
  render(<CompletionSummaryStep />);
  if (!submitted) expect(screen.getByText("onboardingPayments")).toBeInTheDocument();
  else {
    expect(screen.queryByText("onboardingPayments")).toBeNull();
    expect(screen.getByText(label, { selector: submitted && !connected ? "button" : "span" }).closest("li")?.parentElement?.tagName).toBe("OL");
  }
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  if (!connected) {
    fireEvent.click(submitted ? screen.getByRole("button", { name: label }) : screen.getByText("onboardingPayments"));
    expect(state.goToStep).toHaveBeenCalledWith("payment-setup");
  }
  if (submitted) expect(screen.getByText("goToDashboard")).toBeInTheDocument();
  if (submitted && !connected) expect(screen.queryByText("kitchenReadyForBookings")).toBeNull();
});
