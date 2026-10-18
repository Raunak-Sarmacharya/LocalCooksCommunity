vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chef from "@shared/i18n/locales/en-CA/chef.json";
import bookingCopy from "@shared/i18n/locales/en-CA/booking.json";
import { IntlMessageFormat } from "intl-messageformat";

const h = vi.hoisted(() => ({ manager: false, claims: [] as any[], booking: {} as Record<string, unknown>, navigate: vi.fn(), attendance: {} as Record<string, unknown>, code: null as Record<string, unknown> | null }));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ loading: false, user: { uid: "u" } }) }));
vi.mock("@/components/booking/BookingFeedbackCard", () => ({ BookingFeedbackCard: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: { claims: h.claims }, isLoading: false, refetch: vi.fn() }) }));
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
vi.mock("@/components/booking/KitchenBookingChanges", () => ({ KitchenBookingChanges: nothing, ChangeBookingDialog: nothing }));
vi.mock("@/components/booking/BookingCancellationChooser", () => ({ BookingCancellationChooser: nothing }));
vi.mock("@/components/booking/BookingHistoryPanel", () => ({ BookingHistoryPanel: nothing }));
// Stand-ins with content, as the real panels always render a status line inside the Visit card.
vi.mock("@/components/booking/BookingAttendancePanel", () => ({ BookingAttendancePanel: (props: Record<string, unknown>) => { h.attendance = props; return <p>Visit record line</p>; } }));
vi.mock("@/components/manager/bookings/VisitCodePanel", () => ({ POLL_LEAD_MINUTES: 30, VisitCodePanel: (props: Record<string, unknown>) => { h.code = props; return <p>Check-in code panel</p>; } }));
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
vi.mock("@/components/support/CommitmentProblems", () => ({ CommitmentProblems: () => null, useCommitmentProblems: () => ({ data: undefined }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    key = key.replace(/^booking:/, "");
    const value = (chef as Record<string, string>)[key] ?? (bookingCopy as Record<string, string>)[key] ?? options?.defaultValue ?? key;
    try { return new IntlMessageFormat(value, "en-CA").format(typeof options === "object" ? options : {}) as string; } catch { return value; }
  },
}) }));

