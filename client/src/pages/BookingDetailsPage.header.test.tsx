vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chef from "@shared/i18n/locales/en-CA/chef.json";
import { IntlMessageFormat } from "intl-messageformat";

const h = vi.hoisted(() => ({ manager: false, booking: {} as Record<string, unknown>, navigate: vi.fn() }));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ loading: false, user: { uid: "u" } }) }));
vi.mock("@/components/booking/BookingFeedbackCard", () => ({ BookingFeedbackCard: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock("wouter", () => ({
  useRoute: (pattern: string) => (pattern === "/manager/booking/:id" ? (h.manager ? [true, { id: "5" }] : [false, null]) : (!h.manager && pattern === "/booking/:id" ? [true, { id: "5" }] : [false, null])),
  useLocation: () => ["/", h.navigate],
  Link: ({ children }: any) => children,
}));
vi.mock("@/layouts/ChefDashboardLayout", () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/layouts/ManagerBookingLayout", () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/layouts/chef-shell-context", () => ({ useChefShellChrome: () => false }));
vi.mock("@/components/ui/smart-image", () => ({ SmartImage: () => null }));
vi.mock("@/components/booking/ClockCloseoutSummary", () => ({ ClockCloseoutSummary: () => null }));
vi.mock("@/components/booking/BookingPreparation", () => ({ default: () => <p>What to expect</p> }));
const nothing = vi.hoisted(() => () => null);
vi.mock("@/components/booking/KitchenBookingChanges", () => ({ KitchenBookingChanges: nothing }));
vi.mock("@/components/booking/BookingCancellationChooser", () => ({ BookingCancellationChooser: nothing }));
vi.mock("@/components/booking/BookingHistoryPanel", () => ({ BookingHistoryPanel: nothing }));
// Stand-ins with content, as the real panels always render a status line inside the Visit card.
vi.mock("@/components/booking/BookingAttendancePanel", () => ({ BookingAttendancePanel: () => <p>Visit record line</p> }));
vi.mock("@/components/manager/bookings/VisitCodePanel", () => ({ VisitCodePanel: () => <p>Check-in code panel</p> }));
vi.mock("@/components/booking/CancellationRefundReview", () => ({ CancellationRefundReview: nothing }));
vi.mock("@/components/booking/BookingPricingBreakdown", () => ({ ChefBookingReceiptBreakdown: nothing, KitchenPayoutStatementBreakdown: nothing }));
vi.mock("@/components/booking/CheckinPolicyTimesCard", () => ({ CheckinPolicyTimesCard: nothing }));
vi.mock("@/components/booking/RefundRequestStatus", () => ({ RefundRequestStatus: nothing }));
vi.mock("@/components/booking/StripeProcessingFeeRefundInfo", () => ({ StripeProcessingFeeRefundInfo: nothing }));
vi.mock("@/components/booking/ServiceFeeInfoPopover", () => ({ ServiceFeeInfoPopover: nothing }));
vi.mock("@/components/booking/BookingRefundPolicyNotice", () => ({ BookingRefundPolicyNotice: () => <p>refund notice</p> }));
vi.mock("@/components/manager/bookings/BookingActionDialog", () => ({ BookingActionDialog: () => null }));
vi.mock("@/components/manager/bookings/BookingManagementDialog", () => ({ BookingManagementDialog: () => null }));
vi.mock("@/components/manager/bookings/ManagerInSessionBadge", () => ({ ManagerInSessionBadge: () => null, inSessionEnds: () => [] }));
vi.mock("@/components/support/CommitmentProblems", () => ({ CommitmentProblems: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    const value = (chef as Record<string, string>)[key] ?? options?.defaultValue ?? key;
    try { return new IntlMessageFormat(value, "en-CA").format(typeof options === "object" ? options : {}) as string; } catch { return value; }
  },
}) }));

import BookingDetailsPage from "./BookingDetailsPage";

