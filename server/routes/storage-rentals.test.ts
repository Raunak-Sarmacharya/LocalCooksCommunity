import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ quote: vi.fn(), checkout: vi.fn(), read: vi.fn(), list: vi.fn(), decide: vi.fn(), withdraw: vi.fn(),
  adminAction: vi.fn(), visit: vi.fn(), extensionQuote: vi.fn(), extensionPay: vi.fn(), extensionSync: vi.fn(), raise: vi.fn(), waive: vi.fn(), record: vi.fn(), notice: vi.fn(), open: vi.fn() }));
vi.mock('../services/storage-checkout-service', () => ({ storageRentalVisitAction: h.visit }));
vi.mock('../services/storage-extensions', () => ({ quoteExtension: h.extensionQuote, payExtension: h.extensionPay, syncStorageTerm: h.extensionSync }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../services/storage-rental-lifecycle', () => ({ raiseHoldoverCharge: h.raise, waiveHoldover: h.waive, recordRemoval: h.record, sendFinalNotice: h.notice, openRemovalReview: h.open }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/storage-rentals', () => ({ quoteRental: h.quote, createRentalCheckout: h.checkout, readRental: h.read,
  listRentals: h.list, decideRental: h.decide, withdrawRental: h.withdraw,
  StorageRentalError: class extends Error { constructor(public code: string, public status = 409) { super(code); } } }));
vi.mock('../services/admin-storage', async importOriginal => ({ ...await importOriginal<any>(), runAdminStorageAction: h.adminAction }));
import router from './storage-rentals';
import { StorageRentalError } from '../services/storage-rentals';
const user = { id: 3, preferredLocale: 'fr-CA' };
const details = { listingId: 1, startOn: '2026-10-18', days: 7 };
const body = { ...details, requestKey: 'request_123', expectedTotalCents: 7000, acceptedTermsVersion: 'storage-v1', cancellationPolicyVersion: 1, disclosureVersion: 'storage-v1', quotedAt: '2026-10-16T12:00:00Z' };
async function call(method: string, path: string, data: unknown = body, param = '7') {
  const route = (router as any).stack.find((r: any) => r.route?.path === path && r.route.methods[method]).route;
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  await route.stack[0].handle({ body: data, params: { id: param, termId: '9' }, neonUser: user, path }, res);
  return res;
}
beforeEach(() => { vi.resetAllMocks(); h.read.mockResolvedValue({ id: 7, actions: [] }); });
describe('storage rental API contract', () => {
  it('extends for the authenticated chef without an unpaid-penalty gate, and syncs a validated term', async () => {
    h.extensionPay.mockResolvedValue({ requiresAction: true, clientSecret: 'secret_fixture', termId: 9 });
    const extension = { days: 3, expectedTotalCents: 3550, requestKey: 'extension_key', useSavedCard: true };
    await call('post', '/chef/storage-rentals/:id/extend/quote', { days: 3 });
    expect(h.extensionQuote).toHaveBeenCalledWith(7, 3, 3);
    const result = await call('post', '/chef/storage-rentals/:id/extend', { ...extension, chefId: 99 });
    expect(h.extensionPay).toHaveBeenCalledWith(7, 3, extension, undefined, undefined, 'fr-CA');
    expect(result.json).toHaveBeenCalledWith({ requiresAction: true, clientSecret: 'secret_fixture', termId: 9 });
    await call('post', '/chef/storage-rentals/:id/extend/:termId/sync', {});
    expect(h.extensionSync).toHaveBeenCalledWith(7, 9, 3);
    expect((await call('post', '/chef/storage-rentals/:id/extend', { ...extension, useSavedCard: 'yes' })).status).toHaveBeenCalledWith(400);
    const route = (router as any).stack.find((r: any) => r.route?.path === '/chef/storage-rentals/:id/extend').route;
    expect(route.stack).toHaveLength(1);
  });
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
  it('validates and forwards the holdover, final-notice and removal inputs', async () => {
    await call('post', '/manager/storage-rentals/:id/holdover-charge', { amountCents: 500, note: ' late ', extra: 1 });
    expect(h.raise).toHaveBeenCalledWith(7, 3, { amountCents: 500, note: 'late' });
    await call('post', '/manager/storage-rentals/:id/holdover-waive', { reason: ' kind ' });
    expect(h.waive).toHaveBeenCalledWith(7, 3, { reason: 'kind' });
    await call('post', '/manager/storage-rentals/:id/removal/record', { all: true });
    expect(h.record).toHaveBeenCalledWith(7, { id: 3, role: 'manager' }, { all: true });
    const notice = { photos: ['https://img.test/a.jpg'], items: [{ name: 'Flour', qty: 2, perishable: false }] };
    const audit = { reason: 'Reviewed with the kitchen.', operationKey: 'final-notice-test' };
    await call('post', '/admin/storage-rentals/:id/final-notice', { ...notice, ...audit });
    expect(h.adminAction).toHaveBeenCalledWith(7, 3, expect.objectContaining({ ...notice, ...audit, type: 'send_final_notice', fundedBy: 'none' }));
    await call('post', '/admin/storage-rentals/:id/open-removal-review', audit);
    expect(h.adminAction).toHaveBeenCalledWith(7, 3, expect.objectContaining({ type: 'open_removal_review', ...audit }));
    for (const [path, data] of [['/manager/storage-rentals/:id/holdover-charge', { amountCents: 1.5 }], ['/manager/storage-rentals/:id/holdover-charge', {}],
      ['/manager/storage-rentals/:id/holdover-waive', { reason: ' ' }], ['/admin/storage-rentals/:id/final-notice', { photos: [], items: notice.items }],
      ['/admin/storage-rentals/:id/final-notice', { photos: notice.photos, items: [] }]] as const)
      expect((await call('post', path, data)).status).toHaveBeenCalledWith(400);
  });
  it('returns a localized 400 when a holdover charge exceeds what has built up', async () => {
    h.raise.mockRejectedValue(new StorageRentalError('exceeds_accrued', 400));
    const res = await call('post', '/manager/storage-rentals/:id/holdover-charge', { amountCents: 99999 });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 'exceeds_accrued', error: expect.not.stringContaining('stError_') });
  });
});

