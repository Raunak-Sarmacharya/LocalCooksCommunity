import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render as renderDom } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  kitchens: [] as Array<{ id: number; locationId: number; name: string; isActive: boolean; listingStatus: string }>,
  bookings: [] as Array<Record<string, unknown>>,
  viewings: [] as Array<Record<string, unknown>>,
  applications: [] as Array<Record<string, unknown>>,
  licenseStatus: "approved" as string,
  licenseExpiry: "2099-01-01",
  activity: { paymentsNeedAttention: false, paymentsAction: "overviewPaymentsUpdate", unreadMessages: 0, storageBookings: [] as Array<Record<string, unknown>>, extensions: [] as Array<Record<string, unknown>>, storageCheckouts: [] as Array<Record<string, unknown>>, claims: [] as Array<Record<string, unknown>>, overstays: [] as Array<Record<string, unknown>>, visits: [], isLoading: false, isError: false },
}));

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "manager-1", displayName: "Alex" } }) }));
vi.mock("@/hooks/use-manager-dashboard", () => ({ useManagerDashboard: () => ({ bookings: state.bookings, isLoadingBookings: false, isErrorBookings: false }) }));
vi.mock("@/hooks/use-manager-overview-activity", () => ({ useManagerOverviewActivity: () => state.activity }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "managerViewings" ? state.viewings : queryKey[0] === "/api/manager/kitchen-applications" ? state.applications : { totalRevenue: 0 }, isLoading: false, isError: false }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));
vi.mock("./BookingCalendarWidget", () => ({ default: () => <div>calendar</div> }));

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
  state.licenseStatus = "approved";
  state.licenseExpiry = "2099-01-01";
  state.activity.unreadMessages = 0;
  state.activity.paymentsNeedAttention = false;
  state.activity.storageBookings = [];
  state.activity.isError = false;
  state.activity.extensions = [];
  state.activity.storageCheckouts = [];
  state.activity.claims = [];
  state.activity.overstays = [];
});

describe("manager overview states", () => {
  it('links missing departure assistance for a terminal tour and clears it after departure', () => {
    const tour = { id: 77, locationId: 1, status: 'completed', scheduledAt: '2025-01-01T12:00:00Z', durationMinutes: 30,
      checkedInAt: '2025-01-01T12:00:00Z', attendanceHistory: [{ action: 'check_in', actorId: 8, source: 'visitor',
        actualAt: '2025-01-01T12:00:00Z', recordedAt: '2025-01-01T12:00:00Z', scheduledAt: '2025-01-01T12:00:00.000Z' }] };
    state.viewings = [{ viewing: tour }];
    expect(render()).toContain('overviewTourDepartureAssistance');
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onNavigate = vi.fn();
    const mounted = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={onNavigate} />);
    fireEvent.click(mounted.getByRole('button', { name: /guestChef/ }));
    expect(onNavigate).toHaveBeenCalledWith('viewings');
    expect(new URLSearchParams(window.location.search).get('viewing')).toBe('77');
    mounted.unmount(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/');
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
    expect(html).not.toContain('overviewTourOutcomes');
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
    expect(render()).toContain("overviewTourOutcomes");
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const onNavigate = vi.fn();
    const screen = renderDom(<KitchenDashboardOverview selectedLocation={location()} locations={[location()]} kitchens={state.kitchens} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Jamie/ }));
    expect(onNavigate).toHaveBeenCalledWith("viewings");
    expect(new URL(window.location.href).searchParams.get("viewing")).toBe("77");
    screen.unmount();
    vi.unstubAllGlobals();
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "no_show", scheduledAt: "2025-01-01T12:00:00Z", durationMinutes: 30 } }];
    expect(render()).not.toContain("overviewTourOutcomes");
  });
  it("puts confirmed future tours in the schedule without creating a manager action", () => {
    state.viewings = [{ viewing: { id: 77, locationId: 1, status: "confirmed", scheduledAt: "2099-01-01T12:00:00Z", durationMinutes: 30 }, chefName: "Future Chef" }];
    const html = render();
    expect(html).toContain("overviewUpcomingBookings");
    expect(html).toContain("Future Chef");
    expect(html).not.toContain("overviewTourOutcomes");
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

it("explains booking history with status, chef, kitchen and schedule, without a history View all",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,chefName:"Morgan",kitchenName:"Kitchen East",bookingDate:"2025-01-01",createdAt:"2024-12-01",startTime:"09:00",endTime:"12:00",status:"cancelled"}];const html=render();const history=html.slice(html.indexOf("overviewHistory"));expect(history).toContain("activityBookingRequested");expect(history).not.toContain("activityBookingCancelled");expect(history).toContain("Morgan · Kitchen East · Jan 1, 2025 · 09:00 – 12:00");expect(history).not.toContain("viewAll");expect(history).toContain("/manager/booking/90");});