// 10:00–12:00 Newfoundland time (UTC−3:30 in January) = 13:30–15:30 UTC.
const START = Date.parse("2030-01-15T13:30:00Z");
const base = () => ({
  id: 5, referenceCode: "KB-5", chefId: 1, kitchenId: 2, bookingDate: "2030-01-15", startTime: "10:00", endTime: "12:00",
  status: "pending", paymentStatus: "authorized", createdAt: "2030-01-10T12:00:00Z",
  checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30,
  kitchen: { id: 2, name: "Harbour Kitchen", locationId: 3 },
  location: { id: 3, name: "Harbour", address: "1 Water St, St. John's", timezone: "America/St_Johns" },
  chef: { id: 1, username: "ada@example.com", fullName: "Ada Lovelace", phone: "+17095550101" },
  kitchenContact: { email: "kitchen@example.com", phone: "+17095550199" },
});
const closeout = (deadline: string) => ({ phase: "booked_time_ended", timezone: "America/St_Johns", serviceEndedAt: "2030-01-15T15:30:00Z",
  visits: [{ key: "b", phase: "booked_time_ended", arrivalRecorded: true, scheduledStartAt: "2030-01-15T13:30:00Z", scheduledEndAt: "2030-01-15T15:30:00Z",
    inspection: { outcome: "due", dueAt: "2030-01-15T15:30:00Z", deadline, closedAt: null, canRespond: true } }] });

type Case = { name: string; now: number; booking: Record<string, unknown>; pill: Record<"chef" | "manager", string>;
  next: Record<"chef" | "manager", RegExp>; primary: Record<"chef" | "manager", string | null>; message: boolean };
