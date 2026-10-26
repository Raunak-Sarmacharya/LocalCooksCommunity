import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  applications, chefDocumentRenewals, chefKitchenApplications, chefLocationAccess, commitmentProblems, customerNotes, damageClaims,
  kitchenBookings, kitchens, kitchenViewings, locations, paymentTransactions, tourFeedbackResponses, users,
} from '@shared/schema';
import {
  compareCustomerKeys, customerMatchesFilter, customerRelationshipView, customerSortKey, moreUrgentRelationship,
  type CustomerFilter, type CustomerNextAction, type CustomerRelationshipFacts, type CustomerSort, type CustomerStatus,
} from '@shared/customer-next-action';
import { requiredAccessDocuments } from '@shared/location-booking-eligibility';
import { makeCloseoutSnapshot, savedCloseout } from '@shared/clock-closeout';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { tourRequestDecision } from '@shared/tour-request-decision';
import { tourFeedbackOpen } from '@shared/tour-feedback';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { DomainError } from '../shared/errors/domain-error';
import { accessEndedMarker } from './location-access-notices';
import { getLifecycleSettings } from './lifecycle-settings';
import { locationService } from '../domains/locations/location.service';

export const CUSTOMER_PAGE_SIZE = 50;
export const NOTE_MAX_LENGTH = 2000;

/* ───────────────────────────── raw rows (what the loaders return) ───────────────────────────── */

export type RawLocation = { id: number; name: string; timezone: string };
export type RawApplication = {
  id: number; chefId: number; locationId: number; fullName: string; shopName: string; email: string;
  status: 'inReview' | 'approved' | 'rejected' | 'cancelled'; currentTier: number; tier2CompletedAt: Date | null; accessEnded: boolean;
  createdAt: Date; updatedAt: Date; documents: { key: string; label: string; expiry: string | null }[];
  /** The kitchen added this customer (Add customer); they never sent a request. */ addedByKitchen?: boolean;
};
export type RawAccess = { chefId: number; locationId: number; grantedAt: Date };
export type RawTour = {
  id: number; chefId: number; locationId: number; status: string; scheduledAt: Date; durationMinutes: number; appointmentRevision: number;
  lifecycleState: string; visitResult: string | null; disruptionReason: string | null; confirmationVerified: boolean; confirmedAt: Date | null;
  requestExpiredAt: Date | null; checkedInAt: Date | null; createdAt: Date; updatedAt: Date; adminReviewedAt: Date | null;
  rescheduleProposedAt: Date | null; rescheduleProposedSlots: string[] | null; requestedRescheduleAt: Date | null; rescheduleRequestedAt: Date | null;
};
export type RawBooking = {
  id: number; chefId: number; locationId: number; kitchenId: number; kitchenName: string; status: string; bookingDate: Date;
  startTime: string; endTime: string; operatingWindowStartTime: string | null; selectedSlots: unknown; visitDuties: unknown;
  checkinStatus: string | null; checkoutRequestedAt: Date | null; paymentDecisionState: string | null; createdAt: Date; updatedAt: Date;
  cancellationPolicySnapshot: unknown; cancellationPolicyHours: number | null;
};
export type RawBookingStat = { chefId: number; locationId: number; count: number; lastActivityAt: Date | null };
export type RawProblem = { chefId: number; locationId: number; owner: string; bookingId: number | null; viewingId: number | null };
export type RawClaim = { chefId: number; locationId: number; status: string };
export type RawPerson = { id: number; username: string; platformName: string | null };

export type CustomerReadInput = {
  locations: RawLocation[];
  applications: RawApplication[];
  access: RawAccess[];
  tours: RawTour[];
  /** Tours whose manager feedback is already in. */
  tourFeedbackDone: Set<number>;
  bookings: RawBooking[];
  bookingStats: RawBookingStat[];
  problems: RawProblem[];
  claims: RawClaim[];
  renewalApplicationIds: Set<number>;
  people: RawPerson[];
  responseBufferHours: number;
  inspectionAutoCloseHours: number;
};

/* ───────────────────────────── response shapes ───────────────────────────── */

export type CustomerLocationChip = { locationId: number; locationName: string; timezone: string; status: CustomerStatus; next: CustomerNextAction };
export type CustomerNextBooking = { bookingId: number; locationId: number; kitchenName: string; startsAt: string; endsAt: string; timezone: string; status: string };
export type CustomerListRow = {
  chefId: number; name: string; businessName: string | null;
  status: CustomerStatus; next: CustomerNextAction; needsAction: boolean;
  /** Primary relationship: the kitchen added them, so 'applied' reads as 'Added'. */ addedByKitchen?: boolean;
  /** The location the primary status and action belong to. */
  locationId: number; timezone: string;
  locations: CustomerLocationChip[];
  nextBooking: CustomerNextBooking | null;
  openItems: number;
  lastActivityAt: string | null;
};
export type CustomerCounts = Record<CustomerFilter, number>;
export type CustomerListResponse = { customers: CustomerListRow[]; counts: CustomerCounts; nextCursor: string | null; locations: { id: number; name: string; timezone: string }[] };

