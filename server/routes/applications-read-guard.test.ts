import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getApplicationById: vi.fn() }));
vi.mock('../db', () => ({ db: {}, pool: null }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn() }));
vi.mock('../domains/applications/application.service', () => ({ ApplicationService: class { getApplicationById = mocks.getApplicationById; } }));
import applicationsRouter from './applications';

const handler = () => (applicationsRouter as any).stack.find((entry: any) => entry.route?.path === '/:id' && entry.route.methods.get).route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.getApplicationById.mockResolvedValue({ id: 13, userId: 7, email: 'sam@example.com' }); });

it('signed out: no application', async () => {
  const res = response();
  await handler()({ params: { id: '13' } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mocks.getApplicationById).not.toHaveBeenCalled();
});

it("someone else's application reads as not found", async () => {
  const res = response();
  await handler()({ params: { id: '13' }, neonUser: { id: 8, role: 'chef' } }, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

it('the applicant and admins can read it', async () => {
  for (const neonUser of [{ id: 7, role: 'chef' }, { id: 1, role: 'admin' }]) {
    const res = response();
    await handler()({ params: { id: '13' }, neonUser }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  }
});
