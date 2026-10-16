import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { ensureServerI18n, tLocale } from '../i18n';
import { logger } from '../logger';
import { createRentalCheckout, decideRental, listRentals, quoteRental, readRental, StorageRentalError, withdrawRental } from '../services/storage-rentals';

const router = Router();
const id = z.coerce.number().int().positive().safe();
const details = z.object({ listingId: z.number().int().positive().safe(), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(30) });
const checkout = details.extend({ requestKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/), expectedTotalCents: z.number().int().nonnegative().safe(),
  acceptedTermsVersion: z.string().max(50), cancellationPolicyVersion: z.number().int().positive(), disclosureVersion: z.string().max(50), quotedAt: z.string().datetime() });
const approve = z.object({ unitIndex: z.number().int().min(1).max(200).optional() });
const decline = z.object({ reason: z.string().trim().min(1).max(500) });

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
export default router;
