import { describe, expect, it } from 'vitest';
import {
  compareCustomerKeys, customerMatchesFilter, customerNextAction, customerRelationshipView, customerSortKey, deriveCustomerStatus,
  moreUrgentRelationship, type CustomerApplicationFacts, type CustomerRelationshipFacts,
} from './customer-next-action';

const NOW = new Date('2026-10-16T15:00:00.000Z');
const facts = (overrides: Partial<CustomerRelationshipFacts> = {}): CustomerRelationshipFacts => ({
  application: null, hasAccess: false, hasTour: false, hasBooking: false, documents: [], renewalPending: false, problem: null,
  bookingRequest: null, inspection: null, paymentRecovery: null, cancellationRequest: null, tour: null, nextBooking: null, ...overrides,
});
const app = (overrides: Partial<CustomerApplicationFacts> = {}): CustomerApplicationFacts => ({
  id: 7, status: 'approved', currentTier: 3, tier2CompletedAt: null, accessEnded: false, ...overrides,
});
const approved = (overrides: Partial<CustomerRelationshipFacts> = {}) => facts({ application: app(), hasAccess: true, hasBooking: true, ...overrides });
const view = (f: CustomerRelationshipFacts, timezone = 'America/St_Johns') => customerRelationshipView(f, timezone, NOW);

describe('relationship status (first match wins)', () => {
  it.each([
    ['approved with access', approved(), 'approved'],
    ['approved final tier but no access row and no marker (legacy)', facts({ application: app() }), 'approved'],
    ['access ended by the manager', facts({ application: app({ accessEnded: true }) }), 'revoked'],
    ['access ended marker is ignored once access exists again', approved({ application: app({ accessEnded: true }) }), 'approved'],
    ['documents submitted, waiting for the manager', facts({ application: app({ currentTier: 2, tier2CompletedAt: '2026-10-10T00:00:00Z' }) }), 'in_review'],
    ['approved by Local Cooks, waiting for documents', facts({ application: app({ currentTier: 2 }) }), 'applied'],
    ['approved tier 1', facts({ application: app({ currentTier: 1 }) }), 'applied'],
    ['Local Cooks is reviewing', facts({ application: app({ status: 'inReview', currentTier: 1 }) }), 'applied'],
    ['denied', facts({ application: app({ status: 'rejected', currentTier: 1 }) }), 'former'],
    ['withdrawn', facts({ application: app({ status: 'cancelled', currentTier: 1 }) }), 'former'],
    ['tour only', facts({ hasTour: true }), 'prospect'],
    ['bookings only, no application, no access', facts({ hasBooking: true }), 'former'],
    ['access granted without an application', facts({ hasAccess: true }), 'approved'],
  ] as const)('%s → %s', (_name, input, status) => expect(deriveCustomerStatus(input)).toBe(status));
});

