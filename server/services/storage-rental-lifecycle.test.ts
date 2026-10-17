import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const h = vi.hoisted(() => ({ db: null as any, notices: vi.fn(), expire: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: h.notices }));
vi.mock('./storage-rentals', () => ({ expireRental: h.expire,
  StorageRentalError: class extends Error { constructor(public code: string, public status = 409) { super(code); } } }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async () => ({ platformCommissionInCents: 100 }) }));
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), queueOverstayOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `OP-${randomUUID()}` }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { openRemovalReview, raiseHoldoverCharge, recordRemoval, sendFinalNotice, sweepStorageRentals, waiveHoldover } from './storage-rental-lifecycle';
import { chargeApprovedPenalty } from './overstay-penalty-service';
import { checkoutObligation } from './obligation-payment-service';

let pg: PGlite;
const { kitchens, locations, storageListings, storageBookings, platformSettings, storageOverstayRecords, storageOverstayHistory } = schema;
const tables = [kitchens, locations, storageListings, storageBookings, platformSettings, storageOverstayRecords, storageOverstayHistory];
const dialect = new PgDialect();
const at = (iso: string) => new Date(iso);
const rows = (table: any) => h.db.select().from(table);
const rental = async () => (await rows(storageBookings))[0];
const frozen = { version: 'storage-v1', dailyPriceCents: 1000, taxRatePercent: 15, maxTermDays: 30 };
const sent = () => h.notices.mock.calls.map(([, id, event, facts]: any[]) => `${id}:${event}:${facts.eventKey}`);
const sweep = async (iso: string) => sweepStorageRentals(3, at(iso));

beforeAll(async () => {
  pg = new PGlite();
  h.db = drizzle(pg);
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => {
      const type = c.enumValues ? 'text' : c.getSQLType();
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${type}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
  await pg.exec(`CREATE UNIQUE INDEX overstay_key ON storage_overstay_records(idempotency_key)`);
}, 120000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of tables) await h.db.delete(table);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour', taxRatePercent: '15' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', isActive: true, status: 'approved', pricingModel: 'daily', basePrice: '1000', unitCount: 1 });
});
const seed = (patch: Record<string, unknown> = {}) => h.db.insert(storageBookings).values({ id: 7, chefId: 3, storageListingId: 1, rentalState: 'active', status: 'confirmed',
  unitIndex: 1, termStart: '2026-10-01', paidThrough: '2026-10-10', timezone: 'America/St_Johns', occupancy: '[2026-10-01,2026-10-16)',
  endDate: at('2026-10-11T03:00:00Z'), rentalTerms: frozen, ...patch });

