import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { ensureServerI18n, tLocale } from '../i18n';
import { logger } from '../logger';
import { raiseHoldoverCharge, recordRemoval, waiveHoldover } from '../services/storage-rental-lifecycle';
import { createRentalCheckout, decideRental, listRentals, quoteRental, readRental, StorageRentalError, withdrawRental } from '../services/storage-rentals';
import { payExtension, quoteExtension, syncStorageTerm } from '../services/storage-extensions';

import { storageRentalVisitAction } from '../services/storage-checkout-service';
import { previewStorageTool, runStorageTool, setStorageUnitService, storageToolInput } from '../services/storage-rental-actions';
import { cancelStorageRental, previewStorageCancellation, StorageRefundError } from '../services/storage-rental-money';
import { attemptOutcomeDeliveryAfterResponse } from '../services/outcome-delivery';
import { BookingMoneyFrozen } from '../services/booking-money-guard';
import { isAllowedR2Url } from '../utils/upload-url';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, kitchens, locations, storageBookings, storageListings } from '@shared/schema';

const router = Router();
const id = z.coerce.number().int().positive().safe();
const details = z.object({ listingId: z.number().int().positive().safe(), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(30) });
const checkout = details.extend({ requestKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/), expectedTotalCents: z.number().int().nonnegative().safe(),
  acceptedTermsVersion: z.string().max(50), cancellationPolicyVersion: z.number().int().positive(), disclosureVersion: z.string().max(50), quotedAt: z.string().datetime() });
const visitDetails = z.object({ photoUrls: z.array(z.string().url().max(2000)).max(20).default([]), note: z.string().trim().max(2000).optional(),
  checklistItems: z.array(z.object({ id: z.string(), label: z.string(), checked: z.boolean() })).max(100).optional() });
const approve = z.object({ unitIndex: z.number().int().min(1).max(200).optional() });
const decline = z.object({ reason: z.string().trim().min(1).max(500) });
const holdoverCharge = z.object({ amountCents: z.number().int().positive().safe(), note: z.string().trim().max(500).optional() });
const holdoverWaive = z.object({ reason: z.string().trim().min(1).max(500) });
const removal = z.object({ itemIndexes: z.array(z.number().int().min(0).max(99)).max(100).optional(), all: z.boolean().optional(), note: z.string().trim().max(500).optional() });
const cancel = z.object({ operationKey: z.string().min(8).max(100).regex(/^[\w:-]+$/), reason: z.string().trim().max(500).optional(),
  expectedRefundCents: z.number().int().nonnegative().safe().optional() });
const extensionQuote = z.object({ days: z.number().int().min(1).max(30) });
const extensionPayment = extensionQuote.extend({ expectedTotalCents: z.number().int().nonnegative().safe(),
  requestKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/), useSavedCard: z.boolean() });

export function endpoint(run: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await run(req));
      // Storage actions queue notices (customer, kitchen, admins); send them now rather than on the worker's slow tick.
      if (req.method !== 'GET') attemptOutcomeDeliveryAfterResponse();
    }
    catch (error) {
      const known = error instanceof StorageRentalError || error instanceof StorageRefundError;
      const code = error instanceof z.ZodError ? 'invalid_details' : known ? error.code : error instanceof BookingMoneyFrozen ? 'payment_review' : 'unavailable';
      const status = error instanceof z.ZodError ? 400 : known ? error.status : error instanceof BookingMoneyFrozen ? 409 : 500;
      // Provider exceptions may contain request details; keep them out of API responses and logs.
      if (status === 500) logger.error('[StorageRental] Operation failed', { path: req.path });
      await ensureServerI18n();
      res.status(status).json({ code, error: tLocale(req.neonUser?.preferredLocale, `stError_${code}`, { ns: 'storage' }) });
    }
  };
}

router.use('/chef/storage-rentals', requireFirebaseAuthWithUser, requireChef);
// Both sides reuse the approved chef-location application conversation, including after move-out.
router.post('/storage-rentals/:id/conversation', requireFirebaseAuthWithUser, endpoint(async req => {
  const rentalId = id.parse(req.params.id);
  const [row] = await db.select({ rental: storageBookings, locationId: kitchens.locationId, managerId: locations.managerId })
    .from(storageBookings).innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(storageBookings.id, rentalId)).limit(1);
  if (!row || !row.rental.rentalTerms || (req.neonUser!.id !== row.rental.chefId && req.neonUser!.id !== row.managerId))
    throw new StorageRentalError('not_found', 404);
  if (!row.rental.chefId || !['requested', 'reserved', 'active', 'move_out_requested', 'removal_review', 'ended'].includes(row.rental.rentalState))
    throw new StorageRentalError('unavailable');
  const [application] = await db.select().from(chefKitchenApplications).where(and(
    eq(chefKitchenApplications.chefId, row.rental.chefId), eq(chefKitchenApplications.locationId, row.locationId),
    eq(chefKitchenApplications.status, 'approved'))).orderBy(desc(chefKitchenApplications.id)).limit(1);
  if (!application) throw new StorageRentalError('unavailable');
  const { initializeConversation } = await import('../chat-service');
  const conversationId = await initializeConversation(application);
  if (!conversationId) throw new StorageRentalError('unavailable');
  const manager = req.neonUser!.id === row.managerId;
  return { conversationId, rentalId, applicationId: application.id,
    path: `${manager ? '/manager' : ''}/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}` };
}));
router.post('/chef/storage-rentals/quote', endpoint(req => quoteRental(req.neonUser!.id, details.parse(req.body))));
router.post('/chef/storage-rentals', endpoint(req => createRentalCheckout(req.neonUser!.id, checkout.parse(req.body), undefined, undefined, req.neonUser!.preferredLocale ?? 'en-CA')));
router.get('/chef/storage-rentals', endpoint(req => listRentals({ id: req.neonUser!.id, role: 'chef' })));
router.get('/chef/storage-rentals/:id', endpoint(req => readRental(id.parse(req.params.id), { id: req.neonUser!.id, role: 'chef' })));
router.post('/chef/storage-rentals/:id/extend/quote', endpoint(req => quoteExtension(id.parse(req.params.id), req.neonUser!.id, extensionQuote.parse(req.body).days)));
router.post('/chef/storage-rentals/:id/extend', endpoint(req => payExtension(id.parse(req.params.id), req.neonUser!.id,
  extensionPayment.parse(req.body), undefined, undefined, req.neonUser!.preferredLocale ?? 'en-CA')));
