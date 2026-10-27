import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toursLoading: false, tours: [] as unknown[], navigate: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "u" } }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-tour-clock", () => ({ useTourClock: () => undefined }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("wouter", () => ({ useLocation: () => ["/", h.navigate] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (opts: { queryKey: unknown[] }) => ({ data: opts.queryKey[0] === "/api/viewings" ? h.tours : [], isError: false, isLoading: h.toursLoading }) }));
vi.mock("@/components/chef/seller-revenue/hooks/useSellerRevenue", () => ({
  useShopStatus: () => ({ data: undefined }), useEarningsSummary: () => ({ data: undefined }), useStripeDashboardLink: () => ({ mutateAsync: vi.fn() }), openChefShopHome: vi.fn(),
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
  it("shows the setup checklist once loaded for a chef with nothing started", () => {
    render(<OverviewTabContent {...props()} />);
    expect(screen.queryByTestId("overview-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("homeSetupKitchens")).toBeInTheDocument();
    expect(screen.getByText("homeStepFind")).toBeInTheDocument();
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

describe("setup guide once something is happening (Shopify-style)", () => {
  it("a chef who toured gets Request to apply as the next step; the line expands to the steps, hides, and comes back", async () => {
    const { fireEvent } = await import("@testing-library/react");
    localStorage.clear();
    h.tours = [{ id: 7, status: "completed", locationId: 47, kitchenName: "Harbour Kitchen", scheduledAt: "2026-10-20T14:00:00Z" }];
    render(<OverviewTabContent {...props()} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(screen.getAllByRole("button", { name: "homeRequestToApply" }).length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByText("homeStepRequirements")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "homeHide" }));
    expect(screen.queryByText("homeStepRequirements")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "homeShowGuide" }));
    expect(screen.getByText("homeStepRequirements")).toBeInTheDocument();
    h.tours = [];
  });
});