/* ───────────────────────────── pure assembly ───────────────────────────── */

/** Each visit's window (one per day for a multi-day booking), from the saved closeout clock when there is one. */
export function bookingVisitWindows(booking: Pick<RawBooking, 'bookingDate' | 'startTime' | 'endTime' | 'operatingWindowStartTime' | 'selectedSlots' | 'visitDuties' | 'status'> & Pick<Partial<RawBooking>, 'cancellationPolicySnapshot'>, timezone: string) {
  try {
    const policy = booking.cancellationPolicySnapshot as { deadlineBasis?: string; sessions?: Array<{ startAt: string; endAt?: string }> } | null;
    // Pending dated requests have frozen session starts before confirmation saves their visit clock.
    if (booking.status === 'pending' && policy?.deadlineBasis === 'booking_first_day')
      return (policy.sessions ?? []).map(session => ({ start: new Date(session.startAt), end: new Date(session.endAt ?? session.startAt) }))
        .filter(window => Number.isFinite(window.start.getTime()) && Number.isFinite(window.end.getTime()));
    const clock = savedCloseout(booking.visitDuties) ?? makeCloseoutSnapshot(booking as never, timezone, { serviceEndGraceMinutes: 0, inspectionAutoCloseHours: 0, checkinWindowMinutesBefore: 0 });
    return clock.visits.map(visit => ({ start: new Date(visit.scheduledStartAt), end: new Date(visit.scheduledEndAt) }))
      .filter(window => Number.isFinite(window.start.getTime()) && Number.isFinite(window.end.getTime()));
  } catch { /* A schedule that cannot be resolved is shown without a time rather than guessed. */ }
  return [];
}

export function bookingBounds(booking: Parameters<typeof bookingVisitWindows>[0], timezone: string) {
  const windows = bookingVisitWindows(booking, timezone);
  if (!windows.length) return null;
  return { start: new Date(Math.min(...windows.map(window => window.start.getTime()))), end: new Date(Math.max(...windows.map(window => window.end.getTime()))) };
}

const key = (chefId: number, locationId: number) => `${chefId}:${locationId}`;
const NONE_TIME = Number.POSITIVE_INFINITY;
const iso = (value: Date | null | undefined) => value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const earliest = <T>(items: T[], at: (item: T) => number) => items.reduce<T | null>((best, item) => best === null || at(item) < at(best) ? item : best, null);

/** Is this tour one the manager may see? (Mirrors the Tours page: Local Cooks triage and denied requests stay hidden.) */
export function managerVisibleTour(tour: Pick<RawTour, 'status' | 'adminReviewedAt' | 'confirmationVerified' | 'confirmedAt' | 'requestExpiredAt'> & { adminReviewDecision?: string | null; cancelledBy?: string | null }) {
  if (tour.status === 'pending_local_cooks' || tour.adminReviewDecision === 'denied') return false;
  return !(tour.status === 'cancelled' && !tour.adminReviewedAt && !hasTourConfirmation(tour)
    && ['chef', 'local_cooks', 'request_expired'].includes(tour.cancelledBy || ''));
}

type Relationship = {
  chefId: number; location: RawLocation; facts: CustomerRelationshipFacts; openItems: number;
  application: RawApplication | null; lastActivityAt: Date | null; nextBooking: CustomerNextBooking | null;
};