describe('next action: one canonical priority list', () => {
  const documents = (days: number) => [{ key: 'foodSafetyLicense', label: 'Food Safety Certificate',
    expiry: new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10) }];

  it('1. an open problem beats everything and names its owner', () => {
    const next = view(approved({ problem: { owner: 'you', bookingId: 4, viewingId: null }, bookingRequest: { bookingId: 5, deadlineAt: null } })).next;
    expect(next).toMatchObject({ code: 'problem', rank: 1, owner: 'you', needsAction: true, target: { kind: 'booking', id: 4 } });
    expect(view(approved({ problem: { owner: 'local_cooks', bookingId: null, viewingId: 9 } })).next)
      .toMatchObject({ code: 'problem', owner: 'local_cooks', needsAction: false, target: { kind: 'tour', id: 9 } });
  });
  it('2. a booking request awaiting the manager carries its response deadline', () => {
    expect(view(approved({ bookingRequest: { bookingId: 5, deadlineAt: '2026-10-16T21:00:00Z' }, inspection: { bookingId: 6, deadlineAt: null } })).next)
      .toMatchObject({ code: 'booking_request', rank: 2, owner: 'you', deadlineAt: '2026-10-16T21:00:00Z', target: { kind: 'booking', id: 5 } });
  });
  it('3. an inspection opens the inspection page', () => {
    expect(view(approved({ inspection: { bookingId: 6, deadlineAt: '2026-10-17T02:00:00Z' }, paymentRecovery: { bookingId: 8 } })).next)
      .toMatchObject({ code: 'inspection', rank: 3, owner: 'you', target: { kind: 'inspection', id: 6 } });
  });
  it('4. payment recovery is Local Cooks’ turn', () => {
    expect(view(approved({ paymentRecovery: { bookingId: 8 }, cancellationRequest: { bookingId: 3 } })).next)
      .toMatchObject({ code: 'payment_recovery', rank: 4, owner: 'local_cooks', needsAction: false });
  });
  it('5. submitted documents are the manager’s to review, and so are renewals on an approved customer', () => {
    expect(view(facts({ application: app({ currentTier: 2, tier2CompletedAt: '2026-10-10T00:00:00Z' }) })).next)
      .toMatchObject({ code: 'documents_review', rank: 5, owner: 'you', target: { kind: 'application', id: 7 } });
    expect(view(approved({ renewalPending: true })).next).toMatchObject({ code: 'documents_review', owner: 'you' });
  });
  it('6. a cancellation request', () => {
    expect(view(approved({ cancellationRequest: { bookingId: 3 }, tour: { viewingId: 2, kind: 'request', deadlineAt: null } })).next)
      .toMatchObject({ code: 'cancellation_request', rank: 6, owner: 'you', target: { kind: 'booking', id: 3 } });
  });
  it.each([['request', 'tour_request'], ['reschedule', 'tour_reschedule'], ['feedback', 'tour_feedback']] as const)('7. tour %s', (kind, code) => {
    expect(view(approved({ tour: { viewingId: 2, kind, deadlineAt: null } })).next).toMatchObject({ code, rank: 7, owner: 'you', target: { kind: 'tour', id: 2 } });
  });
  it('8. a required document expiring within 30 days is the customer’s turn, not the manager’s', () => {
    const next = view(approved({ documents: documents(6) })).next;
    expect(next).toMatchObject({ code: 'document_expiring', rank: 8, owner: 'customer', documentDays: 6, needsAction: false });
    expect(view(approved({ documents: documents(31) })).next.code).toBe('none');
  });
  it('8. an expired document says so; the nearest document wins', () => {
    const next = view(approved({ documents: [...documents(20), { key: 'foodEstablishmentCert', label: 'Food Establishment Licence', expiry: '2020-01-01' }] })).next;
    expect(next).toMatchObject({ code: 'document_expired', documentKey: 'foodEstablishmentCert', owner: 'customer' });
    expect(next.documentDays!).toBeLessThanOrEqual(0);
  });
  it('8. the expiry is judged on the location’s calendar day', () => {
    // 2026-10-17 00:30 Newfoundland is still 16 Oct 22:00 UTC… an expiry of 16 Oct is "today" there, so it has expired.
    const late = new Date('2026-10-16T05:00:00Z'); // 02:30 on 16 Oct in St John's
    const next = customerNextAction(approved({ documents: [{ key: 'k', label: 'L', expiry: '2026-10-16' }] }), 'approved', 'America/St_Johns', late);
    expect(next.code).toBe('document_expired');
  });
  it('9. waiting for the customer’s documents', () => {
    expect(view(facts({ application: app({ currentTier: 2 }) })).next).toMatchObject({ code: 'waiting_documents', rank: 9, owner: 'customer' });
  });
  it('10. Local Cooks is reviewing', () => {
    expect(view(facts({ application: app({ status: 'inReview', currentTier: 1 }) })).next).toMatchObject({ code: 'local_cooks_review', rank: 10, owner: 'local_cooks' });
  });
  it('11. otherwise informational', () => {
    const nextBooking = { bookingId: 12, startsAt: '2026-10-20T13:00:00Z', endsAt: '2026-10-20T15:00:00Z', kitchenName: 'Main' };
    expect(view(approved({ nextBooking })).next).toMatchObject({ code: 'next_booking', rank: 11, owner: 'nobody', needsAction: false });
    expect(view(approved()).next).toMatchObject({ code: 'none', owner: 'nobody', needsAction: false });
    expect(view(facts({ application: app({ status: 'rejected', currentTier: 1 }) })).next.code).toBe('none');
  });
  it('a document warning only applies to someone who can currently book', () => {
    expect(view(facts({ application: app({ accessEnded: true }), documents: documents(2) })).next.code).toBe('none');
  });
  it('a deadline inside 24 hours needs action even when it is not the manager’s turn', () => {
    const soon = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(customerNextAction(approved({ paymentRecovery: { bookingId: 8 } }), 'approved', 'UTC', NOW).needsAction).toBe(false);
    expect(view(approved({ inspection: { bookingId: 6, deadlineAt: soon } })).next.needsAction).toBe(true);
  });
});

