import { calendarDateForBookingTime } from "@shared/operating-hours";
import { createBookingDateTime, DEFAULT_TIMEZONE } from "@shared/timezone-utils";
import { kitchenLicenseState, isReplacementUnderReview, toCalendarDate, type KitchenLicenseFields } from "@shared/kitchen-license";
import { overstayCollectionError } from "@shared/overstay-collection";

export function storageHasEnded(endDate?: string, now = new Date()) {
  if (!endDate || !Number.isFinite(Date.parse(endDate))) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate < toCalendarDate(now) : Date.parse(endDate) <= now.getTime();
}

export function overstayNextAction(record: { status?: string; itemsRemovedAt?: string | null; chefDisputeDeadline?: string | null; chefDisputedAt?: string | null; disputeReviewedAt?: string | null }, now = new Date()) {
  if (["resolved", "charge_succeeded", "penalty_waived", "escalated", "charge_pending"].includes(record.status ?? "")) return null;
  if (record.chefDisputedAt && !record.disputeReviewedAt) return null;
  if (record.status === "pending_review") return record.itemsRemovedAt ? "overviewOverstayReview" : "overviewOverstayRemoval";
  if (!["penalty_approved", "charge_failed"].includes(record.status ?? "")) return null;
  if (!record.itemsRemovedAt) return "overviewOverstayRemoval";
  if (!record.chefDisputeDeadline) return "overviewOverstayNotice";
  return overstayCollectionError({ itemsRemovedAt: record.itemsRemovedAt, chefDisputeDeadline: record.chefDisputeDeadline, chefDisputedAt: record.chefDisputedAt ?? null, disputeReviewedAt: record.disputeReviewedAt ?? null }, now) ? null : "overviewOverstayCollect";
}

export function licenseNextAction(license: KitchenLicenseFields, now = new Date()) {
  if (isReplacementUnderReview(license) || license.kitchenLicenseStatus === "pending_update") return null;
  const state = kitchenLicenseState(license, now);
  if (state === "not_uploaded") return "overviewLicenseUpload";
  if (state === "rejected") return "overviewLicenseReplace";
  if (state === "expired" || state === "expiring_soon") return "overviewLicenseRenew";
  return null;
}

export function tourNextAction(tour: { status: string; scheduledAt: string; durationMinutes?: number; requestedRescheduleAt?: string | null }, now = Date.now()) {
  const start = Date.parse(tour.scheduledAt);
  if (!Number.isFinite(start)) return null;
  if (tour.status === "pending") return start > now ? "overviewPendingTours" : null;
  if (tour.status !== "confirmed") return null;
  if (tour.requestedRescheduleAt && start > now) return "overviewTourReschedules";
  return null;
}

export function bookingNextAction(booking: { status: string; paymentDecision?: { state?: string } | null; checkinStatus?: string | null; attendanceReviewComplete?: boolean; bookingDate: string; startTime: string; endTime: string; operatingWindowStartTime?: string | null }, timezone = DEFAULT_TIMEZONE, now = Date.now()) {
  if (booking.paymentDecision?.state === 'pending') return 'overviewPaymentRecovery';
  if (booking.status === "pending") return "overviewPendingBookings";
  if (booking.status === "cancellation_requested") return "overviewCancellationRequests";
  if (booking.status !== "confirmed" || ["checked_out", "no_show", "checkout_claim_filed"].includes(booking.checkinStatus ?? "")) return null;
  if (booking.checkinStatus === "checkout_requested") return "overviewKitchenCheckoutReviews";
  if (booking.attendanceReviewComplete) return null;
  const endDate = calendarDateForBookingTime(booking.bookingDate.slice(0, 10), booking.endTime, booking.operatingWindowStartTime, booking.startTime);
  const end = createBookingDateTime(endDate, booking.endTime, DEFAULT_TIMEZONE).getTime();
  return Number.isFinite(end) && end <= now ? "overviewBookingOutcomes" : null;
}