const cases: Case[] = [
  { name: "pending", now: START - 3 * 86_400_000, booking: { createdAt: new Date(START - 3 * 86_400_000 - 3_600_000).toISOString() },
    pill: { chef: "Request pending", manager: "Request pending" },
    next: { chef: /^Request sent\. Harbour Kitchen has until .+ to respond\./, manager: /^Respond by .+\. If you don’t, the request expires/ },
    primary: { chef: null, manager: "Review request" }, message: true },
  { name: "confirmed upcoming", now: START - 3 * 86_400_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" },
    pill: { chef: "Confirmed", manager: "Confirmed" },
    next: { chef: /^Your arrival details are ready\. Check-in opens Jan 15, 9:45 a\.m\.$/, manager: /^Ada Lovelace is booked\. Share the check-in code with them in person when they arrive\.$/ },
    primary: { chef: null, manager: null }, message: true },
  { name: "today, in the check-in window", now: START - 5 * 60_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" },
    pill: { chef: "Today", manager: "Today" },
    next: { chef: /^Check-in is open\. Open your visit when you arrive\.$/, manager: /^Ada Lovelace arrives today at 10:00 a\.m\.$/ },
    primary: { chef: "Open your visit", manager: null }, message: true },
  { name: "in session", now: START + 30 * 60_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_in", checkedInAt: "2030-01-15T13:32:00Z" },
    pill: { chef: "In session", manager: "In session" },
    next: { chef: /^You’re checked in\. Check out by 12:00 p\.m\.$/, manager: /^Ada Lovelace is in the kitchen until 12:00 p\.m\.$/ },
    primary: { chef: "Check out", manager: null }, message: true },
  { name: "checkout requested", now: START + 3 * 3_600_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "checkout_requested",
      checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z", closeout: closeout("2030-01-16T15:30:00Z") },
    pill: { chef: "Checkout submitted", manager: "Checkout to review" },
    next: { chef: /^Visit complete\. The kitchen reviews by Jan 16, 2030, 12:00 p\.m\.$/, manager: /^Ada Lovelace checked out\. Review the kitchen by Jan 16, 2030, 12:00 p\.m\.$/ },
    primary: { chef: null, manager: "Review checkout" }, message: true },
  { name: "completed", now: START + 3 * 86_400_000, booking: { status: "completed", paymentStatus: "paid", checkinStatus: "checked_out",
      checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z" },
    pill: { chef: "Completed", manager: "Completed" },
    next: { chef: /^Visit complete\.$/, manager: /^This visit is closed\.$/ },
    primary: { chef: null, manager: null }, message: true },
  { name: "cancelled", now: START - 3 * 86_400_000, booking: { status: "cancelled", paymentStatus: "failed" },
    pill: { chef: "Cancelled", manager: "Cancelled" },
    next: { chef: /^This booking was cancelled\. Refund details are under Payment\.$/, manager: /^This booking was cancelled\.$/ },
    primary: { chef: null, manager: null }, message: false },
];

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(h.booking)))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe.each(["chef", "manager"] as const)("booking details header (%s)", role => {
  it.each(cases)("$name: who, when, one status, one next step, at most one primary", async ({ now, booking, pill, next, primary, message }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    h.manager = role === "manager";
    h.booking = { ...base(), ...booking };
    render(<BookingDetailsPage />);
    const header = await screen.findByTestId("booking-header");

    // Who: the other party first.
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(role === "manager" ? "Ada Lovelace" : "Harbour Kitchen");
    expect(header).toHaveTextContent(role === "manager" ? "Kitchen session · Harbour Kitchen" : "1 Water St, St. John's");
    // When, with the zone named once.
    expect(within(header).getByTestId("booking-when")).toHaveTextContent("Tue, Jan 15 · 10:00 a.m.–12:00 p.m. · 2 hrs · Newfoundland Time");
    // One status pill and one next-step sentence.
    expect(within(header).getAllByTestId("booking-status-pill")).toHaveLength(1);
    expect(within(header).getByTestId("booking-status-pill")).toHaveTextContent(pill[role]);
    expect(within(header).getByTestId("booking-next-step").textContent).toMatch(next[role]);
    expect(within(header).getByTestId("booking-next-step").textContent).not.toMatch(/\.\.$/);

    // At most one primary action, and it is the expected one.
    const primaries = header.querySelectorAll("[data-primary-action]");
    expect(primaries.length).toBeLessThanOrEqual(1);
    if (primary[role]) expect(primaries[0]).toHaveTextContent(primary[role]!);
    else expect(primaries).toHaveLength(0);

    // Message is one tap away whenever the server allows a conversation; the mobile bar mirrors it.
    const messageName = role === "manager" ? "Message chef" : "Message kitchen";
    if (message) {
      expect(within(header).getByRole("button", { name: messageName })).toBeInTheDocument();
      expect(within(screen.getByTestId("mobile-action-bar")).getByRole("button", { name: messageName })).toBeInTheDocument();
    } else {
      expect(within(header).queryByRole("button", { name: messageName })).not.toBeInTheDocument();
    }
    expect(within(header).getByRole("button", { name: "More actions" })).toBeInTheDocument();
    const bar = screen.queryByTestId("mobile-action-bar");
    if (bar) expect(bar.querySelectorAll("[data-primary-action]").length).toBeLessThanOrEqual(1);

    // No empty headings: every section heading has content under it.
    for (const heading of screen.getAllByRole("heading", { level: 2 })) {
      const section = heading.closest("section, header, [id='booking-support']")!;
      expect(heading.textContent!.trim()).not.toBe("");
      expect(section.textContent!.replace(heading.textContent!, "").trim(), heading.textContent!).not.toBe("");
    }
    // Sentence-case headings, no all-caps section labels.
    expect(document.querySelector("h2.uppercase, h3.uppercase")).toBeNull();
  });
});

