import { and, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { chefKitchenApplications, chefLocationAccess, emailLogs, locations } from '@shared/schema';
import { accessDocuments, customDocumentId, isCustomDocumentKey, requiredAccessDocuments, type DocumentStage } from '@shared/location-booking-eligibility';
import { createBookingDateTime, DEFAULT_TIMEZONE, formatInTimezone } from '@shared/timezone-utils';
import { db } from '../db';
import { logger } from '../logger';
import { locationService } from '../domains/locations/location.service';
import { readDocumentRenewals } from './document-renewals';
import { type ClockStep, jumpGraceMs, jumpStepMs, maxJumpMs, recordJump, TestClockError } from './qa-test-clock';

const day = 86_400_000;
const stages: Array<[DocumentStage, number]> = [['45_day', 45], ['14_day', 14], ['3_day', 3], ['expired', 0]];
const done = ['sent', 'skipped_policy', 'skipped_preference'];
type Clock = { updatedAt: string; steps: ClockStep[] };

/** Same walk as the invitation clock: one step at a time within the request budget. */
async function walk<T extends Clock>(read: () => Promise<T>, once: (to: Date, version: string) => Promise<{ movedMs: number; notices: Array<{ kind: string; sent: boolean }> }>,
  to: Date, expectedUpdatedAt: string, budgetMs: number) {
  const started = Date.now();
  let target = to.getTime(), version: string | null = expectedUpdatedAt, movedMs = 0, reached: string | null = null;
  const notices: Array<{ kind: string; sent: boolean }> = [];
  if (!Number.isFinite(target) || target <= Date.now() || target - Date.now() > maxJumpMs) throw new TestClockError(400, 'Pick a time in the next 60 days.');
  while (target > Date.now() + jumpGraceMs && Date.now() - started < budgetMs) {
    const clock = await read();
    const next = clock.steps.find(step => Date.parse(step.at) < target - jumpStepMs);
    const result = await once(new Date(next ? Date.parse(next.at) : target), version ?? clock.updatedAt);
    version = null; target -= result.movedMs; movedMs += result.movedMs; reached = next?.label ?? null;
    notices.push(...result.notices);
    if (!next) { reached = null; break; }
  }
  return { movedMs, notices, clock: await read(), ...(target > Date.now() + jumpGraceMs ? { stoppedAt: reached } : {}) };
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);

/** The application, its location and the documents the sweep would remind about (approved, on file, dated, no renewal waiting). */
async function context(id: number, reader: Pick<typeof db, 'select'> = db) {
  const [row] = await reader.select({ app: chefKitchenApplications, location: locations, access: chefLocationAccess.id }).from(chefKitchenApplications)
    .innerJoin(locations, eq(locations.id, chefKitchenApplications.locationId))
    .leftJoin(chefLocationAccess, and(eq(chefLocationAccess.chefId, chefKitchenApplications.chefId), eq(chefLocationAccess.locationId, chefKitchenApplications.locationId)))
    .where(eq(chefKitchenApplications.id, id)).limit(1);
  if (!row) throw new TestClockError(404, 'Application not found.');
  const { app, location } = row;
  const requirements = await locationService.getLocationRequirementsWithDefaults(app.locationId);
  const renewals = await readDocumentRenewals(id);
  const all = accessDocuments(app, requirements);
  const pausing = new Set(requiredAccessDocuments(app, requirements).map(doc => doc.key));
  const counted = all.filter(doc => doc.expiry && /^\d{4}-\d{2}-\d{2}$/.test(doc.expiry) && doc.status === 'approved' && doc.url
    && !renewals.some(renewal => renewal.key === doc.key && renewal.status === 'pending'));
  return { app, location, timezone: location.timezone || DEFAULT_TIMEZONE, active: app.status === 'approved' && app.current_tier >= 3 && !!row.access, all, counted, pausing };
}

/** Upcoming reminder stages of every document that counts. A stage begins at the start of the location's calendar day. */
export async function readDocumentsClock(id: number, now = new Date()) {
  const { app, location, timezone, active, all, counted, pausing } = await context(id);
  const steps: ClockStep[] = [];
  if (active) for (const doc of counted) for (const [stage, before] of stages) {
    const at = createBookingDateTime(addDays(doc.expiry!, -before), '00:00', timezone);
    if (at.getTime() <= now.getTime()) continue;
    steps.push({ key: `${doc.key}:${stage}`, at: at.toISOString(), label: stage === 'expired'
      ? `${doc.label} expires · customer told${pausing.has(doc.key) ? '; new bookings pause' : ''}`
      : `${doc.label}: ${before}-day renewal reminder (customer by email + in-app, kitchen in-app)` });
  }
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const skipped = all.filter(doc => !counted.includes(doc)).map(doc => `${doc.label} (${!doc.url ? 'not uploaded' : doc.status !== 'approved' ? 'not approved' : !doc.expiry ? 'no expiry date' : 'renewal waiting for review'})`);
  return { kind: 'documents' as const, id, reference: `${app.fullName} · ${location.name}`, status: app.status,
    // The application's own updated_at is the version: every jump rewrites it.
    updatedAt: app.updatedAt.toISOString(), now: now.toISOString(),
    note: steps.length ? null : !active ? 'Only an approved customer with access gets document reminders.'
      : `No document has a future reminder.${skipped.length ? ` Not counted: ${skipped.join(', ')}.` : ''}`, steps };
}

export const jumpDocuments = (id: number, to: Date, actorId: number, expectedUpdatedAt: string, budgetMs = 8_000) =>
  walk(() => readDocumentsClock(id), (target, version) => jumpDocumentsOnce(id, target, actorId, version), to, expectedUpdatedAt, budgetMs);

/** Moving "now" N days on == every counted expiry N whole local days earlier; the sweep then does what it does on that day. */
async function jumpDocumentsOnce(id: number, to: Date, actorId: number, expectedUpdatedAt: string, now = new Date()) {
  const first = await context(id);
  if (!first.active) throw new TestClockError(409, 'Only an approved customer with access has document reminders.');
  if (!first.counted.length) throw new TestClockError(409, 'No document counts: each needs to be approved, on file, dated and without a renewal waiting.');
  const local = (date: Date) => formatInTimezone(date, 'yyyy-MM-dd', first.timezone);
  const days = Math.max(1, Math.round((Date.parse(local(to)) - Date.parse(local(now))) / day));
  const [{ lastLog }] = await db.select({ lastLog: sql<number>`coalesce(max(${emailLogs.id}), 0)::int` }).from(emailLogs);
  await db.transaction(async tx => {
    const [app] = await tx.select().from(chefKitchenApplications).where(eq(chefKitchenApplications.id, id)).limit(1).for('update');
    if (!app) throw new TestClockError(404, 'Application not found.');
    if (app.updatedAt.toISOString() !== expectedUpdatedAt) throw new TestClockError(409, 'This application changed. Refresh and try again.');
    const set: Record<string, unknown> = { updatedAt: sql`date_trunc('milliseconds', now())` };
    const tierData = (app.tier_data && typeof app.tier_data === 'object' ? structuredClone(app.tier_data) : {}) as Record<string, any>;
    for (const doc of first.counted) {
      const next = addDays(doc.expiry!, -days);
      if (isCustomDocumentKey(doc.key)) (tierData.tier2_custom_fields_data ||= {})[`${customDocumentId(doc.key)}__expiry`] = next;
      else set[`${doc.key}Expiry`] = next;
      // Sent markers carry the expiry date: move them with it, or the same stage would be sent again for the new date.
      for (const [stage] of stages) {
        const from = `chef_document_${stage}_${id}_${doc.key}_${doc.expiry}`, into = `chef_document_${stage}_${id}_${doc.key}_${next}`;
        await tx.execute(sql`UPDATE email_logs SET tracking_id = ${into}, preview_text = replace(preview_text, ${`"expiry":"${doc.expiry}"`}, ${`"expiry":"${next}"`})
          WHERE tracking_id = ${from} AND NOT EXISTS (SELECT 1 FROM email_logs other WHERE other.tracking_id = ${into})`);
      }
    }
    if (first.counted.some(doc => isCustomDocumentKey(doc.key))) set.tier_data = tierData;
    await tx.update(chefKitchenApplications).set(set).where(eq(chefKitchenApplications.id, id));
    await recordJump(tx, { at: now.toISOString(), actorId, kind: 'documents', id, to: to.toISOString(), movedMs: days * day });
  });

  const { sweepDocumentExpiryForApplication } = await import('./chef-document-expiry');
  const { deliverAccessNotice } = await import('./location-access-notices');
  const step = async (name: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { logger.error('[TestClock] Document step failed; the worker retries it', { id, name, error }); }
  };
  await step('sweep', () => sweepDocumentExpiryForApplication(id));
  const mine = () => db.select({ id: emailLogs.id, trackingId: emailLogs.trackingId, status: emailLogs.status, previewText: emailLogs.previewText }).from(emailLogs)
    .where(and(eq(emailLogs.category, 'location_access_notice'), gt(emailLogs.id, lastLog), like(emailLogs.previewText, `{"applicationId":${id},%`))).orderBy(emailLogs.id);
  // A few notices inline; the rest go out with the worker.
  await step('notices', async () => { for (const row of (await mine()).filter(row => row.status === 'pending').slice(0, 4)) await deliverAccessNotice(row.id); });

  // Test addresses are never mailed; the send writes a skipped_policy row under the same tracking id, which counts as done.
  const intents = await mine();
  const finished = new Set((await db.select({ trackingId: emailLogs.trackingId }).from(emailLogs)
    .where(and(inArray(emailLogs.trackingId, intents.map(row => row.trackingId!).concat('')), inArray(emailLogs.status, done)))).map(row => row.trackingId));
  const notices = intents.map(row => ({ kind: String(JSON.parse(row.previewText || '{}').stage), sent: finished.has(row.trackingId) }));
  logger.info('[TestClock] Documents moved', { id, actorId, days });
  return { movedMs: days * day, notices };
}
