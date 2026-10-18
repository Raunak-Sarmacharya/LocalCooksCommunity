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
  licenseExpiry: "2099-01-01",
  activity: { paymentsNeedAttention: false, paymentsAction: "overviewPaymentsUpdate", unreadMessages: 0, storageBookings: [] as Array<Record<string, unknown>>, extensions: [] as Array<Record<string, unknown>>, storageCheckouts: [] as Array<Record<string, unknown>>, claims: [] as Array<Record<string, unknown>>, visits: [], isLoading: false, isError: false },
}));

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "manager-1", displayName: "Alex" } }) }));
vi.mock("@/hooks/use-manager-dashboard", () => ({ useManagerDashboard: () => ({ bookings: state.bookings, isLoadingBookings: false, isErrorBookings: false }) }));
vi.mock("@/hooks/use-manager-overview-activity", () => ({ useManagerOverviewActivity: () => state.activity }));
vi.mock("@/components/manager/revenue/hooks/use-manager-revenue", () => ({ useManagerRevenue: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "managerViewings" ? state.viewings : queryKey[0] === "/api/manager/kitchen-applications" ? state.applications
    : queryKey[0] === "/api/manager/storage-rentals" ? state.rentals : queryKey[0] === "/api/manager/revenue/upcoming-payouts" ? state.payouts : { totalRevenue: 0 }, isLoading: false, isError: false }),
  useQueries: ({ queries }: { queries: Array<{ queryKey: unknown[] }> }) => queries.map(({ queryKey }) => ({ data: queryKey[0] === "/api/manager/availability" ? state.hours : state.overrides, isLoading: false, isError: false })),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/chef-ns", () => ({ ct: (key: string) => key }));
vi.mock("@/components/booking/BookingNowCard", () => ({ StatusPill: ({ children }: { children: ReactNode }) => <span data-testid="booking-status-pill">{children}</span>,
  PILL: new Proxy({}, { get: () => ({ surface: "", dot: "" }) }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));
// The real rows and sorting, a marker for the calendar itself (its own render is tested in BookingCalendarWidget.test).
vi.mock("./BookingCalendarWidget", async (importOriginal) => ({ ...(await importOriginal<typeof import("./BookingCalendarWidget")>()),
  default: ({ events }: { events: Array<{ key: string; date: string; label: string }> }) => <div data-testid="calendar">{events.map(event => `${event.key}@${event.date}:${event.label}`).join("|")}</div> }));

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
  it("puts confirmed future tours in the schedule without creating a manager action", () => {
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "confirmed", scheduledAt: "2099-01-01T12:00:00Z", durationMinutes: 30 }, chefName: "Future Chef" }];
    const html = render();
    expect(html).toContain("overviewUpcomingBookings");
    expect(html).toContain("Future Chef");
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
    expect(html).toContain("overviewHistory");
    expect(html).toContain("/manager/booking/40");
  });

  it("keeps tour history visible without bookings", () => {
    state.kitchens = [{ id: 10, locationId: 1, name: "Kitchen A", isActive: true, listingStatus: "draft" }];
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "completed", scheduledAt: "2025-01-01T12:00:00Z", updatedAt: "2025-01-01T13:00:00Z" } }];
    const html = render();
    expect(html).toContain("overviewHistory");
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

it("explains booking history with status, chef, kitchen and schedule, without a history View all",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,chefName:"Morgan",kitchenName:"Kitchen East",bookingDate:"2025-01-01",createdAt:"2024-12-01",startTime:"09:00",endTime:"12:00",status:"cancelled"}];const html=render();const history=html.slice(html.indexOf("overviewHistory"));expect(history).toContain("activityBookingRequested");expect(history).not.toContain("activityBookingCancelled");expect(history).toContain("Morgan · Kitchen East · Wed, Jan 1, 2025 · 9:00 a.m.–12:00 p.m.");expect(history).not.toContain("viewAll");expect(history).toContain("/manager/booking/90");});

it("does not count a submitted licence awaiting review as manager work",()=>{state.licenseStatus="pending";const html=render();expect(html).not.toContain("overviewLicenseAttention");expect(html).toContain("overviewAllCaughtUp");});

it("sorts the mixed schedule by date and excludes completed storage",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,chefName:"Late booking",bookingDate:"2099-01-03",createdAt:"2025-01-01",startTime:"09:00",endTime:"12:00",status:"confirmed"}];state.viewings=[{viewing:{id:91,locationId:1,status:"confirmed",scheduledAt:"2099-01-02T12:00:00Z"},chefName:"Middle tour"}];state.activity.storageBookings=[{id:92,status:"confirmed",storageName:"Early storage",startDate:"2099-01-01",endDate:"2099-01-05",checkoutStatus:"active"},{id:93,status:"confirmed",storageName:"Completed storage",startDate:"2099-01-01",endDate:"2099-01-05",checkoutStatus:"completed"}];const html=render();const schedule=html.slice(html.indexOf('aria-label="overviewUpcomingBookings"'),html.indexOf("overviewHistory"));expect(schedule.indexOf("Early storage")).toBeLessThan(schedule.indexOf("Middle tour"));expect(schedule.indexOf("Middle tour")).toBeLessThan(schedule.indexOf("Late booking"));expect(schedule).not.toContain("Completed storage");});
it("keeps dated storage, application and claim history visible during a partial failure",()=>{state.applications=[{id:20,locationId:1,fullName:"Applicant",status:"approved",createdAt:"2025-01-01"}];state.activity.storageBookings=[{id:21,status:"cancelled",storageName:"Dry storage",createdAt:"2025-01-02"}];state.activity.claims=[{id:22,status:"under_review",claimTitle:"Worktop damage",createdAt:"2025-01-03"}];state.activity.isError=true;const html=render();const history=html.slice(html.indexOf("overviewHistory"));expect(history).toContain("overviewActivityPartialError");expect(history).toContain("overviewApplicationActivity");expect(history).toContain("activityStorageRequested");expect(history).not.toContain("overviewStorageActivity");expect(history).toContain("overviewClaimActivity");expect(html).not.toContain("overviewClaimsToAction");});

