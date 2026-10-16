import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ quote: vi.fn(), checkout: vi.fn(), read: vi.fn(), list: vi.fn(), decide: vi.fn(), withdraw: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/storage-rentals', () => ({ quoteRental: h.quote, createRentalCheckout: h.checkout, readRental: h.read,
  listRentals: h.list, decideRental: h.decide, withdrawRental: h.withdraw,
  StorageRentalError: class extends Error { constructor(public code: string, public status = 409) { super(code); } } }));
import router from './storage-rentals';
import { StorageRentalError } from '../services/storage-rentals';
const user = { id: 3, preferredLocale: 'fr-CA' };
const details = { listingId: 1, startOn: '2026-10-18', days: 7 };
const body = { ...details, requestKey: 'request_123', expectedTotalCents: 7000, acceptedTermsVersion: 'storage-v1', cancellationPolicyVersion: 1, disclosureVersion: 'storage-v1', quotedAt: '2026-10-16T12:00:00Z' };
async function call(method: string, path: string, data: unknown = body, param = '7') {
  const route = (router as any).stack.find((r: any) => r.route?.path === path && r.route.methods[method]).route;
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  await route.stack[0].handle({ body: data, params: { id: param }, neonUser: user, path }, res);
  return res;
}
beforeEach(() => { vi.resetAllMocks(); h.read.mockResolvedValue({ id: 7, actions: [] }); });
describe('storage rental API contract', () => {
  it('passes only the validated quote/checkout inputs and authenticated locale', async () => {
    h.quote.mockResolvedValue({ totalCents: 7000 }); h.checkout.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.test' });
    expect((await call('post', '/chef/storage-rentals/quote')).json).toHaveBeenCalledWith({ totalCents: 7000 });
    expect(h.quote).toHaveBeenCalledWith(3, details);
    await call('post', '/chef/storage-rentals', { ...body, chefId: 9, dailyPriceCents: 1 });
    expect(h.checkout).toHaveBeenCalledWith(3, body, undefined, undefined, 'fr-CA');
  });
  it.each(['price_changed', 'policy_changed', 'full'])('returns a localized 409 for %s', async code => {
    h.checkout.mockRejectedValue(new StorageRentalError(code));
    const res = await call('post', '/chef/storage-rentals');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ code, error: expect.any(String) });
    expect(res.json.mock.calls[0][0].error).not.toContain('stError_');
  });
  it('rejects malformed details, ids, unit index and blank decline reason', async () => {
    for (const data of [{ ...body, days: 31 }, { ...body, listingId: '1' }, { ...body, requestKey: '' }])
      expect((await call('post', '/chef/storage-rentals', data)).status).toHaveBeenCalledWith(400);
    expect((await call('post', '/manager/storage-rentals/:id/approve', { unitIndex: 0 })).status).toHaveBeenCalledWith(400);
    expect((await call('post', '/manager/storage-rentals/:id/decline', { reason: '  ' })).status).toHaveBeenCalledWith(400);
    expect((await call('get', '/chef/storage-rentals/:id', {}, '7junk')).status).toHaveBeenCalledWith(400);
    expect(h.checkout).not.toHaveBeenCalled(); expect(h.decide).not.toHaveBeenCalled();
  });
  it('returns the server DTO after manager decisions or chef withdrawal', async () => {
    await call('post', '/manager/storage-rentals/:id/approve', { unitIndex: 2 });
    expect(h.decide).toHaveBeenCalledWith(7, 'reserved', { id: 3, role: 'manager' }, { unitIndex: 2 });
    await call('post', '/manager/storage-rentals/:id/decline', { reason: ' No space ' });
    expect(h.decide).toHaveBeenCalledWith(7, 'declined', { id: 3, role: 'manager' }, { reason: 'No space' });
    await call('post', '/chef/storage-rentals/:id/withdraw', {});
    expect(h.withdraw).toHaveBeenCalledWith(7, 3);
    expect(h.read).toHaveBeenLastCalledWith(7, { id: 3, role: 'chef' });
  });
});
