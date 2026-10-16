import { accessDocumentDaysLeft } from './location-booking-eligibility';
import { DEFAULT_TIMEZONE } from './timezone-utils';

/**
 * One relationship = one person at one location. This module is the ONLY place that decides a relationship's status,
 * its single next action, whose turn it is and how rows sort, so the list and the customer page never disagree.
 * Pure: no database, no clock (callers pass `now`), the location's timezone is explicit.
 */

export type CustomerStatus = 'applied' | 'in_review' | 'approved' | 'suspended' | 'revoked' | 'former' | 'prospect';
export const customerStatuses: CustomerStatus[] = ['applied', 'in_review', 'approved', 'suspended', 'revoked', 'former', 'prospect'];
export type CustomerFilter = 'all' | 'needs_action' | CustomerStatus;
export const customerFilters: CustomerFilter[] = ['all', 'needs_action', 'applied', 'in_review', 'approved', 'suspended', 'revoked', 'former', 'prospect'];
export type CustomerSort = 'needs_action' | 'deadline' | 'next_booking' | 'name';
export const customerSorts: CustomerSort[] = ['needs_action', 'deadline', 'next_booking', 'name'];

export type CustomerOwner = 'you' | 'customer' | 'local_cooks' | 'nobody';
export type CustomerActionCode =
  | 'problem' | 'booking_request' | 'inspection' | 'payment_recovery' | 'documents_review' | 'cancellation_request'
  | 'tour_request' | 'tour_reschedule' | 'tour_feedback' | 'document_expired' | 'document_expiring'
  | 'waiting_documents' | 'local_cooks_review' | 'next_booking' | 'none';
export type CustomerTarget =
  | { kind: 'booking'; id: number } | { kind: 'inspection'; id: number } | { kind: 'application'; id: number } | { kind: 'tour'; id: number };

export type CustomerApplicationFacts = {
  id: number;
  status: 'inReview' | 'approved' | 'rejected' | 'cancelled';
  currentTier: number;
  /** Set when the person has submitted their step-2 documents. */
  tier2CompletedAt: string | null;
  /** The application carries the "Access ended by manager" marker written by the atomic revoke. */
  accessEnded: boolean;
};

export type CustomerRelationshipFacts = {
  application: CustomerApplicationFacts | null;
  hasAccess: boolean;
  hasTour: boolean;
  hasBooking: boolean;
  /** Required documents (with expiry) of an approved application. */
  documents: { key: string; label: string; expiry: string | null }[];
  /** A renewed document waits for review. */
  renewalPending: boolean;
  problem: { owner: 'you' | 'local_cooks'; bookingId: number | null; viewingId: number | null } | null;
  bookingRequest: { bookingId: number; deadlineAt: string | null } | null;
  inspection: { bookingId: number; deadlineAt: string | null } | null;
  paymentRecovery: { bookingId: number } | null;
  cancellationRequest: { bookingId: number } | null;
  tour: { viewingId: number; kind: 'request' | 'reschedule' | 'feedback'; deadlineAt: string | null } | null;
  nextBooking: { bookingId: number; startsAt: string; endsAt: string; kitchenName: string } | null;
};

export type CustomerNextAction = {
  code: CustomerActionCode;
  /** B1 priority, 1 (most urgent) to 11 (informational). */
  rank: number;
  owner: CustomerOwner;
  deadlineAt: string | null;
  /** Days until the nearest required document expires (negative when already expired). */
  documentDays: number | null;
  documentKey: string | null;
  target: CustomerTarget | null;
  needsAction: boolean;
};

const DAY_MS = 24 * 3_600_000;

export function deriveCustomerStatus(facts: CustomerRelationshipFacts): CustomerStatus {
  const app = facts.application;
  if (app && app.status === 'approved' && app.currentTier >= 3 && app.accessEnded && !facts.hasAccess) return 'revoked';
  if (facts.hasAccess) return 'approved';
  if (app) {
    if (app.status === 'rejected' || app.status === 'cancelled') return 'former';
    if (app.status === 'approved' && app.currentTier >= 3) return 'approved';
    if (app.status === 'approved' && app.currentTier === 2 && app.tier2CompletedAt) return 'in_review';
    return 'applied';
  }
  return facts.hasTour ? 'prospect' : 'former';
}

const action = (code: CustomerActionCode, rank: number, owner: CustomerOwner,
  extra: Partial<Pick<CustomerNextAction, 'deadlineAt' | 'documentDays' | 'documentKey' | 'target'>> = {}): Omit<CustomerNextAction, 'needsAction'> =>
  ({ code, rank, owner, deadlineAt: extra.deadlineAt ?? null, documentDays: extra.documentDays ?? null, documentKey: extra.documentKey ?? null, target: extra.target ?? null });

