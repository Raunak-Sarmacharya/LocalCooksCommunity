import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { listSavedCards, removeSavedCard } from './chef-saved-cards';

// Real SQL on in-memory Postgres: which of a chef's cards are held for an unanswered request, and when that stops.
const tables = [schema.kitchenBookings, schema.storageBookings, schema.damageClaims, schema.kitchenBookingChanges, schema.kitchenBookingExtensions, schema.storageRentalTerms];
const dialect = new PgDialect();
let pg: PGlite;
const HOLD = "This card is holding payment for a request the kitchen hasn't answered yet. You can remove it after they answer.";
const BUSY = 'A payment with this card is still finishing. Try again in a few minutes.';

beforeAll(async () => {
  process.env.VISIT_CODE_HMAC_SECRET = 'x'.repeat(40);
  pg = new PGlite(); holder.db = drizzle(pg);
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => {
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${c.enumValues ? 'text' : c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
}, 120000);
afterAll(async () => { await pg?.close(); });

const CHEF = 7;
const stripe = { paymentMethods: {
  retrieve: vi.fn(async (id: string) => ({ livemode: false, customer: `cus_${id}`, card: { brand: 'visa', last4: id === 'pm_a' ? '4242' : '1881', exp_month: 1, exp_year: 2031, fingerprint: `fp_${id}`, wallet: null } })),
  detach: vi.fn(async () => ({})),
} } as any;
const q = (sql: string) => pg.exec(sql);
const booking = (id: number, chef: number, pm: string, status: string, pay: string, decision = 'NULL') =>
  q(`INSERT INTO kitchen_bookings (id, chef_id, stripe_customer_id, stripe_payment_method_id, status, payment_status, payment_decision, updated_at)
     VALUES (${id}, ${chef}, 'cus_${pm}', '${pm}', '${status}', '${pay}', ${decision}, now())`);
const storage = (status: string, pay: string) =>
  q(`INSERT INTO storage_bookings (id, chef_id, stripe_customer_id, stripe_payment_method_id, status, payment_status, updated_at)
     VALUES (1, ${CHEF}, 'cus_pm_a', 'pm_a', '${status}', '${pay}', now())`);
const reasons = async (chef = CHEF) => Object.fromEntries((await listSavedCards(chef, stripe)).cards.map(card => [card.last4, card.lockedReason]));
const cardId = async (last4: string) => (await listSavedCards(CHEF, stripe)).cards.find(card => card.last4 === last4)!.id;

beforeEach(async () => {
  for (const table of tables) await q(`DELETE FROM "${getTableConfig(table).name}"`);
  stripe.paymentMethods.detach.mockClear();
});

describe('a card holding payment for a request the kitchen has not answered', () => {
  it('a pending booking request with an authorized hold blocks removal; a different card of the same chef is not blocked', async () => {
    await booking(1, CHEF, 'pm_a', 'pending', 'authorized');
    await booking(2, CHEF, 'pm_b', 'confirmed', 'paid');
    expect(await reasons()).toEqual({ '4242': 'pending_request', '1881': null });
    await expect(removeSavedCard(CHEF, await cardId('4242'), stripe)).rejects.toMatchObject({ status: 409, message: HOLD });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
    await expect(removeSavedCard(CHEF, await cardId('1881'), stripe)).resolves.toEqual({ removed: true });
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith('pm_b');
  });
  it('once the kitchen accepts it no longer blocks', async () => {
    await booking(1, CHEF, 'pm_a', 'pending', 'authorized');
    expect(await reasons()).toEqual({ '4242': 'pending_request' });
    await q(`UPDATE kitchen_bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = 1`);
    expect(await reasons()).toEqual({ '4242': null });
    await expect(removeSavedCard(CHEF, await cardId('4242'), stripe)).resolves.toEqual({ removed: true });
    expect((await pg.query(`SELECT stripe_payment_method_id AS pm FROM kitchen_bookings WHERE id = 1`)).rows).toEqual([{ pm: null }]);
  });
  it('once the kitchen declines it no longer blocks', async () => {
    await booking(1, CHEF, 'pm_a', 'pending', 'authorized');
    await q(`UPDATE kitchen_bookings SET status = 'cancelled', payment_status = 'failed' WHERE id = 1`);
    expect(await reasons()).toEqual({ '4242': null });
  });
  it('an accepted booking whose capture has not finished is "payment in progress", not a pending request', async () => {
    await booking(1, CHEF, 'pm_a', 'pending', 'authorized', `'{"target":"confirmed"}'::jsonb`);
    expect(await reasons()).toEqual({ '4242': 'payment_in_progress' });
    await expect(removeSavedCard(CHEF, await cardId('4242'), stripe)).rejects.toMatchObject({ status: 409, message: BUSY });
  });
  it('another chef’s pending request does not lock this chef', async () => {
    await booking(1, 8, 'pm_a', 'pending', 'authorized');
    await booking(2, CHEF, 'pm_a', 'confirmed', 'paid');
    expect(await reasons()).toEqual({ '4242': null });
  });
  it('a pending storage rental request blocks, and stops blocking once decided', async () => {
    await storage('pending', 'authorized');
    expect(await reasons()).toEqual({ '4242': 'pending_request' });
    await q(`UPDATE storage_bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = 1`);
    expect(await reasons()).toEqual({ '4242': null });
  });
  it('an authorized time-change hold blocks; an applied one does not; a mid-payment one is in progress; a Checkout one is ignored', async () => {
    await booking(1, CHEF, 'pm_a', 'confirmed', 'paid');
    await q(`INSERT INTO kitchen_booking_changes (id, booking_id, state, policy) VALUES ('c1', 1, 'authorized', '{"operation":{"paymentMethodId":"pm_a","state":"done"}}')`);
    expect(await reasons()).toEqual({ '4242': 'pending_request' });
    await q(`UPDATE kitchen_booking_changes SET state = 'applied'`);
    expect(await reasons()).toEqual({ '4242': null });
    await q(`UPDATE kitchen_booking_changes SET state = 'payment_pending'`);
    expect(await reasons()).toEqual({ '4242': 'payment_in_progress' });
    await q(`UPDATE kitchen_booking_changes SET policy = '{"operation":{"checkout":true,"state":"pending"}}'::jsonb`);
    expect(await reasons()).toEqual({ '4242': null });
  });
  it('a pending extra-time request with an authorized hold blocks; declined does not; a create in flight is in progress', async () => {
    await booking(1, CHEF, 'pm_a', 'confirmed', 'paid');
    await q(`INSERT INTO kitchen_booking_extensions (id, booking_id, status, authorized_at, kind) VALUES (1, 1, 'requested', now(), 'request')`);
    expect(await reasons()).toEqual({ '4242': 'pending_request' });
    await q(`UPDATE kitchen_booking_extensions SET status = 'declined'`);
    expect(await reasons()).toEqual({ '4242': null });
    await q(`UPDATE kitchen_booking_extensions SET status = 'requested', authorized_at = NULL, operation = '{"action":"authorize","state":"pending"}'::jsonb`);
    expect(await reasons()).toEqual({ '4242': 'payment_in_progress' });
  });
  it('an authorized storage extension hold blocks; a paid one does not', async () => {
    await storage('confirmed', 'paid');
    await q(`INSERT INTO storage_rental_terms (id, rental_id, kind, status, operation) VALUES (1, 1, 'extension', 'authorized', '{"state":"done","paymentMethodId":"pm_a","checkout":false}')`);
    expect(await reasons()).toEqual({ '4242': 'pending_request' });
    await q(`UPDATE storage_rental_terms SET status = 'paid'`);
    expect(await reasons()).toEqual({ '4242': null });
  });
  it('a damage claim payment on the card that is ready blocks; a settled one does not', async () => {
    await booking(1, CHEF, 'pm_a', 'confirmed', 'paid');
    await q(`INSERT INTO damage_claims (id, chef_id, payment_operation) VALUES (1, ${CHEF}, '{"state":"ready","paymentMethodId":"pm_a"}')`);
    expect(await reasons()).toEqual({ '4242': 'payment_in_progress' });
    await q(`UPDATE damage_claims SET payment_operation = '{"state":"succeeded","paymentMethodId":"pm_a"}'`);
    expect(await reasons()).toEqual({ '4242': null });
  });
});
