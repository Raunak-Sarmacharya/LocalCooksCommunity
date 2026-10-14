import { Router } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../firebase-auth-middleware';
import { BookingSupportError, executeBookingSupportAction, readBookingSupport, searchBookingSupport } from '../services/booking-support';
import { logger } from '../logger';
const router = Router();
router.use('/admin/booking-support', requireFirebaseAuthWithUser, requireAdmin);
const idOf = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function failure(res: import('express').Response, error: unknown) {
  if (error instanceof BookingSupportError) return res.status(error.status).json({ error: error.message });
  logger.error('Booking support request could not be completed', error);
  return res.status(503).json({ error: 'Booking support is temporarily unavailable. Please refresh before trying again.' });
}
router.get('/admin/booking-support/search', async (req, res) => {
  if (typeof req.query.q !== 'string') return res.status(400).json({ error: 'Enter a booking reference, name or email.' });
  try { return res.json(await searchBookingSupport(req.query.q)); } catch (error) { return failure(res, error); }
});
router.get('/admin/booking-support/:bookingId', async (req, res) => {
  const id = idOf(req.params.bookingId);
  if (!id) return res.status(400).json({ error: 'Choose a valid booking.' });
  try { return res.json(await readBookingSupport(id)); } catch (error) { return failure(res, error); }
});
router.post('/admin/booking-support/:bookingId/actions', async (req, res) => {
  const id = idOf(req.params.bookingId);
  if (!id) return res.status(400).json({ error: 'Choose a valid booking.' });
  try { return res.json(await executeBookingSupportAction(id, req.neonUser!.id, req.body)); } catch (error) { return failure(res, error); }
});
export default router;
