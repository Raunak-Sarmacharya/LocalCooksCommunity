/**
 * Session extensions + extra-time charges (build-session-extensions.md). Every decision is a POST from the app;
 * emails only link to the booking page, so nothing is ever approved, paid or declined through a GET.
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireFirebaseAuthWithUser, requireAdmin, requireManager } from '../firebase-auth-middleware';
import { createSessionExtension, decideSessionExtension, pendingSessionExtensionRequests, readSessionExtensions,
  SessionExtensionError, syncSessionExtension } from '../services/session-extensions';
import { readSessionExtensionSettings, saveSessionExtensionSettings, sessionExtensionsEnabled, SessionExtensionSettingsError,
  setSessionExtensionsEnabled } from '../services/session-extension-settings';
import { BookingMoneyFrozen } from '../services/booking-money-guard';
import { logger } from '../logger';

const router = Router();
const auth = requireFirebaseAuthWithUser as RequestHandler;
const cents = z.number().int().positive().max(10_000_000);
// expectedEndAt: the boundary the person saw (booked end; booked start for an early start). free: the manager's choice.
const create = z.object({ kind: z.enum(['request', 'offer', 'extra_time', 'early_start']),
  minutes: z.number().int().positive().max(120).refine(value => value % 15 === 0).optional(),
  amountCents: cents.optional(), note: z.string().max(1000).optional(), requestKey: z.string().uuid(), visitId: z.number().int().positive().optional(),
  expectedEndAt: z.string().datetime(), expectedAmountCents: z.number().int().nonnegative().max(10_000_000), free: z.boolean().optional() }).strict()
  .refine(input => input.kind === 'extra_time' || input.minutes !== undefined, { message: 'Choose how much time' })
  .refine(input => input.kind === 'early_start' || input.kind === 'extra_time' || [30, 60, 120].includes(input.minutes!), { message: 'Choose 30 minutes, 1 hour or 2 hours' })
  .refine(input => input.free ? input.expectedAmountCents === 0 : input.expectedAmountCents > 0, { message: 'Review the price' });
const decision = z.object({ action: z.enum(['approve', 'approve_free', 'decline', 'accept', 'pay', 'dispute']), expectedAmountCents: cents.optional(),
  note: z.string().max(1000).optional() }).strict();

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new SessionExtensionError('Payments are unavailable right now. Nothing was charged.', 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
}
const positive = (value: unknown) => { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; };
function handler(work: (req: Request, id: number) => Promise<unknown>, idParam = 'id') {
  return async (req: Request, res: Response) => {
    try {
      const id = positive(req.params[idParam]);
      if (!id) return res.status(400).json({ error: 'Choose a valid booking or kitchen' });
      res.json(await work(req, id));
    } catch (error) {
      const known = error instanceof SessionExtensionError || error instanceof SessionExtensionSettingsError;
      const status = known ? (error as SessionExtensionError).status : error instanceof z.ZodError ? 400 : error instanceof BookingMoneyFrozen ? 409 : 500;
      if (status >= 500) logger.error('[Session extension] Request failed', { path: req.path, error });
      res.status(status).json({ error: error instanceof z.ZodError ? 'Review the extra-time details and try again.'
        : known || error instanceof BookingMoneyFrozen ? (error as Error).message
        : 'Extra time could not be loaded or saved. Nothing new was charged. Retry or contact Local Cooks.' });
    }
  };
}
const actor = (req: Request) => ({ id: req.neonUser!.id, role: req.neonUser!.role ?? null });

router.get('/bookings/:id/extensions', auth, handler((req, id) =>
  readSessionExtensions(id, actor(req), positive(req.query.visitId) ?? undefined)));
router.post('/bookings/:id/extensions', auth, handler((req, id) => createSessionExtension(stripeClient(), id, actor(req), create.parse(req.body))));
router.post('/bookings/:id/extensions/:extensionId/decision', auth, handler((req, id) => {
  const extensionId = positive(req.params.extensionId);
  if (!extensionId) throw new SessionExtensionError('Choose a valid request', 400);
  return decideSessionExtension(stripeClient(), id, extensionId, actor(req), decision.parse(req.body));
}));
router.post('/bookings/:id/extensions/:extensionId/sync', auth, handler((req, id) => {
  const extensionId = positive(req.params.extensionId);
  if (!extensionId) throw new SessionExtensionError('Choose a valid request', 400);
  return syncSessionExtension(stripeClient(), id, extensionId, actor(req));
}));

router.get('/manager/session-extensions/pending', auth, requireManager as RequestHandler, async (req, res) => {
  try { res.json(await pendingSessionExtensionRequests(req.neonUser!.id)); }
  catch (error) { logger.error('[Session extension] Pending list failed', { error }); res.status(500).json({ error: 'Requests for more time could not be loaded.' }); }
});
router.get('/manager/kitchens/:id/session-extension-settings', auth, requireManager as RequestHandler, handler((req, id) => readSessionExtensionSettings(id, actor(req))));
router.put('/manager/kitchens/:id/session-extension-settings', auth, requireManager as RequestHandler, handler((req, id) =>
  saveSessionExtensionSettings(id, actor(req), z.object({ autoApprove: z.boolean() }).strict().parse(req.body))));
router.get('/admin/kitchens/:id/session-extension-settings', auth, requireAdmin as RequestHandler, handler((req, id) => readSessionExtensionSettings(id, actor(req))));
router.put('/admin/kitchens/:id/session-extension-settings', auth, requireAdmin as RequestHandler, handler((req, id) =>
  saveSessionExtensionSettings(id, actor(req), z.object({ override: z.boolean().nullable(), reason: z.string().min(1).max(2000) }).strict().parse(req.body))));
router.get('/admin/session-extensions', auth, requireAdmin as RequestHandler, async (_req, res) => {
  try { res.json({ enabled: await sessionExtensionsEnabled() }); }
  catch { res.status(500).json({ error: 'Setting unavailable' }); }
});
router.put('/admin/session-extensions', auth, requireAdmin as RequestHandler, async (req, res) => {
  try {
    const input = z.object({ enabled: z.boolean(), reason: z.string().min(1).max(500) }).strict().parse(req.body);
    res.json(await setSessionExtensionsEnabled(actor(req), input.enabled, input.reason));
  } catch (error) { res.status(400).json({ error: error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Include on/off and a reason' }); }
});
export default router;
