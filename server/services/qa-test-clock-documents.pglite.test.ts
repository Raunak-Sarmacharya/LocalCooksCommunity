import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { locationBookingEligibility } from '@shared/location-booking-eligibility';
import { formatInTimezone } from '@shared/timezone-utils';

const holder = vi.hoisted(() => ({ db: null as any, pg: null as any, requirements: {} as any, chef: [] as any[], manager: [] as any[] }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'http://localhost' }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationRequirementsWithDefaults: async () => holder.requirements } }));
vi.mock('./notification.service', () => ({ notificationService: {
  createForChef: async (input: any) => { holder.chef.push(input); }, createForManager: async (input: any) => { holder.manager.push(input); } } }));
// Like the real sender: a reserved .test address is never mailed and leaves a skipped_policy row under the same tracking id.
vi.mock('../email', () => ({ renderTransactionalEmail: (input: any) => ({ subject: input.subject, html: input.message, text: input.message }),
  emailClock: () => '', emailZoneName: () => '',
  sendEmail: async (content: any, options: any) => { await holder.pg.query(`INSERT INTO email_logs(recipient_email, subject, category, status, tracking_id) VALUES ($1, $2, 'sent_attempt', 'skipped_policy', $3)`,
    [content.to, content.subject, options.trackingId]); return false; } }));
import { jumpDocuments, readDocumentsClock } from './qa-test-clock-documents';
import { sweepDocumentExpiryForApplication } from './chef-document-expiry';

const zone = 'America/St_Johns', day = 86_400_000;
const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};
const inDays = (days: number) => new Date(Date.parse(`${formatInTimezone(new Date(), 'yyyy-MM-dd', zone)}T00:00:00Z`) + days * day).toISOString().slice(0, 10);

/** One approved customer whose food safety certificate (required by the kitchen) expires in `days` local days. */
async function seed(days = 60, { renewal = false, custom = false } = {}) {
  await pg.query(`INSERT INTO locations(id, name, timezone, manager_id) VALUES (1, 'Kitchen', $1, 6)`, [zone]);
  await pg.query(`INSERT INTO chef_location_access(chef_id, location_id) VALUES (5, 1)`);
  await pg.query(`INSERT INTO chef_kitchen_applications(id, chef_id, location_id, full_name, email, status, current_tier, food_safety_license_url, food_safety_license_status, food_safety_license_expiry, tier_data, updated_at)
    VALUES (1, 5, 1, 'Ann Cook', 'ann@x.test', 'approved', 3, 'https://f/doc.pdf', 'approved', $1, $2, date_trunc('milliseconds', now()))`,
    [inDays(days), JSON.stringify(custom ? { tier2_custom_fields_data: { c1: 'https://f/own.pdf', c1__expiry: inDays(days + 10) }, customDocumentStatus: { c1: 'approved' } } : {})]);
  holder.requirements = { requireFoodHandlerCert: true, tier2_custom_fields: custom ? [{ id: 'c1', label: 'Fire cert', document: true, expires: true }] : [] };
  if (renewal) await pg.exec(`INSERT INTO chef_document_renewals(application_id, document_key, url, expiry, status) VALUES (1, 'foodSafetyLicense', 'https://f/new.pdf', '2030-01-01', 'pending')`);
  return (await readDocumentsClock(1)).updatedAt;
}
const app = async () => (await pg.query<any>(`SELECT * FROM chef_kitchen_applications`)).rows[0];
const logs = async (stage: string) => (await pg.query<any>(`SELECT tracking_id, status FROM email_logs WHERE category = 'location_access_notice' AND tracking_id LIKE $1`, [`chef_document_${stage}_%`])).rows;
const expiry = async () => String((await app()).food_safety_license_expiry instanceof Date ? (await app()).food_safety_license_expiry.toISOString().slice(0, 10) : (await app()).food_safety_license_expiry);

beforeAll(async () => {
  holder.db = drizzle(pg, { schema }); holder.pg = pg;
  await pg.exec([schema.chefKitchenApplications, schema.chefLocationAccess, schema.locations, schema.emailLogs, schema.chefDocumentRenewals, schema.platformSettings].map(table).join('\n'));
});
beforeEach(async () => {
  holder.chef = []; holder.manager = [];
  await pg.exec(`DELETE FROM email_logs; DELETE FROM chef_document_renewals; DELETE FROM chef_kitchen_applications; DELETE FROM chef_location_access; DELETE FROM locations;`);
});

describe('documents clock steps', () => {
  it('lists the 45, 14, 3 day and expiry stages for a document expiring in 60 days, labelled', async () => {
    await seed(60);
    const clock = await readDocumentsClock(1);
    expect(clock.steps.map(step => step.key)).toEqual(['foodSafetyLicense:45_day', 'foodSafetyLicense:14_day', 'foodSafetyLicense:3_day', 'foodSafetyLicense:expired']);
    expect(clock.steps[0].label).toBe('Food Safety Certificate: 45-day renewal reminder (customer by email + in-app, kitchen in-app)');
    expect(clock.steps[3].label).toBe('Food Safety Certificate expires · customer told; new bookings pause');
    // A stage that already began is not a future step.
    await pg.exec(`DELETE FROM chef_document_renewals`);
    await pg.query(`UPDATE chef_kitchen_applications SET food_safety_license_expiry = $1`, [inDays(10)]);
    expect((await readDocumentsClock(1)).steps.map(step => step.key)).toEqual(['foodSafetyLicense:3_day', 'foodSafetyLicense:expired']);
  });

  it('does not count a document with a renewal waiting, and says why', async () => {
    const version = await seed(60, { renewal: true });
    const clock = await readDocumentsClock(1);
    expect(clock.steps).toEqual([]);
    expect(clock.note).toContain('Food Safety Certificate (renewal waiting for review)');
    await expect(jumpDocuments(1, new Date(Date.now() + 5 * day), 9, version)).rejects.toMatchObject({ status: 409 });
  });
});

