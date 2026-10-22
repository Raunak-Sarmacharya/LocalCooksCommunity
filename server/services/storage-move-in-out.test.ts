import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const h = vi.hoisted(() => ({ db: null as any, notices: vi.fn(), claimNotices: vi.fn(), oldNotice: vi.fn(), create: vi.fn(), transfer: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({ default: class { paymentIntents = { create: h.create, retrieve: h.retrieve }; transfers = { create: h.transfer }; } }));
vi.mock('./booking-documents', () => ({ issueStorageDocumentsSafely: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('../domains/users/chef.service', () => ({ chefService: {} }));
vi.mock('./overstay-penalty-service', () => ({ hasChefUnpaidPenalties: vi.fn() }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: vi.fn() }));
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: h.notices }));
vi.mock('./damage-claim-notices', () => ({ queueDamageClaimNotice: h.claimNotices }));
vi.mock('./outcome-delivery', () => ({ queueStorageVisitAction: h.oldNotice, attemptOutcomeDeliveryAfterResponse: vi.fn() }));
vi.mock('./booking-lifecycle-delivery', () => ({}));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('../email', () => ({ renderTransactionalEmail: () => ({ text: '', html: '' }), emailLocalDateTime: (date: Date) => date.toISOString() }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Sam' }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
vi.mock('../i18n', () => ({ ensureServerI18n: async () => {}, tLocale: (_locale: unknown, key: string) => key }));

import { requestStorageCheckin, requestStorageCheckout, storageRentalVisitAction, autoCleanExpiredCheckout, processExpiredCheckoutReviews } from './storage-checkout-service';
import { readRental } from './storage-rentals';
import { reportProblem, updateProblem, listProblems } from './commitment-problems';
import { fileDamageClaim, readBookingClaims, readStorageClaimFilingContext, decideDamageClaim, claimBelongsTo } from './damage-claims-v2';
import { storageTermPayoutFacts } from './storage-payouts';
import { prepareClaimPayment, settleClaimPayment } from './damage-claim-money';

const { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, commitmentProblems,
  damageClaims, damageEvidence, damageClaimHistory, bookingFlags, supportActions, platformSettings, emailLogs,
  checkinCheckoutChecklists, kitchenCheckoutIncidents, kitchenBookingChanges, equipmentBookings, kitchenBookingDayPayouts } = schema;
const tables = [schema.kitchenBookings, schema.storageOverstayRecords, kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, commitmentProblems,
  damageClaims, damageEvidence, damageClaimHistory, bookingFlags, supportActions, platformSettings, emailLogs,
  checkinCheckoutChecklists, kitchenCheckoutIncidents, kitchenBookingChanges, equipmentBookings, kitchenBookingDayPayouts];
let pg: PGlite;
const now = new Date('2026-10-16T12:00:00Z');
const chef = { id: 3, role: 'chef' as const }, manager = { id: 2, role: 'manager' as const };
const rental = async () => (await h.db.select().from(storageBookings).where(eq(storageBookings.id, 7)))[0];
const payment = async () => (await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, 1)))[0];
const cost = { type: 'damage', description: 'Replace cracked tray', amountCents: 2000,
  document: { fileUrl: 'https://files.localcooks.ca/quote.pdf', fileName: 'quote.pdf' } };
const filing = { storageRentalId: 7, description: 'The tray was broken during storage.', lines: [cost], requestKey: 'claim-storage-one' };
const support = (claimId: number, type: string, extra = {}) => ({ claimId, type, operationKey: `support-${type}`, reasonCode: 'reviewed',
  note: 'Private staff review of this claim.', publicMessage: 'We reviewed the evidence you provided.', requestSource: 'proactive', ...extra });

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  pg = new PGlite({ extensions: { btree_gist } }); h.db = drizzle(pg);
  const dialect = new PgDialect();
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
  const migration = readFileSync(new URL('../../migrations/0093_storage_rentals.sql', import.meta.url), 'utf8');
  await pg.exec(`CREATE EXTENSION btree_gist; ${migration.match(/ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap[\s\S]*?;/)![0]}`);
}, 120000);
afterAll(async () => { await pg?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks();
  h.create.mockImplementation(async (params: any) => ({ id: 'pi_claim', client_secret: 'test_secret', status: 'requires_confirmation', ...params }));
  h.transfer.mockResolvedValue({ id: 'tr_claim' });
  h.retrieve.mockResolvedValue({ latest_charge: { balance_transaction: { fee: 88 } } });
  for (const table of tables) await h.db.delete(table);
  await h.db.insert(users).values([{ id: 2, role: 'manager', username: 'kitchen@example.invalid' },
    { id: 3, role: 'chef', username: 'chef@example.invalid' }, { id: 4, role: 'admin', username: 'admin@example.invalid' }]);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', unitCount: 1, basePrice: '1000', pricingModel: 'daily' });
  await h.db.insert(storageBookings).values({ id: 7, referenceCode: 'SB-7', storageListingId: 1, chefId: 3, rentalState: 'reserved',
    unitIndex: 1, termStart: '2026-10-16', paidThrough: '2026-10-18', timezone: 'America/St_Johns', approvedAt: now,
    rentalTerms: { version: 'storage-v1', dailyPriceCents: 1000, taxRatePercent: 15 }, status: 'confirmed',
    startDate: now, endDate: new Date('2026-10-18T12:00:00Z'), totalPrice: '3550', pricingModel: 'daily', occupancy: '[2026-10-16,2026-10-24)' });
  await h.db.insert(storageRentalTerms).values({ id: 1, rentalId: 7, seq: 1, kind: 'first', startsOn: '2026-10-16', endsOn: '2026-10-18', days: 3,
    dailyPriceCents: 1000, subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550, status: 'paid', requestKey: 'first-term',
    paymentTransactionId: 1, paidAt: now });
  await h.db.insert(paymentTransactions).values({ id: 1, bookingId: 7, bookingType: 'storage', chefId: 3, managerId: 2, amount: '3550', baseAmount: '3450',
    serviceFee: '100', netAmount: '3550', managerRevenue: '3450', currency: 'CAD', status: 'succeeded', payoutTiming: 'storage_term', paidAt: now });
});

