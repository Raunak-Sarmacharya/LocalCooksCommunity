/** Live test controls for the explicitly authorized tour; no platform-wide sweeps. */
import 'dotenv/config';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { kitchenViewings, kitchenViewingSettings, locations, tourDeliveryEvents, emailLogs } from '../shared/schema';
import { queueTourEvent, deliverTourEvents, type TourEventKind } from '../server/services/tour-delivery-service';
import { currentReminders, scheduleAdvanceReminders, dispatchAdvanceReminders } from '../server/services/advance-reminders';
import { readTourFeedbackStatus } from '../server/services/tour-feedback-service';
import { tourReconfirmation, tourReconfirmationEventKey } from '../shared/tour-reconfirmation';
import { tourRequestEscalationDue, tourRequestEscalationKey } from '../shared/tour-request-decision';
import { tourFeedbackOpen, tourFeedbackMissingDue, tourFeedbackEventKey } from '../shared/tour-feedback';

process.env.TZ = 'UTC'; // Database timestamp-without-timezone values are stored as UTC.
// These controls are explicitly for the user's dev-chef/dev-kitchen/dev-admin test.
process.env.VERCEL_ENV = 'preview';
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.FORCE_DIRECT_SMTP = 'true';
const id = 84;
const command = process.argv[2] || 'status';
const commands = ['status', 'prepare', 'repair-request', 'refresh-links', 'tick', 'arrival', 'reconfirmation-reminder', 'finish', 'feedback-overdue', 'expire', 'request-overdue', 'watch'];
if (!commands.includes(command)) throw Error(`Use ${commands.join(', ')}`);
if (!/(^|\.)supabase\.(com|co)$/.test(new URL(process.env.DATABASE_URL!).hostname)) throw Error('Expected configured Supabase database');

async function tick() {
  await db.transaction(async tx => {
    const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).for('update');
    if (!tour || tour.chefId !== 369 || tour.targetedKitchenId !== 40 || tour.locationId !== 33) throw Error('Tour 84 ownership changed');
    const [location] = await tx.select().from(locations).where(eq(locations.id, tour.locationId)).limit(1);
    const queue = async (kind: TourEventKind, key: string) => {
      const [existing] = await tx.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents).where(eq(tourDeliveryEvents.eventKey, key)).limit(1);
      if (!existing) await queueTourEvent(tx, { kind, before: tour, after: tour, actorRole: 'automated' });
    };
    if (['pending_local_cooks', 'pending'].includes(tour.status) && tour.scheduledAt.getTime() <= Date.now()) {
      const [expired] = await tx.update(kitchenViewings).set({ status: 'cancelled', cancelledBy: 'request_expired', requestExpiredAt: tour.scheduledAt,
        cancelledAt: tour.scheduledAt, rescheduleProposedSlots: [], rescheduleProposedAt: null, requestedRescheduleAt: null, rescheduleRequestedAt: null, updatedAt: new Date() }).where(eq(kitchenViewings.id, id)).returning();
      await queueTourEvent(tx, { kind: 'expired', before: tour, after: expired, actorRole: 'automated' });
      return;
    }
    if (tourRequestEscalationDue(tour)) await queue('request_escalation', tourRequestEscalationKey(tour));
    const reconfirm = tourReconfirmation(tour, location?.managerId ?? null);
    if (reconfirm.canReply) {
      if (!reconfirm.reply) await queue('reconfirmation_requested', tourReconfirmationEventKey(tour, location?.managerId ?? null, 'reconfirmation_requested'));
      if (reconfirm.needsStaffAttention) await queue('reconfirmation_escalated', tourReconfirmationEventKey(tour, location?.managerId ?? null, 'reconfirmation_escalated'));
      const [ask] = await tx.select().from(tourDeliveryEvents).where(eq(tourDeliveryEvents.eventKey, tourReconfirmationEventKey(tour, location?.managerId ?? null, 'reconfirmation_requested'))).limit(1);
      if (reconfirm.needsVisitorReminder && ask?.completedAt && Date.now() - ask.completedAt.getTime() >= 3600000)
        await queue('reconfirmation_reminder', tourReconfirmationEventKey(tour, location?.managerId ?? null, 'reconfirmation_reminder'));
    }
    if (tourFeedbackOpen(tour)) {
      const feedback = await readTourFeedbackStatus(tx, tour);
      if (feedback.missing) {
        await queue('feedback_requested', tourFeedbackEventKey(tour, 'feedback_requested'));
        await tx.update(kitchenViewings).set({ feedbackRequestedAt: tour.feedbackRequestedAt || new Date() }).where(eq(kitchenViewings.id, id));
        if (tourFeedbackMissingDue(tour)) {
          await queue('feedback_missing', tourFeedbackEventKey(tour, 'feedback_missing'));
          await tx.update(kitchenViewings).set({ feedbackEscalatedAt: tour.feedbackEscalatedAt || new Date() }).where(eq(kitchenViewings.id, id));
        }
      }
    }
    await scheduleAdvanceReminders(tx, 'tour', id);
  });
  const events = await deliverTourEvents(id, 30, 55_000);
  const logs = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.category, 'advance_reminder'),
    inArray(emailLogs.status, ['scheduled', 'failed']), sql`${emailLogs.trackingId} LIKE ${`advance:tour:${id}:%`}`));
  const reminders = [];
  for (const log of logs) reminders.push(await dispatchAdvanceReminders({ onlyLogId: log.id, limit: 1, budgetMs: 25_000 }));
  return { events, reminders };
}