router.post('/chef/storage-rentals/:id/extend/:termId/sync', endpoint(req => syncStorageTerm(id.parse(req.params.id), id.parse(req.params.termId), req.neonUser!.id)));
router.post('/chef/storage-rentals/:id/withdraw', endpoint(async req => {
  const rentalId = id.parse(req.params.id);
  await withdrawRental(rentalId, req.neonUser!.id);
  return readRental(rentalId, { id: req.neonUser!.id, role: 'chef' });
}));

// Approved, not started: the kitchen's booking cancellation policy (policy §5b). After the start it's a move-out instead.
router.get('/chef/storage-rentals/:id/cancel/preview', endpoint(req => previewStorageCancellation(id.parse(req.params.id), req.neonUser!.id)));
router.post('/chef/storage-rentals/:id/cancel', endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'chef' as const };
  const result = await cancelStorageRental(rentalId, actor.id, cancel.parse(req.body ?? {}));
  return { ...(await readRental(rentalId, actor)), refundPending: result.refunds.some(refund => refund.status !== 'succeeded') };
}));

for (const action of ['move-in', 'move-out'] as const) router.post(`/chef/storage-rentals/:id/${action}`, endpoint(async req => {
  const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'chef' as const };
  await storageRentalVisitAction(rentalId, actor, action, visitDetails.parse(req.body ?? {}));
  return readRental(rentalId, actor);
}));

router.use('/manager/storage-rentals', requireFirebaseAuthWithUser, requireManager);
router.post('/manager/storage-listings/:listingId/units/:unitIndex/service', requireFirebaseAuthWithUser, requireManager, endpoint(req => {
  const input = z.object({ outOfService: z.boolean(), reason: z.string().trim().min(1).max(2000) }).parse(req.body);
  return setStorageUnitService(id.parse(req.params.listingId), req.neonUser!.id, id.parse(req.params.unitIndex), input.outOfService, input.reason);
}));
for (const action of ['move-out-by', 'refund', 'offer-extension'] as const) router.get(`/manager/storage-rentals/:id/${action}/preview`, endpoint(req =>
  previewStorageTool(id.parse(req.params.id), { id: req.neonUser!.id, role: 'manager' }, action, storageToolInput.parse({
    byDate: req.query.date, days: req.query.days == null ? undefined : Number(req.query.days), amountCents: req.query.amountCents == null ? undefined : Number(req.query.amountCents) }))));
for (const action of ['change-unit', 'move-out-by', 'offer-extension', 'release', 'refund'] as const) router.post(`/manager/storage-rentals/:id/${action}`, endpoint(req =>
  runStorageTool(id.parse(req.params.id), { id: req.neonUser!.id, role: 'manager' }, action, storageToolInput.parse(req.body))));
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
for (const action of ['handover', 'clear-move-out', 'items-still-here', 'mark-ready'] as const) {
  router.post(`/manager/storage-rentals/:id/${action}`, endpoint(async req => {
    const rentalId = id.parse(req.params.id), actor = { id: req.neonUser!.id, role: 'manager' as const };
    // The kitchen tools send an operationKey with every action; these visit steps are idempotent by state, so it is not needed here.
    const { operationKey: _operationKey, ...body } = req.body ?? {};
    const input = action === 'clear-move-out' ? z.object({ needsCleaning: z.boolean() }).strict().parse(body)
      : action === 'mark-ready' ? {} : visitDetails.extend({ photoUrls: z.array(z.string().url().max(2000).refine(isAllowedR2Url)).min(1).max(20) }).parse(body);
    await storageRentalVisitAction(rentalId, actor, action, input);
    return readRental(rentalId, actor);
  }));
}

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
for (const [path, type] of [['open-removal-review', 'open_removal_review'], ['final-notice', 'send_final_notice'], ['removal/record', 'record_removal_for_kitchen']] as const)
  router.post(`/admin/storage-rentals/:id/${path}`, endpoint(async req => {
    const { adminStorageInput, runAdminStorageAction } = await import('../services/admin-storage');
    return runAdminStorageAction(id.parse(req.params.id), req.neonUser!.id, adminStorageInput.parse({ ...req.body, type, fundedBy: 'none' }));
  }));
export default router;
