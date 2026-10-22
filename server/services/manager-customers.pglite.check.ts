/**
 * Runs the real Customers queries against an in-memory Postgres (PGlite): no network, no shared database.
 * Tables are generated from the Drizzle schema (columns and enums only, no constraints), then seeded with two managers
 * so the privacy rules are exercised for real.
 *
 *   npx vitest run -c vitest.config.customers-pglite.ts
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db', () => ({ get db() { return state.db; }, pool: {} }));
vi.mock('./location-access-notices', () => ({ accessEndedMarker: 'Access ended by manager: ' }));

import { createCustomerNote, deleteCustomerNote, listCustomerNotes, listManagerCustomers, updateCustomerNote } from './manager-customers';
import { getCustomerPage } from './manager-customer-page';

let client: PGlite;
const NOW = new Date('2026-10-16T15:00:00.000Z');

function ddl() {
  const enums = new Map<string, string[]>();
  const tables: string[] = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      if (column.enumValues) enums.set(type, [...column.enumValues]);
      return `"${column.name}" ${type}`;
    });
    tables.push(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  }
  const types = Array.from(enums.entries()).map(([name, values]) => `CREATE TYPE "${name}" AS ENUM (${values.map(item => `'${item.replace(/'/g, "''")}'`).join(', ')})`);
  return [...types, ...tables];
}

beforeAll(async () => {
  client = new PGlite();
  for (const statement of ddl()) await client.exec(statement);
  state.db = drizzle(client, { schema });
  await client.exec(`ALTER TABLE customer_notes ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now()`);
  await client.exec(`
    INSERT INTO users (id, username, password, role, phone_number, phone_verified_at, manager_profile_data) VALUES
      (2, 'harbour@example.com', 'x', 'manager', NULL, NULL, '{"fullName":"Sam Manager"}'),
      (3, 'west@example.com', 'x', 'manager', NULL, NULL, '{}'),
      (7, 'priya@example.com', 'x', 'chef', '+17095550142', now(), '{}'),
      (8, 'marc@example.com', 'x', 'chef', '+17095550143', NULL, '{}'),
      (9, 'visitor@example.com', 'x', 'chef', NULL, NULL, '{}');
    INSERT INTO locations (id, name, address, manager_id, timezone) VALUES
      (47, 'Harbour Kitchens', '1 Water St', 2, 'America/St_Johns'),
      (48, 'West End', '2 Elm St', 3, 'America/Toronto');
    INSERT INTO kitchens (id, name, location_id) VALUES (54, 'Main Kitchen', 47), (55, 'Other Kitchen', 48);
    INSERT INTO chef_kitchen_applications (id, chef_id, location_id, full_name, shop_name, email, phone, status, current_tier, tier1_completed_at, tier2_completed_at, created_at, updated_at,
        food_safety_license_url, food_safety_license_status, food_safety_license_expiry) VALUES
      (70, 7, 47, 'Priya Sharma', 'Spice Route Catering', 'priya@example.com', '7095550142', 'approved', 3, now(), now(), now(), now(), '/api/files/documents/licence.pdf', 'approved', '2026-10-22'),
      (71, 8, 47, 'Marc Tremblay', 'Tremblay Bakery', 'marc@example.com', '7095550143', 'approved', 2, now(), now(), now(), now(), NULL, 'pending', NULL),
      (72, 7, 48, 'Priya At West End', 'Elsewhere', 'priya@example.com', '7095550142', 'approved', 3, now(), now(), now(), now(), NULL, 'approved', '2026-10-22');
    INSERT INTO chef_location_access (chef_id, location_id, granted_by, granted_at) VALUES (7, 47, 1, '2026-08-15T12:00:00Z'), (7, 48, 1, '2026-08-20T12:00:00Z');
    INSERT INTO kitchen_viewings (id, location_id, targeted_kitchen_id, chef_id, status, scheduled_at, duration_minutes, appointment_revision, lifecycle_state, confirmation_verified, created_at, updated_at, admin_reviewed_at) VALUES
      (900, 47, 54, 9, 'pending', '2026-10-20T14:00:00Z', 30, 1, 'pending', false, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z', '2026-10-15T12:00:00Z'),
      (901, 47, 54, 9, 'pending_local_cooks', '2026-10-25T14:00:00Z', 30, 1, 'pending', false, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z', NULL);
    INSERT INTO kitchen_bookings (id, chef_id, kitchen_id, booking_date, start_time, end_time, operating_window_start_time, selected_slots, status, created_at, updated_at, checkin_status, payment_status, equipment_items, storage_items, cancellation_cause) VALUES
      (11, 7, 54, '2026-10-16', '08:00', '10:00', '06:00', '[{"startTime":"08:00","endTime":"09:00"},{"startTime":"09:00","endTime":"10:00"}]', 'confirmed', now(), now(), 'checkout_requested', 'paid', '[]', '[]', NULL),
      (12, 7, 54, '2026-10-22', '09:00', '11:00', '06:00', '[{"startTime":"09:00","endTime":"10:00"},{"startTime":"10:00","endTime":"11:00"}]', 'pending', '2026-10-15T12:00:00Z', now(), 'not_checked_in', 'authorized', '[{"equipmentBookingId":1}]', '[{"storageBookingId":2}]', NULL),
      (13, 7, 54, '2026-10-08', '14:00', '16:00', '06:00', '[]', 'cancelled', now(), now(), 'not_checked_in', 'refunded', '[]', '[]', 'chef'),
      (14, 7, 55, '2026-10-22', '09:00', '11:00', '06:00', '[]', 'confirmed', now(), now(), 'not_checked_in', 'paid', '[]', '[]', NULL),
      (15, NULL, 54, '2026-10-22', '12:00', '13:00', '06:00', '[]', 'confirmed', now(), now(), 'not_checked_in', 'paid', '[]', '[]', NULL),
      (16, 7, 54, '2026-10-10', '10:00', '12:00', '06:00', '[]', 'completed', now(), now(), 'checked_out', 'paid',
        '[{"equipmentListingId":89,"name":"Commercial Oven","totalPrice":2500,"date":"2026-10-10"},{"equipmentListingId":90,"name":"Range","totalPrice":0},{"equipmentListingId":91,"name":"Mixer","totalPrice":900,"status":"cancelled","cancelledAt":"2026-10-09T12:00:00Z","cancelledBy":"kitchen","date":"2026-10-10"}]', '[]', NULL),
      (17, 7, 54, '2026-10-12', '14:00', '16:00', '06:00', '[]', 'cancelled', now(), now(), 'not_checked_in', 'paid', '[]', '[]', 'chef'),
      (18, 7, 54, '2026-10-09', '09:00', '10:00', '06:00', '[]', 'confirmed', now(), now(), 'no_show', 'paid', '[]', '[]', NULL),
      (19, 7, 54, '2026-10-07', '09:00', '10:00', '06:00', '[]', 'completed', now(), now(), 'no_show', 'paid', '[]', '[]', NULL),
      (20, 7, 54, '2026-10-20', '09:00', '11:00', '06:00', '[]', 'confirmed', now(), now(), 'not_checked_in', 'paid',
        '[{"equipmentListingId":89,"name":"Commercial Oven","totalPrice":2500,"date":"2026-10-20"},{"equipmentListingId":89,"name":"Commercial Oven","totalPrice":2500,"date":"2026-10-21"}]', '[]', NULL);
    -- Booking 17: cancelled 11.5 h before its 24 h window closed, so late; booking 13 has no effective time, so never late.
    UPDATE kitchen_bookings SET cancellation_policy_hours = 24, cancellation_effective_at = '2026-10-12T05:00:00Z' WHERE id = 17;
    UPDATE chef_kitchen_applications SET business_description = '{"businessType":"catering","usageFrequency":"weekly","sessionDuration":"4-8"}' WHERE id = 70;
    INSERT INTO kitchen_booking_attendance_events (id, booking_id, actor_id, actor_role, action, evidence_snapshot, created_at) VALUES
      (1, 18, 2, 'manager', 'report_no_show', '{}', '2026-10-09T14:00:00Z'), (2, 19, 2, 'manager', 'report_no_show', '{}', '2026-10-07T14:00:00Z');
    INSERT INTO storage_listings (id, kitchen_id, storage_type, name) VALUES (5, 54, 'dry', 'Dry shelf'), (6, 55, 'dry', 'Other shelf');
    INSERT INTO storage_bookings (id, reference_code, storage_listing_id, chef_id, start_date, end_date, status, total_price, pricing_model, rental_state, term_start, paid_through, created_at, updated_at) VALUES
      (30, 'SB-ONE', 5, 7, '2026-10-14T05:00:00Z', '2026-10-21T05:00:00Z', 'confirmed', 1050, 'daily', 'reserved', '2026-10-14', '2026-10-20', '2026-10-13T12:00:00Z', now()),
      (31, 'SB-ELSEWHERE', 6, 7, '2026-10-14T05:00:00Z', '2026-10-21T05:00:00Z', 'confirmed', 9999, 'daily', 'reserved', '2026-10-14', '2026-10-20', '2026-10-13T12:00:00Z', now());
    INSERT INTO payment_transactions (id, booking_id, booking_type, chef_id, manager_id, amount, base_amount, service_fee, manager_revenue, refund_amount, net_amount, status) VALUES
      (1, 11, 'kitchen', 7, 2, 41250, 40000, 1250, 39000, 0, 41250, 'succeeded'),
      (5, 16, 'kitchen', 7, 2, 12000, 11500, 500, 11000, 0, 12000, 'succeeded'),
      (2, 13, 'kitchen', 7, 2, 5000, 4800, 200, 4600, 2843, 2157, 'partially_refunded'),
      (3, 12, 'kitchen', 7, 2, 6100, 5900, 200, 5700, 0, 6100, 'authorized'),
      (4, 14, 'kitchen', 7, 3, 99900, 99000, 900, 98000, 0, 99900, 'succeeded');
    INSERT INTO damage_claims (id, booking_type, kitchen_booking_id, chef_id, manager_id, location_id, status, claim_title, claim_description, damage_date, claimed_amount_cents, chef_response_deadline, chef_owes, created_at) VALUES
      (3, 'kitchen', 11, 7, 2, 47, 'submitted', 'Broken mixer lid', 'Lid cracked', '2026-10-12', 8500, '2026-10-19T15:00:00Z', true, '2026-10-12T15:00:00Z'),
      (4, 'kitchen', 14, 7, 3, 48, 'approved', 'Other manager claim', 'x', '2026-10-12', 77700, '2026-10-19T15:00:00Z', true, '2026-10-12T15:00:00Z');
    INSERT INTO commitment_problems (id, source_key, kind, booking_id, reported_by, owner, status, description, category, created_at) VALUES
      (1, 'k1', 'live', 11, 7, 'local_cooks', 'reported', 'Oven not working', NULL, '2026-10-16T13:00:00Z'),
      (2, 'k2', 'live', 18, 7, 'local_cooks', 'reported', 'I was there', 'attendance', '2026-10-09T16:00:00Z');
    UPDATE payment_transactions SET created_at = '2026-10-14T12:00:00Z';
    UPDATE payment_transactions SET metadata = '{"paymentIntentId":"pi_hidden_1","chargeId":"ch_hidden_1"}', transfer_id = 'tr_hidden_1', paid_at = '2026-10-15T12:00:00Z' WHERE id = 1;
  `);
});
afterAll(async () => { await client?.close(); });

describe('Customers against real SQL', () => {
  it('lists the manager’s customers: statuses, next actions, counts and nothing from the other manager', async () => {
    const result = await listManagerCustomers(2, { status: 'all', q: '', sort: 'needs_action' }, NOW);
    expect(result.locations).toEqual([{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' }]);
    const byName = Object.fromEntries(result.customers.map(row => [row.name, row]));
    expect(Object.keys(byName).sort()).toEqual(['Marc Tremblay', 'Priya Sharma', 'visitor']);
    expect(byName['Priya Sharma']).toMatchObject({ status: 'approved', businessName: 'Spice Route Catering', locationId: 47 });
    expect(byName['Priya Sharma'].locations).toHaveLength(1);
    expect(byName['Priya Sharma'].next).toMatchObject({ code: 'problem', owner: 'local_cooks' });
    expect(byName['Marc Tremblay']).toMatchObject({ status: 'in_review' });
    expect(byName['Marc Tremblay'].next).toMatchObject({ code: 'documents_review', owner: 'you' });
    expect(byName['visitor']).toMatchObject({ status: 'prospect' });
    expect(byName['visitor'].next).toMatchObject({ code: 'tour_request', owner: 'you' });
    expect(result.counts).toMatchObject({ all: 3, approved: 1, in_review: 1, prospect: 1, needs_action: 2 });
    expect(JSON.stringify(result)).not.toMatch(/West End|Elsewhere|99900|77700/);
  });

  it('keeps Local Cooks triage tours and bookings without a customer out of the list', async () => {
    const result = await listManagerCustomers(2, { status: 'prospect', q: '', sort: 'name' }, NOW);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].next.target).toEqual({ kind: 'tour', id: 900 });
  });

  it('searches and filters on the server', async () => {
    expect((await listManagerCustomers(2, { status: 'all', q: 'BAKERY', sort: 'name' }, NOW)).customers.map(row => row.name)).toEqual(['Marc Tremblay']);
    expect((await listManagerCustomers(2, { status: 'all', q: 'visitor@', sort: 'name' }, NOW)).customers.map(row => row.chefId)).toEqual([9]);
    expect((await listManagerCustomers(2, { status: 'in_review', q: '', sort: 'name' }, NOW)).customers.map(row => row.chefId)).toEqual([8]);
  });

  it('pages with a keyset cursor', async () => {
    const first = await listManagerCustomers(2, { status: 'all', q: '', sort: 'name' }, NOW);
    expect(first.nextCursor).toBeNull();
  });

  it('another manager’s location is a 404; the same person looks different to each manager', async () => {
    await expect(listManagerCustomers(2, { locationId: 48, status: 'all', q: '', sort: 'name' }, NOW)).rejects.toMatchObject({ statusCode: 404 });
    const other = await listManagerCustomers(3, { status: 'all', q: '', sort: 'name' }, NOW);
    expect(other.customers.map(row => row.name)).toEqual(['Priya At West End']);
  });

  it('builds the customer page from one location’s data only', async () => {
    const page = await getCustomerPage(2, 7, 47, {}, NOW);
    expect(page.customer).toMatchObject({ name: 'Priya Sharma', businessName: 'Spice Route Catering', email: 'priya@example.com', phone: '+17095550142' });
    expect(page.locations.map(item => item.name)).toEqual(['Harbour Kitchens']);
    expect(page.status).toBe('approved');
    expect(page.upcoming.map(booking => [booking.bookingId, booking.status])).toEqual([[20, 'confirmed'], [12, 'pending']]);
    expect(page.upcoming.find(booking => booking.bookingId === 12)!.responseDeadlineAt).toEqual(expect.any(String));
    expect(page.past.slice(0, 2).map(booking => [booking.bookingId, booking.outcome, booking.refundedCents])).toEqual([[11, 'visit_ended', 0], [17, 'cancelled_by_customer', 0]]);
    expect(page.money).toMatchObject({ paidCents: 58250, refundedCents: 2843, heldCents: 6100, outstandingCents: 0, currency: 'CAD', paymentCount: 3, holdCount: 1 });
    expect(page.claims).toEqual([expect.objectContaining({ id: 3, status: 'submitted', nextActor: 'customer', amountCents: 8500 })]);
    expect(page.application?.documents[0]).toMatchObject({ key: 'foodSafetyLicense', expiry: '2026-10-22', daysLeft: 6, stage: '7_day', url: '/api/files/documents/licence.pdf' });
    expect(JSON.stringify(page)).not.toMatch(/99900|77700|Elsewhere|West End|stripe|pi_/i);
  });

  it('the page is a 404 for someone else’s location and for a person who is not their customer', async () => {
    await expect(getCustomerPage(2, 7, 48, {}, NOW)).rejects.toMatchObject({ statusCode: 404, message: 'Location not found' });
    await expect(getCustomerPage(2, 8888, 47, {}, NOW)).rejects.toMatchObject({ statusCode: 404, message: 'Customer not found' });
    await expect(getCustomerPage(3, 8, 47, {}, NOW)).rejects.toMatchObject({ statusCode: 404 });
    // Marc only applied to manager 2's kitchen: manager 3 gets no name, email or phone for him, with or without a location.
    await expect(getCustomerPage(3, 8, undefined, {}, NOW)).rejects.toMatchObject({ statusCode: 404, message: 'Customer not found' });
  });

  it('counts paid rentals once per listing, not every included item or day', async () => {
    const page = await getCustomerPage(2, 7, 47, { allPast: true }, NOW);
    expect(page.past.find(booking => booking.bookingId === 16)!.rentals).toEqual([{ name: 'Commercial Oven', days: 1 }]);
    expect(page.upcoming.find(booking => booking.bookingId === 20)!.rentals).toEqual([{ name: 'Commercial Oven', days: 2 }]);
    expect(page.upcoming.find(booking => booking.bookingId === 12)!.rentals).toEqual([]);
  });

  it('phone: only the verified account phone, never the application phone', async () => {
    expect((await getCustomerPage(2, 7, 47, {}, NOW)).customer).toMatchObject({ phone: '+17095550142', businessType: 'catering', usageFrequency: 'weekly', sessionDuration: '4-8' });
    expect((await getCustomerPage(2, 8, 47, {}, NOW)).customer).toMatchObject({ phone: null });
  });

  it('reliability: late cancellations apart from early ones, no-shows counted or under review, visits and hours', async () => {
    const page = await getCustomerPage(2, 7, 47, { allPast: true }, NOW);
    const byId = Object.fromEntries(page.past.map(booking => [booking.bookingId, booking]));
    expect(byId[17]).toMatchObject({ late: true, outcome: 'cancelled_by_customer' });
    expect(byId[13]).toMatchObject({ late: false, outcome: 'cancelled_by_customer' });
    expect(byId[18]).toMatchObject({ outcome: 'attendance_reported', noShow: 'under_review' });
    expect(byId[19]).toMatchObject({ outcome: 'attendance_reported', noShow: 'counted' });
    expect(page.reliability).toEqual({ visits: 2, hoursInKitchen: 4, lastVisitEndedAt: '2026-10-16T12:30:00.000Z',
      nextVisit: { bookingId: 20, startsAt: '2026-10-20T11:30:00.000Z', endsAt: '2026-10-20T13:30:00.000Z' },
      cancelledByCustomer: 2, lateCancellations: 1, noShowsCounted: 1, noShowsUnderReview: 1 });
    expect(page.bookingCounts).toEqual({ upcoming: 2, past: 4, cancelled: 2 });
    expect(page.locations).toEqual([expect.objectContaining({ id: 47, bookingCount: 8 })]);
  });

  it('storage, open items, payouts and activity come from this location only, with no provider identifiers', async () => {
    const page = await getCustomerPage(2, 7, 47, { allPast: true }, NOW);
    expect(page.storage).toEqual([expect.objectContaining({ id: 30, reference: 'SB-ONE', name: 'Dry shelf', state: 'reserved', moveInOverdue: true, totalCents: 1050 })]);
    expect(page.open.map(item => [item.kind, item.owner])).toEqual([['storage_move_in', 'you'], ['booking_request', 'you'],
      ['problem', 'local_cooks'], ['no_show_review', 'local_cooks'], ['claims', 'customer']]);
    expect(page.open.find(item => item.kind === 'no_show_review')).toMatchObject({ bookingId: 18, startsAt: expect.any(String) });
    const payment = page.payments.find(row => row.bookingId === 11)!;
    expect(payment).toMatchObject({ amountCents: 41250, status: 'succeeded', payoutStatus: 'sent', payoutCents: expect.any(Number) });
    const types = page.activity.map(item => `${item.type}:${item.actor}`);
    expect(types).toEqual(expect.arrayContaining(['booked:customer', 'cancelled:customer', 'rental_day_cancelled:you', 'visit_ended:customer',
      'no_show_reported:you', 'no_show_disputed:customer', 'claim_filed:you', 'storage_rented:customer', 'applied:customer']));
    expect(page.activity.map(item => item.at)).toEqual(page.activity.map(item => item.at).slice().sort((a, b) => Date.parse(b) - Date.parse(a)));
    expect(JSON.stringify(page)).not.toMatch(/pi_hidden|ch_hidden|tr_hidden|SB-ELSEWHERE|9999|Other shelf|99900|77700/);
  });

  it('notes: create, edit own, soft-delete, and the other manager cannot see or touch them', async () => {
    const { id } = await createCustomerNote(2, 7, 47, '  Prefers early slots  ');
    let notes = await listCustomerNotes(2, 7, 47);
    expect(notes).toEqual([expect.objectContaining({ id, body: 'Prefers early slots', authorName: 'Sam Manager', mine: true })]);
    await updateCustomerNote(2, 7, 47, id, 'Prefers late slots');
    notes = await listCustomerNotes(2, 7, 47);
    expect(notes[0].body).toBe('Prefers late slots');
    await expect(listCustomerNotes(3, 7, 47)).rejects.toMatchObject({ statusCode: 404 });
    await expect(createCustomerNote(3, 7, 47, 'sneaky')).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateCustomerNote(3, 7, 47, id, 'sneaky')).rejects.toMatchObject({ statusCode: 404 });
    await expect(createCustomerNote(2, 4040, 47, 'stranger')).rejects.toMatchObject({ statusCode: 404, message: 'Customer not found' });
    await deleteCustomerNote(2, 7, 47, id);
    expect(await listCustomerNotes(2, 7, 47)).toEqual([]);
    const kept = await client.query<{ deleted_at: string | null; body: string }>('SELECT body, deleted_at FROM customer_notes WHERE id = $1', [id]);
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0].deleted_at).not.toBeNull();
    await expect(updateCustomerNote(2, 7, 47, id, 'again')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('migration 0092_customer_notes.sql', () => {
  it('creates the table, its limits and its index on a fresh database', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec('CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE locations (id serial PRIMARY KEY); INSERT INTO users DEFAULT VALUES; INSERT INTO locations DEFAULT VALUES;');
      await fresh.exec(readFileSync('migrations/0092_customer_notes.sql', 'utf8'));
      await fresh.query('INSERT INTO customer_notes (location_id, chef_id, author_id, body) VALUES (1, 1, 1, $1)', ['a'.repeat(2000)]);
      await expect(fresh.query('INSERT INTO customer_notes (location_id, chef_id, author_id, body) VALUES (1, 1, 1, $1)', ['a'.repeat(2001)])).rejects.toThrow();
      await expect(fresh.query('INSERT INTO customer_notes (location_id, chef_id, author_id, body) VALUES (1, 1, 1, $1)', ['   '])).rejects.toThrow();
      await expect(fresh.query('INSERT INTO customer_notes (location_id, chef_id, author_id, body) VALUES (99, 1, 1, $1)', ['x'])).rejects.toThrow();
      const indexes = await fresh.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'customer_notes'");
      expect(indexes.rows.map(row => row.indexname)).toContain('customer_notes_customer_idx');
      await fresh.exec('DELETE FROM users WHERE id = 1');
      expect((await fresh.query('SELECT 1 FROM customer_notes')).rows).toHaveLength(0);
    } finally { await fresh.close(); }
  });
});
