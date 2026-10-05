import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ bookings: [] as any[], tours: [] as any[], alerts: [] as any[], send: vi.fn(), queries: [] as string[], db: null as any, owners: [{ id: 1 }] as any[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_, key) => state.db[key] }) }));
vi.mock('../email', async original => ({ ...await original<typeof import('../email')>(), sendEmail: state.send }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (message: any) => state.alerts.push(message) } }));
import { deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';
import { deliverTourEvents, tourEventMessages } from './tour-delivery-service';
const dialect = new PgDialect();
const name = (table: any) => table[Symbol.for('drizzle:Name')];
beforeEach(() => {
  vi.clearAllMocks(); state.bookings = []; state.tours = []; state.alerts = []; state.queries = []; state.owners = [{ id: 1 }];
  vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0');
  state.send.mockImplementation(async (content: any) => !content.to.startsWith('bad@'));
  state.db = {
    transaction: async (run: any) => run(state.db),
    select: () => {
      let table = '', condition: any;
      const chain: any = { from: (t: any) => { table = name(t); return chain; }, where: (c: any) => { condition = c; return chain; },
        orderBy: () => chain, limit: () => chain, for: () => chain, then: (resolve: any) => {
          if (table === 'users') return resolve(state.owners);
          if (table === 'email_logs') return resolve([]);
          if (table === 'kitchen_bookings' || table === 'kitchen_viewings') return resolve([{ status: 'cancelled' }]);
          const all = table === 'booking_lifecycle_events' ? state.bookings : state.tours;
          const query = dialect.sqlToQuery(condition); state.queries.push(query.sql);
          const rows = all.filter(row => {
            const ids = [...query.sql.matchAll(new RegExp(`"${table}"\\."id" = \\$(\\d+)`, 'g'))].map(match => query.params[Number(match[1]) - 1]);
            if (ids.length && !ids.includes(row.id)) return false;
            if (query.sql.includes('NOT EXISTS') && (row.completedAt || row.nextAttemptAt > new Date() || row.leaseUntil > new Date())) return false;
            const booking = table === 'booking_lifecycle_events';
            const urgent = booking ? ['cancelled', 'cancellation_reviewed'].includes(row.kind)
              : row.payload.kind === 'status' && (row.payload.after.status === 'cancelled' || row.payload.after.disruptionReason);
            // Execute the actual dispatcher's compiled guard with a relational
            // model. This is not PostgreSQL execution (separate controlled check).
            if (query.sql.includes('NOT EXISTS')) return !all.some(earlier => earlier.id < row.id && !earlier.completedAt &&
              (booking ? earlier.bookingId === row.bookingId : earlier.viewingId === row.viewingId) &&
              (!(booking ? earlier.metadata : earlier.payload).deliveryRecoveryOwnerIds || earlier.leaseUntil > new Date()));
            return true;
          }).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.id - b.id);
          resolve(rows.slice(0, 1));
        } };
      return chain;
    },
    update: (t: any) => ({ set: (values: any) => ({ where: (condition: any) => {
      const q = dialect.sqlToQuery(condition);
      const idMatch = new RegExp(`"${name(t)}"\\."id" = \\$(\\d+)`).exec(q.sql)!;
      const rows = (name(t) === 'booking_lifecycle_events' ? state.bookings : state.tours).filter(row => row.id === q.params[Number(idMatch[1]) - 1]);
      rows.forEach(row => Object.assign(row, values));
      const chain: any = { returning: async () => rows.map(row => ({ ...row })), then: (resolve: any) => resolve([]) }; return chain;
    } }) }),
  };
});
function booking(id: number, kind = 'confirmed', to = 'good@example.test') {
  return { id, bookingId: 10, kind, title: `Decision ${id}`, message: 'Recorded payment CAD $20 remains an outstanding notice', metadata: {},
    emails: [{ key: 'chef', to, url: 'https://chef.example.test/booking/10' }], deliveredEmailKeys: [],
    nextAttemptAt: new Date(0), completedAt: null, leaseUntil: null, createdAt: new Date() };
}
function tour(id: number, status: string, email: string) {
  const before = { id: 20, status: 'confirmed', scheduledAt: new Date('2026-10-05T08:00:00Z'), durationMinutes: 45,
    locationId: 5, updatedAt: new Date(), sharedManagerNotes: '' };
  const payload = { kind: 'status', before, after: { ...before, status }, chef: { id: 3, email, name: 'Visitor' },
    manager: { id: 2, email: 'host@example.test', name: 'Host' }, admins: [{ id: 1, email: 'support@example.test', name: 'Local Cooks' }],
    locationName: 'Fixture location', kitchenName: 'Fixture kitchen', address: 'Fixture address' };
  return { id, viewingId: 20, payload, deliveredKeys: tourEventMessages(payload as any).filter(message => message.notification).map(message => message.key),
    attempts: 0, nextAttemptAt: new Date(0), leaseUntil: null, completedAt: null, createdAt: new Date() };
}
describe('actual guarded decision dispatchers and owned escalation', () => {
  it('keeps genuine booking decisions ordered, then permits urgent cancellation after owned failure without discarding money/recipient obligations', async () => {
    const earlier = booking(1, 'confirmed', 'bad@example.test'), ordinary = booking(2, 'report_attended'), urgent = booking(3, 'cancelled');
    state.bookings = [earlier, ordinary, urgent];
    expect((await deliverBookingLifecycleEvents(1, 20_000, undefined, 3)).completed).toBe(0);
    await deliverBookingLifecycleEvents(1);
    expect(earlier.metadata).toMatchObject({ deliveryRecoveryOwnerIds: [1] });
    expect(earlier.completedAt).toBeNull(); expect(earlier.deliveredEmailKeys).toEqual([]);
    expect((await deliverBookingLifecycleEvents(1, 20_000, undefined, 2)).completed).toBe(1);
    expect((await deliverBookingLifecycleEvents(1, 20_000, undefined, 3)).completed).toBe(1);
    expect(earlier.message).toContain('CAD $20'); expect(earlier.completedAt).toBeNull();
    expect(state.alerts[0].metadata.recoveryOwnerId).toBe(1);
    expect(state.queries.some(q => q.includes("earlier.metadata->'deliveryRecoveryOwnerIds'"))).toBe(true);
  });
  it('does not bypass a booking event without a real recovery owner', async () => {
    state.owners = []; state.bookings = [booking(1, 'confirmed', 'bad@example.test'), booking(2, 'cancelled')];
    await deliverBookingLifecycleEvents(1);
    expect((await deliverBookingLifecycleEvents(1, 20_000, undefined, 2)).completed).toBe(0);
    expect(state.bookings[0].completedAt).toBeNull();
  });
  it('dispatches a later urgent tour cancellation after failing an earlier genuine confirmed decision; accepted host channels stay acknowledged', async () => {
    const earlier = tour(1, 'confirmed', 'bad@example.test'), later = tour(2, 'cancelled', 'visitor@example.test');
    state.tours = [earlier, later];
    expect((await deliverTourEvents(20, 1, 20_000, 2)).delivered).toBe(0);
    await deliverTourEvents(20, 1);
    expect(earlier.payload).toMatchObject({ deliveryRecoveryOwnerIds: [1] });
    expect(earlier.deliveredKeys).toContain('manager-email'); expect(earlier.deliveredKeys).not.toContain('chef-email');
    expect((await deliverTourEvents(20, 1, 20_000, 2)).delivered).toBe(1);
    expect(earlier.completedAt).toBeNull(); expect(later.completedAt).toBeInstanceOf(Date);
    expect(state.queries.some(q => q.includes("earlier.payload->'deliveryRecoveryOwnerIds'"))).toBe(true);
  });
});