describe('storage move-in and move-out', () => {
  it('the old chef dialog activates a rental, schedules term 1 at term end and queues the localized notice', async () => {
    expect(await requestStorageCheckin(7, 3, 'Shelf is clean', ['https://files.localcooks.ca/before.jpg'])).toMatchObject({ success: true });
    expect(await rental()).toMatchObject({ rentalState: 'active', checkinStatus: 'checkin_completed' });
    expect((await payment()).payoutEligibleAt.toISOString()).toBe('2026-10-19T02:30:00.000Z');
    expect(h.notices.mock.calls.some(call => call[2] === 'moved_in')).toBe(true); expect(h.oldNotice).not.toHaveBeenCalled();
  });
  it('allows move-out without move-in and marks the missing baseline', async () => {
    expect(await requestStorageCheckout(7, 3, 'All items removed')).toMatchObject({ success: true });
    expect(await rental()).toMatchObject({ rentalState: 'move_out_requested', rentalTerms: { noBaseline: true } });
    expect(h.notices.mock.calls.find(call => call[2] === 'move_out_requested')?.[3]).toMatchObject({ date: now, deadline: new Date('2026-10-16T14:00:00Z') });
    expect((await readRental(7, manager)).actions).toEqual(['clear-move-out', 'release', 'refund']);
  });
  it('advertises exactly the allowed kitchen route names and both chef action spellings', async () => {
    expect((await readRental(7, manager)).actions).toEqual(['handover', 'move-out-by', 'refund', 'offer-extension']);
    expect((await readRental(7, chef)).actions).toEqual(['move-in', 'move_in', 'move-out', 'move_out', 'report_problem', 'extend']);
    await storageRentalVisitAction(7, manager, 'handover', { photoUrls: ['https://files.localcooks.ca/handover.jpg'], note: 'Ready for you' });
    expect((await rental()).rentalState).toBe('active');
    expect((await payment()).payoutEligibleAt.toISOString()).toBe('2026-10-19T02:30:00.000Z');
    expect((await readRental(7, manager)).actions).toEqual(['move-out-by', 'refund', 'offer-extension']);
    await requestStorageCheckout(7, 3);
    expect((await rental()).rentalTerms.noBaseline).toBe(true);
  });
  it('rejects wrong participants, actions before start, invalid evidence and repeated move-in', async () => {
    await expect(storageRentalVisitAction(7, { id: 99, role: 'manager' }, 'handover')).rejects.toMatchObject({ status: 404 });
    await expect(storageRentalVisitAction(7, chef, 'move-in', {}, new Date('2026-10-15'))).rejects.toMatchObject({ status: 409 });
    await expect(storageRentalVisitAction(7, chef, 'move-in', { photoUrls: ['not-a-url'] })).rejects.toMatchObject({ status: 400 });
    await storageRentalVisitAction(7, chef, 'move-in');
    await expect(storageRentalVisitAction(7, chef, 'move-in')).rejects.toMatchObject({ status: 409 });
  });
  it('clears occupancy, keeps cleaning blocked until mark-ready, and reschedules payout to the clear time', async () => {
    await storageRentalVisitAction(7, chef, 'move-out');
    await storageRentalVisitAction(7, manager, 'clear-move-out', { needsCleaning: true });
    expect(await rental()).toMatchObject({ rentalState: 'ended', endReason: 'cleared', releasedOn: '2026-10-16', needsCleaning: true });
    expect((await rental()).occupancy).toBe('[2026-10-16,)');
    expect((await payment()).payoutEligibleAt.toISOString()).toBe(now.toISOString());
    expect((await readRental(7, manager)).actions).toContain('mark-ready');
    await storageRentalVisitAction(7, manager, 'mark-ready'); expect((await rental()).occupancy).toBeNull();
  });
  it('reopens within 7 days and preserves the original departure evidence and release timestamp', async () => {
    await storageRentalVisitAction(7, chef, 'move-out', { note: 'Chef note', photoUrls: ['https://files.localcooks.ca/after.jpg'] });
    await storageRentalVisitAction(7, manager, 'clear-move-out');
    await storageRentalVisitAction(7, manager, 'items-still-here', { note: 'Box left on shelf', photoUrls: ['https://files.localcooks.ca/box.jpg'] });
    expect(await rental()).toMatchObject({ rentalState: 'active', reopenedFrom: now, checkoutRequestedAt: now, checkoutNotes: 'Chef note',
      checkoutPhotoUrls: ['https://files.localcooks.ca/after.jpg'], releasedOn: null });
  });
  it('returns 409 after 8 days and hides the reopen action', async () => {
    await storageRentalVisitAction(7, chef, 'move-out'); await storageRentalVisitAction(7, manager, 'clear-move-out');
    const late = new Date(now.getTime() + 8 * 86400000);
    await expect(storageRentalVisitAction(7, manager, 'items-still-here', { photoUrls: ['https://files.localcooks.ca/box.jpg'] }, late)).rejects.toMatchObject({ status: 409 });
    expect((await readRental(7, manager, late)).actions).not.toContain('items-still-here');
  });
  it('returns 409 if the shelf has been re-let, including a future reservation', async () => {
    await storageRentalVisitAction(7, chef, 'move-out'); await storageRentalVisitAction(7, manager, 'clear-move-out');
    await h.db.insert(storageBookings).values({ ...(await rental()), id: 8, referenceCode: 'SB-8', rentalState: 'reserved',
      endReason: null, releasedOn: null, occupancy: '[2026-10-20,2026-10-24)' });
    await expect(storageRentalVisitAction(7, manager, 'items-still-here', { photoUrls: ['https://files.localcooks.ca/box.jpg'] })).rejects.toMatchObject({ code: 'relet', status: 409 });
    expect((await readRental(7, manager)).actions).not.toContain('items-still-here');
  });
  it('auto-clears once and keeps payout behind the full 72-hour claim window', async () => {
    await requestStorageCheckout(7, 3); vi.setSystemTime(new Date(now.getTime() + 3 * 3600000));
    expect(await autoCleanExpiredCheckout(7, 3, now, 2)).toBe(true);
    expect(await autoCleanExpiredCheckout(7, 3, now, 2)).toBe(false);
    expect(await rental()).toMatchObject({ rentalState: 'ended', endReason: 'auto_cleared' });
    expect((await payment()).payoutEligibleAt.toISOString()).toBe('2026-10-19T12:00:00.000Z');
  });
});

