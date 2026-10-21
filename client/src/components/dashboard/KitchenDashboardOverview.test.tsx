import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render as renderDom, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  kitchens: [] as Array<{ id: number; locationId: number; name: string; isActive: boolean; listingStatus: string }>,
  bookings: [] as Array<Record<string, unknown>>,
  viewings: [] as Array<Record<string, unknown>>,
  applications: [] as Array<Record<string, unknown>>,
  rentals: [] as Array<Record<string, unknown>>,
  payouts: { totalCents: 0, payouts: [] } as { totalCents: number; payouts: Array<Record<string, unknown>> },
  hours: [] as Array<Record<string, unknown>>,
  overrides: [] as Array<Record<string, unknown>>,
  licenseStatus: "approved" as string,
  /** When set, `mt` shows its values too ("key{...}"), for checking server-sourced text such as deadlines. */
  withParams: false,
  readiness: [] as Array<Record<string, unknown>>,
  licenseExpiry: "2099-01-01",
  activity: { paymentsNeedAttention: false, paymentsAction: "overviewPaymentsUpdate", unreadMessages: 0, storageBookings: [] as Array<Record<string, unknown>>, extensions: [] as Array<Record<string, unknown>>, storageCheckouts: [] as Array<Record<string, unknown>>, claims: [] as Array<Record<string, unknown>>, visits: [], isLoading: false, isError: false },
}));

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "manager-1", displayName: "Alex" } }) }));
vi.mock("@/hooks/use-manager-dashboard", () => ({ useManagerDashboard: () => ({ bookings: state.bookings, isLoadingBookings: false, isErrorBookings: false }) }));
vi.mock("@/hooks/use-manager-overview-activity", () => ({ useManagerOverviewActivity: () => ({ ...state.activity, listingReadiness: state.readiness }) }));
vi.mock("@/components/manager/revenue/hooks/use-manager-revenue", () => ({ useManagerRevenue: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "managerViewings" ? state.viewings : queryKey[0] === "/api/manager/kitchen-applications" ? state.applications
    : queryKey[0] === "/api/manager/storage-rentals" ? state.rentals : queryKey[0] === "/api/manager/revenue/upcoming-payouts" ? state.payouts : { totalRevenue: 0 }, isLoading: false, isError: false }),
  useQueries: ({ queries }: { queries: Array<{ queryKey: unknown[] }> }) => queries.map(({ queryKey }) => ({ data: queryKey[0] === "/api/manager/availability" ? state.hours : state.overrides, isLoading: false, isError: false })),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string, values?: Record<string, unknown>) => state.withParams && values && !("ns" in values) ? `${key}${JSON.stringify(values)}` : key }));