describe("contact details", () => {
  it("shows the other party's phone as a link only once confirmed, with the safety helper", async () => {
    h.manager = false;
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid" };
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("person-card");
    const phone = within(card).getByRole("link", { name: /709/ });
    expect(phone).toHaveAttribute("href", "tel:+17095550199");
    expect(card).toHaveTextContent("For your safety, keep messages and payments in Local Cooks.");
    expect(within(card).getByRole("button", { name: "Message kitchen" })).toBeInTheDocument();
  });

  it("keeps the phone private while the request is pending", async () => {
    h.manager = true;
    h.booking = { ...base(), createdAt: new Date().toISOString() };
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("person-card");
    expect(within(card).queryByRole("link", { name: /709/ })).not.toBeInTheDocument();
    expect(within(card).queryByTestId("contact-phone")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("ada@example.com");
  });

  it("hides the Visit card before confirmation instead of showing an empty state", async () => {
    h.manager = true;
    h.booking = { ...base(), createdAt: new Date().toISOString() };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByTestId("visit-card")).not.toBeInTheDocument();
  });
});

describe("cancel or change on a finished visit", () => {
  const finished = { status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_out",
    checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z" };
  it.each(["chef", "manager"] as const)("offers no cancellation card or menu item to the %s once the visit is done", async role => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START + 3 * 3_600_000);
    h.manager = role === "manager";
    h.booking = { ...base(), ...finished };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByTestId("cancellation-card")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel or change")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel or change booking")).not.toBeInTheDocument();
  });
  it("still offers it to the chef before arrival", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START - 3 * 86_400_000);
    h.manager = false;
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.getByTestId("cancellation-card")).toBeInTheDocument();
  });
});

describe("why a request ended", () => {
  const ended = (actorId?: number) => ({ status: "cancelled", paymentStatus: "failed",
    paymentDecision: { state: "complete", target: "cancelled", ...(actorId ? { actorId } : {}) } });
  it.each([
    ["declined", 9, "Declined", /^Harbour Kitchen couldn’t take this request\. Your card wasn’t charged\.$/, /^You declined this request\. Ada Lovelace’s card wasn’t charged\.$/],
    ["expired", undefined, "Expired", /^Harbour Kitchen didn’t respond in time, so the request expired\. Your card wasn’t charged\.$/, /^This request expired before it was answered\. Ada Lovelace’s card wasn’t charged\.$/],
    ["withdrawn", 1, "Cancelled", /^You cancelled this request\. Your card wasn’t charged\.$/, /^Ada Lovelace cancelled this request\.$/],
  ] as const)("says %s in the pill and next step", async (_cause, actorId, chefPill, chefNext, managerNext) => {
    for (const role of ["chef", "manager"] as const) {
      cleanup();
      h.manager = role === "manager";
      h.booking = { ...base(), ...ended(actorId) };
      render(<BookingDetailsPage />);
      const header = await screen.findByTestId("booking-header");
      expect(within(header).getByTestId("booking-status-pill")).toHaveTextContent(chefPill);
      expect(within(header).getByTestId("booking-next-step").textContent).toMatch(role === "chef" ? chefNext : managerNext);
    }
  });
  it("offers the chef a way to find another time after a decline, and not after an expiry", async () => {
    h.manager = false;
    h.booking = { ...base(), ...ended(9) };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("find-another-time")).toHaveAttribute("href", "/book/3?kitchenId=2");
    cleanup();
    h.booking = { ...base(), ...ended(undefined) };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByTestId("find-another-time")).not.toBeInTheDocument();
  });
  it("shows one Not charged line, a manager-worded hold message and no refund-details link when nothing was captured", async () => {
    h.manager = true;
    h.booking = { ...base(), ...ended(9), totalPrice: 2500, paymentTransaction: { amount: 3050, serviceFee: 0, managerRevenue: 0, status: "canceled" } };
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByText("The chef’s card hold was released. Nothing was charged.")).toBeInTheDocument();
    expect(within(card).getByTestId("not-charged-line")).toHaveTextContent("Not charged$30.50");
    expect(within(card).queryByText("Original Quote")).not.toBeInTheDocument();
    expect(within(card).queryByText("View cancellation and refund details")).not.toBeInTheDocument();
  });
});

