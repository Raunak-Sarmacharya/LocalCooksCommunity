import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getApplicationById: vi.fn(), updateApplication: vi.fn(), notify: vi.fn(), sendEmail: vi.fn() }));
vi.mock('../db', () => ({ db: {}, pool: null }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn() }));
vi.mock('../services/notification.service', () => ({ notificationService: { notifySellerDocumentsRequested: mocks.notify } }));
vi.mock('../email', async (importOriginal) => ({ ...(await importOriginal<typeof import('../email')>()), sendEmail: mocks.sendEmail }));
vi.mock('../domains/applications/application.service', () => ({ ApplicationService: class { getApplicationById = mocks.getApplicationById; updateApplication = mocks.updateApplication; } }));
import applicationsRouter from './applications';

const handler = (path: string, method: string) => (applicationsRouter as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const admin = { id: 1, role: 'admin' };
const home = { id: 42, userId: 7, status: 'inReview', kitchenPreference: 'home', email: 'sam@example.com', fullName: 'Sam Seller' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicationById.mockResolvedValue(home);
  mocks.updateApplication.mockImplementation(async (_id: number, updates: object) => ({ ...home, ...updates }));
});

it('only admins can request documents or change the kitchen setting', async () => {
  for (const [path, method] of [['/:id/request-documents', 'post'], ['/:id/kitchen', 'patch']]) {
    const res = response();
    await handler(path, method)({ params: { id: '42' }, neonUser: { id: 7, role: 'chef' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  }
  expect(mocks.updateApplication).not.toHaveBeenCalled();
});

it('requesting documents saves the request and tells the chef by name for their kitchen setting', async () => {
  const res = response();
  await handler('/:id/request-documents', 'post')({ params: { id: '42' }, neonUser: admin, body: { documents: ['kitchen', 'kitchen'], note: ' Before Friday ' } }, res);
  expect(mocks.updateApplication).toHaveBeenCalledWith(42, expect.objectContaining({ documentsRequested: ['kitchen'], documentsRequestNote: 'Before Friday', documentsRequestedAt: expect.any(Date) }));
  expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ chefId: 7, documentNames: ['Home-based Food Industry Registration'], note: 'Before Friday' }));
  expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'sam@example.com', text: expect.stringContaining('• Home-based Food Industry Registration') }), expect.anything());
});

it('an empty or closed request is refused', async () => {
  const empty = response();
  await handler('/:id/request-documents', 'post')({ params: { id: '42' }, neonUser: admin, body: { documents: [] } }, empty);
  expect(empty.status).toHaveBeenCalledWith(400);
  mocks.getApplicationById.mockResolvedValue({ ...home, status: 'rejected' });
  const closed = response();
  await handler('/:id/request-documents', 'post')({ params: { id: '42' }, neonUser: admin, body: { documents: ['foodSafety'] } }, closed);
  expect(closed.status).toHaveBeenCalledWith(409);
  expect(mocks.updateApplication).not.toHaveBeenCalled();
});

it('the commercial kitchen choice is kept only for commercial kitchens', async () => {
  await handler('/:id/kitchen', 'patch')({ params: { id: '42' }, neonUser: admin, body: { kitchenPreference: 'commercial' } }, response());
  expect(mocks.updateApplication).toHaveBeenLastCalledWith(42, { kitchenPreference: 'commercial', commercialKitchen: 'other' });
  await handler('/:id/kitchen', 'patch')({ params: { id: '42' }, neonUser: admin, body: { kitchenPreference: 'home', commercialKitchen: 'localcooks' } }, response());
  expect(mocks.updateApplication).toHaveBeenLastCalledWith(42, { kitchenPreference: 'home', commercialKitchen: null });
});
