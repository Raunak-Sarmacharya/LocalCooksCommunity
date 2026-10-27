import { expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {}, pool: null }));
import { buildChatContext } from './chat-context';

const now = new Date('2026-10-27T15:00:00Z');
const booking = (id: number, date: string, status: string, extra = {}) => ({ id, bookingDate: new Date(`${date}T15:30:00Z`), startTime: '10:00', endTime: '12:00', status,
  createdAt: new Date('2026-10-01T12:00:00Z'), updatedAt: new Date('2026-10-02T12:00:00Z'), cancellationEffectiveAt: null, noShowDetectedAt: null, ...extra }) as any;
const rows = (extra = {}) => ({ location: { name: 'Harbour Kitchen', address: 'Water St', logoUrl: null, timezone: 'America/St_Johns' },
  kitchenRows: [{ id: 1, name: 'Main', imageUrl: 'k.jpg' }], bookings: [], tours: [], rentals: [], applications: [], ...extra }) as any;

it('upcoming is soonest first; past leads with what actually happened, not a future booking that was cancelled', () => {
  const c = buildChatContext(rows({ bookings: [booking(1, '2026-12-01', 'cancelled'), booking(2, '2026-11-16', 'confirmed'), booking(3, '2026-11-02', 'pending'), booking(4, '2026-10-23', 'completed')] }), 'chef', now);
  expect(c.upcoming.map(i => i.id)).toEqual([3, 2]);
  expect(c.past).toMatchObject({ count: 2, latest: [{ id: 4 }, { id: 1 }] });
  expect(c.upcoming[0]).toMatchObject({ date: '2026-11-02', href: '/booking/3' });
});

it("Local Cooks' first look at a tour is never shown to the kitchen; the chef sees it as requested", () => {
  const tour = { id: 9, status: 'pending_local_cooks', scheduledAt: new Date('2026-11-05T14:00:00Z'), createdAt: new Date('2026-10-26T12:00:00Z'), confirmedAt: null, cancelledAt: null, adminReviewDecision: null, adminReviewedAt: null } as any;
  expect(buildChatContext(rows({ tours: [tour] }), 'manager', now)).toMatchObject({ upcoming: [], events: [] });
  const chef = buildChatContext(rows({ tours: [tour] }), 'chef', now);
  expect(chef.upcoming).toMatchObject([{ kind: 'tour', status: 'pending', href: '/dashboard?view=viewings&viewing=9' }]);
  expect(chef.events).toMatchObject([{ kind: 'tour', action: 'requested' }]);
});

it('manager gets customer facts and manager links; the thread shows recent changes only, not the whole history', () => {
  const c = buildChatContext(rows({ bookings: [booking(5, '2026-10-20', 'completed'), booking(6, '2026-11-20', 'cancelled', { cancellationEffectiveAt: new Date('2026-10-25T12:00:00Z') })] }), 'manager', now);
  expect(c.customer).toMatchObject({ completedBookings: 1, noShows: 0 });
  expect(c.events.map(e => `${e.id}:${e.action}`)).toEqual(['6:cancelled']);
  expect(c.past.latest[0].href).toBe('/manager/booking/5');
});