/** One relationship per (person, location). Everything the list needs, derived once. */
export function buildRelationships(input: CustomerReadInput, now: Date): Relationship[] {
  const locationById = new Map(input.locations.map(location => [location.id, location]));
  const applicationBy = new Map(input.applications.map(app => [key(app.chefId, app.locationId), app]));
  const accessBy = new Set(input.access.map(row => key(row.chefId, row.locationId)));
  const group = <T extends { chefId: number; locationId: number }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(key(row.chefId, row.locationId), [...(map.get(key(row.chefId, row.locationId)) ?? []), row]);
    return map;
  };
  const toursBy = group(input.tours), bookingsBy = group(input.bookings), problemsBy = group(input.problems), claimsBy = group(input.claims);
  const statsBy = new Map(input.bookingStats.map(stat => [key(stat.chefId, stat.locationId), stat]));
  const keys = new Set<string>([applicationBy, toursBy, bookingsBy, statsBy].flatMap(map => Array.from(map.keys())).concat(Array.from(accessBy)));
  const relationships: Relationship[] = [];
  for (const id of Array.from(keys)) {
    const [chefId, locationId] = id.split(':').map(Number);
    const location = locationById.get(locationId);
    if (!location) continue;
    const timezone = location.timezone || DEFAULT_TIMEZONE;
    const app = applicationBy.get(id) ?? null;
    const tours = toursBy.get(id) ?? [], bookings = bookingsBy.get(id) ?? [], problems = problemsBy.get(id) ?? [], claims = claimsBy.get(id) ?? [];

    const live = bookings.map(booking => ({ booking, bounds: bookingBounds(booking, timezone) }));
    const upcoming = live.filter(({ booking, bounds }) => ['pending', 'confirmed'].includes(booking.status) && (!bounds || bounds.end.getTime() > now.getTime()));
    const nextUpcoming = earliest(upcoming.filter(item => item.bounds), item => item.bounds!.start.getTime());
    const pendingRequests = live.filter(({ booking }) => booking.status === 'pending');
    const requestDeadline = (booking: RawBooking) => {
      try { return responseDeadlineForBooking({ ...booking, createdAt: booking.createdAt } as never, timezone, input.responseBufferHours).toISOString(); }
      catch { return null; }
    };
    const requestDeadlines = pendingRequests.map(({ booking }) => ({ bookingId: booking.id, deadlineAt: requestDeadline(booking) }));
    const bookingRequest = earliest(requestDeadlines, item => item.deadlineAt ? Date.parse(item.deadlineAt) : NONE_TIME);
    const inspections = live.filter(({ booking }) => booking.status === 'confirmed' && booking.checkinStatus === 'checkout_requested').map(({ booking, bounds }) => {
      const base = Math.max(bounds?.end.getTime() ?? 0, booking.checkoutRequestedAt?.getTime() ?? 0);
      return { bookingId: booking.id, deadlineAt: base ? new Date(base + input.inspectionAutoCloseHours * 3_600_000).toISOString() : null };
    });
    const inspection = earliest(inspections, item => item.deadlineAt ? Date.parse(item.deadlineAt) : NONE_TIME);
    const recovery = live.find(({ booking }) => booking.paymentDecisionState === 'pending');
    const cancellation = live.find(({ booking }) => booking.status === 'cancellation_requested');

    const tourFacts = tours.flatMap((tour): NonNullable<CustomerRelationshipFacts['tour']>[] => {
      const decision = tourRequestDecision({ ...tour, id: tour.id }, now.getTime());
      if (decision && (decision.stage === 'manager' || decision.stage === 'change_manager'))
        return [{ viewingId: tour.id, kind: (decision.stage === 'manager' ? 'request' : 'reschedule') as 'request' | 'reschedule', deadlineAt: decision.dueAt }];
      if (tourFeedbackOpen(tour, now) && !input.tourFeedbackDone.has(tour.id)) return [{ viewingId: tour.id, kind: 'feedback' as const, deadlineAt: null }];
      return [];
    });
    const tourFact = earliest(tourFacts, item => (item.kind === 'feedback' ? 1e16 : 0) + (item.deadlineAt ? Date.parse(item.deadlineAt) : NONE_TIME));
    const problem = problems[0] ? { owner: (problems.some(item => item.owner === 'manager') ? 'you' : 'local_cooks') as 'you' | 'local_cooks',
      bookingId: problems[0].bookingId, viewingId: problems[0].viewingId } : null;

    const facts: CustomerRelationshipFacts = {
      application: app && { id: app.id, status: app.status, currentTier: app.currentTier, tier2CompletedAt: iso(app.tier2CompletedAt), accessEnded: app.accessEnded },
      hasAccess: accessBy.has(id),
      hasTour: tours.length > 0,
      hasBooking: bookings.length > 0 || statsBy.has(id),
      documents: app?.documents ?? [],
      renewalPending: !!app && input.renewalApplicationIds.has(app.id),
      problem,
      bookingRequest: bookingRequest && { bookingId: bookingRequest.bookingId, deadlineAt: bookingRequest.deadlineAt },
      inspection: inspection && { bookingId: inspection.bookingId, deadlineAt: inspection.deadlineAt },
      paymentRecovery: recovery ? { bookingId: recovery.booking.id } : null,
      cancellationRequest: cancellation ? { bookingId: cancellation.booking.id } : null,
      tour: tourFact,
      nextBooking: nextUpcoming && { bookingId: nextUpcoming.booking.id, startsAt: nextUpcoming.bounds!.start.toISOString(), endsAt: nextUpcoming.bounds!.end.toISOString(), kitchenName: nextUpcoming.booking.kitchenName },
    };
    const openItems = pendingRequests.length + inspections.length + (recovery ? 1 : 0) + live.filter(({ booking }) => booking.status === 'cancellation_requested').length
      + problems.length + claims.length + tourFacts.length + (app && facts.renewalPending ? 1 : 0)
      + (app && app.status === 'approved' && app.currentTier === 2 && app.tier2CompletedAt ? 1 : 0);
    const activity = [app?.updatedAt, statsBy.get(id)?.lastActivityAt, ...tours.map(tour => tour.updatedAt), ...live.map(({ booking }) => booking.updatedAt)]
      .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()));
    relationships.push({
      chefId, location, facts, openItems, application: app,
      lastActivityAt: activity.length ? new Date(Math.max(...activity.map(value => value.getTime()))) : null,
      nextBooking: nextUpcoming && { bookingId: nextUpcoming.booking.id, locationId, kitchenName: nextUpcoming.booking.kitchenName,
        startsAt: nextUpcoming.bounds!.start.toISOString(), endsAt: nextUpcoming.bounds!.end.toISOString(), timezone, status: nextUpcoming.booking.status },
    });
  }
  return relationships;
}

