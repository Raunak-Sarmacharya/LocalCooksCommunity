import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  updates: [] as { table: string; values: any }[],
  failWith: null as null | { code?: string; message?: string },
  upserts: [] as any[],
  notices: [] as any[],
}));

vi.mock('../db', () => {
  const rows = (table: any) => state.tables[getTableName(table)] || [];
  const select = () => ({ from: (table: any) => {
    if (state.failWith) return { where: () => Promise.reject(Object.assign(new Error(state.failWith!.message || 'failed'), { code: state.failWith!.code })) };
    const result = () => rows(table);
    const q: any = { where: () => q, limit: () => q, for: () => q, then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject) };
    return q;
  } });
  const update = (table: any) => ({ set: (values: any) => ({ where: async () => { state.updates.push({ table: getTableName(table), values }); } }) });
  const insert = () => ({ values: (value: any) => ({ onConflictDoUpdate: async (options: any) => {
    if (state.failWith) throw Object.assign(new Error(state.failWith.message || 'failed'), { code: state.failWith.code });
    state.upserts.push({ value, set: options.set });
  } }) });
  const database: any = { select, update, insert, transaction: async (run: any) => run({ select, update, insert }) };
  return { db: database, pool: {}, getDbError: (error: any) => error };
});
vi.mock('./location-access-notices', () => ({ queueAccessNotice: async (_tx: any, notice: any) => { state.notices.push(notice); return 1; } }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { decideDocumentRenewal, readDocumentRenewals, submitDocumentRenewal } from './document-renewals';

const application = { id: 5, chefId: 9, locationId: 47, email: 'chef@example.com', fullName: 'Priya Nair', status: 'approved', current_tier: 3,
  foodSafetyLicenseUrl: '/old.pdf', foodSafetyLicenseExpiry: '2027-01-01', foodSafetyLicenseStatus: 'approved', tier_data: {}, chat_conversation_id: null };
const renewal = { id: 11, applicationId: 5, documentKey: 'foodSafetyLicense', url: '/new.pdf', expiry: '2099-01-01', status: 'pending', rejectionReason: null, submittedAt: new Date() };

beforeEach(() => {
  state.tables = { chef_kitchen_applications: [application], chef_document_renewals: [renewal], locations: [{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' }] };
  state.updates = []; state.upserts = []; state.notices = []; state.failWith = null;
});

describe('document renewal slot', () => {
  it('reads pending renewals for an application', async () => {
    expect(await readDocumentRenewals(5)).toMatchObject([{ key: 'foodSafetyLicense', status: 'pending', url: '/new.pdf', expiry: '2099-01-01' }]);
  });

  it('fails safe before migration 0074: a missing table reads as no renewals and a submit reports the slot is unavailable', async () => {
    state.failWith = { code: '42P01', message: 'relation "chef_document_renewals" does not exist' };
    expect(await readDocumentRenewals(5)).toEqual([]);
    expect(await submitDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', url: '/new.pdf', expiry: '2099-01-01' })).toBe(false);
  });

  it('does not swallow other write failures', async () => {
    state.failWith = { code: '23505', message: 'duplicate key' };
    await expect(submitDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', url: '/new.pdf', expiry: '2099-01-01' })).rejects.toThrow('duplicate key');
  });

  it('stores a resubmission as pending again and clears the earlier rejection', async () => {
    expect(await submitDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', url: '/newer.pdf', expiry: '2099-02-02' })).toBe(true);
    expect(state.upserts[0]).toMatchObject({ value: { applicationId: 5, documentKey: 'foodSafetyLicense', url: '/newer.pdf' }, set: { status: 'pending', rejectionReason: null, reviewedAt: null } });
  });

  it('approval replaces the current document with the renewed one and tells the chef', async () => {
    await decideDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', decision: 'approved', reviewer: 'manager' });
    const replaced = state.updates.find(update => update.table === 'chef_kitchen_applications')!.values;
    expect(replaced).toMatchObject({ foodSafetyLicenseUrl: '/new.pdf', foodSafetyLicenseExpiry: '2099-01-01', foodSafetyLicenseStatus: 'approved', tier_data: { documentVerification: { foodSafetyLicense: 'manager' } } });
    expect(state.updates.find(update => update.table === 'chef_document_renewals')!.values).toMatchObject({ status: 'approved', reviewedBy: 'manager' });
    expect(state.notices[0]).toMatchObject({ chefId: 9, subject: 'Your renewed Food Safety Certificate was approved' });
    // Not an expiry reminder: carrying applicationId would let the reminder suppression swallow it.
    expect(state.notices[0].metadata.applicationId).toBeUndefined();
  });

  it('rejection keeps the current document untouched, stores the reason and notifies the chef with it', async () => {
    await decideDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', decision: 'rejected', reviewer: 'local_cooks', reason: '  The expiry date is cut off.  ' });
    expect(state.updates.some(update => update.table === 'chef_kitchen_applications')).toBe(false);
    expect(state.updates.find(update => update.table === 'chef_document_renewals')!.values).toMatchObject({ status: 'rejected', rejectionReason: 'The expiry date is cut off.' });
    expect(state.notices[0].message).toContain('The expiry date is cut off.');
    expect(state.notices[0].message).toContain('current document stays valid until it expires');
  });

  it('refuses a rejection without a reason', async () => {
    await expect(decideDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', decision: 'rejected', reviewer: 'manager' })).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
    expect(state.updates).toEqual([]);
  });

  it('refuses to decide twice or without a pending renewal', async () => {
    state.tables.chef_document_renewals = [{ ...renewal, status: 'approved' }];
    await expect(decideDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', decision: 'approved', reviewer: 'manager' })).rejects.toMatchObject({ code: 'RENEWAL_NOT_PENDING', statusCode: 409 });
    expect(state.updates).toEqual([]);
  });

  it('refuses to approve a renewed document that has itself already expired', async () => {
    state.tables.chef_document_renewals = [{ ...renewal, expiry: '2020-01-01' }];
    await expect(decideDocumentRenewal({ applicationId: 5, key: 'foodSafetyLicense', decision: 'approved', reviewer: 'manager' })).rejects.toMatchObject({ code: 'RENEWAL_EXPIRED' });
    expect(state.updates).toEqual([]);
  });
});
