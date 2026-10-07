import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ saved: undefined as any, adminRows: undefined as any[] | undefined,
  managerUsers: [] as any[], insert: vi.fn(), select: vi.fn(), queue: vi.fn(), transaction: vi.fn() }));
vi.mock('../db', () => {
  const settings = { isActive: true, defaultDurationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, advanceNoticeHours: 0, maxAdvanceBookingDays: 90 };
  const db: any = {
    execute: vi.fn(), transaction: state.transaction,
    select: (selection: unknown) => {
      state.select(selection);
      let table = '', joined = false;
      const rows = () => {
        if (table === 'kitchens') return [{ id: 40, locationId: 33, managerId: 2, isActive: true, listingStatus: 'active' }];
        if (table === 'kitchen_viewing_settings') return [settings];
        if (table === 'kitchen_viewing_availability') return [{ dayOfWeek: 4, startTime: '10:00', endTime: '11:00', isAvailable: true }];
        if (table === 'kitchen_viewings' && joined && state.adminRows) return state.adminRows;
        if (table === 'kitchen_viewings' && joined && state.saved) return [{ viewing: state.saved, locationName: 'Test kitchen' }];
        if (table === 'users') return state.managerUsers;
        return [];
      };
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
        where: () => chain, orderBy: () => chain, limit: () => chain, for: () => chain,
        innerJoin: () => chain, leftJoin: () => { joined = true; return chain; }, then: (resolve: any) => resolve(rows()) };
      return chain;
    },
    insert: () => ({ values: (value: any) => {
      state.insert(value);
      state.saved = { id: 10, createdAt: new Date(), updatedAt: new Date(), ...value };
      return { returning: async () => [state.saved] };
    } }),
  };
  state.transaction.mockImplementation(async run => run(db));
  return { db };
});
vi.mock('../chat-service', () => ({ initializeSharedConversation: vi.fn() }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: state.queue, attemptTourDelivery: vi.fn(async () => ({ failed: false })) }));
vi.mock('../services/kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn(async () => ({ checkinWindowMinutesBefore: 20 })) }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/tour-confirmation-pdf', () => ({ buildTourConfirmationPdf: vi.fn(), tourReference: vi.fn() }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async (id, role) => role === 'manager' ? `Manager ${id}` : 'Fixture chef') }));
vi.mock('../phone-utils', () => ({ getChefPhone: vi.fn(async () => null) }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import router from './viewings';
import { locations, users } from '@shared/schema';
import { getUserDisplayName } from '../utils/user-display';
import { requireAdmin, requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
const intakeData = { intendedUse: '  Catering  ', estimatedWeeklyHours: '  5-10  ', hasLicense: false, targetStartDate: '2026-11-01', additionalInfo: 'Freezer space' };
const body = { locationId: 33, targetedKitchenId: 40, scheduledAt: '2026-10-08T12:30:00Z', chefNotes: 'Tour notes', intakeData };
async function request(path: string, method: string, body: unknown = {}, verified = true) {
  const handler = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ neonUser: { id: 8, role: 'chef' }, firebaseUser: { email_verified: verified }, body, query: {} }, res);
  return res;
}

describe('new tour request intake boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.saved = undefined; state.adminRows = undefined; state.managerUsers = [];
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  it.each([undefined, {}, { ...intakeData, intendedUse: ' ' }, { ...intakeData, estimatedWeeklyHours: '\n' },
    { ...intakeData, hasLicense: undefined }, { ...intakeData, hasLicense: 'false' }, { ...intakeData, targetStartDate: '2026-02-30' }])
  ('rejects incomplete or invalid intake before accessing the database: %j', async intakeData => {
    const res = await request('/book', 'post', { ...body, intakeData });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.select).not.toHaveBeenCalled(); expect(state.transaction).not.toHaveBeenCalled();
  });
  it('keeps the email verification guard ahead of intake validation', async () => {
    const res = await request('/book', 'post', {}, false);
    expect(res.status).toHaveBeenCalledWith(403); expect(state.select).not.toHaveBeenCalled();
  });
  it.each(['2026-11-01', 'not_decided'])('persists all four answers with No and target %s in the transaction, then carries them to both review lists', async targetStartDate => {
    const expectedIntake = { ...intakeData, intendedUse: 'Catering', estimatedWeeklyHours: '5-10', targetStartDate };
    const res = await request('/book', 'post', { ...body, intakeData: { ...intakeData, targetStartDate } });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(state.transaction).toHaveBeenCalledTimes(1);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ intakeData: expectedIntake, chefNotes: 'Tour notes', status: 'pending_local_cooks' }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ after: expect.objectContaining({ intakeData: expectedIntake }) }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ intakeData: expectedIntake }));
    expect((await request('/admin', 'get')).json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ intakeData: expectedIntake }) })]);
    state.saved.status = 'pending'; // Existing approval handoff makes the request manager-visible.
    expect((await request('/manager', 'get')).json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ intakeData: expectedIntake }) })]);
  });
});

