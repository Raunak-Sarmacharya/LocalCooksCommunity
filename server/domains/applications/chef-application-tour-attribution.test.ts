import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ chef: { id: 3, role: 'chef' } as any,
  tour: { id: 20, chefId: 3, locationId: 5 } as any, candidates: [] as any[], existing: undefined as any,
  rows: [] as any[], operations: [] as string[], insert: vi.fn(), update: vi.fn(), resolve: vi.fn(), tx: undefined as any }));
vi.mock('../../db', () => ({ getDbError: () => ({}), db: { transaction: async (action: any) => action(state.tx) } }));
vi.mock('../../services/tour-application-service', () => ({ resolveTourApplicationNextStep: state.resolve }));
vi.mock('../kitchens/kitchen.repository', () => ({ KitchenRepository: class {} }));
import { ChefApplicationService } from './chef-application.service';
import { chefKitchenApplications, kitchenViewings, users, insertChefKitchenApplicationSchema } from '@shared/schema';

const service = new ChefApplicationService();
const answers = { chefId: 3, locationId: 5, fullName: 'Chef Fixture', email: 'fixture@example.test',
  phone: '+17095550123', shopName: 'Editable business', shopAddress: 'Fixture address',
  kitchenPreference: 'commercial' as const, foodSafetyLicense: 'no' as const, foodEstablishmentCert: 'no' as const,
  businessDescription: 'Edited intended use', customFieldsData: { savedAnswer: 'Keep this answer' } };

beforeEach(() => {
  vi.clearAllMocks(); state.existing = undefined; state.rows = []; state.operations = [];
  state.chef = { id: 3, role: 'chef' }; state.tour = { id: 20, chefId: 3, locationId: 5 };
  state.candidates = [state.tour];
  state.resolve.mockResolvedValue({ action: 'apply' });
  state.insert.mockImplementation(async (value: any) => { const row = { id: 8, ...value }; state.rows.push(row); return [row]; });
  state.update.mockImplementation(async (value: any) => [{ ...state.existing, ...value }]);
  state.tx = {
    select: () => {
      let table: any, candidates = false;
      const result = () => table === users ? [state.chef].filter(Boolean)
        : table === kitchenViewings ? candidates ? state.candidates : [state.tour].filter(Boolean) : [state.existing].filter(Boolean);
      const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain,
        orderBy: () => { candidates = true; return chain; },
        limit: () => { state.operations.push('existing'); return Promise.resolve(result()); },
        for: (mode: string) => { state.operations.push(`${table === users ? 'chef' : candidates ? 'candidates' : 'tour'}:${mode}`); return Promise.resolve(result()); } };
      return chain;
    },
    insert: (table: any) => { expect(table).toBe(chefKitchenApplications); return { values: (value: any) => ({ returning: () => state.insert(value) }) }; },
    update: (table: any) => { expect(table).toBe(chefKitchenApplications); return { set: (value: any) => ({ where: () => ({ returning: () => state.update(value) }) }) }; },
  };
});

describe('entry-point independent kitchen application tour attribution', () => {
  it('validates the completed-tour next step inside the serialized creation and stores edited answers normally', async () => {
    const application = await service.createApplication(answers, { sourceTourId: 20 });
    expect(state.operations).toEqual(['chef:update', 'tour:update', 'existing', 'candidates:update']);
    expect(state.resolve).toHaveBeenCalledWith(state.tx, state.tour, state.chef);
    expect(application).toMatchObject({ sourceTourId: 20, status: 'inReview',
      businessDescription: 'Edited intended use', customFieldsData: { savedAnswer: 'Keep this answer' } });
    expect(application).not.toHaveProperty('current_tier');
  });

  it.each(['unavailable', 'continue', 'view'])('does not award completed-tour credit when resolver returns %s', async action => {
    state.resolve.mockResolvedValue({ action });
    expect((await service.createApplication(answers, { sourceTourId: 20 })).sourceTourId).toBeNull();
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each([null, { id: 20, chefId: 4, locationId: 5 }, { id: 20, chefId: 3, locationId: 6 }])('rejects nonexistent, foreign-chef and wrong-kitchen source tours', async tour => {
    state.tour = tour;
    await expect(service.createApplication(answers, { sourceTourId: 20 })).rejects.toMatchObject({ code: 'SOURCE_TOUR_NOT_FOUND' });
    expect(state.resolve).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });

  it.each([null, 19])('a repeat tour or resubmission preserves original attribution %s without claiming new credit', async sourceTourId => {
    state.existing = { id: 8, status: 'rejected', sourceTourId };
    const application = await service.createApplication({ ...answers, sourceTourId: 999 } as any, { sourceTourId: 20 });
    expect(application).toMatchObject({ id: 8, sourceTourId, status: 'inReview', tier_data: {} });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('sourceTourId');
    expect(state.resolve).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });

  it('ordinary submissions without a qualifying visit stay unattributed and cannot forge application data', async () => {
    state.candidates = [];
    expect(insertChefKitchenApplicationSchema.parse({ ...answers, sourceTourId: 20 })).not.toHaveProperty('sourceTourId');
    const application = await service.createApplication({ ...answers, sourceTourId: 20 } as any);
    expect(application.sourceTourId).toBeNull(); expect(state.operations).toEqual(['chef:update', 'existing', 'candidates:update']);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it.each([undefined, 20])('all application entry points select the same latest qualifying visit (hint %s)', async sourceTourId => {
    state.candidates = [{ id: 21, chefId: 3, locationId: 5 }, state.tour];
    const application = await service.createApplication(answers, { sourceTourId });
    expect(application.sourceTourId).toBe(21);
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.resolve).toHaveBeenCalledWith(state.tx, state.candidates[0], state.chef);
  });

  it('skips uncertain/corrected latest results and credits the latest qualifying earlier visit', async () => {
    state.candidates = [{ id: 22, chefId: 3, locationId: 5 }, { id: 21, chefId: 3, locationId: 5 }, state.tour];
    state.resolve.mockResolvedValueOnce({ action: 'unavailable' }).mockResolvedValueOnce({ action: 'apply' });
    expect((await service.createApplication(answers)).sourceTourId).toBe(21);
    expect(state.resolve).toHaveBeenCalledTimes(2);
  });

  it('does not award automatic origin to an account whose current role is no longer chef', async () => {
    state.chef.role = 'manager';
    expect((await service.createApplication(answers)).sourceTourId).toBeNull();
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('rechecks the current account role even when a linked application already exists', async () => {
    state.chef.role = 'manager'; state.existing = { id: 8, status: 'inReview', sourceTourId: 19 };
    await expect(service.createApplication(answers, { sourceTourId: 20 })).rejects.toMatchObject({ statusCode: 403 });
    expect(state.insert).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });

  it('preserves normal approved Step 2 submission and certificate data', async () => {
    state.existing = { id: 8, status: 'approved', sourceTourId: 19, tier1_completed_at: new Date() };
    const submitted = new Date();
    const application = await service.createApplication({ ...answers, current_tier: 2,
      tier2_completed_at: submitted, tier_data: { tierFiles: { insurance: 'fixture.pdf' } }, foodSafetyLicenseUrl: 'fixture-cert.pdf' } as any);
    expect(application).toMatchObject({ sourceTourId: 19, status: 'approved', current_tier: 2,
      tier2_completed_at: submitted, tier_data: { tierFiles: { insurance: 'fixture.pdf' } }, foodSafetyLicenseUrl: 'fixture-cert.pdf' });
  });
});