describe("Local Cooks goodwill refund on the payment card", () => {
  const refunded = (extra = {}) => ({ ...base(), status: "confirmed", paymentStatus: "partially_refunded", totalPrice: 10000,
    paymentTransaction: { amount: 10000, serviceFee: 0, managerRevenue: 9000, status: "partially_refunded", refundAmount: 2600, goodwillRefundCents: 2600, ...extra } });
  it("tells the chef the amount and shows the Local Cooks refund line", async () => {
    h.manager = false; h.booking = refunded();
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByText("Refunded $26.00")).toBeInTheDocument();
    expect(within(card).getByTestId("goodwill-line")).toHaveTextContent("Local Cooks refund · $26.00");
    expect(within(card).queryByText("Part of your payment was refunded.")).not.toBeInTheDocument();
  });
  it("tells the manager the payout is unchanged", async () => {
    h.manager = true; h.booking = refunded();
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    
    expect(card).toHaveTextContent("a $26.00 refund. Your payout is unchanged.");
  });
});

describe("payout after closeout on the payment card", () => {
  const paid = (payout: Record<string, unknown>, extra = {}) => ({ ...base(), status: "confirmed", paymentStatus: "paid", totalPrice: 10000,
    paymentTransaction: { amount: 12000, serviceFee: 700, managerRevenue: 11300, stripeProcessingFee: 358, status: "succeeded" },
    payout: { timing: "after_closeout", status: "scheduled", holdReason: null, expectedAt: "2030-01-16T15:30:00Z", sentAt: null, amountCents: 10942, ...payout }, ...extra });
  it("shows the manager what is owed and when, without implying the money is already theirs", async () => {
    h.manager = true; h.booking = paid({});
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByTestId("kitchen-payout-status")).toHaveAttribute("data-status", "scheduled");
    expect(card).toHaveTextContent("The chef has paid. Your payout is sent after the visit closes.");
    expect(card).toHaveTextContent("$109.42");
    expect(card).not.toHaveTextContent("Payment collected from the chef.");
  });
  it("keeps the legacy wording for an at-capture payout", async () => {
    h.manager = true; h.booking = paid({ timing: "at_capture", status: "sent" });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).queryByTestId("kitchen-payout-status")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("Payment collected from the chef.");
  });
  it("offers the chef the final invoice once the booking is completed", async () => {
    h.manager = false; h.booking = paid({}, { status: "completed", payout: undefined });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByRole("button", { name: /Download final invoice/ })).toBeInTheDocument();
    expect(within(card).queryByTestId("kitchen-payout-status")).not.toBeInTheDocument();
  });
});

describe("overnight slots", () => {
  it("label the details date with the calendar day the slot starts on", async () => {
    h.manager = false;
    // Window opens 06:00 on Wed Jan 16; slot 00:15-01:15 is Thu Jan 17.
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", bookingDate: "2030-01-16", startTime: "00:15", endTime: "01:15", operatingWindowStartTime: "06:00" };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(document.body.textContent).toContain("Thursday, January 17, 2030");
    expect(document.body.textContent).not.toContain("Wednesday, January 16, 2030");
  });
});

describe("a manager opening a chef link", () => {
  it("is sent to the manager page for that booking instead of seeing Not found", async () => {
    h.manager = false; h.navigate.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/manager/")
      ? new Response(JSON.stringify({ ...base() })) : new Response("{}", { status: 403 })));
    render(<BookingDetailsPage />);
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/manager/booking/5", { replace: true }));
    expect(screen.queryByText(/permission/i)).not.toBeInTheDocument();
  });
  it("still shows the error to someone who is not that booking's manager", async () => {
    h.manager = false; h.navigate.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    render(<BookingDetailsPage />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