async function main() {
  if (command === 'watch') {
    mkdirSync('tmp/tour84', { recursive: true });
    writeFileSync('tmp/tour84/watch.pid', String(process.pid));
    const until = Date.now() + 2 * 3600000;
    while (Date.now() < until && !existsSync('tmp/tour84/stop')) { try {
      const [tour] = await db.select({ status: kitchenViewings.status }).from(kitchenViewings).where(eq(kitchenViewings.id, id));
      console.log(JSON.stringify({ at: new Date(), result: await tick() }));
      if (!tour || ['completed', 'cancelled', 'no_show'].includes(tour.status)) break;
    } catch (error) { console.error(error instanceof Error ? error.message : 'Tick failed'); }
      await new Promise(resolve => setTimeout(resolve, 30_000)); }
    return;
  }
  if (!['status', 'tick'].includes(command)) await db.transaction(async tx => {
    const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).for('update');
    if (!tour || tour.chefId !== 369 || tour.targetedKitchenId !== 40 || tour.locationId !== 33) throw Error('Tour 84 ownership changed');
    mkdirSync('tmp/tour84', { recursive: true });
    const backup = `tmp/tour84/before-${command}-${Date.now()}.json`;
    if (!existsSync(backup)) writeFileSync(backup, JSON.stringify({ tour, events: await tx.select().from(tourDeliveryEvents).where(eq(tourDeliveryEvents.viewingId, id)) }, null, 2));
    const [settings] = await tx.select().from(kitchenViewingSettings).where(eq(kitchenViewingSettings.kitchenId, tour.targetedKitchenId!)).limit(1);
    if (!settings?.isActive) throw Error('Kitchen tour settings must be active');
    if (command === 'repair-request') {
      if (!['pending_local_cooks', 'pending'].includes(tour.status)) throw Error('Repair requires pending request');
      const originalFile = readdirSync('tmp/tour84').filter(name => name.startsWith('before-prepare-')).sort()[0];
      if (!originalFile) throw Error('Original requested appointment backup is missing');
      const savedBackup = JSON.parse(readFileSync(`tmp/tour84/${originalFile}`, 'utf8'));
      const original = savedBackup.tour || savedBackup;
      if (original.id !== id || original.chefId !== tour.chefId) throw Error('Original backup ownership differs');
      const scheduledAt = new Date(original.scheduledAt);
      if (scheduledAt.getTime() <= Date.now()) throw Error('Original requested slot has passed; select a valid new slot through the UI');
      const [saved] = await tx.update(kitchenViewings).set({ scheduledAt, durationMinutes: settings.defaultDurationMinutes, updatedAt: new Date() }).where(eq(kitchenViewings.id, id)).returning();
      await queueTourEvent(tx, { kind: 'request_updated', before: tour, after: saved, actorId: tour.chefId, actorRole: 'chef' });
      await scheduleAdvanceReminders(tx, 'tour', id);
      return;
    }
    if (command === 'refresh-links') {
      if (!['pending_local_cooks', 'pending'].includes(tour.status)) throw Error('Refresh requires pending request');
      const [saved] = await tx.update(kitchenViewings).set({ updatedAt: new Date() }).where(eq(kitchenViewings.id, id)).returning();
      await queueTourEvent(tx, { kind: 'request_updated', before: tour, after: saved, actorId: tour.chefId, actorRole: 'chef' });
      return;
    }
    if (command === 'reconfirmation-reminder') {
      if (tour.status !== 'confirmed' || tour.reconfirmationReply) throw Error('Requires confirmed tour with no reconfirmation reply');
      const [location] = await tx.select().from(locations).where(eq(locations.id, tour.locationId)).limit(1);
      const oldKey = tourReconfirmationEventKey(tour, location?.managerId ?? null, 'reconfirmation_requested');
      const [ask] = await tx.select().from(tourDeliveryEvents).where(eq(tourDeliveryEvents.eventKey, oldKey)).limit(1);
      if (!ask?.completedAt) throw Error('Wait for the original reconfirmation email to be sent first');
      const [aged] = await tx.update(kitchenViewings).set({ appointmentConfirmedAt: new Date(Date.now() - 2 * 3600000), updatedAt: new Date() }).where(eq(kitchenViewings.id, id)).returning();
      await tx.update(tourDeliveryEvents).set({ eventKey: tourReconfirmationEventKey(aged, location?.managerId ?? null, 'reconfirmation_requested'),
        completedAt: new Date(Date.now() - 2 * 3600000) }).where(eq(tourDeliveryEvents.id, ask.id));
      return;
    }
    if (command === 'request-overdue') {
      if (!['pending_local_cooks', 'pending'].includes(tour.status)) throw Error('Requires pending request');
      await tx.update(kitchenViewings).set(tour.status === 'pending_local_cooks'
        ? { createdAt: new Date(Date.now() - 13 * 3600000), updatedAt: new Date() }
        : { adminReviewedAt: new Date(Date.now() - 13 * 3600000), updatedAt: new Date() }).where(eq(kitchenViewings.id, id));
      return;
    }
    if (command === 'prepare' && tour.status !== 'pending_local_cooks') throw Error('Prepare requires unreviewed request');
    if (['arrival', 'finish', 'feedback-overdue'].includes(command) && tour.status !== 'confirmed') throw Error('Confirm through the UI first');
    if (command === 'expire' && !['pending_local_cooks', 'pending'].includes(tour.status)) throw Error('Expiry requires pending request');
    const feedback = await readTourFeedbackStatus(tx, tour);
    if (feedback.current.length && ['finish', 'feedback-overdue', 'arrival'].includes(command)) throw Error('Move dates before submitting feedback; submitted answers belong to their original appointment');
    const durationMinutes = settings.defaultDurationMinutes;
    const offset = command === 'arrival' ? 30 : command === 'feedback-overdue' ? -(24 * 60 + durationMinutes + 1) : -(durationMinutes + 1);
    // Pending acceptance requires a real availability slot and configured duration.
    // Only an already-confirmed appointment may jump into an email/feedback window.
    const [saved] = await tx.update(kitchenViewings).set({ scheduledAt: command === 'prepare' ? tour.scheduledAt : new Date(Date.now() + offset * 60000),
      durationMinutes, updatedAt: new Date() }).where(eq(kitchenViewings.id, id)).returning();
    // Future schedule edits use real event delivery; clock jumps after the visit are test controls.
    if (command === 'prepare') await queueTourEvent(tx, { kind: 'request_updated', before: tour, after: saved, actorId: tour.chefId, actorRole: 'chef' });
    await scheduleAdvanceReminders(tx, 'tour', id);
  });
  if (command !== 'status') console.log(JSON.stringify({ command, delivery: await tick() }));
  const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id));
  const events = await db.select({ id: tourDeliveryEvents.id, eventKey: tourDeliveryEvents.eventKey, attempts: tourDeliveryEvents.attempts,
    completedAt: tourDeliveryEvents.completedAt, lastError: tourDeliveryEvents.lastError }).from(tourDeliveryEvents).where(eq(tourDeliveryEvents.viewingId, id));
  const emails = await db.select({ id: emailLogs.id, subject: emailLogs.subject, status: emailLogs.status, trackingId: emailLogs.trackingId, error: emailLogs.errorMessage }).from(emailLogs)
    .where(sql`${emailLogs.trackingId} LIKE ${`advance:tour:${id}:%`} OR ${emailLogs.trackingId} LIKE ${`tour-event:%`} AND ${emailLogs.trackingId} IN
      (SELECT 'tour-event:' || id || ':' || key FROM tour_delivery_events, jsonb_array_elements_text(delivered_keys) AS key WHERE viewing_id = ${id})`);
  const reminders = await db.transaction(tx => currentReminders(tx, 'tour', id));
  console.log(JSON.stringify({ id, status: tour.status, scheduledAt: tour.scheduledAt, durationMinutes: tour.durationMinutes,
    events, emails, reminders: reminders.map(r => ({ kind: r.kind, role: r.role, due: r.due })) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Test control failed'); process.exitCode = 1; }).finally(() => pool.end());