vi.mock("@/components/booking/DamageClaimPayment", () => ({ default: ({ onPaid }: any) => <button onClick={onPaid}>Confirm mock claim payment</button> }));
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
    next: { chef: /^Request sent\. Harbour Kitchen answers by Jan 13 at 9:00 a\.m\.$/, manager: /^Respond by Jan 13 at 9:00 a\.m\., or the request expires and the chef’s card hold is released\.$/ },
    primary: { chef: null, manager: "Review request" }, message: true },
  { name: "confirmed upcoming", now: START - 3 * 86_400_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" },
    pill: { chef: "Confirmed", manager: "Confirmed" },
    next: { chef: /^Your arrival details are ready\. Check-in opens Jan 15 at 9:45 a\.m\.$/, manager: /^Ada Lovelace is booked\. Share the check-in code with them in person when they arrive\.$/ },
    primary: { chef: null, manager: null }, message: true },
  { name: "today, in the check-in window", now: START - 5 * 60_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" },
    pill: { chef: "Today", manager: "Today" },
    next: { chef: /^Check-in is open\. Open your visit when you arrive\.$/, manager: /^Ada Lovelace arrives today at 10:00 a\.m\.$/ },
    primary: { chef: "Open your visit", manager: null }, message: true },
  { name: "in session", now: START + 30 * 60_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_in", checkedInAt: "2030-01-15T13:32:00Z" },
    pill: { chef: "In session", manager: "In session" },
    next: { chef: /^You’re checked in\. Check out by 12:00 p\.m\.$/, manager: /^Ada Lovelace is in the kitchen until 12:00 p\.m\. Checked in 10:02 a\.m\.$/ },
    primary: { chef: "Check out", manager: null }, message: true },
  { name: "checkout requested", now: START + 3 * 3_600_000, booking: { status: "confirmed", paymentStatus: "paid", checkinStatus: "checkout_requested",
      checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z", closeout: closeout("2030-01-16T15:30:00Z") },
    pill: { chef: "Checkout submitted", manager: "Checkout to review" },
    next: { chef: /^Checkout submitted at 11:50 a\.m\. You’re all set — we’ll let you know if the kitchen reports anything\.$/, manager: /^Ada Lovelace checked out\. Review the kitchen by Jan 16 at 12:00 p\.m\.$/ },
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

beforeEach(() => { h.claims = []; vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(h.booking)))); });
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

    // At most one primary action in the whole document (not repeated in the sticky bar), and it is the expected one.
    const primaries = document.querySelectorAll("[data-primary-action]");
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

    // Role-scoped words (P3) and at most three visible secondary links (§7).
    if (role === "chef") expect(document.body.textContent).not.toMatch(/inspection|payout|Fix the visit record/i);
    else expect(document.body.textContent).not.toMatch(/Open your visit/);
    expect(screen.queryByTestId("now-secondary")?.querySelectorAll("a, button").length ?? 0).toBeLessThanOrEqual(3);
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
    // Message lives in the Now card (and the mobile bar) only; the contact card doesn't repeat it, or the hero's name.
    expect(within(card).queryByRole("button", { name: "Message kitchen" })).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("Harbour Kitchen");
    expect(screen.getAllByRole("button", { name: "Message kitchen" })).toHaveLength(2); // header + mobile bar (CSS shows one)
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
    expect(screen.queryByTestId("visit-record")).not.toBeInTheDocument();
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
  it("offers the chef a way to find another time after a decline or an expiry, not after their own withdrawal", async () => {
    h.manager = false;
    for (const [actorId, offered] of [[9, true], [undefined, true], [1, false]] as const) {
      cleanup();
      h.booking = { ...base(), ...ended(actorId) };
      render(<BookingDetailsPage />);
      await screen.findByTestId("booking-header");
      if (offered) expect(screen.getByTestId("find-another-time")).toHaveAttribute("href", "/book/3?kitchenId=2");
      else expect(screen.queryByTestId("find-another-time")).not.toBeInTheDocument();
    }
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
  it("shows the manager one amount and one status line, without implying the money is already theirs", async () => {
    h.manager = true; h.booking = paid({ amountCents: 2732 });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByTestId("kitchen-payout-status")).toHaveAttribute("data-status", "scheduled");
    expect(within(card).getByTestId("payment-headline")).toHaveTextContent("$27.32");
    expect(card).toHaveTextContent("Your payout$27.32");
    // ONE status line about this money (P6): the payout line replaces the payment message.
    expect(within(card).getByTestId("kitchen-payout-status")).toHaveTextContent(/^Paid after the visit\. Finish the inspection after Ada Lovelace checks out to get it sooner\.$/);
    expect(within(card).queryByTestId("payment-status-line")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("The chef has paid.");
    expect(card).not.toHaveTextContent("Payment collected from the chef.");
    // The payout amount appears once on the page (the breakdown repeats it only when opened).
    expect(document.body.textContent!.split("$27.32").length - 1).toBe(1);
  });
  it("keeps the legacy wording for an at-capture payout", async () => {
    h.manager = true; h.booking = paid({ timing: "at_capture", status: "sent" });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).queryByTestId("kitchen-payout-status")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("Payment collected from the chef.");
  });
  it("offers the chef the final invoice once the booking is completed, in one place", async () => {
    h.manager = false; h.booking = paid({}, { status: "completed", payout: undefined });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(screen.getByTestId("now-secondary")).getByRole("button", { name: /Download final invoice/ })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Download final invoice/ })).not.toBeInTheDocument();
    expect(within(card).queryByTestId("kitchen-payout-status")).not.toBeInTheDocument();
  });
});

describe("overnight slots", () => {
  it("label the details date with the calendar day the slot starts on", async () => {
    h.manager = false;
    // Window opens 06:00 on Wed Jan 16; slot 00:15-01:15 is Thu Jan 17.
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", bookingDate: "2030-01-16", startTime: "00:15", endTime: "01:15", operatingWindowStartTime: "06:00" };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-when")).toHaveTextContent(/^Thu, Jan 17 · /);
    expect(document.body.textContent).not.toContain("Wed, Jan 16");
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

describe("arrival package on the booking page", () => {
  const confirmed = { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" };
  const lateNote = { minutes: 15, reportedAt: "2030-01-15T13:52:00.000Z", expectedAt: "2030-01-15T14:07:00.000Z", note: "Traffic is slow", visitId: null, count: 1 };
  it("tells the manager the chef is running late and when they said so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 25 * 60_000);
    h.manager = true; h.booking = { ...base(), ...confirmed, runningLate: lateNote };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-running-late")).toHaveTextContent("Ada Lovelace is running about 15 min late (told you at 10:22 a.m.).");
    expect(screen.getByTestId("booking-running-late")).toHaveTextContent("Their note: Traffic is slow");
  });
  it("does not show the line once the chef has checked in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 25 * 60_000);
    h.manager = true; h.booking = { ...base(), ...confirmed, checkinStatus: "checked_in", checkedInAt: "2030-01-15T14:00:00Z", runningLate: lateNote };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByTestId("booking-running-late")).not.toBeInTheDocument();
  });
  it("gives the chef Running late? before check-in, and says the booking still ends on time after the start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 10 * 60_000);
    h.manager = false; h.booking = { ...base(), ...confirmed };
    render(<BookingDetailsPage />);
    expect(await screen.findByRole("button", { name: "Running late?" })).toBeInTheDocument();
    expect(screen.getByTestId("booking-next-step")).toHaveTextContent("Your booking still ends at 12:00 p.m. Newfoundland Time.");
    expect(screen.queryByTestId("booking-running-late")).not.toBeInTheDocument();
  });
  it("keeps the chef's confirmation banner after a reload", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 25 * 60_000);
    h.manager = false; h.booking = { ...base(), ...confirmed, runningLate: lateNote };
    render(<BookingDetailsPage />);
    // The heads-up becomes the Now card's sentence, with an "Update" link instead of a second banner.
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("You told Harbour Kitchen you’re about 15 min late. Your booking still ends at 12:00 p.m. Newfoundland Time.");
    expect(screen.getByTestId("running-late-link")).toHaveTextContent("Update how late you’ll be");
    expect(screen.queryByText("You told the kitchen you’re running late")).not.toBeInTheDocument();
  });
});