describe('sweepStorageRentals notices', () => {
  it('sends each ending reminder once, including across the fall-back night in America/St_Johns', async () => {
    await seed({ paidThrough: '2026-11-02', occupancy: '[2026-10-01,2026-11-08)' });
    // NDT is UTC-2:30 until 00:01 on 2026-11-01, then NST is UTC-3:30.
    for (const iso of ['2026-10-19T15:00:00Z', '2026-10-19T16:00:00Z', '2026-10-26T15:00:00Z', '2026-11-01T01:30:00Z', '2026-11-01T03:00:00Z',
      '2026-11-01T04:30:00Z', '2026-11-01T12:00:00Z', '2026-11-02T02:59:00Z']) await sweep(iso);
    expect(sent()).toEqual(['7:ending:14:2026-11-02', '7:ending:7:2026-11-02', '7:ending:2:2026-11-02']);
    await sweep('2026-11-02T03:31:00Z'); // 00:01 NST on 2026-11-02, the first minute of the last paid day
    await sweep('2026-11-02T03:45:00Z'); await sweep('2026-11-02T20:00:00Z');
    expect(sent().filter((key: string) => key.includes('ending:0:'))).toEqual(['7:ending:0:2026-11-02']);
    expect(sent()).toHaveLength(4);
  });

  it('sends one notice after a late sweep instead of a burst, then nothing more', async () => {
    await seed({ paidThrough: '2026-10-20', occupancy: '[2026-10-01,2026-10-26)' });
    await sweep('2026-10-19T15:00:00Z'); await sweep('2026-10-19T15:30:00Z');
    expect(sent()).toEqual(['7:ending:2:2026-10-20']);
  });

  it('announces grace +1/+3/+5 and the start of holdover once each', async () => {
    await seed();
    for (const iso of ['2026-10-11T15:00:00Z', '2026-10-11T18:00:00Z', '2026-10-13T15:00:00Z', '2026-10-15T15:00:00Z', '2026-10-15T20:00:00Z',
      '2026-10-16T15:00:00Z', '2026-10-17T15:00:00Z']) await sweep(iso);
    expect(sent().filter((key: string) => !key.includes('ending'))).toEqual([
      '7:grace_started:1:2026-10-10', '7:grace_started:3:2026-10-10', '7:grace_started:5:2026-10-10', '7:holdover_started:2026-10-15']);
    expect(h.notices.mock.calls.find(([, , event]: any[]) => event === 'holdover_started')![3]).toMatchObject({ dailyCents: 1150 });
  });

  it('reminds a chef who has not moved in on day 1 and 3 and tells the kitchen on day 7', async () => {
    await seed({ rentalState: 'reserved', termStart: '2026-10-10', paidThrough: '2026-10-20' });
    for (const iso of ['2026-10-10T15:00:00Z', '2026-10-11T15:00:00Z', '2026-10-11T19:00:00Z', '2026-10-13T15:00:00Z', '2026-10-16T15:00:00Z',
      '2026-10-17T15:00:00Z', '2026-10-17T21:00:00Z']) await sweep(iso);
    expect(sent()).toEqual(['7:move_in_due:1:2026-10-10', '7:move_in_due:3:2026-10-10', '7:not_moved_in:7:2026-10-10']);
  });

  it('opens removal review at 15 holdover days, holds the unit open-ended and tells everyone once', async () => {
    await seed({ paidThrough: '2026-09-20', occupancy: '[2026-09-01,2026-09-26)', termStart: '2026-09-01' });
    await sweep('2026-10-08T15:00:00Z'); // holdover day 13
    expect((await rental()).rentalState).toBe('active');
    await sweep('2026-10-10T15:00:00Z'); // holdover day 15
    expect(await rental()).toMatchObject({ rentalState: 'removal_review', occupancy: '[2026-09-01,)' });
    await sweep('2026-10-12T15:00:00Z');
    expect(sent().filter((key: string) => key.includes('removal_review'))).toEqual(['7:removal_review:opened:2026-10-10']);
  });

  it('expires an overdue request as a backstop', async () => {
    await seed({ rentalState: 'requested', responseDeadline: at('2026-10-15T12:00:00Z') });
    await sweep('2026-10-15T13:00:00Z');
    expect(h.expire).toHaveBeenCalledWith(7, at('2026-10-15T13:00:00Z'));
  });
});

