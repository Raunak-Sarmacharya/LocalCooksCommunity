import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, chefLocationAccess, locations } from '@shared/schema';
import { accessDocumentStage, documentRenewalHref, requiredAccessDocuments } from '@shared/location-booking-eligibility';
import { locationService } from '../domains/locations/location.service';
import { queueAccessNotice, dispatchAccessNotices } from './location-access-notices';
import { readDocumentRenewals } from './document-renewals';
import { assertWorkerTime, workerAfter, workerPageEnd, workerRecord, deliveryReserve } from './worker-context';

/** Bounded discovery with a durable worker cursor; eligibility blocks at read time even without this sweep. */
export async function sweepChefDocumentExpiry(now = new Date()) {
  const key = 'chef-document-expiry';
  const rows = await db.select({ id: chefKitchenApplications.id }).from(chefKitchenApplications)
    .where(and(eq(chefKitchenApplications.status, 'approved'), gte(chefKitchenApplications.current_tier, 3), workerAfter(key, chefKitchenApplications.id)))
    .orderBy(asc(chefKitchenApplications.id)).limit(3);
  await workerPageEnd(key, rows.length);
  for (const row of rows) {
    assertWorkerTime(2500);
    // Read outside the transaction: a missing renewal table must not abort it.
    const renewals = await readDocumentRenewals(row.id);
    await db.transaction(async tx => {
      const [app] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, row.id)).limit(1).for('update');
      if (!app || app.status !== 'approved' || app.current_tier < 3) return;
      const [access] = await tx.select().from(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, app.chefId), eq(chefLocationAccess.locationId, app.locationId))).limit(1);
      if (!access) return;
      const [location] = await tx.select().from(locations).where(eq(locations.id, app.locationId)).limit(1);
      if (!location) return;
      const requirements = await locationService.getLocationRequirementsWithDefaults(app.locationId);
      for (const doc of requiredAccessDocuments(app, requirements)) {
        const stage = accessDocumentStage(doc.expiry, location.timezone || undefined, now);
        if (!stage || doc.status !== 'approved' || !doc.url) continue;
        // The chef has already renewed: no "please renew" nudge while the renewal waits for review.
        if (renewals.some(renewal => renewal.key === doc.key && renewal.status === 'pending')) continue;
        await queueAccessNotice(tx, { chefId: app.chefId, email: app.email, name: app.fullName,
          trackingId: `chef_document_${stage}_${app.id}_${doc.key}_${doc.expiry}`,
          subject: `${doc.label} ${stage === 'expired' ? 'expired' : 'expiring'} at ${location.name}`,
          message: stage === 'expired'
            ? `Your ${doc.label} at ${location.name} has expired. New bookings are paused until a renewed document is approved. Please upload a renewed document for review. Existing bookings are unaffected.`
            : `Your ${doc.label} at ${location.name} expires on ${doc.expiry}. You can keep booking until then. Please upload a renewed document before it expires so new bookings do not pause; your current document stays valid while the renewal is reviewed. Existing bookings are unaffected.`, path: documentRenewalHref(app.locationId), actionLabel: 'Upload a renewed document',
          facts: [{ label: 'Location', value: location.name }, { label: 'Expiry date', value: doc.expiry! }],
          metadata: { applicationId: app.id, document: doc.key, expiry: doc.expiry, stage },
        });
      }
    });
    await workerRecord(key, row.id);
  }
  assertWorkerTime(deliveryReserve());
  await dispatchAccessNotices();
  return { checked: rows.length };
}
