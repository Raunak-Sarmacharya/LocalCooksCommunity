/** Kitchen "Add customer" (owner, Oct 24): see services/kitchen-customer-invites. */
import { Router, type Request, type Response } from 'express';
import { requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { upload, uploadToBlob } from '../fileUpload';
import { DomainError } from '../shared/errors/domain-error';
import { logger } from '../logger';
import { acceptInvite, createInvite, inviteEmailMatch, listInvites, readInvite, resendInvite, withdrawInvite, type InviteDocuments, type RequirementsChoice } from '../services/kitchen-customer-invites';

const router = Router();
const fail = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof DomainError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  logger.error(`[Customer invites] ${fallback}`, error);
  return res.status(500).json({ error: fallback });
};

router.get('/manager/customer-invites', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try { res.json(await listInvites(req.neonUser!.id)); } catch (error) { fail(res, error, 'Could not load invitations'); }
});

router.get('/manager/customer-invites/check', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try { res.json(await inviteEmailMatch(req.neonUser!.id, Number(req.query.locationId), String(req.query.email || ''))); }
  catch (error) { fail(res, error, 'Could not check that email'); }
});

// Multipart: the fields, plus "doc_<key>" files with "doc_<key>__expiry" dates when the kitchen uploads documents now.
router.post('/manager/customer-invites', upload.any(), requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const documents: InviteDocuments = {};
    if (req.body.choice === 'uploaded') {
      for (const file of files.filter(item => item.fieldname.startsWith('doc_'))) {
        const key = file.fieldname.slice(4);
        const expiry = String(req.body[`doc_${key}__expiry`] || '') || null;
        documents[key] = { url: await uploadToBlob(file, req.neonUser!.id, 'documents'), expiry };
      }
    }
    const invite = await createInvite(req.neonUser!.id, { locationId: Number(req.body.locationId), email: req.body.email, fullName: req.body.fullName,
      phone: req.body.phone, businessName: req.body.businessName, choice: req.body.choice as RequirementsChoice, documents,
      confirmResponsibility: req.body.confirmResponsibility === 'true' || req.body.confirmResponsibility === true });
    res.status(201).json({ id: invite.id, email: invite.email, expiresAt: invite.expiresAt });
  } catch (error) { fail(res, error, 'Could not send the invitation'); }
});

router.post('/manager/customer-invites/:id/resend', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try { const invite = await resendInvite(req.neonUser!.id, Number(req.params.id)); res.json({ id: invite.id, sentAt: invite.sentAt, expiresAt: invite.expiresAt }); }
  catch (error) { fail(res, error, 'Could not resend the invitation'); }
});

router.post('/manager/customer-invites/:id/withdraw', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try { await withdrawInvite(req.neonUser!.id, Number(req.params.id)); res.json({ success: true }); }
  catch (error) { fail(res, error, 'Could not withdraw the invitation'); }
});

// The Join page, before sign-in: the 256-bit link token is the only key. It travels in the body so request logs never hold it.
router.post('/public/customer-invites/read', async (req: Request, res: Response) => {
  try {
    const invite = await readInvite(String(req.body?.token || ''));
    if (!invite) return res.status(404).json({ error: 'This invitation link isn’t valid. Ask the kitchen to send it again.' });
    res.json(invite);
  } catch (error) { fail(res, error, 'Could not open the invitation'); }
});

// Allowed before email verification (firebase-auth-middleware): accepting the emailed link verifies the email.
router.post('/firebase/chef/customer-invites/accept', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try { res.json(await acceptInvite(String(req.body?.token || ''), req.neonUser as any)); }
  catch (error) { fail(res, error, 'Could not accept the invitation'); }
});

export default router;