describe("after the booked end, the chef is still checked in (overstay)", () => {
  // Started 30 minutes early (9:30) and given 30 more minutes (12:30): the stored hour count is stale on purpose.
  const overstay = () => ({ ...base(), status: "completed", paymentStatus: "paid", checkinStatus: "checked_in", checkedInAt: "2030-01-15T13:02:00Z",
    startTime: "09:30", endTime: "12:30", durationHours: 2.5,
    closeout: { phase: "ended", timezone: "America/St_Johns", serviceEndedAt: "2030-01-15T16:15:00Z", visits: [{ key: "b", phase: "ended", arrivalRecorded: true,
      scheduledStartAt: "2030-01-15T13:00:00Z", scheduledEndAt: "2030-01-15T16:00:00Z",
      inspection: { outcome: "due", dueAt: "2030-01-15T16:00:00Z", deadline: "2030-01-16T16:00:00Z", closedAt: null, canRespond: true } }] } });
  it("shows the real booked span, never the stored hour count", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 4 * 3_600_000);
    h.manager = true; h.booking = overstay();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-when")).toHaveTextContent("9:30 a.m.–12:30 p.m. · 3 hrs ·");
  });
  it("manager: says when the booking ended and offers Record when they left (Message stays in the header)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 4 * 3_600_000);
    h.manager = true; h.booking = overstay();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("Ada Lovelace’s booking ended at 12:30 p.m. Newfoundland Time and they haven’t checked out yet.");
    expect(within(screen.getByTestId("header-actions")).getByRole("button", { name: "Message chef" })).toBeInTheDocument();
    expect(screen.getByTestId("overstay-hint")).toHaveTextContent("After you record when they left, you can charge for the extra time.");
    fireEvent.click(within(screen.getByTestId("now-secondary")).getByRole("button", { name: "Record when they left" }));
    expect(h.attendance).toMatchObject({ fixOpen: true, fixAction: "departure" });
  });
  it("chef: one message to check out now, and the Check out action stays", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 4 * 3_600_000);
    h.manager = false; h.booking = overstay();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("Your booking ended at 12:30 p.m. Newfoundland Time. Please check out now; extra time may be charged.");
    expect(screen.getByTestId("booking-header").querySelector("[data-primary-action]")).toHaveTextContent("Check out");
    expect(screen.queryByTestId("overstay-actions")).not.toBeInTheDocument();
  });
});

// ── WP-N: booked time ended with no check-in recorded ─────────────────────────────────────────────────────────────
describe("no check-in recorded", () => {
  const missed = (canRespond = true) => ({ ...base(), status: "completed", paymentStatus: "paid", checkinStatus: "not_checked_in",
    closeout: { phase: "ended", timezone: "America/St_Johns", serviceEndedAt: "2030-01-15T15:45:00Z", visits: [{ key: "b", phase: "ended", arrivalRecorded: false,
      attendance: "unknown", scheduledStartAt: "2030-01-15T13:30:00Z", scheduledEndAt: "2030-01-15T15:30:00Z",
      inspection: { outcome: canRespond ? "due" : "auto_closed_uninspected", dueAt: "2030-01-15T15:30:00Z", deadline: "2030-01-16T15:30:00Z",
        closedAt: canRespond ? null : "2030-01-16T15:30:00Z", canRespond } }] } });
  it("kitchen: not Completed; asks Did they come? with They came / They didn't come as an equal pair under the question", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 4 * 3_600_000);
    h.manager = true; h.booking = missed();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent(/^No check-in from Ada Lovelace\. Did they come\? Tell us by /);
    expect(screen.getAllByText("No check-in recorded").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Completed|This visit is closed|Report damage/);
    // Neither answer is promoted to the header: the kitchen picks one of two equal buttons right under the question.
    expect(screen.getByTestId("booking-header").querySelector("[data-primary-action]")).toBeNull();
    const pair = screen.getByTestId("attendance-answer");
    fireEvent.click(within(pair).getByRole("button", { name: "They came" }));
    expect(h.attendance).toMatchObject({ fixOpen: true, fixAction: "report_attended" });
    fireEvent.click(within(pair).getByRole("button", { name: "They didn’t come" }));
    expect(h.attendance).toMatchObject({ fixOpen: true, fixAction: "report_no_show" });
  });
  it("kitchen: after the window closes it simply reads No check-in recorded, with no question", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 30 * 3_600_000);
    h.manager = true; h.booking = missed(false);
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent(/nothing changes for your payout/);
    expect(screen.getByTestId("booking-header").querySelector("[data-primary-action]")).toBeNull();
  });
  it("chef: told plainly, no money statement yet; I was there and Message kitchen; no rating or final invoice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 4 * 3_600_000);
    h.manager = false; h.booking = missed();
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("We didn’t see a check-in for your booking at Harbour Kitchen (10:00 a.m.). If you were there, let us know.");
    expect(document.body.textContent).not.toMatch(/Visit complete|final invoice|How was your session/i);
    expect(within(screen.getByTestId("header-actions")).getByRole("button", { name: /Message kitchen/ })).toBeInTheDocument();
    const scroll = vi.fn();
    const support = document.getElementById("booking-support");
    if (support) support.scrollIntoView = scroll;
    fireEvent.click(within(screen.getByTestId("now-secondary")).getByRole("button", { name: "I was there" }));
    expect(scroll).toHaveBeenCalled();
  });
});

