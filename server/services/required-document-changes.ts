/**
 * When a kitchen makes a document Required (a new one, or Track it → Required), customers it has already approved
 * who don't have it pause for new bookings at once, as on Food Corridor, and are told at once (owner, Oct 24).
 * Existing bookings are never affected. The kitchen sees how many customers it affects before it saves.
 */
import { and, eq, gte, isNull } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, chefLocationAccess, locations } from '@shared/schema';
import { accessDocumentDaysLeft, documentRenewalHref, requiredAccessDocuments, type AccessRequirements } from '@shared/location-booking-eligibility';
import { queueAccessNotice } from './location-access-notices';
import { logger } from '../logger';

/** Keys of the documents that become Required with this change. */
export function newlyRequiredKeys(before: AccessRequirements, after: AccessRequirements) {
  const probe = { status: 'approved', current_tier: 3 };
  const was = new Set(requiredAccessDocuments(probe, before).map(doc => doc.key));
  return requiredAccessDocuments(probe, after).filter(doc => !was.has(doc.key)).map(doc => doc.key);
}

/** Approved customers with access at this location who are missing (or lack a valid approved copy of) a newly required document. */
export async function customersMissingNewlyRequired(locationId: number, before: AccessRequirements, after: AccessRequirements) {
  const keys = new Set(newlyRequiredKeys(before, after));
  if (!keys.size) return { documents: [] as { key: string; label: string }[], customers: [] as { applicationId: number; chefId: number; email: string; name: string; missing: string[] }[], locationName: '' };
  const [location] = await db.select({ name: locations.name, timezone: locations.timezone }).from(locations).where(eq(locations.id, locationId)).limit(1);
  const rows = await db.select({ app: chefKitchenApplications }).from(chefKitchenApplications)
    .innerJoin(chefLocationAccess, and(eq(chefLocationAccess.chefId, chefKitchenApplications.chefId), eq(chefLocationAccess.locationId, chefKitchenApplications.locationId)))
    .where(and(eq(chefKitchenApplications.locationId, locationId), eq(chefKitchenApplications.status, 'approved'), gte(chefKitchenApplications.current_tier, 3), isNull(chefKitchenApplications.documentsWaivedAt)));
  const documents = requiredAccessDocuments({ status: 'approved', current_tier: 3 }, after).filter(doc => keys.has(doc.key)).map(({ key, label }) => ({ key, label }));
  const customers = rows.flatMap(({ app }) => {
    const missing = requiredAccessDocuments(app, after).filter(doc => keys.has(doc.key))
      .filter(doc => !(doc.url && doc.status === 'approved' && (!doc.hasExpiry || (accessDocumentDaysLeft(doc.expiry, location?.timezone || undefined) ?? 0) > 0)))
      .map(doc => doc.label);
    return missing.length ? [{ applicationId: app.id, chefId: app.chefId, email: app.email, name: app.fullName, missing }] : [];
  });
  return { documents, customers, locationName: location?.name || 'the kitchen' };
}

const list = (items: string[]) => items.length < 2 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Tells each affected customer, once per change. Failures are logged; the kitchen's save has already happened. */
export async function notifyNewlyRequiredDocuments(locationId: number, before: AccessRequirements, after: AccessRequirements) {
  const impact = await customersMissingNewlyRequired(locationId, before, after);
  const stamp = Date.now();
  for (const customer of impact.customers) {
    try {
      await db.transaction(tx => queueAccessNotice(tx, { chefId: customer.chefId, email: customer.email, name: customer.name,
        trackingId: `document_now_required_${customer.applicationId}_${stamp}`,
        subject: `${impact.locationName} now needs your ${list(customer.missing)}`,
        message: `${impact.locationName} now asks for your ${list(customer.missing)} before new bookings. Upload it and the kitchen will check it. Your existing bookings aren't affected.`,
        path: documentRenewalHref(locationId), actionLabel: 'Upload now',
        facts: [{ label: 'Location', value: impact.locationName }, { label: 'Needed', value: list(customer.missing) }],
        // No applicationId: this is not an expiry reminder, so reminder suppression must not apply.
        metadata: { locationId, documents: customer.missing, application: customer.applicationId } }));
    } catch (error) {
      logger.error('[Required documents] Could not tell a customer about a newly required document', { applicationId: customer.applicationId, error });
    }
  }
  return impact.customers.length;
}
