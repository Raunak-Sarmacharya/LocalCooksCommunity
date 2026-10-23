import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { chefKitchenApplications, chefLocationAccess, emailLogs, kitchenBookings, kitchens, locations } from '@shared/schema';

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, writes: [] as string[], notify: vi.fn(), send: vi.fn(), requirements: { requireFoodHandlerCert: true } as any }));
vi.mock('../db', () => ({ db: database(), pool: {}, getDbError: (error: any) => error }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationRequirementsWithDefaults: async () => state.requirements } }));
vi.mock('./notification.service', () => ({ notificationService: { createForChef: state.notify, createForManager: vi.fn() } }));
vi.mock('../email', () => ({ sendEmail: state.send, renderTransactionalEmail: (data: any) => ({ to: data.to, subject: data.subject,
  text: `Hi ${data.recipientName},\n${data.message}\n${data.facts.map((fact: any) => fact.value).join('\n')}\n${data.actionUrl}\nLocal Cooks`, html: `<p>Hi ${data.recipientName}</p><p>${data.message}</p>` }) }));

// In-memory query/transaction harness. SQL predicates are evaluated, no drivers or providers run.
function database(): any {
  const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const matches = (row: any, condition: any) => {
    if (!condition) return true;
    const compiled = new PgDialect().sqlToQuery(condition);
    for (const match of compiled.sql.matchAll(/"\w+"\."(\w+)"\s*(=|>=)\s*\$(\d+)/g)) {
      const key = Object.keys(row).find(key => snake(key) === match[1]) || match[1];
      const expected = compiled.params[Number(match[3]) - 1];
      if (match[2] === '=' ? row[key] !== expected : row[key] < (expected as number)) return false;
    }
    return true;
  };
  const query = (get: () => any[]) => {
    let condition: any, limit = Infinity;
    const q: any = { where: (c: any) => { condition = c; return q; }, limit: (n: number) => { limit = n; return q; }, for: () => q, orderBy: () => q,
      innerJoin: () => q, leftJoin: () => q, then: (resolve: any, reject: any) => Promise.resolve(get().filter(row => matches(row, condition)).slice(0, limit)).then(resolve, reject) };
    return q;
  };
  const db: any = {
    select: () => ({ from: (table: any) => query(() => state.tables[getTableName(table)] || []) }),
    execute: vi.fn(async () => ({ rows: [] })),
    insert: (table: any) => ({ values: (data: any) => ({ returning: async () => {
      const name = getTableName(table); state.writes.push(`insert:${name}`); const row = { id: (state.tables[name] || []).length + 1, ...data };
      (state.tables[name] ||= []).push(row); return [row];
    } }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: (condition: any) => {
      const run = () => { const name = getTableName(table); state.writes.push(`update:${name}`);
        return (state.tables[name] || []).filter(row => matches(row, condition)).map(row => Object.assign(row, values)); };
      return { returning: async () => run(), then: (resolve: any) => Promise.resolve(run()).then(resolve) };
    } }) }),
    delete: (table: any) => ({ where: (condition: any) => ({ returning: async () => {
      const name = getTableName(table); state.writes.push(`delete:${name}`); const removed = (state.tables[name] || []).filter(row => matches(row, condition));
      state.tables[name] = (state.tables[name] || []).filter(row => !matches(row, condition)); return removed;
    } }) }),
    transaction: async (run: any) => { const before = structuredClone(state.tables); try { return await run(db); } catch (error) { state.tables = before; throw error; } },
  };
  return db;
}

import { readLocationBookingEligibility } from './location-booking-eligibility';
import { revokeManagerLocationAccess, deliverAccessNotice } from './location-access-notices';
import { sweepChefDocumentExpiry } from './chef-document-expiry';
import { db } from '../db';

beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks(); state.writes = []; state.requirements = { requireFoodHandlerCert: true };
  state.notify.mockResolvedValue({ id: 1 }); state.send.mockResolvedValue(true);
  state.tables = {
    [getTableName(chefKitchenApplications)]: [{ id: 1, chefId: 8, locationId: 47, fullName: 'Priya', email: 'priya@example.test', status: 'approved', current_tier: 3,
      foodSafetyLicenseUrl: '/certificate.pdf', foodSafetyLicenseStatus: 'approved', foodSafetyLicenseExpiry: '2027-10-14' }],
    [getTableName(chefLocationAccess)]: [{ id: 9, chefId: 8, locationId: 47 }],
    [getTableName(locations)]: [{ id: 47, name: 'Harbour Kitchens', managerId: 2, timezone: 'America/St_Johns' }],
    [getTableName(kitchenBookings)]: [{ id: 123, chefId: 8, locationId: 47, kitchenName: 'Main Kitchen', status: 'confirmed', bookingDate: new Date('2027-01-01'), startTime: '10:00', endTime: '12:00', operatingWindowStartTime: '08:00' },
      { id: 124, chefId: 8, locationId: 47, kitchenName: 'Main Kitchen', status: 'pending', bookingDate: new Date('2027-01-02'), startTime: '10:00', endTime: '12:00' }],
    [getTableName(emailLogs)]: [], [getTableName(kitchens)]: [],
  };
});

