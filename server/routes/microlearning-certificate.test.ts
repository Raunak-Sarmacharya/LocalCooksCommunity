import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
const mocks = vi.hoisted(() => ({ completion: vi.fn(), getUser: vi.fn() }));
vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('../fileUpload', () => ({ upload: {} }));
vi.mock('../alwaysFoodSafeAPI', () => ({ isAlwaysFoodSafeConfigured: () => false, submitToAlwaysFoodSafe: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: { getUser: mocks.getUser } }));
vi.mock('../domains/microlearning/microlearning.service', () => ({ microlearningService: { getUserCompletion: mocks.completion } }));
import router from './microlearning';

const handler = () => (router as any).stack.find((entry: any) => entry.route?.path === '/certificate/:userId').route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() });
const chef = { id: 7, role: 'chef', firebaseUid: 'uid-7' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.completion.mockResolvedValue({ confirmed: true, completedAt: '2026-10-20T15:00:00Z' });
  mocks.getUser.mockResolvedValue({ id: 7, username: 'sam@example.com' });
});

it("the chef downloads their own certificate by Firebase uid, as a real PDF", async () => {
  const res = response();
  await handler()({ params: { userId: 'uid-7' }, neonUser: chef, firebaseUser: { name: 'Sam Seller' } }, res);
  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
  const pdf = await PDFDocument.load(res.send.mock.calls[0][0]);
  expect(pdf.getTitle()).toBe('Certificate of completion · Local Cooks');
  expect(pdf.getPageCount()).toBe(1);
});

it("someone else's certificate is refused; admins may fetch by numeric id", async () => {
  const other = response();
  await handler()({ params: { userId: 'uid-8' }, neonUser: chef }, other);
  expect(other.status).toHaveBeenCalledWith(403);
  const admin = response();
  await handler()({ params: { userId: '7' }, neonUser: { id: 1, role: 'admin', firebaseUid: 'a' } }, admin);
  expect(admin.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
});

it('no certificate before the course is finished', async () => {
  mocks.completion.mockResolvedValue({ confirmed: false });
  const res = response();
  await handler()({ params: { userId: 'uid-7' }, neonUser: chef }, res);
  expect(res.status).toHaveBeenCalledWith(404);
});
