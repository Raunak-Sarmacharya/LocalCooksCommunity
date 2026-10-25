import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  loading: false,
  error: false,
}));

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "manager-1" } }) }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/components/chef/ui", () => ({ ChefPageHeader: () => <h1>Revenue</h1> }));
vi.mock("@/components/manager/StripeConnectSetup", () => ({ default: () => <div>Stripe setup</div> }));
vi.mock("@/components/manager/revenue", () => ({
  useStripeConnectStatus: () => ({ data: state.status, isLoading: state.loading, isError: state.error, refetch: vi.fn() }),
  useTransactions: () => ({ data: undefined, isLoading: true }),
  useInvoices: () => ({ data: [], isLoading: true }),
  usePayouts: () => ({ data: [], isLoading: true }),
}));
vi.mock("@/components/manager/revenue/hooks/use-manager-revenue", () => ({ useManagerRevenue: () => ({ isLoading: true }) }));
vi.mock("@/components/manager/revenue/components/DateRangePicker", () => ({ DateRangePicker: () => null }));

import ManagerRevenueDashboard from "./ManagerRevenueDashboard";

const props = { selectedLocation: null, locations: [] };
const render = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><ManagerRevenueDashboard {...props} {...extra} /></QueryClientProvider>,
);
const connected = { accountId: "acct_1", hasAccount: true, status: "complete", chargesEnabled: true, payoutsEnabled: true };

afterEach(() => window.history.replaceState(null, "", "/manager/dashboard?view=revenue"));

describe("Revenue: Earnings and Payouts", () => {
  it("opens a brand-new kitchen on Payouts, where Stripe is set up", () => {
    state.status = { hasAccount: false, status: "not_started" };
    const page = render({ hasRevenueHistory: false });
    expect(page).toContain("Stripe setup");
    expect(page).toContain("revenuePayoutsNeedAttention");
  });

  it("opens on Earnings once there is history, with a way to the payout account while it needs attention", () => {
    state.status = { accountId: "acct_1", hasAccount: true, status: "pending", chargesEnabled: false, payoutsEnabled: false };
    const page = render({ hasRevenueHistory: true });
    expect(page).not.toContain("Stripe setup");
    expect(page).toContain("revenueReconnectTitle");
    expect(page).toContain("revenuePayoutsNeedAttention");
  });

  it("shows no prompt for an account that can charge and pay out", () => {
    state.status = connected;
    const page = render({ hasRevenueHistory: true });
    expect(page).not.toContain("revenueReconnectTitle");
    expect(page).not.toContain("revenuePayoutsNeedAttention");
  });

  it("follows ?tab=payouts, which every old Payments link now points at", () => {
    state.status = connected;
    window.history.replaceState(null, "", "/manager/dashboard?view=revenue&tab=payouts");
    expect(render({ hasRevenueHistory: true })).toContain("Stripe setup");
  });
});
