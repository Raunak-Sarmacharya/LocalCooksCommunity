import { Router, type Response } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../firebase-auth-middleware';
import { TestClockError, jumpTour, readTourClock, testClockEnabled } from '../services/qa-test-clock';
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
router.get('/admin/test-clock/tour/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Choose a valid tour.' });
  try { return res.json(await readTourClock(id)); } catch (error) { return failure(res, error); }
});
router.post('/admin/test-clock/tour/:id/jump', async (req, res) => {
  const id = idOf(req.params.id);
  const { to, expectedUpdatedAt } = req.body ?? {};
  if (!id || typeof to !== 'string' || typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(to)))
    return res.status(400).json({ error: 'Choose a tour and a time to jump to.' });
  try { return res.json(await jumpTour(id, new Date(to), req.neonUser!.id, expectedUpdatedAt)); } catch (error) { return failure(res, error); }
});
export default router;
