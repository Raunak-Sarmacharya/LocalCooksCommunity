import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { endpoint } from './storage-rentals';
import { adminStorageDetail, adminStorageInput, adminStorageList, previewAdminStorageAction, runAdminStorageAction } from '../services/admin-storage';
const router = Router();
const id = z.coerce.number().int().positive().safe();
router.use('/admin/storage-rentals', requireFirebaseAuthWithUser, requireAdmin);
router.get('/admin/storage-rentals', endpoint(req => {
  const filters = z.object({ state: z.string().max(50).optional(), kitchenId: id.optional(), q: z.string().max(200).optional(), needsAttention: z.enum(['1', '0']).optional() }).parse(req.query);
  return adminStorageList({ ...filters, needsAttention: filters.needsAttention === '1' }, req.neonUser!.id);
}));
router.get('/admin/storage-rentals/:id', endpoint(req => adminStorageDetail(id.parse(req.params.id), req.neonUser!.id)));
router.post('/admin/storage-rentals/:id/actions', endpoint(req => runAdminStorageAction(id.parse(req.params.id), req.neonUser!.id, adminStorageInput.parse(req.body))));
router.post('/admin/storage-rentals/:id/actions/preview', endpoint(req => previewAdminStorageAction(id.parse(req.params.id), req.neonUser!.id, adminStorageInput.parse(req.body))));
export default router;
