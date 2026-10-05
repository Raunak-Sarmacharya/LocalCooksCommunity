import { db } from "../db";
import { applications, emailLogs, users } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger";

export type EmailLogStatus = "sent" | "failed" | "skipped_duplicate";

export interface RecipientFlags {
  id?: number | null;
  isChef?: boolean;
  isManager?: boolean;
  isPortalUser?: boolean;
  role?: string | null;
}

export interface OutgoingEmailLogInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  status: EmailLogStatus;
  errorMessage?: string;
  trackingId?: string;
  smtpMessageId?: string;
  emailType?: string;
  fromAddress?: string;
  retryOfId?: number;
}

const PREVIEW_MAX_LENGTH = 500;
const ERROR_MAX_LENGTH = 1000;

export function parseRecipients(to: string | undefined | null): string[] {
  if (!to) return [];
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of to.split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }
  return recipients;
}

export function inferEmailCategory(subject: string, trackingId?: string, emailType?: string): string {
  if (emailType && emailType.trim()) {
    return emailType.trim().toLowerCase().replace(/\s+/g, "_");
  }

  const haystack = `${subject || ""} ${trackingId || ""}`.toLowerCase();

  if (/damage\s*claim/.test(haystack)) return "damage_claim";
  if (/overstay|penalty/.test(haystack)) return "overstay";
  if (/promo(\s*code)?/.test(haystack)) return "promo";
  if (/verif(y|ication)/.test(haystack)) return "verification";
  if (/welcome/.test(haystack)) return "welcome";
  if (/password|reset/.test(haystack)) return "password";
  if (/\btour\b|viewing/.test(haystack)) return "viewing";
  if (/license/.test(haystack)) return "license";
  if (/application/.test(haystack)) return "application";
  if (/check[\s-]?in|check[\s-]?out/.test(haystack)) return "checkin";
  if (/\baccess\b/.test(haystack)) return "access";
  if (/storage|extension/.test(haystack)) return "storage";
  if (/refund/.test(haystack)) return "refund";
  if (/cancel/.test(haystack)) return "cancellation";
  if (/booking|reservation/.test(haystack)) return "booking";
  if (/payout|statement/.test(haystack)) return "payout";
  return "general";
}

export function resolveRecipientRole(user: RecipientFlags | null | undefined): string {
  if (!user) return "unknown";
  if (user.isChef && user.isManager) return "chef_and_manager";
  if (user.isChef || user.role === "chef") return "chef";
  if (user.isManager || user.role === "manager") return "manager";
  if (user.role === "admin") return "admin";
  if (user.isPortalUser) return "portal";
  return "unknown";
}

export function buildPreviewText(text?: string, html?: string): string | null {
  const source = (text && text.trim()) ? text : (html || "");
  if (!source.trim()) return null;
  const stripped = source
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.length > PREVIEW_MAX_LENGTH
    ? `${stripped.slice(0, PREVIEW_MAX_LENGTH)}…`
    : stripped;
}

export function canRetryEmailLog(
  status: string,
  htmlBody?: string | null,
  textBody?: string | null,
): boolean {
  return status === "failed" && !!(htmlBody?.trim() || textBody?.trim());
}

async function lookupRecipient(email: string): Promise<RecipientFlags | null> {
  const [user] = await db
    .select({
      id: users.id,
      isChef: users.isChef,
      isManager: users.isManager,
      isPortalUser: users.isPortalUser,
      role: users.role,
    })
    .from(users)
    .where(sql`lower(${users.username}) = ${email}`)
    .limit(1);

  if (user) return user;

  const [application] = await db
    .select({ userId: applications.userId })
    .from(applications)
    .where(sql`lower(${applications.email}) = ${email}`)
    .limit(1);

  if (application?.userId) {
    return {
      id: application.userId,
      isChef: true,
      isManager: false,
      isPortalUser: false,
      role: "chef",
    };
  }

  if (application) {
    return {
      id: null,
      isChef: true,
      isManager: false,
      isPortalUser: false,
      role: "chef",
    };
  }

  return null;
}