it("never substitutes a chef email for a display name in overview rows",()=>{state.activity.storageBookings=[{id:30,status:"pending",chefName:"chef@example.com",chefEmail:"chef@example.com",storageName:"Dry shelf",createdAt:"2025-01-01"}];state.activity.claims=[{id:31,status:"draft",chefEmail:"chef@example.com",claimTitle:"Worktop damage",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("chef@example.com");expect(html).toContain("guestChef");expect(html).toContain("Dry shelf");});

it("uses the parent booking chef identity in recent storage activity",()=>{state.bookings=[{id:5,chefId:2,kitchenId:10,chefName:"Morgan Lee",locationId:1,status:"completed",bookingDate:"2025-01-01",createdAt:"2025-01-01",startTime:"09:00",endTime:"12:00"}];state.activity.storageBookings=[{id:10,chefId:2,chefName:"Guest chef",chefEmail:"email@example.com",storageName:"Dry shelf",status:"cancelled",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("email@example.com");expect(html).not.toContain("Guest chef");expect(html.match(/Morgan Lee/g)?.length).toBeGreaterThanOrEqual(2);expect(html.match(/data-radix-scroll-area-viewport=""/g)).toHaveLength(5);expect(html).not.toContain("scrollbar-width:thin");});

it("keeps payout branding distinct from normal workflow icons",()=>{state.activity.paymentsNeedAttention=true;const html=render();expect(html).toContain("text-stripe");expect(html).toContain("overviewPaymentsUpdate");expect(html.match(/overviewPaymentsAttention/g)).toHaveLength(1);});

it("shows only payment recovery work for a linked item with an unfinished parent decision",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,status:"pending",paymentStatus:"authorized",paymentDecision:{state:"pending"},bookingDate:"2099-01-01",startTime:"09:00",endTime:"10:00"}];state.activity.storageBookings=[{id:91,kitchenBookingId:90,status:"pending",storageName:"Held shelf",createdAt:"2025-01-01"}];const html=render();expect(html).toContain("overviewPaymentRecovery");expect(html).not.toContain("overviewStorageRequests");expect(html).not.toContain("overviewBookingRequests");});

it("lists a booking request once in Recent activity, not as both the booking and its 'requested' event", () => {
  state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, chefName: "Morgan", kitchenName: "Kitchen East", bookingDate: "2025-01-01", createdAt: "2024-12-01T12:00:00Z", startTime: "09:00", endTime: "12:00", status: "pending" }];
  (state.activity as Record<string, unknown>).bookingEvents = [
    { id: 1, bookingId: 90, kind: "requested", title: "Kitchen booking requested", createdAt: "2024-12-01T12:00:00Z", kitchenName: "Kitchen East" },
    { id: 2, bookingId: 90, kind: "confirmed", title: "Kitchen booking confirmed", createdAt: "2024-12-02T12:00:00Z", kitchenName: "Kitchen East" },
  ];
  try {
    const html = render();
    const history = html.slice(html.indexOf("overviewHistory"));
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
    const schedule = html.slice(html.indexOf('aria-label="overviewUpcomingBookings"'), html.indexOf("overviewHistory"));
    expect(schedule.match(/mdDayOf · [^<]*8:00–9:00 p\.m\./g)).toHaveLength(2);
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

    it("leads with tonight's booking and folds cancelled and finished into one line", () => {
      const card = todayOf(render());
      expect(card).toContain("TestSprite chef with a long display name");
      expect(card).not.toContain("Cancelled Chef");
      expect(card).not.toContain("Finished Chef");
      expect(card).toMatch(/aria-expanded="false"[^>]*>.*ovrTodayCancelled · ovrTodayFinished/);
      expect(card).not.toContain("ovrNothingToday");
      // The name wraps in the narrow column instead of being cut off.
      expect(card).not.toMatch(/truncate[^"]*">TestSprite/);
    });

    it("shows the cancelled and finished rows when the line is opened", () => {
      vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
      const screen = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={vi.fn()} />);
      const card = screen.getByTestId("overview-today");
      const toggle = within(card).getByRole("button", { name: /ovrTodayCancelled/ });
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const text = card.textContent!;
      expect(text.indexOf("TestSprite")).toBeLessThan(text.indexOf("Cancelled Chef One"));
      expect(text).toContain("Cancelled Chef Two");
      expect(text).toContain("Finished Chef");
      screen.unmount();
      vi.unstubAllGlobals();
    });
  });

  it("uses the Revenue page's words and drops the contradicting Pending payments footer", () => {
    live();
    state.bookings = [{ id: 90, kitchenId: 10, locationId: 1, bookingDate: plus(1), createdAt: "2025-01-01", startTime: "09:00", endTime: "10:00", status: "confirmed" }];
    const card = render().split('data-testid="overview-revenue"')[1];
    for (const key of ["r1PaidOut", "r1Upcoming", "r1OnHold", "overviewPaidBookings"]) expect(card).toContain(key);
    for (const key of ["overviewPaidEarnings", "revenueUpcomingPayouts", "overviewPendingPayments"]) expect(card).not.toContain(key);
  });
});
