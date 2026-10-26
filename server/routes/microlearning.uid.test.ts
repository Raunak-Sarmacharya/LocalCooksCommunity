import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../domains/microlearning/microlearning.service', () => ({ microlearningService: {
  getUserProgress: vi.fn(async (id: number) => [{ userId: id }]), getUserCompletion: vi.fn(async (id: number) => ({ userId: id, confirmed: false })) } }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../certificate-utils', () => ({ generateCertificatePDF: vi.fn() }));
vi.mock('../fileUpload', () => ({ upload: { single: () => (_req: any, _res: any, next: any) => next() } }));
vi.mock('../db', () => ({ pool: null }));
vi.mock('../alwaysFoodSafeAPI', () => ({ isAlwaysFoodSafeConfigured: () => false, submitToAlwaysFoodSafe: vi.fn() }));
import router from './microlearning';

const app = express();
app.use((req: any, _res, next) => { req.neonUser = { id: 7, role: 'chef' }; next(); });
app.use(router);
let base = ''; let server: ReturnType<typeof app.listen>;
beforeAll(() => new Promise<void>(done => { server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; done(); }); }));
afterAll(() => new Promise<void>(done => server.close(() => done())));
const get = (path: string) => fetch(base + path);

describe('microlearning reads by Firebase UID', () => {
  it.each(['/progress/4Lhg73bn8QPti9P4ngRUwDV1Gst2', '/completion/4Lhg73bn8QPti9P4ngRUwDV1Gst2'])('%s: a UID that starts with digits is the signed-in user, not user 4', async path => {
    const response = await get(path);
    expect(response.status).toBe(200);
  });
  it('another numeric user id is still refused', async () => {
    expect((await get('/progress/4')).status).toBe(403);
  });
});
