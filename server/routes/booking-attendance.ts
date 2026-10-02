import { Router } from 'express';
import { z } from 'zod';
import { requireFirebaseAuthWithUser, requireManager, requireAdmin } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { AttendanceError, readBookingAttendance, recordBookingAttendance, type AttendanceActor } from '../services/booking-attendance-service';
import { logger } from '../logger';
import { db } from '../db';
import { bookingLifecycleEvents, kitchenBookings, kitchens, locations } from '@shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

const router = Router();
router.get('/admin/bookings/:id/support', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid booking ID' });
  try {
    const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const history = await db.select({ id: bookingLifecycleEvents.id, title: bookingLifecycleEvents.title,
      message: bookingLifecycleEvents.message, createdAt: bookingLifecycleEvents.createdAt,
      completedAt: bookingLifecycleEvents.completedAt }).from(bookingLifecycleEvents)
      .where(eq(bookingLifecycleEvents.bookingId, id)).orderBy(desc(bookingLifecycleEvents.id));
    let payment: Record<string, unknown> | null = null;
    if (booking.paymentIntentId) {
      const { getBookingPaymentIntent, getBookingCheckoutSession } = await import('../services/stripe-service');
      const { bookingCaptureTerms } = await import('@shared/booking-capture-terms');
      const intent = await getBookingPaymentIntent(booking.paymentIntentId);
      const session = await getBookingCheckoutSession(intent.id);
      let terms: ReturnType<typeof bookingCaptureTerms> | null = null;
      try {
        if (session?.status === 'complete' && session.currency === 'cad' && session.amount_total === intent.amount
          && session.metadata?.type === 'kitchen_booking' && session.metadata.chef_id === String(booking.chefId)
          && session.metadata.kitchen_id === String(booking.kitchenId)) terms = bookingCaptureTerms(session.metadata, intent.amount);
      } catch { /* Missing evidence remains a review requirement. */ }
      payment = { id: intent.id, status: intent.status, authorizedAmount: intent.amount, capturedAmount: intent.amount_received,
        terms, termsVerified: !!terms };
    }
    res.json({ bookingId: id, referenceCode: booking.referenceCode, status: booking.status, paymentStatus: booking.paymentStatus,
      decision: booking.paymentDecision, payment, history });
  } catch (error) { logger.error('Booking support evidence unavailable', error); res.status(503).json({ error: 'Booking support evidence is unavailable. Retry before making a decision.' }); }
});
router.post('/admin/bookings/:id/cancel-authorization', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid booking ID' });
  try {
    const { decideAuthorizedBooking } = await import('../services/booking-payment-decision');
    res.json(await decideAuthorizedBooking(id, 'cancelled', [], [], req.neonUser!.id));
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Authorization outcome needs review' }); }
});
router.get('/manager/booking-lifecycle', requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const events = await db.select({ id: bookingLifecycleEvents.id, bookingId: bookingLifecycleEvents.bookingId,
      title: bookingLifecycleEvents.title, kind: bookingLifecycleEvents.kind, createdAt: bookingLifecycleEvents.createdAt,
      kitchenId: kitchenBookings.kitchenId, locationId: locations.id, kitchenName: kitchens.name,
      bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime })
      .from(bookingLifecycleEvents).innerJoin(kitchenBookings, eq(kitchenBookings.id, bookingLifecycleEvents.bookingId))
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(locations.managerId, req.neonUser!.id)).orderBy(desc(bookingLifecycleEvents.id)).limit(100);
    res.json(events);
  } catch (error) { logger.error('Booking activity unavailable', error); res.status(503).json({ error: 'Booking activity is unavailable' }); }
});
router.get('/admin/booking-payment-recovery', requireFirebaseAuthWithUser, requireAdmin, async (_req, res) => {
  try {
    res.json(await db.select({ id: kitchenBookings.id, referenceCode: kitchenBookings.referenceCode,
      status: kitchenBookings.status, paymentStatus: kitchenBookings.paymentStatus, paymentIntentId: kitchenBookings.paymentIntentId,
      decision: kitchenBookings.paymentDecision, updatedAt: kitchenBookings.updatedAt }).from(kitchenBookings)
      .where(sql`${kitchenBookings.paymentDecision}->>'state' = 'pending'`).orderBy(desc(kitchenBookings.updatedAt)).limit(100));
  } catch (error) { logger.error('Booking payment recovery unavailable', error); res.status(503).json({ error: 'Payment recovery is unavailable' }); }
});
router.post('/admin/bookings/:id/recover-payment', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid booking ID' });
  try {
    const { reconcileBookingDecision } = await import('../services/booking-payment-decision');
    res.json(await reconcileBookingDecision(id));
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Payment outcome needs reconciliation' }); }
});
const input = z.object({
  action: z.enum(['report_no_show', 'report_attended', 'withdraw_attendance']), visitId: z.number().int().positive().optional(),
  expectedUpdatedAt: z.string().datetime(), expectedBookingUpdatedAt: z.string().datetime(),
  sharedMessage: z.string().max(2000).optional(), internalNotes: z.string().max(2000).optional(),
  confirmsChefAbsent: z.boolean().optional(),
}).strict();

for (const role of ['chef', 'manager', 'admin'] as const) {
  const gate = role === 'chef' ? requireChef : role === 'manager' ? requireManager : requireAdmin;
  const path = `/${role}/bookings/:id/attendance`;
  router.get(path, requireFirebaseAuthWithUser, gate, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid booking ID' });
    const actor: AttendanceActor = { id: req.neonUser!.id, role };
    try { res.json(await readBookingAttendance(id, actor)); }
    catch (error) {
      if (error instanceof AttendanceError) return res.status(error.status).json({ error: error.message });
      logger.error('Cannot read booking attendance', error);
      res.status(503).json({ error: 'Attendance history is unavailable' });
    }
  });
  if (role === 'chef') continue;
  router.post(path, requireFirebaseAuthWithUser, gate, async (req, res) => {
    const id = Number(req.params.id), parsed = input.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: 'Invalid attendance request' });
    try { res.json(await recordBookingAttendance(id, { id: req.neonUser!.id, role }, parsed.data)); }
    catch (error) {
      if (error instanceof AttendanceError) return res.status(error.status).json({ error: error.message });
      logger.error('Cannot save booking attendance', error);
      res.status(503).json({ error: 'Attendance could not be saved; refresh before retrying' });
    }
  });
}
export default router;
