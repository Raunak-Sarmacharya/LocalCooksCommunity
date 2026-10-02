import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
}));

import ManagerRevenueDashboard from "./ManagerRevenueDashboard";

describe("Revenue workspace visibility", () => {
  const props = { selectedLocation: null, locations: [] };

  it("keeps analytics mounted while Stripe is disconnected or its status is unavailable", () => {
    for (const status of [
      {},
      { accountId: "acct_1", hasAccount: true, status: "pending", chargesEnabled: false, payoutsEnabled: false },
    ]) {
      state.status = status;
      const page = ManagerRevenueDashboard(props);
      expect(typeof page.type).toBe("function");
      expect(page.props.showReconnectNotice).toBe(true);
      expect(page.props.hasPaymentAccount).toBe(status.hasAccount === true);
    }

    state.error = true;
    const failed = ManagerRevenueDashboard(props);
    expect(typeof failed.type).toBe("function");
    expect(failed.props.showReconnectNotice).toBe(false);
    state.error = false;
  });

  it("does not show a reconnect prompt for an account that can charge and pay out", () => {
    state.status = { accountId: "acct_1", hasAccount: true, status: "complete", chargesEnabled: true, payoutsEnabled: true };
    const page = ManagerRevenueDashboard(props);
    expect(page.props.showReconnectNotice).toBe(false);
  });

  it("shows one setup path for a new account and keeps history visible for an established account", () => {
    state.status = { hasAccount: false, status: "not_started" };
    const newAccount = renderToStaticMarkup(ManagerRevenueDashboard({ ...props, hasRevenueHistory: false }));
    expect(newAccount).toContain("Stripe setup");
    expect(newAccount).not.toContain("revenueReconnectTitle");

    const established = ManagerRevenueDashboard({ ...props, hasRevenueHistory: true });
    expect(typeof established.type).toBe("function");
    expect(established.props.showReconnectNotice).toBe(true);
  });
});