describe('storage problems and claims', () => {
  it('a real storage report holds payout, and support resolution releases the hold', async () => {
    const problem = await reportProblem('storage', 7, chef, 'I cannot access my storage shelf.', 'storage-problem-key', 'access');
    expect(problem.storageBookingId).toBe(7); expect((await payment()).payoutHoldReason).toBe('reported_issue');
    expect(await listProblems(manager, 'storage', 7)).toHaveLength(1);
    await expect(listProblems({ id: 99, role: 'chef' }, 'storage', 7)).rejects.toMatchObject({ statusCode: 403 });
    await updateProblem(problem.id, { id: 4, role: 'admin' }, { action: 'claim', expectedRevision: 1 });
    await updateProblem(problem.id, { id: 4, role: 'admin' }, { action: 'acknowledge', expectedRevision: 2, note: 'We are checking access.' });
    await updateProblem(problem.id, { id: 4, role: 'admin' }, { action: 'resolve', expectedRevision: 3, note: 'Access has been restored.' });
    expect((await payment()).payoutHoldReason).toBeNull();
  });
  it('refuses claims at 73 hours, including after an automatic clear', async () => {
    await requestStorageCheckout(7, 3); vi.setSystemTime(new Date(now.getTime() + 73 * 3600000));
    await autoCleanExpiredCheckout(7, 3, now, 2);
    await expect(fileDamageClaim(2, filing)).rejects.toMatchObject({ status: 409 });
  });
  it('files review-first, caps at $250, attaches before/after evidence and holds payout', async () => {
    await requestStorageCheckin(7, 3, 'Clean shelf', ['https://files.localcooks.ca/before.jpg']);
    await storageRentalVisitAction(7, manager, 'handover', { photoUrls: ['https://files.localcooks.ca/handover.jpg'] });
    await requestStorageCheckout(7, 3, 'Tray cracked', ['https://files.localcooks.ca/after.jpg']);
    await expect(fileDamageClaim(2, { ...filing, lines: [{ ...cost, amountCents: 20000 }, cost, { ...cost, amountCents: 4000 }] })).rejects.toMatchObject({ status: 400 });
    const claim = await fileDamageClaim(2, filing);
    expect(claim).toMatchObject({ storageRentalId: 7, status: 'in_review', chefVisible: false, amountCents: 2000,
      visitEvidence: { before: ['https://files.localcooks.ca/before.jpg', 'https://files.localcooks.ca/handover.jpg'], after: ['https://files.localcooks.ca/after.jpg'], noBaseline: false } });
    expect(await rental()).toMatchObject({ rentalState: 'ended', endReason: 'claim' });
    expect((await payment()).payoutHoldReason).toBe('damage_claim');
    expect(await storageTermPayoutFacts(7)).toMatchObject({ openClaim: true });
    await expect(fileDamageClaim(2, { ...filing, requestKey: 'second-storage-claim' })).rejects.toMatchObject({ status: 409 });
    expect((await fileDamageClaim(2, filing)).id).toBe(claim.id);
  });
  it('keeps first-review private, shows noBaseline to staff and chef once sent, and resolves the payout hold', async () => {
    await requestStorageCheckout(7, 3);
    expect(await readStorageClaimFilingContext(7, 2)).toMatchObject({ noBaseline: true, baselineNote: 'No move-in photos were taken.' });
    const claim = await fileDamageClaim(2, filing);
    expect(claim.visitEvidence).toMatchObject({ noBaseline: true, baselineNote: 'No move-in photos were taken.' });
    expect((await readBookingClaims(7, chef, 'storage')).claims).toHaveLength(0);
    expect((await readBookingClaims(7, { id: 4, role: 'admin' }, 'storage')).claims).toHaveLength(1);
    await expect(decideDamageClaim(7, 4, support(claim.id, 'claim_send'))).rejects.toMatchObject({ status: 404 });
    await decideDamageClaim(7, 4, support(claim.id, 'claim_send'), 'storage');
    const visible = (await readBookingClaims(7, chef, 'storage')).claims[0];
    expect(visible.visitEvidence?.noBaseline).toBe(true); expect(visible.reviewRequest).toBeNull(); expect(visible.kitchenReply).toBeNull();
    expect(visible).not.toHaveProperty('adminNotes'); expect(visible).not.toHaveProperty('paymentOperation');
    expect(visible.history.map(item => item.action)).toEqual(['claim_send']);
    await expect(prepareClaimPayment(claim.id, 99)).rejects.toMatchObject({ status: 404 });
    // The correct rental money guard runs before customer/card lookup, without ever calling a provider.
    await h.db.insert(bookingFlags).values({ id: 1, storageBookingId: 7, kind: 'support', providerRef: 'review' });
    await h.db.update(damageClaims).set({ chefOwes: true }).where(eq(damageClaims.id, claim.id));
    await expect(prepareClaimPayment(claim.id, 3)).rejects.toThrow(/paused/);
    await decideDamageClaim(7, 4, support(claim.id, 'claim_close'), 'storage');
    expect((await payment()).payoutHoldReason).toBe('support_flag');
    expect(claimBelongsTo({ kitchenBookingId: 7, storageBookingId: null } as any, { kind: 'storage', id: 7 })).toBe(false);
  });
});

