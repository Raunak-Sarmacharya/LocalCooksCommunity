import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUserByUsername: vi.fn(), updateUser: vi.fn(), pass: vi.fn((_req: any, _res: any, next: any) => next()) }));
vi.mock('../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{}] }) }) }), update: () => ({ set: () => ({ where: async () => [] }) }) }, pool: null }));
vi.mock('./middleware', () => ({ requireChef: mocks.pass, requireNoUnpaidPenalties: mocks.pass }));
vi.mock('../email', () => ({ sendEmail: vi.fn(), generateChefProfileRequestEmail: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: { getUserByUsername: mocks.getUserByUsername, updateUser: mocks.updateUser, isPhoneTakenByAnother: vi.fn() } }));
import kitchensRouter from './kitchens';

const handler = () => (kitchensRouter as any).stack.find((entry: any) => entry.route?.path === '/chef/my-profile' && entry.route.methods.put).route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => vi.clearAllMocks());

it('refuses an email (username) change to any address the person has not verified at sign-in', async () => {
  const res = response();
  await handler()({ neonUser: { id: 3, username: 'sam@example.com' }, firebaseUser: { email: 'sam@example.com', email_verified: true },
    body: { username: 'someone.else@example.com' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_CHANGE_NEEDS_VERIFICATION' }));
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it('accepts the change when it matches the verified sign-in email (a verified change made elsewhere)', async () => {
  mocks.getUserByUsername.mockResolvedValue(null);
  const res = response();
  await handler()({ neonUser: { id: 3, username: 'old@example.com' }, firebaseUser: { email: 'New@Example.com', email_verified: true },
    body: { username: 'new@example.com' } }, res);
  expect(mocks.updateUser).toHaveBeenCalledWith(3, { username: 'new@example.com' });
});
