vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chef from "@shared/i18n/locales/en-CA/chef.json";
import bookingCopy from "@shared/i18n/locales/en-CA/booking.json";
import { IntlMessageFormat } from "intl-messageformat";

const h = vi.hoisted(() => ({ manager: false, booking: {} as Record<string, unknown> }));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ loading: false, user: { uid: "u" } }) }));
vi.mock("@/components/booking/BookingFeedbackCard", () => ({ BookingFeedbackCard: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock("wouter", () => ({
  useRoute: (pattern: string) => (pattern === "/manager/booking/:id" ? (h.manager ? [true, { id: "5" }] : [false, null]) : (!h.manager && pattern === "/booking/:id" ? [true, { id: "5" }] : [false, null])),
  useLocation: () => ["/", vi.fn()],
  Link: ({ children }: any) => children,
}));
vi.mock("@/layouts/ChefDashboardLayout", () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/layouts/ManagerBookingLayout", () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/layouts/chef-shell-context", () => ({ useChefShellChrome: () => false }));
vi.mock("@/components/ui/smart-image", () => ({ SmartImage: () => null }));
vi.mock("@/components/booking/ClockCloseoutSummary", () => ({ ClockCloseoutSummary: () => <p>Arrival not recorded</p> }));
vi.mock("@/components/booking/BookingPreparation", () => ({ default: () => <p>What to expect</p> }));
const nothing = vi.hoisted(() => () => null);
vi.mock("@/components/booking/KitchenBookingChanges", () => ({ KitchenBookingChanges: nothing }));
vi.mock("@/components/booking/BookingCancellationChooser", () => ({ BookingCancellationChooser: nothing }));
vi.mock("@/components/booking/BookingHistoryPanel", () => ({ BookingHistoryPanel: nothing }));
vi.mock("@/components/booking/BookingAttendancePanel", () => ({ BookingAttendancePanel: nothing }));
vi.mock("@/components/booking/CancellationRefundReview", () => ({ CancellationRefundReview: nothing }));
vi.mock("@/components/booking/BookingPricingBreakdown", () => ({ ChefBookingReceiptBreakdown: nothing, KitchenPayoutStatementBreakdown: nothing }));
vi.mock("@/components/booking/CheckinPolicyTimesCard", () => ({ CheckinPolicyTimesCard: nothing }));
vi.mock("@/components/booking/RefundRequestStatus", () => ({ RefundRequestStatus: nothing }));
vi.mock("@/components/booking/StripeProcessingFeeRefundInfo", () => ({ StripeProcessingFeeRefundInfo: nothing }));
vi.mock("@/components/booking/ServiceFeeInfoPopover", () => ({ ServiceFeeInfoPopover: nothing }));
vi.mock("@/components/booking/BookingRefundPolicyNotice", () => ({ BookingRefundPolicyNotice: () => <p>refund notice</p> }));
vi.mock("@/components/manager/bookings/BookingActionDialog", () => ({ BookingActionDialog: () => null }));
vi.mock("@/components/manager/bookings/BookingManagementDialog", () => ({ BookingManagementDialog: () => null }));
vi.mock("@/components/manager/bookings/VisitCodePanel", () => ({ POLL_LEAD_MINUTES: 30, VisitCodePanel: () => null }));
vi.mock("@/components/manager/bookings/ManagerInSessionBadge", () => ({ ManagerInSessionBadge: () => null, inSessionEnds: () => [] }));
vi.mock("@/components/support/CommitmentProblems", () => ({ CommitmentProblems: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    key = key.replace(/^booking:/, "");
    const value = (chef as Record<string, string>)[key] ?? (bookingCopy as Record<string, string>)[key] ?? options?.defaultValue ?? key;
    try { return new IntlMessageFormat(value, "en-CA").format(typeof options === "object" ? options : {}) as string; } catch { return value; }
  },
}) }));

import BookingDetailsPage from "./BookingDetailsPage";

const base = () => ({
  id: 5, referenceCode: "KB-5", chefId: 1, kitchenId: 2, bookingDate: "2030-01-15", startTime: "10:00", endTime: "12:00",
  status: "pending", paymentStatus: "authorized", createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  kitchen: { id: 2, name: "Harbour Kitchen", locationId: 3 },
  location: { id: 3, name: "Harbour", timezone: "America/St_Johns" },
  chef: { id: 1, username: "ada@example.com", fullName: "Ada" },
  closeout: undefined,
});

beforeEach(() => {
  h.manager = false; h.booking = base();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(h.booking))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("pending booking page", () => {
  it("tells the chef when the kitchen must answer and that the card is only held", async () => {
    render(<BookingDetailsPage />);
    const banner = await screen.findByTestId("booking-next-step");
    expect(banner).toHaveTextContent(/^Request sent\. Harbour Kitchen answers by [A-Z][a-z]{2} \d{1,2} at .+\.$/);
    // The hold explanation lives on the payment card, once.
    expect(await screen.findByTestId("payment-card")).not.toHaveTextContent("Total paid");
    expect(screen.queryByText("Arrival not recorded")).not.toBeInTheDocument();
  });

  it("labels the header date as the booking date, not the visit date", async () => {
    render(<BookingDetailsPage />);
    // This year's dates drop the year.
    expect(await screen.findByText(/^Booked [A-Z][a-z]{2} \d{1,2}$/)).toBeInTheDocument();
  });

  it("tells the manager the consequence of not responding", async () => {
    h.manager = true;
    render(<BookingDetailsPage />);
    const banner = await screen.findByTestId("booking-next-step");
    expect(banner).toHaveTextContent(/^Respond by .+, or the request expires and the chef’s card hold is released\.$/);
  });

  it("shows no deadline banner without a live card hold", async () => {
    h.booking = { ...base(), paymentStatus: "paid", status: "confirmed" };
    render(<BookingDetailsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Harbour Kitchen" })).toBeInTheDocument());
    expect(screen.getByTestId("booking-next-step")).not.toHaveTextContent(/Respond by|has until/);
  });

  it("describes a finished visit to the chef without the kitchen's review deadline, and no pre-arrival guidance", async () => {
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_out",
      closeout: { phase: "ended", timezone: "America/St_Johns", visits: [{ key: "b", phase: "ended", arrivalRecorded: true, scheduledStartAt: "2030-01-15T14:00:00Z", inspection: { deadline: "2030-01-17T14:00:00Z", canRespond: false, outcome: "not_due" } }] } };
    render(<BookingDetailsPage />);
    const next = await screen.findByTestId("booking-next-step");
    expect(next).toHaveTextContent(/^Visit complete\.$/);
    expect(document.body.textContent).not.toMatch(/reviews by/);
    // A localized time ending in "p.m." must not leave a double period.
    expect(next.textContent).not.toMatch(/\.\.$/);
    expect(screen.queryByText("What to expect")).not.toBeInTheDocument();
  });
});
