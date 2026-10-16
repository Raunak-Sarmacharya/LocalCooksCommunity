/**
 * Booking money documents: the role's list (issuing anything owed first, idempotently) and the stored PDF.
 *   GET /api/bookings/:id/documents           chef (own booking)
 *   GET /api/manager/bookings/:id/documents   kitchen manager (own location)
 *   GET /api/admin/bookings/:id/documents     admin (?audience=chef|manager)
 *   GET /api/chef/storage-rentals/:id/documents, /api/manager/storage-rentals/:id/documents, /api/admin/storage-rentals/:id/documents
 *   GET /api/booking-documents/:documentId/pdf  any of the above, for a document of their audience
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { kitchenBookings, kitchens, locations, storageBookings, storageListings } from '@shared/schema';
import { bookingDocuments } from '@shared/booking-documents-schema';
import type { DocumentAudience } from '@shared/booking-documents';
import { DocumentsUnavailable, documentsFor, ensureBookingDocuments, ensureStorageDocuments } from '../services/booking-documents';
import { renderBookingDocumentPdf } from '../services/booking-document-pdf';
import { logger } from '../logger';

const router = Router();
const idOf = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

/** The audiences this user may read on this booking or storage rental. */
async function audiencesFor(req: Request, bookingId: number, bookingType: 'kitchen' | 'storage' = 'kitchen'): Promise<DocumentAudience[]> {
  const [owner] = bookingType === 'storage'
    ? await db.select({ chefId: storageBookings.chefId, managerId: locations.managerId }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, bookingId)).limit(1)
    : await db.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!owner) return [];
  const user = req.neonUser!;
  if (user.role === 'admin') return ['chef', 'manager'];
  return [...(owner.chefId === user.id ? ['chef' as const] : []), ...(owner.managerId === user.id ? ['manager' as const] : [])];
}

const unavailable = (res: Response) => res.status(503).json({ available: false, error: new DocumentsUnavailable().message });

for (const role of ['chef', 'manager', 'admin'] as const) {
  const path = role === 'chef' ? '/bookings/:id/documents' : `/${role}/bookings/:id/documents`;
  router.get(path, requireFirebaseAuthWithUser, async (req, res) => {
    const bookingId = idOf(req.params.id);
    if (!bookingId) return res.status(404).json({ error: 'Booking not found' });
    try {
      const allowed = await audiencesFor(req, bookingId);
      const audience: DocumentAudience | undefined = role === 'admin' ? (req.query.audience === 'manager' ? 'manager' : 'chef') : role;
      if (!audience || !allowed.includes(audience) || (role === 'admin' && req.neonUser!.role !== 'admin')) return res.status(404).json({ error: 'Booking not found' });
      const result = await ensureBookingDocuments(bookingId);
      const documents = documentsFor(result.documents, audience);
      return res.json({ available: true, settled: result.settled, documents,
        statementIssued: documents.some(doc => doc.kind === 'statement') });
    } catch (error) {
      if (error instanceof DocumentsUnavailable) return unavailable(res);
      logger.error('[Documents] List failed', { bookingId, error });
      return res.status(500).json({ error: 'Receipts could not be loaded. Please try again.' });
    }
  });
}

for (const role of ['chef', 'manager', 'admin'] as const) {
  router.get(`/${role}/storage-rentals/:id/documents`, requireFirebaseAuthWithUser, async (req, res) => {
    const rentalId = idOf(req.params.id);
    if (!rentalId) return res.status(404).json({ error: 'Storage rental not found' });
    try {
      const audience: DocumentAudience = role === 'admin' ? (req.query.audience === 'manager' ? 'manager' : 'chef') : role;
      if (!(await audiencesFor(req, rentalId, 'storage')).includes(audience) || (role === 'admin' && req.neonUser!.role !== 'admin'))
        return res.status(404).json({ error: 'Storage rental not found' });
      return res.json({ available: true, documents: documentsFor((await ensureStorageDocuments(rentalId)).documents, audience) });
    } catch (error) {
      if (error instanceof DocumentsUnavailable) return unavailable(res);
      logger.error('[Documents] Storage list failed', { rentalId, error });
      return res.status(500).json({ error: 'Receipts could not be loaded. Please try again.' });
    }
  });
}

router.get('/booking-documents/:documentId/pdf', requireFirebaseAuthWithUser, async (req, res) => {
  const documentId = idOf(req.params.documentId);
  if (!documentId) return res.status(404).json({ error: 'Document not found' });
  try {
    const [row] = await db.select().from(bookingDocuments).where(eq(bookingDocuments.id, documentId)).limit(1);
    if (!row || !(await audiencesFor(req, row.bookingId, row.bookingType)).includes(row.audience)) return res.status(404).json({ error: 'Document not found' });
    // Rendered from the stored snapshot only: the same document every time.
    const pdf = await renderBookingDocumentPdf(row.lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-${row.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code || (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '42P01') return unavailable(res);
    logger.error('[Documents] PDF failed', { documentId, error });
    return res.status(500).json({ error: 'The document could not be generated. Please try again.' });
  }
});

export default router;
