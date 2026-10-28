import { Router, type Response } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../firebase-auth-middleware';
import { TestClockError, jumpTour, readTourClock, testClockEnabled } from '../services/qa-test-clock';
import { jumpBooking, readBookingClock } from '../services/qa-test-clock-booking';
import { logger } from '../logger';

/** QA test clock (dev only). Answers 404 everywhere it is off, so production has no such surface. */
const router = Router();
router.use('/admin/test-clock', (_req, res, next) => testClockEnabled() ? next() : res.status(404).json({ error: 'Not found' }),
  requireFirebaseAuthWithUser, requireAdmin);
const idOf = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function failure(res: Response, error: unknown) {
  if (error instanceof TestClockError) return res.status(error.status).json({ error: error.message });
  logger.error('[TestClock] Request failed', error);
  return res.status(503).json({ error: 'The test clock could not finish. Refresh to see what moved.' });
}
router.get('/admin/test-clock/status', (_req, res) => res.json({ enabled: true }));
// QA: run the background worker now instead of waiting for its schedule (retries, sweeps, queued notices). Its own lock stops overlap.
router.post('/admin/test-clock/worker', async (req, res) => {
  try {
    const { runRecurringWorker } = await import('../services/recurring-worker');
    const { processExpiredCancellationRequests } = await import('../services/scheduled-cancellations');
    const result = await runRecurringWorker(processExpiredCancellationRequests) as Record<string, unknown>;
    logger.info('[TestClock] Worker run by admin', { actorId: req.neonUser!.id });
    if (result.skipped) return res.json({ ran: false, reason: 'busy' });
    if (result.disabled) return res.json({ ran: false, reason: 'disabled' });
    const failures = (result.taskFailures as unknown[] | undefined)?.length ?? 0;
    return res.json({ ran: true, deferred: !!result.deferred, failures });
  } catch (error) { return failure(res, error); }
});
const kinds = { tour: { read: readTourClock, jump: jumpTour, label: 'tour' }, booking: { read: readBookingClock, jump: jumpBooking, label: 'booking' } } as const;
router.get('/admin/test-clock/:kind/:id', async (req, res) => {
  const kind = Object.prototype.hasOwnProperty.call(kinds, req.params.kind) ? kinds[req.params.kind as keyof typeof kinds] : null, id = idOf(req.params.id);
  if (!kind || !id) return res.status(400).json({ error: 'Choose a valid tour or booking.' });
  try { return res.json(await kind.read(id)); } catch (error) { return failure(res, error); }
});
router.post('/admin/test-clock/:kind/:id/jump', async (req, res) => {
  const kind = Object.prototype.hasOwnProperty.call(kinds, req.params.kind) ? kinds[req.params.kind as keyof typeof kinds] : null, id = idOf(req.params.id);
  const { to, expectedUpdatedAt } = req.body ?? {};
  if (!kind || !id || typeof to !== 'string' || typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(to)))
    return res.status(400).json({ error: `Choose a ${kind?.label ?? 'record'} and a time to jump to.` });
  try { return res.json(await kind.jump(id, new Date(to), req.neonUser!.id, expectedUpdatedAt)); } catch (error) { return failure(res, error); }
});
export default router;
