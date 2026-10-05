import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { getAppBaseUrl } from '../config';
import { checkoutKitchenChange, decideKitchenChange, KitchenChangeError, kitchenChangeDecisionContext,
  previewKitchenChange, readKitchenChanges, requestKitchenChange, syncKitchenChange } from '../services/kitchen-booking-changes';

const router = Router();
router.use(requireFirebaseAuthWithUser);
const destination = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), pricingMode: z.enum(['hourly', 'daily']).optional(),
  slots: z.array(z.object({ startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()).min(1).max(24) }).strict();
const linkedItems = z.array(z.object({ kind: z.literal('storage'), id: z.number().int().positive(), action: z.literal('retain'),
  updatedAt: z.string().datetime(), startDate: z.string().datetime(), endDate: z.string().datetime() }).strict()).max(100).default([]);
const preview = z.object({ kind: z.enum(['move', 'extend']), destination, linkedItems }).strict();
const cents = z.number().int().nonnegative();
const quote = z.object({ originalKitchenCents: cents, currentKitchenCents: cents, retainedKitchenCents: cents,
  addedKitchenCents: cents, taxCents: cents.nullable(), feeCents: cents.nullable(), payableCents: cents.nullable(), currency: z.string(),
  refundKitchenCents: cents, refundTaxCents: cents.nullable(), refundableCents: cents.nullable() }).strict();
function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new KitchenChangeError('Payment provider is unavailable. No payment was started.', 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
}
function handler(work: (req: Request, id: number) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid booking' });
      res.json(await work(req, id));
    } catch (error) {
      const status = error instanceof KitchenChangeError ? error.status : error instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ error: error instanceof z.ZodError ? 'Review the date, consecutive hours and request fields.'
        : error instanceof KitchenChangeError ? error.message : 'Booking changes could not be loaded or verified. Retry or contact Local Cooks.' });
    }
  };
}
router.get('/:id/changes', handler((req, id) => readKitchenChanges(id, req.neonUser!)));
router.post('/:id/changes/preview', handler((req, id) => {
  const input = preview.parse(req.body); return previewKitchenChange(id, req.neonUser!, input.kind, input.destination, input.linkedItems);
}));
router.post('/:id/changes', handler((req, id) => requestKitchenChange(id, req.neonUser!, preview.extend({
  requestKey: z.string().uuid(), expectedUpdatedAt: z.string().datetime(), quote }).parse(req.body))));
router.get('/:id/changes/:changeId/decision-context', handler((req, id) => kitchenChangeDecisionContext(id, req.params.changeId, req.neonUser!)));
router.post('/:id/changes/:changeId/decision', handler((req, id) => decideKitchenChange(id, req.params.changeId, req.neonUser!, z.object({
  revision: z.number().int().positive(), action: z.enum(['approve', 'decline', 'withdraw', 'consent']),
  overlapKey: z.string().optional(), acceptTourOverlap: z.boolean().optional() }).strict().parse(req.body))));
router.post('/:id/changes/:changeId/checkout', handler(async (req, id) => {
  const session = await checkoutKitchenChange(stripeClient(), id, req.params.changeId, req.neonUser!, getAppBaseUrl('chef'));
  return { url: session.url, sessionId: session.id };
}));
router.post('/:id/changes/:changeId/sync', handler((req, id) => syncKitchenChange(stripeClient(), id, req.params.changeId, req.neonUser!)));
export default router;
