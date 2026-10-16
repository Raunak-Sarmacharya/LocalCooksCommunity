import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), page: vi.fn(), notes: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
}));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn() }));
vi.mock('../services/manager-customers', () => ({
  listManagerCustomers: mocks.list, listCustomerNotes: mocks.notes, createCustomerNote: mocks.create, updateCustomerNote: mocks.update, deleteCustomerNote: mocks.remove,
}));
vi.mock('../services/manager-customer-page', () => ({ getCustomerPage: mocks.page }));
import router from './manager-customers';
import { requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { DomainError } from '../shared/errors/domain-error';

const find = (path: string, method: string) => (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
const call = async (path: string, method: string, req: Record<string, unknown>) => {
  const res: any = { statusCode: 200, status: vi.fn((code: number) => { res.statusCode = code; return res; }), json: vi.fn(), setHeader: vi.fn() };
  await find(path, method)({ query: {}, params: {}, body: {}, neonUser: { id: 2, role: 'manager' }, ...req }, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ customers: [], counts: {}, nextCursor: null, locations: [] });
  mocks.page.mockResolvedValue({ customer: { chefId: 7 } });
  mocks.notes.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: 5 });
  mocks.update.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

it('mounts authentication and manager-only middleware ahead of every route', () => {
  const layers = (router as any).stack.filter((entry: any) => !entry.route).map((entry: any) => entry.handle);
  expect(layers.indexOf(requireFirebaseAuthWithUser)).toBeGreaterThanOrEqual(0);
  expect(layers.indexOf(requireManager)).toBeGreaterThan(layers.indexOf(requireFirebaseAuthWithUser) - 1);
  const firstRoute = (router as any).stack.findIndex((entry: any) => entry.route);
  expect((router as any).stack.slice(0, firstRoute).some((entry: any) => entry.handle === requireManager)).toBe(true);
});

describe('GET /', () => {
  it('always scopes by the signed-in manager, never a client-supplied id', async () => {
    await call('/', 'get', { query: { locationId: '47', status: 'in_review', q: 'priya', sort: 'name', managerId: '99' } });
    expect(mocks.list).toHaveBeenCalledWith(2, { locationId: 47, status: 'in_review', q: 'priya', sort: 'name', cursor: undefined });
  });
  it('defaults to every location, all statuses, needs-action sort', async () => {
    await call('/', 'get', {});
    expect(mocks.list).toHaveBeenCalledWith(2, { locationId: undefined, status: 'all', q: '', sort: 'needs_action', cursor: undefined });
    await call('/', 'get', { query: { locationId: 'all' } });
    expect(mocks.list).toHaveBeenLastCalledWith(2, expect.objectContaining({ locationId: undefined }));
  });
  it.each([{ locationId: 'abc' }, { locationId: '-3' }, { status: 'bogus' }, { sort: 'bogus' }])('rejects %j with 400 before reading', async query => {
    const res = await call('/', 'get', { query });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('passes a DomainError through as its own status', async () => {
    mocks.list.mockRejectedValue(new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404));
    const res = await call('/', 'get', { query: { locationId: '99' } });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Location not found' });
  });
  it('never lets a response be cached', () => {
    const layer = (router as any).stack.filter((entry: any) => !entry.route).at(-1).handle;
    const res: any = { setHeader: vi.fn() };
    layer({}, res, () => {});
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});

describe('GET /:chefId', () => {
  it('returns the page for the manager and location', async () => {
    const res = await call('/:chefId', 'get', { params: { chefId: '7' }, query: { locationId: '47', past: 'all' } });
    expect(mocks.page).toHaveBeenCalledWith(2, 7, 47, { allPast: true });
    expect(res.json).toHaveBeenCalledWith({ customer: { chefId: 7 } });
  });
  it('a missing or other manager’s customer or location is a 404', async () => {
    mocks.page.mockRejectedValue(new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404));
    expect((await call('/:chefId', 'get', { params: { chefId: '7' }, query: { locationId: '47' } })).status).toHaveBeenCalledWith(404);
    expect((await call('/:chefId', 'get', { params: { chefId: 'x' } })).status).toHaveBeenCalledWith(404);
    expect((await call('/:chefId', 'get', { params: { chefId: '7' }, query: { locationId: 'x' } })).status).toHaveBeenCalledWith(404);
  });
});

describe('notes', () => {
  it('lists, creates, edits and deletes only through the signed-in manager', async () => {
    await call('/:chefId/notes', 'get', { params: { chefId: '7' }, query: { locationId: '47' } });
    expect(mocks.notes).toHaveBeenCalledWith(2, 7, 47);
    const created = await call('/:chefId/notes', 'post', { params: { chefId: '7' }, query: { locationId: '47' }, body: { body: 'Prefers early slots', authorId: 99 } });
    expect(mocks.create).toHaveBeenCalledWith(2, 7, 47, 'Prefers early slots');
    expect(created.status).toHaveBeenCalledWith(201);
    await call('/:chefId/notes/:noteId', 'patch', { params: { chefId: '7', noteId: '5' }, query: { locationId: '47' }, body: { body: 'Edited' } });
    expect(mocks.update).toHaveBeenCalledWith(2, 7, 47, 5, 'Edited');
    await call('/:chefId/notes/:noteId', 'delete', { params: { chefId: '7', noteId: '5' }, query: { locationId: '47' } });
    expect(mocks.remove).toHaveBeenCalledWith(2, 7, 47, 5);
  });
  it('needs a location and valid ids', async () => {
    expect((await call('/:chefId/notes', 'post', { params: { chefId: '7' }, body: { body: 'x' } })).status).toHaveBeenCalledWith(400);
    expect((await call('/:chefId/notes', 'get', { params: { chefId: '0' }, query: { locationId: '47' } })).status).toHaveBeenCalledWith(404);
    expect((await call('/:chefId/notes/:noteId', 'delete', { params: { chefId: '7', noteId: 'x' }, query: { locationId: '47' } })).status).toHaveBeenCalledWith(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('maps a refused edit (not the author) to 403 and a foreign location to 404', async () => {
    mocks.update.mockRejectedValue(new DomainError('NOTE_NOT_YOURS', 'You can only change notes you wrote.', 403));
    expect((await call('/:chefId/notes/:noteId', 'patch', { params: { chefId: '7', noteId: '5' }, query: { locationId: '47' }, body: { body: 'x' } })).status).toHaveBeenCalledWith(403);
    mocks.notes.mockRejectedValue(new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404));
    expect((await call('/:chefId/notes', 'get', { params: { chefId: '7' }, query: { locationId: '999' } })).status).toHaveBeenCalledWith(404);
  });
});
