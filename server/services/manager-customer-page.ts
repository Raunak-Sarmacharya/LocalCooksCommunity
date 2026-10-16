import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  chefDocumentRenewals, chefKitchenApplications, chefLocationAccess, damageClaims, kitchenBookings, kitchens, kitchenViewings,
  paymentTransactions, tourFeedbackResponses, users,
} from '@shared/schema';
import { customerRelationshipView, moreUrgentRelationship, type CustomerNextAction, type CustomerStatus } from '@shared/customer-next-action';
import { accessDocumentDaysLeft, accessDocumentStage, requiredAccessDocuments } from '@shared/location-booking-eligibility';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { DomainError } from '../shared/errors/domain-error';
import { locationService } from '../domains/locations/location.service';
import { getLifecycleSettings } from './lifecycle-settings';
import {
  bookingBounds, buildRelationships, loadCustomerReadInput, managerLocations, managerVisibleTour,
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

export type PageBooking = {
  bookingId: number; reference: string | null; kitchenName: string; startsAt: string | null; endsAt: string | null; status: string;
  responseDeadlineAt: string | null; equipmentCount: number; storageCount: number;
};
export type PastBooking = PageBooking & { outcome: BookingOutcomeCode; refundedCents: number };

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
  if (!chosen) throw new DomainError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  const selected = chosen.relationship, view = chosen;
  const locationId = selected.location.id;
  const scope = selected.location;
  const timezone = scope.timezone || DEFAULT_TIMEZONE;

  const [appRows, userRows, accessRows, bookingRows, tourRows, claimRows, moneyRows, requirements, renewals] = await Promise.all([
    db.select({ id: chefKitchenApplications.id, fullName: chefKitchenApplications.fullName, shopName: chefKitchenApplications.shopName,
      email: chefKitchenApplications.email, phone: chefKitchenApplications.phone, status: chefKitchenApplications.status, currentTier: chefKitchenApplications.current_tier,
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
      cancellationPolicyHours: kitchenBookings.cancellationPolicyHours,
      equipmentCount: sql<number>`CASE WHEN jsonb_typeof(${kitchenBookings.equipmentItems}) = 'array' THEN jsonb_array_length(${kitchenBookings.equipmentItems}) ELSE 0 END`,
      storageCount: sql<number>`CASE WHEN jsonb_typeof(${kitchenBookings.storageItems}) = 'array' THEN jsonb_array_length(${kitchenBookings.storageItems}) ELSE 0 END`,
      total: sql<number>`count(*) over ()::int` })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId)))
      .orderBy(desc(kitchenBookings.bookingDate), desc(kitchenBookings.id)).limit(options.allPast ? 200 : 60),
    db.select({ id: kitchenViewings.id, status: kitchenViewings.status, scheduledAt: kitchenViewings.scheduledAt, durationMinutes: kitchenViewings.durationMinutes,
      kitchenName: kitchens.name, adminReviewDecision: kitchenViewings.adminReviewDecision, cancelledBy: kitchenViewings.cancelledBy, adminReviewedAt: kitchenViewings.adminReviewedAt,
      confirmationVerified: kitchenViewings.confirmationVerified, confirmedAt: kitchenViewings.confirmedAt, requestExpiredAt: kitchenViewings.requestExpiredAt })
      .from(kitchenViewings).leftJoin(kitchens, eq(kitchens.id, kitchenViewings.targetedKitchenId))
      .where(and(eq(kitchenViewings.chefId, chefId), eq(kitchenViewings.locationId, locationId))).orderBy(desc(kitchenViewings.scheduledAt)).limit(20),
    db.select({ id: damageClaims.id, referenceCode: damageClaims.referenceCode, status: damageClaims.status, title: damageClaims.claimTitle,
      claimedCents: damageClaims.claimedAmountCents, approvedCents: damageClaims.approvedAmountCents, finalCents: damageClaims.finalAmountCents,
      chefOwes: damageClaims.chefOwes, deadline: damageClaims.chefResponseDeadline, bookingId: damageClaims.kitchenBookingId, createdAt: damageClaims.createdAt })
      .from(damageClaims).where(and(eq(damageClaims.chefId, chefId), eq(damageClaims.locationId, locationId))).orderBy(desc(damageClaims.createdAt)).limit(20),
    // One aggregate over the whole history. Explicit amount columns only: never card, Stripe or payment-method identifiers.
    db.select({
      paid: sql<string>`coalesce(sum(${paymentTransactions.amount}) FILTER (WHERE ${paymentTransactions.status} IN ('succeeded','partially_refunded','refunded')), 0)`,
      refunded: sql<string>`coalesce(sum(${paymentTransactions.refundAmount}) FILTER (WHERE ${paymentTransactions.status} IN ('partially_refunded','refunded')), 0)`,
      held: sql<string>`coalesce(sum(${paymentTransactions.amount}) FILTER (WHERE ${paymentTransactions.status} = 'authorized'), 0)`,
    }).from(paymentTransactions)
      .innerJoin(kitchenBookings, and(eq(paymentTransactions.bookingId, kitchenBookings.id), eq(paymentTransactions.bookingType, 'kitchen')))
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId))),
    locationService.getLocationRequirementsWithDefaults(locationId),
    selected.application ? db.select({ id: chefDocumentRenewals.id, key: chefDocumentRenewals.documentKey, expiry: chefDocumentRenewals.expiry, submittedAt: chefDocumentRenewals.submittedAt })
      .from(chefDocumentRenewals).where(and(eq(chefDocumentRenewals.applicationId, selected.application.id), eq(chefDocumentRenewals.status, 'pending'))) : Promise.resolve([]),
  ]);

  // Refunds shown beside each booking: one query for the bookings on screen.
  const shownBookingIds = bookingRows.map(row => row.id);
  const refundRows = shownBookingIds.length ? await db.select({ bookingId: paymentTransactions.bookingId, refunded: paymentTransactions.refundAmount })
    .from(paymentTransactions).where(and(eq(paymentTransactions.bookingType, 'kitchen'), inArray(paymentTransactions.bookingId, shownBookingIds))) : [];
  const refundOf = new Map<number, number>();
  for (const row of refundRows) refundOf.set(row.bookingId, (refundOf.get(row.bookingId) ?? 0) + Math.round(Number(row.refunded ?? 0)));

  const deadlineFor = (row: (typeof bookingRows)[number]) => {
    if (row.status !== 'pending') return null;
    try { return responseDeadlineForBooking(row as unknown as never, timezone, lifecycle.managerResponseBufferHours).toISOString(); } catch { return null; }
  };
  const toPageBooking = (row: (typeof bookingRows)[number]): PageBooking => {
    const bounds = bookingBounds(row as unknown as RawBooking, timezone);
    return { bookingId: row.id, reference: row.referenceCode, kitchenName: row.kitchenName, startsAt: bounds?.start.toISOString() ?? null, endsAt: bounds?.end.toISOString() ?? null,
      status: row.status, responseDeadlineAt: deadlineFor(row), equipmentCount: Number(row.equipmentCount ?? 0), storageCount: Number(row.storageCount ?? 0) };
  };
  const upcoming: PageBooking[] = [], past: PastBooking[] = [];
  for (const row of bookingRows) {
    const shaped = toPageBooking(row);
    const ongoing = ['pending', 'confirmed', 'cancellation_requested'].includes(row.status) && (!shaped.endsAt || Date.parse(shaped.endsAt) > now.getTime());
    if (ongoing) upcoming.push(shaped);
    else past.push({ ...shaped, outcome: bookingOutcome(row, managerId), refundedCents: refundOf.get(row.id) ?? 0 });
  }
  upcoming.sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity));

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

  const owed = claimRows.filter(claim => OWED_CLAIM_STATUSES.includes(claim.status) && claim.chefOwes)
    .reduce((total, claim) => total + (claim.finalCents ?? claim.approvedCents ?? claim.claimedCents ?? 0), 0);
  const money = moneyRows[0];
  const paidAccess = accessRows.length ? accessRows.map(row => row.grantedAt.getTime()) : [];
  const customerSince = paidAccess.length ? new Date(Math.min(...paidAccess)) : app && app.status === 'approved' && app.currentTier >= 3 ? app.reviewedAt : null;
  const firstContact = [app?.createdAt, ...tourRows.map(tour => tour.scheduledAt)].filter((value): value is Date => value instanceof Date);

  const phone = user?.phoneVerifiedAt ? user.phoneNumber : null;
  return {
    customer: {
      chefId, name: app?.fullName?.trim() || selectedName(input, chefId),
      businessName: app?.shopName && app.shopName !== 'Shop Not Named' ? app.shopName : null,
      email: app?.email || user?.username || null, phone: phone ?? null,
      customerSince: customerSince?.toISOString() ?? null,
      firstContactAt: firstContact.length ? new Date(Math.min(...firstContact.map(value => value.getTime()))).toISOString() : null,
    },
    location: { id: scope.id, name: scope.name, timezone },
    locations: relationships.map(relationship => {
      const other = customerRelationshipView(relationship.facts, relationship.location.timezone, now);
      return { id: relationship.location.id, name: relationship.location.name, timezone: relationship.location.timezone, status: other.status, needsAction: other.next.needsAction };
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
    upcoming, past: options.allPast ? past : past.slice(0, 10), pastTotal: past.length, pastHasMore: !options.allPast && past.length > 10,
    application: app ? {
      id: app.id, status: app.status, tier: app.currentTier,
      stages: [
        { key: 'requested', at: app.createdAt.toISOString() },
        { key: 'localCooksApproved', at: app.tier1CompletedAt?.toISOString() ?? null },
        { key: 'documentsSubmitted', at: app.tier2CompletedAt?.toISOString() ?? null },
        { key: 'youApproved', at: app.status === 'approved' && app.currentTier >= 3 ? app.reviewedAt?.toISOString() ?? null : null },
      ],
      documents,
    } : null,
    tours: visibleTours.map(tour => ({ id: tour.id, scheduledAt: tour.scheduledAt.toISOString(), durationMinutes: tour.durationMinutes, status: tour.status,
      kitchenName: tour.kitchenName, feedbackSubmitted: mineDone.has(tour.id) })),
    money: { paidCents: Math.round(Number(money?.paid ?? 0)), refundedCents: Math.round(Number(money?.refunded ?? 0)), heldCents: Math.round(Number(money?.held ?? 0)),
      outstandingCents: owed, currency: 'CAD' },
    claims: claimRows.map(claim => ({ id: claim.id, reference: claim.referenceCode, title: claim.title, status: claim.status,
      amountCents: claim.finalCents ?? claim.approvedCents ?? claim.claimedCents, nextActor: claimNextActor(claim.status),
      deadlineAt: ['submitted'].includes(claim.status) ? claim.deadline.toISOString() : null, bookingId: claim.bookingId })),
  };
}

function selectedName(input: CustomerReadInput, chefId: number) {
  const person = input.people.find(candidate => candidate.id === chefId);
  return person?.platformName?.trim() || (person ? person.username.split('@')[0] : `#${chefId}`);
}