const localPart = (email: string) => email.split('@')[0];

export function buildCustomerRows(input: CustomerReadInput, now: Date): CustomerListRow[] {
  const people = new Map(input.people.map(person => [person.id, person]));
  const byChef = new Map<number, Relationship[]>();
  for (const relationship of buildRelationships(input, now))
    byChef.set(relationship.chefId, [...(byChef.get(relationship.chefId) ?? []), relationship]);
  const rows: CustomerListRow[] = [];
  for (const [chefId, relationships] of Array.from(byChef.entries())) {
    const views = relationships.map(relationship => ({ relationship, ...customerRelationshipView(relationship.facts, relationship.location.timezone || DEFAULT_TIMEZONE, now) }));
    const primary = views.reduce((best, view) => moreUrgentRelationship(best, view));
    const withApplication = relationships.find(relationship => relationship.application)?.application ?? null;
    const person = people.get(chefId);
    const name = withApplication?.fullName?.trim() || person?.platformName?.trim() || (person ? localPart(person.username) : `#${chefId}`);
    const nextBooking = earliest(relationships.flatMap(relationship => relationship.nextBooking ? [relationship.nextBooking] : []), booking => Date.parse(booking.startsAt));
    const activity = relationships.map(relationship => relationship.lastActivityAt?.getTime() ?? 0);
    rows.push({
      chefId, name,
      businessName: withApplication?.shopName && withApplication.shopName !== 'Shop Not Named' ? withApplication.shopName : null,
      status: primary.status, next: primary.next, needsAction: views.some(view => view.next.needsAction),
      addedByKitchen: !!primary.relationship.application?.addedByKitchen,
      locationId: primary.relationship.location.id, timezone: primary.relationship.location.timezone || DEFAULT_TIMEZONE,
      locations: views.map(view => ({ locationId: view.relationship.location.id, locationName: view.relationship.location.name,
        timezone: view.relationship.location.timezone || DEFAULT_TIMEZONE, status: view.status, next: view.next })),
      nextBooking,
      openItems: relationships.reduce((total, relationship) => total + relationship.openItems, 0),
      lastActivityAt: Math.max(...activity) > 0 ? new Date(Math.max(...activity)).toISOString() : null,
    });
  }
  return rows;
}

export function searchMatches(row: CustomerListRow, input: CustomerReadInput, term: string) {
  const needle = term.trim().toLocaleLowerCase('en');
  if (!needle) return true;
  const apps = input.applications.filter(app => app.chefId === row.chefId);
  const person = input.people.find(candidate => candidate.id === row.chefId);
  return [row.name, row.businessName, person?.username, ...apps.flatMap(app => [app.fullName, app.shopName, app.email])]
    .some(value => !!value && value.toLocaleLowerCase('en').includes(needle));
}

export function listFromInput(input: CustomerReadInput, options: { status: CustomerFilter; q: string; sort: CustomerSort; cursor: Cursor | null; limit?: number }, now = new Date()): CustomerListResponse {
  const limit = options.limit ?? CUSTOMER_PAGE_SIZE;
  const all = buildCustomerRows(input, now).filter(row => searchMatches(row, input, options.q));
  const counts = { all: all.length, needs_action: 0, applied: 0, in_review: 0, approved: 0, suspended: 0, revoked: 0, former: 0, prospect: 0 } as CustomerCounts;
  for (const row of all) {
    if (row.needsAction) counts.needs_action++;
    for (const status of Array.from(new Set(row.locations.map(chip => chip.status)))) counts[status]++;
  }
  const sortKeyOf = (row: CustomerListRow) => customerSortKey({ name: row.name, chefId: row.chefId, needsAction: row.needsAction,
    deadlineAt: row.next.deadlineAt, nextBookingAt: row.nextBooking?.startsAt ?? null }, options.sort);
  const keyed = all.filter(row => customerMatchesFilter(options.status, row.locations, row.needsAction))
    .map(row => ({ row, key: sortKeyOf(row) })).sort((a, b) => compareCustomerKeys(a.key, b.key));
  const start = options.cursor ? keyed.findIndex(item => compareCustomerKeys(item.key, options.cursor!.key) > 0) : 0;
  const page = start < 0 ? [] : keyed.slice(start, start + limit);
  const hasMore = start >= 0 && start + limit < keyed.length;
  return { customers: page.map(item => item.row), counts, locations: input.locations.map(({ id, name, timezone }) => ({ id, name, timezone })),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].key, options.sort) : null };
}

