import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ checkout: vi.fn(async () => ({ checkoutUrl: 'https://checkout.stripe.test/pay' })) }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireAdmin: vi.fn(), requireManager: vi.fn() }));
vi.mock('stripe', () => ({ default: class {} }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://chef.localcooks.test' }));
vi.mock('../services/session-extensions', () => ({ checkoutSessionExtension: state.checkout, createSessionExtension: vi.fn(), decideSessionExtension: vi.fn(),
  pendingSessionExtensionRequests: vi.fn(), readSessionExtensions: vi.fn(), syncSessionExtension: vi.fn(),
  SessionExtensionError: class extends Error { constructor(message: string, public status = 409, public translationKey?: string) { super(message); } } }));
vi.mock('../services/session-extension-settings', () => ({ 
  sessionExtensionsEnabled: vi.fn(), setSessionExtensionsEnabled: vi.fn(), SessionExtensionSettingsError: class extends Error {} }));
vi.mock('../services/booking-money-guard', () => ({ BookingMoneyFrozen: class extends Error {} }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import router from './session-extensions';
import { SessionExtensionError } from '../services/session-extensions';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'mock-only'); });
const call = async (returnPath: string, extra = {}, preferredLocale = 'en-CA') => {
  const entry = (router as any).stack.find((e: any) => e.route?.path === '/bookings/:id/extensions/:extensionId/checkout');
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await entry.route.stack.at(-1).handle({ params: { id: '10', extensionId: '5' }, neonUser: { id: 3, role: 'chef', preferredLocale },
    body: { expectedAmountCents: 1501, returnPath, ...extra } }, res);
  return res;
};
it.each(['/booking/10', '/booking/10/visit?visitId=22'])('returns Checkout to the chef page %s on the configured HTTPS origin', async path => {
  const res = await call(path);
  expect(res.status).not.toHaveBeenCalled();
  expect(state.checkout).toHaveBeenCalledWith(expect.anything(), 10, 5, { id: 3, role: 'chef' }, 1501, `https://chef.localcooks.test${path}`);
});
it.each(['https://evil.test/booking/10', '//evil.test/booking/10', '/booking/11', '/dashboard', '/booking/10/../../../admin'])
  ('rejects an unrelated or external return page %s before contacting Stripe', async path => {
    expect((await call(path)).status).toHaveBeenCalledWith(400); expect(state.checkout).not.toHaveBeenCalled();
  });
it.each([0, -1, '1501', 1.5])('rejects invalid price %s before contacting Stripe', async amount => {
  expect((await call('/booking/10', { expectedAmountCents: amount })).status).toHaveBeenCalledWith(400);
  expect(state.checkout).not.toHaveBeenCalled();
});
it('translates Checkout failures in the chef’s saved locale', async () => {
  state.checkout.mockRejectedValueOnce(new SessionExtensionError('Payment is still being checked', 409, 'sxbCheckoutBusy'));
  const res = await call('/booking/10', {}, 'fr-CA');
  expect(res.json).toHaveBeenCalledWith({ error: 'Votre paiement est en cours de vérification. Actualisez dans un instant.' });
});
