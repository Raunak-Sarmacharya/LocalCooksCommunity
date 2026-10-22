import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  chefDocumentRenewals, chefKitchenApplications, chefLocationAccess, commitmentProblems, damageClaims, kitchenBookingAttendanceEvents, kitchenBookings,
  kitchenBookingVisits, kitchens, kitchenViewings, paymentTransactions, storageBookings, storageListings, tourFeedbackResponses, users,
} from '@shared/schema';
import { customerRelationshipView, moreUrgentRelationship, type CustomerNextAction, type CustomerStatus } from '@shared/customer-next-action';
import { accessDocumentDaysLeft, accessDocumentStage, requiredAccessDocuments } from '@shared/location-booking-eligibility';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { kitchenPayout } from '@shared/kitchen-payout';
import { ATTENDANCE_CATEGORY } from '@shared/commitment-problems';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { DomainError } from '../shared/errors/domain-error';
import { locationService } from '../domains/locations/location.service';
import { getLifecycleSettings } from './lifecycle-settings';
import {
  bookingBounds, bookingVisitWindows, buildRelationships, loadCustomerReadInput, managerLocations, managerVisibleTour,
  type CustomerReadInput, type RawBooking,
} from './manager-customers';

export type BookingOutcomeCode =
  | 'completed_cleared' | 'completed' | 'claim_filed' | 'attendance_reported' | 'cancelled_by_customer' | 'cancelled_by_you'
  | 'cancelled' | 'visit_ended' | 'request_unanswered' | 'cancellation_requested';

/** An explicit, actor-specific outcome. A missing tap is never turned into a "no-show". */
export function bookingOutcome(booking: { status: string; checkinStatus: string | null; checkoutApprovedBy: number | null; cancellationCause: string | null }, managerId: number): BookingOutcomeCode {
  if (booking.checkinStatus === 'checkout_claim_filed') return 'claim_filed';
  if (booking.checkinStatus === 'no_show') return 'attendance_reported';
  switch (booking.status) {
    case 'completed': return booking.checkoutApprovedBy === managerId ? 'completed_cleared' : 'completed';
    case 'cancelled': return booking.cancellationCause === 'chef' ? 'cancelled_by_customer' : booking.cancellationCause === 'kitchen' ? 'cancelled_by_you' : 'cancelled';
    case 'cancellation_requested': return 'cancellation_requested';
    case 'pending': return 'request_unanswered';
    default: return 'visit_ended';
  }
}

export type ClaimActor = 'you' | 'customer' | 'local_cooks' | 'nobody';
export function claimNextActor(status: string): ClaimActor {
  switch (status) {
    case 'draft': case 'awaiting_kitchen': return 'you';
    case 'submitted': case 'approved': case 'partially_approved': return 'customer';
    case 'in_review': case 'chef_accepted': case 'chef_disputed': case 'under_review': case 'charge_failed': case 'escalated': return 'local_cooks';
    default: return 'nobody';
  }
}
const OWED_CLAIM_STATUSES = ['chef_accepted', 'approved', 'partially_approved', 'charge_pending', 'charge_failed', 'escalated'];
// shortcut: the figures (visits, hours, late cancellations) count the newest 500 bookings; page the history if a customer ever passes that.
const BOOKING_CAP = 500;

export type Rental = { name: string; days: number };
export type PageBooking = {
  bookingId: number; reference: string | null; kitchenName: string; startsAt: string | null; endsAt: string | null; status: string;
  responseDeadlineAt: string | null; rentals: Rental[];
};
/** `noShow`: a reported no-show counts unless the customer said "I was there" and Local Cooks has not resolved it yet. */
export type PastBooking = PageBooking & { outcome: BookingOutcomeCode; refundedCents: number; late: boolean; noShow: 'counted' | 'under_review' | null };
export type OpenItem = {
  kind: 'storage_move_in' | 'booking_request' | 'cancellation_request' | 'no_show_review' | 'problem' | 'claims' | 'next';
  owner: 'you' | 'customer' | 'local_cooks';
  bookingId?: number; storageId?: number; name?: string; startsAt?: string | null; endsAt?: string | null; startOn?: string | null; endOn?: string | null;
  deadlineAt?: string | null; count?: number; amountCents?: number; references?: string[];
};
export type ActivityItem = {
  at: string; type: 'booked' | 'requested' | 'cancelled' | 'rental_day_cancelled' | 'visit_ended' | 'no_show_reported' | 'no_show_disputed' | 'claim_filed'
    | 'storage_rented' | 'applied' | 'local_cooks_approved' | 'documents_sent' | 'access_approved';
  category: 'booking' | 'money' | 'access'; actor: 'you' | 'customer' | 'local_cooks';
  bookingId?: number; reference?: string | null; startsAt?: string | null; endsAt?: string | null; amountCents?: number; refundedCents?: number;
  rentals?: Rental[]; name?: string; date?: string; status?: string; startOn?: string | null; endOn?: string | null;
};