export type Cursor = { key: (number | string)[] };
export function encodeCursor(key: (number | string)[], sort: CustomerSort) {
  return Buffer.from(JSON.stringify({ s: sort, k: key }), 'utf8').toString('base64url');
}
export function decodeCursor(cursor: string | undefined, sort: CustomerSort): Cursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value?.s !== sort || !Array.isArray(value.k) || value.k.length < 2 || value.k.length > 6
      || !value.k.every((part: unknown) => typeof part === 'string' || typeof part === 'number' && Number.isFinite(part))) throw new Error('bad cursor');
    return { key: value.k };
  } catch { throw new DomainError('INVALID_CURSOR', 'That page of customers is no longer available. Reload the list.', 400); }
}

/* ───────────────────────────── loaders (a fixed number of queries, never per customer) ───────────────────────────── */

export async function managerLocations(managerId: number, locationId?: number): Promise<RawLocation[]> {
  const rows = await db.select({ id: locations.id, name: locations.name, timezone: locations.timezone }).from(locations)
    .where(and(eq(locations.managerId, managerId), locationId ? eq(locations.id, locationId) : isNull(locations.archivedAt))).orderBy(asc(locations.name));
  // A location that is not this manager's looks exactly like one that does not exist.
  if (locationId && rows.length === 0) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404);
  return rows.map(row => ({ ...row, timezone: row.timezone || DEFAULT_TIMEZONE }));
}

const OPEN_CLAIM_STATUSES = ['resolved', 'rejected', 'expired', 'charge_succeeded'] as const;