vi.mock("@/i18n/chef-ns", () => ({ ct: (key: string) => key }));
vi.mock("@/components/booking/BookingNowCard", () => ({ StatusPill: ({ children }: { children: ReactNode }) => <span data-testid="booking-status-pill">{children}</span>,
  PILL: new Proxy({}, { get: () => ({ surface: "", dot: "" }) }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));
// The real rows and sorting, a marker for the calendar itself (its own render is tested in BookingCalendarWidget.test).
vi.mock("./BookingCalendarWidget", async (importOriginal) => ({ ...(await importOriginal<typeof import("./BookingCalendarWidget")>()),
  default: ({ events, stats }: { events: Array<{ key: string; date: string; label: string; state?: string; kitchenId?: number }>; stats?: (kitchenId: number | null) => ReactNode }) => <>{stats?.(null)}<div data-testid="calendar">{events.map(event => `${event.key}@${event.date}:${event.label}${event.state ? `[${event.state}]` : ""}${event.kitchenId ? `{k${event.kitchenId}}` : ""}`).join("|")}</div><div data-testid="stats-kitchen-11">{stats?.(11)}</div></> }));

import KitchenDashboardOverview from "./KitchenDashboardOverview";

const location = () => ({
  id: 1,
  name: "Harbour Kitchen",
  address: "1 Main St",
  kitchenLicenseUrl: "license.pdf",
  kitchenLicenseStatus: state.licenseStatus,
  kitchenLicenseExpiry: state.licenseExpiry,
});

const render = () => renderToStaticMarkup(
  <KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={vi.fn()} />,
);

beforeEach(() => {
  state.kitchens = [];
  state.bookings = [];
  state.viewings = [];
  state.applications = [];
  state.rentals = [];
  state.payouts = { totalCents: 0, payouts: [] };
  state.hours = [];
  state.overrides = [];
  state.licenseStatus = "approved";
  state.licenseExpiry = "2099-01-01";
  state.withParams = false;
  state.readiness = [];
  state.activity.unreadMessages = 0;
  state.activity.paymentsNeedAttention = false;
  state.activity.storageBookings = [];
  state.activity.isError = false;
  state.activity.extensions = [];
  state.activity.storageCheckouts = [];
  state.activity.claims = [];
});

describe("manager overview states", () => {
  it('links missing departure assistance for a terminal tour and clears it after departure', () => {
    const tour = { id: 77, locationId: 1, status: 'completed', scheduledAt: '2025-01-01T12:00:00Z', durationMinutes: 30,
      checkedInAt: '2025-01-01T12:00:00Z', attendanceHistory: [{ action: 'check_in', actorId: 8, source: 'visitor',
        actualAt: '2025-01-01T12:00:00Z', recordedAt: '2025-01-01T12:00:00Z', scheduledAt: '2025-01-01T12:00:00.000Z' }] };
    state.viewings = [{ viewing: tour }];
    expect(render()).not.toContain('overviewTourDepartureAssistance');
    state.viewings = [{ viewing: { ...tour, checkedOutAt: '2025-01-01T12:30:00Z' } }];
    expect(render()).not.toContain('overviewTourDepartureAssistance');
  });
  it('shows disruption and correction history without making optional outcomes mandatory', () => {
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: 'completed', scheduledAt: '2025-01-01T12:00:00Z', updatedAt: '2025-01-01T14:00:00Z', outcomeHistory: [
      { from: 'confirmed', to: 'cancelled', disruptionReason: 'access_unavailable', recordedAt: '2025-01-01T13:00:00Z' },
      { from: 'cancelled', to: 'completed', recordedAt: '2025-01-01T14:00:00Z' },
    ] } }];
    const html = render();
    expect(html).toContain('activityTourDisrupted'); expect(html).toContain('activityTourCorrected');
    expect(html).not.toContain('overviewTourFeedback');
  });
  it("keeps four scrollable card slots in an empty workspace without readiness progress", () => {
    const html = render();
    expect(html.match(/h-\[320px\]/g)).toHaveLength(4);
    expect(html.match(/role="region"/g)).toHaveLength(4);
    expect(html).not.toContain("listingReviewReadyCount");
    expect(html).toContain("overviewRecentActivityEmpty");
  });
  it("shows ended confirmed tours in attention and removes recorded outcomes", () => {
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "confirmed", scheduledAt: "2025-01-01T12:00:00Z", durationMinutes: 30 }, chefName: "Jamie" }];
    expect(render()).toContain("overviewTourFeedback");
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const onNavigate = vi.fn();
    const screen = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={onNavigate} />);
    expect(screen.getByRole("link", { name: /Jamie/ })).toHaveAttribute('href', '/manager/tours/77?feedback=1');
    screen.unmount();
    vi.unstubAllGlobals();
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "no_show", scheduledAt: "2025-01-01T12:00:00Z", durationMinutes: 30 } }];
    expect(render()).not.toContain("overviewTourFeedback");
  });
  it("puts confirmed future tours on the calendar without creating a manager action", () => {
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "confirmed", scheduledAt: "2099-01-01T12:00:00Z", durationMinutes: 30 }, chefName: "Future Chef" }];
    const html = render();
    expect(html).toContain("tour-77@2099-01-01:ovrTourScheduled");
    expect(html).not.toContain("overviewTourFeedback");
  });
  it("shows messages and active storage before any kitchen bookings", () => {
    state.activity.unreadMessages = 3;
    state.activity.storageBookings = [{ id: 1, status: "confirmed", startDate: "2020-01-01", endDate: "2099-01-01" }];
    const html = render();
    expect(html).toContain("overviewUnreadMessages");
    expect(html).toContain("overviewStorageBookingType");
    expect(html).not.toContain("overviewInProgress");
    expect(html).not.toContain("overviewAllCaughtUp");
  });
  it("retains available actions when an activity source fails", () => {
    state.activity.unreadMessages = 2;
    state.activity.isError = true;
    const html = render();
    expect(html).toContain("overviewActivityPartialError");
    expect(html).toContain("overviewUnreadMessages");
    expect(html).not.toContain("overviewAllCaughtUp");
  });
  it("shows setup guidance before the first kitchen", () => {
    const html = render();
    expect(html).toContain("overviewEmptyTitle");
    expect(html).toContain("overviewRecentActivityEmpty");
  });

  it("keeps booking history visible after a kitchen is unpublished", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "draft" }];
    state.bookings = [{ id: 40, kitchenId: 10, locationId: 1, kitchenName: "Kitchen A", bookingDate: "2025-01-01", createdAt: "2024-12-01", startTime: "09:00", endTime: "12:00", status: "completed" }];
    const html = render();
    expect(html).toContain("listingStatusDraftLabel");
    expect(html).toContain('data-testid="overview-activity"');
    expect(html).toContain("/manager/booking/40");
  });

  it("keeps tour history visible without bookings", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "draft" }];
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "completed", scheduledAt: "2025-01-01T12:00:00Z", updatedAt: "2025-01-01T13:00:00Z" } }];
    const html = render();
    expect(html).toContain('data-testid="overview-activity"');
    expect(html).toContain("activityTourCompleted");
    expect(html).not.toContain("/manager/booking/77");
  });

  it("does not call an expired published kitchen bookable", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "active" }];
    state.licenseExpiry = "2020-01-01";
    const html = render();
    expect(html).toContain("overviewUnavailableShort");
    expect(html).toContain("overviewReviewLicense");
    expect(html).not.toContain("overviewAcceptingBookings");
  });

  it("guides a newly live kitchen to chef applications before bookings", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "active" }];
    const html = render();
    expect(html).toContain("overviewWaitingForApplications");
    expect(html).toContain("overviewViewApplications");
    expect(html).not.toContain("overviewNextSevenDays");
    expect(html).not.toContain("navAvailability");
  });

  it("surfaces pending chef applications before any bookings", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "active" }];
    state.applications = [{ id: 50, locationId: 1, status: "inReview" }];
    const html = render();
    expect(html).toContain("overviewPendingApplications");
    expect(html).toContain("overviewApplicationsToReview");
  });
});

