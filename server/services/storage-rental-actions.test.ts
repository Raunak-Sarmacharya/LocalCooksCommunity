import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const h = vi.hoisted(() => ({ db: null as any, notices: vi.fn(), refund: vi.fn(), releases: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: h.notices }));
vi.mock('./storage-rental-money', () => ({ refundRentalUnused: h.refund, previewStorageRefund: async () => ({ kitchenCents: 34368, customerCents: 35532 }), recoverStorageRefund: vi.fn(async () => ({ success: true })) }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async () => ({ platformCommissionInCents: 1031 }) }));
vi.mock('./overstay-penalty-service', () => ({ hasChefUnpaidPenalties: async () => false, processManagerDecision: async () => ({ success: true }) }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('./damage-claims-v2', () => ({ readClaimBookingHold: async () => ({ held: false }) }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Morgan' }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('../email', () => ({ renderTransactionalEmail: vi.fn() }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));

import { previewStorageTool, reclaimPreview, runStorageTool, setStorageUnitService } from './storage-rental-actions';
import { freeUnit, readRental } from './storage-rentals';
import { listingAvailability, occupancyByListing } from './storage-availability';
import { ADMIN_STORAGE_ACTIONS, adminStorageDetail, adminStorageList, runAdminStorageAction } from './admin-storage';
import { storageTermPayoutFacts } from './storage-payouts';
import { assertBookingMoneyWritable } from './booking-money-guard';

const { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, bookingFlags, supportActions,
  commitmentProblems, damageClaims, storageOverstayRecords, platformSettings, kitchenBookingDayPayouts } = schema;
const tables = [schema.checkinCheckoutChecklists, kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, bookingFlags, supportActions,
  commitmentProblems, damageClaims, storageOverstayRecords, platformSettings, schema.emailLogs, schema.equipmentBookings, schema.kitchenBookings, schema.kitchenBookingChanges, kitchenBookingDayPayouts];
let pg: PGlite;
const now = new Date('2026-10-10T12:00:00Z');
const manager = { id: 2, role: 'manager' as const }, admin = { id: 4, role: 'admin' as const };
const rental = async () => (await h.db.select().from(storageBookings).where(eq(storageBookings.id, 7)))[0];
const term = { id: 1, startsOn: '2026-10-01', endsOn: '2026-10-30', days: 30, subtotalCents: 30001, taxCents: 4500, serviceFeeCents: 1031, totalCents: 35532 };
const adminInput = (type: typeof ADMIN_STORAGE_ACTIONS[number], extra = {}) => ({ type, reason: 'Reviewed with the kitchen.', operationKey: `admin-${type}`, fundedBy: 'none' as const, ...extra });

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  pg = new PGlite({ extensions: { btree_gist } }); h.db = drizzle(pg);
  const dialect = new PgDialect();
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => {
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${c.enumValues ? 'text' : c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
  const migration = readFileSync(new URL('../../migrations/0093_storage_rentals.sql', import.meta.url), 'utf8');
  await pg.exec(`CREATE EXTENSION btree_gist; ${migration.match(/ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap[\s\S]*?;/)![0]}
    CREATE TABLE manager_notifications (id serial, title text, metadata jsonb, manager_id integer, created_at timestamp DEFAULT now());
    CREATE TABLE chef_notifications (id serial, title text, metadata jsonb, created_at timestamp DEFAULT now());
    CREATE UNIQUE INDEX support_operation_key ON support_actions(operation_key);
    ALTER TABLE support_actions ADD CHECK (funded_by IN ('manager','local_cooks','none')),
      ADD CHECK (status IN ('executing','verified','failed','recovery_required')),
      ADD CHECK (acting_for IN ('chef','manager','local_cooks')),
      ADD CHECK (request_source IN ('message','call','email','in_person','proactive')),
      ADD CHECK (length(btrim(internal_note)) >= 10);`);
}, 120000);
afterAll(async () => { await pg?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks();
  h.refund.mockResolvedValue({ rentalId: 7, refunds: [{ status: 'succeeded' }] });
  for (const table of tables) await h.db.delete(table);
  await pg.exec('DELETE FROM manager_notifications; DELETE FROM chef_notifications;');
  await h.db.insert(users).values([{ id: 2, username: 'manager@example.invalid', role: 'manager' }, { id: 3, username: 'chef@example.invalid', role: 'chef' }, { id: 4, username: 'admin@example.invalid', role: 'admin' }]);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', unitCount: 2, basePrice: '1000', pricingModel: 'daily' });
  await h.db.insert(storageBookings).values({ id: 7, referenceCode: 'SB-7', chefId: 3, storageListingId: 1, unitIndex: 1, rentalState: 'active',
    termStart: term.startsOn, paidThrough: term.endsOn, timezone: 'America/St_Johns', rentalTerms: { version: 'storage-v1', dailyPriceCents: 1000, taxRatePercent: 15 },
    startDate: now, endDate: now, totalPrice: String(term.totalCents), pricingModel: 'daily', occupancy: '[2026-10-01,2026-11-05)' });
  await h.db.insert(storageRentalTerms).values({ ...term, rentalId: 7, seq: 1, kind: 'first', dailyPriceCents: 1000, status: 'paid', paidAt: now,
    requestKey: 'first-term', paymentTransactionId: 1, paymentIntentId: 'pi_private' });
  await h.db.insert(paymentTransactions).values({ id: 1, bookingId: 7, bookingType: 'storage', chefId: 3, managerId: 2, amount: String(term.totalCents),
    baseAmount: '34501', serviceFee: '1031', managerRevenue: '34368', stripeProcessingFee: '133', netAmount: String(term.totalCents), status: 'succeeded',
    paymentIntentId: 'pi_private', transferId: 'tr_private', payoutTiming: 'storage_term', paidAt: now });
});

describe('kitchen storage tools', () => {
  it('reclaims a 30-day term on day 10 with 7 days notice: 13 unused days, exact cents including the fee share', async () => {
    expect(reclaimPreview({ termStart: term.startsOn, paidThrough: term.endsOn }, [term], '2026-10-10', '2026-10-17')).toMatchObject({ unusedDays: 13, amountCents: 15397,
      shares: [{ unusedDays: 13, customer: 15397, managerDebited: 14950, platformServiceFeeReturned: 447 }] });
    await runStorageTool(7, manager, 'move-out-by', { byDate: '2026-10-17', reason: 'Freezer repair', operationKey: 'reclaim-fixture' }, now);
    expect(h.refund).toHaveBeenCalledWith(7, expect.objectContaining({ cause: 'kitchen', fromDate: '2026-10-18', operationKey: 'reclaim-fixture' }));
    expect((await rental()).reclaim.pending).toBe(false);
    expect(h.notices.mock.calls.filter(call => call[2] === 'reclaim')).toHaveLength(1);
  });
  it('refuses a short kitchen reclaim and permits an admin emergency', async () => {
    await h.db.update(storageBookings).set({ termStart: '2026-10-10', paidThrough: '2026-10-12' }).where(eq(storageBookings.id, 7));
    const input = { byDate: '2026-10-10', reason: 'Urgent repair', operationKey: 'short-reclaim', emergency: true };
    await expect(runStorageTool(7, manager, 'move-out-by', input, now)).rejects.toThrow('reclaim_not_allowed');
    expect(h.refund).not.toHaveBeenCalled();
    expect(await runStorageTool(7, admin, 'move-out-by', input, now)).toMatchObject({ success: true });
  });
  it('does not shorten occupancy or notify before a refund is verified; retry uses the same key', async () => {
    h.refund.mockResolvedValueOnce({ refunds: [{ status: 'recovery_required' }] });
    const input = { byDate: '2026-10-17', reason: 'Freezer repair', operationKey: 'retry-reclaim' };
    expect(await runStorageTool(7, manager, 'move-out-by', input, now)).toMatchObject({ recoveryRequired: true });
    expect((await rental()).occupancy).toBe('[2026-10-01,2026-11-05)');
    const future = { rentalState: 'requested' as const, termStart: '2026-10-25', paidThrough: '2026-10-26' };
    expect(await freeUnit(h.db, 1, 2, future, '2026-10-10', undefined, 1)).toBeNull();
    expect(h.notices.mock.calls.some(call => call[2] === 'reclaim')).toBe(false);
    await expect(runStorageTool(7, manager, 'move-out-by', { ...input, byDate: '2026-10-18' }, now)).rejects.toThrow('operation_changed');
    await runStorageTool(7, manager, 'move-out-by', input, now);
    await runStorageTool(7, manager, 'move-out-by', input, now);
    expect(h.refund).toHaveBeenCalledTimes(2);
    expect(h.notices.mock.calls.filter(call => call[2] === 'reclaim')).toHaveLength(1);
    expect(await freeUnit(h.db, 1, 2, future, '2026-10-10', undefined, 1)).toBe(1);
  });
  it('checks ownership, pending payments, required reasons and unit conflicts', async () => {
    await expect(runStorageTool(7, { id: 99, role: 'manager' }, 'change-unit', { unitIndex: 2, reason: 'Move freezer' })).rejects.toMatchObject({ status: 404 });
    await expect(runStorageTool(7, manager, 'change-unit', { unitIndex: 2 })).rejects.toThrow();
    const current = await rental();
    await h.db.insert(storageBookings).values({ ...current, id: 8, referenceCode: 'SB-8', unitIndex: 2 });
    await expect(runStorageTool(7, manager, 'change-unit', { unitIndex: 2, reason: 'Move freezer' })).rejects.toMatchObject({ status: 409, code: 'full' });
    await h.db.delete(storageBookings).where(eq(storageBookings.id, 8));
    await runStorageTool(7, manager, 'change-unit', { unitIndex: 2, reason: 'Move freezer' });
    expect((await rental()).unitIndex).toBe(2);
  });
  it('caps a kitchen refund at the remaining kitchen net', async () => {
    expect(await previewStorageTool(7, manager, 'refund', {})).toMatchObject({ maxAmountCents: 34368 });
    await expect(runStorageTool(7, manager, 'refund', { amountCents: 34369, reason: 'Courtesy refund', operationKey: 'refund-too-large' })).rejects.toThrow('refund_too_large');
    await runStorageTool(7, manager, 'refund', { amountCents: 501, reason: 'Courtesy refund', operationKey: 'refund-fixture' });
    expect(h.refund).toHaveBeenCalledWith(7, expect.objectContaining({ cause: 'goodwill_kitchen', amountCents: 501 }));
    // The kitchen sees the same net the transfer will send: kitchen-funded refunds come out of it.
    await h.db.update(paymentTransactions).set({ metadata: { refunds: [{ managerDebited: 1035 }] } }).where(eq(paymentTransactions.id, 1));
    expect((await readRental(7, manager, now)).terms[0].payoutCents).toBe(34368 - 1035);
  });
  it('offers a fully priced extension by notice, without charging', async () => {
    await h.db.update(storageBookings).set({ paidThrough: '2026-10-12' }).where(eq(storageBookings.id, 7));
    expect(await runStorageTool(7, manager, 'offer-extension', { days: 7 })).toMatchObject({ amountCents: 9081 });
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.notices.mock.calls.at(-1)?.slice(1, 3)).toEqual([7, 'offer_extension']);
  });
  it('only releases a requested move-out or a confirmed no-show after seven days', async () => {
    await expect(runStorageTool(7, manager, 'release', { reason: 'Unit is empty' })).rejects.toThrow('visit_action_invalid');
    await h.db.update(storageBookings).set({ rentalState: 'move_out_requested' }).where(eq(storageBookings.id, 7));
    await runStorageTool(7, manager, 'release', { reason: 'Unit is empty' });
    expect(await rental()).toMatchObject({ rentalState: 'ended', releasedOn: '2026-10-10' });
    expect(h.refund).not.toHaveBeenCalled();
  });
});

describe('unit service state', () => {
  it('requires a reason and owner, leaves the renter in place, blocks only that unit and can restore it', async () => {
    await expect(setStorageUnitService(1, 2, 2, true, '')).rejects.toThrow();
    await expect(setStorageUnitService(1, 99, 2, true, 'Repair')).rejects.toMatchObject({ status: 404 });
    await setStorageUnitService(1, 2, 2, true, 'Broken freezer');
    await setStorageUnitService(1, 2, 1, true, 'Repair after move-out');
    expect((await rental()).unitIndex).toBe(1);
    const dates = { rentalState: 'requested' as const, termStart: '2026-10-10', paidThrough: '2026-10-12' };
    expect(await freeUnit(h.db, 1, 2, dates, '2026-10-10')).toBeNull();
    expect(listingAvailability(2, (await occupancyByListing([1], '2026-10-10', h.db)).get(1)!, '2026-10-10')).toEqual({ state: 'full' });
    await setStorageUnitService(1, 2, 2, false, 'Repair completed');
    expect(await freeUnit(h.db, 1, 2, dates, '2026-10-10')).toBe(2);
    expect(listingAvailability(2, (await occupancyByListing([1], '2026-10-10', h.db)).get(1)!, '2026-10-10')).toEqual({ state: 'now' });
  });
});

describe('server-advertised kitchen actions', () => {
  it('offers the route names for uncovered holdover, stops with an open charge and honours settled days', async () => {
    await h.db.update(storageBookings).set({ paidThrough: '2026-10-01' }).where(eq(storageBookings.id, 7));
    let dto = await readRental(7, manager, now);
    expect(dto.actions).toEqual(expect.arrayContaining(['holdover-charge', 'holdover-waive']));
    expect(dto.holdoverChargeCents).toBe(4600);
    await h.db.insert(storageOverstayRecords).values({ id: 1, storageBookingId: 7, status: 'penalty_approved', daysOverdue: 4, idempotencyKey: 'holdover:7:2026-10-01:4', endDate: now, gracePeriodEndsAt: now, dailyRateCents: 1000, penaltyRate: '0', calculatedPenaltyCents: 4000 });
    dto = await readRental(7, manager, now);
    expect(dto.actions).not.toContain('holdover-charge'); expect(dto.actions).not.toContain('holdover-waive');
    await h.db.update(storageOverstayRecords).set({ status: 'penalty_waived' }).where(eq(storageOverstayRecords.id, 1));
    expect((await readRental(7, manager, now)).actions).not.toContain('holdover-charge');
  });
  it('offers removal only with the toggle, final notice and eligible item deadline', async () => {
    await h.db.update(storageBookings).set({ rentalState: 'removal_review', removalReview: { finalNoticeAt: '2026-10-01T00:00:00Z',
      perishablesAfter: '2026-10-03T00:00:00Z', othersAfter: '2026-10-12T00:00:00Z', items: [{ name: 'Food', perishable: true }, { name: 'Box', perishable: false }] } }).where(eq(storageBookings.id, 7));
    expect((await readRental(7, manager, now)).actions).not.toContain('removal/record');
    await h.db.insert(platformSettings).values({ key: 'storage_kitchen_disposal_enabled', value: 'true' });
    expect(await readRental(7, manager, now)).toMatchObject({ actions: expect.arrayContaining(['removal/record']), removalItemIndexes: [0] });
  });
});

describe('admin storage support', () => {
  it.each(ADMIN_STORAGE_ACTIONS)('audits every attempted %s with an operation key and funding', async type => {
    const extra = type === 'goodwill_refund' ? { amountCents: 500, fundedBy: 'local_cooks' as const } : {};
    try { await runAdminStorageAction(7, 4, adminInput(type, extra)); } catch { /* invalid lifecycle states are audited too */ }
    const rows = await h.db.select().from(supportActions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storageBookingId: 7, actionType: type, operationKey: `admin-${type}`, fundedBy: type === 'goodwill_refund' ? 'local_cooks' : 'none', actorUserId: 4 });
    expect(['verified', 'recovery_required', 'failed']).toContain(rows[0].status);
  });
  it('Local Cooks goodwill chooses zero kitchen debit; repeat does not send a second refund', async () => {
    const input = adminInput('goodwill_refund', { amountCents: 500, fundedBy: 'local_cooks' as const });
    await runAdminStorageAction(7, 4, input);
    await runAdminStorageAction(7, 4, input);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.refund).toHaveBeenCalledWith(7, expect.objectContaining({ cause: 'goodwill_lc', amountCents: 500 }));
    expect((await h.db.select().from(paymentTransactions))[0].transferId).toBe('tr_private');
  });
  it('only a linked refund recovery may pass its original support hold, and flags still block it', async () => {
    const base = { storageBookingId: 7, caseRef: 'SB-7', actorUserId: 4, actingFor: 'manager', requestSource: 'proactive', reasonCode: 'reviewed',
      internalNote: 'Reviewed with the kitchen.', fundedBy: 'none', beforeState: {} };
    await h.db.insert(supportActions).values({ ...base, id: 1, actionType: 'goodwill_refund', operationKey: 'original-refund', status: 'recovery_required' });
    await h.db.insert(supportActions).values({ ...base, id: 2, actionType: 'retry_refund', operationKey: 'linked-recovery', status: 'executing', beforeState: { recoveryFor: ['original-refund'] } });
    await expect(assertBookingMoneyWritable({ storageRentalId: 7, operationKey: 'linked-recovery' })).resolves.toBeUndefined();
    await expect(assertBookingMoneyWritable({ storageRentalId: 7, operationKey: 'original-refund' })).resolves.toBeUndefined();
    await expect(assertBookingMoneyWritable({ storageRentalId: 7, operationKey: 'unrelated-refund' })).rejects.toThrow('paused');
    await h.db.insert(bookingFlags).values({ storageBookingId: 7, kind: 'manual_hold', providerRef: 'hold' });
    await expect(assertBookingMoneyWritable({ storageRentalId: 7, operationKey: 'linked-recovery' })).rejects.toThrow('paused');
  });
  it('receipt-only recovery never starts a refund; retry resumes and closes the original audit', async () => {
    h.refund.mockResolvedValueOnce({ refunds: [{ status: 'recovery_required' }] });
    await expect(runAdminStorageAction(7, 4, adminInput('goodwill_refund', { amountCents: 500, fundedBy: 'local_cooks' as const }))).rejects.toThrow('refund_pending');
    await expect(runAdminStorageAction(7, 4, adminInput('mark_refunded'))).rejects.toThrow('refund_pending');
    expect(h.refund).toHaveBeenCalledTimes(1);
    await runAdminStorageAction(7, 4, adminInput('retry_refund'));
    expect(h.refund).toHaveBeenCalledTimes(2);
    expect(h.refund.mock.calls.map(call => call[1].operationKey)).toEqual(['admin-goodwill_refund', 'admin-goodwill_refund']);
    const audit = await h.db.select().from(supportActions);
    expect(audit.find((row: any) => row.actionType === 'goodwill_refund').status).toBe('verified');
    expect(audit.find((row: any) => row.actionType === 'retry_refund').status).toBe('verified');
    expect((await rental()).assistanceHistory.every((entry: any) => entry.complete)).toBe(true);
  });
  it('filters by state, kitchen, query and attention, and removes provider references from detail', async () => {
    expect(await adminStorageList({ state: 'reserved' }, 4)).toHaveLength(0);
    expect(await adminStorageList({ kitchenId: 2 }, 4)).toHaveLength(0);
    expect(await adminStorageList({ q: 'harbour' }, 4)).toHaveLength(1);
    expect(await adminStorageList({ q: 'unknown' }, 4)).toHaveLength(0);
    expect(await adminStorageList({ needsAttention: true }, 4)).toHaveLength(0);
    await runAdminStorageAction(7, 4, adminInput('open_flag'));
    expect(await adminStorageList({ needsAttention: true }, 4)).toHaveLength(1);
    const dto = await adminStorageDetail(7, 4);
    expect(dto.payments[0]).toMatchObject({ transferSent: true, amountCents: 35532 });
    expect(JSON.stringify(dto)).not.toMatch(/pi_private|tr_private|paymentIntentId|transferId|providerRef/);
  });
  it('includes in-app notices even when no email was queued', async () => {
    await pg.exec(`INSERT INTO manager_notifications(title, manager_id, metadata) VALUES ('Refund issued',4,'{"storageRentalId":7}');`);
    expect((await adminStorageDetail(7, 4)).notices).toEqual([expect.objectContaining({ subject: 'Refund issued', channel: 'in_app', role: 'admin' })]);
  });
  it('a payout problem override expires when the problem is revised and never bypasses a flag', async () => {
    await h.db.insert(commitmentProblems).values({ id: 1, sourceKey: 'storage:7', kind: 'live', storageBookingId: 7, reportedBy: 3, description: 'Locked door', revision: 1 });
    expect((await storageTermPayoutFacts(7, h.db)).openProblem).toBe(true);
    await runAdminStorageAction(7, 4, adminInput('release_payout'));
    expect((await storageTermPayoutFacts(7, h.db)).openProblem).toBe(false);
    await h.db.update(commitmentProblems).set({ revision: 2 }).where(eq(commitmentProblems.id, 1));
    expect((await storageTermPayoutFacts(7, h.db)).openProblem).toBe(true);
    await runAdminStorageAction(7, 4, adminInput('open_flag'));
    expect((await storageTermPayoutFacts(7, h.db)).openFlag).toBe(true);
    await h.db.update(paymentTransactions).set({ transferId: null }).where(eq(paymentTransactions.id, 1));
    await expect(runAdminStorageAction(7, 4, adminInput('release_payout', { operationKey: 'release-flagged' }))).rejects.toThrow('payout_held');
    expect((await h.db.select().from(paymentTransactions))[0].transferId).toBeNull();
  });
});