describe('documents jump', () => {
  it('walks 60 days to the 14-day step: one notice per stage passed, kitchen told in-app, nothing repeated', async () => {
    const version = await seed(60);
    const [, fourteen] = (await readDocumentsClock(1)).steps;
    const result = await jumpDocuments(1, new Date(fourteen.at), 9, version);
    expect(result.notices).toEqual([{ kind: '45_day', sent: true }, { kind: '14_day', sent: true }]);
    expect((await logs('45_day')).length).toBe(1);
    expect((await logs('14_day')).length).toBe(1);
    expect(holder.manager).toHaveLength(2);
    expect(holder.chef.map(item => item.metadata.stage)).toEqual(['45_day', '14_day']);
    // The 45-day marker moved with the date, so a later sweep stays quiet.
    const date = await expiry();
    expect((await logs('45_day'))[0].tracking_id.endsWith(`_${date}`)).toBe(true);
    await sweepDocumentExpiryForApplication(1);
    expect((await logs('45_day')).length + (await logs('14_day')).length).toBe(2);
  });

  it('a stage already sent is not sent again after a jump that stays inside it', async () => {
    await seed(40);
    await sweepDocumentExpiryForApplication(1);
    expect((await logs('45_day')).length).toBe(1);
    const before = await expiry();
    const result = await jumpDocuments(1, new Date(Date.now() + 2 * day), 9, (await readDocumentsClock(1)).updatedAt);
    expect(result.notices).toEqual([]);
    expect(await expiry()).not.toBe(before);
    expect((await logs('45_day')).length).toBe(1);
    expect(holder.manager).toHaveLength(1);
  });

  it('then the 3-day step sends one 3-day notice, and expiry sends "expired" and pauses bookings', async () => {
    await seed(40);
    await sweepDocumentExpiryForApplication(1);
    let clock = await readDocumentsClock(1);
    clock = (await jumpDocuments(1, new Date(clock.steps[0].at), 9, clock.updatedAt)).clock; // 14-day
    const three = clock.steps.find(step => step.key.endsWith(':3_day'))!;
    const toThree = await jumpDocuments(1, new Date(three.at), 9, clock.updatedAt);
    expect(toThree.notices).toEqual([{ kind: '3_day', sent: true }]);
    expect((await logs('3_day')).length).toBe(1);

    const expires = toThree.clock.steps.find(step => step.key.endsWith(':expired'))!;
    const toExpiry = await jumpDocuments(1, new Date(expires.at), 9, toThree.clock.updatedAt);
    expect(toExpiry.notices).toEqual([{ kind: 'expired', sent: true }]);
    expect(toExpiry.clock.steps).toEqual([]);
    const row = await app();
    const eligibility = locationBookingEligibility({ ...row, status: row.status, current_tier: row.current_tier, foodSafetyLicenseUrl: row.food_safety_license_url,
      foodSafetyLicenseStatus: row.food_safety_license_status, foodSafetyLicenseExpiry: await expiry() }, true, holder.requirements, 1, zone);
    expect(eligibility).toMatchObject({ canBook: false, status: 'document_expired' });

    // The worker's own sweep finds everything already sent.
    const total = (await pg.query<any>(`SELECT count(*)::int AS n FROM email_logs WHERE category = 'location_access_notice'`)).rows[0].n;
    await sweepDocumentExpiryForApplication(1);
    await sweepDocumentExpiryForApplication(1);
    expect((await pg.query<any>(`SELECT count(*)::int AS n FROM email_logs WHERE category = 'location_access_notice'`)).rows[0].n).toBe(total);
    expect(holder.manager).toHaveLength(4);
  });

  it('moves a kitchen-added document\'s expiry in the application JSON too', async () => {
    const version = await seed(60, { custom: true });
    const steps = (await readDocumentsClock(1)).steps;
    expect(steps.some(step => step.label.startsWith('Fire cert:'))).toBe(true);
    await jumpDocuments(1, new Date(Date.now() + 3 * day), 9, version);
    expect((await app()).tier_data.tier2_custom_fields_data.c1__expiry).toBe(inDays(10 + 60 - 3));
    expect((await app()).tier_data.tier2_custom_fields_data.c1).toBe('https://f/own.pdf');
  });

  it('refuses a stale card and an application that is not final-approved', async () => {
    const version = await seed(60);
    await expect(jumpDocuments(1, new Date(Date.now() + 3 * day), 9, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ status: 409, message: 'This application changed. Refresh and try again.' });
    await pg.exec(`UPDATE chef_kitchen_applications SET current_tier = 2`);
    await expect(jumpDocuments(1, new Date(Date.now() + 3 * day), 9, version)).rejects.toMatchObject({ status: 409 });
  });
});
