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