it('revoke then book is denied without any self-grant; final approval initially succeeds', async () => {
  expect((await readLocationBookingEligibility(8, 47)).canBook).toBe(true);
  await revokeManagerLocationAccess(2, 8, 47, 'We are ending this arrangement.');
  expect(await readLocationBookingEligibility(8, 47)).toMatchObject({ canBook: false, status: 'access_ended' });
  expect(state.writes).not.toContain('insert:chef_location_access');
});
it('denies tier 2 and rejected applications even with an access row', async () => {
  state.tables.chef_kitchen_applications[0].current_tier = 2;
  expect((await readLocationBookingEligibility(8, 47)).canBook).toBe(false);
  state.tables.chef_kitchen_applications[0].current_tier = 3; state.tables.chef_kitchen_applications[0].status = 'rejected';
  expect((await readLocationBookingEligibility(8, 47)).canBook).toBe(false);
});
it.each(['', '  ', null, 'x'.repeat(2001)])('requires a reason before any write (%s)', async reason => {
  await expect(revokeManagerLocationAccess(2, 8, 47, reason as string)).rejects.toMatchObject({ statusCode: 400 }); expect(state.writes).toEqual([]);
});
it('rejects a foreign manager inside the transaction', async () => {
  await expect(revokeManagerLocationAccess(3, 8, 47, 'Reason')).rejects.toMatchObject({ statusCode: 404 }); expect(state.writes).toEqual([]);
});
it('atomically retains bookings and application approval, records reason, and sends only access-ended mail', async () => {
  const before = structuredClone(state.tables.kitchen_bookings);
  const result = await revokeManagerLocationAccess(2, 8, 47, 'Kitchen rules');
  expect(result.bookings.map(row => row.id)).toEqual([123, 124]); expect(state.tables.kitchen_bookings).toEqual(before);
  expect(state.tables.chef_kitchen_applications[0]).toMatchObject({ status: 'approved', current_tier: 3, feedback: expect.stringContaining('Kitchen rules') });
  expect(state.tables.email_logs[0]).toMatchObject({ status: 'pending', subject: 'Your access to Harbour Kitchens has ended' });
  await deliverAccessNotice(result.noticeId!); await deliverAccessNotice(result.noticeId!);
  expect(state.send).toHaveBeenCalledTimes(1); expect(state.send.mock.calls[0][0].text).toContain('Hi Priya');
  expect(state.send.mock.calls[0][0].text).toContain('Local Cooks'); expect(state.send.mock.calls[0][0].text).not.toMatch(/application rejected|\bChef\b/i);
});
it('rolls back revocation if the transactional notice cannot be recorded', async () => {
  state.notify.mockRejectedValueOnce(new Error('notification unavailable'));
  await expect(revokeManagerLocationAccess(2, 8, 47, 'Kitchen rules')).rejects.toThrow('notification unavailable');
  expect(state.tables.chef_location_access).toHaveLength(1); expect(state.tables.email_logs).toHaveLength(0);
  expect(state.tables.chef_kitchen_applications[0].feedback).toBeUndefined();
});
it('repeated revoke does not duplicate notices', async () => {
  await revokeManagerLocationAccess(2, 8, 47, 'Kitchen rules'); await revokeManagerLocationAccess(2, 8, 47, 'Kitchen rules');
  expect(state.notify).toHaveBeenCalledTimes(1); expect(state.tables.email_logs).toHaveLength(1);
});
it.each([['2026-11-28', '45_day'], ['2026-10-28', '14_day'], ['2026-10-17', '3_day'], ['2026-10-14', 'expired']] as const)('sends one email and notification in the %s window (%s)', async (expiry, stage) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  state.tables.chef_kitchen_applications[0].foodSafetyLicenseExpiry = expiry;
  await sweepChefDocumentExpiry(); await sweepChefDocumentExpiry();
  expect(state.notify).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.tables.email_logs[0].trackingId).toContain(`chef_document_${stage}`);
  expect(state.send.mock.calls[0][0].text).toContain('renewLocation=47');
});
it('re-arms cadence for a reviewed renewal and suppresses reminders immediately after upload', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  const app = state.tables.chef_kitchen_applications[0]; app.foodSafetyLicenseExpiry = '2026-10-14';
  await sweepChefDocumentExpiry(); app.foodSafetyLicenseExpiry = '2027-10-14'; app.foodSafetyLicenseStatus = 'pending'; await sweepChefDocumentExpiry();
  expect(state.send).toHaveBeenCalledTimes(1); expect((await readLocationBookingEligibility(8, 47)).canBook).toBe(false);
  app.foodSafetyLicenseStatus = 'approved'; expect((await readLocationBookingEligibility(8, 47)).canBook).toBe(true);
  vi.setSystemTime(new Date('2027-09-14T12:00:00Z')); await sweepChefDocumentExpiry(); expect(state.send).toHaveBeenCalledTimes(2);
});
it('suppresses a queued reminder renewed before delivery', async () => {
  state.tables.email_logs.push({ id: 1, category: 'location_access_notice', status: 'pending', previewText: JSON.stringify({ applicationId: 1, document: 'foodSafetyLicense', expiry: '2020-01-01', stage: 'expired' }) });
  await deliverAccessNotice(1); expect(state.send).not.toHaveBeenCalled(); expect(state.tables.email_logs[0].status).toBe('suppressed');
});
it('expiry blocks new bookings without writing to existing bookings', async () => {
  const before = structuredClone(state.tables.kitchen_bookings); state.tables.chef_kitchen_applications[0].foodSafetyLicenseExpiry = '2020-01-01';
  expect(await readLocationBookingEligibility(8, 47)).toMatchObject({ canBook: false, status: 'document_expired' });
  expect(state.tables.kitchen_bookings).toEqual(before); expect(state.writes).toEqual([]);
});
it('early renewal: the approved document stays valid, no nudge is sent while the renewal waits, and expiry then says the renewal is under review', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  const app = state.tables.chef_kitchen_applications[0]; app.foodSafetyLicenseExpiry = '2026-11-03';
  state.tables.chef_document_renewals = [{ id: 1, applicationId: 1, documentKey: 'foodSafetyLicense', status: 'pending', url: '/renewed.pdf', expiry: '2027-12-01' }];
  expect(await readLocationBookingEligibility(8, 47)).toMatchObject({ canBook: true, status: 'approved' });
  await sweepChefDocumentExpiry(); expect(state.send).not.toHaveBeenCalled(); expect(state.tables.email_logs).toHaveLength(0);
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  expect(await readLocationBookingEligibility(8, 47)).toMatchObject({ canBook: false, status: 'renewal_under_review', message: expect.stringContaining('Your renewal is under review') });
});
it('without a renewal the same document still reminds (14 days out) and then blocks on expiry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  state.tables.chef_kitchen_applications[0].foodSafetyLicenseExpiry = '2026-11-03';
  await sweepChefDocumentExpiry(); expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send.mock.calls[0][0].text).toContain('You can keep booking until then');
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  expect(await readLocationBookingEligibility(8, 47)).toMatchObject({ canBook: false, status: 'document_expired' });
});
