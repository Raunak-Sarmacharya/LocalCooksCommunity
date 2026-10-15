import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "u" } }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-tour-clock", () => ({ useTourClock: () => undefined }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isError: false, isLoading: false }) }));
vi.mock("@/components/chef/seller-revenue/hooks/useSellerRevenue", () => ({
  useShopStatus: () => ({ data: undefined }), useStripeDashboardLink: () => ({ mutateAsync: vi.fn() }), openChefShopHome: vi.fn(),
}));
vi.mock("./GetStartedPathCards", () => ({ KitchenPathEmptyCard: () => null, SellerPathEmptyCard: () => null }));
vi.mock("react-i18next", async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import("@/test/booking-i18n")).useBookingTranslation }));

import OverviewTabContent from "./OverviewTabContent";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

// "Now" is Thu Oct 15 2026, 11:00 a.m. NDT (13:30Z).
const NOW = Date.parse("2026-10-15T13:30:00Z");
const booking = (overrides: Record<string, unknown>) => ({
  id: 1, kitchenId: 1, kitchenName: "PHASE0 Main Kitchen", status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in",
  bookingDate: "2026-10-15T00:00:00Z", startTime: "14:00", endTime: "16:00", locationTimezone: "America/St_Johns", ...overrides,
});
const props = (enrichedBookings: unknown[]) => ({
  user: { displayName: "Ada Lovelace" }, applications: [], kitchenApplications: [],
  kitchenSummary: { label: "None", variant: "outline" as const }, enrichedBookings: enrichedBookings as never,
  getMostRecentApplication: () => null, getApplicationStatus: () => null, getDocumentStatus: () => "",
  onSetActiveTab: vi.fn(), onSetApplicationViewMode: vi.fn(),
});
const tile = () => screen.getByText("Bookings", { selector: "p" }).closest("button")!;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("chef overview bookings tile", () => {
  it("shows the next visit, not the pending request, and counts requests separately", () => {
    render(<OverviewTabContent {...props([
      booking({ id: 9, kitchenName: "Night Kitchen", status: "pending", paymentStatus: "authorized", bookingDate: "2026-10-17T00:00:00Z", startTime: "01:05", endTime: "02:05" }),
      booking({ id: 10 }),
      booking({ id: 11, bookingDate: "2026-10-20T00:00:00Z" }),
    ])} />);
    expect(within(tile()).getByText("Next: Today 2:00 p.m.")).toBeInTheDocument();
    expect(within(tile()).getByText("PHASE0 Main Kitchen · 1 request pending")).toBeInTheDocument();
    expect(within(tile()).queryByText(/1:05/)).not.toBeInTheDocument();
  });

  it("falls back to the request count when nothing is confirmed yet", () => {
    render(<OverviewTabContent {...props([booking({ status: "pending", paymentStatus: "authorized" })])} />);
    expect(within(tile()).getByText("1 request pending")).toBeInTheDocument();
  });

  it("lists bookings with the booking page pill, in My bookings order", () => {
    render(<OverviewTabContent {...props([
      booking({ id: 20, kitchenName: "Later Kitchen", bookingDate: "2026-10-20T00:00:00Z" }),
      booking({ id: 21, kitchenName: "Live Kitchen", startTime: "10:00", endTime: "12:00", checkinStatus: "checked_in" }),
    ])} />);
    const pills = screen.getAllByTestId("booking-status-pill").map(element => element.textContent);
    expect(pills).toEqual(["In session", "Confirmed"]);
    expect(screen.getByText("Today · 10:00 a.m.–12:00 p.m.")).toBeInTheDocument();
  });
});