describe('admin tour current manager contact', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.saved = undefined; state.adminRows = []; state.managerUsers = [];
  });
  it('uses the current location manager after reassignment and resolves repeated managers once', async () => {
    state.adminRows = [10, 11].map(id => ({ viewing: { id, chefId: 8, managerId: 2 }, managerId: 3 }));
    state.managerUsers = [{ id: 3, email: 'current@example.com', phone: '+17095551234' }];
    const res = await request('/admin', 'get');
    expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ managerId: locations.managerId }));
    expect(state.select).toHaveBeenCalledWith({ id: users.id, email: users.username, phone: users.phoneNumber, profile: users.managerProfileData });
    expect(state.select).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getUserDisplayName).mock.calls.filter(([, role]) => role === 'manager')).toEqual([[3, 'manager']]);
    expect(res.json).toHaveBeenCalledWith(state.adminRows.map(row => expect.objectContaining({ ...row, managerName: 'Manager 3',
      managerEmail: 'current@example.com', managerPhone: '+17095551234', chefName: 'Fixture chef', chefPhone: null })));
  });
  it('never falls back to a former manager for new unassigned requests or removed assignments', async () => {
    state.adminRows = [null, 2].map((managerId, index) => ({ viewing: { id: index, chefId: 8, managerId }, managerId: null }));
    const res = await request('/admin', 'get');
    expect(res.json).toHaveBeenCalledWith(state.adminRows.map(row => expect.objectContaining({ ...row, managerId: null,
      managerName: null, managerEmail: null, managerPhone: null, chefName: 'Fixture chef', chefPhone: null })));
    expect(state.select).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getUserDisplayName).mock.calls.some(([, role]) => role === 'manager')).toBe(false);
  });
  it('returns null contact details for missing accounts and absent email or phone', async () => {
    state.adminRows = [3, 4, 5].map(managerId => ({ viewing: { chefId: 8, managerId: 2 }, managerId }));
    state.managerUsers = [{ id: 3, email: 'current@example.com', phone: null }, { id: 4, email: null, phone: '+17095551234' }];
    const res = await request('/admin', 'get');
    expect(res.json.mock.calls[0][0]).toEqual([
      expect.objectContaining({ managerId: 3, managerName: 'Manager 3', managerEmail: 'current@example.com', managerPhone: null }),
      expect.objectContaining({ managerId: 4, managerName: 'Manager 4', managerEmail: null, managerPhone: '+17095551234' }),
      expect.objectContaining({ managerId: null, managerName: null, managerEmail: null, managerPhone: null }),
    ]);
    expect(getUserDisplayName).not.toHaveBeenCalledWith(2, 'manager');
    expect(getUserDisplayName).not.toHaveBeenCalledWith(5, 'manager');
  });
  it.each([
    { phone: null, profile: { phone: '+17095550001' }, expected: '+17095550001' },
    { phone: '+17095550002', profile: { phone: '+17095550001' }, expected: '+17095550002' },
    { phone: null, profile: { phone: 17095550001 }, expected: null },
    { phone: null, profile: { phone: { value: '+17095550001' } }, expected: null },
    { phone: null, profile: ['+17095550001'], expected: null },
  ])('uses current manager account phone priority and validates profile phone: %j', async ({ phone, profile, expected }) => {
    state.adminRows = [{ viewing: { chefId: 8, managerId: 2 }, managerId: 3 }];
    state.managerUsers = [{ id: 3, email: 'current@example.com', phone, profile }];
    const res = await request('/admin', 'get');
    expect(res.json.mock.calls[0][0][0]).toEqual(expect.objectContaining({ managerId: 3, managerPhone: expected }));
  });
  it('retains authentication and admin guards for the contact endpoint', () => {
    const route = (router as any).stack.find((entry: any) => entry.route?.path === '/admin' && entry.route.methods.get).route;
    expect(route.stack.slice(0, 2).map((entry: any) => entry.handle)).toEqual([requireFirebaseAuthWithUser, requireAdmin]);
  });
});
