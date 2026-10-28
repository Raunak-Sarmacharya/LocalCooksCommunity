import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any, pg: null as any, queued: [] as Array<[number, string, string]>, expired: [] as number[], released: [] as number[], swept: 0 }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: async () => {}, currentReminders: async () => [], dispatchAdvanceReminders: async () => ({ accepted: 0 }),
  reminderKey: (r: any, channel: string) => `advance:${r.source}:${r.reservationId}:${r.resource}:${r.kind}:${r.recipientId}:${channel}:${r.revision}` }));
// Stands in for the real notice: one queued email per notice, like the chef's copy.
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: async (tx: any, id: number, event: string, facts: { eventKey: string }) => {
  holder.queued.push([id, event, facts.eventKey]);
  const { emailLogs } = await import('@shared/schema');
  await tx.insert(emailLogs).values({ recipientEmail: 'c@x', subject: 's', category: 'lifecycle_outcome', status: 'queued', trackingId: `storage-rental:${id}:${event}:${facts.eventKey}:7` });
} }));
vi.mock('./storage-rentals', () => ({ expireRental: async (id: number) => { holder.expired.push(id); }, StorageRentalError: class extends Error {} }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async () => ({ platformCommissionInCents: 100 }) }));
vi.mock('./overstay-penalty-service', () => ({ processManagerDecision: async () => ({ success: true }) }));
vi.mock('./storage-settings', () => ({ storageSettings: async () => ({ kitchenDisposalEnabled: false }) }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerPageEnd: async () => {}, workerRecord: async () => {} }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => 'X' }));
vi.mock('./storage-payouts', () => ({ releaseStorageTermPayout: async (id: number) => { holder.released.push(id); return {}; } }));
vi.mock('./storage-checkout-service', () => ({ autoCleanExpiredCheckout: async () => true }));
vi.mock('./damage-claim-limits-service', () => ({ getStorageCheckoutSettings: async () => ({ reviewWindowHours: 2 }) }));
vi.mock('./outcome-delivery', () => ({ attemptOutcomeDeliveryAfterResponse: () => {},
  deliverOutcomeEmails: async (_limit: number, _budget: number, id: number) => { await holder.pg.query(`UPDATE email_logs SET status = 'sent' WHERE id = $1`, [id]); } }));
import { jumpStorage, readStorageClock, shiftDatesInText } from './qa-test-clock-storage';
import { addDays, localDayStart, localToday, occupancyRange, toDateRange } from '@shared/storage-rental';
import { jumpGraceMs, jumpStepMs } from './qa-test-clock';

const zone = 'America/St_Johns', hour = 3_600_000, day = 24 * hour;
const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};
const today = () => localToday(new Date(), zone);

type Seed = { id?: number; state?: string; start: number; paid: number; unit?: number; notices?: string[]; deadline?: Date | null };
/** Dates are given as days from today. The rental's start/end instants are the kitchen-local day boundaries, as the product writes them. */
async function seed({ id = 1, state = 'active', start, paid, unit = 1, notices = [], deadline = null }: Seed) {
  const termStart = addDays(today(), start), paidThrough = addDays(today(), paid);
  const terms = { version: 'storage-v1', dailyPriceCents: 1000, taxRatePercent: 15, maxTermDays: 30, noticesSent: notices, acceptedAt: new Date(Date.now() - 3 * day).toISOString(),
    cancellationPolicySnapshot: { noticeHours: 24, sessions: [{ startAt: localDayStart(termStart, zone).toISOString() }] } };
  await pg.query(`INSERT INTO storage_bookings(id, reference_code, storage_listing_id, chef_id, start_date, end_date, status, total_price, pricing_model, rental_state, unit_index, term_start, paid_through,
      timezone, rental_terms, response_deadline, approved_at, needs_cleaning, occupancy, assistance_history, handover_photo_urls, created_at, updated_at)
    VALUES ($1, $2, 1, 7, $3, $4, 'confirmed', '0', 'daily', $5, $6, $7, $8, $9, $10, $11, now() - interval '1 day', false, '[2000-01-01,2000-01-02)', '[]', '[]', now() - interval '2 days', date_trunc('milliseconds', now()))`,
    [id, `SB-${id}`, localDayStart(termStart, zone).toISOString(), localDayStart(addDays(paidThrough, 1), zone).toISOString(), state, unit, termStart, paidThrough, zone, JSON.stringify(terms), deadline?.toISOString() ?? null]);
  return (await readStorageClock(id)).updatedAt;
}
// Dates are read as text so the machine's time zone never shifts a day.
const row = async (id = 1) => (await pg.query<any>('SELECT *, term_start::text AS ts, paid_through::text AS pt FROM storage_bookings WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  holder.db = drizzle(pg, { schema }); holder.pg = pg;
  await pg.exec([schema.storageBookings, schema.storageListings, schema.storageRentalTerms, schema.paymentTransactions, schema.storageOverstayRecords, schema.storageOverstayHistory,
    schema.emailLogs, schema.platformSettings, schema.damageClaims, schema.commitmentProblems, schema.bookingFlags].map(table).join('\n'));
  await pg.exec(`INSERT INTO storage_listings(id) VALUES (1);`);
});
beforeEach(async () => {
  holder.queued = []; holder.expired = []; holder.released = [];
  await pg.exec('DELETE FROM storage_bookings; DELETE FROM storage_rental_terms; DELETE FROM payment_transactions; DELETE FROM storage_overstay_records; DELETE FROM email_logs;');
});