// ── WP-A acceptance (design-booking-consolidation.md §5) ─────────────────────────────────────────────────────────
const count = (needle: string) => document.body.textContent!.split(needle).length - 1;
/** Text of the page without the when-line (which states the booked range by design). */
const outsideWhen = (needle: string) => count(needle) - (screen.getByTestId("booking-when").textContent!.split(needle).length - 1);

describe("header duration in people words", () => {
  it.each([["10:20", "20 min"], ["11:30", "1 hr 30 min"], ["12:00", "2 hrs"]])("ends %s → %s", async (endTime, text) => {
    h.manager = false; h.booking = { ...base(), endTime };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-when")).toHaveTextContent(` · ${text} · Newfoundland Time`);
    expect(screen.getByTestId("booking-when").textContent).not.toMatch(/0\.\d+ hrs/);
  });
});

describe("each fact once (P2)", () => {
  const inSession = { status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_in", checkedInAt: "2030-01-15T13:32:00Z", checkedInMethod: "code" };
  it("manager in session: check-in time once, booked end once outside the when-line, method said once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 30 * 60_000);
    h.manager = true; h.booking = { ...base(), ...inSession };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("Ada Lovelace is in the kitchen until 12:00 p.m. Checked in 10:02 a.m. with the check-in code.");
    expect(count("10:02 a.m.")).toBe(1);
    expect(outsideWhen("12:00 p.m.")).toBe(1);
    expect(count("with the check-in code")).toBe(1);
    // After check-in the code card is gone; the sentence carries the arrival.
    expect(screen.queryByText("Check-in code panel")).not.toBeInTheDocument();
  });
  it("chef in session: booked end once outside the when-line, and the check-in time once (in Visit details)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 30 * 60_000);
    h.manager = false; h.booking = { ...base(), ...inSession };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-next-step");
    expect(outsideWhen("12:00 p.m.")).toBe(1);
    expect(count("10:02 a.m.")).toBe(1);
    expect(within(screen.getByTestId("visit-record")).getByTestId("visit-timeline")).toHaveTextContent("You checked inJan 15 at 10:02 a.m.");
  });
  it("chef completed: “Visit complete” once and no kitchen review deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 3 * 3_600_000);
    h.manager = false; h.booking = { ...base(), status: "completed", paymentStatus: "paid", checkinStatus: "checked_out", checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z",
      closeout: closeout("2030-01-16T15:30:00Z") };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-next-step");
    expect(count("Visit complete")).toBe(1);
    expect(count("Visit finished")).toBe(0);
    expect(document.body.textContent).not.toMatch(/reviews by|Inspection due/);
  });
});

describe("check-in code (manager)", () => {
  const confirmed = { status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" };
  it("is one collapsed line days before and opens 30 minutes before the start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START - 2 * 86_400_000);
    h.manager = true; h.booking = { ...base(), ...confirmed }; h.code = null;
    render(<BookingDetailsPage />);
    await screen.findByText("Check-in code panel");
    expect(h.code).toMatchObject({ embedded: true, collapsed: true });
    cleanup();
    vi.setSystemTime(START - 20 * 60_000);
    render(<BookingDetailsPage />);
    await screen.findByText("Check-in code panel");
    expect(h.code).toMatchObject({ collapsed: false });
  });
});

