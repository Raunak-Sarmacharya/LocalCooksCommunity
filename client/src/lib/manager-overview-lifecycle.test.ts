import { describe, expect, it } from "vitest";
import { bookingNextAction, tourNextAction, licenseNextAction, overstayNextAction, storageHasEnded } from "./manager-overview-lifecycle";
const now = Date.parse("2026-09-30T12:00:00Z");
describe("manager lifecycle actions", () => {
  it("does not require attendance recording to finish the scheduled tour", () => {
    const tour = { status: "confirmed", scheduledAt: "2026-09-29T12:00:00Z", durationMinutes: 30 };
    expect(tourNextAction(tour, now)).toBeNull();
    for (const status of ["completed", "no_show", "cancelled", "rejected"]) expect(tourNextAction({ ...tour, status }, now)).toBeNull();
    expect(tourNextAction({ ...tour, scheduledAt: "2026-10-01T12:00:00Z" }, now)).toBeNull();
    expect(tourNextAction({ ...tour, scheduledAt: "2026-10-01T12:00:00Z", requestedRescheduleAt: "2026-10-02T12:00:00Z" }, now)).toBe("overviewTourReschedules");
  });
  it('does not leave expired requests or reschedules on the action list', () => {
    expect(tourNextAction({ status: 'pending', scheduledAt: '2026-09-29T12:00:00Z' }, now)).toBeNull();
    expect(tourNextAction({ status: 'confirmed', scheduledAt: '2026-09-29T12:00:00Z', requestedRescheduleAt: '2026-10-02T12:00:00Z' }, now)).toBeNull();
  });
  it("waits for the operating day's booking end and respects recorded outcomes", () => {
    const booking = { status: "confirmed", bookingDate: "2026-09-29", startTime: "23:00", endTime: "02:00", operatingWindowStartTime: "18:00" };
    expect(bookingNextAction(booking, "UTC", Date.parse("2026-09-30T01:00:00Z"))).toBeNull();
    expect(bookingNextAction(booking, "UTC", now)).toBe("overviewBookingOutcomes");
    expect(bookingNextAction({ ...booking, checkinStatus: "checked_out" }, "UTC", now)).toBeNull();
    expect(bookingNextAction({ ...booking, checkinStatus: "checkout_requested" }, "UTC", now)).toBe("overviewKitchenCheckoutReviews");
    expect(bookingNextAction({ ...booking, attendanceReviewComplete: true }, "UTC", now)).toBeNull();
    expect(bookingNextAction({ ...booking, attendanceReviewComplete: true, checkinStatus: 'checkout_requested' }, "UTC", now)).toBe('overviewKitchenCheckoutReviews');
  });
});

describe("licence manager actions", () => {
 const date=new Date("2026-10-01T12:00:00Z");
 it("excludes submitted documents awaiting review, including expired renewals",()=>{expect(licenseNextAction({kitchenLicenseUrl:"licence.pdf",kitchenLicenseStatus:"pending"},date)).toBeNull();expect(licenseNextAction({kitchenLicenseUrl:"old.pdf",kitchenLicenseStatus:"pending_update",kitchenLicenseExpiry:"2026-01-01"},date)).toBeNull();expect(licenseNextAction({kitchenLicenseUrl:"old.pdf",kitchenLicenseStatus:"approved",kitchenLicenseExpiry:"2026-01-01",kitchenLicensePendingUrl:"renewal.pdf"},date)).toBeNull();});
 it("only requests document changes the manager can make",()=>{expect(licenseNextAction({},date)).toBe("overviewLicenseUpload");expect(licenseNextAction({kitchenLicenseUrl:"licence.pdf",kitchenLicenseStatus:"rejected"},date)).toBe("overviewLicenseReplace");expect(licenseNextAction({kitchenLicenseUrl:"licence.pdf",kitchenLicenseStatus:"approved",kitchenLicenseExpiry:"2026-01-01"},date)).toBe("overviewLicenseRenew");expect(licenseNextAction({kitchenLicenseUrl:"licence.pdf",kitchenLicenseStatus:"approved",kitchenLicenseExpiry:"2026-10-15"},date)).toBe("overviewLicenseRenew");expect(licenseNextAction({kitchenLicenseUrl:"licence.pdf",kitchenLicenseStatus:"approved",kitchenLicenseExpiry:"2099-01-01"},date)).toBeNull();});
});

describe("overstay action ownership",()=>{const date=new Date("2026-10-01T12:00:00Z");it("waits for disputes and processing rather than asking the manager to collect",()=>{for(const status of ["charge_pending","resolved","penalty_waived","escalated","charge_succeeded"])expect(overstayNextAction({status},date)).toBeNull();expect(overstayNextAction({status:"penalty_approved",itemsRemovedAt:"2026-09-30",chefDisputeDeadline:"2026-10-02"},date)).toBeNull();expect(overstayNextAction({status:"pending_review",chefDisputedAt:"2026-09-30"},date)).toBeNull();});it("identifies the concrete next manager action",()=>{expect(overstayNextAction({status:"pending_review"},date)).toBe("overviewOverstayRemoval");expect(overstayNextAction({status:"pending_review",itemsRemovedAt:"2026-09-30"},date)).toBe("overviewOverstayReview");expect(overstayNextAction({status:"penalty_approved",itemsRemovedAt:"2026-09-30"},date)).toBe("overviewOverstayNotice");expect(overstayNextAction({status:"penalty_approved",itemsRemovedAt:"2026-09-30",chefDisputeDeadline:"2026-10-01T00:00:00Z"},date)).toBe("overviewOverstayCollect");});});

it("respects timed storage endings without expiring a date-only booking early",()=>{const date=new Date("2026-10-01T12:00:00Z");expect(storageHasEnded("2026-10-01",date)).toBe(false);expect(storageHasEnded("2026-09-30",date)).toBe(true);expect(storageHasEnded("2026-10-01T10:00:00Z",date)).toBe(true);expect(storageHasEnded("2026-10-01T14:00:00Z",date)).toBe(false);expect(storageHasEnded(undefined,date)).toBe(false);expect(storageHasEnded("invalid",date)).toBe(false);});
