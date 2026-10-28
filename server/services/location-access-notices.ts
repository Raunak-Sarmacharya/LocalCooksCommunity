import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, chefLocationAccess, emailLogs, kitchenBookings, kitchens, locations } from '@shared/schema';
import { getAppBaseUrl } from '../config';
import { renderTransactionalEmail, sendEmail, emailClock, emailZoneName } from '../email';
import { notificationService } from './notification.service';
import { DomainError } from '../shared/errors/domain-error';
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { deliveryReserve, assertWorkerTime, workerAfter, workerBatch, workerPageEnd, workerRecord } from './worker-context';
import { logger } from '../logger';
import { accessDocumentStage, accessDocuments } from '@shared/location-booking-eligibility';
import { locationService } from '../domains/locations/location.service';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const category = 'location_access_notice';
export const accessEndedMarker = 'Access ended by manager: ';

export async function futureAccessBookings(connection: Transaction | typeof db, chefId: number, locationId: number, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const rows = await connection.select({ id: kitchenBookings.id, kitchenName: kitchens.name, bookingDate: kitchenBookings.bookingDate,
    startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, operatingWindowStartTime: kitchenBookings.operatingWindowStartTime, status: kitchenBookings.status })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .where(and(eq(kitchenBookings.chefId, chefId), eq(kitchens.locationId, locationId), inArray(kitchenBookings.status, ['pending', 'confirmed'])))
    .orderBy(asc(kitchenBookings.bookingDate), asc(kitchenBookings.id));
  return rows.filter(row => {
    const date = new Date(row.bookingDate).toISOString().slice(0, 10);
    return createBookingDateTime(calendarDateForBookingTime(date, row.endTime, row.operatingWindowStartTime, row.startTime), row.endTime, timezone) > now;
  });
}