/** The B1 priority list, first match wins. */
export function customerNextAction(facts: CustomerRelationshipFacts, status: CustomerStatus, timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): CustomerNextAction {
  const app = facts.application;
  const chosen = ((): Omit<CustomerNextAction, 'needsAction'> => {
    if (facts.problem) return action('problem', 1, facts.problem.owner === 'you' ? 'you' : 'local_cooks', {
      target: facts.problem.bookingId ? { kind: 'booking', id: facts.problem.bookingId } : facts.problem.viewingId ? { kind: 'tour', id: facts.problem.viewingId } : null });
    if (facts.bookingRequest) return action('booking_request', 2, 'you', { deadlineAt: facts.bookingRequest.deadlineAt, target: { kind: 'booking', id: facts.bookingRequest.bookingId } });
    if (facts.inspection) return action('inspection', 3, 'you', { deadlineAt: facts.inspection.deadlineAt, target: { kind: 'inspection', id: facts.inspection.bookingId } });
    if (facts.paymentRecovery) return action('payment_recovery', 4, 'local_cooks', { target: { kind: 'booking', id: facts.paymentRecovery.bookingId } });
    if (app && (status === 'in_review' || facts.renewalPending && status === 'approved')) return action('documents_review', 5, 'you', { target: { kind: 'application', id: app.id } });
    if (facts.cancellationRequest) return action('cancellation_request', 6, 'you', { target: { kind: 'booking', id: facts.cancellationRequest.bookingId } });
    if (facts.tour) return action(facts.tour.kind === 'request' ? 'tour_request' : facts.tour.kind === 'reschedule' ? 'tour_reschedule' : 'tour_feedback', 7, 'you',
      { deadlineAt: facts.tour.deadlineAt, target: { kind: 'tour', id: facts.tour.viewingId } });
    if (status === 'approved') {
      let nearest: { days: number; key: string } | null = null;
      for (const document of facts.documents) {
        const days = accessDocumentDaysLeft(document.expiry, timezone, now);
        if (days !== null && days <= 30 && (!nearest || days < nearest.days)) nearest = { days, key: document.key };
      }
      if (nearest) return action(nearest.days <= 0 ? 'document_expired' : 'document_expiring', 8, 'customer',
        { documentDays: nearest.days, documentKey: nearest.key, target: app ? { kind: 'application', id: app.id } : null });
    }
    if (status === 'applied' && app && app.status === 'approved') return action('waiting_documents', 9, 'customer', { target: { kind: 'application', id: app.id } });
    if (status === 'applied') return action('local_cooks_review', 10, 'local_cooks', { target: app ? { kind: 'application', id: app.id } : null });
    if (facts.nextBooking) return action('next_booking', 11, 'nobody', { target: { kind: 'booking', id: facts.nextBooking.bookingId } });
    return action('none', 11, 'nobody');
  })();
  const deadline = chosen.deadlineAt ? Date.parse(chosen.deadlineAt) : NaN;
  const dueSoon = Number.isFinite(deadline) && chosen.owner !== 'nobody' && deadline - now.getTime() <= DAY_MS;
  return { ...chosen, needsAction: chosen.owner === 'you' || dueSoon };
}

export type CustomerRelationshipView = { status: CustomerStatus; next: CustomerNextAction };
export function customerRelationshipView(facts: CustomerRelationshipFacts, timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): CustomerRelationshipView {
  const status = deriveCustomerStatus(facts);
  return { status, next: customerNextAction(facts, status, timezone, now) };
}

const NONE = 8.64e15;
const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NONE;
};

/** In "All locations", a person's row shows their most urgent relationship. */
export function moreUrgentRelationship<T extends { next: CustomerNextAction }>(a: T, b: T): T {
  if (a.next.needsAction !== b.next.needsAction) return a.next.needsAction ? a : b;
  const deadlineA = time(a.next.deadlineAt), deadlineB = time(b.next.deadlineAt);
  if (deadlineA !== deadlineB) return deadlineA < deadlineB ? a : b;
  return b.next.rank < a.next.rank ? b : a;
}

export function customerMatchesFilter(filter: CustomerFilter, relationships: { status: CustomerStatus }[], needsAction: boolean) {
  if (filter === 'all') return true;
  if (filter === 'needs_action') return needsAction;
  return relationships.some(relationship => relationship.status === filter);
}

export type CustomerSortInput = { name: string; chefId: number; needsAction: boolean; deadlineAt: string | null; nextBookingAt: string | null };
/** A JSON-safe comparable tuple; it is also the keyset cursor payload. */
export type CustomerSortKey = (number | string)[];
export function customerSortKey(row: CustomerSortInput, sort: CustomerSort): CustomerSortKey {
  const name = row.name.toLocaleLowerCase('en');
  const deadline = time(row.deadlineAt), next = time(row.nextBookingAt);
  switch (sort) {
    case 'deadline': return [deadline, row.needsAction ? 0 : 1, next, name, row.chefId];
    case 'next_booking': return [next, row.needsAction ? 0 : 1, deadline, name, row.chefId];
    case 'name': return [name, row.chefId];
    default: return [row.needsAction ? 0 : 1, deadline, next, name, row.chefId];
  }
}
export function compareCustomerKeys(a: CustomerSortKey, b: CustomerSortKey) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return a.length - b.length;
}
