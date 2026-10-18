import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { getAppBaseUrl } from '../config';
import { checkoutKitchenChange, decideKitchenChange, KitchenChangeError, previewKitchenChange, readKitchenChanges,
  requestKitchenChange, resolveKitchenChange, syncKitchenChange } from '../services/kitchen-booking-changes';

const router = Router();
router.use(requireFirebaseAuthWithUser);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slots = z.array(z.object({ startTime: time, endTime: time }).strict()).max(24);
const single = z.object({ date, windowStart: time, pricingMode: z.enum(['hourly', 'daily']).optional(), slots: slots.min(1) }).strict();
/** CP7: a dated booking's whole day set (the server fills each day's window and a full day's hours). */
const days = z.object({ version: z.literal('days-v1'), days: z.array(z.object({ date, pricingMode: z.enum(['hourly', 'daily']), slots,
  windowStart: time.optional(), equipmentIds: z.array(z.number().int().positive()).max(50) }).strict()).min(1).max(14) }).strict()
  .transform(value => ({ version: value.version, days: value.days.map(day => ({ ...day, windowStart: day.windowStart ?? day.slots[0]?.startTime ?? '00:00' })) }));
const destination = z.union([single, days]);
const preview = z.object({ destination }).strict();
const request = z.object({ destination, quoteHash: z.string().regex(/^[0-9a-f]{64}$/), requestKey: z.string().uuid() }).strict();
const decision = z.object({ action: z.enum(['approve', 'decline', 'withdraw']), revision: z.number().int().positive(), message: z.string().trim().max(500).optional() }).strict();
const checkout = z.object({ returnPath: z.string().max(2000).optional() }).strict();

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new KitchenChangeError('Payment provider is unavailable. No payment was started.', 503, 'paymentProviderUnavailable');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
}
const optionalStripe = () => process.env.STRIPE_SECRET_KEY ? stripeClient() : null;
/** A same-origin booking page only: the chef comes back to the booking after paying. */
function returnUrl(path: string | undefined, bookingId: number) {
  const origin = getAppBaseUrl('chef');
  const url = new URL(path ?? `/booking/${bookingId}`, origin);
  if (path && !path.startsWith('/') || url.origin !== origin || !/^\/booking\/\d+(?:\/visit)?\/?$/.test(url.pathname))
    throw new KitchenChangeError('Choose a booking page to return to.', 400, 'chooseReturnPage');
  url.search = ''; url.hash = '';
  return url.toString();
}
function handler(work: (req: Request, id: number) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid booking', code: 'chooseValidBooking' });
      res.json(await work(req, id));
    } catch (error) {
      const status = error instanceof KitchenChangeError ? error.status : error instanceof z.ZodError ? 400 : 500;
      // The client turns `code` into a `booking` i18n key; `error` stays the English fallback.
      if (error instanceof KitchenChangeError) return res.status(status).json({ error: error.message, code: error.code, values: error.values ?? {} });
      res.status(status).json({ error: error instanceof z.ZodError ? 'Review the date, consecutive hours and request fields.' : 'Booking changes could not be loaded or verified. Retry or contact Local Cooks.',
        code: error instanceof z.ZodError ? 'reviewFields' : 'changeLoadFailed' });
    }
  };
}
router.get('/:id/changes', handler((req, id) => readKitchenChanges(id, req.neonUser!)));
router.post('/:id/changes/preview', handler((req, id) => previewKitchenChange(id, req.neonUser!, preview.parse(req.body))));
router.post('/:id/changes', handler(async (req, id) => {
  const input = request.parse(req.body);
  const result = await requestKitchenChange(optionalStripe(), id, req.neonUser!, input);
  // The Change itself is the contract; the saved-card state rides along as extra fields (the client offers "Pay with another card").
  const { change, ...extra } = result as { change: unknown } & Record<string, unknown>;
  return { ...(change as object), ...extra };
}));
router.post('/:id/changes/:changeId/decision', handler((req, id) => decideKitchenChange(optionalStripe(), id, req.params.changeId, req.neonUser!, decision.parse(req.body))));
router.post('/:id/changes/:changeId/checkout', handler(async (req, id) => {
  const input = checkout.parse(req.body ?? {});
  return checkoutKitchenChange(stripeClient(), id, req.params.changeId, req.neonUser!, returnUrl(input.returnPath, id));
}));
router.post('/:id/changes/:changeId/sync', handler((req, id) => syncKitchenChange(stripeClient(), id, req.params.changeId, req.neonUser!)));
export default router;

router.post('/:id/changes/:changeId/recovery', handler((req, id) => resolveKitchenChange(stripeClient(), id, req.params.changeId, req.neonUser!, z.object({ action: z.enum(['finish', 'compensate', 'close_keep_refund']), revision: z.number().int().positive() }).strict().parse(req.body))));