describe('holdover charge requests', () => {
  // paid through 2026-10-10 -> grace ends 10-15 -> 10-18 is holdover day 3 (cap 3 x $10 + 15% = $34.50)
  const now = at('2026-10-18T15:00:00Z');
  it('refuses while the chef is still in paid or grace time', async () => {
    await seed();
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 100 }, at('2026-10-14T15:00:00Z'))).rejects.toMatchObject({ code: 'holdover_not_started' });
  });
  it('rejects more than has built up and anyone but the kitchen manager', async () => {
    await seed();
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 3451 }, now)).rejects.toMatchObject({ code: 'exceeds_accrued', status: 400 });
    await expect(raiseHoldoverCharge(7, 99, { amountCents: 3450 }, now)).rejects.toMatchObject({ code: 'not_found' });
    expect(await rows(storageOverstayRecords)).toHaveLength(0);
  });
  it('records an approved request with a 72 h dispute window, refuses a second open one, and counts only new days afterwards', async () => {
    await seed();
    const result = await raiseHoldoverCharge(7, 2, { amountCents: 3000, note: ' fair ' }, now);
    expect(result).toMatchObject({ amountCents: 3000, days: 3 });
    const [record] = await rows(storageOverstayRecords);
    expect(record).toMatchObject({ status: 'penalty_approved', idempotencyKey: 'holdover:7:2026-10-10:3', daysOverdue: 3, dailyRateCents: 1000,
      penaltyRate: '0', calculatedPenaltyCents: 3000, finalPenaltyCents: 2609, managerNotes: 'fair' });
    expect(record.chefDisputeDeadline.toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(h.notices).toHaveBeenCalledWith(expect.anything(), 7, 'holdover_charge', expect.objectContaining({ eventKey: 'holdover:7:2026-10-10:3', amountCents: 3000 }));
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 100 }, now)).rejects.toMatchObject({ code: 'holdover_request_open' });
    await h.db.update(storageOverstayRecords).set({ status: 'charge_succeeded' });
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 100 }, now)).rejects.toMatchObject({ code: 'holdover_not_started' });
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 2301 }, at('2026-10-20T15:00:00Z'))).rejects.toMatchObject({ code: 'exceeds_accrued' });
    expect(await raiseHoldoverCharge(7, 2, { amountCents: 2300 }, at('2026-10-20T15:00:00Z'))).toMatchObject({ amountCents: 2300, days: 2 });
  });
  it('waives through the manager decision and later requests cover only newer days', async () => {
    await seed();
    await waiveHoldover(7, 2, { reason: 'Chef had a hospital stay' }, now);
    expect(await rows(storageOverstayRecords)).toMatchObject([{ status: 'penalty_waived', penaltyWaived: true, finalPenaltyCents: 0, waiveReason: 'Chef had a hospital stay' }]);
    expect(h.notices).toHaveBeenCalledWith(expect.anything(), 7, 'holdover_waived', expect.objectContaining({ days: 3 }));
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 100 }, now)).rejects.toMatchObject({ code: 'holdover_not_started' });
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 1151 }, at('2026-10-19T15:00:00Z'))).rejects.toMatchObject({ code: 'exceeds_accrued' });
  });
  it('freezes accrual at 15 days during removal review', async () => {
    await seed({ rentalState: 'removal_review', paidThrough: '2026-09-20', termStart: '2026-09-01', occupancy: '[2026-09-01,)' });
    const later = at('2026-11-20T15:00:00Z');
    await expect(raiseHoldoverCharge(7, 2, { amountCents: 17251 }, later)).rejects.toMatchObject({ code: 'exceeds_accrued' });
    expect(await raiseHoldoverCharge(7, 2, { amountCents: 17250 }, later)).toMatchObject({ days: 15, amountCents: 17250 });
  });
  it('is paid only by the chef on-session: never off-session, and checkout opens at once without removal being recorded', async () => {
    await seed();
    await raiseHoldoverCharge(7, 2, { amountCents: 3450 }, now);
    const [record] = await rows(storageOverstayRecords);
    expect(await chargeApprovedPenalty(record.id)).toMatchObject({ success: false, error: expect.stringMatching(/never charged off-session/) });
    const stripe = { checkout: { sessions: { create: vi.fn(async (params: any) => ({ id: 'cs_test_1', url: 'https://checkout.invalid', ...params })) } } };
    const session = await checkoutObligation(stripe as any, 'overstay_penalty', record.id, { mode: 'payment', metadata: { type: 'overstay_penalty' } } as any);
    expect(session.id).toBe('cs_test_1');
    expect((await rows(storageOverstayRecords))[0]).toMatchObject({ paymentRoute: 'checkout', stripeCheckoutSessionId: 'cs_test_1' });
    // A pending dispute pauses payment until reviewed.
    await h.db.update(storageOverstayRecords).set({ paymentRoute: null, stripeCheckoutSessionId: null, status: 'escalated', chefDisputedAt: new Date() });
    await expect(checkoutObligation(stripe as any, 'overstay_penalty', record.id, { mode: 'payment' } as any)).rejects.toThrow('Another payment is already in progress');
  });
});

