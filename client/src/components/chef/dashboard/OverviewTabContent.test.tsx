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

it('labels booking 138 with its overnight calendar date and localized clock', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  try {
    render(<OverviewTabContent {...props()} enrichedBookings={[{ id: 138, kitchenId: 1, kitchenName: 'Overnight kitchen', status: 'confirmed',
      bookingDate: '2026-10-15T00:00:00Z', startTime: '04:45', endTime: '05:45', operatingWindowStartTime: '06:00' }]} />);
    expect(screen.getAllByText(/Oct 16/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    // Same 12-hour range as My bookings and the booking page ("4:45–5:45 a.m.").
    expect(screen.getAllByText(/4:45–5:45\s*a\.m\./).length).toBeGreaterThan(0);
  } finally { vi.useRealTimers(); }
});
