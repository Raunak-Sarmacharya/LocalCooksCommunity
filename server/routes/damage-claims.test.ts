import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ file: vi.fn(), decide: vi.fn(), bookingClaims: vi.fn(), retry: vi.fn(), hold: vi.fn(), chefClaims: vi.fn(), pay: vi.fn(), dispute: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (_req: any, _res: any, next: any) => next(),
  requireManager: (_req: any, _res: any, next: any) => next(), requireAdmin: (_req: any, _res: any, next: any) => next() }));
vi.mock('./middleware', () => ({ requireChef: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/booking-support', () => ({ executeDamageClaimSupportAction: vi.fn() }));
vi.mock('../services/damage-claims-v2', () => ({ DamageClaimError: class extends Error { constructor(message: string, public status = 409) { super(message); } },
  readClaimBookingHold: state.hold, readChefClaims: state.chefClaims, disputeDamageClaim: state.dispute,
  fileDamageClaim: state.file, decideDamageClaim: state.decide, readStorageClaimFilingContext: vi.fn(), readBookingClaims: state.bookingClaims, readManagerClaims: vi.fn(), readClaimFilingContext: vi.fn(), replyToClaimReview: vi.fn() }));
vi.mock('../services/damage-claim-money', () => ({ prepareClaimPayment: state.pay, syncClaimPayment: vi.fn(), cancelClaimPayment: vi.fn(), retrySavedClaimMoney: state.retry }));
import router, { requireNoDamageClaimBookingHold } from './damage-claims';
const response = () => { const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }; return res; };
beforeEach(() => { vi.clearAllMocks(); state.hold.mockResolvedValue({ held: false, claims: [] }); state.chefClaims.mockResolvedValue({ claims: [] }); });
describe('claim route guards', () => {
  it('blocks only NEW booking creation endpoints; existing visits/changes/extensions stay usable', () => {
    const creation = (router as any).stack.find((layer: any) => Array.isArray(layer.route?.path));
    expect(creation.route.path).toEqual(['/chef/bookings', '/chef/bookings/checkout', '/payments/create-intent', '/bookings/checkout']);
    expect(creation.route.path.some((path: string) => path.includes(':id') || path.includes('extension') || path.includes('checkin'))).toBe(false);
  });
  it('applies the live seven-day hold and allows booking again as soon as the service reports resolution', async () => {
    const req: any = { neonUser: { id: 5, role: 'chef' } }, res = response(), next = vi.fn();
    state.hold.mockResolvedValue({ held: true, claims: [{ id: 1 }] }); await requireNoDamageClaimBookingHold(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
    state.hold.mockResolvedValue({ held: false, claims: [] }); await requireNoDamageClaimBookingHold(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the booking hold cannot be read, while payment/dispute paths do not use the guard', async () => {
    state.hold.mockRejectedValue(Error('Database offline'));
    const res = response(), next = vi.fn(); await requireNoDamageClaimBookingHold({ neonUser: { id: 5, role: 'chef' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
    for (const path of ['/chef/damage-claims/:id/pay', '/chef/damage-claims/:id/dispute']) {
      const layer = (router as any).stack.find((layer: any) => layer.route?.path === path);
      expect(layer.route.stack.some((handler: any) => handler.handle === requireNoDamageClaimBookingHold)).toBe(false);
    }
  });
  it('a chef cannot fetch the ID/evidence of a first-review claim', async () => {
    const layer = (router as any).stack.find((layer: any) => layer.route?.path === '/chef/damage-claims/:id');
    const res = response(); await layer.route.stack.at(-1).handle({ params: { id: '1' }, neonUser: { id: 5, role: 'chef' } }, res);
    expect(res.status).toHaveBeenCalledWith(404); expect(res.json).toHaveBeenCalledWith({ error: 'Claim not found.' });
  });
});

it('storage claim routes use the authenticated manager and explicit rental kind for admin actions and retries', async () => {
  const call = async (path: string, body: unknown, params = { id: '7', claimId: '9' }) => {
    const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route.methods.post);
    const res = response(); await layer.route.stack.at(-1).handle({ params, body, neonUser: { id: 2, role: 'admin' } }, res);
    return res;
  };
  await call('/manager/storage-rentals/:id/claims', { description: 'Damaged shelf.', storageRentalId: 99 });
  expect(state.file).toHaveBeenCalledWith(2, { description: 'Damaged shelf.', storageRentalId: 7 });
  await call('/admin/storage-rentals/:id/claims/actions', { type: 'claim_send' });
  expect(state.decide).toHaveBeenCalledWith(7, 2, { type: 'claim_send' }, 'storage');
  await call('/admin/storage-rentals/:id/claims/:claimId/retry', {});
  expect(state.retry).toHaveBeenCalledWith(7, 9, 2, 'storage');
});
