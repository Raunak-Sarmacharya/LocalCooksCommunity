vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/components/booking/KitchenBookingChanges", () => ({ KitchenBookingChanges: nothing, ChangeBookingDialog: nothing }));
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
vi.mock("@/components/support/CommitmentProblems", () => ({ CommitmentProblems: () => null, useCommitmentProblems: () => ({ data: undefined }) }));
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

  it("offers Change request next to Cancel request, linking to the pre-filled flow for the same kitchen", async () => {
    h.booking = { ...base(), selectedSlots: [{ startTime: "10:00", endTime: "11:00" }, { startTime: "11:00", endTime: "12:00" }], specialNotes: "Bring pans" };
    render(<BookingDetailsPage />);
    const link = await screen.findByRole("link", { name: "Change request" });
    const url = new URL(link.getAttribute("href")!, "https://chef.example");
    expect(url.pathname).toBe("/book/3");
    expect(url.searchParams.get("kitchenId")).toBe("2");
    expect(url.searchParams.get("replaces")).toBe("5");
    expect(url.searchParams.get("date")).toBe("2030-01-15");
    expect(url.searchParams.get("slots")).toBe("10:00,11:00");
    expect(screen.getByRole("button", { name: chef.bnCancelRequest })).toBeInTheDocument();
  });

  it("offers no Change request to the kitchen, once the request is answered, or while a decision is in flight", async () => {
    h.manager = true;
    const { unmount } = render(<BookingDetailsPage />);
    await screen.findByTestId("booking-next-step");
    expect(screen.queryByRole("link", { name: "Change request" })).not.toBeInTheDocument();
    unmount(); h.manager = false;
    for (const patch of [{ status: "confirmed", paymentStatus: "paid" }, { paymentDecision: { state: "pending", target: "confirmed" } }]) {
      h.booking = { ...base(), ...patch };
      const view = render(<BookingDetailsPage />);
      await screen.findByTestId("booking-next-step");
      expect(screen.queryByRole("link", { name: "Change request" })).not.toBeInTheDocument();
      view.unmount();
    }
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

const waitingOffer = () => ({
  ...base(),
  paymentTransaction: { amount: 6100, serviceFee: 350, managerRevenue: 5543, estimatedStripeProcessingFee: 207, status: "authorized" },
  equipmentBookings: [{ id: 31, equipmentListingId: 9, status: "pending", totalPrice: 2500,
    equipmentListing: { equipmentType: "Mixer", brand: null } }],
  partialAcceptance: {
    id: "p1", state: "waiting", intentId: "pi_1", proposedAt: "2030-01-10T12:00:00Z", deadlineAt: "2030-01-11T12:00:00Z",
    equipment: [{ id: 31, status: "cancelled" }], declined: [{ id: 31, name: "Mixer", cents: 2500 }],
    oldTotalCents: 6100, newTotalCents: 3050,
  },
});

describe("partial acceptance: waiting on the chef", () => {
  it("chef payment card: card hold stays, status names the new total if they accept", async () => {
    h.manager = false;
    h.booking = waitingOffer();
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(card).toHaveTextContent("Card hold$61.00");
    expect(within(card).getByTestId("payment-status-line")).toHaveTextContent(
      "If you accept, you’re charged $30.50 and the rest is released.");
    expect(card).not.toHaveTextContent("You’re only charged if Harbour Kitchen accepts.");
  });

  it("kitchen payment card: hides the original estimated payout", async () => {
    h.manager = true;
    h.booking = waitingOffer();
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).queryByTestId("payment-headline")).not.toBeInTheDocument();
    expect(within(card).getByTestId("payment-status-line")).toHaveTextContent("Payout depends on the chef’s answer");
    expect(card).not.toHaveTextContent("$55.43");
    expect(within(card).getByTestId("pa-payout-depends")).toHaveTextContent("Payout depends on the chef’s answer");
  });

  it.each([
    [false, "Not included if you accept"],
    [true, "Kitchen can’t provide · chef deciding"],
  ] as const)("add-on chip while waiting (manager=%s)", async (manager, chip) => {
    h.manager = manager;
    h.booking = waitingOffer();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("pa-declined-item-chip")).toHaveTextContent(chip);
    expect(screen.queryByText(/^Pending$/i)).not.toBeInTheDocument();
  });

  it("after accept: kitchen shows Not included on a voided declined item; chef keeps Not charged", async () => {
    const accepted = {
      ...waitingOffer(),
      status: "confirmed",
      paymentStatus: "paid",
      paymentTransaction: { amount: 3050, serviceFee: 200, managerRevenue: 2750, stripeProcessingFee: 118, status: "succeeded" },
      equipmentBookings: [{ id: 31, equipmentListingId: 9, status: "cancelled", paymentStatus: "failed", totalPrice: 2500,
        equipmentListing: { equipmentType: "Mixer", brand: null } }],
      partialAcceptance: { ...waitingOffer().partialAcceptance, state: "accepted" },
    };
    h.manager = true; h.booking = accepted;
    const { unmount } = render(<BookingDetailsPage />);
    expect(await screen.findByText("Not included")).toBeInTheDocument();
    expect(screen.queryByText(/not charged/i)).not.toBeInTheDocument();
    unmount();
    h.manager = false; h.booking = accepted;
    render(<BookingDetailsPage />);
    expect(await screen.findByText(/not charged/i)).toBeInTheDocument();
  });
});