export async function logOutgoingEmail(input: OutgoingEmailLogInput): Promise<void> {
  const recipients = parseRecipients(input.to);
  if (recipients.length === 0) return;

  const category = inferEmailCategory(input.subject, input.trackingId, input.emailType);
  const previewText = buildPreviewText(input.text, input.html);
  const errorMessage = input.errorMessage
    ? input.errorMessage.slice(0, ERROR_MAX_LENGTH)
    : null;

  for (const email of recipients) {
    try {
      const recipient = await lookupRecipient(email);
      const persistBody = input.status === "failed";
      await db.insert(emailLogs).values({
        recipientEmail: email,
        recipientUserId: recipient?.id ?? null,
        recipientRole: resolveRecipientRole(recipient),
        subject: input.subject || "(no subject)",
        previewText,
        category,
        status: input.status,
        errorMessage,
        trackingId: input.trackingId ?? null,
        smtpMessageId: input.smtpMessageId ?? null,
        fromAddress: input.fromAddress ?? null,
        htmlBody: persistBody ? (input.html || null) : null,
        textBody: persistBody ? (input.text || null) : null,
        retryOfId: input.retryOfId ?? null,
      });
    } catch (err) {
      logger.error(`[EmailLog] Failed to persist log for ${email}:`, err);
    }
  }
}

/**
 * Whether an email with this tracking id has already been sent successfully.
 *
 * `sendEmail`'s own duplicate guard is an in-process `Map`, which on Vercel means one
 * memory space per invocation. A daily cron job starts cold every time, so that guard
 * can never suppress a repeat across runs — the durable equivalent has to read the
 * rows `sendEmail` already writes into email_logs.
 *
 * Only `sent` counts: a `failed` row must stay retryable, and a `skipped_duplicate`
 * row is itself the record of a suppressed send.
 */
export async function hasSentTrackingId(trackingId: string): Promise<boolean> {
  if (!trackingId) return false;
  try {
    const [row] = await db
      .select({ id: emailLogs.id })
      .from(emailLogs)
      .where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.status, "sent")))
      .limit(1);
    return !!row;
  } catch (err) {
    logger.error(`[EmailLog] Failed to check tracking id ${trackingId}:`, err);
    // Fail closed. If the check itself is broken, skipping one reminder is far
    // cheaper than mailing the same manager every single day.
    return true;
  }
}