describe("damage and cleaning claims: where the kitchen files one", () => {
  const done = { status: "completed", paymentStatus: "paid", checkinStatus: "checked_out", checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z" };
  it("offers “Report damage or extra cleaning” in the secondary row within 72 hours of the departure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 24 * 3_600_000);
    h.manager = true; h.booking = { ...base(), ...done };
    render(<BookingDetailsPage />);
    expect(within(await screen.findByTestId("now-secondary")).getByRole("button", { name: "Report damage or extra cleaning" })).toBeInTheDocument();
  });
  it("is gone after 72 hours, and never shown before the visit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 80 * 3_600_000);
    h.manager = true; h.booking = { ...base(), ...done };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByText("Report damage or extra cleaning")).not.toBeInTheDocument();
    cleanup();
    vi.setSystemTime(START - 2 * 86_400_000);
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in" };
    render(<BookingDetailsPage />);
    await screen.findByTestId("booking-header");
    expect(screen.queryByText("Report damage or extra cleaning")).not.toBeInTheDocument();
  });
});

describe("mobile 390 px", () => {
  const narrow = (matches: (query: string) => boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  it("the primary lives in the sticky bar only, every control is at least 44 px, nothing is wider than the screen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 30 * 60_000);
    narrow(query => query.includes("max-width: 639px"));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    h.manager = false; h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", checkinStatus: "checked_in", checkedInAt: "2030-01-15T13:32:00Z" };
    render(<BookingDetailsPage />);
    const bar = await screen.findByTestId("mobile-action-bar");
    expect(document.querySelectorAll("[data-primary-action]")).toHaveLength(1);
    expect(within(bar).getByRole("button", { name: "Check out" })).toHaveAttribute("data-primary-action");
    expect(within(screen.getByTestId("booking-header")).queryByRole("button", { name: "Check out" })).not.toBeInTheDocument();
    for (const scope of [screen.getByTestId("now-card"), bar, screen.getByTestId("payment-card"), screen.getByTestId("person-card")]) {
      for (const control of Array.from(scope.querySelectorAll("button, [role='button']"))) {
        expect(control.className, control.textContent || control.getAttribute("aria-label") || "").toMatch(/(^|\s)(min-h-11|h-11)(\s|$)/);
      }
    }
    // jsdom has no layout, so this only proves no fixed-width element; the lead's live run at 390 px measures it.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(document.querySelector("[class*='w-[4'], [class*='w-[5'], [class*='min-w-[4']")).toBeNull();
  });
});

describe("payout said once (manager, checkout to review)", () => {
  it("the Now sentence keeps the action, the Payment card the amount and a short status", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START + 3 * 3_600_000);
    h.manager = true;
    h.booking = { ...base(), status: "confirmed", paymentStatus: "paid", checkinStatus: "checkout_requested", checkedInAt: "2030-01-15T13:32:00Z", checkoutRequestedAt: "2030-01-15T15:20:00Z",
      closeout: closeout("2030-01-16T15:30:00Z"), totalPrice: 10000, paymentTransaction: { amount: 12000, serviceFee: 700, managerRevenue: 11300, stripeProcessingFee: 358, status: "succeeded" },
      payout: { timing: "after_closeout", status: "scheduled", holdReason: null, expectedAt: "2030-01-16T15:30:00Z", sentAt: null, amountCents: 5464 } };
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId("booking-next-step")).toHaveTextContent("Ada Lovelace checked out. Finish the inspection to get paid now — or it’s sent Jan 16 at 12:00 p.m.");
    expect(within(screen.getByTestId("payment-card")).getByTestId("kitchen-payout-status")).toHaveTextContent(/^Sent automatically if you don’t inspect\.$/);
    expect(count("Jan 16 at 12:00 p.m.")).toBe(1);
    expect(count("$54.64")).toBe(1);
    expect(document.body.textContent).not.toMatch(/Finish the inspection to send it now/);
  });
});

