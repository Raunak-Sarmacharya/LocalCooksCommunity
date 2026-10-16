import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { errorResponse } from '../api-response';
import { DomainError } from '../shared/errors/domain-error';
import { customerFilters, customerSorts, type CustomerFilter, type CustomerSort } from '@shared/customer-next-action';
import { getCustomerPage } from '../services/manager-customer-page';
import {
  createCustomerNote, deleteCustomerNote, listCustomerNotes, listManagerCustomers, updateCustomerNote,
} from '../services/manager-customers';

/**
 * Manager "Customers". Every read is scoped by `locations.manager_id = the signed-in manager` inside the query, and a
 * location (or person) that is not theirs is a 404, never a 403, so nothing reveals that it exists.
 */
const router = Router();
router.use(requireFirebaseAuthWithUser, requireManager);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const positive = (value: unknown) => {
  const parsed = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
const invalid = (message: string) => new DomainError('INVALID_REQUEST', message, 400);

router.get('/', async (req: Request, res: Response) => {
  try {
    const locationId = req.query.locationId === undefined || req.query.locationId === '' || req.query.locationId === 'all' ? undefined : positive(req.query.locationId);
    if (locationId === null) throw invalid('Invalid location');
    const status = (typeof req.query.status === 'string' && req.query.status ? req.query.status : 'all') as CustomerFilter;
    if (!customerFilters.includes(status)) throw invalid('Invalid status filter');
    const sort = (typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : 'needs_action') as CustomerSort;
    if (!customerSorts.includes(sort)) throw invalid('Invalid sort');
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
    res.json(await listManagerCustomers(req.neonUser!.id, { locationId: locationId ?? undefined, status, q, sort, cursor }));
  } catch (error) { return errorResponse(res, error); }
});

router.get('/:chefId', async (req: Request, res: Response) => {
  try {
    const chefId = positive(req.params.chefId);
    if (!chefId) throw new DomainError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    const locationId = req.query.locationId === undefined || req.query.locationId === '' ? undefined : positive(req.query.locationId);
    if (locationId === null) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404);
    res.json(await getCustomerPage(req.neonUser!.id, chefId, locationId, { allPast: req.query.past === 'all' }));
  } catch (error) { return errorResponse(res, error); }
});

function noteScope(req: Request) {
  const chefId = positive(req.params.chefId);
  const locationId = positive(req.query.locationId ?? req.body?.locationId);
  if (!chefId) throw new DomainError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  if (!locationId) throw invalid('Choose a location');
  return { chefId, locationId, managerId: req.neonUser!.id };
}

router.get('/:chefId/notes', async (req: Request, res: Response) => {
  try {
    const { managerId, chefId, locationId } = noteScope(req);
    res.json({ notes: await listCustomerNotes(managerId, chefId, locationId) });
  } catch (error) { return errorResponse(res, error); }
});

router.post('/:chefId/notes', async (req: Request, res: Response) => {
  try {
    const { managerId, chefId, locationId } = noteScope(req);
    const created = await createCustomerNote(managerId, chefId, locationId, req.body?.body);
    res.status(201).json({ id: created.id, notes: await listCustomerNotes(managerId, chefId, locationId) });
  } catch (error) { return errorResponse(res, error); }
});

router.patch('/:chefId/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { managerId, chefId, locationId } = noteScope(req);
    const noteId = positive(req.params.noteId);
    if (!noteId) throw new DomainError('NOTE_NOT_FOUND', 'Note not found', 404);
    await updateCustomerNote(managerId, chefId, locationId, noteId, req.body?.body);
    res.json({ notes: await listCustomerNotes(managerId, chefId, locationId) });
  } catch (error) { return errorResponse(res, error); }
});

router.delete('/:chefId/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { managerId, chefId, locationId } = noteScope(req);
    const noteId = positive(req.params.noteId);
    if (!noteId) throw new DomainError('NOTE_NOT_FOUND', 'Note not found', 404);
    await deleteCustomerNote(managerId, chefId, locationId, noteId);
    res.json({ notes: await listCustomerNotes(managerId, chefId, locationId) });
  } catch (error) { return errorResponse(res, error); }
});

export default router;