describe('filters, urgency and sorting', () => {
  const rel = (status: Parameters<typeof customerMatchesFilter>[1][number]['status']) => ({ status });
  it('matches filters by any relationship; needs_action is separate from status', () => {
    expect(customerMatchesFilter('all', [], false)).toBe(true);
    expect(customerMatchesFilter('approved', [rel('in_review'), rel('approved')], false)).toBe(true);
    expect(customerMatchesFilter('revoked', [rel('approved')], true)).toBe(false);
    expect(customerMatchesFilter('needs_action', [rel('former')], true)).toBe(true);
    expect(customerMatchesFilter('needs_action', [rel('approved')], false)).toBe(false);
  });
  it('in All locations the most urgent relationship represents the person', () => {
    const calm = view(approved());
    const urgent = view(approved({ bookingRequest: { bookingId: 1, deadlineAt: '2026-10-16T20:00:00Z' } }));
    const later = view(approved({ bookingRequest: { bookingId: 2, deadlineAt: '2026-10-18T20:00:00Z' } }));
    expect(moreUrgentRelationship(calm, urgent)).toBe(urgent);
    expect(moreUrgentRelationship(later, urgent)).toBe(urgent);
    expect(moreUrgentRelationship(urgent, calm)).toBe(urgent);
  });
  const base = { name: 'Ana', chefId: 1, needsAction: false, deadlineAt: null, nextBookingAt: null };
  it('default sort puts needs-action first, then soonest deadline, soonest booking, name', () => {
    const rows = [
      { ...base, name: 'Zed', chefId: 1 },
      { ...base, name: 'Amy', chefId: 2, nextBookingAt: '2026-10-20T00:00:00Z' },
      { ...base, name: 'Bo', chefId: 3, needsAction: true, deadlineAt: '2026-10-18T00:00:00Z' },
      { ...base, name: 'Cy', chefId: 4, needsAction: true, deadlineAt: '2026-10-17T00:00:00Z' },
      { ...base, name: 'Dee', chefId: 5, nextBookingAt: '2026-10-19T00:00:00Z' },
    ];
    const order = (sort: Parameters<typeof customerSortKey>[1]) => rows.map(row => ({ row, key: customerSortKey(row, sort) }))
      .sort((a, b) => compareCustomerKeys(a.key, b.key)).map(item => item.row.name);
    expect(order('needs_action')).toEqual(['Cy', 'Bo', 'Dee', 'Amy', 'Zed']);
    expect(order('deadline')).toEqual(['Cy', 'Bo', 'Dee', 'Amy', 'Zed']);
    expect(order('next_booking')).toEqual(['Dee', 'Amy', 'Cy', 'Bo', 'Zed']);
    expect(order('name')).toEqual(['Amy', 'Bo', 'Cy', 'Dee', 'Zed']);
  });
  it('sort keys are JSON-safe so they can be a keyset cursor', () => {
    const key = customerSortKey(base, 'needs_action');
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);
    expect(compareCustomerKeys(key, key)).toBe(0);
  });
});