describe("payment card: card holds and the true total (round 3)", () => {
  const withMoney = (extra: Record<string, unknown> = {}) => ({ ...base(), totalPrice: 10000,
    paymentTransaction: { amount: 12000, serviceFee: 700, managerRevenue: 11300, stripeProcessingFee: 358, status: "succeeded" }, ...extra });
  const headline = () => within(screen.getByTestId("payment-card")).getByTestId("payment-headline").textContent!;
  it("a pending request is a card hold, never “Total paid”", async () => {
    h.manager = false; h.booking = withMoney({ status: "pending", paymentStatus: "pending", paymentTransaction: { amount: 3050, serviceFee: 200, managerRevenue: 0, status: "pending" } });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(card).toHaveTextContent("Card hold$30.50");
    expect(within(card).getByTestId("payment-status-line")).toHaveTextContent("You’re only charged if Harbour Kitchen accepts.");
    expect(card).not.toHaveTextContent("Total paid");
    expect(card).not.toHaveTextContent("Your payment is pending");
    // Said once: the Now sentence no longer repeats the charge rule.
    expect(document.body.textContent!.split("only charged").length - 1).toBe(1);
  });
  it("an authorized hold on a pending request reads the same way", async () => {
    h.manager = false; h.booking = withMoney({ status: "pending", paymentStatus: "authorized", paymentTransaction: { amount: 3050, serviceFee: 200, managerRevenue: 0, status: "authorized" } });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(card).toHaveTextContent("Card hold$30.50");
    expect(card).not.toHaveTextContent("Total paid");
  });
  it.each([["declined", 9], ["expired", undefined]] as const)("after a %s request: hold released, nothing charged", async (_cause, actorId) => {
    h.manager = false;
    h.booking = withMoney({ status: "cancelled", paymentStatus: "failed", paymentDecision: { state: "complete", target: "cancelled", ...(actorId ? { actorId } : {}) },
      paymentTransaction: { amount: 3050, serviceFee: 0, managerRevenue: 0, status: "canceled" } });
    render(<BookingDetailsPage />);
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByTestId("payment-status-line")).toHaveTextContent("Hold released. You weren’t charged.");
    expect(within(card).queryByTestId("payment-headline")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("Total paid");
  });
  const extras = [
    { id: 21, kind: "extension", minutes: 30, amountCents: 1438, kitchenShareCents: 1250, refundedCents: 0, paidAt: "2030-01-15T15:00:00Z", status: "succeeded" },
    { id: 22, kind: "damage_claim", minutes: null, amountCents: 9000, kitchenShareCents: 9000, refundedCents: 0, paidAt: "2030-01-16T15:00:00Z", status: "succeeded" },
  ];
  it('chef: live #197 includes the change charge and states the refunded amount', async () => {
    h.manager = false;
    h.booking = withMoney({ status: 'confirmed', paymentStatus: 'partially_refunded', totalPrice: 5000,
      paymentTransaction: { amount: 6100, serviceFee: 350, taxAmount: 750, managerRevenue: 5750, stripeProcessingFee: 256,
        status: 'partially_refunded', refundAmount: 2922 },
      additionalCharges: [{ id: 197, kind: 'kitchen_change', minutes: null, amountCents: 3050, refundedCents: 0, status: 'succeeded', paidAt: null }] });
    render(<BookingDetailsPage />);
    await screen.findByTestId('payment-card');
    expect(headline()).toBe('$91.50');
    expect(screen.getByTestId('payment-status-line')).toHaveTextContent('Refunded $29.22');
    expect(screen.getByTestId('extra-charge-line')).toHaveTextContent('Booking change$30.50');
  });
  it('chef: refunds on both the original and change payment are included in the summary', async () => {
    h.manager = false;
    h.booking = withMoney({ status: 'confirmed', paymentStatus: 'paid',
      paymentTransaction: { amount: 6100, serviceFee: 350, managerRevenue: 5750, status: 'partially_refunded', refundAmount: 2922 },
      additionalCharges: [{ id: 197, kind: 'kitchen_change', minutes: null, amountCents: 3050, refundedCents: 500, status: 'partially_refunded', paidAt: null }] });
    render(<BookingDetailsPage />);
    await screen.findByTestId('payment-card');
    expect(headline()).toBe('$91.50');
    expect(screen.getByTestId('payment-status-line')).toHaveTextContent('Refunded $34.22');
  });
  it('manager: original and change payout shares count once, including add-on refund debits', async () => {
    h.manager = true;
    h.booking = withMoney({ status: 'confirmed', paymentStatus: 'partially_refunded', totalPrice: 5000,
      paymentTransaction: { amount: 6100, serviceFee: 350, managerRevenue: 5750, status: 'partially_refunded', refundAmount: 2922, kitchenShareCents: 2747 },
      additionalCharges: [{ id: 197, kind: 'kitchen_change', minutes: null, amountCents: 3050, kitchenShareCents: 2739, refundedCents: 0, status: 'succeeded', paidAt: null }],
      payout: { timing: 'after_closeout', status: 'scheduled', amountCents: 5486 } });
    render(<BookingDetailsPage />);
    await screen.findByTestId('payment-card');
    expect(headline()).toBe('$54.86');
    expect(screen.getByTestId('extra-charge-line')).toHaveTextContent('Booking change$27.39');
  });
  it("chef: Total paid includes extra time and the claim payment, each listed, with an honest receipt note", async () => {
    h.manager = false; h.booking = withMoney({ status: "completed", paymentStatus: "paid" });
    render(<BookingDetailsPage />);
    await screen.findByTestId("payment-card");
    const parent = Number(headline().replace(/[^0-9.]/g, ""));
    cleanup();
    h.booking = withMoney({ status: "completed", paymentStatus: "paid", additionalCharges: extras.map(({ kitchenShareCents: _hidden, ...line }) => line) });
    render(<BookingDetailsPage />);
    await screen.findByTestId("payment-card");
    expect(Number(headline().replace(/[^0-9.]/g, ""))).toBeCloseTo(parent + 104.38, 2);
    expect(screen.getByTestId("payment-card")).toHaveTextContent("Total paid");
    const lines = screen.getAllByTestId("extra-charge-line");
    expect(lines[0]).toHaveTextContent("Extra time · 30 min$14.38");
    expect(lines[1]).toHaveTextContent("Damage and cleaning$90.00");
    expect(screen.getByTestId("extra-charges-total")).toHaveTextContent(`Total paid, all charges${headline()}`);
    expect(screen.getByTestId("extra-charges")).toHaveTextContent("Extra charges have their own receipts in your email.");
  });
  it("manager: the payout headline adds the kitchen share of each extra line, listed separately", async () => {
    h.manager = true;
    h.booking = withMoney({ status: "completed", paymentStatus: "paid", additionalCharges: extras,
      payout: { timing: "after_closeout", status: "sent", holdReason: null, expectedAt: null, sentAt: "2030-01-16T15:30:00Z", amountCents: 10942 } });
    render(<BookingDetailsPage />);
    await screen.findByTestId("payment-card");
    // The headline is exactly the sum of the visible lines: the booking's own net payout ($113.00 here) + each extra line's net.
    // It never starts from payout.amountCents, which already includes the extras (live #166 double-counted $14.38).
    expect(headline()).toBe("$215.50"); // 113.00 + 12.50 + 90.00
    const lines = screen.getAllByTestId("extra-charge-line");
    expect(lines[0]).toHaveTextContent("Extra time · 30 min$12.50");
    expect(lines[1]).toHaveTextContent("Damage and cleaning$90.00");
    expect(screen.getByTestId("extra-charges")).not.toHaveTextContent("$14.38");
  });
  it("extra charges never count before the booking itself was captured", async () => {
    h.manager = false; h.booking = withMoney({ status: "pending", paymentStatus: "authorized", additionalCharges: extras,
      paymentTransaction: { amount: 3050, serviceFee: 200, managerRevenue: 0, status: "authorized" } });
    render(<BookingDetailsPage />);
    await screen.findByTestId("payment-card");
    expect(headline()).toBe("$30.50");
    expect(screen.queryByTestId("extra-charges")).not.toBeInTheDocument();
  });
});