export async function loadCustomerReadInput(managerId: number, locationId: number | undefined, now = new Date(), onlyChefId?: number): Promise<CustomerReadInput> {
  const scope = await managerLocations(managerId, locationId);
  const ids = scope.map(location => location.id);
  const empty: CustomerReadInput = { locations: scope, applications: [], access: [], tours: [], tourFeedbackDone: new Set(), bookings: [], bookingStats: [],
    problems: [], claims: [], renewalApplicationIds: new Set(), people: [], responseBufferHours: 1, inspectionAutoCloseHours: 24 };
  if (!ids.length) return empty;
  const recent = new Date(now.getTime() - 3 * 24 * 3_600_000);
  const only = (column: Parameters<typeof eq>[0]) => onlyChefId ? eq(column, onlyChefId) : undefined;
  const [appRows, accessRows, tourRows, bookingRows, statRows, problemRows, claimRows, renewalRows, lifecycle, requirementsEntries] = await Promise.all([
    db.select({ id: chefKitchenApplications.id, chefId: chefKitchenApplications.chefId, locationId: chefKitchenApplications.locationId,
      fullName: chefKitchenApplications.fullName, shopName: chefKitchenApplications.shopName, email: chefKitchenApplications.email,
      status: chefKitchenApplications.status, currentTier: chefKitchenApplications.current_tier, tier2CompletedAt: chefKitchenApplications.tier2_completed_at,
      accessEnded: sql<boolean>`coalesce(${chefKitchenApplications.feedback} LIKE ${accessEndedMarker + '%'}, false)`,
      createdAt: chefKitchenApplications.createdAt, updatedAt: chefKitchenApplications.updatedAt,
      foodSafetyLicenseUrl: chefKitchenApplications.foodSafetyLicenseUrl, foodSafetyLicenseStatus: chefKitchenApplications.foodSafetyLicenseStatus,
      foodSafetyLicenseExpiry: chefKitchenApplications.foodSafetyLicenseExpiry, foodEstablishmentCertUrl: chefKitchenApplications.foodEstablishmentCertUrl,
      foodEstablishmentCertStatus: chefKitchenApplications.foodEstablishmentCertStatus, foodEstablishmentCertExpiry: chefKitchenApplications.foodEstablishmentCertExpiry,
      insuranceUrl: chefKitchenApplications.insuranceUrl, insuranceStatus: chefKitchenApplications.insuranceStatus, insuranceExpiry: chefKitchenApplications.insuranceExpiry,
      documentsWaivedAt: chefKitchenApplications.documentsWaivedAt, tier_data: chefKitchenApplications.tier_data })
      .from(chefKitchenApplications).where(and(inArray(chefKitchenApplications.locationId, ids), only(chefKitchenApplications.chefId))),
    db.select({ chefId: chefLocationAccess.chefId, locationId: chefLocationAccess.locationId, grantedAt: chefLocationAccess.grantedAt })
      .from(chefLocationAccess).where(and(inArray(chefLocationAccess.locationId, ids), only(chefLocationAccess.chefId))),
    db.select({ id: kitchenViewings.id, chefId: kitchenViewings.chefId, locationId: kitchenViewings.locationId, status: kitchenViewings.status,
      scheduledAt: kitchenViewings.scheduledAt, durationMinutes: kitchenViewings.durationMinutes, appointmentRevision: kitchenViewings.appointmentRevision,
      lifecycleState: kitchenViewings.lifecycleState, visitResult: kitchenViewings.visitResult, disruptionReason: kitchenViewings.disruptionReason,
      confirmationVerified: kitchenViewings.confirmationVerified, confirmedAt: kitchenViewings.confirmedAt, requestExpiredAt: kitchenViewings.requestExpiredAt,
      checkedInAt: kitchenViewings.checkedInAt, createdAt: kitchenViewings.createdAt, updatedAt: kitchenViewings.updatedAt, adminReviewedAt: kitchenViewings.adminReviewedAt,
      adminReviewDecision: kitchenViewings.adminReviewDecision, cancelledBy: kitchenViewings.cancelledBy,
      rescheduleProposedAt: kitchenViewings.rescheduleProposedAt, rescheduleProposedSlots: kitchenViewings.rescheduleProposedSlots,
      requestedRescheduleAt: kitchenViewings.requestedRescheduleAt, rescheduleRequestedAt: kitchenViewings.rescheduleRequestedAt })
      .from(kitchenViewings).where(and(inArray(kitchenViewings.locationId, ids), ne(kitchenViewings.status, 'pending_local_cooks'), only(kitchenViewings.chefId))),
    db.select({ id: kitchenBookings.id, chefId: kitchenBookings.chefId, locationId: kitchens.locationId, kitchenId: kitchenBookings.kitchenId, kitchenName: kitchens.name,
      status: kitchenBookings.status, bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime,
      operatingWindowStartTime: kitchenBookings.operatingWindowStartTime, selectedSlots: kitchenBookings.selectedSlots, visitDuties: kitchenBookings.visitDuties,
      checkinStatus: kitchenBookings.checkinStatus, checkoutRequestedAt: kitchenBookings.checkoutRequestedAt,
      paymentDecisionState: sql<string | null>`${kitchenBookings.paymentDecision}->>'state'`, createdAt: kitchenBookings.createdAt, updatedAt: kitchenBookings.updatedAt,
      cancellationPolicySnapshot: kitchenBookings.cancellationPolicySnapshot, cancellationPolicyHours: kitchenBookings.cancellationPolicyHours })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(inArray(kitchens.locationId, ids), sql`${kitchenBookings.chefId} IS NOT NULL`, only(kitchenBookings.chefId), or(
        inArray(kitchenBookings.status, ['pending', 'cancellation_requested']),
        and(eq(kitchenBookings.status, 'confirmed'), or(gte(kitchenBookings.bookingDate, recent), eq(kitchenBookings.checkinStatus, 'checkout_requested'))),
        sql`${kitchenBookings.paymentDecision}->>'state' = 'pending'`))),
    db.select({ chefId: kitchenBookings.chefId, locationId: kitchens.locationId, count: sql<number>`count(*)::int`, lastActivityAt: sql<Date | null>`max(${kitchenBookings.updatedAt})` })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(and(inArray(kitchens.locationId, ids), sql`${kitchenBookings.chefId} IS NOT NULL`, only(kitchenBookings.chefId))).groupBy(kitchenBookings.chefId, kitchens.locationId),
    db.select({ owner: commitmentProblems.owner, bookingId: commitmentProblems.bookingId, viewingId: commitmentProblems.viewingId,
      bookingChefId: kitchenBookings.chefId, bookingLocationId: kitchens.locationId, tourChefId: kitchenViewings.chefId, tourLocationId: kitchenViewings.locationId })
      .from(commitmentProblems)
      .leftJoin(kitchenBookings, eq(kitchenBookings.id, commitmentProblems.bookingId)).leftJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .leftJoin(kitchenViewings, eq(kitchenViewings.id, commitmentProblems.viewingId))
      .where(and(ne(commitmentProblems.status, 'resolved'), or(inArray(kitchens.locationId, ids), inArray(kitchenViewings.locationId, ids)),
        onlyChefId ? or(eq(kitchenBookings.chefId, onlyChefId), eq(kitchenViewings.chefId, onlyChefId)) : undefined)),
    db.select({ chefId: damageClaims.chefId, locationId: damageClaims.locationId, status: damageClaims.status }).from(damageClaims)
      .where(and(inArray(damageClaims.locationId, ids), only(damageClaims.chefId), notInArray(damageClaims.status, [...OPEN_CLAIM_STATUSES]))),
    db.select({ applicationId: chefDocumentRenewals.applicationId }).from(chefDocumentRenewals)
      .innerJoin(chefKitchenApplications, eq(chefKitchenApplications.id, chefDocumentRenewals.applicationId))
      .where(and(eq(chefDocumentRenewals.status, 'pending'), inArray(chefKitchenApplications.locationId, ids), only(chefKitchenApplications.chefId))),
    getLifecycleSettings(),
    Promise.all(ids.map(async id => [id, await locationService.getLocationRequirementsWithDefaults(id)] as const)),
  ]);
  const requirements = new Map(requirementsEntries);
  const visibleTours = tourRows.filter(managerVisibleTour).map(({ adminReviewDecision: _decision, cancelledBy: _cancelledBy, ...tour }) => tour) as RawTour[];
  const candidateTours = visibleTours.filter(tour => tour.status === 'confirmed' && tour.scheduledAt.getTime() + tour.durationMinutes * 60_000 <= now.getTime()).map(tour => tour.id);
  const feedbackRows = candidateTours.length ? await db.select({ viewingId: tourFeedbackResponses.viewingId }).from(tourFeedbackResponses)
    .where(and(inArray(tourFeedbackResponses.viewingId, candidateTours), eq(tourFeedbackResponses.respondentRole, 'manager'), eq(tourFeedbackResponses.respondentId, managerId))) : [];
  const applicationsRaw: RawApplication[] = appRows.map(row => ({
    id: row.id, chefId: row.chefId, locationId: row.locationId, fullName: row.fullName, shopName: row.shopName, email: row.email, status: row.status,
    currentTier: row.currentTier, tier2CompletedAt: row.tier2CompletedAt, accessEnded: !!row.accessEnded, createdAt: row.createdAt, updatedAt: row.updatedAt,
    addedByKitchen: !!(row.tier_data as { addedByKitchen?: boolean } | null)?.addedByKitchen,
    documents: row.status === 'approved' && row.currentTier >= 3 ? requiredAccessDocuments({ status: row.status, currentTier: row.currentTier,
      foodSafetyLicenseUrl: row.foodSafetyLicenseUrl, foodSafetyLicenseStatus: row.foodSafetyLicenseStatus, foodSafetyLicenseExpiry: row.foodSafetyLicenseExpiry,
      foodEstablishmentCertUrl: row.foodEstablishmentCertUrl, foodEstablishmentCertStatus: row.foodEstablishmentCertStatus, foodEstablishmentCertExpiry: row.foodEstablishmentCertExpiry,
      insuranceUrl: row.insuranceUrl, insuranceStatus: row.insuranceStatus, insuranceExpiry: row.insuranceExpiry, documentsWaivedAt: row.documentsWaivedAt, tier_data: row.tier_data },
      requirements.get(row.locationId) ?? {}).map(({ key, label, expiry }) => ({ key, label, expiry: expiry ?? null })) : [],
  }));
  const bookings: RawBooking[] = bookingRows.filter(row => row.chefId != null).map(row => ({ ...row, chefId: row.chefId! }));
  const problems: RawProblem[] = problemRows.flatMap(row => {
    const chefId = row.bookingChefId ?? row.tourChefId, locationId = row.bookingLocationId ?? row.tourLocationId;
    return chefId != null && locationId != null ? [{ chefId, locationId, owner: row.owner, bookingId: row.bookingId, viewingId: row.viewingId }] : [];
  });
  const stats: RawBookingStat[] = statRows.filter(row => row.chefId != null).map(row => ({ chefId: row.chefId!, locationId: row.locationId, count: row.count,
    lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt) : null }));
  const chefIds = Array.from(new Set([...applicationsRaw.map(row => row.chefId), ...accessRows.map(row => row.chefId), ...visibleTours.map(row => row.chefId),
    ...bookings.map(row => row.chefId), ...stats.map(row => row.chefId)]));
  const [userRows, platformRows] = chefIds.length ? await Promise.all([
    db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, chefIds)),
    db.select({ userId: applications.userId, fullName: applications.fullName }).from(applications).where(inArray(applications.userId, chefIds)).orderBy(desc(applications.createdAt)),
  ]) : [[], []];
  const platformName = new Map<number, string>();
  for (const row of platformRows) if (row.userId != null && row.fullName && !platformName.has(row.userId)) platformName.set(row.userId, row.fullName);
  return {
    ...empty, applications: applicationsRaw, access: accessRows, tours: visibleTours, tourFeedbackDone: new Set(feedbackRows.map(row => row.viewingId)),
    bookings, bookingStats: stats, problems, claims: claimRows.map(row => ({ chefId: row.chefId, locationId: row.locationId, status: row.status })),
    renewalApplicationIds: new Set(renewalRows.map(row => row.applicationId)),
    people: userRows.map(row => ({ id: row.id, username: row.username, platformName: platformName.get(row.id) ?? null })),
    responseBufferHours: lifecycle.managerResponseBufferHours, inspectionAutoCloseHours: lifecycle.inspectionAutoCloseHours,
  };
}

