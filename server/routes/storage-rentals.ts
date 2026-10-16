import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { ensureServerI18n, tLocale } from '../i18n';
import { logger } from '../logger';
import { openRemovalReview, raiseHoldoverCharge, recordRemoval, sendFinalNotice, waiveHoldover } from '../services/storage-rental-lifecycle';
import { createRentalCheckout, decideRental, listRentals, quoteRental, readRental, StorageRentalError, withdrawRental } from '../services/storage-rentals';

const router = Router();
const id = z.coerce.number().int().positive().safe();
const details = z.object({ listingId: z.number().int().positive().safe(), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(30) });
const checkout = details.extend({ requestKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/), expectedTotalCents: z.number().int().nonnegative().safe(),
  acceptedTermsVersion: z.string().max(50), cancellationPolicyVersion: z.number().int().positive(), disclosureVersion: z.string().max(50), quotedAt: z.string().datetime() });
const approve = z.object({ unitIndex: z.number().int().min(1).max(200).optional() });
const decline = z.object({ reason: z.string().trim().min(1).max(500) });
const holdoverCharge = z.object({ amountCents: z.number().int().positive().safe(), note: z.string().trim().max(500).optional() });
const holdoverWaive = z.object({ reason: z.string().trim().min(1).max(500) });
const removal = z.object({ itemIndexes: z.array(z.number().int().min(0).max(99)).max(100).optional(), all: z.boolean().optional(), note: z.string().trim().max(500).optional() });
const finalNotice = z.object({ photos: z.array(z.string().url().max(2000)).min(1).max(20),
  items: z.array(z.object({ name: z.string().trim().min(1).max(200), qty: z.number().int().min(1).max(9999), perishable: z.boolean() })).min(1).max(100) });

function endpoint(run: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { res.json(await run(req)); }
    catch (error) {
      const code = error instanceof z.ZodError ? 'invalid_details' : error instanceof StorageRentalError ? error.code : 'unavailable';
      const status = error instanceof z.ZodError ? 400 : error instanceof StorageRentalError ? error.status : 500;
      // Provider exceptions may contain request details; keep them out of API responses and logs.
      if (status === 500) logger.error('[StorageRental] Operation failed', { path: req.path });
      await ensureServerI18n();
      res.status(status).json({ code, error: tLocale(req.neonUser?.preferredLocale, `stError_${code}`, { ns: 'storage' }) });
    }
  };
}

router.use('/chef/storage-rentals', requireFirebaseAuthWithUser, requireChef);
router.post('/chef/storage-rentals/quote', endpoint(req => quoteRental(req.neonUser!.id, details.parse(req.body))));
router.post('/chef/storage-rentals', endpoint(req => createRentalCheckout(req.neonUser!.id, checkout.parse(req.body), undefined, undefined, req.neonUser!.preferredLocale ?? 'en-CA')));
router.get('/chef/storage-rentals', endpoint(req => listRentals({ id: req.neonUser!.id, role: 'chef' })));
router.get('/chef/storage-rentals/:id', endpoint(req => readRental(id.parse(req.params.id), { id: req.neonUser!.id, role: 'chef' })));
router.post('/chef/storage-rentals/:id/withdraw', endpoint(async req => {
  const rentalId = id.parse(req.params.id);
  await withdrawRental(rentalId, req.neonUser!.id);
  return readRental(rentalId, { id: req.neonUser!.id, role: 'chef' });
}));

router.use('/manager/storage-rentals', requireFirebaseAuthWithUser, requireManager);
router.get('/manager/storage-rentals', endpoint(req => listRentals({ id: req.neonUser!.id, role: 'manager' })));
router.get('/manager/storage-rentals/:id', endpoint(req => readRental(id.parse(req.params.id), { id: req.neonUser!.id, role: 'manager' })));
router.post('/manager/storage-rentals/:id/approve', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
  await decideRental(rentalId, 'reserved', actor, approve.parse(req.body ?? {}));
  return readRental(rentalId, actor);
}));
router.post('/manager/storage-rentals/:id/decline', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
  await decideRental(rentalId, 'declined', actor, decline.parse(req.body));
  return readRental(rentalId, actor);
}));
// Holdover is a request the chef pays on-session (or disputes); nothing here charges a card.
router.post('/manager/storage-rentals/:id/holdover-charge', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
  await raiseHoldoverCharge(rentalId, actor.id, holdoverCharge.parse(req.body));
  return readRental(rentalId, actor);
}));
router.post('/manager/storage-rentals/:id/holdover-waive', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
  await waiveHoldover(rentalId, actor.id, holdoverWaive.parse(req.body));
  return readRental(rentalId, actor);
}));
router.post('/manager/storage-rentals/:id/removal/record', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
  await recordRemoval(rentalId, actor, removal.parse(req.body ?? {}));
  return readRental(rentalId, actor);
}));

router.use('/admin/storage-rentals', requireFirebaseAuthWithUser, requireAdmin);
router.post('/admin/storage-rentals/:id/open-removal-review', endpoint(req => openRemovalReview(id.parse(req.params.id))));
router.post('/admin/storage-rentals/:id/final-notice', endpoint(req => sendFinalNotice(id.parse(req.params.id), req.neonUser!.id, finalNotice.parse(req.body))));
router.post('/admin/storage-rentals/:id/removal/record', endpoint(req => recordRemoval(id.parse(req.params.id), { id: req.neonUser!.id, role: 'admin' }, removal.parse(req.body ?? {}))));
export default router;