describe('date text', () => {
  it('moves local dates inside keys and quotes, never instants', () => {
    expect(shiftDatesInText('{"a":["ending:7:2026-11-04","2026-11-04"],"t":"2026-11-04T10:00:00.000Z","u":"/photos/2026-11-04/x.jpg"}', 2))
      .toBe('{"a":["ending:7:2026-11-02","2026-11-02"],"t":"2026-11-04T10:00:00.000Z","u":"/photos/2026-11-04/x.jpg"}');
  });
});

describe('storage clock steps', () => {
  it('lists ending reminders, the end, grace notices, holdover and removal review of an active rental, at local day starts', async () => {
    await seed({ start: -1, paid: 29 });
    const { steps } = await readStorageClock(1);
    const end = addDays(today(), 29);
    expect(steps.map(step => step.label)).toEqual(['Ending reminder · 14 days before the end', 'Ending reminder · 7 days before the end', 'Ending reminder · 2 days before the end', 'Ending reminder · last paid day',
      'Paid time ends · grace period starts (day 1 notice)', 'Grace notice · day 3', 'Grace notice · day 5', 'Holdover starts (daily charge builds)', 'Removal review opens (15 days of holdover)']);
    expect(steps.at(-1)!.at).toBe(localDayStart(addDays(end, 20), zone).toISOString());
    expect(steps[0].at).toBe(localDayStart(addDays(end, -14), zone).toISOString());
  });

  it('skips ending reminders in the first half of a short term, like the sweep', async () => {
    await seed({ start: -1, paid: 6 }); // 8 days: half is day 4, so only the 2-day and last-day reminders are left
    expect((await readStorageClock(1)).steps.map(step => step.key).filter(key => key.startsWith('ending'))).toEqual(['ending_2', 'ending_0']);
  });

  it('lists the answer deadline of a request, the move-in notices of a reservation, and the inspection deadline and payout after move-out', async () => {
    await seed({ state: 'requested', start: 2, paid: 8, deadline: new Date(Date.now() + 3 * hour) });
    expect((await readStorageClock(1)).steps.map(step => step.key)).toEqual(['response_deadline']);
    await pg.exec('DELETE FROM storage_bookings');
    await seed({ state: 'reserved', start: 0, paid: 8 });
    expect((await readStorageClock(1)).steps.map(step => step.key)).toEqual(['move_in_1', 'move_in_3', 'not_moved_in']);
    await pg.exec(`UPDATE storage_bookings SET rental_state = 'move_out_requested', checkout_status = 'checkout_requested', checkout_requested_at = now()`);
    await pg.query(`INSERT INTO payment_transactions(booking_id, booking_type, payout_timing, status, payout_eligible_at, amount, created_at, updated_at) VALUES (1, 'storage', 'storage_term', 'succeeded', now() + interval '5 hours', 10, now(), now())`);
    expect((await readStorageClock(1)).steps.map(step => step.key)).toEqual(['checkout_review', 'payout']);
  });

  it('is not for legacy storage bookings', async () => {
    await pg.query(`INSERT INTO storage_bookings(id, storage_listing_id, rental_state, created_at, updated_at) VALUES (9, 1, 'ended', now(), now())`);
    await expect(readStorageClock(9)).rejects.toMatchObject({ status: 404 });
  });
});