export async function listManagerCustomers(managerId: number, options: { locationId?: number; status: CustomerFilter; q: string; sort: CustomerSort; cursor?: string }, now = new Date()) {
  const cursor = decodeCursor(options.cursor, options.sort);
  const input = await loadCustomerReadInput(managerId, options.locationId, now);
  return listFromInput(input, { status: options.status, q: options.q, sort: options.sort, cursor }, now);
}

/* ───────────────────────────── private notes ───────────────────────────── */

export type CustomerNoteDto = { id: number; body: string; authorId: number | null; authorName: string | null; mine: boolean; createdAt: string; updatedAt: string; edited: boolean };

/** Notes belong to the location: only its manager can read or write them, and never the customer. */
export async function assertManagerOwnsLocation(managerId: number, locationId: number) {
  const [location] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, managerId))).limit(1);
  if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404);
}

function noteBody(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('NOTE_REQUIRED', 'Write a note first.', 400);
  const body = value.trim();
  if (body.length > NOTE_MAX_LENGTH) throw new DomainError('NOTE_TOO_LONG', `Notes can be up to ${NOTE_MAX_LENGTH.toLocaleString('en-CA')} characters.`, 400);
  return body;
}

export async function listCustomerNotes(managerId: number, chefId: number, locationId: number): Promise<CustomerNoteDto[]> {
  await assertManagerOwnsLocation(managerId, locationId);
  const rows = await db.select({ id: customerNotes.id, body: customerNotes.body, authorId: customerNotes.authorId, createdAt: customerNotes.createdAt, updatedAt: customerNotes.updatedAt })
    .from(customerNotes).where(and(eq(customerNotes.locationId, locationId), eq(customerNotes.chefId, chefId), isNull(customerNotes.deletedAt)))
    .orderBy(desc(customerNotes.createdAt), desc(customerNotes.id)).limit(200);
  const authorIds = Array.from(new Set(rows.flatMap(row => row.authorId != null ? [row.authorId] : [])));
  const authors = authorIds.length ? await db.select({ id: users.id, username: users.username, profile: users.managerProfileData }).from(users).where(inArray(users.id, authorIds)) : [];
  const nameOf = new Map(authors.map(author => {
    const profile = (author.profile ?? {}) as { fullName?: string; displayName?: string };
    return [author.id, profile.fullName || profile.displayName || localPart(author.username)] as const;
  }));
  return rows.map(row => ({ id: row.id, body: row.body, authorId: row.authorId, authorName: row.authorId != null ? nameOf.get(row.authorId) ?? null : null,
    mine: row.authorId === managerId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    edited: row.updatedAt.getTime() - row.createdAt.getTime() > 1000 }));
}