type RentalItem = { equipmentListingId?: number; storageListingId?: number; name?: string; totalPrice?: number | string; status?: string; date?: string; cancelledAt?: string; cancelledBy?: string };
/** Paid add-ons the customer kept: a listing counts once across its days; free included equipment and cancelled days do not. */
export function bookingRentals(...lists: unknown[]): Rental[] {
  const byListing = new Map<string, Rental>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list as RentalItem[]) {
      if (!item || Number(item.totalPrice ?? 0) <= 0 || item.status === 'cancelled' || item.status === 'rejected') continue;
      const key = item.equipmentListingId != null ? `e${item.equipmentListingId}` : item.storageListingId != null ? `s${item.storageListingId}` : null;
      if (!key) continue;
      const seen = byListing.get(key);
      if (seen) seen.days += 1; else byListing.set(key, { name: item.name ?? '', days: 1 });
    }
  }
  return Array.from(byListing.values());
}

/** Late: the customer cancelled after the booking's own frozen cancellation window had started. */
export function lateCancellation(row: { status: string; cancellationCause: string | null; cancellationEffectiveAt: Date | null; cancellationPolicyHours: number | null }, startsAt: Date | null) {
  if (row.status !== 'cancelled' || row.cancellationCause !== 'chef' || !row.cancellationEffectiveAt || row.cancellationPolicyHours == null || !startsAt) return false;
  return row.cancellationEffectiveAt.getTime() > startsAt.getTime() - row.cancellationPolicyHours * 3_600_000;
}

const ATTENDED: BookingOutcomeCode[] = ['completed_cleared', 'completed', 'claim_filed', 'visit_ended'];
const PAID = ['succeeded', 'partially_refunded', 'refunded'];
const isoOf = (value: Date | null | undefined) => value ? value.toISOString() : null;

/** "few-times-month" and "2-4" from the application form; the client words them. */
function plansToBook(raw: string | null) {
  try {
    const parsed = raw ? JSON.parse(raw) as { businessType?: unknown; usageFrequency?: unknown; sessionDuration?: unknown } : null;
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
    return { businessType: text(parsed?.businessType), usageFrequency: text(parsed?.usageFrequency), sessionDuration: text(parsed?.sessionDuration) };
  } catch { return { businessType: null, usageFrequency: null, sessionDuration: null }; }
}

