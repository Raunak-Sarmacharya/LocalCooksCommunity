import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getApplicationById: vi.fn(), updateApplication: vi.fn() }));
vi.mock('../../db', () => ({ db: {}, pool: null }));
vi.mock('../../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn() }));
vi.mock('../../domains/applications/application.service', () => ({ applicationService: { getApplicationById: mocks.getApplicationById, updateApplication: mocks.updateApplication } }));
import { applicationsRouter } from './applications';

const handler = () => (applicationsRouter as any).stack.find((entry: any) => entry.route?.path === '/firebase/applications/:id/details').route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const call = (body: object, userId = 7) => { const res = response(); return handler()({ params: { id: '42' }, neonUser: { id: userId }, body }, res).then(() => res); };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicationById.mockResolvedValue({ id: 42, userId: 7, status: 'inReview', kitchenPreference: 'commercial', commercialKitchen: 'localcooks' });
  mocks.updateApplication.mockImplementation(async (_id: number, updates: object) => updates);
});

it('the applicant changes how and when to reach them while it is in review', async () => {
  await call({ contactMethod: 'call', contactTime: 'morning', foodTypes: ['baked'] });
  expect(mocks.updateApplication).toHaveBeenCalledWith(42, { contactMethod: 'call', contactTime: 'morning', foodTypes: ['baked'], commercialKitchen: 'localcooks' });
});

it('switching to home drops the commercial kitchen choice', async () => {
  await call({ kitchenPreference: 'home' });
  expect(mocks.updateApplication).toHaveBeenCalledWith(42, { kitchenPreference: 'home', commercialKitchen: null });
});

it("someone else's, a decided application, or a bad value changes nothing", async () => {
  expect((await call({ contactMethod: 'call' }, 8)).status).toHaveBeenCalledWith(404);
  expect((await call({ contactMethod: 'pigeon' })).status).toHaveBeenCalledWith(400);
  mocks.getApplicationById.mockResolvedValue({ id: 42, userId: 7, status: 'approved', kitchenPreference: 'home' });
  expect((await call({ contactMethod: 'call' })).status).toHaveBeenCalledWith(409);
  expect(mocks.updateApplication).not.toHaveBeenCalled();
});