it("does not count a submitted licence awaiting review as manager work",()=>{state.licenseStatus="pending";const html=render();expect(html).not.toContain("overviewLicenseAttention");expect(html).toContain("overviewAllCaughtUp");});

it("sorts the mixed schedule by date and excludes completed storage",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,chefName:"Late booking",bookingDate:"2099-01-03",createdAt:"2025-01-01",startTime:"09:00",endTime:"12:00",status:"confirmed"}];state.viewings=[{viewing:{id:91,locationId:1,status:"confirmed",scheduledAt:"2099-01-02T12:00:00Z"},chefName:"Middle tour"}];state.activity.storageBookings=[{id:92,status:"confirmed",storageName:"Early storage",startDate:"2099-01-01",endDate:"2099-01-05",checkoutStatus:"active"},{id:93,status:"confirmed",storageName:"Completed storage",startDate:"2099-01-01",endDate:"2099-01-05",checkoutStatus:"completed"}];const html=render();const schedule=html.slice(html.indexOf('aria-label="overviewUpcomingBookings"'),html.indexOf("overviewHistory"));expect(schedule.indexOf("Early storage")).toBeLessThan(schedule.indexOf("Middle tour"));expect(schedule.indexOf("Middle tour")).toBeLessThan(schedule.indexOf("Late booking"));expect(schedule).not.toContain("Completed storage");});
it("keeps dated storage, application and claim history visible during a partial failure",()=>{state.applications=[{id:20,locationId:1,fullName:"Applicant",status:"approved",createdAt:"2025-01-01"}];state.activity.storageBookings=[{id:21,status:"cancelled",storageName:"Dry storage",createdAt:"2025-01-02"}];state.activity.claims=[{id:22,status:"under_review",claimTitle:"Worktop damage",createdAt:"2025-01-03"}];state.activity.isError=true;const html=render();const history=html.slice(html.indexOf("overviewHistory"));expect(history).toContain("overviewActivityPartialError");expect(history).toContain("overviewApplicationActivity");expect(history).toContain("activityStorageRequested");expect(history).not.toContain("overviewStorageActivity");expect(history).toContain("overviewClaimActivity");expect(html).not.toContain("overviewClaimsToAction");});

it("never substitutes a chef email for a display name in overview rows",()=>{state.activity.storageBookings=[{id:30,status:"pending",chefName:"chef@example.com",chefEmail:"chef@example.com",storageName:"Dry shelf",createdAt:"2025-01-01"}];state.activity.claims=[{id:31,status:"draft",chefEmail:"chef@example.com",claimTitle:"Worktop damage",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("chef@example.com");expect(html).toContain("guestChef");expect(html).toContain("Dry shelf");});

it("uses the parent booking chef identity in recent storage activity",()=>{state.bookings=[{id:5,chefId:2,kitchenId:10,chefName:"Morgan Lee",locationId:1,status:"completed",bookingDate:"2025-01-01",createdAt:"2025-01-01",startTime:"09:00",endTime:"12:00"}];state.activity.storageBookings=[{id:10,chefId:2,chefName:"Guest chef",chefEmail:"email@example.com",storageName:"Dry shelf",status:"cancelled",createdAt:"2025-01-02"}];const html=render();expect(html).not.toContain("email@example.com");expect(html).not.toContain("Guest chef");expect(html.match(/Morgan Lee/g)?.length).toBeGreaterThanOrEqual(2);expect(html.match(/data-radix-scroll-area-viewport=""/g)).toHaveLength(4);expect(html).not.toContain("scrollbar-width:thin");});

it("keeps payout branding distinct from normal workflow icons",()=>{state.activity.paymentsNeedAttention=true;const html=render();expect(html).toContain("text-stripe");expect(html).toContain("overviewPaymentsUpdate");expect(html.match(/overviewPaymentsAttention/g)).toHaveLength(1);});

it("shows only payment recovery work for a linked item with an unfinished parent decision",()=>{state.bookings=[{id:90,kitchenId:10,locationId:1,status:"pending",paymentStatus:"authorized",paymentDecision:{state:"pending"},bookingDate:"2099-01-01",startTime:"09:00",endTime:"10:00"}];state.activity.storageBookings=[{id:91,kitchenBookingId:90,status:"pending",storageName:"Held shelf",createdAt:"2025-01-01"}];const html=render();expect(html).toContain("overviewPaymentRecovery");expect(html).not.toContain("overviewStorageRequests");expect(html).not.toContain("overviewBookingRequests");});