export async function getCustomerPage(managerId: number, chefId: number, requestedLocationId: number | undefined, options: { allPast?: boolean } = {}, now = new Date()) {
  // A location that is not this manager's is a 404 before anything about the person is read.
  if (requestedLocationId) await managerLocations(managerId, requestedLocationId);
  const [input, allLocations, lifecycle] = await Promise.all([
    loadCustomerReadInput(managerId, undefined, now, chefId), managerLocations(managerId), getLifecycleSettings(),
  ]);
  const relationships = buildRelationships(input, now);
  const views = relationships.map(relationship => ({ relationship, ...customerRelationshipView(relationship.facts, relationship.location.timezone || DEFAULT_TIMEZONE, now) }));
  const chosen = requestedLocationId ? views.find(item => item.relationship.location.id === requestedLocationId)
    : views.length ? views.reduce((best, item) => moreUrgentRelationship(best, item)) : undefined;
  // No application, access, tour or booking at one of this manager's locations: the person (and their email and phone) stays unknown.
  if (!chosen) throw new DomainError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  const selected = chosen.relationship, view = chosen;
  const locationId = selected.location.id;
  const scope = selected.location;
  const timezone = scope.timezone || DEFAULT_TIMEZONE;

  const [appRows, userRows, accessRows, bookingRows, tourRows, claimRows, moneyRows, requirements, renewals] = await Promise.all([
    db.select({ id: chefKitchenApplications.id, fullName: chefKitchenApplications.fullName, shopName: chefKitchenApplications.shopName,
      email: chefKitchenApplications.email, phone: chefKitchenApplications.phone, status: chefKitchenApplications.status, currentTier: chefKitchenApplications.current_tier,
      businessDescription: chefKitchenApplications.businessDescription,
      createdAt: chefKitchenApplications.createdAt, tier1CompletedAt: chefKitchenApplications.tier1_completed_at, tier2CompletedAt: chefKitchenApplications.tier2_completed_at,
      reviewedAt: chefKitchenApplications.reviewedAt,
      foodSafetyLicenseUrl: chefKitchenApplications.foodSafetyLicenseUrl, foodSafetyLicenseStatus: chefKitchenApplications.foodSafetyLicenseStatus, foodSafetyLicenseExpiry: chefKitchenApplications.foodSafetyLicenseExpiry,
      foodEstablishmentCertUrl: chefKitchenApplications.foodEstablishmentCertUrl, foodEstablishmentCertStatus: chefKitchenApplications.foodEstablishmentCertStatus, foodEstablishmentCertExpiry: chefKitchenApplications.foodEstablishmentCertExpiry })
      .from(chefKitchenApplications).where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1),
    db.select({ username: users.username, phoneNumber: users.phoneNumber, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, chefId)).limit(1),
    db.select({ grantedAt: chefLocationAccess.grantedAt }).from(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, chefId), eq(chefLocationAccess.locationId, locationId))),
    db.select({ id: kitchenBookings.id, referenceCode: kitchenBookings.referenceCode, kitchenName: kitchens.name, status: kitchenBookings.status,
      bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
      selectedSlots: kitchenBookings.selectedSlots, visitDuties: kitchenBookings.visitDuties, checkinStatus: kitchenBookings.checkinStatus, checkoutApprovedBy: kitchenBookings.checkoutApprovedBy,
      cancellationCause: kitchenBookings.cancellationCause, createdAt: kitchenBookings.createdAt, cancellationPolicySnapshot: kitchenBookings.cancellationPolicySnapshot,
      cancellationPolicyHours: kitchenBookings.cancellationPolicyHours, cancellationEffectiveAt: kitchenBookings.cancellationEffectiveAt,
      equipmentItems: kitchenBookings.equipmentItems, storageItems: kitchenBookings.storageItems })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId)))
      .orderBy(desc(kitchenBookings.bookingDate), desc(kitchenBookings.id)).limit(BOOKING_CAP),
    db.select({ id: kitchenViewings.id, status: kitchenViewings.status, scheduledAt: kitchenViewings.scheduledAt, durationMinutes: kitchenViewings.durationMinutes,
      kitchenName: kitchens.name, adminReviewDecision: kitchenViewings.adminReviewDecision, cancelledBy: kitchenViewings.cancelledBy, adminReviewedAt: kitchenViewings.adminReviewedAt,
      confirmationVerified: kitchenViewings.confirmationVerified, confirmedAt: kitchenViewings.confirmedAt, requestExpiredAt: kitchenViewings.requestExpiredAt })
      .from(kitchenViewings).leftJoin(kitchens, eq(kitchens.id, kitchenViewings.targetedKitchenId))
      .where(and(eq(kitchenViewings.chefId, chefId), eq(kitchenViewings.locationId, locationId))).orderBy(desc(kitchenViewings.scheduledAt)).limit(20),
    db.select({ id: damageClaims.id, referenceCode: damageClaims.referenceCode, status: damageClaims.status, title: damageClaims.claimTitle,
      claimedCents: damageClaims.claimedAmountCents, approvedCents: damageClaims.approvedAmountCents, finalCents: damageClaims.finalAmountCents,
      chefOwes: damageClaims.chefOwes, deadline: damageClaims.chefResponseDeadline, bookingId: damageClaims.kitchenBookingId, createdAt: damageClaims.createdAt })
      .from(damageClaims).where(and(eq(damageClaims.chefId, chefId), eq(damageClaims.locationId, locationId))).orderBy(desc(damageClaims.createdAt)).limit(50),
    // One aggregate over the whole history. Explicit amount columns only: never card, Stripe or payment-method identifiers.
    db.select({
      paid: sql<string>`coalesce(sum(${paymentTransactions.amount}) FILTER (WHERE ${paymentTransactions.status} IN ('succeeded','partially_refunded','refunded')), 0)`,
      refunded: sql<string>`coalesce(sum(${paymentTransactions.refundAmount}) FILTER (WHERE ${paymentTransactions.status} IN ('partially_refunded','refunded')), 0)`,
      held: sql<string>`coalesce(sum(${paymentTransactions.amount}) FILTER (WHERE ${paymentTransactions.status} = 'authorized'), 0)`,
      payments: sql<number>`(count(*) FILTER (WHERE ${paymentTransactions.status} IN ('succeeded','partially_refunded','refunded')))::int`,
      holds: sql<number>`(count(*) FILTER (WHERE ${paymentTransactions.status} = 'authorized'))::int`,
    }).from(paymentTransactions)
      .innerJoin(kitchenBookings, and(eq(paymentTransactions.bookingId, kitchenBookings.id), eq(paymentTransactions.bookingType, 'kitchen')))
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId))),
    locationService.getLocationRequirementsWithDefaults(locationId),
    selected.application ? db.select({ id: chefDocumentRenewals.id, key: chefDocumentRenewals.documentKey, expiry: chefDocumentRenewals.expiry, submittedAt: chefDocumentRenewals.submittedAt })
      .from(chefDocumentRenewals).where(and(eq(chefDocumentRenewals.applicationId, selected.application.id), eq(chefDocumentRenewals.status, 'pending'))) : Promise.resolve([]),
  ]);

  // Everything below is keyed by this customer's bookings at this location, so nothing from another kitchen can join in.
  const bookingIds = bookingRows.map(row => row.id);
  const forBookings = <T>(read: () => Promise<T[]>) => bookingIds.length ? read() : Promise.resolve([] as T[]);
  const [paymentRows, noShowVisitRows, attendanceRows, problemRows, storageRows] = await Promise.all([
    // Payout math needs the amounts and release fields; only the computed payout leaves this function, never provider identifiers.
    forBookings(() => db.select({ id: paymentTransactions.id, bookingId: paymentTransactions.bookingId, status: paymentTransactions.status,
      amount: paymentTransactions.amount, baseAmount: paymentTransactions.baseAmount, serviceFee: paymentTransactions.serviceFee,
      stripeProcessingFee: paymentTransactions.stripeProcessingFee, managerRevenue: paymentTransactions.managerRevenue, refundAmount: paymentTransactions.refundAmount,
      payoutTiming: paymentTransactions.payoutTiming, payoutEligibleAt: paymentTransactions.payoutEligibleAt, payoutReleasedAt: paymentTransactions.payoutReleasedAt,
      payoutHoldReason: paymentTransactions.payoutHoldReason, transferId: paymentTransactions.transferId, metadata: paymentTransactions.metadata,
      paidAt: paymentTransactions.paidAt, createdAt: paymentTransactions.createdAt })
      .from(paymentTransactions).where(and(eq(paymentTransactions.bookingType, 'kitchen'), inArray(paymentTransactions.bookingId, bookingIds)))
      .orderBy(desc(paymentTransactions.createdAt))),
    forBookings(() => db.select({ bookingId: kitchenBookingVisits.bookingId }).from(kitchenBookingVisits)
      .where(and(inArray(kitchenBookingVisits.bookingId, bookingIds), eq(kitchenBookingVisits.checkinStatus, 'no_show')))),
    forBookings(() => db.select({ bookingId: kitchenBookingAttendanceEvents.bookingId, action: kitchenBookingAttendanceEvents.action,
      actorRole: kitchenBookingAttendanceEvents.actorRole, createdAt: kitchenBookingAttendanceEvents.createdAt })
      .from(kitchenBookingAttendanceEvents).where(inArray(kitchenBookingAttendanceEvents.bookingId, bookingIds))),
    forBookings(() => db.select({ id: commitmentProblems.id, bookingId: commitmentProblems.bookingId, status: commitmentProblems.status,
      category: commitmentProblems.category, owner: commitmentProblems.owner, reportedBy: commitmentProblems.reportedBy, createdAt: commitmentProblems.createdAt })
      .from(commitmentProblems).where(inArray(commitmentProblems.bookingId, bookingIds))),
    db.select({ id: storageBookings.id, reference: storageBookings.referenceCode, name: storageListings.name, state: storageBookings.rentalState,
      endReason: storageBookings.endReason, startOn: storageBookings.termStart, paidThrough: storageBookings.paidThrough, totalCents: storageBookings.totalPrice,
      createdAt: storageBookings.createdAt })
      .from(storageBookings).innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .where(and(eq(storageBookings.chefId, chefId), eq(kitchens.locationId, locationId))).orderBy(desc(storageBookings.startDate)).limit(50),
  ]);
  const refundOf = new Map<number, number>(), paidOf = new Map<number, { at: Date; cents: number }>();
  for (const row of paymentRows) {
    refundOf.set(row.bookingId, (refundOf.get(row.bookingId) ?? 0) + Math.round(Number(row.refundAmount ?? 0)));
    if (PAID.includes(row.status)) paidOf.set(row.bookingId, { at: row.paidAt ?? row.createdAt, cents: Math.round(Number(row.amount)) });
  }
  const noShowVisits = new Set(noShowVisitRows.map(row => row.bookingId));
  // "I was there" files the customer's attendance problem (older ones carry no category); Local Cooks resolving it ends the review.
  const reportedNoShow = new Set(attendanceRows.filter(event => event.action === 'report_no_show').map(event => event.bookingId));
  const disputeRows = problemRows.filter(row => row.reportedBy === chefId && reportedNoShow.has(row.bookingId ?? 0) && (row.category === ATTENDANCE_CATEGORY || row.category == null));
  const disputed = new Set(disputeRows.filter(row => row.status !== 'resolved').map(row => row.bookingId));

  const deadlineFor = (row: (typeof bookingRows)[number]) => {
    if (row.status !== 'pending') return null;
    try { return responseDeadlineForBooking(row as unknown as never, timezone, lifecycle.managerResponseBufferHours).toISOString(); } catch { return null; }
  };
  const upcoming: PageBooking[] = [], past: PastBooking[] = [];
  let visits = 0, minutes = 0, lastVisitEndedAt = 0;
  let nextVisit: { bookingId: number; startsAt: string; endsAt: string } | null = null;
  for (const row of bookingRows) {
    const windows = bookingVisitWindows(row as unknown as RawBooking, timezone);
    const bounds = bookingBounds(row as unknown as RawBooking, timezone);
    const shaped: PageBooking = { bookingId: row.id, reference: row.referenceCode, kitchenName: row.kitchenName, startsAt: isoOf(bounds?.start), endsAt: isoOf(bounds?.end),
      status: row.status, responseDeadlineAt: deadlineFor(row), rentals: bookingRentals(row.equipmentItems, row.storageItems) };
    const ongoing = ['pending', 'confirmed', 'cancellation_requested'].includes(row.status) && (!shaped.endsAt || Date.parse(shaped.endsAt) > now.getTime());
    if (ongoing) {
      upcoming.push(shaped);
      // A multi-day booking's next visit is its next day, not the booking's first day.
      const coming = row.status === 'pending' ? undefined : windows.find(window => window.start.getTime() > now.getTime());
      if (coming && (!nextVisit || coming.start.getTime() < Date.parse(nextVisit.startsAt)))
        nextVisit = { bookingId: row.id, startsAt: coming.start.toISOString(), endsAt: coming.end.toISOString() };
      continue;
    }
    const reported = (row.checkinStatus === 'no_show' || noShowVisits.has(row.id)) && row.checkinStatus !== 'checkout_claim_filed';
    const outcome = reported ? 'attendance_reported' : bookingOutcome(row, managerId);
    past.push({ ...shaped, outcome, refundedCents: refundOf.get(row.id) ?? 0, late: lateCancellation(row, bounds?.start ?? null),
      noShow: reported ? disputed.has(row.id) ? 'under_review' : 'counted' : null });
    if (!ATTENDED.includes(outcome)) continue;
    visits++;
    for (const window of windows) if (window.end.getTime() <= now.getTime()) {
      minutes += (window.end.getTime() - window.start.getTime()) / 60_000;
      lastVisitEndedAt = Math.max(lastVisitEndedAt, window.end.getTime());
    }
  }
  upcoming.sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity));
  const isCancelled = (booking: PastBooking) => ['cancelled_by_customer', 'cancelled_by_you', 'cancelled'].includes(booking.outcome);
  const cancelledByCustomer = past.filter(booking => booking.outcome === 'cancelled_by_customer');
  const reliability = {
    visits, hoursInKitchen: Math.round(minutes / 6) / 10, lastVisitEndedAt: lastVisitEndedAt ? new Date(lastVisitEndedAt).toISOString() : null, nextVisit,
    cancelledByCustomer: cancelledByCustomer.length, lateCancellations: cancelledByCustomer.filter(booking => booking.late).length,
    noShowsCounted: past.filter(booking => booking.noShow === 'counted').length, noShowsUnderReview: past.filter(booking => booking.noShow === 'under_review').length,
  };
  const bookingCounts = { upcoming: upcoming.length, past: past.filter(booking => !isCancelled(booking)).length, cancelled: past.filter(isCancelled).length };
  const bookingOf = new Map<number, PageBooking>();
  for (const booking of (upcoming as PageBooking[]).concat(past)) bookingOf.set(booking.bookingId, booking);
  const visitOf = (bookingId: number | null) => {
    const booking = bookingId != null ? bookingOf.get(bookingId) : undefined;
    return { bookingId: bookingId ?? undefined, reference: booking?.reference ?? null, startsAt: booking?.startsAt ?? null, endsAt: booking?.endsAt ?? null };
  };

  const app = appRows[0] ?? null;
  const user = userRows[0] ?? null;
  const status: CustomerStatus = view.status;
  const canViewFiles = ['applied', 'in_review', 'approved', 'suspended'].includes(status);
  const documents = app ? (['foodSafetyLicense', 'foodEstablishmentCert'] as const).flatMap(key => {
    const url = key === 'foodSafetyLicense' ? app.foodSafetyLicenseUrl : app.foodEstablishmentCertUrl;
    const required = requiredAccessDocuments({ status: app.status, currentTier: app.currentTier,
      foodSafetyLicenseUrl: app.foodSafetyLicenseUrl, foodEstablishmentCertUrl: app.foodEstablishmentCertUrl }, requirements).some(document => document.key === key);
    if (!url && !required) return [];
    const docStatus = key === 'foodSafetyLicense' ? app.foodSafetyLicenseStatus : app.foodEstablishmentCertStatus;
    const expiry = key === 'foodSafetyLicense' ? app.foodSafetyLicenseExpiry : app.foodEstablishmentCertExpiry;
    return [{ key, required, uploaded: !!url, status: docStatus ?? 'pending', expiry: expiry ?? null, daysLeft: accessDocumentDaysLeft(expiry, timezone, now),
      stage: accessDocumentStage(expiry, timezone, now), url: canViewFiles ? url ?? null : null,
      renewalPending: renewals.some(renewal => renewal.key === key) }];
  }) : [];

  const visibleTours = tourRows.filter(tour => managerVisibleTour({ ...tour, adminReviewedAt: tour.adminReviewedAt, confirmationVerified: tour.confirmationVerified,
    confirmedAt: tour.confirmedAt, requestExpiredAt: tour.requestExpiredAt }));
  // Only the manager's own feedback is ever read; the customer's answers and conflict flags never leave the database.
  const feedbackRows = visibleTours.length ? await db.select({ viewingId: tourFeedbackResponses.viewingId }).from(tourFeedbackResponses)
    .where(and(inArray(tourFeedbackResponses.viewingId, visibleTours.map(tour => tour.id)), eq(tourFeedbackResponses.respondentRole, 'manager'), eq(tourFeedbackResponses.respondentId, managerId))) : [];
  const mineDone = new Set(feedbackRows.map(row => row.viewingId));

  const claimAmount = (claim: (typeof claimRows)[number]) => claim.finalCents ?? claim.approvedCents ?? claim.claimedCents ?? 0;
  const owed = claimRows.filter(claim => OWED_CLAIM_STATUSES.includes(claim.status) && claim.chefOwes).reduce((total, claim) => total + claimAmount(claim), 0);
  const collected = claimRows.filter(claim => claim.status === 'charge_succeeded');
  const money = moneyRows[0];
  const paidAccess = accessRows.length ? accessRows.map(row => row.grantedAt.getTime()) : [];
  const customerSince = paidAccess.length ? new Date(Math.min(...paidAccess)) : app && app.status === 'approved' && app.currentTier >= 3 ? app.reviewedAt : null;
  const firstContact = [app?.createdAt, ...tourRows.map(tour => tour.scheduledAt)].filter((value): value is Date => value instanceof Date);
  const youApprovedAt = app && app.status === 'approved' && app.currentTier >= 3 ? app.reviewedAt : null;

  // One phone per account (owner, Oct 22): only the verified account phone.
  const phone = user?.phoneVerifiedAt ? user.phoneNumber : null;
  const name = app?.fullName?.trim() || selectedName(input, chefId);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const storage = storageRows.map(row => ({ id: row.id, reference: row.reference, name: row.name, state: row.state, endReason: row.endReason,
    startOn: row.startOn, endOn: row.paidThrough, totalCents: Math.round(Number(row.totalCents ?? 0)),
    moveInOverdue: row.state === 'reserved' && !!row.startOn && row.startOn < today }));

  const open: OpenItem[] = [];
  for (const rental of storage) if (rental.moveInOverdue)
    open.push({ kind: 'storage_move_in', owner: 'you', storageId: rental.id, name: rental.name, startOn: rental.startOn, endOn: rental.endOn });
  for (const booking of upcoming) {
    if (booking.status === 'pending') open.push({ kind: 'booking_request', owner: 'you', ...visitOf(booking.bookingId), deadlineAt: booking.responseDeadlineAt });
    if (booking.status === 'cancellation_requested') open.push({ kind: 'cancellation_request', owner: 'you', ...visitOf(booking.bookingId) });
  }
  // Any other task of yours the relationship view picked (an inspection, a tour, documents to review) keeps its own link.
  if (view.next.owner === 'you' && !['booking_request', 'cancellation_request', 'problem'].includes(view.next.code)) open.push({ kind: 'next', owner: 'you' });
  for (const row of problemRows) {
    if (row.status === 'resolved') continue;
    if (disputeRows.includes(row)) open.push({ kind: 'no_show_review', owner: 'local_cooks', ...visitOf(row.bookingId) });
    else open.push({ kind: 'problem', owner: row.owner === 'manager' ? 'you' : 'local_cooks', ...visitOf(row.bookingId) });
  }
  for (const actor of ['you', 'customer', 'local_cooks'] as const) {
    const claims = claimRows.filter(claim => claimNextActor(claim.status) === actor);
    if (claims.length) open.push({ kind: 'claims', owner: actor, count: claims.length, amountCents: claims.reduce((total, claim) => total + claimAmount(claim), 0),
      references: claims.map(claim => claim.referenceCode ?? `#${claim.id}`) });
  }

  const activity: ActivityItem[] = [];
  for (const row of bookingRows) {
    const visit = visitOf(row.id), booking = bookingOf.get(row.id), paid = paidOf.get(row.id);
    if (paid) activity.push({ at: paid.at.toISOString(), type: 'booked', category: 'money', actor: 'customer', ...visit, amountCents: paid.cents, rentals: booking?.rentals });
    else activity.push({ at: row.createdAt.toISOString(), type: 'requested', category: 'booking', actor: 'customer', ...visit, rentals: booking?.rentals });
    if (row.status === 'cancelled' && row.cancellationEffectiveAt) activity.push({ at: row.cancellationEffectiveAt.toISOString(), type: 'cancelled',
      category: refundOf.get(row.id) ? 'money' : 'booking', actor: row.cancellationCause === 'chef' ? 'customer' : row.cancellationCause === 'kitchen' ? 'you' : 'local_cooks',
      ...visit, refundedCents: refundOf.get(row.id) ?? 0 });
    // A paid rental day the kitchen cancelled: one line per listing and day.
    const items = Array.isArray(row.equipmentItems) ? row.equipmentItems as RentalItem[] : [];
    for (const item of items) if (item?.status === 'cancelled' && item.cancelledAt && Number(item.totalPrice ?? 0) > 0 && row.status !== 'cancelled')
      activity.push({ at: item.cancelledAt, type: 'rental_day_cancelled', category: 'booking', actor: item.cancelledBy === 'kitchen' ? 'you' : 'customer', ...visit, name: item.name ?? '', date: item.date });
    const outcome = past.find(item => item.bookingId === row.id)?.outcome;
    if (outcome && ATTENDED.includes(outcome) && visit.endsAt) activity.push({ at: visit.endsAt, type: 'visit_ended', category: 'booking', actor: 'customer', ...visit });
  }
  for (const event of attendanceRows) if (event.action === 'report_no_show')
    activity.push({ at: event.createdAt.toISOString(), type: 'no_show_reported', category: 'booking', actor: event.actorRole === 'admin' ? 'local_cooks' : 'you', ...visitOf(event.bookingId),
      status: disputed.has(event.bookingId) ? 'under_review' : 'counted' });
  for (const row of disputeRows) activity.push({ at: row.createdAt.toISOString(), type: 'no_show_disputed', category: 'booking', actor: 'customer', ...visitOf(row.bookingId),
    status: row.status === 'resolved' ? 'resolved' : 'under_review' });
  for (const claim of claimRows) activity.push({ at: claim.createdAt.toISOString(), type: 'claim_filed', category: 'money', actor: 'you', ...visitOf(claim.bookingId),
    reference: claim.referenceCode, name: claim.title, amountCents: claimAmount(claim), status: claim.status });
  for (const row of storageRows) activity.push({ at: row.createdAt.toISOString(), type: 'storage_rented', category: 'booking', actor: 'customer', reference: row.reference,
    name: row.name, startOn: row.startOn, endOn: row.paidThrough, amountCents: Math.round(Number(row.totalCents ?? 0)) });
  if (app) {
    activity.push({ at: app.createdAt.toISOString(), type: 'applied', category: 'access', actor: 'customer' });
    if (app.tier1CompletedAt) activity.push({ at: app.tier1CompletedAt.toISOString(), type: 'local_cooks_approved', category: 'access', actor: 'local_cooks' });
    if (app.tier2CompletedAt) activity.push({ at: app.tier2CompletedAt.toISOString(), type: 'documents_sent', category: 'access', actor: 'customer' });
    if (youApprovedAt) activity.push({ at: youApprovedAt.toISOString(), type: 'access_approved', category: 'access', actor: 'you' });
  }
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    customer: {
      chefId, name,
      businessName: app?.shopName && app.shopName !== 'Shop Not Named' ? app.shopName : null,
      email: app?.email || user?.username || null, phone,
      customerSince: customerSince?.toISOString() ?? null,
      firstContactAt: firstContact.length ? new Date(Math.min(...firstContact.map(value => value.getTime()))).toISOString() : null,
      ...plansToBook(app?.businessDescription ?? null),
    },
    location: { id: scope.id, name: scope.name, timezone },
    locations: relationships.map(relationship => {
      const other = customerRelationshipView(relationship.facts, relationship.location.timezone, now);
      const bookingCount = input.bookingStats.find(stat => stat.chefId === chefId && stat.locationId === relationship.location.id)?.count ?? 0;
      return { id: relationship.location.id, name: relationship.location.name, timezone: relationship.location.timezone, status: other.status, needsAction: other.next.needsAction, bookingCount };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    manageable: allLocations.length,
    status, next: view.next satisfies CustomerNextAction,
    actions: {
      applicationId: app?.id ?? null,
      canInvite: status === 'approved',
      canRevoke: status === 'approved' && selected.facts.hasAccess,
      canReview: status === 'in_review' && !!app,
      revokedNote: status === 'revoked',
    },
    reliability, bookingCounts, open,
    upcoming, past: options.allPast ? past : past.slice(0, 10), pastTotal: past.length, pastHasMore: !options.allPast && past.length > 10,
    application: app ? {
      id: app.id, status: app.status, tier: app.currentTier,
      stages: [
        { key: 'requested', at: app.createdAt.toISOString() },
        { key: 'localCooksApproved', at: app.tier1CompletedAt?.toISOString() ?? null },
        { key: 'documentsSubmitted', at: app.tier2CompletedAt?.toISOString() ?? null },
        { key: 'youApproved', at: youApprovedAt?.toISOString() ?? null },
      ],
      documents,
    } : null,
    tours: visibleTours.map(tour => ({ id: tour.id, scheduledAt: tour.scheduledAt.toISOString(), durationMinutes: tour.durationMinutes, status: tour.status,
      kitchenName: tour.kitchenName, feedbackSubmitted: mineDone.has(tour.id) })),
    money: { paidCents: Math.round(Number(money?.paid ?? 0)), refundedCents: Math.round(Number(money?.refunded ?? 0)), heldCents: Math.round(Number(money?.held ?? 0)),
      outstandingCents: owed, currency: 'CAD', paymentCount: Number(money?.payments ?? 0), holdCount: Number(money?.holds ?? 0),
      claimsCollectedCents: collected.reduce((total, claim) => total + claimAmount(claim), 0), claimsCollectedCount: collected.length },
    // The kitchen's payout per payment from the saved release state (the booking page has the live projection).
    payments: paymentRows.slice(0, 50).map(row => {
      const payout = kitchenPayout(row);
      return { id: row.id, ...visitOf(row.bookingId), paidAt: isoOf(row.paidAt ?? row.createdAt), status: row.status, amountCents: Math.round(Number(row.amount)),
        refundedCents: Math.round(Number(row.refundAmount ?? 0)), payoutCents: PAID.includes(row.status) ? payout.amountCents : null,
        payoutStatus: PAID.includes(row.status) ? payout.status : null, payoutAt: payout.sentAt ?? payout.expectedAt };
    }),
    storage,
    activity: activity.slice(0, 100),
    claims: claimRows.map(claim => ({ id: claim.id, reference: claim.referenceCode, title: claim.title, status: claim.status,
      amountCents: claim.finalCents ?? claim.approvedCents ?? claim.claimedCents, nextActor: claimNextActor(claim.status),
      deadlineAt: ['submitted'].includes(claim.status) ? claim.deadline.toISOString() : null, bookingId: claim.bookingId })),
  };
}

function selectedName(input: CustomerReadInput, chefId: number) {
  const person = input.people.find(candidate => candidate.id === chefId);
  return person?.platformName?.trim() || (person ? person.username.split('@')[0] : `#${chefId}`);
}
