/**
 * "Approve for booking without documents" (owner, Oct 23): the kitchen lets one customer book at its location without
 * its Step 2 requirements. Logged in kitchen_document_waiver_events; reversible by the kitchen (and ended by Local
 * Cooks admins). Ending it pauses new bookings at once until the required documents are approved, and the customer is
 * told what's needed. Admins hear about every waiver: in-app all of them, by email those with admin email turned on.
 */
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, kitchenDocumentWaiverEvents, locations, users } from '@shared/schema';
import { documentRenewalHref, requiredAccessDocuments } from '@shared/location-booking-eligibility';
import { DomainError } from '../shared/errors/domain-error';
import { logger } from '../logger';
import { getAppBaseUrl } from '../config';
import { renderTransactionalEmail } from '../email';
import { notificationService } from './notification.service';
import { sendAdminNotificationEmail } from './admin-email-preferences';
import { locationService } from '../domains/locations/location.service';

type Actor = { id: number; role: 'manager' | 'admin' };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Marks the application waived and logs it; the caller approves it in the same request. */
export async function recordDocumentWaiver(tx: Tx | typeof db, applicationId: number, actor: Actor) {
  await tx.update(chefKitchenApplications).set({ documentsWaivedAt: new Date(), documentsWaivedBy: actor.id, updatedAt: new Date() })
    .where(eq(chefKitchenApplications.id, applicationId));
  await tx.insert(kitchenDocumentWaiverEvents).values({ applicationId, action: 'waived', actorId: actor.id, actorRole: actor.role });
}

/** Turns the waiver on or off for an approved customer. Returns the application as it now is. */
export async function setDocumentWaiver(applicationId: number, waived: boolean, actor: Actor) {
  const result = await db.transaction(async tx => {
    const [app] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, applicationId)).limit(1).for('update');
    if (!app) throw new DomainError('APPLICATION_NOT_FOUND', 'Application not found', 404);
    if (app.status !== 'approved' || (app.current_tier ?? 1) < 2) throw new DomainError('WAIVER_NOT_AVAILABLE', 'Documents can be waived once the first request is approved.', 409);
    if (waived === !!app.documentsWaivedAt) return { app, changed: false };
    if (waived) {
      await recordDocumentWaiver(tx, app.id, actor);
    } else {
      await tx.update(chefKitchenApplications).set({ documentsWaivedAt: null, documentsWaivedBy: null, updatedAt: new Date() }).where(eq(chefKitchenApplications.id, app.id));
      await tx.insert(kitchenDocumentWaiverEvents).values({ applicationId: app.id, action: 'ended', actorId: actor.id, actorRole: actor.role });
    }
    const [updated] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, app.id)).limit(1);
    return { app: updated, changed: true };
  });
  if (result.changed && !waived) await tellCustomerWaiverEnded(result.app).catch(error => logger.error('[Document waiver] Could not tell the customer the waiver ended', { applicationId, error }));
  if (result.changed && waived) await notifyAdminsOfWaiver(result.app, actor).catch(error => logger.error('[Document waiver] Could not notify admins', { applicationId, error }));
  return result.app;
}

/** The kitchen needs documents again: new bookings pause until the required ones are approved; existing ones stay. */
async function tellCustomerWaiverEnded(app: typeof chefKitchenApplications.$inferSelect) {
  const [location] = await db.select().from(locations).where(eq(locations.id, app.locationId)).limit(1);
  const requirements = await locationService.getLocationRequirementsWithDefaults(app.locationId);
  const missing = requiredAccessDocuments(app, requirements).filter(doc => !doc.url || doc.status !== 'approved').map(doc => doc.label);
  const name = location?.name || 'the kitchen';
  const { queueAccessNotice, dispatchAccessNotices } = await import('./location-access-notices');
  await db.transaction(tx => queueAccessNotice(tx, {
    chefId: app.chefId, email: app.email, name: app.fullName,
    trackingId: `document_waiver_ended_${app.id}_${Date.now()}`,
    subject: `${name} now needs your documents`,
    message: missing.length
      ? `${name} now asks for your documents before new bookings. Upload your ${missing.join(', ')} and new bookings open again once they're approved. Your existing bookings are unaffected.`
      : `${name} now checks your documents. Everything it requires is on file, so you can keep booking as normal.`,
    path: documentRenewalHref(app.locationId), actionLabel: missing.length ? 'Upload documents' : 'View your documents',
    facts: [{ label: 'Location', value: name }, ...(missing.length ? [{ label: 'Needed', value: missing.join(', ') }] : [])],
    metadata: { waiverEnded: app.id },
  }));
  await dispatchAccessNotices().catch(() => undefined);
}

async function notifyAdminsOfWaiver(app: typeof chefKitchenApplications.$inferSelect, actor: Actor) {
  const [location] = await db.select().from(locations).where(eq(locations.id, app.locationId)).limit(1);
  const [by] = await db.select({ username: users.username }).from(users).where(eq(users.id, actor.id)).limit(1);
  const admins = await db.select({ id: users.id, username: users.username }).from(users)
    .where(and(eq(users.role, 'admin'), isNotNull(users.username), ne(users.username, '')));
  const locationName = location?.name || 'a location';
  const subject = `${locationName} approved ${app.fullName} without documents`;
  const message = `${locationName} approved ${app.fullName} for booking without its required documents. The kitchen took responsibility for this; you can end the waiver from the application.`;
  const facts = [{ label: 'Customer', value: `${app.fullName} (${app.email})` }, { label: 'Location', value: locationName },
    { label: 'Approved by', value: by?.username || `user ${actor.id}` }, { label: 'Application', value: `APPLICATION-${app.id}` }];
  const path = `/admin?section=kitchen-applications-step1&application=${app.id}`;
  for (const admin of admins) {
    await notificationService.createForManager({ managerId: admin.id, type: 'system_announcement', priority: 'normal', title: subject, message,
      metadata: { applicationId: app.id, locationId: app.locationId, workflow: 'kitchen', documentsWaived: true }, actionUrl: path, actionLabel: 'View application' });
    const content = renderTransactionalEmail({ to: admin.username!, recipientName: 'Local Cooks', subject, message, facts,
      actionLabel: 'View application', actionUrl: `${getAppBaseUrl('admin')}${path}` });
    await sendAdminNotificationEmail(content, { trackingId: `document_waiver_admin_${admin.id}_${app.id}_${Date.now()}` });
  }
}

export { notifyAdminsOfWaiver };