export async function queueAccessNotice(tx: Transaction, input: { trackingId: string; chefId: number; email: string; name: string; subject: string; message: string; path: string; facts: { label: string; value: string }[]; actionLabel: string; metadata?: Record<string, unknown> }) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.trackingId}, 0))`);
  const [existing] = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category), eq(emailLogs.trackingId, input.trackingId))).limit(1);
  if (existing) return existing.id;
  const content = renderTransactionalEmail({ to: input.email, recipientName: input.name, subject: input.subject, message: input.message,
    facts: input.facts, actionLabel: input.actionLabel, actionUrl: `${getAppBaseUrl()}${input.path}`,
    secondaryLink: { label: 'Contact Local Cooks', url: 'mailto:support@localcooks.ca' } });
  await notificationService.createForChef({ chefId: input.chefId, type: 'system_announcement', title: input.subject,
    message: input.message, actionUrl: input.path, actionLabel: input.actionLabel, metadata: { trackingId: input.trackingId, ...input.metadata } }, tx);
  const [intent] = await tx.insert(emailLogs).values({ recipientEmail: input.email, recipientUserId: input.chefId, recipientRole: 'chef',
    category, trackingId: input.trackingId, status: 'pending', subject: content.subject, htmlBody: content.html, textBody: content.text,
    previewText: JSON.stringify(input.metadata || {}) }).returning();
  return intent.id;
}

/**
 * Access is back: drop the "Access ended" line(s) the revoke wrote, so the chef no longer reads a stale note and the
 * kitchen's Customers list stops counting them as revoked. Other feedback stays.
 * shortcut: a reason typed over several lines keeps its later lines; revoke stores one line per reason in practice.
 */
export async function clearAccessEndedNote(chefId: number, locationId: number, connection: Pick<typeof db, 'update'> = db) {
  // Cleanup only: a failure here must never fail the grant itself.
  try {
    await connection.update(chefKitchenApplications)
      .set({ feedback: sql`nullif(regexp_replace(${chefKitchenApplications.feedback}, ${`^${accessEndedMarker}[^\\n]*\\n?`}, '', 'gn'), '')` })
      .where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId), sql`${chefKitchenApplications.feedback} like ${`%${accessEndedMarker}%`}`));
  } catch (error) { logger.error('[Access notice] Could not clear the access-ended note', { chefId, locationId, error }); }
}

/**
 * The feedback as the customer reads it: the revoke's internal marker (it says "manager") never shows; while access is
 * active again, the old "access ended" lines are gone too (rows restored before clearAccessEndedNote existed).
 */
export function chefFeedback(feedback: string | null | undefined, accessEnded: boolean) {
  if (!feedback) return feedback ?? null;
  const lines = feedback.split('\n').filter(line => accessEnded || !line.startsWith(accessEndedMarker)).map(line => line.split(accessEndedMarker).join(''));
  return lines.join('\n').trim() || null;
}

/** The kitchen asked for a new copy of a document: the chef gets its note in-app and by email (owner, Oct 27). */
export async function queueNewCopyNotice(input: { applicationId: number; chefId: number; email: string; name: string; locationId: number; locationName: string; document: string; key: string; note: string }) {
  const path = `/dashboard?view=kitchen-requests&renewLocation=${input.locationId}`;
  return db.transaction(tx => queueAccessNotice(tx, { chefId: input.chefId, email: input.email, name: input.name,
    trackingId: `document_new_copy_${input.applicationId}_${input.key}_${Date.now()}`,
    subject: `${input.locationName} asked for a new copy of your ${input.document}`,
    message: `${input.locationName} asked for a new copy of your ${input.document}. Their note: ${input.note} Upload the new copy on your documents page.`,
    path, actionLabel: 'Upload a new copy',
    facts: [{ label: 'Kitchen', value: input.locationName }, { label: 'Document', value: input.document }, { label: 'Note from the kitchen', value: input.note }],
    // No applicationId: this is not an expiry reminder, so the reminder suppression must not apply.
    metadata: { document: input.key, kind: 'new_copy' } }));
}

export async function revokeManagerLocationAccess(managerId: number, chefId: number, locationId: number, reason: string) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw new DomainError('REASON_REQUIRED', 'Please provide a reason for ending access (up to 2,000 characters).', 400);
  return db.transaction(async tx => {
    const [location] = await tx.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, managerId))).limit(1).for('update');
    if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404);
    const [app] = await tx.select().from(chefKitchenApplications).where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1).for('update');
    if (!app) throw new DomainError('APPLICATION_NOT_FOUND', 'Application not found', 404);
    const bookings = await futureAccessBookings(tx, chefId, locationId, location.timezone || DEFAULT_TIMEZONE);
    const removed = await tx.delete(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, chefId), eq(chefLocationAccess.locationId, locationId))).returning();
    if (!removed.length) return { success: true, bookings, noticeId: null };
    await tx.update(chefKitchenApplications).set({ feedback: `${accessEndedMarker}${reason.trim()}\n${app.feedback || ''}`,
      reviewedBy: managerId, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(chefKitchenApplications.id, app.id));
    const noticeId = await queueAccessNotice(tx, { chefId, email: app.email, name: app.fullName,
      trackingId: `access_ended_${app.id}_${removed.map(row => row.id).join('_')}`, subject: `Your access to ${location.name} has ended`,
      message: `Your access to ${location.name} has ended for new bookings. ${reason.trim()} Your existing confirmed and pending bookings are kept. Please contact the kitchen or Local Cooks to request access again. Contact Local Cooks if you need help with cancellations.`,
      path: '/dashboard?view=bookings', actionLabel: 'View your bookings',
      facts: [{ label: 'Location', value: location.name }, ...bookings.map(row => ({ label: `Booking KB-${row.id}`, value: `${row.kitchenName} · ${new Date(row.bookingDate).toISOString().slice(0, 10)} · ${row.startTime}–${row.endTime} · ${row.status}` }))] });
    return { success: true, bookings, noticeId };
  });
}

// A committed claim prevents an uncertain SMTP result from being retried and duplicated.
// shortcut: uncertain/failed sends require Local Cooks recovery; add provider reconciliation before automatic retries.
export async function deliverAccessNotice(id: number) {
  assertWorkerTime(deliveryReserve());
  const intent = await db.transaction(async tx => {
    const [pending] = await tx.select().from(emailLogs).where(and(eq(emailLogs.id, id), eq(emailLogs.category, category), eq(emailLogs.status, 'pending'))).limit(1).for('update');
    if (!pending) return null;
    const metadata = JSON.parse(pending.previewText || '{}');
    if (metadata.applicationId) {
      const [app] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, metadata.applicationId)).limit(1).for('update');
      const [location] = app ? await tx.select().from(locations).where(eq(locations.id, app.locationId)).limit(1) : [];
      const [access] = app ? await tx.select().from(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, app.chefId), eq(chefLocationAccess.locationId, app.locationId))).limit(1) : [];
      const requirements = app ? await locationService.getLocationRequirementsWithDefaults(app.locationId) : {};
      const doc = app && accessDocuments(app, requirements).find(doc => doc.key === metadata.document);
      if (!app || app.status !== 'approved' || app.current_tier < 3 || !access || !doc || doc.status !== 'approved' || doc.expiry !== metadata.expiry || accessDocumentStage(doc.expiry, location?.timezone || undefined) !== metadata.stage) {
        await tx.update(emailLogs).set({ status: 'suppressed' }).where(eq(emailLogs.id, id));
        return null;
      }
    }
    await tx.update(emailLogs).set({ status: 'sending' }).where(eq(emailLogs.id, id));
    return pending;
  });
  if (!intent) return false;
  try {
    const sent = await sendEmail({ to: intent.recipientEmail, subject: intent.subject, html: intent.htmlBody || undefined, text: intent.textBody || undefined },
      { trackingId: intent.trackingId!, emailType: 'location_access_notice_attempt', retryOfId: intent.id, durableDelivery: true, reportDeliveryFailure: true });
    await db.update(emailLogs).set({ status: sent ? 'sent' : 'delivery_unknown' }).where(eq(emailLogs.id, id));
    return sent;
  } catch (error) {
    await db.update(emailLogs).set({ status: 'delivery_unknown', errorMessage: String(error) }).where(eq(emailLogs.id, id));
    logger.error('[Access notice] Delivery requires recovery', { id, error });
    return false;
  }
}

export async function dispatchAccessNotices() {
  const key = 'access-notice-delivery';
  const rows = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.category, category), eq(emailLogs.status, 'pending'), workerAfter(key, emailLogs.id))).orderBy(asc(emailLogs.id)).limit(Math.min(3, workerBatch()));
  await workerPageEnd(key, rows.length);
  for (const row of rows) { assertWorkerTime(deliveryReserve()); await deliverAccessNotice(row.id); await workerRecord(key, row.id); }
  return { checked: rows.length };
}