describe('claim-aware booking page', () => {
  const sent = () => ({ id: 7, bookingId: 5, visitId: null, chefId: 1, managerId: 2, claimVersion: 2,
    status: 'submitted', chefVisible: true, chefOwes: true, amountCents: 7000, claimedAmountCents: 7000,
    deadline: '2030-01-18T15:30:00Z', visitEvidence: { kitchenName: 'Harbour Kitchen', timezone: 'America/St_Johns', before: [], after: [] },
    history: [], evidence: [], lines: [] });
  const checkedOut = () => ({ ...base(), status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'checkout_requested',
    checkedInAt: '2030-01-15T13:32:00Z', checkoutRequestedAt: '2030-01-15T15:20:00Z', totalPrice: 10000,
    paymentTransaction: { amount: 10000, serviceFee: 700, managerRevenue: 9300, stripeProcessingFee: 320, status: 'succeeded' } });
  it('chef payment refetches booking details and updates the total without remounting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START + 3 * 3600000);
    h.manager = false; h.booking = checkedOut(); h.claims = [sent()];
    render(<BookingDetailsPage />);
    expect(await screen.findByTestId('booking-next-step')).toHaveTextContent('Harbour Kitchen reported damage or extra cleaning. Pay or dispute by');
    expect(screen.getByTestId('booking-next-step')).not.toHaveTextContent('all set');
    const before = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Pay $70.00' })[0]);
    const paid = await screen.findByRole('button', { name: 'Confirm mock claim payment' });
    h.booking = { ...h.booking, additionalCharges: [{ id: 20, kind: 'damage_claim', amountCents: 7000, refundedCents: 0, paidAt: '2030-01-16T15:00:00Z', status: 'succeeded' }] };
    h.claims = [{ ...sent(), status: 'charge_succeeded', chefOwes: false }];
    fireEvent.click(paid);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByTestId('extra-charges-total')).toHaveTextContent('$170.00');
    expect(screen.getByTestId('booking-next-step')).toHaveTextContent('You paid $70.00 for damage or extra cleaning.');
  });
  it('manager gets support instead of another report entry for this visit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START + 3 * 3600000);
    h.manager = true; h.booking = checkedOut(); h.claims = [sent()];
    render(<BookingDetailsPage />); await screen.findByTestId('booking-header');
    expect(screen.queryByRole('button', { name: 'Report damage or extra cleaning' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /You reported this visit/ });
    expect(link).toHaveAttribute('href', '/manager/dashboard?view=support');
    expect(link).toHaveClass('!text-muted-foreground');
  });
});