it('a reopened rental uses the prior release time for the 72-hour claim clock', async () => {
  await requestStorageCheckout(7, 3);
  vi.setSystemTime(new Date(now.getTime() + 3 * 3600000));
  await storageRentalVisitAction(7, manager, 'clear-move-out');
  vi.setSystemTime(new Date(now.getTime() + 73 * 3600000));
  await storageRentalVisitAction(7, manager, 'items-still-here', { note: 'A box remains.', photoUrls: ['https://files.localcooks.ca/box.jpg'] });
  expect((await readStorageClaimFilingContext(7, 2)).deadline).toBe('2026-10-19T15:00:00.000Z');
  expect(await fileDamageClaim(2, filing)).toMatchObject({ status: 'in_review' });
});

it('closing a storage claim clears its payout hold and audits the rental source', async () => {
  await requestStorageCheckout(7, 3);
  const claim = await fileDamageClaim(2, filing);
  expect((await payment()).payoutHoldReason).toBe('damage_claim');
  await decideDamageClaim(7, 4, support(claim.id, 'claim_close'), 'storage');
  expect((await payment()).payoutHoldReason).toBeNull();
  const [action] = await h.db.select().from(supportActions);
  expect(action).toMatchObject({ storageBookingId: 7, bookingId: null, actionType: 'claim_close', status: 'verified' });
});

