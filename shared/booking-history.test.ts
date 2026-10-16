import { describe, expect, it } from 'vitest';
import { buildBookingHistory } from './booking-history';

describe('public booking history from recorded evidence', () => {
  it('orders recorded events and omits internal messages, actors and payment identifiers', () => {
    const history = buildBookingHistory({ createdAt: '2026-10-01T12:00:00Z' }, [
      { id: 2, kind: 'confirmed', createdAt: '2026-10-02T12:00:00Z', metadata: { intentId: 'private-payment', actorId: 99, internalNotes: 'Internal review' } },
      { id: 1, kind: 'requested', createdAt: '2026-10-01T12:00:00Z' },
      { id: 3, kind: 'item_withdrawn', createdAt: '2026-10-03T12:00:00Z', metadata: { itemKind: 'equipment', itemId: 8 } },
      { id: 4, kind: 'internal_assignment', createdAt: '2026-10-04T12:00:00Z' },
    ]);
    expect(history.complete).toBe(true);
    expect(history.events.map(event => event.kind)).toEqual(['requested', 'confirmed', 'item_withdrawn']);
    expect(history.events[2]).toMatchObject({ itemKind: 'equipment', itemId: 8 });
    expect(JSON.stringify(history)).not.toMatch(/private-payment|actorId|internalNotes|Internal review/);
  });
  it('marks legacy history partial and uses actual timestamps without fabricating a confirmation', () => {
    const history = buildBookingHistory({ createdAt: '2026-10-01T12:00:00Z', cancellationRequestedAt: '2026-10-04T12:00:00Z', cancellationRequestDeclinedAt: 'invalid' }, []);
    expect(history.complete).toBe(false);
    expect(history.events.map(event => event.kind)).toEqual(['requested', 'cancellation_requested']);
    expect(history.events[0].visitId).toBeUndefined();
  });
  it('identifies an accepted add-on cancellation without exposing its payment quote', () => {
    const history = buildBookingHistory({}, [{ id: 1, kind: 'cancellation_reviewed', createdAt: '2026-10-04T12:00:00Z',
      metadata: { quote: { scope: { kind: 'storage', id: 6 }, managerId: 2, sources: [{ intentId: 'private-intent' }] } } }]);
    expect(history.events[0]).toMatchObject({ kind: 'cancellation_reviewed', itemKind: 'storage', itemId: 6 });
    expect(JSON.stringify(history)).not.toMatch(/managerId|private-intent|sources|quote/);
  });
  it('adds extra-time events from the extensions table without payment identifiers', () => {
    const history = buildBookingHistory({ createdAt: '2026-10-01T12:00:00Z' }, [], [], [
      { id: 1, kind: 'request', status: 'paid', minutes: 30, amountCents: 1500, createdAt: '2026-10-02T12:00:00Z', authorizedAt: '2026-10-02T12:05:00Z', paidAt: '2026-10-02T12:06:00Z', refundedAt: '2026-10-03T12:00:00Z' },
      { id: 2, kind: 'offer', status: 'declined', minutes: 60, amountCents: 3000, createdAt: '2026-10-02T13:00:00Z', updatedAt: '2026-10-02T13:10:00Z' },
      { id: 3, kind: 'request', status: 'paid', minutes: 30, amountCents: 1500, autoApprove: true, createdAt: '2026-10-04T12:00:00Z', paidAt: '2026-10-04T12:01:00Z' },
    ]);
    expect(history.events.map(event => event.kind)).toEqual(['requested', 'ext_requested', 'ext_approved', 'ext_paid', 'ext_offered', 'ext_declined', 'ext_refunded', 'ext_requested', 'ext_paid']);
    expect(history.events.find(event => event.key === 'ext-1-ext_paid')).toMatchObject({ amountCents: 1500, extFlow: 'ask', minutes: 30 });
    expect(JSON.stringify(history)).not.toMatch(/intent|checkout|customerId|returnUrl/);
  });
  it('retains separate visits and avoids duplicating check-in evidence already in the ledger', () => {
    const history = buildBookingHistory({}, [
      { id: 1, kind: 'checkin_recorded', createdAt: '2026-10-02T12:01:00Z', metadata: { visitId: 7 } },
    ], [
      { id: 7, checkedInAt: '2026-10-02T12:00:00Z' },
      { id: 8, checkedInAt: '2026-10-02T15:00:00Z', checkoutRequestedAt: '2026-10-02T17:00:00Z' },
    ]);
    expect(history.events.map(event => [event.kind, event.visitId])).toEqual([
      ['checkin_recorded', 7], ['checkin_recorded', 8], ['checkout_requested', 8],
    ]);
  });
});

describe('same-instant ordering', () => {
  it('puts requested before confirmed when they share a timestamp', () => {
    const history = buildBookingHistory({}, [
      { id: 1, kind: 'confirmed', createdAt: '2026-10-02T12:00:00Z' },
      { id: 2, kind: 'requested', createdAt: '2026-10-02T12:00:00Z' },
    ]);
    expect(history.events.map(event => event.kind)).toEqual(['requested', 'confirmed']);
  });
});

describe('Local Cooks goodwill in the history', () => {
  it('shows the refunded amount without payment identifiers, and drops one with no amount', () => {
    const history = buildBookingHistory({}, [
      { id: 1, kind: 'requested', createdAt: '2026-10-01T12:00:00Z' },
      { id: 5, key: 'payment-5', kind: 'goodwill_refunded', createdAt: '2026-10-14T12:00:00Z', metadata: { amountCents: 2600, refundId: 're_private', operationKey: 'k' } },
      { id: 6, key: 'payment-6', kind: 'goodwill_refunded', createdAt: '2026-10-14T13:00:00Z', metadata: {} },
    ]);
    expect(history.events.map(event => [event.key, event.kind, event.amountCents])).toEqual([
      ['event-1', 'requested', undefined], ['payment-5', 'goodwill_refunded', 2600]]);
    expect(JSON.stringify(history)).not.toMatch(/re_private|operationKey/);
  });
  it('shows the booking on the other side of a replaced request, and nothing else from the link', () => {
    const history = buildBookingHistory({ createdAt: '2026-10-01T12:00:00Z' }, [
      { id: 1, kind: 'requested', createdAt: '2026-10-01T12:00:00Z' },
      { id: 2, kind: 'replaced_by', createdAt: '2026-10-01T13:00:00Z', metadata: { otherBookingId: 12, otherRef: 'KB-NEW222', intentId: 'private-payment' } },
      { id: 3, kind: 'replaces', createdAt: '2026-10-01T13:00:01Z', metadata: { otherBookingId: 9, otherRef: 'KB-OLD111' } },
    ]);
    expect(history.events.map(event => [event.kind, event.otherRef])).toEqual([['requested', undefined], ['replaced_by', 'KB-NEW222'], ['replaces', 'KB-OLD111']]);
    expect(JSON.stringify(history)).not.toMatch(/private-payment|otherBookingId/);
  });
  it('never carries a reference on other events', () => {
    const history = buildBookingHistory({}, [{ id: 1, kind: 'confirmed', createdAt: '2026-10-02T12:00:00Z', metadata: { otherRef: 'KB-X' } }]);
    expect(history.events[0].otherRef).toBeUndefined();
  });
});
