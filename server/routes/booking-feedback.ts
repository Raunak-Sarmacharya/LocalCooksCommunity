import { Router } from 'express';
import { db } from '../db';
import { requireFirebaseAuthWithUser, requireAdmin } from '../firebase-auth-middleware';
import { getAdminBookingFeedback, getBookingFeedback, submitBookingFeedback } from '../services/booking-feedback-service';
import { DomainError } from '../shared/errors/domain-error';
import { ensureServerI18n, tLocale } from '../i18n';
import { logger } from '../logger';
const router = Router();
const idOf = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
for (const role of ['chef', 'manager', 'admin'] as const) {
  const path = role === 'chef' ? '/bookings/:id/feedback' : `/${role}/bookings/:id/feedback`;
  const handle = async (req: import('express').Request, res: import('express').Response) => {
    await ensureServerI18n();
    const viewer = { id: req.neonUser!.id, role, locale: req.neonUser!.preferredLocale };
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ error: tLocale(viewer.locale, 'privateFeedback.notFound', { ns: 'booking' }) });
    try {
      return res.json(req.method === 'POST' ? await db.transaction(tx => submitBookingFeedback(tx, id, viewer, req.body))
        : role === 'admin' ? await getAdminBookingFeedback(db, id, viewer) : await getBookingFeedback(db, id, viewer));
    } catch (error) {
      if (error instanceof DomainError) return res.status(error.statusCode).json({ code: error.code, error: error.message });
      logger.error('Booking feedback request could not be completed', { bookingId: id, error });
      return res.status(503).json({ error: tLocale(viewer.locale, 'privateFeedback.loadError', { ns: 'booking' }) });
    }
  };
  const guards = role === 'admin' ? [requireFirebaseAuthWithUser, requireAdmin] : [requireFirebaseAuthWithUser];
  router.get(path, ...guards, handle);
  if (role !== 'admin') router.post(path, ...guards, handle);
}
export default router;