describe('storage jump', () => {
  it('moves dates by the local days crossed, rewrites sent-notice markers so nothing is sent twice, and recomputes occupancy', async () => {
    // The reminder 7 days before the end falls due at the start of tomorrow, so a jump there crosses one midnight.
    const end = addDays(today(), 8), marker = `ending:7:${end}`;
    const version = await seed({ start: -6, paid: 8, notices: [marker] });
    await pg.query(`INSERT INTO storage_rental_terms(rental_id, seq, kind, starts_on, ends_on, days, status, paid_at, created_at) VALUES (1, 1, 'first', $1, $2, 14, 'paid', now() - interval '5 days', now() - interval '6 days')`, [addDays(today(), -6), end]);
    await pg.query(`INSERT INTO storage_overstay_records(storage_booking_id, idempotency_key, status, chef_dispute_deadline, created_at, updated_at) VALUES (1, $1, 'penalty_approved', now() + interval '2 days', now(), now())`, [`holdover:1:${end}:2`]);
    const before = await row();
    const to = localDayStart(addDays(today(), 1), zone);
    const ms = Math.ceil((to.getTime() - Date.now() + jumpGraceMs) / jumpStepMs) * jumpStepMs;

    const result = await jumpStorage(1, to, 9, version);
    expect(result.movedMs).toBe(ms);
    const after = await row();
    expect([after.ts, after.pt]).toEqual([addDays(today(), -7), addDays(end, -1)]);
    expect(after.rental_terms.noticesSent).toEqual([`ending:7:${addDays(end, -1)}`]);
    expect(holder.queued.filter(([, event]) => event === 'ending')).toEqual([]); // already sent: not queued again
    expect(after.occupancy).toBe(toDateRange(occupancyRange({ rentalState: 'active', termStart: addDays(today(), -7), paidThrough: addDays(end, -1) })!));
    expect(new Date(after.approved_at).getTime()).toBe(new Date(before.approved_at).getTime() - ms);
    const [saved] = await holder.db.select().from(schema.storageBookings);
    expect(saved.startDate.toISOString()).toBe(localDayStart(addDays(today(), -7), zone).toISOString());
    expect(after.rental_terms.cancellationPolicySnapshot.sessions[0].startAt).toBe(localDayStart(addDays(today(), -7), zone).toISOString());
    expect(after.rental_terms.acceptedAt).toBe(new Date(Date.parse(before.rental_terms.acceptedAt) - ms).toISOString());
    const [term] = (await pg.query<any>('SELECT starts_on::text s, ends_on::text e FROM storage_rental_terms')).rows;
    expect([term.s, term.e]).toEqual([addDays(today(), -7), addDays(end, -1)]);
    expect((await pg.query<any>('SELECT idempotency_key FROM storage_overstay_records')).rows[0].idempotency_key).toBe(`holdover:1:${addDays(end, -1)}:2`);
  });

  it('sends a reminder that was not sent yet, once, and lists it in the result', async () => {
    const version = await seed({ start: -6, paid: 8 });
    const result = await jumpStorage(1, localDayStart(addDays(today(), 1), zone), 9, version);
    expect(holder.queued).toEqual([[1, 'ending', `7:${addDays(today(), 7)}`]]);
    expect(result.notices).toEqual([{ kind: 'ending', sent: true }]);
    expect((await row()).rental_terms.noticesSent).toEqual([`ending:7:${addDays(today(), 7)}`]);
  });

  it('refuses a move onto another rental of the same unit and changes nothing', async () => {
    await seed({ id: 2, start: -11, paid: -4 }); // holds the unit until its grace ends, the day before rental 1 starts
    const version = await seed({ id: 1, state: 'reserved', start: 3, paid: 9 });
    const before = await row(1);
    await expect(jumpStorage(1, localDayStart(addDays(today(), 4), zone), 9, version)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('same unit') });
    const after = await row(1);
    expect([after.ts, after.occupancy, after.updated_at]).toEqual([before.ts, '[2000-01-01,2000-01-02)', before.updated_at]);
    expect(holder.queued).toEqual([]);
    // Another unit of the same listing is fine.
    await pg.exec('UPDATE storage_bookings SET unit_index = 2 WHERE id = 2');
    await expect(jumpStorage(1, localDayStart(addDays(today(), 4), zone), 9, version)).resolves.toMatchObject({ movedMs: expect.any(Number) });
  });

  it('refuses when the rental changed since the card was loaded', async () => {
    await seed({ start: -6, paid: 8 });
    await expect(jumpStorage(1, localDayStart(addDays(today(), 1), zone), 9, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ status: 409, message: 'This rental changed. Refresh and try again.' });
    expect(holder.queued).toEqual([]);
  });

  it('refuses while a payment decision is still finishing', async () => {
    const version = await seed({ start: -6, paid: 8 });
    await pg.query(`INSERT INTO storage_rental_terms(rental_id, seq, kind, starts_on, ends_on, days, status, operation, created_at) VALUES (1, 1, 'first', $1, $2, 14, 'authorized', '{"state":"pending"}', now())`, [addDays(today(), -6), addDays(today(), 8)]);
    await expect(jumpStorage(1, localDayStart(addDays(today(), 1), zone), 9, version)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('payment decision') });
  });

  it('lets an unanswered request jump only to its answer deadline, where it expires', async () => {
    const deadline = new Date(Date.now() + 2 * hour), version = await seed({ state: 'requested', start: 1, paid: 7, deadline });
    await expect(jumpStorage(1, new Date(Date.now() + hour), 9, version)).rejects.toMatchObject({ status: 409 });
    expect(holder.expired).toEqual([]);
    await jumpStorage(1, deadline, 9, version);
    expect(holder.expired).toEqual([1]);
  });

  it('releases a payout once a jump makes it due, and not before', async () => {
    const version = await seed({ start: -6, paid: 8 });
    const [{ id: payment }] = (await pg.query<any>(`INSERT INTO payment_transactions(booking_id, booking_type, payout_timing, status, payout_eligible_at, amount, created_at, updated_at) VALUES (1, 'storage', 'storage_term', 'succeeded', now() + interval '3 hours', 10, now(), now()) RETURNING id`)).rows;
    const short = await jumpStorage(1, new Date(Date.now() + hour), 9, version);
    expect(holder.released).toEqual([]);
    await jumpStorage(1, new Date(Date.now() + 3 * hour), 9, short.clock.updatedAt);
    expect(holder.released).toContain(payment); // once per step it passes while still unpaid; the real release re-checks and pays once
  });
});