it("keeps requested storage move-ins and unfinished expired storage actionable",()=>{state.activity.storageBookings=[{id:61,status:"confirmed",checkinStatus:"checkin_requested",checkoutStatus:"active",endDate:"2020-01-01T00:00:00Z",storageName:"Dry shelf"},{id:62,status:"confirmed",checkoutStatus:"completed",endDate:"2020-01-01T00:00:00Z",storageName:"Cleared shelf"}];const html=render();expect(html).toContain("overviewStorageCheckinReviews");expect(html).toContain("overviewStorageOutcomes");expect(html).not.toContain("Cleared shelf");});

it("prioritizes attention for listed kitchens and setup for unlisted kitchens",()=>{state.kitchens=[{id:10,locationId:1,name:"Kitchen East",listingStatus:"active",isActive:true},{id:11,locationId:1,name:"Kitchen West",listingStatus:"draft",isActive:true}];let html=render();expect(html.indexOf("overviewNeedsAttention")).toBeLessThan(html.indexOf("overviewListingStatus"));expect(html).toContain("Kitchen East");expect(html).toContain("Kitchen West");expect(html).toContain("listingStatusLiveLabel");expect(html).toContain("listingStatusDraftLabel");state.kitchens[0].listingStatus="draft";html=render();expect(html.indexOf("overviewListingStatus")).toBeLessThan(html.indexOf("overviewNeedsAttention"));});

it("explains booking history with status, chef, kitchen and schedule, without a history View all",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,chefName:"Morgan",kitchenName:"Kitchen East",bookingDate:"2025-01-01",createdAt:"2024-12-01",startTime:"09:00",endTime:"12:00",status:"cancelled"}];const html=render();const history=html.slice(html.indexOf('data-testid="overview-activity"'));expect(history).toContain("activityBookingRequested");expect(history).not.toContain("activityBookingCancelled");expect(history).toContain("Morgan · Kitchen East · Wed, Jan 1, 2025 · 9:00 a.m.–12:00 p.m.");expect(history).not.toContain("viewAll");expect(history).toContain("/manager/booking/90");});

it("does not count a submitted licence awaiting review as manager work",()=>{state.licenseStatus="pending";const html=render();expect(html).not.toContain("overviewLicenseAttention");expect(html).toContain("overviewAllCaughtUp");});

it("keeps dated storage, application and claim history visible during a partial failure",()=>{state.applications=[{id:20,locationId:1,fullName:"Applicant",status:"approved",createdAt:"2025-01-01"}];state.activity.storageBookings=[{id:21,status:"cancelled",storageName:"Dry storage",createdAt:"2025-01-02"}];state.activity.claims=[{id:22,status:"under_review",claimTitle:"Worktop damage",createdAt:"2025-01-03"}];state.activity.isError=true;const html=render();const history=html.slice(html.indexOf('data-testid="overview-activity"'));expect(history).toContain("overviewActivityPartialError");expect(history).toContain("overviewApplicationActivity");expect(history).toContain("activityStorageRequested");expect(history).not.toContain("overviewStorageActivity");expect(history).toContain("overviewClaimActivity");expect(html).not.toContain("overviewClaimsToAction");});

it("never substitutes a chef email for a display name in overview rows",()=>{state.activity.storageBookings=[{id:30,status:"pending",chefName:"chef@example.com",chefEmail:"chef@example.com",storageName:"Dry shelf",createdAt:"2025-01-01"}];state.activity.claims=[{id:31,status:"draft",chefEmail:"chef@example.com",claimTitle:"Worktop damage",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("chef@example.com");expect(html).toContain("guestChef");expect(html).toContain("Dry shelf");});

it("uses the parent booking chef identity in recent storage activity",()=>{state.bookings=[{id:5,chefId:2,kitchenId:10,chefName:"Morgan Lee",locationId:1,status:"completed",bookingDate:"2025-01-01",createdAt:"2025-01-01",startTime:"09:00",endTime:"12:00"}];state.activity.storageBookings=[{id:10,chefId:2,chefName:"Guest chef",chefEmail:"email@example.com",storageName:"Dry shelf",status:"cancelled",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("email@example.com");expect(html).not.toContain("Guest chef");expect(html.match(/Morgan Lee/g)?.length).toBeGreaterThanOrEqual(2);expect(html).not.toContain("scrollbar-width:thin");});

it("lists payout work once in Needs attention",()=>{state.activity.paymentsNeedAttention=true;const html=render();expect(html).toContain("overviewPaymentsUpdate");expect(html.match(/overviewPaymentsAttention/g)).toHaveLength(1);});

it("shows only payment recovery work for a linked item with an unfinished parent decision",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,status:"pending",paymentStatus:"authorized",paymentDecision:{state:"pending"},bookingDate:"2099-01-01",startTime:"09:00",endTime:"10:00"}];state.activity.storageBookings=[{id:91,kitchenBookingId:90,status:"pending",storageName:"Held shelf",createdAt:"2025-01-01"}];const html=render();expect(html).toContain("overviewPaymentRecovery");expect(html).not.toContain("overviewStorageRequests");expect(html).not.toContain("overviewBookingRequests");});

it("lists a booking request once in Recent activity, not as both the booking and its 'requested' event", () => {
  state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: "2025-01-01", createdAt: "2024-12-01T12:00:00Z", startTime: "09:00", endTime: "12:00", status: "pending" }];
  (state.activity as Record<string, unknown>).bookingEvents = [
    { id: 1, bookingId: 90, kind: "requested", title: "Kitchen booking requested", createdAt: "2024-12-01T12:00:00Z", kitchenName: "Kitchen East" },
    { id: 2, bookingId: 90, kind: "confirmed", title: "Kitchen booking confirmed", createdAt: "2024-12-02T12:00:00Z", kitchenName: "Kitchen East" },
  ];
  try {
    const html = render();
    const history = html.slice(html.indexOf('data-testid="overview-activity"'));
    expect(history).toContain("activityBookingRequested");
    expect(history).not.toContain("Kitchen booking requested");
    expect(history).toContain("Kitchen booking confirmed");
  } finally { delete (state.activity as Record<string, unknown>).bookingEvents; }
});