export async function retryFailedEmail(logId: number): Promise<{ success: boolean; error?: string; message?: string }> {
  const [log] = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.id, logId))
    .limit(1);

  if (!log) {
    return { success: false, error: "Email log not found" };
  }

  if (log.category === 'chat_digest' || log.category === 'chat_digest_attempt') {
    const originalId = log.category === 'chat_digest' ? log.id : log.retryOfId;
    if (!originalId) return { success: false, error: 'Original chat intent missing; Local Cooks review required.' };
    const { dispatchChatDigests } = await import('./chat-notices');
    await dispatchChatDigests(1, 20000, originalId);
    const [original] = await db.select().from(emailLogs).where(eq(emailLogs.id, originalId)).limit(1);
    return original?.status === 'sent' ? { success: true, message: 'Original unread digest acknowledged; inbox unverified.' }
      : original?.status === 'suppressed' ? { success: true, message: 'Read or obsolete conversation suppressed; no email sent.' }
      : { success: false, error: 'Unread digest remains future, in backoff, concurrently claimed or unaccepted.' };
  }

  if (log.category === 'advance_reminder' || log.category === 'advance_reminder_attempt') {
    const originalId = log.category === 'advance_reminder' ? log.id : log.retryOfId;
    if (!originalId) return { success: false, error: 'Original scheduled action missing; Local Cooks review required.' };
    const { dispatchAdvanceReminders } = await import('./advance-reminders');
    await dispatchAdvanceReminders({ onlyLogId: originalId, limit: 1 });
    const [original] = await db.select().from(emailLogs).where(eq(emailLogs.id, originalId)).limit(1);
    if (original?.status === 'suppressed') return { success: true, message: 'Obsolete action suppressed; no email sent.' };
    if (original?.status === 'sent') return { success: true, message: 'Original channel acknowledgment recorded; inbox receipt is not confirmed.' };
    return { success: false, error: 'Action remains pending: it may be future, in backoff, policy pending, claimed by another worker or unaccepted. Review current source and next attempt.' };
  }

  if (log.category === 'lifecycle_outcome' || log.category === 'lifecycle_outcome_attempt') {
    const originalId = log.category === 'lifecycle_outcome' ? log.id : log.retryOfId;
    if (!originalId) return { success: false, error: 'Original outcome intent missing; Local Cooks must review this record' };
    const { deliverOutcomeEmails } = await import('./outcome-delivery');
    await deliverOutcomeEmails(1, 20_000, originalId);
    const [original] = await db.select().from(emailLogs).where(eq(emailLogs.id, originalId)).limit(1);
    return original?.status === 'sent' ? { success: true } : { success: false, error: 'Original outcome remains pending; check delivery recovery and retry.' };
  }

  const ledger = /^(booking|tour)-event:(\d+):(.+)$/.exec(log.trackingId || '');
  if (ledger) {
    const { bookingLifecycleEvents, tourDeliveryEvents } = await import('@shared/schema');
    const table = ledger[1] === 'booking' ? bookingLifecycleEvents : tourDeliveryEvents;
    const eventId = Number(ledger[2]);
    const [event] = await db.select().from(table).where(eq(table.id, eventId)).limit(1);
    if (!event) return { success: false, error: 'Original delivery event missing; review required' };
    if (event.leaseUntil && event.leaseUntil > new Date()) return { success: false, error: 'Original event is being delivered; retry after its lease expires' };
    const keys = 'deliveredEmailKeys' in event ? event.deliveredEmailKeys : event.deliveredKeys;
    if ((keys as string[]).includes(ledger[3])) return { success: true };
    if (event.completedAt) return { success: false, error: 'Completed event has no acknowledgment for this channel; review required' };
    await db.update(table).set({ nextAttemptAt: new Date() }).where(and(eq(table.id, eventId),
      sql`(${table.leaseUntil} IS NULL OR ${table.leaseUntil} <= CURRENT_TIMESTAMP)`));
    if (ledger[1] === 'booking') {
      const { deliverBookingLifecycleEvents } = await import('./booking-lifecycle-delivery');
      await deliverBookingLifecycleEvents(1, 20_000, undefined, eventId, true);
    } else {
      const { deliverTourEvents } = await import('./tour-delivery-service');
      await deliverTourEvents(undefined, 1, 20_000, eventId, true);
    }
    const [reconciled] = await db.select().from(table).where(eq(table.id, eventId)).limit(1);
    const acknowledged = reconciled && ('deliveredEmailKeys' in reconciled ? reconciled.deliveredEmailKeys : reconciled.deliveredKeys) as string[] | undefined;
    return acknowledged?.includes(ledger[3]) ? { success: true } : { success: false, error: 'Original channel remains pending; an earlier event, concurrent worker or delivery failure may require recovery.' };
  }
  if (['damage_claim', 'overstay', 'refund', 'checkin', 'cancellation', 'booking', 'viewing', 'storage'].includes(log.category))
    return { success: false, error: 'This legacy action email has no durable intent to reconcile. Review current reservation/claim state and contact the recipient through the existing support flow.' };

  if (!canRetryEmailLog(log.status, log.htmlBody, log.textBody)) {
    if (log.status !== "failed") {
      return { success: false, error: "Only failed emails can be retried" };
    }
    return {
      success: false,
      error: "Original email content was not stored, so this send cannot be retried",
    };
  }

  return db.transaction(async tx => {
    const [current] = await tx.select().from(emailLogs).where(eq(emailLogs.id, logId)).limit(1).for('update');
    if (!current) return { success: false, error: 'Email log not found' };
    if (current.status === 'sent') return { success: true };
    const trackingId = current.trackingId || `email-log:${current.id}`;
    const [accepted] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, trackingId),
      eq(emailLogs.recipientEmail, current.recipientEmail), eq(emailLogs.status, 'sent'))).limit(1);
    const { sendEmail } = await import('../email');
    const sent = !!accepted || await sendEmail({ to: current.recipientEmail, subject: current.subject,
      text: current.textBody || undefined, html: current.htmlBody || undefined },
      { trackingId, emailType: current.category, retryOfId: current.id, durableDelivery: true });
    await tx.update(emailLogs).set({ retryCount: current.retryCount + 1, retriedAt: new Date(),
      ...(sent ? { status: 'sent', errorMessage: null } : {}) }).where(eq(emailLogs.id, logId));
    return sent ? { success: true } : { success: false, error: 'Retry failed; original log remains retryable.' };
  });
}
