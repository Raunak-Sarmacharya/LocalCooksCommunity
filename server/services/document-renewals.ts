import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { chefDocumentRenewals, chefKitchenApplications, locations } from '@shared/schema';
import { accessDocumentDaysLeft, documentRenewalHref, type AccessRenewal } from '@shared/location-booking-eligibility';
import { DomainError } from '../shared/errors/domain-error';
import { logger } from '../logger';

export type RenewalKey = 'foodSafetyLicense' | 'foodEstablishmentCert';
export type RenewalDecision = 'approved' | 'rejected';
const labels: Record<RenewalKey, string> = { foodSafetyLicense: 'Food Safety Certificate', foodEstablishmentCert: 'Food Establishment Licence' };

/** Until migration 0074 is applied the table is missing: every read treats that as "no renewal" and every write reports it. */
const tableMissing = (error: unknown) => {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === '42P01' || cause?.code === '42P01' || /chef_document_renewals/.test(String((error as Error)?.message || '')) && /does not exist|relation/i.test(String((error as Error)?.message || ''));
};

export const toAccessRenewal = (row: typeof chefDocumentRenewals.$inferSelect): AccessRenewal & { id: number; applicationId: number; submittedAt: Date | null } =>
  ({ id: row.id, applicationId: row.applicationId, key: row.documentKey as RenewalKey, status: row.status, url: row.url, expiry: row.expiry, rejectionReason: row.rejectionReason, submittedAt: row.submittedAt });

/** Fail safe: any read failure (including the table not existing yet) yields no renewals. */
export async function readDocumentRenewals(applicationIds: number | number[], connection: Pick<typeof db, 'select'> = db) {
  const ids = (Array.isArray(applicationIds) ? applicationIds : [applicationIds]).filter(Number.isInteger);
  if (!ids.length) return [];
  try {
    const rows = await connection.select().from(chefDocumentRenewals).where(inArray(chefDocumentRenewals.applicationId, ids));
    return rows.map(toAccessRenewal);
  } catch (error) {
    if (!tableMissing(error)) logger.error('[Document renewals] Could not read renewals; treating as none', { error });
    return [];
  }
}

/** Adds each application's pending renewals so a manager can review them next to the current document. */
export async function attachDocumentRenewals<T extends { id: number }>(applications: T[]) {
  const renewals = (await readDocumentRenewals(applications.map(application => application.id))).filter(renewal => renewal.status === 'pending');
  return applications.map(application => ({ ...application, documentRenewals: renewals.filter(renewal => renewal.applicationId === application.id) }));
}

/** Stores the renewed upload in the renewal slot. Returns false when the slot does not exist yet so the caller can fall back. */
export async function submitDocumentRenewal(input: { applicationId: number; key: RenewalKey; url: string; expiry: string }) {
  try {
    await db.insert(chefDocumentRenewals).values({ applicationId: input.applicationId, documentKey: input.key, url: input.url, expiry: input.expiry })
      .onConflictDoUpdate({ target: [chefDocumentRenewals.applicationId, chefDocumentRenewals.documentKey],
        set: { url: input.url, expiry: input.expiry, status: 'pending', rejectionReason: null, submittedAt: new Date(), reviewedBy: null, reviewedAt: null } });
    return true;
  } catch (error) {
    if (tableMissing(error)) { logger.warn('[Document renewals] Renewal slot unavailable (migration 0074 not applied); using the single document slot'); return false; }
    throw error;
  }
}

/**
 * Approve replaces the current document with the renewed one; reject keeps the current one and tells the chef why.
 * One transaction: the application row and the renewal row are locked, so a double click cannot decide twice.
 */
export async function decideDocumentRenewal(input: { applicationId: number; key: RenewalKey; decision: RenewalDecision; reviewer: 'manager' | 'local_cooks'; reason?: string }) {
  const reason = input.reason?.trim();
  if (input.decision === 'rejected' && (!reason || reason.length > 2000)) throw new DomainError('REASON_REQUIRED', 'Please tell the chef why the renewal was not accepted (up to 2,000 characters).', 400);
  const { queueAccessNotice } = await import('./location-access-notices');
  return db.transaction(async tx => {
    const [app] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, input.applicationId)).limit(1).for('update');
    if (!app) throw new DomainError('APPLICATION_NOT_FOUND', 'Application not found', 404);
    const [renewal] = await tx.select().from(chefDocumentRenewals).where(and(eq(chefDocumentRenewals.applicationId, input.applicationId), eq(chefDocumentRenewals.documentKey, input.key))).limit(1).for('update');
    if (!renewal || renewal.status !== 'pending') throw new DomainError('RENEWAL_NOT_PENDING', 'There is no renewal waiting for review for this document.', 409);
    const [location] = await tx.select().from(locations).where(eq(locations.id, app.locationId)).limit(1);
    const label = labels[input.key];
    const locationName = location?.name || 'this kitchen';
    const reviewedAt = new Date();
    if (input.decision === 'approved') {
      if ((accessDocumentDaysLeft(renewal.expiry, location?.timezone || undefined) ?? 0) <= 0) throw new DomainError('RENEWAL_EXPIRED', 'The renewed document has already expired. Ask the chef for a current one.', 400);
      const tierData = (app.tier_data || {}) as Record<string, any>;
      const documentVerification = { ...(tierData.documentVerification || {}), [input.key]: input.reviewer };
      await tx.update(chefKitchenApplications).set(input.key === 'foodSafetyLicense'
        ? { foodSafetyLicenseUrl: renewal.url, foodSafetyLicenseExpiry: renewal.expiry, foodSafetyLicenseStatus: 'approved', tier_data: { ...tierData, documentVerification }, updatedAt: reviewedAt }
        : { foodEstablishmentCertUrl: renewal.url, foodEstablishmentCertExpiry: renewal.expiry, foodEstablishmentCertStatus: 'approved', tier_data: { ...tierData, documentVerification }, updatedAt: reviewedAt })
        .where(eq(chefKitchenApplications.id, app.id));
    }
    await tx.update(chefDocumentRenewals).set({ status: input.decision, rejectionReason: input.decision === 'rejected' ? reason! : null, reviewedBy: input.reviewer, reviewedAt })
      .where(eq(chefDocumentRenewals.id, renewal.id));
    const approved = input.decision === 'approved';
    await queueAccessNotice(tx, { chefId: app.chefId, email: app.email, name: app.fullName,
      trackingId: `chef_document_renewal_${input.decision}_${renewal.id}_${reviewedAt.getTime()}`,
      subject: approved ? `Your renewed ${label} was approved` : `Your renewed ${label} was not accepted`,
      message: approved
        ? `Your renewed ${label} for ${locationName} was approved and is now on file. It is valid until ${renewal.expiry}. You can keep booking as normal.`
        : `Your renewed ${label} for ${locationName} was not accepted: ${reason} Your current document stays valid until it expires. Please upload a corrected one.`,
      path: approved ? '/dashboard?view=bookings' : documentRenewalHref(app.locationId), actionLabel: approved ? 'View your bookings' : 'Upload a corrected document',
      facts: [{ label: 'Location', value: locationName }, { label: 'Document', value: label }, ...(approved ? [{ label: 'Valid until', value: renewal.expiry }] : [{ label: 'Reason', value: reason! }])],
      // Deliberately no applicationId: this notice is not an expiry reminder, so the reminder suppression must not apply.
      metadata: { renewalId: renewal.id, document: input.key, decision: input.decision } });
    return { applicationId: app.id, chatConversationId: app.chat_conversation_id, key: input.key, decision: input.decision };
  });
}
