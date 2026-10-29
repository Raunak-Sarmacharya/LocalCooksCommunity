import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { requireChef } from './middleware';
import { listSavedCards, removeSavedCard, SavedCardError } from '../services/chef-saved-cards';
import { logger } from '../logger';

const router = Router();
const cardId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { res.json(await fn(req)); } catch (error) {
    if (error instanceof SavedCardError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Choose a saved card from your list.' });
    logger.error('[Saved cards] Request failed', { path: req.path, error });
    res.status(503).json({ error: 'Saved cards are unavailable right now. Nothing was changed. Please try again.' });
  }
};
router.get('/chef/saved-cards', requireFirebaseAuthWithUser, requireChef, handle(req => listSavedCards(req.neonUser!.id)));
router.post('/chef/saved-cards/:id/remove', requireFirebaseAuthWithUser, requireChef,
  handle(req => removeSavedCard(req.neonUser!.id, cardId.parse(req.params.id))));
export default router;
