import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toursLoading: false }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "u" } }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-tour-clock", () => ({ useTourClock: () => undefined }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isError: false, isLoading: h.toursLoading }) }));
vi.mock("@/components/chef/seller-revenue/hooks/useSellerRevenue", () => ({
  useShopStatus: () => ({ data: undefined }), useStripeDashboardLink: () => ({ mutateAsync: vi.fn() }), openChefShopHome: vi.fn(),
}));
vi.mock("./GetStartedPathCards", () => ({ KitchenPathEmptyCard: () => null, SellerPathEmptyCard: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" }, t: (key: string, options?: any) => (typeof options === "string" ? options : options?.defaultValue) ?? key }) }));

import OverviewTabContent from "./OverviewTabContent";

const props = () => ({
  user: { displayName: "Ada Lovelace" }, applications: [], kitchenApplications: [],
  kitchenSummary: { label: "None", variant: "outline" as const }, enrichedBookings: [],
  getMostRecentApplication: () => null, getApplicationStatus: () => null, getDocumentStatus: () => "",
  onSetActiveTab: vi.fn(), onSetApplicationViewMode: vi.fn(),
});

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);

describe("chef dashboard overview loading", () => {
  it("shows skeletons, not the empty 'ovNotStarted' / 'ovNone' state, while data loads", () => {
    render(<OverviewTabContent {...props()} isLoading />);
    expect(screen.getByTestId("overview-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("ovNotStarted")).not.toBeInTheDocument();
    expect(screen.queryByText("ovNone")).not.toBeInTheDocument();
  });
  it("keeps skeletons while tours are still loading", () => {
    h.toursLoading = true;
    render(<OverviewTabContent {...props()} />);
    expect(screen.getByTestId("overview-skeleton")).toBeInTheDocument();
    h.toursLoading = false;
  });
  it("shows the real cards once loaded", () => {
    render(<OverviewTabContent {...props()} />);
    expect(screen.queryByTestId("overview-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("ovNotStarted")).toBeInTheDocument();
  });
});