describe('storage visit endpoints', () => {
  it.each(['handover', 'clear-move-out', 'items-still-here', 'mark-ready'])('forwards %s as the authenticated manager and returns the refreshed DTO', async action => {
    const input = action === 'clear-move-out' ? { needsCleaning: true } : action === 'mark-ready' ? {} : { photoUrls: ['https://example.invalid/photo.jpg'], note: ' Shelf inspected ' };
    await call('post', `/manager/storage-rentals/:id/${action}`, { ...input, operationKey: 'storage:7:op' });
    expect(h.visit).toHaveBeenCalledWith(7, { id: 3, role: 'manager' }, action,
      action === 'clear-move-out' || action === 'mark-ready' ? input : { ...input, note: 'Shelf inspected' });
    expect(h.read).toHaveBeenCalledWith(7, { id: 3, role: 'manager' });
  });
  it('validates photos and the cleaning choice; maps a re-let conflict to localized 409', async () => {
    expect((await call('post', '/manager/storage-rentals/:id/clear-move-out', {})).status).toHaveBeenCalledWith(400);
    expect((await call('post', '/manager/storage-rentals/:id/handover', { photoUrls: ['bad'] })).status).toHaveBeenCalledWith(400);
    h.visit.mockRejectedValue(new StorageRentalError('relet'));
    const result = await call('post', '/manager/storage-rentals/:id/items-still-here', { photoUrls: ['https://example.invalid/box.jpg'] });
    expect(result.status).toHaveBeenCalledWith(409);
    expect(result.json).toHaveBeenCalledWith({ code: 'relet', error: expect.not.stringContaining('stError_') });
  });
});
