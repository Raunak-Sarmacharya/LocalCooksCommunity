import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLATION_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
const h = vi.hoisted(() => ({ snapshot: vi.fn(), create: vi.fn(), row: null as any }));
vi.mock('../firebase-auth-middleware', () => ({ requireAdmin: vi.fn(), requireManager: vi.fn() }));
vi.mock('../routes/middleware', () => ({ requireChef: vi.fn(), requireNoUnpaidPenalties: vi.fn() }));
vi.mock('./kitchen-invitations', () => ({ InvitationError: class extends Error { constructor(message: string, public status = 400, public code?: string) { super(message); } },
  getInvitationForChef: async () => h.row, invitationCheckoutPricing: async () => ({ equipment: [], subtotalCents: 10000, taxCents: 1500, serviceFeeCents: 700, totalCents: 12200 }) }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { validateBookingAvailability: async () => ({ valid: true, windowStartTime: '09:00' }) } }));
vi.mock('./kitchen-checkout-holds', () => ({ reserveKitchenCheckout: async () => 'hold_one', bindKitchenCheckout: vi.fn(), releaseKitchenCheckout: vi.fn() }));
vi.mock('./stripe-checkout-service', () => ({ createPendingCheckoutSession: h.create, expireAbandonedCheckoutSession: vi.fn() }));
vi.mock('./cancellation-policy-settings', async importOriginal => {
  const actual = await importOriginal<typeof import('./cancellation-policy-settings')>();
  return { ...actual, checkoutCancellationSnapshot: (...args: Parameters<typeof actual.checkoutCancellationSnapshot>) => {
    h.snapshot(...args); return actual.checkoutCancellationSnapshot(...args);
  } };
});
vi.mock('../db', () => ({ db: {
  select: () => { let table: any; const q: any = { from: (value: any) => { table = value; return q; }, where: () => q, orderBy: () => q,
    limit: async () => table[Symbol.for('drizzle:Name')] === 'kitchen_cancellation_policies'
      ? [{ id: 2, version: 2, noticeHours: 72, lateChargePercent: 100 }] : [{ account: 'acct_test', email: 'chef@example.test' }] }; return q; },
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [h.row] }) }) }),
  insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
} }));
import router from '../routes/kitchen-invitations';
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T09:00:00Z')); h.row = { id: 'inv_one', version: 1, chefId: 3, kitchenId: 4, locationId: 5, managerId: 2, status: 'sent', expiresAt: new Date('2098-01-01'),
  date: '2099-01-01', startTime: '09:00', endTime: '10:00', timezone: 'UTC', pricingMode: 'hourly', selectedSlots: [{ startTime: '09:00', endTime: '10:00' }], offeredSubtotalCents: 10000, listSubtotalCents: 12000,
  cancellationPolicyHours: 24, cancellationChargePercent: 50 };
  h.create.mockResolvedValue({ sessionId: 'cs_test', sessionUrl: 'https://checkout.example.test' });
});
afterEach(() => vi.useRealTimers());

async function checkout(body: Record<string, unknown> = {}) {
  const layer: any = router.stack.find((layer: any) => layer.route?.path === '/chef/invitations/:id/checkout');
  const req: any = { neonUser: { id: 3 }, params: { id: 'inv_one' }, body: { equipmentIds: [], cancellationPolicyAccepted: true,
    cancellationPolicyVersion: 2, cancellationDisclosureVersion: CANCELLATION_DISCLOSURE_VERSION, ...body }, protocol: 'https', get: () => 'app.example.test' };
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  await layer.route.stack.at(-1).handle(req, res);
  return res;
}
describe('invitation cancellation disclosure contract', () => {
  it('rejects a policy the chef has not reviewed with a plain 409 before Stripe', async () => {
    const res = await checkout({ cancellationPolicyVersion: 1 });
    expect(res.status).toHaveBeenCalledWith(409); expect(h.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ code: 'policy_changed', error: 'The cancellation policy changed. Review the updated policy before paying.' });
    expect(h.snapshot).toHaveBeenCalledWith(4, '2099-01-01', '09:00', '09:00', 'UTC', true, 1, CANCELLATION_DISCLOSURE_VERSION);
  });
  it('records the reviewed version and consent-by-button disclosure', async () => {
    const res = await checkout();
    expect(res.status).not.toHaveBeenCalled(); expect(h.create).toHaveBeenCalledOnce();
    expect(h.create.mock.calls[0][0].bookingData.cancellationPolicySnapshot).toMatchObject({ version: 2, noticeHours: 72,
      lateChargePercent: 100, disclosureVersion: CANCELLATION_DISCLOSURE_VERSION });
  });
  it.each([{ cancellationPolicyAccepted: false }, { cancellationDisclosureVersion: 'unknown' }])('rejects invalid consent %j', async body => {
    expect((await checkout(body)).status).toHaveBeenCalledWith(409);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('rechecks the checkout cutoff under the newly accepted longer notice period', async () => {
    h.row.date = '2026-10-19';
    const res = await checkout();
    expect(res.status).toHaveBeenCalledWith(409); expect(h.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'checkout_cutoff' }));
  });
  it('allows checkout just before the accepted policy cutoff and rejects its exact boundary', async () => {
    h.row.date = '2026-10-19';
    vi.setSystemTime(new Date('2026-10-16T08:22:59Z'));
    expect((await checkout()).status).not.toHaveBeenCalled();
    h.create.mockClear();
    vi.setSystemTime(new Date('2026-10-16T08:23:00Z'));
    expect((await checkout()).status).toHaveBeenCalledWith(409);
    expect(h.create).not.toHaveBeenCalled();
  });
});