it('shows a dated chef booking as a span, day count and chronological day list while keeping the whole payment', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START + 2 * 86_400_000);
  h.manager = false;
  h.booking = { ...base(), scheduleRevision: 1, status: 'confirmed', paymentStatus: 'paid',
    paymentTransaction: { amount: 30000, serviceFee: 2000, managerRevenue: 28000, status: 'succeeded' }, totalPrice: 28000,
    cancellationPolicySnapshot: { noticeHours: 24, lateChargePercent: 50, timezone: 'America/St_Johns', sessions: [{ startAt: '2030-01-15T13:30:00Z' }], deadlineBasis: 'booking_first_day' },
    visits: [15, 17, 19].map((day, i) => ({ id: i + 10, blockIndex: i, visitDate: `2030-01-${day}`, scheduleRevision: 1, scheduleState: 'active',
      startTime: '10:00', endTime: '12:00', checkinStatus: i === 0 ? 'checked_out' : 'not_checked_in', updatedAt: '2030-01-10T12:00:00Z' })) };
  render(<BookingDetailsPage />);
  expect(await screen.findByTestId('booking-day-list')).toHaveTextContent('Jan 15, 2030');
  expect(screen.getByTestId('booking-header')).toHaveTextContent('3 days');
  expect(screen.getByTestId('booking-header')).toHaveTextContent(/January 15.*January 19/);
  expect(screen.getByRole('link', { name: 'Open your visit' })).toHaveAttribute('href', '/booking/5/visit?visitId=11');
  expect(screen.getByTestId('payment-card')).toHaveTextContent('$300.00');
  // Day 3 of the stay: the one deadline (Jan 14) has passed, so the card says so instead of a past "Cancel by".
  expect(screen.getByTestId('cancellation-card')).toHaveTextContent(/refund deadline passed on Jan 14.*50%/);
});

it('opens a pending dated request for the kitchen when every day has its own clock (live crash, Oct 18)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START - 3 * 86_400_000);
  h.manager = true;
  const days = [15, 17, 19];
  h.booking = { ...base(), scheduleRevision: 1, createdAt: new Date(START - 3 * 86_400_000 - 3_600_000).toISOString(),
    cancellationPolicySnapshot: { noticeHours: 24, lateChargePercent: 100, timezone: 'America/St_Johns', sessions: days.map(day => ({ startAt: `2030-01-${day}T13:30:00Z` })), deadlineBasis: 'booking_first_day' },
    visits: days.map((day, i) => ({ id: i + 10, blockIndex: i, visitDate: `2030-01-${day}`, scheduleRevision: 1, scheduleState: 'active',
      startTime: '10:00', endTime: '12:00', checkinStatus: 'not_checked_in', updatedAt: '2030-01-10T12:00:00Z' })),
    closeout: { phase: 'upcoming', timezone: 'America/St_Johns', visits: days.map((day, i) => ({ key: `v${i}`, visitId: i + 10, phase: 'upcoming', arrivalRecorded: false,
      scheduledStartAt: `2030-01-${day}T13:30:00Z`, scheduledEndAt: `2030-01-${day}T15:30:00Z`,
      inspection: { outcome: 'not_due', dueAt: null, deadline: null, closedAt: null, canRespond: false } })) } };
  render(<BookingDetailsPage />);
  expect(await screen.findByTestId('booking-header')).toHaveTextContent('3 days');
});

it('the header counts the days still booked once a day is cancelled (cancelled days stay in the list)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START - 3 * 86_400_000);
  h.manager = false;
  h.booking = { ...base(), scheduleRevision: 1, status: 'confirmed', paymentStatus: 'partially_refunded',
    paymentTransaction: { amount: 30000, serviceFee: 2000, managerRevenue: 28000, status: 'partially_refunded' }, totalPrice: 28000,
    cancellationPolicySnapshot: { noticeHours: 24, lateChargePercent: 50, timezone: 'America/St_Johns', sessions: [{ startAt: '2030-01-15T13:30:00Z' }], deadlineBasis: 'booking_first_day' },
    visits: [15, 17, 19].map((day, i) => ({ id: i + 10, blockIndex: i, visitDate: `2030-01-${day}`, scheduleRevision: 1, scheduleState: i === 2 ? 'cancelled' : 'active',
      startTime: '10:00', endTime: '12:00', checkinStatus: 'not_checked_in', updatedAt: '2030-01-10T12:00:00Z' })) };
  render(<BookingDetailsPage />);
  const header = await screen.findByTestId('booking-header');
  expect(header).toHaveTextContent('2 days');
  expect(header).toHaveTextContent(/January 15.*January 17/);
  expect(screen.getByTestId('booking-day-list')).toHaveTextContent('Jan 19, 2030');
});