async function requireRelationship(chefId: number, locationId: number) {
  const [app] = await db.select({ id: chefKitchenApplications.id }).from(chefKitchenApplications).where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1);
  if (app) return;
  const [tour] = await db.select({ id: kitchenViewings.id }).from(kitchenViewings).where(and(eq(kitchenViewings.chefId, chefId), eq(kitchenViewings.locationId, locationId))).limit(1);
  if (tour) return;
  const [booking] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId))).limit(1);
  if (booking) return;
  const [access] = await db.select({ id: chefLocationAccess.id }).from(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, chefId), eq(chefLocationAccess.locationId, locationId))).limit(1);
  if (!access) throw new DomainError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
}

export async function createCustomerNote(managerId: number, chefId: number, locationId: number, body: unknown) {
  await assertManagerOwnsLocation(managerId, locationId);
  const text = noteBody(body);
  await requireRelationship(chefId, locationId);
  const [row] = await db.insert(customerNotes).values({ locationId, chefId, authorId: managerId, body: text }).returning({ id: customerNotes.id });
  return row;
}

async function ownNote(managerId: number, chefId: number, locationId: number, noteId: number) {
  await assertManagerOwnsLocation(managerId, locationId);
  const [note] = await db.select({ id: customerNotes.id, authorId: customerNotes.authorId }).from(customerNotes)
    .where(and(eq(customerNotes.id, noteId), eq(customerNotes.locationId, locationId), eq(customerNotes.chefId, chefId), isNull(customerNotes.deletedAt))).limit(1);
  if (!note) throw new DomainError('NOTE_NOT_FOUND', 'Note not found', 404);
  if (note.authorId !== managerId) throw new DomainError('NOTE_NOT_YOURS', 'You can only change notes you wrote.', 403);
}

export async function updateCustomerNote(managerId: number, chefId: number, locationId: number, noteId: number, body: unknown) {
  const text = noteBody(body);
  await ownNote(managerId, chefId, locationId, noteId);
  await db.update(customerNotes).set({ body: text, updatedAt: new Date() }).where(and(eq(customerNotes.id, noteId), isNull(customerNotes.deletedAt)));
}

export async function deleteCustomerNote(managerId: number, chefId: number, locationId: number, noteId: number) {
  await ownNote(managerId, chefId, locationId, noteId);
  await db.update(customerNotes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(customerNotes.id, noteId), isNull(customerNotes.deletedAt)));
}