describe('removal review', () => {
  const items = [{ name: 'Milk', qty: 3, perishable: true }, { name: 'Pans', qty: 2, perishable: false }];
  const photos = ['https://example.invalid/a.jpg'];
  const notice = at('2026-10-20T15:00:00Z');
  const review = (patch: Record<string, unknown> = {}) => seed({ rentalState: 'removal_review', paidThrough: '2026-09-20', termStart: '2026-09-01', occupancy: '[2026-09-01,)',
    removalReview: { openedAt: '2026-10-10T00:00:00Z', openedBy: null, items: [], photos: [], actions: [] }, ...patch });
  const enable = (on: boolean) => h.db.insert(platformSettings).values({ key: 'storage_kitchen_disposal_enabled', value: String(on) });

  it('lets an admin open the review only once holdover has started', async () => {
    await seed();
    await expect(openRemovalReview(7, at('2026-10-14T15:00:00Z'))).rejects.toMatchObject({ code: 'holdover_not_started' });
    expect(await openRemovalReview(7, at('2026-10-17T15:00:00Z'))).toEqual({ state: 'removal_review' });
    expect(await rental()).toMatchObject({ rentalState: 'removal_review', occupancy: '[2026-10-01,)' });
  });
  it('sends the final notice once with photos and an item list, and sets the 48 h and 7 day deadlines', async () => {
    await review();
    await expect(sendFinalNotice(7, 9, { photos: [], items }, notice)).rejects.toMatchObject({ code: 'invalid_details', status: 400 });
    const result = await sendFinalNotice(7, 9, { photos, items }, notice);
    expect(result.perishablesAfter.toISOString()).toBe('2026-10-22T15:00:00.000Z');
    expect(result.othersAfter.toISOString()).toBe('2026-10-27T15:00:00.000Z');
    expect(h.notices).toHaveBeenCalledWith(expect.anything(), 7, 'final_notice', expect.objectContaining({ photos: 1 }));
    expect((await rental()).removalReview).toMatchObject({ items, photos, finalNoticeAt: notice.toISOString() });
    await expect(sendFinalNotice(7, 9, { photos, items }, notice)).rejects.toMatchObject({ code: 'final_notice_sent' });
  });
  it('refuses removal before the final notice, before each deadline, and for a kitchen while the toggle is off', async () => {
    await review();
    await expect(recordRemoval(7, { id: 2, role: 'manager' }, { all: true }, notice)).rejects.toMatchObject({ code: 'final_notice_required' });
    await sendFinalNotice(7, 9, { photos, items }, notice);
    await expect(recordRemoval(7, { id: 2, role: 'manager' }, { all: true }, at('2026-11-30T00:00:00Z'))).rejects.toMatchObject({ code: 'disposal_disabled', status: 403 });
    await enable(true);
    await expect(recordRemoval(7, { id: 2, role: 'manager' }, { itemIndexes: [0] }, at('2026-10-22T14:59:00Z'))).rejects.toMatchObject({ code: 'removal_too_early' });
    await expect(recordRemoval(7, { id: 2, role: 'manager' }, { itemIndexes: [1] }, at('2026-10-26T00:00:00Z'))).rejects.toMatchObject({ code: 'removal_too_early' });
    await expect(recordRemoval(7, { id: 99, role: 'manager' }, { all: true }, at('2026-11-30T00:00:00Z'))).rejects.toMatchObject({ code: 'not_found' });
    expect((await rental()).rentalState).toBe('removal_review');
  });
  it('ends the rental as cleared only when every item is recorded as removed', async () => {
    await review(); await enable(true);
    await sendFinalNotice(7, 9, { photos, items }, notice);
    expect(await recordRemoval(7, { id: 2, role: 'manager' }, { itemIndexes: [0] }, at('2026-10-22T15:00:00Z'))).toEqual({ state: 'removal_review', remaining: 1 });
    expect(await recordRemoval(7, { id: 2, role: 'manager' }, { all: true }, at('2026-10-27T15:00:00Z'))).toEqual({ state: 'ended', remaining: 0 });
    expect(await rental()).toMatchObject({ rentalState: 'ended', endReason: 'cleared', releasedOn: '2026-10-27', occupancy: '[2026-09-01,2026-10-27)', status: 'completed' });
    expect(sent().filter((key: string) => key.includes('removal_recorded'))).toHaveLength(2);
  });
  it('lets an admin record removal with the kitchen toggle off, but not before the deadline', async () => {
    await review();
    await sendFinalNotice(7, 9, { photos, items }, notice);
    await expect(recordRemoval(7, { id: 9, role: 'admin' }, { all: true }, at('2026-10-23T00:00:00Z'))).rejects.toMatchObject({ code: 'removal_too_early' });
    expect(await recordRemoval(7, { id: 9, role: 'admin' }, { all: true }, at('2026-10-28T00:00:00Z'))).toMatchObject({ state: 'ended' });
  });
});
