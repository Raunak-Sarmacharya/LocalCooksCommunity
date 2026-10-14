import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireFirebaseAuthWithUser, requireManager, requireAdmin } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { DamageClaimError, fileDamageClaim, disputeDamageClaim, readBookingClaims, readChefClaims, readClaimBookingHold, readClaimFilingContext, replyToClaimReview, readManagerClaims } from '../services/damage-claims-v2';
import { prepareClaimPayment, syncClaimPayment, cancelClaimPayment, retrySavedClaimMoney } from '../services/damage-claim-money';
import { executeDamageClaimSupportAction } from '../services/booking-support';

const router = Router();
const idOf = (value: unknown) => z.coerce.number().int().positive().parse(value);
const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { res.json(await fn(req)); } catch (error) {
    res.status(error instanceof DamageClaimError ? error.status : error instanceof z.ZodError ? 400 : 503)
      .json({ error: error instanceof DamageClaimError ? error.message : error instanceof z.ZodError ? 'Check the claim details.' : 'This claim needs review. Please refresh before trying again.' });
  }
};
/** Only creation endpoints. Existing bookings, extensions, arrival, departure and support stay usable. Fail closed on unreadable hold state. */
export async function requireNoDamageClaimBookingHold(req: Request, res: Response, next: NextFunction) {
  if (!req.neonUser) return res.status(401).json({ error: 'Sign in first.' });
  if (req.neonUser.role === 'admin') return next();
  try {
    const hold = await readClaimBookingHold(req.neonUser.id);
    if (hold.held) return res.status(403).json({ code: 'DAMAGE_CLAIM_BOOKING_HOLD',
      error: 'You have an unpaid charge. Pay it or contact Local Cooks to keep booking.', ...hold });
    next();
  } catch { return res.status(503).json({ error: 'We cannot check your booking eligibility right now. Please try again.' }); }
}
router.post(['/chef/bookings', '/chef/bookings/checkout', '/payments/create-intent', '/bookings/checkout'],
  requireFirebaseAuthWithUser, requireChef, requireNoDamageClaimBookingHold, (_req, _res, next) => next());
router.get('/chef/damage-claims/booking-hold', requireFirebaseAuthWithUser, requireChef, handle(req => readClaimBookingHold(req.neonUser!.id)));
router.get('/chef/damage-claims/v2', requireFirebaseAuthWithUser, requireChef, handle(req => readChefClaims(req.neonUser!.id)));
router.get('/chef/damage-claims', requireFirebaseAuthWithUser, requireChef, handle(req => readChefClaims(req.neonUser!.id)));
router.get('/chef/damage-claims/:id', requireFirebaseAuthWithUser, requireChef, handle(async req => {
  const result = await readChefClaims(req.neonUser!.id), claim = result.claims.find(claim => claim.id === idOf(req.params.id));
  if (!claim) throw new DamageClaimError('Claim not found.', 404);
  return { claim };
}));
router.get('/chef/damage-claims/:id/invoice', requireFirebaseAuthWithUser, requireChef, async (req, res, next) => {
  try { const result = await readChefClaims(req.neonUser!.id);
    if (!result.claims.some(claim => claim.id === idOf(req.params.id))) return res.status(404).json({ error: 'Claim not found.' });
    next();
  } catch { return res.status(503).json({ error: 'Claim invoice unavailable.' }); }
});
router.get('/manager/damage-claims', requireFirebaseAuthWithUser, requireManager, handle(req => readManagerClaims(req.neonUser!.id)));
router.get('/bookings/:id/damage-claims', requireFirebaseAuthWithUser, handle(req => readBookingClaims(idOf(req.params.id), req.neonUser!)));
router.get('/manager/damage-claims/filing-context/:bookingId', requireFirebaseAuthWithUser, requireManager,
  handle(req => readClaimFilingContext(idOf(req.params.bookingId), req.neonUser!.id, req.query.visitId ? idOf(req.query.visitId) : undefined)));
router.post('/manager/damage-claims/file', requireFirebaseAuthWithUser, requireManager, handle(req => fileDamageClaim(req.neonUser!.id, req.body)));
router.post('/manager/damage-claims/:id/review-reply', requireFirebaseAuthWithUser, requireManager,
  handle(req => replyToClaimReview(idOf(req.params.id), req.neonUser!.id, req.body)));
router.post('/manager/damage-claims/support', requireFirebaseAuthWithUser, requireManager, handle(async req => {
  const input = z.object({ bookingId: z.number().int().positive(), description: z.string().min(10).max(2000), requestKey: z.string().uuid() }).strict().parse(req.body);
  return (await import('../services/commitment-problems')).reportProblem('booking', input.bookingId,
    { id: req.neonUser!.id, role: 'manager' }, input.description, input.requestKey, 'other');
}));
router.post('/chef/damage-claims/:id/pay', requireFirebaseAuthWithUser, requireChef, handle(req => {
  const input = z.object({ newCard: z.boolean().default(false) }).strict().parse(req.body || {});
  return prepareClaimPayment(idOf(req.params.id), req.neonUser!.id, input.newCard);
}));
router.post('/chef/damage-claims/:id/sync', requireFirebaseAuthWithUser, requireChef, handle(req => syncClaimPayment(idOf(req.params.id), req.neonUser!.id)));
router.post('/chef/damage-claims/:id/cancel-payment', requireFirebaseAuthWithUser, requireChef, handle(async req => {
  await cancelClaimPayment(idOf(req.params.id), req.neonUser!.id); return { success: true };
}));
router.post('/chef/damage-claims/:id/dispute', requireFirebaseAuthWithUser, requireChef,
  handle(req => disputeDamageClaim(idOf(req.params.id), req.neonUser!.id, req.body)));
router.get('/admin/booking-support/:bookingId/claims', requireFirebaseAuthWithUser, requireAdmin,
  handle(req => readBookingClaims(idOf(req.params.bookingId), req.neonUser!)));
router.post('/admin/booking-support/:bookingId/claims/actions', requireFirebaseAuthWithUser, requireAdmin,
  handle(req => executeDamageClaimSupportAction(idOf(req.params.bookingId), req.neonUser!.id, req.body)));
router.post('/admin/booking-support/:bookingId/claims/:id/retry', requireFirebaseAuthWithUser, requireAdmin,
  handle(req => retrySavedClaimMoney(idOf(req.params.bookingId), idOf(req.params.id), req.neonUser!.id)));
export default router;