describe("revamped overview (R3)", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/St_Johns", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  const plus = (days: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const weekStart = plus(-new Date(`${today}T12:00:00Z`).getUTCDay());
  const live = () => { state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen East", isActive: true, listingStatus: "active" }]; };

  it("keeps the first-time view staged: no Today card, week strip or calendar until there is activity", () => {
    live();
    let html = render();
    expect(html).not.toContain('data-testid="overview-today"');
    expect(html).not.toContain('data-testid="overview-week"');
    expect(html).not.toContain('data-testid="calendar"');
    expect(html.match(/h-\[320px\]/g)).toHaveLength(4);
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(3), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "confirmed" }];
    html = render();
    expect(html).toContain('data-testid="overview-today"');
    expect(html).toContain('data-testid="overview-week"');
    expect(html).toContain('data-testid="calendar"');
    expect(html).toContain('data-testid="overview-revenue"');
  });

  it("lists a multi-day booking once per day with its own times, never merged slots", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(2), createdAt: "2025-01-01",
      startTime: "20:00", endTime: "21:00", status: "confirmed", scheduleRevision: 1,
      selectedSlots: [{ startTime: "20:00", endTime: "21:00" }, { startTime: "20:00", endTime: "21:00" }],
      visitStates: [{ id: 901, checkinStatus: "not_checked_in", visitDate: plus(2), startTime: "20:00", endTime: "21:00" },
        { id: 902, checkinStatus: "not_checked_in", visitDate: plus(3), startTime: "20:00", endTime: "21:00" }] }];
    const html = render();
    expect(html).not.toContain("8:00–9:00 p.m., 8:00–9:00 p.m.");
    const calendar = html.slice(html.indexOf('data-testid="calendar"'));
    expect(calendar).toContain(`booking-90-901-0@${plus(2)}`);
    expect(calendar).toContain(`booking-90-902-0@${plus(3)}`);
  });

  it("links every needs-attention item to the exact rental or day", () => {
    live();
    state.rentals = [
      { id: 61, kitchen: { id: 10, name: "Kitchen East" }, listing: { id: 5, name: "Dry shelf" }, chef: { id: 2, name: "Sam" }, state: "requested", startOn: plus(4), paidThrough: plus(10), responseDeadline: null, actions: [], terms: [] },
      { id: 62, kitchen: { id: 10, name: "Kitchen East" }, listing: { id: 6, name: "Cooler" }, chef: { id: 3, name: "Ana" }, state: "move_out_requested", startOn: plus(-9), paidThrough: plus(1), responseDeadline: null, actions: [], terms: [] },
      { id: 63, kitchen: { id: 99, name: "Elsewhere" }, listing: { id: 7, name: "Other" }, chef: { id: 4, name: "Lee" }, state: "requested", startOn: plus(4), paidThrough: plus(10), responseDeadline: null, actions: [], terms: [] },
    ];
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(-3), createdAt: "2025-01-01",
      startTime: "09:00", endTime: "10:00", status: "confirmed", checkinStatus: "checkout_requested", scheduleRevision: 1,
      visitStates: [{ id: 901, checkinStatus: "checked_out", visitDate: plus(-3), startTime: "09:00", endTime: "10:00" },
        { id: 902, checkinStatus: "checkout_requested", visitDate: plus(-2), startTime: "09:00", endTime: "10:00" }] }];
    const html = render();
    const attention = html.slice(html.indexOf('aria-label="overviewNeedsAttention"'), html.indexOf('data-testid="overview-today"'));
    expect(attention).toContain('href="/manager/storage/61"');
    expect(attention).toContain("ovrStorageStarts");
    expect(attention).toContain('href="/manager/storage/62"');
    expect(attention).toContain("ovrStorageToAction");
    expect(attention).not.toContain("/manager/storage/63");
    expect(attention).toContain('href="/manager/booking/90/inspection?visitId=902"');
    expect(attention).toContain("mdDayOf · ");
    expect(attention).not.toContain("overviewAllCaughtUp");
  });

  it("counts this week's bookings and utilisation of open hours (closures removed) against last week", () => {
    live();
    state.bookings = [
      { id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", bookingDate: weekStart, createdAt: "2025-01-01", startTime: "10:00", endTime: "12:00", status: "completed" },
      { id: 91, kitchenId: 10, locationId: 1, chefName: "Morgan", bookingDate: plus(-new Date(`${today}T12:00:00Z`).getUTCDay() - 3), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "completed" },
      { id: 92, kitchenId: 10, locationId: 1, chefName: "Morgan", bookingDate: weekStart, createdAt: "2025-01-01", startTime: "13:00", endTime: "14:00", status: "cancelled" },
    ];
    // 4 open hours a day, one day closed this week: 24 open hours; 2 booked = 8%.
    state.hours = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, startTime: "09:00", endTime: "13:00", isAvailable: true }));
    state.overrides = [{ id: 1, specificDate: `${weekStart}T00:00:00.000Z`, isAvailable: false, reason: "Maintenance" }];
    const html = render();
    const tile = (key: string) => html.slice(html.indexOf(`data-testid="week-${key}"`)).slice(0, 600);
    expect(tile("bookings")).toMatch(/>1<\/dd>/);
    expect(tile("utilisation")).toContain("8%");
    const calendar = html.slice(html.indexOf('data-testid="calendar"'));
    expect(calendar).toContain(`override-10-1@${weekStart}:closed`);
  });

  it("shows upcoming and on-hold payouts for this location only, with the next payout day", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, bookingDate: plus(1), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "confirmed" }];
    state.payouts = { totalCents: 0, payouts: [
      { bookingId: 90, status: "scheduled", amountCents: 4500, expectedAt: "2026-10-21T13:30:00.000Z", timezone: "America/St_Johns" },
      { bookingId: 90, status: "on_hold", amountCents: 1200, expectedAt: null },
      { bookingId: 555, status: "scheduled", amountCents: 9999, expectedAt: "2026-10-19T13:30:00.000Z" },
    ] };
    const html = render();
    const card = html.slice(html.indexOf('data-testid="overview-revenue"'));
    expect(card).toContain("$45.00");
    expect(card).toContain("$12.00");
    expect(card).not.toContain("$99.99");
    expect(card).toContain("ovrNextPayout");
    expect(card).toContain("ovrOnHoldCount");
  });

  const attentionOf = (html: string) => html.slice(html.indexOf('aria-label="overviewNeedsAttention"'), html.indexOf('data-testid="overview-today"'));

  it("names the day that ended in Follow up ended bookings, not the booking's next day, and opens that day's inspection", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(-1), createdAt: "2025-01-01",
      startTime: "09:00", endTime: "10:00", status: "confirmed", checkinStatus: "not_checked_in", scheduleRevision: 1,
      visitStates: [{ id: 901, checkinStatus: "not_checked_in", visitDate: plus(-1), startTime: "09:00", endTime: "10:00" },
        { id: 902, checkinStatus: "not_checked_in", visitDate: plus(5), startTime: "17:00", endTime: "18:00" }] }];
    const attention = attentionOf(render());
    expect(attention).toContain("overviewBookingOutcomes");
    expect(attention).toContain('href="/manager/booking/90/inspection?visitId=901"');
    expect(attention).toContain("9:00–10:00 a.m.");
    expect(attention).not.toContain("visitId=902");
    expect(attention).not.toContain("5:00–6:00 p.m.");
  });

  it("lists every ended day of a multi-day booking under its own follow-up, each with its inspection", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(-2), createdAt: "2025-01-01",
      startTime: "09:00", endTime: "10:00", status: "confirmed", checkinStatus: "checkout_requested", scheduleRevision: 1,
      visitStates: [{ id: 901, checkinStatus: "not_checked_in", visitDate: plus(-2), startTime: "09:00", endTime: "10:00" },
        { id: 902, checkinStatus: "checkout_requested", visitDate: plus(-1), startTime: "17:00", endTime: "18:00" },
        { id: 903, checkinStatus: "not_checked_in", visitDate: plus(5), startTime: "12:00", endTime: "13:00" }] }];
    const attention = attentionOf(render());
    const group = (label: string) => attention.slice(attention.indexOf(label)).split("</section>")[0];
    expect(group("overviewKitchenCheckoutReviews")).toContain('href="/manager/booking/90/inspection?visitId=902"');
    expect(group("overviewKitchenCheckoutReviews")).toContain("5:00–6:00 p.m.");
    expect(group("overviewBookingOutcomes")).toContain('href="/manager/booking/90/inspection?visitId=901"');
    expect(group("overviewBookingOutcomes")).toContain("9:00–10:00 a.m.");
    expect(attention).not.toContain("visitId=903");
  });

  it("does not flag a multi-day booking whose ended day was checked out (stale booking-level check-in, as on dev)", () => {
    live();
    // Dev booking 209: the booking row still says not_checked_in with day 1's times; day 1 was checked out, day 2 is ahead.
    state.bookings = [{ id: 209, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(-1), createdAt: "2025-01-01",
      startTime: "17:00", endTime: "18:00", status: "confirmed", checkinStatus: "not_checked_in", attendanceReviewComplete: false, scheduleRevision: 1,
      visitStates: [{ id: 158, checkinStatus: "checked_out", visitDate: plus(-1), startTime: "17:00", endTime: "18:30" },
        { id: 159, checkinStatus: "not_checked_in", visitDate: plus(5), startTime: "17:00", endTime: "18:00" }] }];
    const attention = attentionOf(render());
    expect(attention).not.toContain("overviewBookingOutcomes");
    expect(attention).not.toContain("visitId=159");
    expect(attention).toContain("overviewAllCaughtUp");
  });

  it("lists a day's checkout to review even when the booking row's own times have not ended (as on dev)", () => {
    live();
    // Dev booking 212: day 1's checkout is waiting; the booking row says not_checked_in, so the booking-level check missed it.
    state.bookings = [{ id: 212, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: plus(5), createdAt: "2025-01-01",
      startTime: "20:00", endTime: "21:00", status: "confirmed", checkinStatus: "not_checked_in", scheduleRevision: 1,
      visitStates: [{ id: 171, checkinStatus: "checkout_requested", visitDate: plus(-1), startTime: "20:00", endTime: "21:00" },
        { id: 172, checkinStatus: "not_checked_in", visitDate: plus(5), startTime: "20:00", endTime: "21:00" }] }];
    const attention = attentionOf(render());
    expect(attention).toContain("overviewKitchenCheckoutReviews");
    expect(attention).toContain('href="/manager/booking/212/inspection?visitId=171"');
    expect(attention).not.toContain("visitId=172");
  });

  describe("Today card", () => {
    const day = "2026-10-18";
    const booking = (id: number, chefName: string, startTime: string, endTime: string, status: string) =>
      ({ id, kitchenId: 10, locationId: 1, chefId: id, chefName, kitchenName: "Kitchen East", bookingDate: day, createdAt: "2025-01-01", startTime, endTime, status });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-18T15:00:00Z")); // 12:30 p.m. in St. John's
      live();
      state.bookings = [booking(91, "Cancelled Chef One", "10:00", "11:00", "cancelled"), booking(92, "Cancelled Chef Two", "10:00", "11:00", "cancelled"),
        booking(93, "TestSprite chef with a long display name", "20:00", "21:00", "confirmed"), booking(94, "Finished Chef", "08:00", "09:00", "completed")];
    });
    afterEach(() => vi.useRealTimers());
    const todayOf = (html: string) => html.slice(html.indexOf('data-testid="overview-today"'), html.indexOf('data-testid="overview-week"'));

    it("lists the day in time order with the now-line, and folds only the cancelled ones", () => {
      const card = todayOf(render());
      const text = card.replace(/<[^>]+>/g, " ");
      expect(text.indexOf("Finished Chef")).toBeLessThan(text.indexOf("ovrNowAt"));
      expect(text.indexOf("ovrNowAt")).toBeLessThan(text.indexOf("TestSprite chef with a long display name"));
      expect(card).toContain("ovrNoOneInKitchen");
      expect(card).not.toContain("Cancelled Chef");
      expect(card).toMatch(/aria-expanded="false"[^>]*>.*ovrTodayCancelled/);
      expect(card).not.toContain("ovrNothingToday");
      // The name wraps in the narrow column instead of being cut off.
      expect(card).not.toMatch(/truncate[^"]*">TestSprite/);
    });

    it("shows the cancelled rows when the line is opened", () => {
      vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
      const screen = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={vi.fn()} />);
      const card = screen.getByTestId("overview-today");
      const toggle = within(card).getByRole("button", { name: /ovrTodayCancelled/ });
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const text = card.textContent!;
      expect(text.indexOf("TestSprite")).toBeLessThan(text.indexOf("Cancelled Chef One"));
      expect(text).toContain("Cancelled Chef Two");
      screen.unmount();
      vi.unstubAllGlobals();
    });

    it("lists tomorrow's bookings under the day, each linking to its booking", () => {
      state.bookings.push({ ...booking(95, "Tomorrow Chef", "13:00", "15:00", "confirmed"), bookingDate: "2026-10-19" });
      const tomorrow = render().split('data-testid="overview-tomorrow"')[1].split("</section>")[0];
      expect(tomorrow).toContain("Tomorrow Chef");
      expect(tomorrow).toContain("1:00–3:00 p.m.");
      expect(tomorrow).toContain('href="/manager/booking/95"');
    });
  });

  describe("Did they come?", () => {
    // Dev booking 207 on Oct 21, 2026: day 2 still answerable until 4:00 p.m. tomorrow, day 1 recorded; booking 300's window closed.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-21T21:00:00Z")); // 6:30 p.m. in St. John's
      live();
      state.bookings = [{ id: 207, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: "2026-10-18", createdAt: "2025-01-01",
        startTime: "14:00", endTime: "16:00", status: "completed", checkinStatus: "not_checked_in", timezone: "America/St_Johns", scheduleRevision: 1,
        visitStates: [{ id: 156, checkinStatus: "checked_out", visitDate: "2026-10-18", startTime: "14:00", endTime: "16:00" },
          { id: 157, checkinStatus: "not_checked_in", visitDate: "2026-10-21", startTime: "14:00", endTime: "16:00" }],
        closeout: { phase: "ended", visits: [
          { visitId: 156, localDate: "2026-10-18", startTime: "14:00", endTime: "16:00", attendance: "recorded", inspection: { canRespond: false, deadline: "2026-10-19T18:30:00.000Z" } },
          { visitId: 157, localDate: "2026-10-21", startTime: "14:00", endTime: "16:00", attendance: "unknown", inspection: { canRespond: true, deadline: "2026-10-22T18:30:00.000Z" } },
        ] } },
        { id: 300, kitchenId: 10, locationId: 1, chefName: "Closed Chef", kitchenName: "Kitchen East", bookingDate: "2026-10-17", createdAt: "2025-01-01",
          startTime: "09:00", endTime: "10:00", status: "completed", checkinStatus: "not_checked_in", timezone: "America/St_Johns",
          closeout: { phase: "ended", visits: [{ localDate: "2026-10-17", startTime: "09:00", endTime: "10:00", attendance: "unknown", inspection: { canRespond: false, deadline: "2026-10-18T13:30:00.000Z" } }] } }];
    });
    afterEach(() => vi.useRealTimers());

    it("asks only about visits still in their window, with the server's deadline, and both answers open the visit record", () => {
      state.withParams = true;
      const attention = attentionOf(render());
      const group = attention.split('id="attention-attendance"')[1];
      expect(group).toContain("ovrDidTheyComeNote");
      expect(group.match(/data-testid="attendance-answer-row"/g)).toHaveLength(1);
      expect(group).toContain("ovrAnswerBy{&quot;when&quot;:&quot;Thu, Oct 22, 4:00 p.m.&quot;}");
      expect(group).toContain('href="/manager/booking/207?visitId=157&amp;attendance=came"');
      expect(group).toContain('href="/manager/booking/207?visitId=157&amp;attendance=no_show"');
      expect(attention).not.toContain("Closed Chef");
      // Asked once: not also a "Follow up ended bookings" row.
      expect(attention).not.toContain("overviewBookingOutcomes");
    });

    it("marks the answerable day Answer needed on the calendar and the closed one No check-in recorded", () => {
      const calendar = render().split('data-testid="calendar"')[1];
      expect(calendar).toContain("booking-207-157-0@2026-10-21:ovrLegendAnswerNeeded[answer]");
      expect(calendar).toContain("booking-207-156-0@2026-10-18:ovrLegendFinished[finished]");
      expect(calendar).toMatch(/booking-300-0-0@2026-10-17:[^|]*\[noCheckin\]/);
    });
  });

  describe("listing chip", () => {
    const withBooking = () => { state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", bookingDate: plus(3), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "confirmed" }]; };
    it("names a single kitchen with its state and its optional improvements", () => {
      live(); withBooking(); state.withParams = true;
      state.readiness = [{ kitchenId: 10, data: { checklist: { missingRequirementIds: [], openRecommendationIds: ["gallery", "tours"] } } }];
      const chip = render().split('data-testid="listing-chip"')[1].split("</button>")[0];
      expect(chip).toContain("Kitchen East");
      expect(chip).toContain("listingStatusLiveLabel");
      expect(chip).toContain("ovrOptionalImprovements{&quot;count&quot;:2}");
    });
    it("sums up several kitchens and lists each one, with its state, in a popover", () => {
      vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
      state.withParams = true;
      state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen East", isActive: true, listingStatus: "active" }, { id: 11, locationId: 1, name: "Pastry Room", isActive: true, listingStatus: "draft" },
        { id: 12, locationId: 1, name: "Cold Prep", isActive: true, listingStatus: "active" }];
      state.readiness = [{ kitchenId: 11, data: { checklist: { missingRequirementIds: ["rate"], openRecommendationIds: [] } } }];
      withBooking();
      const onNavigate = vi.fn();
      const screen = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={onNavigate} />);
      const chip = screen.getByTestId("listing-chip");
      expect(chip.textContent).toBe('overviewKitchenCount{"count":3}ovrListedCount{"count":2} · ovrNotListedCount{"count":1}');
      fireEvent.pointerDown(chip, { button: 0, ctrlKey: false });
      fireEvent.click(chip);
      const list = within(screen.getByTestId("listing-popover"));
      expect(list.getAllByRole("button").map(button => button.textContent)).toEqual(["Kitchen EastlistingStatusLiveLabel",
        'Pastry RoomovrItemsToFinish{"count":1}listingStatusDraftLabel', "Cold PreplistingStatusLiveLabel"]);
      fireEvent.click(list.getByRole("button", { name: /Pastry Room/ }));
      expect(onNavigate).toHaveBeenCalledWith("listing-review", 11);
      screen.unmount();
      vi.unstubAllGlobals();
    });
  });

  it("gives each storage row its reason and the rental page's own action", () => {
    live();
    state.rentals = [
      { id: 45, kitchen: { id: 10, name: "Kitchen East" }, listing: { id: 5, name: "Dry shelf" }, chef: { id: 2, name: "Sam" }, state: "reserved", startOn: plus(-4), paidThrough: plus(9), timezone: "America/St_Johns", actions: [], terms: [] },
      { id: 46, kitchen: { id: 10, name: "Kitchen East" }, listing: { id: 6, name: "Cooler" }, chef: { id: 3, name: "Ana" }, state: "removal_review", startOn: plus(-20), paidThrough: plus(-2), actions: [], terms: [] },
    ];
    const group = attentionOf(render()).split('id="attention-storage"')[1];
    const row = (id: number) => group.split(`href="/manager/storage/${id}"`)[1].split("</a>")[0];
    expect(row(45)).toContain("Sam · stChipMoveInOverdue");
    expect(row(45)).toContain("stActionHandover");
    expect(row(46)).toContain("Ana · stChipRemovalReview");
    expect(row(46)).toContain("stActionRecordRemoval");
  });

  describe("several kitchens at the location", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-21T21:00:00Z")); // Wed 6:30 p.m. in St. John's
      state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen East", isActive: true, listingStatus: "active" }, { id: 11, locationId: 1, name: "Kitchen West", isActive: true, listingStatus: "active" }];
      const visit = (id: number, kitchenId: number, chefName: string, bookingDate: string, status: string, extra = {}) => ({ id, kitchenId, locationId: 1, chefName, kitchenName: kitchenId === 10 ? "Kitchen East" : "Kitchen West",
        bookingDate, createdAt: "2025-01-01", startTime: "13:00", endTime: "15:00", status, timezone: "America/St_Johns", ...extra });
      state.bookings = [
        visit(207, 11, "Morgan", "2026-10-21", "completed", { checkinStatus: "not_checked_in", closeout: { phase: "ended", visits: [{ localDate: "2026-10-21", startTime: "13:00", endTime: "15:00", attendance: "unknown", inspection: { canRespond: true, deadline: "2026-10-22T18:30:00.000Z" } }] } }),
        // Both kitchens booked at the same hours tomorrow.
        visit(400, 10, "East Chef", "2026-10-22", "confirmed"), visit(401, 11, "West Chef", "2026-10-22", "confirmed")];
      state.rentals = [{ id: 45, kitchen: { id: 11, name: "Kitchen West" }, listing: { id: 5, name: "Dry shelf" }, chef: { id: 2, name: "Sam" }, state: "reserved", startOn: "2026-10-17", paidThrough: "2026-10-30", timezone: "America/St_Johns", actions: [], terms: [] }];
    });
    afterEach(() => vi.useRealTimers());

    it("names the kitchen on every row that would otherwise leave it unsaid", () => {
      const html = render();
      const attention = attentionOf(html);
      expect(attention.split('id="attention-attendance"')[1]).toContain("Morgan · Kitchen West");
      expect(attention).toContain('aria-label="ovrTheyCame: today, 1:00–3:00 p.m., Morgan, Kitchen West"');
      expect(attention.split('id="attention-storage"')[1]).toContain("Sam · Kitchen West · stChipMoveInOverdue");
      const tomorrow = html.split('data-testid="overview-tomorrow"')[1].split("</section>")[0];
      // Chef over kitchen, each on its own line.
      expect(tomorrow).toMatch(/East Chef<\/span><span[^>]*>Kitchen East/);
      expect(tomorrow).toMatch(/West Chef<\/span><span[^>]*>Kitchen West/);
      // Every timed calendar event carries its kitchen, so the week can give each kitchen its own lane.
      const calendar = html.split('data-testid="calendar"')[1];
      expect(calendar).toContain("booking-400-0-0@2026-10-22:bdhPill_confirmed[booked]{k10}");
      expect(calendar).toContain("booking-401-0-0@2026-10-22:bdhPill_confirmed[booked]{k11}");
      expect(calendar).toContain("rental-in-45@2026-10-17:ovrMoveIn{k11}");
    });

    it("keeps one-kitchen rows as they were (no kitchen name added)", () => {
      state.kitchens = state.kitchens.slice(1);
      const html = render();
      expect(attentionOf(html).split('id="attention-attendance"')[1]).not.toContain("Kitchen West");
      expect(attentionOf(html).split('id="attention-storage"')[1]).toContain("Sam · stChipMoveInOverdue");
      expect(html.split('data-testid="overview-tomorrow"')[1].split("</section>")[0]).not.toContain("· Kitchen West");
    });

    it("counts the week across every kitchen, or only the one the calendar is filtered to", () => {
      state.withParams = true;
      state.hours = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, startTime: "09:00", endTime: "17:00", isAvailable: true }));
      const html = render();
      const tile = (scope: string, key: string) => scope.slice(scope.indexOf(`data-testid="week-${key}"`)).slice(0, 700);
      const all = html, west = html.split('data-testid="stats-kitchen-11"')[1];
      expect(tile(all, "bookings")).toMatch(/>3<\/dd>/);
      expect(tile(all, "hours")).toContain("ovrHoursValue{&quot;hours&quot;:&quot;6&quot;}");
      // Both kitchens' open hours: 2 × 7 × 8 h = 112 h.
      expect(tile(all, "utilisation")).toContain("ovrOfOpenHours{&quot;hours&quot;:&quot;112&quot;}");
      expect(tile(west, "bookings")).toMatch(/>2<\/dd>/);
      expect(tile(west, "hours")).toContain("ovrHoursValue{&quot;hours&quot;:&quot;4&quot;}");
      expect(tile(west, "utilisation")).toContain("ovrOfOpenHours{&quot;hours&quot;:&quot;56&quot;}");
    });
  });

  it("uses the Revenue page's words and drops the contradicting Pending payments footer", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, bookingDate: plus(1), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "confirmed" }];
    const card = render().split('data-testid="overview-revenue"')[1];
    for (const key of ["ovrPaidOutThisMonth", "r1Upcoming", "r1OnHold", "ovrPaidBookingsCount"]) expect(card).toContain(key);
    for (const key of ["overviewPaidEarnings", "revenueUpcomingPayouts", "overviewPendingPayments"]) expect(card).not.toContain(key);
  });
});