it('a new move-out after reopening starts a new clock and clears reopenedFrom', async () => {
  await requestStorageCheckout(7, 3); await storageRentalVisitAction(7, manager, 'clear-move-out');
  await storageRentalVisitAction(7, manager, 'items-still-here', { photoUrls: ['https://files.localcooks.ca/box.jpg'] });
  vi.setSystemTime(new Date(now.getTime() + 24 * 3600000));
  await requestStorageCheckout(7, 3);
  expect((await rental()).reopenedFrom).toBeNull();
  expect((await readStorageClaimFilingContext(7, 2)).deadline).toBe('2026-10-20T12:00:00.000Z');
});

it('the existing checkout worker also persists the new ended state and payout gate', async () => {
  await requestStorageCheckout(7, 3);
  await h.db.update(storageBookings).set({ checkoutRequestedAt: new Date('2026-10-15T12:00:00Z') }).where(eq(storageBookings.id, 7));
  expect(await processExpiredCheckoutReviews()).toMatchObject({ processed: 1, cleared: 1, errors: 0 });
  expect(await rental()).toMatchObject({ rentalState: 'ended', endReason: 'auto_cleared' });
  expect((await payment()).payoutEligibleAt.toISOString()).toBe('2026-10-18T12:00:00.000Z');
});

it('storage claim payment uses the rental card/source, exact metadata, and clears the term hold on settlement', async () => {
  await h.db.update(users).set({ stripeConnectAccountId: 'acct_kitchen' }).where(eq(users.id, 2));
  await h.db.update(storageBookings).set({ stripeCustomerId: 'cus_chef', stripePaymentMethodId: 'pm_chef' }).where(eq(storageBookings.id, 7));
  await requestStorageCheckout(7, 3);
  const claim = await fileDamageClaim(2, filing);
  await decideDamageClaim(7, 4, support(claim.id, 'claim_send'), 'storage');
  await pg.exec("SELECT setval('payment_transactions_id_seq', 100)");
  expect(await prepareClaimPayment(claim.id, 3)).toMatchObject({ hasSavedCard: true, amountCents: 2000 });
  const params = h.create.mock.calls[0][0];
  expect(params).toMatchObject({ customer: 'cus_chef', payment_method: 'pm_chef', metadata: { booking_id: '7', storage_rental_id: '7' } });
  expect(params).not.toHaveProperty('confirm'); expect(params).not.toHaveProperty('off_session');
  const intent: any = { ...params, id: 'pi_claim', status: 'succeeded', amount_received: 2000, latest_charge: 'ch_claim' };
  await expect(settleClaimPayment({ ...intent, metadata: { ...intent.metadata, storage_rental_id: '99' } })).rejects.toThrow(/does not match/);
  await settleClaimPayment(intent);
  const sources = await h.db.select().from(paymentTransactions);
  expect(sources.find((row: any) => row.paymentIntentId === 'pi_claim')).toMatchObject({ bookingId: 7, bookingType: 'storage', status: 'succeeded' });
  expect((await payment()).payoutHoldReason).toBeNull();
  expect(h.transfer).toHaveBeenCalledTimes(1);
});

it('refuses external manager evidence even when called without the route', async () => {
  await expect(storageRentalVisitAction(7, manager, 'handover', { photoUrls: ['https://example.invalid/photo.jpg'] }))
    .rejects.toMatchObject({ status: 400 });
});
