import { db } from "../db";
import { applications, emailLogs, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
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

export async function retryFailedEmail(logId: number): Promise<{ success: boolean; error?: string }> {
  const [log] = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.id, logId))
    .limit(1);

  if (!log) {
    return { success: false, error: "Email log not found" };
  }

  if (!canRetryEmailLog(log.status, log.htmlBody, log.textBody)) {
    if (log.status !== "failed") {
      return { success: false, error: "Only failed emails can be retried" };
    }
    return {
      success: false,
      error: "Original email content was not stored, so this send cannot be retried",
    };
  }

  const { sendEmail } = await import("../email");
  const sent = await sendEmail(
    {
      to: log.recipientEmail,
      subject: log.subject,
      text: log.textBody || undefined,
      html: log.htmlBody || undefined,
    },
    {
      trackingId: `retry_${log.id}_${Date.now()}`,
      emailType: log.category,
      retryOfId: log.id,
    },
  );

  await db
    .update(emailLogs)
    .set({
      retryCount: (log.retryCount || 0) + 1,
      retriedAt: new Date(),
    })
    .where(eq(emailLogs.id, logId));

  if (!sent) {
    return {
      success: false,
      error: "Retry failed. A new failed entry was added to the log.",
    };
  }

  return { success: true };
}
