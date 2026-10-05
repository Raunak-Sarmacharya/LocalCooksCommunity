import { Router } from 'express';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { errorResponse } from '../api-response';
import { canReportProblem, listProblems, problemContext, reportProblem, updateProblem } from '../services/commitment-problems';
import { db } from '../db';
import { attemptOutcomeDelivery } from '../services/outcome-delivery';

const router = Router();
router.use(requireFirebaseAuthWithUser);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
router.get('/', async (req, res) => {
  try { res.json({ problems: await listProblems(req.neonUser!), reportingAvailable: false, actorId: req.neonUser!.id }); }
  catch (error) { return errorResponse(res, error); }
});
router.get('/:kind/:id', async (req, res) => {
  if (!['booking', 'tour'].includes(req.params.kind) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0)
    return res.status(400).json({ error: 'Choose a valid booking or tour' });
  try {
    const kind = req.params.kind as 'booking' | 'tour', id = Number(req.params.id);
    const problems = await listProblems(req.neonUser!, kind, id);
    const context = await db.transaction(tx => problemContext(tx, kind, id));
    const reportingOpensAt = context?.wasConfirmed && context.scheduledStart && context.scheduledStart.getTime() > Date.now()
      ? context.scheduledStart.toISOString() : null;
    res.json({ problems, reportingAvailable: canReportProblem(context, req.neonUser!), reportingOpensAt, actorId: req.neonUser!.id });
  }
  catch (error) { return errorResponse(res, error); }
});
router.post('/:kind/:id', async (req, res) => {
  if (!['booking', 'tour'].includes(req.params.kind)) return res.status(400).json({ error: 'Choose booking or tour' });
  try {
    const result = await reportProblem(req.params.kind as 'booking' | 'tour', Number(req.params.id), req.neonUser!, req.body.description, req.body.requestKey);
    await attemptOutcomeDelivery();
    res.json(result);
  } catch (error) { return errorResponse(res, error); }
});
router.patch('/:id', async (req, res) => {
  if (!Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) return res.status(400).json({ error: 'Choose a valid problem' });
  try {
    const result = await updateProblem(Number(req.params.id), req.neonUser!, req.body);
    await attemptOutcomeDelivery();
    res.json(result);
  } catch (error) { return errorResponse(res, error); }
});
export default router;
