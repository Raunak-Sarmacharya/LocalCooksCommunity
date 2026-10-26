import { AUTH_EXPIRY_HOURS } from './services/auth-expiry-service';
import { resolveResponseDeadline } from '@shared/booking-response-deadline';
export { getBookingResponseDeadline } from './services/booking-response-deadline';
import { prepareEmailHtml } from "./email-theme";
import { getShopLoginUrl, getVendorOnboardingUrl } from './shop-urls';
import { logger } from "./logger.js";
import { escapeHtml } from './security';
import { isE2eOutboundSuppressed } from "./e2e-outbound-guard.js";
import { stripCountryCode } from "./phone-utils";
import nodemailer from 'nodemailer';
import { isPlatformEmailRecipientBlocked, isReservedTestRecipient } from './email-recipient-policy';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { tEmail } from "./i18n/outbound";
import { addHour, calendarDateForBookingTime, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { matchingLocalInstants } from '@shared/booking-dst';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourDate, formatTourClock, formatTourSlotRange, formatTourWhen } from '@shared/tour-time';
import { publicTourCancellationReason } from '@shared/tour-outcome';
import { canChefRequestReschedule, canManagerProposeReschedule } from '@shared/tour-reschedule';

// Dynamic import for timezone-utils to handle Vercel serverless path resolution
// Use a cached function that falls back to a local implementation if import fails

type CreateBookingDateTimeFn = (dateStr: string, timeStr: string, timezone?: string) => Date;

// Local fallback implementation that doesn't require the external module
function createBookingDateTimeFallback(dateStr: string, timeStr: string, timezone: string = 'America/St_Johns'): Date {
  const instant = matchingLocalInstants(dateStr, timeStr, timezone)[0];
  if (instant === undefined) throw new Error('Local booking time does not exist');
  return new Date(instant);
}

// Cache for the loaded function
let createBookingDateTimeImpl: CreateBookingDateTimeFn = createBookingDateTimeFallback;
let loadAttempted = false;

// Eagerly try to load the timezone-utils module (runs once at module load)
(async () => {
  if (loadAttempted) return;
  loadAttempted = true;

  try {
    // Get the directory of the current file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try multiple possible paths for timezone-utils
    // In Vercel production, files are at /var/task/server/email.js and /var/task/shared/timezone-utils.js
    const possiblePaths = [
      join(__dirname, '../shared/timezone-utils.js'),  // From server/email.js to shared/timezone-utils.js (CORRECT PATH for dist)
      join(__dirname, '../shared/timezone-utils'),     // Without .js extension
      join(__dirname, '../../shared/timezone-utils.js'),  // Alternative path
      '/var/task/shared/timezone-utils.js',           // Absolute path for Vercel dist structure
      '/var/task/api/shared/timezone-utils.js',       // Absolute path for Vercel api structure
    ];

    for (const filePath of possiblePaths) {
      try {
        const timezoneUtilsUrl = pathToFileURL(filePath).href;
        const timezoneUtils = await import(timezoneUtilsUrl);

        if (timezoneUtils && timezoneUtils.createBookingDateTime) {
          createBookingDateTimeImpl = timezoneUtils.createBookingDateTime;
          logger.info(`Successfully loaded timezone-utils from: ${timezoneUtilsUrl}`);
          return;
        }
      } catch {
        // Continue to next path
        continue;
      }
    }

    logger.warn('Failed to load timezone-utils from any path, using fallback implementation');
  } catch (error) {
    logger.error('Error during timezone-utils initialization:', error);
  }
})();

// Synchronous wrapper function that uses the cached implementation
function createBookingDateTime(dateStr: string, timeStr: string, timezone: string = 'America/St_Johns'): Date {
  return createBookingDateTimeImpl(dateStr, timeStr, timezone);
}

// Email configuration
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  }
}

// Email content
interface EmailContent {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

// Add email tracking to prevent duplicates
const recentEmails = new Map<string, number>();
const DUPLICATE_PREVENTION_WINDOW = 30000; // 30 seconds

import { assertWorkerTime, inRecurringWorker, isWorkerBudgetError, deliveryReserve, smtpAttemptMs } from './services/worker-context';
import { boundedSmtpSend, SmtpDeliveryError, smtpFailureKind } from './services/bounded-smtp';

// Create a transporter with enhanced configuration for Vercel serverless
const createTransporter = (config: EmailConfig, durableDelivery = false) => {
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
    // Enhanced configuration for Vercel serverless functions
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      minVersion: 'TLSv1.2' // Use modern TLS (SSLv3 is deprecated and rejected by most servers)
    },
    // Reduced timeouts for serverless functions (max 10s execution time)
    connectionTimeout: durableDelivery ? 8000 : isProduction ? 15000 : 60000,
    greetingTimeout: durableDelivery ? 8000 : isProduction ? 10000 : 30000,
    socketTimeout: durableDelivery ? 8000 : isProduction ? 15000 : 60000,
    // Let nodemailer auto-negotiate the best auth method
    // authMethod: 'PLAIN', // Removed - let server choose (Hostinger prefers LOGIN)
    // Enable debug for troubleshooting in development only
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development',
    // Disable pooling for serverless - each request should create fresh connection
    pool: false,
  } as any);
};

// Get email configuration from environment variables
const getEmailConfig = (): EmailConfig => {
  // Force direct SMTP if environment variable is set (bypasses MailChannels)
  const forceDirectSMTP = process.env.FORCE_DIRECT_SMTP === 'true';
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  if (forceDirectSMTP && isProduction) {
    logger.info('🔄 Forcing direct SMTP connection (bypassing MailChannels)');
  }

  return {
    host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || '',
    },
  };
};

async function persistEmailLog(params: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  status: "sent" | "failed" | "skipped_duplicate" | "skipped_policy";
  errorMessage?: string;
  trackingId?: string;
  smtpMessageId?: string;
  emailType?: string;
  fromAddress?: string;
  retryOfId?: number;
}): Promise<void> {
  try {
    const { logOutgoingEmail } = await import("./services/email-log-service");
    await logOutgoingEmail(params);
  } catch (logError) {
    logger.error("Failed to persist email log:", logError);
  }
}

// Enhanced send email function with Vercel serverless optimizations
export const sendEmail = async (content: EmailContent, options?: { trackingId?: string; emailType?: string; retryOfId?: number; durableDelivery?: boolean; reportDeliveryFailure?: boolean }): Promise<boolean> => {
  content = bookingDeliveryEmail(content, options?.emailType);
  const startTime = Date.now();
  let transporter: any = null;
  let smtpStarted = false, failureLogged = false, messageId: string | undefined;

  try {
    if (isPlatformEmailRecipientBlocked(content.to)) {
      await persistEmailLog({ ...content, ...options, status: 'skipped_policy',
        errorMessage: 'The support contact inbox cannot receive platform-generated email.' });
      return false;
    }
    if (isReservedTestRecipient(content.to)) {
      await persistEmailLog({ ...content, ...options, status: 'skipped_policy',
        errorMessage: 'Reserved test domain (RFC 2606): never handed to SMTP.' });
      return false;
    }
    if (isE2eOutboundSuppressed()) {
      logger.info("[e2e-outbound-guard] skipped email send (harness active)", {
        to: content.to.replace(/(.{2}).*(@.*)/, "$1***$2"),
        subject: content.subject?.slice(0, 80),
        trackingId: options?.trackingId,
      });
      await persistEmailLog({
        to: content.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
        status: "skipped_duplicate",
        errorMessage: "e2e_harness_suppressed",
        trackingId: options?.trackingId,
        emailType: options?.emailType,
        fromAddress: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        retryOfId: options?.retryOfId,
      });
      return false; // Suppression is not provider acceptance.
    }

    // Check for duplicate emails if trackingId is provided
    if (options?.trackingId && !options.durableDelivery) {
      const lastSent = recentEmails.get(`${options.trackingId}:${content.to.trim().toLowerCase()}`);
      const now = Date.now();

      if (lastSent && (now - lastSent) < DUPLICATE_PREVENTION_WINDOW) {
        logger.info(`Preventing duplicate email for tracking ID: ${options.trackingId} (sent ${now - lastSent}ms ago)`);
        await persistEmailLog({
          to: content.to,
          subject: content.subject,
          text: content.text,
          html: content.html,
          status: "skipped_duplicate",
          errorMessage: "Duplicate send prevented",
          trackingId: options.trackingId,
          emailType: options.emailType,
          fromAddress: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          retryOfId: options.retryOfId,
        });
        return true; // Return true to avoid breaking existing code
      }

      // Cleanup old entries every 10 minutes to prevent memory leaks
      if (recentEmails.size > 100) {
        const cutoffTime = now - DUPLICATE_PREVENTION_WINDOW;
        recentEmails.forEach((timestamp, id) => {
          if (timestamp < cutoffTime) recentEmails.delete(id);
        });
      }
    }

    // Check if email configuration is available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.error('Email configuration is missing. Please set EMAIL_USER and EMAIL_PASS environment variables.');
      await persistEmailLog({
        to: content.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
        status: "failed",
        errorMessage: "Email configuration is missing",
        trackingId: options?.trackingId,
        emailType: options?.emailType,
        fromAddress: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        retryOfId: options?.retryOfId,
      });
      return false;
    }

    const config = getEmailConfig();
    const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

    logger.info('📧 COMPREHENSIVE EMAIL SEND INITIATED:', {
      to: content.to,
      subject: content.subject,
      emailType: content.subject.includes('Application') ? '🎯 APPLICATION_EMAIL' : '📝 SYSTEM_EMAIL',
      trackingId: options?.trackingId || `auto_${Date.now()}`,
      hasText: !!content.text,
      hasHtml: !!content.html,
      timestamp: new Date().toISOString(),
      config: {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.auth.user ? config.auth.user.replace(/(.{3}).*@/, '$1***@') : 'not set',
        domain: getDomainFromEmail(config.auth.user),
        organization: getOrganizationName(),
        hasEmailFrom: !!process.env.EMAIL_FROM,
        isProduction,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
        vercelRegion: process.env.VERCEL_REGION || 'unknown'
      }
    });

    transporter = createTransporter(config, options?.durableDelivery);

    // Enhanced from address with proper formatting using Vercel environment variables
    const fromName = getOrganizationName();
    const fromEmail = process.env.EMAIL_FROM || `${fromName} <${config.auth.user}>`;

    // Verify SMTP connection (skip in production for faster execution)
    if (!isProduction && !options?.durableDelivery && !inRecurringWorker()) {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('SMTP verification timeout'));
          }, 10000); // 10s timeout

          transporter.verify((error: any, success: any) => {
            clearTimeout(timeout);
            if (error) {
              logger.error('SMTP connection verification failed:', error);
              reject(error);
            } else {
              logger.info('SMTP connection verified successfully');
              resolve(success);
            }
          });
        });
      } catch (verifyError) {
        logger.error('Failed to verify SMTP connection:', verifyError);
        // Continue anyway, as some providers might not support verification
      }
    }

    // Get domain and other configuration from Vercel environment variables
    const domain = getDomainFromEmail(config.auth.user);
    const unsubscribeEmail = getUnsubscribeEmail();
    const organizationName = getOrganizationName();
    messageId = options?.durableDelivery && options.trackingId
      ? `<${createHash('sha256').update(`${options.trackingId}:${content.to.trim().toLowerCase()}`).digest('hex')}@${domain}>`
      : `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`;

    // Enhanced email options with better headers for MailChannels compatibility
    const mailOptions: any = {
      from: fromEmail,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      // Add attachments if provided (e.g., .ics calendar files)
      attachments: content.attachments || [],
      // Keep transport headers minimal. The authenticated SMTP relay owns DKIM
      // and Return-Path; declaring those manually can create conflicting
      // identities after the relay rewrites the envelope.
      headers: {
        'Organization': organizationName,
        'X-Mailer': 'Local Cooks Community',
        // Merge any additional headers from content
        ...(content.headers || {})
      },
      replyTo: config.auth.user,
      // Proper encoding settings for DKIM
      encoding: 'utf8' as const,
      // Enhanced delivery options for Hostinger SMTP
      envelope: {
        from: config.auth.user,
        to: content.to
      },
      // DKIM-compatible message ID with proper domain
      messageId,
      date: new Date(),
      // DKIM signing is handled by Hostinger SMTP server
    };

    // Send the email with enhanced timeout protection and retry logic (critical for serverless)
    let info;
    let attempts = 0;
    const maxAttempts = options?.durableDelivery || inRecurringWorker() ? 1 : 2;

    while (attempts < maxAttempts) {
      attempts++;
      logger.info(`📧 Attempt ${attempts}/${maxAttempts} sending email to ${content.to}`);

      try {
        if (options?.durableDelivery || inRecurringWorker()) {
          assertWorkerTime(deliveryReserve());
          smtpStarted = true;
          info = await boundedSmtpSend(transporter, mailOptions, config, smtpAttemptMs);
          break;
        }
        const emailPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Email sending timeout')), options?.durableDelivery ? 8000 : 25000);
        });

        info = await Promise.race([emailPromise, timeoutPromise]);

        // If successful, break out of retry loop
        logger.info(`✅ Email sent successfully on attempt ${attempts}`);
        break;
      } catch (attemptError) {
        logger.warn(`⚠️ Attempt ${attempts} failed for ${content.to}:`, attemptError instanceof Error ? attemptError.message : String(attemptError));

        if (attempts >= maxAttempts) {
          throw attemptError; // Re-throw on final attempt
        }

        // Wait briefly before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }

    const executionTime = Date.now() - startTime;
    logger.info('Email sent successfully:', {
      messageId: (info as any).messageId,
      accepted: (info as any).accepted,
      rejected: (info as any).rejected,
      response: (info as any).response,
      domain: domain,
      organization: organizationName,
      fromEmail: fromEmail,
      executionTime: `${executionTime}ms`,
      isProduction
    });

    // Close the transporter connection (important for serverless)
    if (transporter && typeof transporter.close === 'function') {
      transporter.close();
    }

    const accepted = Array.isArray((info as any)?.accepted) ? (info as any).accepted as string[] : [];
    const rejected = Array.isArray((info as any)?.rejected) ? (info as any).rejected as string[] : [];
    const { parseRecipients } = await import('./services/email-log-service');
    const intended = parseRecipients(content.to);
    const acceptedRecipients = accepted.map(value => String(value).toLowerCase());
    const smtpRejected = intended.length === 0 || intended.some(value => !acceptedRecipients.includes(value));

    await persistEmailLog({
      to: intended.filter(value => acceptedRecipients.includes(value)).join(','),
      subject: content.subject,
      text: content.text,
      html: content.html,
      status: "sent",
      trackingId: options?.trackingId,
      smtpMessageId: (info as any)?.messageId,
      emailType: options?.emailType,
      fromAddress: fromEmail,
      retryOfId: options?.retryOfId,
    });

    const rejectedRecipients = rejected.map(String).map(value => value.toLowerCase());
    const acceptanceUnknown = smtpRejected && intended.some(value => !acceptedRecipients.includes(value) && !rejectedRecipients.includes(value));
    if (smtpRejected) { await persistEmailLog({ to: intended.filter(value => !acceptedRecipients.includes(value)).join(','),
      subject: content.subject, text: content.text, html: content.html, status: 'failed',
      errorMessage: acceptanceUnknown ? 'SMTP acceptance is uncertain; reconcile before resending' : 'SMTP rejected this recipient', trackingId: options?.trackingId,
      smtpMessageId: messageId, emailType: options?.emailType, fromAddress: fromEmail, retryOfId: options?.retryOfId }); failureLogged = true; }
    if (!smtpRejected && options?.trackingId && !options.durableDelivery) recentEmails.set(`${options.trackingId}:${content.to.trim().toLowerCase()}`, Date.now());

    if (!smtpRejected && (info as any)?.response) {
      logger.info(
        `📬 SMTP accepted (first hop only): ${String((info as any).response).slice(0, 120)}`
      );
    }

    if (smtpRejected && options?.reportDeliveryFailure) throw new SmtpDeliveryError(
      acceptanceUnknown ? 'acceptance_unknown' : 'smtp_rejected',
      acceptanceUnknown ? undefined : { responseCode: (info as any)?.rejectedErrors?.[0]?.responseCode, code: 'EENVELOPE', command: 'RCPT TO' });

    return !smtpRejected;
  } catch (error) {
    if (isWorkerBudgetError(error)) throw error;
    const executionTime = Date.now() - startTime;
    logger.error('Error sending email:', {
      error: error instanceof Error ? error.message : error,
      executionTime: `${executionTime}ms`,
      to: content.to,
      subject: content.subject,
      trackingId: options?.trackingId,
      isProduction: process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
    });

    if (error instanceof Error) {
      logger.error('Error details:', error.message);
      if ('code' in error) {
        logger.error('Error code:', (error as any).code);
      }
      if ('responseCode' in error) {
        logger.error('SMTP Response code:', (error as any).responseCode);
      }
    }

    // Close the transporter connection on error (important for serverless)
    if (transporter && typeof transporter.close === 'function') {
      try {
        transporter.close();
      } catch (closeError) {
        logger.error('Error closing transporter:', closeError);
      }
    }

    if (!failureLogged) await persistEmailLog({
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      trackingId: options?.trackingId,
      smtpMessageId: messageId,
      emailType: options?.emailType,
      fromAddress: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      retryOfId: options?.retryOfId,
    });

    if (options?.reportDeliveryFailure && smtpStarted) throw new SmtpDeliveryError(smtpFailureKind(error),
      { responseCode: (error as any)?.responseCode, code: (error as any)?.code, command: (error as any)?.command });
    return false;
  }
};

// Helper function to extract domain from email or use configured domain
const getDomainFromEmail = (email: string): string => {
  // First check if EMAIL_DOMAIN is explicitly set
  if (process.env.EMAIL_DOMAIN) {
    return process.env.EMAIL_DOMAIN;
  }

  // Extract from EMAIL_FROM if available
  if (process.env.EMAIL_FROM) {
    const match = process.env.EMAIL_FROM.match(/<([^>]+)>/);
    if (match) {
      const emailPart = match[1];
      const domainMatch = emailPart.match(/@(.+)$/);
      if (domainMatch) {
        return domainMatch[1];
      }
    }
  }

  // Extract from EMAIL_USER as fallback
  const match = email.match(/@(.+)$/);
  if (match) {
    return match[1];
  }

  // Default fallback
  return 'localcooks.community';
};

// Get organization name from environment or default
const getOrganizationName = (): string => {
  return process.env.EMAIL_ORGANIZATION || 'Local Cooks Community';
};

// Get unsubscribe email from environment or generate from domain
const getUnsubscribeEmail = (): string => {
  const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
  return `unsubscribe@${domain}`;
};

// Support inbox is the same for dev and prod; never derive it from the sending account.
const getSupportEmail = (): string => process.env.SUPPORT_EMAIL || 'support@localcooks.ca';

// Helper function to detect email provider from email address
const detectEmailProvider = (email: string): 'google' | 'outlook' | 'yahoo' | 'apple' | 'generic' => {
  const emailLower = email.toLowerCase();
  const domain = emailLower.split('@')[1] || '';

  // Google/Gmail
  if (domain === 'gmail.com' || domain === 'googlemail.com' || domain.endsWith('.google.com')) {
    return 'google';
  }

  // Microsoft Outlook/Hotmail
  if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'msn.com' || domain.endsWith('.outlook.com')) {
    return 'outlook';
  }

  // Yahoo
  if (domain === 'yahoo.com' || domain === 'yahoo.co.uk' || domain === 'yahoo.ca' || domain.endsWith('.yahoo.com')) {
    return 'yahoo';
  }

  // Apple/iCloud
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com' || domain.endsWith('.icloud.com')) {
    return 'apple';
  }

  // Default to generic (will show multiple options)
  return 'generic';
};

// Helper function to format dates for calendar URLs (YYYYMMDDTHHMMSSZ format in UTC)
const formatDateForCalendar = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

// Helper function to escape text for iCalendar format
const escapeIcalText = (text: string): string => {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
};

// Helper function to generate a consistent event UID for synchronization
// Based on booking details so chef and manager get the same event
const generateEventUid = (
  bookingDate: string | Date,
  startTime: string,
  location: string
): string => {
  // Create a deterministic UID based on booking details
  const dateStr = bookingDate instanceof Date
    ? bookingDate.toISOString().split('T')[0]
    : bookingDate.split('T')[0];
  // Use date + time + location hash for consistent UID
  const hashInput = `${dateStr}-${startTime}-${location}`;
  // Simple hash function for consistent UID
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure positive hash and format as UID
  const positiveHash = Math.abs(hash).toString(36);
  return `${dateStr.replace(/-/g, '')}T${startTime.replace(/:/g, '')}-${positiveHash}@localcooks.com`;
};

// Helper function to generate .ics file content (iCalendar format - RFC 5545 compliant)
// Uses the same UID for synchronization across all attendees

// Helper function to generate Google Calendar URL
const generateGoogleCalendarUrl = (
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  location: string,
  description: string
): string => {
  const startDateStr = formatDateForCalendar(startDateTime);
  const endDateStr = formatDateForCalendar(endDateTime);
  const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  
  const params = new URLSearchParams({
    text: title,
    dates: `${startDateStr}/${endDateStr}`,
    details: description,
    location: location,
    trp: 'true'
  });
  
  return `${baseUrl}&${params.toString()}`;
};

const generateIcsFile = (
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  location: string,
  description: string,
  organizerEmail?: string,
  attendeeEmails?: string[],
  eventUid?: string, // Optional: Use same UID for synchronization
  revision?: { sequence: number; modifiedAt?: Date; cancelled?: boolean }
): string => {
  // Format dates in UTC (Z suffix) for RFC 5545 compliance
  const startDateStr = formatDateForCalendar(startDateTime);
  const endDateStr = formatDateForCalendar(endDateTime);
  const now = formatDateForCalendar(new Date());

  // Use provided UID or generate a unique one
  // For synchronization, use the same UID for chef and manager
  const uid = eventUid || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@localcooks.com`;

  // RFC 5545 compliant iCalendar format
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Local Cooks Community//Kitchen Booking System//EN',
    'CALSCALE:GREGORIAN',
    revision?.cancelled ? 'METHOD:CANCEL' : 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${revision?.modifiedAt ? formatDateForCalendar(revision.modifiedAt) : now}`,
    `DTSTART:${startDateStr}`, // Start time in UTC
    `DTEND:${endDateStr}`, // End time in UTC
    `SUMMARY:${escapeIcalText(title)}`,
    `DESCRIPTION:${escapeIcalText(description)}`,
    `LOCATION:${escapeIcalText(location)}`,
    revision?.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    `SEQUENCE:${revision?.sequence ?? 0}`,
    revision?.cancelled ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE',
  ];

  // Add organizer (required for proper calendar integration)
  if (organizerEmail) {
    // CN (Common Name) should be a readable name, not email
    lines.push(`ORGANIZER;CN=Local Cooks Community:mailto:${organizerEmail}`);
  } else {
    // Fallback to support email if no organizer provided
    const supportEmail = getSupportEmail();
    lines.push(`ORGANIZER;CN=Local Cooks Community:mailto:${supportEmail}`);
  }

  // Add attendees (both chef and manager should be included)
  if (attendeeEmails && attendeeEmails.length > 0) {
    attendeeEmails.forEach(email => {
      if (email && email.includes('@')) {
        // RSVP=TRUE means attendee should respond
        // CUTYPE=INDIVIDUAL indicates this is an individual person
        lines.push(`ATTENDEE;CN=${email.split('@')[0]};RSVP=TRUE;CUTYPE=INDIVIDUAL:mailto:${email}`);
      }
    });
  }

  // Add reminder alarms (15 minutes before and 1 day before)
  if (!revision?.cancelled) lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M', // 15 minutes before
    'DESCRIPTION:Reminder: Kitchen booking in 15 minutes',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:EMAIL',
    'TRIGGER:-P1D', // 1 day before
    'DESCRIPTION:Reminder: Kitchen booking tomorrow',
    'END:VALARM'
  );
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 requires CRLF line endings
  return lines.join('\r\n');
};

// Helper function to generate calendar invite URL based on email provider
const generateCalendarUrl = (
  email: string,
  title: string,
  bookingDate: string | Date,
  startTime: string,
  endTime: string,
  location: string,
  description: string,
  timezone: string = 'America/St_Johns',
  operatingWindowStartTime?: string,
): string => {
  try {
    // Convert bookingDate to string format (YYYY-MM-DD) if it's a Date object
    let bookingDateStr: string;
    if (bookingDate instanceof Date) {
      bookingDateStr = bookingDate.toISOString().split('T')[0];
    } else if (typeof bookingDate === 'string') {
      // Extract date part if it's an ISO string
      bookingDateStr = bookingDate.split('T')[0];
    } else {
      bookingDateStr = String(bookingDate);
    }

    // Create start and end Date objects in the specified timezone
    const startDateTime = createBookingDateTime(calendarDateForBookingTime(bookingDateStr, startTime, operatingWindowStartTime), startTime, timezone);
    const endDateTime = createBookingDateTime(calendarDateForBookingTime(bookingDateStr, endTime, operatingWindowStartTime, startTime), endTime, timezone);

    const startDateStr = formatDateForCalendar(startDateTime);
    const endDateStr = formatDateForCalendar(endDateTime);

    // Detect email provider
    const provider = detectEmailProvider(email);

    // Generate URL based on provider
    switch (provider) {
      case 'google':
        // Google Calendar - Use proper URL format per Google Calendar API documentation
        // This will open Google Calendar with the event pre-filled and ready to save
        // Format: dates should be YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ (UTC)
        // Reference: https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#link-user
        const googleParams = new URLSearchParams({
          action: 'TEMPLATE',
          text: title,
          dates: `${startDateStr}/${endDateStr}`, // ISO 8601 format in UTC
          details: description,
          location: location,
          sf: 'true', // Show form
          output: 'xml', // Output format
        });
        return `https://calendar.google.com/calendar/render?${googleParams.toString()}`;

      case 'outlook':
        // Outlook Calendar
        const outlookParams = new URLSearchParams({
          subject: title,
          startdt: startDateTime.toISOString(),
          enddt: endDateTime.toISOString(),
          body: description,
          location: location,
        });
        return `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams.toString()}`;

      case 'yahoo':
        // Yahoo Calendar
        const yahooParams = new URLSearchParams({
          v: '60', // version
          view: 'd',
          type: '20',
          title: title,
          st: startDateStr.replace(/[-:]/g, '').replace('T', '').replace('Z', ''),
          dur: String(Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000)), // duration in minutes
          desc: description,
          in_loc: location,
        });
        return `https://calendar.yahoo.com/?${yahooParams.toString()}`;

      case 'apple':
        // Apple Calendar - Use Google Calendar URL as fallback
        // Apple Calendar can open Google Calendar links, and it's more reliable in emails
        // Alternatively, we could generate an .ics file, but URL links work better in emails
        const appleParams = new URLSearchParams({
          action: 'TEMPLATE',
          text: title,
          dates: `${startDateStr}/${endDateStr}`,
          details: description,
          location: location,
        });
        return `https://calendar.google.com/calendar/render?${appleParams.toString()}`;

      case 'generic':
      default:
        // For generic/unknown providers, default to Google Calendar (most common)
        const genericParams = new URLSearchParams({
          action: 'TEMPLATE',
          text: title,
          dates: `${startDateStr}/${endDateStr}`,
          details: description,
          location: location,
        });
        return `https://calendar.google.com/calendar/render?${genericParams.toString()}`;
    }
  } catch (error) {
    logger.error('Error generating calendar URL:', error);
    // Return a fallback Google Calendar URL if there's an error
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&location=${encodeURIComponent(location)}`;
  }
};

type BookingCalendarInput = {
  days?: EmailBookingDay[];
  scheduleRevision?: number;
  bookingId?: number;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  selectedSlots?: unknown;
};

function bookingCalendarParts(
  booking: BookingCalendarInput, recipient: string, title: string, location: string,
  description: string, timezone: string,
): { ics: string; linksHtml: string; linksText: string; timeLabel: string; links: { label: string; url: string }[] } {
  if (booking.days?.length) {
    const files = booking.days.map(day => {
      const start = createBookingDateTime(calendarDateForBookingTime(day.date, day.startTime, day.operatingWindowStartTime), day.startTime, timezone);
      const end = createBookingDateTime(calendarDateForBookingTime(day.date, day.endTime, day.operatingWindowStartTime, day.startTime), day.endTime, timezone);
      return generateIcsFile(title, start, end, location, description, getSupportEmail(), [recipient], `booking-${booking.bookingId}-visit-${day.id}@localcooks.ca`,
        { sequence: (booking.scheduleRevision || 1) + (day.cancelled ? 1 : 0), cancelled: day.cancelled });
    });
    const links = booking.days.filter(day => !day.cancelled).map(day => ({ label: `${day.date} · ${emailClock(day.startTime)}–${emailClock(day.endTime)}`,
      url: generateCalendarUrl('calendar@gmail.com', title, day.date, day.startTime, day.endTime, location, description, timezone, day.operatingWindowStartTime || undefined) }));
    return { ics: [files[0].slice(0, files[0].indexOf('BEGIN:VEVENT')).replace('METHOD:CANCEL', 'METHOD:PUBLISH'), ...files.map(file => file.slice(file.indexOf('BEGIN:VEVENT'), file.indexOf('END:VEVENT') + 'END:VEVENT'.length)), 'END:VCALENDAR'].join('\r\n'),
      links, linksHtml: links.map(link => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join(''), linksText: links.map(link => `${link.label}: ${link.url}`).join('\n'), timeLabel: '' };
  }
  const operatingDate = booking.bookingDate instanceof Date
    ? booking.bookingDate.toISOString().slice(0, 10) : booking.bookingDate.slice(0, 10);
  const windowStart = booking.operatingWindowStartTime || booking.startTime;
  const selectedSlots = Array.isArray(booking.selectedSlots) ? booking.selectedSlots.map(slot =>
    typeof slot === 'string' ? { startTime: slot, endTime: addHour(slot) } : slot) : [];
  const hasValidSlots = selectedSlots.length > 0
    && selectedSlots.every(slot => slot && typeof slot.startTime === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)
      && slot.endTime === addHour(slot.startTime));
  const ordered = hasValidSlots
    ? sortTimesInOperatingWindow(selectedSlots.map(slot => slot.startTime), windowStart)
      .map(startTime => ({ startTime, endTime: addHour(startTime) }))
    : [{ startTime: booking.startTime, endTime: booking.endTime }];
  const groups: Array<{ startTime: string; endTime: string }> = [];
  for (const slot of ordered) {
    const last = groups.at(-1);
    if (last && last.endTime === slot.startTime) last.endTime = slot.endTime;
    else groups.push({ ...slot });
  }
  const timeLabel = groups.map(group => `${emailClock(group.startTime)}–${emailClock(group.endTime)}`).join(', ');
  const exactDescription = description.replace(/Time: [^\n]*/, `Time: ${timeLabel}`);
  const uid = booking.bookingId ? `booking-${booking.bookingId}@localcooks.com` : generateEventUid(booking.bookingDate, booking.startTime, location);
  const icsFiles = groups.map((group, index) => {
    const start = createBookingDateTime(calendarDateForBookingTime(operatingDate, group.startTime,
      booking.operatingWindowStartTime), group.startTime, timezone);
    const end = createBookingDateTime(calendarDateForBookingTime(operatingDate, group.endTime,
      booking.operatingWindowStartTime, group.startTime), group.endTime, timezone);
    return generateIcsFile(title, start, end, location, exactDescription, getSupportEmail(), [recipient],
      groups.length === 1 ? uid : `${uid}-${index + 1}`);
  });
  const ics = icsFiles.length === 1 ? icsFiles[0] : [
    icsFiles[0].slice(0, icsFiles[0].indexOf('BEGIN:VEVENT')),
    ...icsFiles.map(file => file.slice(file.indexOf('BEGIN:VEVENT'), file.indexOf('END:VEVENT') + 'END:VEVENT'.length)),
    'END:VCALENDAR',
  ].join('\r\n');
  const links = groups.map(group => ({
    label: `${emailClock(group.startTime)}–${emailClock(group.endTime)}`,
    url: generateCalendarUrl('calendar@gmail.com', title, booking.bookingDate, group.startTime, group.endTime,
      location, exactDescription, timezone, booking.operatingWindowStartTime || undefined),
  }));
  return {
    ics, links,
    linksHtml: links.map(link => `<a href="${link.url}" target="_blank" style="display:inline-block;margin:4px 8px 4px 0;color:#E10939;text-decoration:underline">Add ${link.label} to calendar</a>`).join(''),
    linksText: links.map(link => `Add ${link.label} to calendar: ${link.url}`).join('\n'),
    timeLabel,
  };
}

// Uniform email styles using brand colors and assets
const getUniformEmailStyles = () => `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lobster&display=swap');
  
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
    line-height: 1.6; 
    color: #475569; 
    margin: 0; 
    padding: 0; 
    background: #ffffff;
  }
  .email-container { 
    max-width: 640px;
    margin: 0 auto; 
    background: white; 
    border-radius: 12px; 
    overflow: hidden; 
    box-shadow: none;
  }
  .header { 
    background: #ffffff;
    color: #292524;
    padding: 16px 32px 24px;
    text-align: left;
  }
  .header-image {
    width: 200px;
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0;
  }
  .content { 
    padding: 40px 32px; 
  }
  .greeting {
    font-size: 24px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
  }
  .message {
    font-size: 16px;
    line-height: 1.6;
    color: #475569;
    margin: 0 0 24px 0;
  }
  .status-badge { 
    display: inline-block; 
    padding: 12px 20px; 
    background: linear-gradient(135deg, #fef7f7 0%, #fecaca 100%); 
    color: hsl(347, 91%, 51%); 
    border: 1px solid hsl(347, 91%, 70%);
    border-radius: 8px; 
    font-weight: 600; 
    margin: 16px 0; 
  }
  .status-badge.approved {
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    color: #16a34a;
    border-color: #bbf7d0;
  }
  .status-badge.rejected {
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    color: #dc2626;
    border-color: #fecaca;
  }
  .status-badge.cancelled {
    background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
    color: #64748b;
    border-color: #cbd5e1;
  }
  .cta-button { 
    display: inline-block; 
    padding: 14px 28px; 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white !important; 
    text-decoration: none; 
    border-radius: 8px; 
    font-weight: 600;
    margin: 24px 0;
    box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
    mso-hide: none;
    mso-text-raise: 0;
  }
  .info-box {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 20px;
    margin: 24px 0;
  }
  .credentials-table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
  }
  .credentials-table td {
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
  }
  .credentials-table td:first-child {
    font-weight: 600;
    color: hsl(347, 91%, 51%);
    background: #f8fafc;
  }
  .credentials-table code {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    color: #1e293b;
    font-weight: 600;
  }
  .footer {
    background: #ffffff;
    padding: 24px 32px; 
    text-align: left;
    border-top: 1px solid #e2e8f0;
  }
  .footer-text {
    font-size: 14px;
    color: #64748b;
    margin: 0 0 8px 0;
  }
  .footer-links {
    font-size: 13px;
    color: #94a3b8;
  }
  .footer-links a { 
    color: hsl(347, 91%, 51%); 
    text-decoration: none;
  }
  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);
    margin: 24px 0;
  }
  .warning-box {
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
  }
  .warning-text {
    font-size: 14px;
    color: #92400e;
    margin: 0;
  }
  a { color: hsl(347, 91%, 51%); text-decoration: underline; }
</style>`;

// Generate application status change email with spam-optimized content
export const generateStatusChangeEmail = (
  applicationData: {
    fullName: string;
    email: string;
    status: string;
  }
): EmailContent => {
  const firstName = applicationData.fullName.split(' ')[0];

  // Create professional, non-promotional subject line
  const getSubjectLine = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Application Approved - Local Cooks';
      case 'rejected':
        return 'Application Update - Local Cooks';
      case 'cancelled':
        return 'Application Status Update - Local Cooks';
      case 'under_review':
        return 'Application Under Review - Local Cooks';
      default:
        return 'Application Status Update - Local Cooks';
    }
  };

  const subject = getSubjectLine(applicationData.status);

  const getMessage = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Your application has been approved. You now have full access to the Local Cooks platform, including our food safety training program.';
      case 'rejected':
        return 'Thank you for your application. After careful review, we are unable to move forward at this time. We appreciate your interest in Local Cooks.';
      case 'cancelled':
        return 'Your application has been cancelled. You can submit a new application anytime when you&#8217;re ready.';
      case 'under_review':
        return 'Your application is currently under review by our team. We&#8217;ll notify you once the review is complete.';
      case 'pending':
        return 'Your application has been received and is pending review. We&#8217;ll be in touch with updates soon.';
      default:
        return 'Your application status has been updated. Please check your dashboard for more details.';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return `<span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>`;
      case 'rejected':
        return `<span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Not Approved</span>`;
      case 'cancelled':
        return `<span style="display: inline-block; padding: 4px 12px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Cancelled</span>`;
      case 'under_review':
        return `<span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>`;
      default:
        return `<span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Pending</span>`;
    }
  };

  const message = getMessage(applicationData.status);

  // Use uniform email template with proper styling
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">${message}</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        ${getStatusBadge(applicationData.status)}
      </div>
      ${applicationData.status === 'approved' ? `
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Your next step:</p>
      <p class="message" style="margin-bottom: 10px;">Complete your food safety training to unlock all features. From your dashboard you can:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Access all 22 food safety training videos</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Earn your Local Cooks certification and HACCP fundamentals</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Build customer trust with a verified status on your profile</td>
        </tr>
      </table>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getDashboardUrl()}?view=training" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Start Food Safety Training</a>
      </div>` : ''}${applicationData.status === 'rejected' ? `
      <div style="margin: 24px 0 0; text-align: center;"><a href="${getDashboardUrl()}?view=applications" class="cta-button">View Application</a></div>` : ''}${applicationData.status === 'cancelled' ? `
      <p class="message" style="margin-top: 24px; margin-bottom: 20px;">You can submit a new application anytime when you&#8217;re ready to join Local Cooks.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getWebsiteUrl()}/apply" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Submit New Application</a>
      </div>` : ''}
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const statusLabel = applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1).replace('_', ' ');
  const text = `
Hi ${firstName},

${getMessage(applicationData.status).replace(/&#8217;/g, "'")}

Status: ${statusLabel}

${applicationData.status === 'approved' ? `Your next step: Complete your food safety training to unlock all features.

• Access all 22 food safety training videos
• Earn your Local Cooks certification and HACCP fundamentals
• Build customer trust with a verified status

Start training: ${getDashboardUrl()}?view=training` : ''}${applicationData.status === 'rejected' ? `View your application: ${getDashboardUrl()}?view=applications` : ''}${applicationData.status === 'cancelled' ? `You can submit a new application anytime: ${getWebsiteUrl()}/apply` : ''}

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Generate vendor login credentials
export const generateVendorCredentials = (name: string, phone: string) => {
  // Clean phone number: remove all non-digits, and leading '1' (US/Canada country code)
  const cleanPhone = stripCountryCode(phone);

  const username = cleanPhone;
  // Use the name (shop name preferred) for the prefix
  const namePrefix = name.replace(/[^a-zA-Z]/g, '').toLowerCase().substring(0, 3) || 'usr';
  const phoneSuffix = cleanPhone.slice(-4) || '0000';
  const password = namePrefix + phoneSuffix;
  return { username, password };
};

// Generate full verification email with vendor credentials
export const generateFullVerificationEmail = (
  userData: {
    fullName: string;
    email: string;
    phone: string;
    shopName?: string;
  }
): EmailContent => {
  const { username, password } = generateVendorCredentials(userData.shopName || userData.fullName, userData.phone);
  const firstName = userData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chef Account Approved</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your documents have been approved and you are now fully verified. You can start accepting orders and serving customers through Local Cooks.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Fully Verified</span>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Your login credentials:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Username:</span> <strong style="color: #1e293b; font-family: 'Courier New', monospace;">${username}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Password:</span> <strong style="color: #1e293b; font-family: 'Courier New', monospace;">${password}</strong></p>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #92400e; margin: 0;"><strong>Important:</strong> Please change your password after your first login for security.</p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Next steps:</p>
      <p class="message" style="margin-bottom: 10px;">You have two accounts to set up:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;"><strong style="color: #1e293b;">Chef Dashboard</strong> &#8212; use your credentials above to manage your profile, products, and orders</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;"><strong style="color: #1e293b;">Stripe Payments</strong> &#8212; set up payment processing to start receiving payments from customers</td>
        </tr>
      </table>
      <div style="text-align: center; margin: 0 0 8px 0;">
        <a href="${getShopLoginUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0 8px 8px 0;">Access Chef Dashboard</a>
        <a href="${getVendorDashboardUrl()}" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">Set Up Stripe Payments</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Warmly,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Your documents have been approved and you are now fully verified. You can start accepting orders and serving customers through Local Cooks.

Your login credentials:
Username: ${username}
Password: ${password}

Important: Please change your password after your first login for security.

Next steps:
• Chef Dashboard — use your credentials above to manage your profile, products, and orders
  Access: ${getShopLoginUrl()}
• Stripe Payments — set up payment processing to start receiving payments
  Access: ${getVendorDashboardUrl()}

If you have any questions, contact us at support@localcooks.ca

Warmly,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Chef Account Approved',
    text,
    html: prepareEmailHtml(html),
    headers: {
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'Importance': 'Normal',
      'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`
    }
  };
};

// Generate application submission email for applications WITH documents
export const generateApplicationWithDocumentsEmail = (
  applicationData: {
    fullName: string;
    email: string;
  }
): EmailContent => {
  const firstName = applicationData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application and Documents Received</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your application to Local Cooks. We&#8217;ve received both your application and supporting documents.</p>
      <p class="message" style="margin-bottom: 20px;">Our team will review everything together. You&#8217;ll receive another email once the review is complete, typically within 2&#8211;3 business days.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>
      </div>
      <div style="margin: 16px 0 0; text-align: center;"><a href="${getDashboardUrl()}?view=applications" class="cta-button">Track Application</a></div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Thank you for submitting your application to Local Cooks. We've received both your application and supporting documents.

Our team will review everything together. You'll receive another email once the review is complete, typically within 2–3 business days.

Status: Under Review

Track your application: ${getDashboardUrl()}?view=applications

If you have any questions, contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject: 'Application and Documents Received',
    text,
    html: prepareEmailHtml(html)
  };
};

// Generate application submission email for applications WITHOUT documents
export const generateApplicationWithoutDocumentsEmail = (
  applicationData: {
    fullName: string;
    email: string;
  }
): EmailContent => {
  const firstName = applicationData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Received - Next Steps</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your application to Local Cooks. We&#8217;ve received it and it will be reviewed soon.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Next step:</p>
      <p class="message" style="margin-bottom: 20px;">Please visit your dashboard to upload the required documents to complete your application.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Documents Required</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getDashboardUrl()}?view=applications&amp;action=documents" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Upload Documents</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Thank you for submitting your application to Local Cooks. We've received it and it will be reviewed soon.

Next step: Please visit your dashboard to upload the required documents to complete your application.

Upload documents: ${getDashboardUrl()}?view=applications&action=documents

If you have any questions, contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject: 'Application Received - Next Steps',
    text,
    html: prepareEmailHtml(html)
  };
};


// Generate document verification status change email with unified design
export const generateDocumentStatusChangeEmail = (
  userData: {
    fullName: string;
    email: string;
    documentType: string;
    status: string;
    adminFeedback?: string;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];
  const docName = userData.documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';

  const getSubjectLine = (documentType: string, status: string) => {
    const dn = documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';
    switch (status) {
      case 'approved':
        return `${dn} Approved - Local Cooks`;
      case 'rejected':
        return `${dn} Update Required - Local Cooks`;
      default:
        return `${dn} Status Update - Local Cooks`;
    }
  };

  const subject = getSubjectLine(userData.documentType, userData.status);

  const getMessage = (status: string) => {
    switch (status) {
      case 'approved':
        return `Your ${docName} has been approved by our verification team. This brings you one step closer to being fully verified on Local Cooks.`;
      case 'rejected':
        return `Your ${docName} could not be approved at this time. Please review the feedback below and upload an updated document.`;
      case 'pending':
        return `Your ${docName} is currently being reviewed by our verification team. We&#8217;ll notify you once the review is complete.`;
      default:
        return `Your ${docName} status has been updated. Please check your dashboard for more details.`;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return `<span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>`;
      case 'rejected':
        return `<span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Update Required</span>`;
      default:
        return `<span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>`;
    }
  };

  const message = getMessage(userData.status);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">${message}</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Document:</span> <strong style="color: #1e293b;">${docName}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        ${getStatusBadge(userData.status)}
      </div>
      ${userData.adminFeedback ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0 0 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Feedback:</span> <strong style="color: #1e293b;">${userData.adminFeedback}</strong></p>
      </div>` : ''}
      ${userData.status === 'approved' || userData.status === 'rejected' ? `
      <div style="margin: 24px 0 0 0; text-align: center;">
        <a href="${userData.status === 'rejected' ? `${getDashboardUrl()}?view=applications&amp;action=documents` : getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">${userData.status === 'approved' ? 'Access Your Dashboard' : 'Update Document'}</a>
      </div>` : ''}
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const statusLabel = userData.status.charAt(0).toUpperCase() + userData.status.slice(1);
  const text = `
Hi ${firstName},

${getMessage(userData.status).replace(/&#8217;/g, "'")}

Document: ${docName}
Status: ${statusLabel}

${userData.adminFeedback ? `Feedback: ${userData.adminFeedback}\n\n` : ''}${userData.status === 'approved' ? `Access your dashboard: ${getDashboardUrl()}` : userData.status === 'rejected' ? `Update your document: ${getDashboardUrl()}?view=applications&action=documents` : ''}

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};


// Both message alerts and unread reminders use the same transactional shell.
export const generateChatMessageEmail = (to: string, recipientName: string, senderName: string,
  locationName: string, primaryUrl: string, preview: string, bookingId?: number): EmailContent =>
  renderTransactionalEmail({ to, recipientName, subject: `New message from ${senderName} — ${locationName}`,
    message: `${senderName} sent you a message about ${locationName}. Open the conversation to reply.`,
    facts: [{ label: 'From', value: senderName }, { label: 'Kitchen', value: locationName },
      { label: 'Message', value: preview.length > 500 ? preview.slice(0, 500) + '…' : preview },
      ...(bookingId ? [{ label: 'Booking', value: `#${bookingId}` }] : [])],
    actionLabel: 'Read message and reply', actionUrl: primaryUrl,
    note: LOCAL_COOKS_COMMUNICATION_NOTE });

export const generateChatDigestEmail = (to: string, unreadCount: number, senderName: string,
  locationName: string, primaryUrl: string, bookings: number[], recipientName = 'there'): EmailContent =>
  renderTransactionalEmail({ to, recipientName, subject: `Unread messages from ${senderName} — ${locationName}`,
    heading: 'You have unread kitchen messages',
    message: `You have ${unreadCount} unread message${unreadCount === 1 ? '' : 's'} from ${senderName} at ${locationName}. Open the conversation to read and reply.`,
    facts: [{ label: 'From', value: senderName }, { label: 'Kitchen', value: locationName },
      { label: 'Unread messages', value: String(unreadCount) },
      ...bookings.map(id => ({ label: 'Booking', value: `- Booking #${id}` }))],
    actionLabel: 'Read messages and reply', actionUrl: primaryUrl, note: LOCAL_COOKS_COMMUNICATION_NOTE });

export async function sendApplicationReceivedEmail(applicationData: any) {
  const firstName = applicationData.fullName ? applicationData.fullName.split(' ')[0] : 'there';

  const subject = `Application Received - Local Cooks`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your application to Local Cooks. We&#8217;ve received it and our team will review it shortly.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What happens next:</p>
      <p class="message" style="margin-bottom: 20px;">Our team typically reviews applications within 2&#8211;3 business days. You&#8217;ll receive an email notification once we&#8217;ve made a decision.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Track Application Status</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const textContent = `
Hi ${firstName},

Thank you for submitting your application to Local Cooks. We've received it and our team will review it shortly.

What happens next:
Our team typically reviews applications within 2–3 business days. You'll receive an email notification once we've made a decision.

Track your application status: ${getDashboardUrl()}

If you have any questions, contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
`;

  return sendEmail({
    to: applicationData.email,
    subject,
    html: prepareEmailHtml(htmlContent),
    text: textContent
  });
}
// Removed unused sendApplicationApprovedEmail function - was causing duplicate emails
// Full verification emails are now handled by generateFullVerificationEmail only

export async function sendApplicationRejectedEmail(applicationData: any, reason?: string) {
  const firstName = applicationData.fullName ? applicationData.fullName.split(' ')[0] : 'there';

  const subject = `Application Update - Local Cooks`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for your interest in joining Local Cooks. After careful review, we&#8217;re unable to approve your application at this time.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Not Approved</span>
      </div>
      ${reason ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0 0 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Feedback:</span> <strong style="color: #1e293b;">${reason}</strong></p>
      </div>` : ''}
      <p class="message" style="margin-top: 24px; margin-bottom: 20px;">We encourage you to gain more experience and reapply in the future. We&#8217;d be happy to reconsider your application when you&#8217;re ready.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getWebsiteUrl()}/apply" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Learn About Requirements</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const textContent = `
Hi ${firstName},

Thank you for your interest in joining Local Cooks. After careful review, we're unable to approve your application at this time.

Status: Not Approved

${reason ? `Feedback: ${reason}\n\n` : ''}We encourage you to gain more experience and reapply in the future. We'd be happy to reconsider your application when you're ready.

Learn more: ${getWebsiteUrl()}/apply

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
`;

  return sendEmail({
    to: applicationData.email,
    subject,
    html: prepareEmailHtml(htmlContent),
    text: textContent
  });
}

// Generate password reset email with unified design
export const generatePasswordResetEmail = (
  userData: {
    fullName: string;
    email: string;
    resetToken: string;
    resetUrl: string;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Request - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">We received a request to reset your password for your Local Cooks account. Click the button below to create a new password.</p>
      <p class="message" style="margin-bottom: 20px;">This link will expire in 1 hour for security.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${userData.resetUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Reset My Password</a>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin: 24px 0 0 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #92400e; margin: 0;"><strong>Didn&#8217;t request this?</strong> If you didn&#8217;t ask to reset your password, you can safely ignore this email. Your account remains secure.</p>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you need help, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

We received a request to reset your password for your Local Cooks account.

Reset your password: ${userData.resetUrl}

This link will expire in 1 hour for security.

If you didn't request this, you can safely ignore this email. Your account remains secure.

If you need help, contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Password Reset Request - Local Cooks',
    text,
    html: prepareEmailHtml(html),
    headers: {
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'Importance': 'Normal',
      'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`
    }
  };
};

// Generate email verification email with unified design
export const generateEmailVerificationEmail = (
  userData: {
    fullName: string;
    email: string;
    verificationToken: string;
    verificationUrl: string;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for joining Local Cooks. To complete your registration and activate your account, please verify your email address.</p>
      <p class="message" style="margin-bottom: 20px;">Click the button below to confirm your email. This link will expire in 24 hours for security.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Verification Required</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${userData.verificationUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Verify My Email</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you didn&#8217;t create an account with Local Cooks, you can safely ignore this email.</p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Thank you for joining Local Cooks. To complete your registration and activate your account, please verify your email address.

Verify your email: ${userData.verificationUrl}

This link will expire in 24 hours for security.

If you didn't create an account with Local Cooks, you can safely ignore this email.

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Verify Your Email - Local Cooks',
    text,
    html: prepareEmailHtml(html),
    headers: {
      'X-Transactional-Type': 'account-verification'
    }
  };
};

// Sign-in code email (replaces the sign-in link): the code is in the subject so it can be read from a phone notification.
/** `signUp`: the address has no account yet, so the greeting carries no name (nothing typed by a visitor goes into the email). */
export const generateSignInCodeEmail = (userData: { fullName: string; email: string; code: string; locale?: string | null; signUp?: boolean }): EmailContent => {
  const firstName = userData.signUp ? '' : userData.fullName.split(' ')[0];
  const fr = userData.locale?.startsWith('fr'), uk = userData.locale?.startsWith('uk');
  const subject = userData.signUp
    ? fr ? `${userData.code} est votre code de confirmation Local Cooks`
      : uk ? `${userData.code} — ваш код підтвердження Local Cooks`
        : `${userData.code} is your Local Cooks confirmation code`
    : fr ? `${userData.code} est votre code de connexion Local Cooks`
      : uk ? `${userData.code} — ваш код для входу в Local Cooks`
        : `${userData.code} is your Local Cooks sign-in code`;
  const lead = userData.signUp
    ? fr ? 'Entrez ce code pour confirmer votre courriel et créer votre compte.'
      : uk ? 'Введіть цей код, щоб підтвердити пошту й створити обліковий запис.'
        : 'Enter this code to confirm your email and create your account.'
    : fr ? 'Entrez ce code sur l’écran de connexion pour continuer.'
      : uk ? 'Введіть цей код на екрані входу, щоб продовжити.'
        : 'Enter this code on the sign-in screen to continue.';
  const expiry = fr ? 'Il expire dans 10 minutes et ne peut servir qu’une fois.'
    : uk ? 'Він діє 10 хвилин і лише один раз.'
      : 'It expires in 10 minutes and can be used once.';
  const ignore = userData.signUp
    ? fr ? 'Vous n’avez pas demandé ce code ? Ignorez ce courriel ; aucun compte n’est créé sans lui.'
      : uk ? 'Не запитували цей код? Просто проігноруйте лист: без коду обліковий запис не створюється.'
        : 'Didn’t ask for this code? You can ignore this email; no account is created without it.'
    : fr ? 'Vous n’avez pas demandé ce code ? Ignorez ce courriel ; personne ne peut se connecter sans lui.'
      : uk ? 'Не запитували цей код? Просто проігноруйте лист: без коду ніхто не увійде.'
        : 'Didn’t ask for this code? You can ignore this email; no one can sign in without it.';
  const hi = fr ? 'Bonjour' : uk ? 'Вітаємо' : 'Hi';
  const greeting = firstName ? `${hi} ${firstName},` : `${hi},`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">${greeting}</h2>
      <p class="message" style="margin-bottom: 20px;">${lead}</p>
      <div style="margin: 8px 0 20px 0; text-align: center;">
        <span style="display: inline-block; padding: 14px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.3em; color: #0f172a;">${userData.code}</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">${expiry}</p>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">${ignore}</p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 0;">Local Cooks</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;
  const text = `${greeting}

${lead}

${userData.code}

${expiry}

${ignore}

Local Cooks`;
  return { to: userData.email, subject, text, html: prepareEmailHtml(html), headers: { 'X-Transactional-Type': 'sign-in-code' } };
};

// Generate welcome email with unified design
// Role parameter determines the dashboard URL subdomain:
// - 'manager' -> kitchen.localcooks.ca
// - 'chef' -> chef.localcooks.ca
// - 'admin' -> admin.localcooks.ca
export const generateWelcomeEmail = (
  userData: {
    fullName: string;
    email: string;
    role?: 'chef' | 'manager' | 'admin';
    /** Recipient preferred locale (BCP 47). Defaults to en-CA. */
    locale?: string | null;
  }
): EmailContent => {
  // Map role to userType for getDashboardUrl
  const userType: 'chef' | 'kitchen' | 'admin' = 
    userData.role === 'manager' ? 'kitchen' : 
    userData.role === 'admin' ? 'admin' : 'chef';
  
  const dashboardUrl = getDashboardUrl(userType);
  const firstName = userData.fullName.split(' ')[0];
  const isManager = userData.role === 'manager';
  const locale = userData.locale;
  const subject = tEmail(locale, "welcomeSubject");

  // Role-specific content
  const bullet1 = isManager
    ? 'List your kitchen, storage, and equipment availability so qualified chefs and food businesses can book your space.'
    : 'Apply to sell your creations through Local Cooks; we handle payments and delivery logistics so you can focus on cooking.';

  const bullet2 = isManager
    ? 'Turn underutilized hours and assets into a new revenue stream, while keeping full control over your schedule, pricing, and approvals.'
    : 'Request access to partnered commercial kitchens and book licensed, professional spaces when you need them.';

  const additionalParagraph = isManager
    ? 'Managing everything is simple: view and approve booking requests, adjust availability, and track usage directly from your dashboard.'
    : `You&#8217;ll also find training resources, including Unilever modules and other materials aligned with HACCP principles and common food safety standards. These are learning tools only that can help you prepare for food handler certification requirements in your region.`;

  const closingParagraph = isManager
    ? `We&#8217;re here to make this as smooth and valuable as possible for you and your team. If you&#8217;d like help setting up your listings or figuring out the best way to use Local Cooks for your kitchen, please reach out.`
    : `We&#8217;re here to support you at every step. If you&#8217;re unsure what to do next or how best to use the platform, please reach out.`;

  const signOff = isManager ? 'Best regards,' : 'Warmly,';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Welcome to Local Cooks, and thank you for joining us.</p>
      <p class="message" style="margin-bottom: 10px;">Your account is now created and verified. From your dashboard, you can:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">${bullet1}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">${bullet2}</td>
        </tr>
      </table>
      <p class="message">${additionalParagraph}</p>
      <p class="message" style="margin-bottom: 20px;">${closingParagraph}</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Verified</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Access Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">${signOff}</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  // Plain text version for email clients that don't support HTML
  const bulletText1 = isManager
    ? 'List your kitchen, storage, and equipment availability so qualified chefs and food businesses can book your space.'
    : 'Apply to sell your creations through Local Cooks; we handle payments and delivery logistics so you can focus on cooking.';

  const bulletText2 = isManager
    ? 'Turn underutilized hours and assets into a new revenue stream, while keeping full control over your schedule, pricing, and approvals.'
    : 'Request access to partnered commercial kitchens and book licensed, professional spaces when you need them.';

  const additionalText = isManager
    ? 'Managing everything is simple: view and approve booking requests, adjust availability, and track usage directly from your dashboard.'
    : "You'll also find training resources, including Unilever modules and other materials aligned with HACCP principles and common food safety standards. These are learning tools only that can help you prepare for food handler certification requirements in your region.";

  const closingText = isManager
    ? "We're here to make this as smooth and valuable as possible for you and your team. If you'd like help setting up your listings or figuring out the best way to use Local Cooks for your kitchen, please reach out."
    : "We're here to support you at every step. If you're unsure what to do next or how best to use the platform, please reach out.";

  const text = `
Hi ${firstName},

Welcome to Local Cooks, and thank you for joining us.

Your account is now created and verified. From your dashboard, you can:

• ${bulletText1}
• ${bulletText2}

${additionalText}

${closingText}

Access your dashboard at: ${dashboardUrl}

If you have any questions, contact us at support@localcooks.ca

${signOff}
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Helper function to get the correct subdomain URL based on user type
// Architecture: Always use BASE_DOMAIN for subdomain construction.
// BASE_URL is ONLY used as a fallback for the 'main' type when BASE_DOMAIN is not set.
// This prevents Vercel deployment URLs (e.g. local-cooks-community.vercel.app) from
// being incorrectly returned for all user types.
//
// Subdomain mapping:
//   'chef'    → chef.localcooks.ca
//   'kitchen' → kitchen.localcooks.ca   (managers)
//   'admin'   → admin.localcooks.ca
//   'main'    → localcooks.ca
export const getSubdomainUrl = (userType: 'chef' | 'kitchen' | 'admin' | 'main' = 'main'): string => {
  const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';

  // Detect environment — Vercel preview always uses `dev-*` subdomains.
  // Do not use DATABASE_URL heuristics here: production must stay on chef.localcooks.ca
  // even if the DB URL string happens to mention supabase.
  const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL_ENV;
  const isPreProd = process.env.VERCEL_ENV === 'preview';

  // In development, use the configured BASE_URL directly.
  //
  // Rationale (why we do NOT try to apply role-based subdomain prefixes in local dev):
  // 1. BASE_URL already points to a dev server that's reachable in the user's browser
  //    (e.g., http://localhost:5001, http://chef.localhost:5001 — whatever the user configured).
  // 2. Trying to strip/re-add subdomain labels is error-prone:
  //      chef.localhost  →  chef.chef.localhost  (double prefix)
  //    and scheme/port get dropped easily.
  // 3. The client-side EmailAction page already implements `redirectIfWrongSubdomain`,
  //    which corrects role/subdomain mismatches AFTER the page loads. So even if the
  //    magic link opens e.g. plain localhost:5001, the client immediately bounces the
  //    user to the correct role-based subdomain while preserving mode/oobCode/etc.
  //
  // This makes the local-dev branch maximally robust against all BASE_URL variants.
  if (isLocalDev) {
    const devBase = process.env.BASE_URL || 'http://localhost:5001';
    if (devBase.includes('localhost') || devBase.includes('127.0.0.1')) {
      try {
        const u = new URL(devBase);
        const port = u.port || process.env.PORT || '5001';
        const protocol = u.protocol;
        const portSuffix = port ? `:${port}` : '';
        if (userType === 'main') {
          const origin = `${protocol}//localhost${portSuffix}`;
          logger.info(`🔧 getSubdomainUrl(${userType}) local dev: ${origin}`);
          return origin;
        }
        const origin = `${protocol}//${userType}.localhost${portSuffix}`;
        logger.info(`🔧 getSubdomainUrl(${userType}) local dev: ${origin}`);
        return origin;
      } catch {
        if (userType === 'main') return 'http://localhost:5001';
        return `http://${userType}.localhost:5001`;
      }
    }
    // If BASE_URL is a real domain in dev mode, fall through to production logic
  }

  // Determine prefix based on pre-prod vs prod
  let prefix = '';
  if (isPreProd && userType !== 'main') {
    prefix = 'dev-';
  }

  // Production (and non-localhost dev): Always construct from BASE_DOMAIN
  if (userType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${prefix}${userType}.${baseDomain}`;
};

/**
 * Continue URL passed to Firebase generateEmailVerificationLink / generateSignInWithEmailLink.
 * Local dev uses plain localhost (Firebase authorized domain). Kitchen-preview return paths
 * are restored client-side via pendingAuthIntent / pendingApplicationModal.
 */
export function getFirebaseContinueUrl(
  userType: 'chef' | 'kitchen' | 'admin',
  redirectPath: string
): string {
  const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL_ENV;
  if (isLocalDev) {
    const devBase = process.env.BASE_URL || 'http://localhost:5001';
    try {
      const u = new URL(devBase);
      const port = u.port || process.env.PORT || '5001';
      const portSuffix = port ? `:${port}` : '';
      return `${u.protocol}//localhost${portSuffix}${redirectPath}`;
    } catch {
      return `http://localhost:5001${redirectPath}`;
    }
  }
  return `${getSubdomainUrl(userType)}${redirectPath}`;
};

/**
 * Public origin for links inside outbound emails. When the API runs locally, recipients
 * cannot open chef.localhost — use preview/prod subdomains (same env detection as getSubdomainUrl).
 */
export function getEmailLinkOrigin(
  userType: 'chef' | 'kitchen' | 'admin' | 'main' = 'main'
): string {
  const envOverride =
    userType === 'chef'
      ? process.env.EMAIL_LINK_ORIGIN_CHEF
      : userType === 'kitchen'
        ? process.env.EMAIL_LINK_ORIGIN_KITCHEN
        : userType === 'admin'
          ? process.env.EMAIL_LINK_ORIGIN_ADMIN
          : process.env.EMAIL_LINK_ORIGIN;
  if (envOverride?.trim()) {
    return envOverride.trim().replace(/\/$/, '');
  }

  const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL_ENV;
  if (!isLocalDev) {
    return getSubdomainUrl(userType);
  }

  const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';
  // Local API sending real email: prefer preview hosts so links work outside localhost.
  const isPreProd =
    process.env.VERCEL_ENV === 'preview' ||
    (process.env.DATABASE_URL || '').includes('supabase');
  const prefix = isPreProd && userType !== 'main' ? 'dev-' : '';

  if (userType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${prefix}${userType}.${baseDomain}`;
};

// Helper function to get the correct website URL based on environment
export const getWebsiteUrl = (): string => {
  return getSubdomainUrl('main');
};

// Helper function to get the correct dashboard URL based on user type
// Returns the full dashboard path for deep linking:
//   'chef'    → chef.localcooks.ca/dashboard
//   'kitchen' → kitchen.localcooks.ca/manager/dashboard
//   'admin'   → admin.localcooks.ca/admin
export const getDashboardUrl = (userType: 'chef' | 'kitchen' | 'admin' = 'chef'): string => {
  const baseUrl = getSubdomainUrl(userType);

  if (userType === 'admin') return `${baseUrl}/admin`;
  if (userType === 'kitchen') return `${baseUrl}/manager/dashboard`;
  return `${baseUrl}/dashboard`;
};

// Helper function to get privacy policy URL
const getPrivacyUrl = (): string => {
  const baseUrl = getWebsiteUrl();
  return `${baseUrl}/privacy`;
};

// Helper function to get vendor dashboard URL
const getVendorDashboardUrl = (): string => {
  return getVendorOnboardingUrl();
};

// Helper function to get the correct promo URL for customer app
const getPromoUrl = (): string => {
  return 'https://localcook.shop/';
};

// Generate document update email with unified design
export const generateDocumentUpdateEmail = (
  userData: {
    fullName: string;
    email: string;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Update Received - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for updating your documents. Our team will review them and update your verification status as soon as possible.</p>
      <p class="message" style="margin-bottom: 20px;">You&#8217;ll receive another email once your documents have been reviewed.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: "Document Update Received - Local Cooks",
    text: `Hi ${firstName},\n\nThank you for updating your documents. Our team will review them and update your verification status as soon as possible.\n\nYou'll receive another email once your documents have been reviewed.\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html),
    headers: {
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'Importance': 'Normal',
      'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`
    }
  };
};

export const generatePromoCodeEmail = (
  userData: {
    email: string;
    promoCode: string;
    customMessage?: string;
    message?: string; // Added to handle both field names
    greeting?: string;
    promoStyle?: {
      colorTheme: string;
      borderStyle: string;
    };
    promoCodeStyling?: {
      backgroundColor?: string;
      borderColor?: string;
      textColor?: string;
      fontSize?: string;
      fontWeight?: string;
      labelColor?: string;
      labelFontSize?: string;
      labelFontWeight?: string;
      borderRadius?: string;
      borderWidth?: string;
      borderStyle?: string;
      boxShadow?: string;
      padding?: string;
    };
    designSystem?: any;
    isPremium?: boolean;
    sections?: Array<{
      id: string;
      type: string;
      content: any;
      styling: any;

    }> | { [key: string]: any }; // Support both array and object formats
    orderButton?: {
      text: string;
      url: string;
      styling?: {
        backgroundColor?: string;
        color?: string;
        fontSize?: string;
        fontWeight?: string;
        padding?: string;
        borderRadius?: string;
        textAlign?: string;
      };
    };
    header?: {
      title: string;
      subtitle: string;
      styling?: {
        backgroundColor?: string;
        titleColor?: string;
        subtitleColor?: string;
        titleFontSize?: string;
        subtitleFontSize?: string;
        padding?: string;
        borderRadius?: string;
        textAlign?: string;
        backgroundImage?: string;
        backgroundSize?: string;
        backgroundPosition?: string;
        backgroundRepeat?: string;
        backgroundAttachment?: string;
      };
    };
    footer?: {
      mainText?: string;
      contactText?: string;
      copyrightText?: string;
      showContact?: boolean;
      showCopyright?: boolean;
      styling?: {
        backgroundColor?: string;
        textColor?: string;
        linkColor?: string;
        fontSize?: string;
        padding?: string;
        textAlign?: string;
        borderColor?: string;
      };
    };
    usageSteps?: {
      title?: string;
      steps?: string[];
      enabled?: boolean;
      styling?: {
        backgroundColor?: string;
        borderColor?: string;
        titleColor?: string;
        textColor?: string;
        linkColor?: string;
        padding?: string;
        borderRadius?: string;
      };
    };
    emailContainer?: {
      maxWidth?: string;
      backgroundColor?: string;
      borderRadius?: string;
      boxShadow?: string;
      backgroundImage?: string;
      backgroundSize?: string;
      backgroundPosition?: string;
      backgroundRepeat?: string;
      backgroundAttachment?: string;
      mobileMaxWidth?: string;
      mobilePadding?: string;
      mobileFontScale?: string;
      mobileButtonSize?: string;
    };
    dividers?: {
      enabled?: boolean;
      style?: string;
      color?: string;
      thickness?: string;
      margin?: string;
      opacity?: string;
    };
    subject?: string;
    previewText?: string;
    promoCodeLabel?: string;
  }
): EmailContent => {
  const organizationName = getOrganizationName();
  const supportEmail = getSupportEmail();
  const defaultPromoStyle = userData.promoStyle || { colorTheme: 'green', borderStyle: 'dashed' };

  // Handle both customMessage and message fields consistently
  const messageContent = userData.customMessage || userData.message || '';

  // Helper function to safely access sections data with improved logic
  const getSectionData = (sectionId: string) => {
    if (!userData.sections) return null;

    // Handle array format
    if (Array.isArray(userData.sections)) {
      return userData.sections.find(s => s.id === sectionId || s.id === `${sectionId}-section`) || null;
    }

    // Handle object format - check multiple possible keys
    if (typeof userData.sections === 'object') {
      return userData.sections[sectionId] ||
        userData.sections[`${sectionId}-section`] ||
        userData.sections[sectionId.replace('-section', '')] ||
        null;
    }

    return null;
  };



  const getPromoStyling = (colorTheme: string, borderStyle: string) => {
    const themes = {
      green: {
        background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
        textColor: '#16a34a',
        accentColor: '#15803d',
        borderColor: '#16a34a',
        border: '2px dashed #16a34a',
        boxShadow: '0 4px 16px rgba(22, 163, 74, 0.15)'
      },
      blue: {
        background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
        textColor: '#2563eb',
        accentColor: '#1d4ed8',
        borderColor: '#2563eb',
        border: '2px dashed #2563eb',
        boxShadow: '0 4px 16px rgba(37, 99, 235, 0.15)'
      },
      purple: {
        background: 'linear-gradient(135deg, #faf5ff 0%, #e9d5ff 100%)',
        textColor: '#7c3aed',
        accentColor: '#6d28d9',
        borderColor: '#7c3aed',
        border: '2px dashed #7c3aed',
        boxShadow: '0 4px 16px rgba(124, 58, 237, 0.15)'
      },
      red: {
        background: 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
        textColor: '#dc2626',
        accentColor: '#b91c1c',
        borderColor: '#dc2626',
        border: '2px dashed #dc2626',
        boxShadow: '0 4px 16px rgba(220, 38, 38, 0.15)'
      },
      orange: {
        background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)',
        textColor: '#ea580c',
        accentColor: '#c2410c',
        borderColor: '#ea580c',
        border: '2px dashed #ea580c',
        boxShadow: '0 4px 16px rgba(234, 88, 12, 0.15)'
      },
      pink: {
        background: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)',
        textColor: '#e11d48',
        accentColor: '#be185d',
        borderColor: '#e11d48',
        border: '2px dashed #e11d48',
        boxShadow: '0 4px 16px rgba(225, 29, 72, 0.15)'
      },
      yellow: {
        background: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)',
        textColor: '#ca8a04',
        accentColor: '#a16207',
        borderColor: '#ca8a04',
        border: '2px dashed #ca8a04',
        boxShadow: '0 4px 16px rgba(202, 138, 4, 0.15)'
      },
      gray: {
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        textColor: '#475569',
        accentColor: '#334155',
        borderColor: '#475569',
        border: '2px dashed #475569',
        boxShadow: '0 4px 16px rgba(71, 85, 105, 0.15)'
      }
    };

    const theme = themes[colorTheme as keyof typeof themes] || themes.green;

    // Apply border style variations
    if (borderStyle === 'solid') {
      theme.border = `2px solid ${theme.borderColor}`;
    } else if (borderStyle === 'dotted') {
      theme.border = `2px dotted ${theme.borderColor}`;
    }

    return theme;
  };

  const generateAdvancedSections = (sections: Array<any> = []) => {
    return sections.map(section => {
      switch (section.type) {
        case 'text':
          const hasBackground = section.styling?.backgroundColor && section.styling.backgroundColor !== 'transparent';
          const paddingValue = hasBackground ? '12px' : (section.styling?.padding || '8px 0');
          return `
            <div style="
              font-size: ${section.styling?.fontSize || '16px'};
              color: ${section.styling?.color || '#374151'};
              font-weight: ${section.styling?.fontWeight || '400'};
              font-style: ${section.styling?.fontStyle || 'normal'};
              text-align: ${section.styling?.textAlign || 'left'};
              padding: ${paddingValue};
              margin: ${section.styling?.margin || '0'};
              line-height: 1.6;
              ${hasBackground ? `background: ${section.styling.backgroundColor};` : ''}
              ${hasBackground ? `border-radius: 8px;` : ''}
            ">
              ${section.content || section.text || ''}
            </div>
          `;
        case 'button':
          return `
            <div style="text-align: ${section.styling?.textAlign || 'center'}; margin: 20px 0;">
              <a href="${section.styling?.url || getPromoUrl()}" style="
                display: inline-block;
                background: ${section.styling?.backgroundColor || styling.accentColor};
                color: ${section.styling?.color || '#ffffff'} !important;
                text-decoration: none !important;
                padding: ${section.styling?.padding || '12px 24px'};
                border-radius: 6px;
                font-weight: ${section.styling?.fontWeight || '600'};
                font-size: ${section.styling?.fontSize || '16px'};
                border: none;
                cursor: pointer;
              ">
                ${section.content || section.text || 'Click Here'}
              </a>
            </div>
          `;
        case 'image':
          if (section.content) {
            const hasOverlay = section.overlay?.enabled && section.overlay?.text;

            if (hasOverlay) {
              return `
                <div style="text-align: ${section.styling?.textAlign || 'center'}; margin: 20px 0;">
                  <div style="position: relative; display: inline-block; width: ${section.styling?.width || '200px'}; height: ${section.styling?.height || '120px'};">
                    <img 
                      src="${section.content}" 
                      alt="Email image"
                      style="
                        width: 100%;
                        height: 100%;
                        object-fit: ${section.styling?.objectFit || 'cover'};
                        border-radius: ${section.styling?.borderRadius || '8px'};
                        border: 1px solid #e2e8f0;
                        display: block;
                        max-width: 100%;
                      "
                    />
                    <!--[if mso]>
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10;">
                    <![endif]-->
                    <div style="
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -50%);
                      color: ${section.overlay.styling?.color || '#ffffff'};
                      font-size: ${section.overlay.styling?.fontSize || '18px'};
                      font-weight: ${section.overlay.styling?.fontWeight || '600'};
                      text-align: center;
                      background-color: ${section.overlay.styling?.backgroundColor || 'rgba(0, 0, 0, 0.5)'};
                      padding: ${section.overlay.styling?.padding || '12px 20px'};
                      border-radius: ${section.overlay.styling?.borderRadius || '6px'};
                      text-shadow: ${section.overlay.styling?.textShadow || '1px 1px 2px rgba(0, 0, 0, 0.7)'};
                      max-width: 90%;
                      word-wrap: break-word;
                      z-index: 10;
                      line-height: 1.4;
                    ">
                      ${section.overlay.text}
                    </div>
                    <!--[if mso]>
                    </div>
                    <![endif]-->
                  </div>
                </div>
              `;
            } else {
              return `
                <div style="text-align: ${section.styling?.textAlign || 'center'}; margin: 20px 0;">
                  <img 
                    src="${section.content}" 
                    alt="Email image"
                    style="
                      width: ${section.styling?.width || '200px'};
                      height: ${section.styling?.height || '120px'};
                      object-fit: ${section.styling?.objectFit || 'cover'};
                      border-radius: ${section.styling?.borderRadius || '8px'};
                      border: 1px solid #e2e8f0;
                      display: block;
                      max-width: 100%;
                    "
                  />
                </div>
              `;
            }
          }
          return '';

        default:
          return '';
      }
    }).join('');
  };

  // Generate divider HTML based on settings
  const generateDivider = () => {
    if (!userData.dividers?.enabled) return '';

    return `
      <div style="margin: ${userData.dividers.margin || '24px 0'};">
        <hr style="
          border: none;
          border-top: ${userData.dividers.thickness || '1px'} ${userData.dividers.style || 'solid'} ${userData.dividers.color || '#e2e8f0'};
          opacity: ${userData.dividers.opacity || '1'};
          margin: 0;
        " />
      </div>
    `;
  };

  // Improved greeting resolution with multiple fallback sources
  const getGreeting = () => {
    // Try to get greeting from sections first
    const greetingSection = getSectionData('greeting') || getSectionData('greeting-section');
    if (greetingSection?.content || greetingSection?.text) {
      return greetingSection.content || greetingSection.text;
    }

    // Fallback to direct greeting parameter
    return userData.greeting || 'Hello! ';
  };

  // Improved message resolution
  const getCustomMessage = () => {
    // Try to get message from sections first
    const messageSection = getSectionData('custom-message') || getSectionData('custom-message-section');
    if (messageSection?.content || messageSection?.text) {
      return messageSection.content || messageSection.text;
    }

    // Fallback to direct message parameters
    return messageContent || 'Thank you for being a valued customer!';
  };

  // Generate plain text version for better deliverability
  const generatePlainText = (email: string, promoCode: string, customMessage: string) => {
    if (promoCode) {
      return `Special Promo Code from ${organizationName}

${customMessage}

Your Promo Code: ${promoCode}

To use your promo code:
1. Visit our website: ${getPromoUrl()}
2. Apply during checkout or registration
3. Enjoy your special offer!

Questions? Contact us at ${supportEmail}

Best regards,
${organizationName} Team

Visit: ${getPromoUrl()}
`;
    } else {
      return `Message from ${organizationName}

${customMessage}

Questions? Contact us at ${supportEmail}

Best regards,
${organizationName} Team

Visit: ${getPromoUrl()}
`;
    }
  };

  const subject = userData.subject || (userData.promoCode ? `🎁 Exclusive Promo Code: ${userData.promoCode}` : 'Important Update from Local Cooks Community');
  const styling = getPromoStyling(defaultPromoStyle.colorTheme, defaultPromoStyle.borderStyle);

  // Resolve final content values
  const finalGreeting = getGreeting();
  const finalMessage = getCustomMessage();

  // Generate usage steps section
  const generateUsageStepsSection = () => {
    const defaultSteps = [
      `Visit our website: <a href="${userData.orderButton?.url || getPromoUrl()}" style="color: ${userData.usageSteps?.styling?.linkColor || '#1d4ed8'};">${userData.orderButton?.url || getPromoUrl()}</a>`,
      'Browse our amazing local cooks and their delicious offerings',
      'Apply your promo code during checkout',
      'Enjoy your special offer!'
    ];

    const steps = userData.usageSteps?.steps && userData.usageSteps.steps.length > 0
      ? userData.usageSteps.steps
      : defaultSteps;

    const stepsHtml = steps.map(step => `<li>${step}</li>`).join('');

    return `
      <div class="usage-steps">
        <h4>${userData.usageSteps?.title || '🚀 How to use your promo code:'}</h4>
        <ol>
          ${stepsHtml}
        </ol>
      </div>
      ${generateDivider()}
    `;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
  <style>
    /* Override email container styles for customization */
    body { 
      background: ${userData.emailContainer?.backgroundColor || '#f1f5f9'} !important;
      ${userData.emailContainer?.backgroundImage ? `background-image: url(${userData.emailContainer.backgroundImage}) !important;` : ''}
      ${userData.emailContainer?.backgroundSize ? `background-size: ${userData.emailContainer.backgroundSize} !important;` : ''}
      ${userData.emailContainer?.backgroundPosition ? `background-position: ${userData.emailContainer.backgroundPosition} !important;` : ''}
      ${userData.emailContainer?.backgroundRepeat ? `background-repeat: ${userData.emailContainer.backgroundRepeat} !important;` : ''}
      ${userData.emailContainer?.backgroundAttachment ? `background-attachment: ${userData.emailContainer.backgroundAttachment} !important;` : ''}
    }
    .email-container { 
      max-width: ${userData.emailContainer?.maxWidth || '600px'} !important; 
      border-radius: ${userData.emailContainer?.borderRadius || '12px'} !important; 
      box-shadow: ${userData.emailContainer?.boxShadow || '0 4px 20px rgba(0,0,0,0.08)'} !important;
    }
    
    .promo-code-box {
      background: ${userData.promoCodeStyling?.backgroundColor || '#f3f4f6'};
      border: ${userData.promoCodeStyling?.borderWidth || userData.promoCodeStyling?.borderStyle || userData.promoCodeStyling?.borderColor
      ? `${userData.promoCodeStyling?.borderWidth || '2px'} ${userData.promoCodeStyling?.borderStyle || 'dashed'} ${userData.promoCodeStyling?.borderColor || '#9ca3af'}`
      : '2px dashed #9ca3af'
    };
      border-radius: ${userData.promoCodeStyling?.borderRadius || '12px'};
      padding: ${userData.promoCodeStyling?.padding || '20px'};
      box-shadow: ${userData.promoCodeStyling?.boxShadow || '0 2px 4px rgba(0,0,0,0.1)'};
      display: inline-block;
      min-width: 200px;
    }
    .promo-code {
      font-family: 'Courier New', monospace;
      font-size: ${userData.promoCodeStyling?.fontSize || '24px'};
      font-weight: ${userData.promoCodeStyling?.fontWeight || 'bold'};
      color: ${userData.promoCodeStyling?.textColor || '#1f2937'};
      letter-spacing: 2px;
      margin: 0;
    }
    .promo-label {
      font-size: ${userData.promoCodeStyling?.labelFontSize || '16px'};
      font-weight: ${userData.promoCodeStyling?.labelFontWeight || '600'};
      color: ${userData.promoCodeStyling?.labelColor || '#374151'};
      margin: 0;
      text-align: center;
    }
    .greeting {
      font-size: ${getSectionData('greeting')?.styling?.fontSize || getSectionData('greeting-section')?.styling?.fontSize || '18px'};
      font-weight: ${getSectionData('greeting')?.styling?.fontWeight || getSectionData('greeting-section')?.styling?.fontWeight || 'normal'};
      font-style: ${getSectionData('greeting')?.styling?.fontStyle || getSectionData('greeting-section')?.styling?.fontStyle || 'normal'};
      color: ${getSectionData('greeting')?.styling?.color || getSectionData('greeting-section')?.styling?.color || '#1f2937'};
      text-align: ${getSectionData('greeting')?.styling?.textAlign || getSectionData('greeting-section')?.styling?.textAlign || 'left'};
      line-height: ${getSectionData('greeting')?.styling?.lineHeight || getSectionData('greeting-section')?.styling?.lineHeight || '1.6'};
      letter-spacing: ${getSectionData('greeting')?.styling?.letterSpacing || getSectionData('greeting-section')?.styling?.letterSpacing || 'normal'};
      text-transform: ${getSectionData('greeting')?.styling?.textTransform || getSectionData('greeting-section')?.styling?.textTransform || 'none'};
      margin: ${getSectionData('greeting')?.styling?.margin || getSectionData('greeting-section')?.styling?.margin || '0'};
      ${getSectionData('greeting')?.styling?.marginTop ? `margin-top: ${getSectionData('greeting')?.styling?.marginTop};` : ''}
      ${getSectionData('greeting')?.styling?.marginRight ? `margin-right: ${getSectionData('greeting')?.styling?.marginRight};` : ''}
      ${getSectionData('greeting')?.styling?.marginBottom ? `margin-bottom: ${getSectionData('greeting')?.styling?.marginBottom || '16px'};` : 'margin-bottom: 16px;'}
      ${getSectionData('greeting')?.styling?.marginLeft ? `margin-left: ${getSectionData('greeting')?.styling?.marginLeft};` : ''}
      padding: ${getSectionData('greeting')?.styling?.padding || getSectionData('greeting-section')?.styling?.padding || '0'};
      ${getSectionData('greeting')?.styling?.paddingTop ? `padding-top: ${getSectionData('greeting')?.styling?.paddingTop};` : ''}
      ${getSectionData('greeting')?.styling?.paddingRight ? `padding-right: ${getSectionData('greeting')?.styling?.paddingRight};` : ''}
      ${getSectionData('greeting')?.styling?.paddingBottom ? `padding-bottom: ${getSectionData('greeting')?.styling?.paddingBottom};` : ''}
      ${getSectionData('greeting')?.styling?.paddingLeft ? `padding-left: ${getSectionData('greeting')?.styling?.paddingLeft};` : ''}
    }
    .custom-message {
      font-size: ${getSectionData('custom-message')?.styling?.fontSize || getSectionData('custom-message-section')?.styling?.fontSize || '16px'};
      font-weight: ${getSectionData('custom-message')?.styling?.fontWeight || getSectionData('custom-message-section')?.styling?.fontWeight || 'normal'};
      font-style: ${getSectionData('custom-message')?.styling?.fontStyle || getSectionData('custom-message-section')?.styling?.fontStyle || 'normal'};
      color: ${getSectionData('custom-message')?.styling?.color || getSectionData('custom-message-section')?.styling?.color || '#374151'};
      text-align: ${getSectionData('custom-message')?.styling?.textAlign || getSectionData('custom-message-section')?.styling?.textAlign || 'left'};
      line-height: ${getSectionData('custom-message')?.styling?.lineHeight || getSectionData('custom-message-section')?.styling?.lineHeight || '1.7'};
      letter-spacing: ${getSectionData('custom-message')?.styling?.letterSpacing || getSectionData('custom-message-section')?.styling?.letterSpacing || 'normal'};
      text-transform: ${getSectionData('custom-message')?.styling?.textTransform || getSectionData('custom-message-section')?.styling?.textTransform || 'none'};
      white-space: pre-line; /* Preserves line breaks from admin input */
      margin: ${getSectionData('custom-message')?.styling?.margin || getSectionData('custom-message-section')?.styling?.margin || '24px 0'};
      ${getSectionData('custom-message')?.styling?.marginTop ? `margin-top: ${getSectionData('custom-message')?.styling?.marginTop};` : ''}
      ${getSectionData('custom-message')?.styling?.marginRight ? `margin-right: ${getSectionData('custom-message')?.styling?.marginRight};` : ''}
      ${getSectionData('custom-message')?.styling?.marginBottom ? `margin-bottom: ${getSectionData('custom-message')?.styling?.marginBottom};` : ''}
      ${getSectionData('custom-message')?.styling?.marginLeft ? `margin-left: ${getSectionData('custom-message')?.styling?.marginLeft};` : ''}
      padding: ${getSectionData('custom-message')?.styling?.padding || getSectionData('custom-message-section')?.styling?.padding || '0'};
      ${getSectionData('custom-message')?.styling?.paddingTop ? `padding-top: ${getSectionData('custom-message')?.styling?.paddingTop};` : ''}
      ${getSectionData('custom-message')?.styling?.paddingRight ? `padding-right: ${getSectionData('custom-message')?.styling?.paddingRight};` : ''}
      ${getSectionData('custom-message')?.styling?.paddingBottom ? `padding-bottom: ${getSectionData('custom-message')?.styling?.paddingBottom};` : ''}
      ${getSectionData('custom-message')?.styling?.paddingLeft ? `padding-left: ${getSectionData('custom-message')?.styling?.paddingLeft};` : ''}
    }
    .custom-header {
      background: ${userData.header?.styling?.backgroundColor || 'linear-gradient(135deg, #E10939 0%, #FF5470 100%)'};
      ${userData.header?.styling?.backgroundImage ? `background-image: url(${userData.header.styling.backgroundImage});` : ''}
      ${userData.header?.styling?.backgroundSize ? `background-size: ${userData.header.styling.backgroundSize};` : ''}
      ${userData.header?.styling?.backgroundPosition ? `background-position: ${userData.header.styling.backgroundPosition};` : ''}
      ${userData.header?.styling?.backgroundRepeat ? `background-repeat: ${userData.header.styling.backgroundRepeat};` : ''}
      ${userData.header?.styling?.backgroundAttachment ? `background-attachment: ${userData.header.styling.backgroundAttachment};` : ''}
      border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      -webkit-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      -moz-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      border-top-left-radius: ${userData.emailContainer?.borderRadius || '12px'};
      border-top-right-radius: ${userData.emailContainer?.borderRadius || '12px'};
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      padding: ${userData.header?.styling?.padding || '24px 32px'};
      text-align: ${userData.header?.styling?.textAlign || 'center'};
      margin: 0 0 24px 0;
      overflow: hidden;
    }
    .custom-header h1 {
      color: ${userData.header?.styling?.titleColor || '#ffffff'};
      font-size: ${userData.header?.styling?.titleFontSize || '32px'};
      font-weight: 700;
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    .custom-header p {
      color: ${userData.header?.styling?.subtitleColor || '#ffffff'};
      font-size: ${userData.header?.styling?.subtitleFontSize || '18px'};
      margin: 0;
      opacity: 0.9;
    }
    .custom-order-button {
      display: inline-block;
      background: ${userData.orderButton?.styling?.backgroundColor || 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)'};
      color: ${userData.orderButton?.styling?.color || '#ffffff'} !important;
      text-decoration: none !important;
      padding: ${userData.orderButton?.styling?.padding || '14px 28px'};
      border-radius: ${userData.orderButton?.styling?.borderRadius || '8px'};
      font-weight: ${userData.orderButton?.styling?.fontWeight || '600'};
      font-size: ${userData.orderButton?.styling?.fontSize || '16px'};
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
      line-height: 1.4;
      text-align: center;
      word-wrap: break-word;
      word-break: break-word;
      hyphens: auto;
      max-width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      vertical-align: middle;
    }
    .usage-steps {
      background: ${userData.usageSteps?.styling?.backgroundColor || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)'};
      border: 1px solid ${userData.usageSteps?.styling?.borderColor || '#93c5fd'};
      border-radius: ${userData.usageSteps?.styling?.borderRadius || '8px'};
      padding: ${userData.usageSteps?.styling?.padding || '20px'};
      margin: 24px 0;
    }
    .usage-steps h4 {
      color: ${userData.usageSteps?.styling?.titleColor || '#1d4ed8'};
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 12px 0;
    }
    .usage-steps ol {
      margin: 0;
      padding-left: 20px;
      color: ${userData.usageSteps?.styling?.textColor || '#1e40af'};
    }
    .usage-steps li {
      margin: 6px 0;
      font-size: 14px;
    }
    .custom-footer {
      background: ${userData.footer?.styling?.backgroundColor || '#f8fafc'};
      padding: ${userData.footer?.styling?.padding || '24px 32px'};
      text-align: ${userData.footer?.styling?.textAlign || 'center'};
      border-top: 1px solid ${userData.footer?.styling?.borderColor || '#e2e8f0'};
    }
    .custom-footer .footer-text {
      font-size: ${userData.footer?.styling?.fontSize || '14px'};
      color: ${userData.footer?.styling?.textColor || '#64748b'};
      margin: 0 0 8px 0;
      line-height: 1.5;
    }
    .custom-footer .footer-link {
      color: ${userData.footer?.styling?.linkColor || '#E10939'};
      text-decoration: none;
    }
    .cta-container {
      text-align: ${userData.orderButton?.styling?.textAlign || 'center'};
      margin: 32px 0;
      padding: 0 20px;
      overflow: hidden;
    }
    
    /* Mobile-specific styles */
    @media only screen and (max-width: 600px) {
      .email-container {
        max-width: ${userData.emailContainer?.mobileMaxWidth || '100%'} !important;
        padding: ${userData.emailContainer?.mobilePadding || '16px'} !important;
      }
      
      .greeting {
        font-size: calc(${getSectionData('greeting')?.styling?.fontSize || '18px'} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-message {
        font-size: calc(${getSectionData('custom-message')?.styling?.fontSize || '16px'} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-order-button {
        ${userData.emailContainer?.mobileButtonSize === 'full-width' ? 'width: calc(100% - 40px) !important; display: block !important; text-align: center !important; margin: 0 auto !important;' : ''}
        ${userData.emailContainer?.mobileButtonSize === 'large' ? 'padding: 16px 32px !important; font-size: 18px !important; min-height: 56px !important;' : ''}
        ${userData.emailContainer?.mobileButtonSize === 'small' ? 'padding: 10px 20px !important; font-size: 14px !important; min-height: 40px !important;' : ''}
        line-height: 1.3 !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        max-width: calc(100% - 40px) !important;
      }
      
      .promo-code-box {
        padding: 16px !important;
        margin: 16px 0 !important;
      }
      
      .promo-code {
        font-size: calc(${userData.promoCodeStyling?.fontSize || '24px'} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-header {
        padding: 20px 16px !important;
        border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    } !important;
        -webkit-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    } !important;
        -moz-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    } !important;
        border-top-left-radius: ${userData.emailContainer?.borderRadius || '12px'
    } !important;
        border-top-right-radius: ${userData.emailContainer?.borderRadius || '12px'
    } !important;
        overflow: hidden !important;
      }
      
      .custom-header h1 {
        font-size: calc(${userData.header?.styling?.titleFontSize || '32px'} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-header p {
        font-size: calc(${userData.header?.styling?.subtitleFontSize || '18px'} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .usage-steps {
        padding: 16px !important;
        margin: 16px 0 !important;
      }
      
      .custom-footer {
        padding: 20px 16px !important;
      }
    }
    
    /* Additional mobile email client compatibility */
    @media screen and (max-width: 480px) {
      .custom-header {
        border-radius: ${userData.emailContainer?.borderRadius || '12px'} ${userData.emailContainer?.borderRadius || '12px'} 0 0 !important;
        -webkit-border-top-left-radius: ${userData.emailContainer?.borderRadius || '12px'} !important;
        -webkit-border-top-right-radius: ${userData.emailContainer?.borderRadius || '12px'} !important;
        -webkit-border-bottom-left-radius: 0 !important;
        -webkit-border-bottom-right-radius: 0 !important;
      }
    }
    
    /* Gmail mobile app specific fixes */
    u + .body .custom-header {
      border-radius: ${userData.emailContainer?.borderRadius || '12px'} ${userData.emailContainer?.borderRadius || '12px'} 0 0 !important;
    }
    
    /* Outlook mobile app specific fixes */
    .ExternalClass .custom-header {
      border-radius: ${userData.emailContainer?.borderRadius || '12px'} ${userData.emailContainer?.borderRadius || '12px'} 0 0 !important;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="custom-header" style="
      background: ${userData.header?.styling?.backgroundColor || 'linear-gradient(135deg, #E10939 0%, #FF5470 100%)'};
      border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      -webkit-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      -moz-border-radius: ${userData.header?.styling?.borderRadius ||
    (userData.emailContainer?.borderRadius ?
      `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` :
      '12px 12px 0 0')
    };
      border-top-left-radius: ${userData.emailContainer?.borderRadius || '12px'};
      border-top-right-radius: ${userData.emailContainer?.borderRadius || '12px'};
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      padding: ${userData.header?.styling?.padding || '24px 32px'};
      text-align: ${userData.header?.styling?.textAlign || 'center'};
      margin: 0 0 24px 0;
      overflow: hidden;
    ">
      <img 
        src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png"
        alt="Local Cooks" 
        style="max-width: 280px; height: auto; display: block; margin: 0 auto${userData.header?.title ? '; margin-bottom: 16px' : ''}"
      />
      ${userData.header?.title ? `<h1 style="color: ${userData.header?.styling?.titleColor || '#ffffff'}; font-size: ${userData.header?.styling?.titleFontSize || '32px'}; font-weight: 700; margin: 0 0 8px 0; line-height: 1.2;">${userData.header.title}</h1>` : ''}
      ${userData.header?.subtitle ? `<p style="color: ${userData.header?.styling?.subtitleColor || '#ffffff'}; font-size: ${userData.header?.styling?.subtitleFontSize || '18px'}; margin: 0; opacity: 0.9;">${userData.header.subtitle}</p>` : ''}
    </div>
    <div class="content">
      <!-- Enhanced Email Design -->
      <h2 class="greeting">${finalGreeting}</h2>
      
      ${generateDivider()}
      
      <div class="custom-message">
        ${finalMessage}
      </div>
      
      ${generateDivider()}
      
      ${userData.promoCode ? `
        <div style="text-align: center; margin: 32px 0;">
          <div class="promo-label" style="margin-bottom: 12px;">${userData.promoCodeLabel || 'Use promo code:'}</div>
          <div class="promo-code-box">
            <div class="promo-code">${userData.promoCode}</div>
          </div>
        </div>
        ${generateDivider()}
      ` : ''}

      <!-- Usage Steps Section (Always Show Unless Explicitly Disabled) -->
      ${userData.usageSteps?.enabled !== false ? generateUsageStepsSection() : ''}

      <!-- Custom Sections (if any) -->
      ${userData.sections && (Array.isArray(userData.sections) ? userData.sections.length > 0 : Object.keys(userData.sections).length > 0) ?
      generateAdvancedSections(Array.isArray(userData.sections) ? userData.sections : Object.values(userData.sections)) + generateDivider()
      : ''
    }
      
      <!-- Call to Action Button -->
      <div class="cta-container">
        <a href="${userData.orderButton?.url || getPromoUrl()}" class="custom-order-button">
          ${userData.orderButton?.text || '🌟 Start Shopping Now'}
        </a>
      </div>
      
      <div class="divider"></div>
    </div>
    <div class="custom-footer">
      ${userData.footer?.mainText ? `<p class="footer-text"><strong>${userData.footer.mainText}</strong></p>` : `<p class="footer-text">Thank you for being part of the <strong>${organizationName}</strong> community!</p>`}
      
      ${userData.footer?.showContact !== false && userData.footer?.contactText ? `
        <p class="footer-text">
          ${userData.footer.contactText.includes('@') ?
        userData.footer.contactText.replace(/(\S+@\S+)/g, '<a href="mailto:$1" class="footer-link">$1</a>') :
        userData.footer.contactText
      }
        </p>
      ` : userData.footer?.showContact !== false ? `
        <p class="footer-text">Questions? Contact us at <a href="mailto:${supportEmail}" class="footer-link">${supportEmail}</a>.</p>
      ` : ''}
      
      ${userData.footer?.showCopyright !== false ? `
        <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, ${userData.footer?.styling?.borderColor || '#e2e8f0'} 50%, transparent 100%); margin: 16px 0;"></div>
        <p class="footer-text" style="opacity: 0.8; font-size: ${userData.footer?.styling?.fontSize ? (parseInt(userData.footer.styling.fontSize) - 2) + 'px' : '12px'};">
          ${userData.footer?.copyrightText || `&copy; ${new Date().getFullYear()} ${organizationName}. All rights reserved.`}
        </p>
      ` : ''}
      
      <!-- Unsubscribe Link -->
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid ${userData.footer?.styling?.borderColor || '#e2e8f0'};">
        <p style="text-align: center; font-size: 11px; color: #6b7280; margin: 0;">
          Don't want to receive these emails? 
          <a href="${getWebsiteUrl()}/unsubscribe?email=${encodeURIComponent(userData.email)}" 
             style="color: #E10939; text-decoration: underline;">
            Unsubscribe here
          </a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject,
    text: generatePlainText(userData.email, userData.promoCode, finalMessage),
    html: prepareEmailHtml(html),
    headers: {
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'Importance': 'Normal',
      'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`
    }
  };
};

// Generate consolidated document approval email for chefs when all documents are approved
export const generateChefAllDocumentsApprovedEmail = (
  userData: {
    fullName: string;
    email: string;
    approvedDocuments: string[];
    adminFeedback?: string;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];
  const subject = 'All Documents Approved - Local Cooks';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">All your submitted documents have been approved by our verification team. You are now fully verified and can start using Local Cooks as a chef.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; All Documents Approved</span>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Approved documents:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        ${userData.approvedDocuments.map(doc => `<tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">${doc}</td>
        </tr>`).join('')}
      </table>
      ${userData.adminFeedback ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Feedback:</span> <strong style="color: #1e293b;">${userData.adminFeedback}</strong></p>
      </div>` : ''}
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Access Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Warmly,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

All your submitted documents have been approved by our verification team. You are now fully verified and can start using Local Cooks as a chef.

Approved documents:
${userData.approvedDocuments.map(doc => `• ${doc}`).join('\n')}

${userData.adminFeedback ? `Feedback: ${userData.adminFeedback}\n\n` : ''}Access your dashboard: ${getDashboardUrl()}

If you have any questions, contact us at support@localcooks.ca

Warmly,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};


// ===================================
// KITCHEN BOOKING EMAILS
// ===================================

export const generateManagerMagicLinkEmail = (userData: { email: string; name: string; resetToken: string }): EmailContent => {
  const subject = 'Set Up Your Manager Account - Local Cooks';
  const firstName = userData.name.split(' ')[0];
  const baseUrl = getSubdomainUrl('kitchen');
  const resetUrl = `${baseUrl}/password-reset?token=${userData.resetToken}&role=manager`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your manager account has been created for the Local Cooks commercial kitchen booking system.</p>
      <p class="message" style="margin-bottom: 10px;">Click the button below to set up your password and access your manager dashboard. Once set up, you&#8217;ll be able to:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Manage kitchen schedules and availability</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">View and approve booking requests from chefs</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Set up your location&#8217;s pricing and policies</td>
        </tr>
      </table>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${resetUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Set Up Password</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Your manager account has been created for the Local Cooks commercial kitchen booking system.

Set up your password: ${resetUrl}

Once set up, you'll be able to:
• Manage kitchen schedules and availability
• View and approve booking requests from chefs
• Set up your location's pricing and policies

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: userData.email, subject, text, html: prepareEmailHtml(html) };
};

// Manager credentials email with username and password
export const generateManagerCredentialsEmail = (userData: { email: string; name: string; username: string; password: string }): EmailContent => {
  const subject = 'Your Manager Account - Local Cooks';
  const firstName = (userData.name || 'Manager').split(' ')[0];
  const loginUrl = `${getSubdomainUrl('kitchen')}/manager/login`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your manager account has been created for the Local Cooks kitchen booking system.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Your login credentials:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Username:</span> <strong style="color: #1e293b; font-family: 'Courier New', monospace;">${userData.username}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Password:</span> <strong style="color: #1e293b; font-family: 'Courier New', monospace;">${userData.password}</strong></p>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #92400e; margin: 0;"><strong>Important:</strong> Please change your password after your first login for security.</p>
      </div>
      <p class="message" style="margin-bottom: 20px;">You&#8217;ll be able to manage kitchen schedules, view bookings, and set up availability for your locations.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${loginUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Login Now</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Your manager account has been created for the Local Cooks kitchen booking system.

Your login credentials:
Username: ${userData.username}
Password: ${userData.password}

Important: Please change your password after your first login for security.

Login at: ${loginUrl}

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: userData.email, subject, text, html: prepareEmailHtml(html) };
};

export type EmailBookingDay = { id: number; date: string; startTime: string; endTime: string; operatingWindowStartTime?: string | null; pricingMode?: string | null; cancelled?: boolean };
export function bookingDaysSummary(days: EmailBookingDay[], locale = 'en-CA') {
  return days.map(day => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00Z`))).join(', ')
    + ` · ${tEmail(locale, 'bookingDaysCount', { count: days.length })}`;
}
export function datedBookingCalendarAttachment(booking: BookingCalendarInput, recipient: string, kitchen: string, location: string, timezone: string) {
  return { filename: 'kitchen-booking.ics', content: bookingCalendarParts(booking, recipient, kitchen, location, '', timezone).ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' };
}
type BookingEmailContext = {
  days?: EmailBookingDay[]; totalCents?: number;
  locale?: string | null; timezone?: string; bookingId?: number; referenceCode?: string | null;
  locationAddress?: string; locationName?: string; kitchenName?: string; storageBookingId?: number;
  bookingDate?: string | Date; startTime?: string; endTime?: string;
};

/** Older queued receipts/outcomes can still reach delivery with legacy markup. */
export function bookingDeliveryEmail(content: EmailContent, emailType?: string): EmailContent {
  const storageCheckout = /^Storage Checkout\b/i.test(content.subject);
  if (!storageCheckout && emailType !== 'lifecycle_outcome_attempt' && emailType !== 'booking') return content;
  if (content.html?.includes('class="email-title"')) return content;
  const recorded = content.text || '';
  const url = recorded.match(/https?:\/\/[^\s]+/g)?.at(-1)
    || content.html?.match(/href="(https?:\/\/[^"\s]+)"/g)?.at(-1)?.slice(6, -1)
    || (storageCheckout ? `${getSubdomainUrl(/Request/i.test(content.subject) ? 'kitchen' : 'chef')}/${/Request/i.test(content.subject) ? 'manager/dashboard?view=storage-checkouts' : 'dashboard?view=damage-claims'}` : getDashboardUrl());
  const facts = Array.from(recorded.matchAll(/^(Kitchen|Storage|Reference|Chef|End Date):\s*(.+)$/gm))
    .map(match => ({ label: match[1], value: match[2] }));
  const heading = storageCheckout ? /Request/i.test(content.subject) ? 'Storage checkout needs review' : 'Storage checkout claim filed' : content.subject;
  const text = recorded.replace(/https?:\/\/[^\s]+/g, '')
    .replace(/^Payment captured:\s*((?:CAD\s*)?\$[\d,.]+)[^\n]*/gm, 'Total paid: $1')
    .replace(/^(?:Service fee|HST|Tax)(?:\s|:|\()[^\n]*\n?/gmi, '')
    .replace(/\bAmerica\/[A-Za-z_/-]+\b/g, zone => emailZoneName(zone))
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g, instant => emailLocalDateTime(instant, 'UTC'))
    .replace(/\b(?:[01]\d|2[0-3]):[0-5]\d\b(?!\s*(?:a\.m\.|p\.m\.))/g, time => emailClock(time))
    .trim();
  return { ...renderTransactionalEmail({ to: content.to, subject: content.subject, heading,
    recipientName: 'there', message: text, facts,
    actionLabel: storageCheckout ? /Request/i.test(content.subject) ? 'Review checkout' : 'View claim' : 'View current record', actionUrl: url }),
    attachments: content.attachments, headers: content.headers };
}

export function emailZoneName(timezone = DEFAULT_TIMEZONE, locale = 'en-CA', date = new Date()) {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: 'longGeneric' })
    .formatToParts(date).find(part => part.type === 'timeZoneName')?.value || tEmail(locale, 'bookingLocalTime');
}

export function emailClock(time: string, locale = 'en-CA') {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(`2000-01-01T${time.slice(0, 5)}:00Z`)).replace(/\s?(AM|PM)$/i, (_, period: string) => ` ${period.toLowerCase() === 'am' ? 'a.m.' : 'p.m.'}`);
}

export function emailLocalDateTime(value: Date | string, timezone = DEFAULT_TIMEZONE, locale = 'en-CA') {
  const date = new Date(value);
  return `${new Intl.DateTimeFormat(locale, { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true }).format(date)} · ${emailZoneName(timezone, locale, date)}`;
}

/** For use inside sentences: "Oct 14, 2026, 3:00 p.m. Newfoundland Time" (fact rows keep the dot form). */
export function emailLocalDateTimeSentence(value: Date | string, timezone = DEFAULT_TIMEZONE, locale = 'en-CA') {
  return emailLocalDateTime(value, timezone, locale).replace(' · ', ' ');
}

function emailDate(value: Date | string, locale = 'en-CA') {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

export function bookingEmailFacts(data: BookingEmailContext, timeLabel?: string) {
  const locale = data.locale || 'en-CA';
  const fact = (key: string, value: string) => ({ label: tEmail(locale, key), value });
  return [
    ...(data.kitchenName ? [fact('bookingKitchen', data.kitchenName)] : []),
    ...(data.locationName && data.locationName !== data.kitchenName ? [fact('bookingLocation', data.locationName)] : []),
    ...(data.locationAddress ? [fact('bookingAddress', data.locationAddress)] : []),
    ...(data.days?.length ? [fact('bookingDate', bookingDaysSummary(data.days, locale)), ...data.days.map(day => ({ label: emailDate(day.date, locale), value: `${emailClock(day.startTime, locale)}–${emailClock(day.endTime, locale)} · ${emailZoneName(data.timezone, locale)}` }))]
      : data.bookingDate ? [fact('bookingDate', emailDate(data.bookingDate, locale))] : []),
    ...(!data.days?.length && (timeLabel || data.startTime && data.endTime) ? [fact('bookingTime', `${timeLabel || `${emailClock(data.startTime!, locale)}–${emailClock(data.endTime!, locale)}`} · ${emailZoneName(data.timezone, locale)}`)] : []),
    ...(data.referenceCode ? [fact('bookingReference', data.referenceCode)] : []),
  ];
}

function renderBookingNotice(data: BookingEmailContext, input: {
  to: string; recipientName: string; key: string; action: string; url: string;
  copy?: { title: string; message: string };
  params?: Record<string, unknown>; actions?: { label: string; url: string }[]; messageKey?: string; timeLabel?: string; facts?: { label: string; value: string }[];
}) {
  const params = { kitchen: data.kitchenName || data.locationName, ...input.params };
  const heading = input.copy?.title ?? tEmail(data.locale, `${input.key}Heading`, params);
  return renderTransactionalEmail({ to: input.to, recipientName: input.recipientName, locale: data.locale,
    subject: heading, heading, message: input.copy?.message ?? tEmail(data.locale, input.messageKey || `${input.key}Body`, params),
    facts: [...bookingEmailFacts(data, input.timeLabel), ...(input.facts || [])], actionLabel: tEmail(data.locale, input.action), actionUrl: input.url, actions: input.actions });
}

type BookingRequestEmailDetails = BookingCalendarInput & {
  chefName: string; kitchenName: string; specialNotes?: string; timezone?: string; locale?: string | null; responseDeadline?: string | Date; totalCents?: number; paymentState?: 'held' | 'pending' | 'paid';
  locationName?: string; locationAddress?: string; referenceCode?: string | null;
};

export function bookingResponseDeadline(createdAt: Date | string, startAt?: Date | string, bufferHours = 1) {
  return resolveResponseDeadline({ createdAt, startAt: startAt ?? new Date(new Date(createdAt).getTime() + AUTH_EXPIRY_HOURS * 3600000),
    windowHours: AUTH_EXPIRY_HOURS, bufferHours: startAt === undefined ? 0 : bufferHours });
}

export const generateBookingNotificationEmail = (data: BookingRequestEmailDetails & { managerEmail: string; managerName?: string; bookingId: number }, copy?: { title: string; message: string }): EmailContent => {
  const calendar = bookingCalendarParts(data, data.managerEmail, data.kitchenName, data.locationAddress || data.kitchenName, '', data.timezone || DEFAULT_TIMEZONE);
  const deadline = data.responseDeadline ? emailLocalDateTimeSentence(data.responseDeadline, data.timezone, data.locale || 'en-CA') : tEmail(data.locale, 'bookingDeadlineOnPage');
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: data.managerName || tEmail(data.locale, "bookingManager"),
    key: 'bookingNewRequest', copy, messageKey: data.paymentState && data.paymentState !== 'held' ? 'bookingNewRequestPendingBody' : undefined, params: { chef: data.chefName, deadline }, action: 'bookingReviewRequest',
    url: getSubdomainUrl('kitchen') + (data.bookingId ? '/manager/booking/' + data.bookingId : '/dashboard?view=bookings'),
    timeLabel: calendar.timeLabel, facts: [...(data.specialNotes ? [{ label: tEmail(data.locale, 'bookingChefMessage'), value: data.specialNotes }] : []),
      ...(data.totalCents != null ? [{ label: tEmail(data.locale, data.paymentState === 'paid' ? 'bookingTotalPaid' : data.paymentState === 'pending' ? 'bookingEstimatedTotal' : 'bookingTotalHold'), value: `CAD $${(data.totalCents / 100).toFixed(2)}` }] : [])] });
};


// Booking cancellation notification email for managers (when chef cancels)
export const generateBookingCancellationNotificationEmail = (bookingData: { managerEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(bookingData, { to: bookingData.managerEmail, recipientName: tEmail(bookingData.locale, 'bookingManager'), key: 'bookingCancelled', action: 'bookingViewBookings', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=bookings', params: { chef: bookingData.chefName }, facts: bookingData.cancellationReason ? [{ label: tEmail(bookingData.locale, 'bookingReason'), value: bookingData.cancellationReason }] : [] });
};

// Booking confirmed notification email for managers (when manager confirms a booking)

export const generateBookingRequestEmail = (data: BookingRequestEmailDetails & { chefEmail: string }): EmailContent => {
  const calendar = bookingCalendarParts(data, data.chefEmail, data.kitchenName, data.locationAddress || data.kitchenName, '', data.timezone || DEFAULT_TIMEZONE);
  const deadline = data.responseDeadline ? emailLocalDateTimeSentence(data.responseDeadline, data.timezone, data.locale || 'en-CA') : tEmail(data.locale, 'bookingDeadlineOnPage');
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName,
    key: 'bookingRequestSent', messageKey: data.paymentState === 'pending' ? 'bookingRequestPendingBody' : data.paymentState === 'paid' ? 'bookingRequestPaidBody' : undefined, params: { chef: data.chefName, deadline }, action: 'bookingViewRequest',
    url: getSubdomainUrl('chef') + (data.bookingId ? '/booking/' + data.bookingId : '/dashboard?view=bookings'),
    timeLabel: calendar.timeLabel, facts: [...(data.specialNotes ? [{ label: tEmail(data.locale, 'bookingYourNote'), value: data.specialNotes }] : []),
      ...(data.totalCents != null ? [{ label: tEmail(data.locale, data.paymentState === 'paid' ? 'bookingTotalPaid' : data.paymentState === 'pending' ? 'bookingEstimatedTotal' : 'bookingTotalHold'), value: `CAD $${(data.totalCents / 100).toFixed(2)}` }] : [])] });
};

export type ArrivalMode = 'staffed' | 'self' | 'mixed' | 'legacy';
export function arrivalModeLine(mode: ArrivalMode = 'legacy', locale?: string | null, short = false) {
  return tEmail(locale, `${short ? 'arrivalAction' : 'arrivalMode'}${mode[0].toUpperCase()}${mode.slice(1)}`);
}

export const generateBookingConfirmationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; locationAddress?: string; addons?: string; declinedAddons?: string; checkInWindowMinutesBefore?: number; noShowGraceMinutes?: number; operatingWindowStartTime?: string | null; durationHours?: number; selectedSlots?: unknown; bookingId?: number; actionUrl?: string; isStaff?: boolean; checkinEnabled?: boolean; checkoutEnabled?: boolean; arrivalInstructions?: string; departureInstructions?: string; contactEmail?: string; paymentSummary?: string; locale?: string | null; arrivalMode?: ArrivalMode; instructionsReleased?: boolean; instructionsReleaseAt?: string; preparationHours?: number; visitGuidance?: string; referenceCode?: string | null; totalCents?: number; payoutCents?: number; processingFeeCents?: number; payoutAfterCloseout?: boolean; reservationChefName?: string; cancellationPolicyHours?: number; cancellationDeadline?: string; receiptUrl?: string; isAdmin?: boolean; days?: EmailBookingDay[]; scheduleRevision?: number }): EmailContent => {
  const locale = bookingData.locale || 'en-CA';
  const timezone = bookingData.timezone || DEFAULT_TIMEZONE;
  const staff = bookingData.isStaff;
  const heading = tEmail(locale, staff ? 'bookingStaffConfirmedHeading' : 'bookingConfirmedHeading', { chef: bookingData.reservationChefName || bookingData.chefName });
  const url = bookingData.actionUrl || getSubdomainUrl(staff ? 'kitchen' : 'chef') + (bookingData.bookingId ? `${staff ? '/manager' : ''}/booking/${bookingData.bookingId}` : '/dashboard?view=bookings');
  const calendar = bookingCalendarParts(bookingData, bookingData.chefEmail, `Kitchen booking · ${bookingData.kitchenName}`,
    bookingData.locationAddress || bookingData.locationName || bookingData.kitchenName, heading, timezone);
  const overview = bookingData.instructionsReleaseAt ? tEmail(locale, 'instructionsReleaseOverview', {
    releaseAt: emailLocalDateTimeSentence(bookingData.instructionsReleaseAt, timezone, locale), hours: bookingData.preparationHours ?? 48 }) : tEmail(locale, 'bookingReleaseOnPage');
  const managerBody = bookingData.arrivalMode === 'self' ? 'bookingManagerSelfBody' : bookingData.arrivalMode === 'mixed'
    ? 'bookingManagerMixedBody' : bookingData.arrivalMode === 'staffed' ? 'bookingManagerStaffedBody' : 'bookingManagerLegacyBody';
  const guidance = staff ? tEmail(locale, bookingData.isAdmin ? 'bookingAdminConfirmedBody' : managerBody, { chef: bookingData.reservationChefName || bookingData.chefName })
    : bookingData.visitGuidance || [arrivalModeLine(bookingData.arrivalMode, locale), (bookingData.days?.filter(day => !day.cancelled).length ?? 0) > 1 ? tEmail(locale, 'arrivalEachDay') : '', bookingData.instructionsReleased
      ? [tEmail(locale, 'instructionsReleased'), bookingData.arrivalInstructions ? `Arrival instructions: ${bookingData.arrivalInstructions}` : '',
        bookingData.departureInstructions ? `Departure instructions: ${bookingData.departureInstructions}` : ''].filter(Boolean).join('\n') : overview].filter(Boolean).join('\n');
  const cancellation = !staff && bookingData.cancellationDeadline ? tEmail(locale, 'bookingCancellationPolicy', {
    deadline: emailLocalDateTimeSentence(bookingData.cancellationDeadline, timezone, locale), hours: bookingData.cancellationPolicyHours ?? 24 }) : '';
  // Staff see what the kitchen actually receives: manager revenue minus the card processing fee (same figure as the manager page).
  const total = staff ? (bookingData.payoutCents == null ? undefined : Math.max(0, bookingData.payoutCents - Math.max(0, bookingData.processingFeeCents ?? 0))) : bookingData.totalCents;
  // Legacy structured inputs can contain a breakdown; retain only their captured total.
  const legacyTotal = bookingData.paymentSummary?.match(/(?:CAD\s*)?\$[\d,.]+/)?.[0];
  const content = renderTransactionalEmail({ to: bookingData.chefEmail, locale, recipientName: bookingData.chefName || 'there', subject: heading, heading,
    message: [guidance, cancellation, staff && !bookingData.isAdmin && bookingData.payoutAfterCloseout ? tEmail(locale, 'bookingManagerPayoutAfterCloseout') : ''].filter(Boolean).join('\n\n'),
    facts: [...bookingEmailFacts(bookingData, calendar.timeLabel),
      ...(total != null || !staff && legacyTotal ? [{ label: tEmail(locale, staff ? 'bookingEstimatedPayout' : 'bookingTotalPaid'), value: total != null ? `CAD $${(total / 100).toFixed(2)}` : legacyTotal! }] : []),
      ...(bookingData.contactEmail ? [{ label: tEmail(locale, 'bookingContact'), value: bookingData.contactEmail }] : []),
      ...(bookingData.addons ? [{ label: tEmail(locale, 'bookingAddons'), value: bookingData.addons }] : []),
      // Requested items the kitchen declined: stated in the confirmation so nobody plans around them.
      ...(bookingData.declinedAddons ? [{ label: tEmail(locale, 'bookingNotIncluded'), value: tEmail(locale, staff ? 'bookingNotIncludedStaff' : 'bookingNotIncludedChef', { items: bookingData.declinedAddons }) }] : [])],
    actionLabel: tEmail(locale, 'bookingOpen'), actionUrl: url,
    actions: [...calendar.links.map(link => ({ label: `${tEmail(locale, 'bookingGoogleCalendar')} · ${link.label}`, url: link.url })),
      ...(bookingData.receiptUrl ? [{ label: tEmail(locale, staff ? 'bookingPayoutStatement' : 'bookingReceipt'), url: bookingData.receiptUrl }] : [])],
    note: tEmail(locale, staff ? 'bookingStaffChanges' : 'bookingChefChanges', { contact: bookingData.contactEmail || getSupportEmail() }) });
  return { ...content, attachments: [{ filename: 'kitchen-booking.ics', content: calendar.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] };
};

export const generateBookingCancellationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(bookingData, { to: bookingData.chefEmail, recipientName: bookingData.chefName, key: 'bookingCancelled', action: 'bookingBrowse', url: getSubdomainUrl('chef') + '/book-kitchen', params: {}, facts: bookingData.cancellationReason ? [{ label: tEmail(bookingData.locale, 'bookingReason'), value: bookingData.cancellationReason }] : [] });
};

// Kitchen availability change notification email for chefs

// Kitchen settings change notification email for chefs and managers
export const generateKitchenSettingsChangeEmail = (data: { email: string; name: string; kitchenName: string; changes: string; isChef: boolean } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.email, recipientName: data.name, key: 'bookingSettings', action: 'bookingViewKitchen', url: getSubdomainUrl(data.isChef ? 'chef' : 'kitchen') + (data.isChef ? '/book-kitchen' : '/manager/dashboard?view=settings'), params: {}, facts: [{ label: tEmail(data.locale, 'bookingChanges'), value: data.changes }] });
};

// Chef profile request notification email for managers
export const generateChefProfileRequestEmail = (data: { managerEmail: string; chefName: string; chefEmail: string; locationName: string; locationId: number } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: tEmail(data.locale, 'bookingManager'), key: 'bookingAccessRequest', action: 'bookingReviewAccess', url: getSubdomainUrl('kitchen') + '/manager/applications', params: { chef: data.chefName }, facts: [{ label: tEmail(data.locale, 'bookingChef'), value: data.chefName }] });
};

// Chef location access approved notification email for chefs
export const generateChefLocationAccessApprovedEmail = (data: { chefEmail: string; chefName: string; locationName: string; locationId: number } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingAccessApproved', action: 'bookingBrowse', url: getSubdomainUrl('chef') + '/book-kitchen', params: {}, facts: [] });
};

// Chef kitchen access approved notification email for chefs (when manager approves kitchen profile)

// Location notification email changed notification email
export const generateLocationEmailChangedEmail = (data: { email: string; locationName: string; locationId: number } & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.email, recipientName: tEmail(data.locale, 'bookingManager'), key: 'bookingNotificationChanged', action: 'bookingViewKitchen', url: getSubdomainUrl('kitchen') + '/manager/dashboard', params: {}, facts: [{ label: tEmail(data.locale, 'bookingEmail'), value: data.email }] });
};

// ===================================
// STORAGE EXTENSION EMAILS
// ===================================

// Storage extension payment received - notify manager
export function generateStorageCheckoutEmail(data: BookingEmailContext & {
  to: string; recipientName: string; kind: 'request' | 'claim'; storageBookingId: number;
  storageName: string; chefName?: string; endDate?: Date | string; claimId?: number; claimTitle?: string;
}) {
  const key = data.kind === 'request' ? 'bookingStorageCheckout' : 'bookingStorageClaim';
  const url = data.kind === 'request' ? `${getSubdomainUrl('kitchen')}/manager/dashboard?view=storage-checkouts`
    : `${getSubdomainUrl('chef')}/dashboard?view=damage-claims&claimId=${data.claimId}`;
  return renderBookingNotice({ ...data, referenceCode: data.referenceCode || `SB-${data.storageBookingId}` }, {
    to: data.to, recipientName: data.recipientName, key,
    params: { chef: data.chefName, storage: data.storageName },
    action: data.kind === 'request' ? 'bookingReviewStorageCheckout' : 'bookingViewClaim', url,
    facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName },
      ...(data.chefName ? [{ label: tEmail(data.locale, 'bookingChef'), value: data.chefName }] : []),
      ...(data.endDate ? [{ label: tEmail(data.locale, 'bookingEnd'), value: emailDate(data.endDate, data.locale || 'en-CA') }] : []),
      ...(data.claimTitle ? [{ label: tEmail(data.locale, 'bookingClaim'), value: data.claimTitle }] : [])] });
}

export const generateStorageExtensionPendingApprovalEmail = (data: {
  managerEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
  totalPrice: number;
  locationName?: string;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: tEmail(data.locale, 'bookingManager'), key: 'bookingStorageRequest', action: 'bookingReviewStorage', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=storage-bookings', params: { storage: data.storageName, chef: data.chefName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingNewEnd'), value: emailDate(data.newEndDate, data.locale || 'en-CA') }, { label: tEmail(data.locale, 'bookingEstimatedTotal'), value: `CAD $${(data.totalPrice / 100).toFixed(2)}` }] });
};

// Storage extension payment received - notify chef
export const generateStorageExtensionPaymentReceivedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
  totalPrice: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingStoragePayment', action: 'bookingViewStorage', url: getSubdomainUrl('chef') + '/dashboard?view=bookings', params: { storage: data.storageName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingNewEnd'), value: emailDate(data.newEndDate, data.locale || 'en-CA') }, { label: tEmail(data.locale, 'bookingTotalPaid'), value: `CAD $${(data.totalPrice / 100).toFixed(2)}` }] });
};

// Storage extension approved - notify chef
export const generateStorageExtensionApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingStorageApproved', action: 'bookingViewStorage', url: getSubdomainUrl('chef') + '/dashboard?view=bookings', params: { storage: data.storageName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingNewEnd'), value: emailDate(data.newEndDate, data.locale || 'en-CA') }] });
};

// Storage extension rejected - notify chef
export const generateStorageExtensionRejectedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  rejectionReason?: string;
  refundAmount?: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingStorageDeclined', action: 'bookingViewStorage', url: getSubdomainUrl('chef') + '/dashboard?view=bookings', params: { storage: data.storageName }, actions: data.refundAmount && data.storageBookingId ? [{ label: tEmail(data.locale, 'bookingReceipt'), url: `${getSubdomainUrl('chef')}/api/chef/invoices/storage/${data.storageBookingId}` }] : [], facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, ...(data.rejectionReason ? [{ label: tEmail(data.locale, 'bookingReason'), value: data.rejectionReason }] : []), ...(data.refundAmount ? [{ label: tEmail(data.locale, 'bookingRefund'), value: `CAD $${(data.refundAmount / 100).toFixed(2)}. ${tEmail(data.locale, 'bookingRefundDestination')}` }] : [])] });
};

// ===================================
// OVERSTAY PENALTY NOTIFICATION EMAILS
// ===================================

// Chef warning: Storage booking is expiring soon

// Chef notice: Overstay detected, penalty pending manager review
export const generateOverstayDetectedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  endDate: Date;
  daysOverdue: number;
  gracePeriodEndsAt: Date;
  isInGracePeriod: boolean;
  calculatedPenaltyCents: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingOverstay', action: 'bookingViewStorage', url: getSubdomainUrl('chef') + '/dashboard?view=bookings', params: { storage: data.storageName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingEnd'), value: emailDate(data.endDate, data.locale || 'en-CA') }, { label: tEmail(data.locale, 'bookingGraceEnd'), value: emailDate(data.gracePeriodEndsAt, data.locale || 'en-CA') }, { label: tEmail(data.locale, 'bookingEstimatedTotal'), value: `CAD $${(data.calculatedPenaltyCents / 100).toFixed(2)}` }] });
};

// Chef notice: Penalty charged
export const generatePenaltyChargedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  penaltyAmountCents: number;
  daysOverdue: number;
  chargeDate: Date;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingPenaltyCharged', action: 'bookingViewStorage', url: getSubdomainUrl('chef') + '/dashboard?view=bookings', params: { storage: data.storageName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingDate'), value: emailDate(data.chargeDate, data.locale || 'en-CA') }, { label: tEmail(data.locale, 'bookingTotalPaid'), value: `CAD $${(data.penaltyAmountCents / 100).toFixed(2)}` }] });
};

// Chef notice: Penalty approved by manager (charge pending)

// Chef notice: Penalty waived by manager

// Manager notice: New overstay requires review
export const generateOverstayManagerNotificationEmail = (data: {
  managerEmail: string;
  chefName: string;
  chefEmail: string;
  storageName: string;
  kitchenName: string;
  endDate: Date;
  daysOverdue: number;
  gracePeriodEndsAt: Date;
  isInGracePeriod: boolean;
  calculatedPenaltyCents: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: tEmail(data.locale, 'bookingManager'), key: 'bookingManagerOverstay', action: 'bookingReviewStorage', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=overstays', params: { storage: data.storageName, chef: data.chefName }, facts: [{ label: tEmail(data.locale, 'bookingStorage'), value: data.storageName }, { label: tEmail(data.locale, 'bookingEnd'), value: emailDate(data.endDate, data.locale || 'en-CA') }] });
};

// ===================================
// KITCHEN APPLICATION EMAILS
// Use the same escaped, responsive HTML/plain-text shell as kitchen tours.
type KitchenApplicationEmailDetails = {
  applicationId?: number;
  locationName: string;
  locationAddress?: string;
  chefName: string;
  chefEmail: string;
  conversationId?: string | null;
};
type KitchenManagerApplicationEmailDetails = KitchenApplicationEmailDetails & {
  managerEmail: string; managerName?: string; submittedAt?: Date;
};
const kitchenApplicationReference = (data: KitchenApplicationEmailDetails) => data.applicationId ? ' · APPLICATION-' + data.applicationId : '';
const kitchenApplicationEmailUrl = (data: KitchenApplicationEmailDetails, role: 'chef' | 'kitchen' | 'admin' = 'chef') =>
  getSubdomainUrl(role) + (role === 'admin' ? '/admin?section=kitchen-applications-step1' : role === 'kitchen' ? '/manager/dashboard?view=applications' : '/dashboard?view=kitchen-requests') + (data.applicationId ? '&application=' + data.applicationId : '');
// The kitchen calls the person booking its "customer" (owner, Oct 21); Local Cooks staff keep "Chef".
const kitchenApplicationFacts = (data: KitchenApplicationEmailDetails, includeChef: false | 'admin' | 'kitchen' = false) => [
  ...(includeChef ? [{ label: includeChef === 'kitchen' ? 'Customer' : 'Chef', value: data.chefName }, { label: includeChef === 'kitchen' ? 'Customer email' : 'Chef email', value: data.chefEmail }] : []),
  { label: 'Kitchen location', value: data.locationName },
  ...(data.locationAddress ? [{ label: 'Address', value: data.locationAddress, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.locationAddress) }] : []),
  ...(data.applicationId ? [{ label: 'Reference', value: 'APPLICATION-' + data.applicationId }] : []),
];
const kitchenApplicationMessageLink = (data: KitchenApplicationEmailDetails, role: 'chef' | 'kitchen') => data.conversationId
  ? { label: role === 'chef' ? 'Message kitchen manager' : 'Message customer', url: getSubdomainUrl(role) + (role === 'chef' ? '/dashboard' : '/manager/dashboard') + '?view=messages&conversation=' + encodeURIComponent(data.conversationId) + '&action=message' }
  : undefined;

export const generateKitchenApplicationAdminEmail = (data: KitchenApplicationEmailDetails & { recipientEmail: string; documentsSubmitted?: boolean; submittedAt?: Date }): EmailContent =>
  renderTransactionalEmail({ to: data.recipientEmail, recipientName: 'Local Cooks',
    subject: (data.documentsSubmitted ? 'Booking requirements submitted — ' : 'Request to apply received — ') + data.locationName + kitchenApplicationReference(data),
    heading: data.documentsSubmitted ? 'Booking requirements are ready to review' : 'New access request',
    message: data.documentsSubmitted ? data.chefName + ' submitted their booking requirements. Open the access request to check them and the current access status.' : data.chefName + ' requested access to ' + data.locationName + '. Review the request and approve it to continue kitchen coordination, or decline it with helpful feedback.',
    facts: kitchenApplicationFacts(data, 'admin'), actionLabel: data.documentsSubmitted ? 'Review booking requirements' : 'Review request', actionUrl: kitchenApplicationEmailUrl(data, 'admin') });

// Retained for callers outside this flow; new admin requests use the admin renderer above.
export const generateNewKitchenApplicationManagerEmail = (data: KitchenManagerApplicationEmailDetails): EmailContent =>
  renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Kitchen manager',
    subject: 'Access request — ' + data.chefName + kitchenApplicationReference(data),
    message: data.chefName + ' requested access to ' + data.locationName + '. Open the application to see its current status and available actions.',
    facts: kitchenApplicationFacts(data, 'kitchen'), actionLabel: 'View application', actionUrl: kitchenApplicationEmailUrl(data, 'kitchen') });

export const generateKitchenApplicationClearedManagerEmail = (data: Omit<KitchenManagerApplicationEmailDetails, 'chefEmail'> & { chefEmail?: string; touredAt?: Date | string | null }): EmailContent => {
  const details = { ...data, chefEmail: data.chefEmail || '' };
  const messageChef = kitchenApplicationMessageLink(details, 'kitchen');
  const viewApplication = { label: 'View application', url: kitchenApplicationEmailUrl(details, 'kitchen') };
  // They toured first, so you've already been talking: the same chat carries on, nothing "opens" (owner, Oct 24).
  if (data.touredAt) return renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Kitchen manager',
    subject: 'Access request — ' + data.chefName + kitchenApplicationReference(details),
    heading: data.chefName + ' wants to book ' + data.locationName,
    message: data.chefName + ', who toured ' + data.locationName + ' on ' + formatTourDate(new Date(data.touredAt)) + ', sent an access request. They can now send your booking requirements. Keep talking in the same chat you used for the tour.',
    facts: kitchenApplicationFacts(details, 'kitchen'), actionLabel: viewApplication.label, actionUrl: viewApplication.url,
    secondaryLink: messageChef ? { label: 'Open your chat', url: messageChef.url } : undefined, note: LOCAL_COOKS_COMMUNICATION_NOTE });
  return renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Kitchen manager',
    subject: 'Connect with ' + data.chefName + ' — ' + data.locationName + kitchenApplicationReference(details),
    heading: 'You can now message ' + data.chefName,
    message: data.chefName + ' can now continue their application for ' + data.locationName + '. No application review is needed from you. Please contact the customer through Local Cooks in-app messaging to introduce yourself and coordinate kitchen access, their Food Establishment Licence, or any kitchen-specific questions. You can also open their application and use the messaging option there.',
    facts: kitchenApplicationFacts(details, 'kitchen'), actionLabel: messageChef?.label || viewApplication.label,
    actionUrl: messageChef?.url || viewApplication.url, secondaryLink: messageChef ? viewApplication : undefined,
    note: LOCAL_COOKS_COMMUNICATION_NOTE });
};

export const generateKitchenCoordinationSubmittedManagerEmail = (data: KitchenManagerApplicationEmailDetails): EmailContent =>
  renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Kitchen manager',
    subject: 'Booking requirements submitted — ' + data.chefName + kitchenApplicationReference(data),
    heading: 'Booking requirements are ready to review',
    message: data.chefName + ' submitted their booking requirements for ' + data.locationName + '. Open the access request to check them and the available actions. Message the customer if you need clarification.',
    facts: kitchenApplicationFacts(data, 'kitchen'), actionLabel: 'Review booking requirements', actionUrl: kitchenApplicationEmailUrl(data, 'kitchen'), secondaryButton: kitchenApplicationMessageLink(data, 'kitchen') });

export const generateKitchenAccessConfirmedManagerEmail = (data: KitchenManagerApplicationEmailDetails): EmailContent =>
  renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Kitchen manager',
    subject: 'Kitchen access approved — ' + data.chefName + kitchenApplicationReference(data),
    message: data.chefName + ' now has approved access to ' + data.locationName + '. They can book available kitchen time when bookings are open. A booking is confirmed separately; this approval does not reserve dates or hours.',
    facts: kitchenApplicationFacts(data, 'kitchen'), actionLabel: 'View application', actionUrl: kitchenApplicationEmailUrl(data, 'kitchen'), secondaryButton: kitchenApplicationMessageLink(data, 'kitchen') });

export const generateKitchenApplicationReceivedChefEmail = (data: KitchenApplicationEmailDetails): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName,
    subject: 'Request to apply received — ' + data.locationName + kitchenApplicationReference(data), heading: 'Your request to apply is sent',
    message: 'We’ve received your request to apply to ' + data.locationName + '. We’ll email you when there’s an update. Nothing else is needed from you right now. Kitchen access and booking times are not yet confirmed.',
    facts: kitchenApplicationFacts(data), actionLabel: 'View your application', actionUrl: kitchenApplicationEmailUrl(data) });

export const generateKitchenApplicationStep2ReceivedChefEmail = (data: KitchenApplicationEmailDetails): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName,
    subject: 'Booking requirements received — ' + data.locationName + kitchenApplicationReference(data), heading: 'We received your booking requirements',
    message: 'We’ve received your booking requirements for ' + data.locationName + '. We’ll email you when there’s an update. Nothing else is needed from you right now. Please wait for kitchen access approval before booking.',
    facts: kitchenApplicationFacts(data), actionLabel: 'View your application', actionUrl: kitchenApplicationEmailUrl(data), secondaryButton: kitchenApplicationMessageLink(data, 'chef') });

export const generateKitchenApplicationSubmittedChefEmail = (data: KitchenApplicationEmailDetails & { locationId?: number }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName,
    subject: 'Request to apply approved — ' + data.locationName + kitchenApplicationReference(data), heading: 'Your request to apply is approved',
    message: 'Your request to apply to ' + data.locationName + ' is approved. Coordinate with your kitchen manager about access and your Food Establishment Licence, then complete the kitchen’s booking requirements. You can book once they’re approved.',
    facts: kitchenApplicationFacts(data), actionLabel: 'Continue your application', actionUrl: data.locationId ? getSubdomainUrl('chef') + '/apply-kitchen/' + data.locationId : kitchenApplicationEmailUrl(data), secondaryButton: kitchenApplicationMessageLink(data, 'chef') });

export const generateKitchenApplicationApprovedEmail = (data: KitchenApplicationEmailDetails & { kitchenName?: string }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName,
    subject: 'Kitchen access approved — ' + data.locationName + kitchenApplicationReference(data), heading: 'Your kitchen access is approved',
    message: 'Your kitchen access for ' + (data.kitchenName || data.locationName) + ' is approved. You can now choose available dates and hours when bookings are open. Your kitchen time is reserved only once you complete a booking.',
    facts: kitchenApplicationFacts(data), actionLabel: 'View kitchen access and booking options', actionUrl: kitchenApplicationEmailUrl(data), secondaryButton: kitchenApplicationMessageLink(data, 'chef') });

export const generateKitchenApplicationRejectedEmail = (data: KitchenApplicationEmailDetails & { feedback?: string }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName,
    subject: 'Kitchen application update — ' + data.locationName + kitchenApplicationReference(data), heading: 'An update on your kitchen application',
    message: 'Your application for ' + data.locationName + ' could not be approved at this time. Check the feedback below, if provided. You can view your application and explore other kitchens or apply again.',
    facts: [...kitchenApplicationFacts(data), ...(data.feedback ? [{ label: 'Application feedback', value: data.feedback }] : [])], actionLabel: 'View your application', actionUrl: kitchenApplicationEmailUrl(data) });

// ===================================
// KITCHEN LICENSE NOTIFICATION EMAILS
// ===================================

// Notify manager when their kitchen license is approved by admin
export const generateKitchenLicenseApprovedEmail = (data: {
  managerEmail: string;
  managerName: string;
  locationName: string;
  approvedAt: Date;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: data.managerName, key: 'bookingLicenseApproved', action: 'bookingViewLicense', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=settings-license', params: {}, facts: [{ label: tEmail(data.locale, 'bookingDate'), value: emailDate(data.approvedAt, data.locale || 'en-CA') }] });
};

// Notify manager when their kitchen license is rejected by admin
export const generateKitchenLicenseRejectedEmail = (data: {
  managerEmail: string;
  managerName: string;
  locationName: string;
  feedback?: string;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: data.managerName, key: 'bookingLicenseRejected', action: 'bookingViewLicense', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=settings-license', params: {}, facts: data.feedback ? [{ label: tEmail(data.locale, 'bookingReason'), value: data.feedback }] : [] });
};

// Notify admin when manager submits kitchen license for review
export const generateKitchenLicenseSubmittedAdminEmail = (data: {
  adminEmail: string;
  managerName: string;
  managerEmail: string;
  locationName: string;
  locationId: number;
  submittedAt: Date;
  isUpdate?: boolean;
  isReplacement?: boolean;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.adminEmail, recipientName: 'Local Cooks', key: 'bookingLicenseSubmitted', action: 'bookingReviewLicense', url: getSubdomainUrl('admin') + '/admin?section=kitchens', params: {}, facts: [] });
};

/**
 * Reminder that a manager's kitchen license is approaching (or has passed) its
 * expiry date.
 *
 * One generator for all three stages rather than three near-identical ones — the
 * only things that differ are the subject, the badge and the two sentences of
 * framing, so they are table-driven below.
 *
 * Cadence mirrors Airbnb's published rule ("we ask that hosts reverify 30 days
 * prior to expiration … if your document(s) expire, we'll pause the listing"):
 * a 30-day heads-up, a 7-day escalation, and a notice on the day it lapses.
 * Sending is made idempotent by the caller via a tracking id of
 * (stage, locationId, expiry), so each window sends exactly once.
 */
export const generateKitchenLicenseExpiringEmail = (data: {
  managerEmail: string;
  managerName: string;
  locationName: string;
  locationId: number;
  stage: "30_day" | "7_day" | "expired";
  /** YYYY-MM-DD as stored in the `date` column. */
  expiryDate: string;
  daysLeft: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.managerEmail, recipientName: data.managerName, key: 'bookingLicenseExpiry', action: 'bookingViewLicense', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=settings-license', params: { expiry: emailDate(data.expiryDate, data.locale || 'en-CA') }, facts: [{ label: tEmail(data.locale, 'bookingExpiry'), value: emailDate(data.expiryDate, data.locale || 'en-CA') }] });
};

// ===================================
// DAMAGE CLAIM NOTIFICATION EMAILS
// ===================================

// Notify chef when a damage claim is filed against them

// Notify manager when chef responds to their damage claim

// Notify admin when a damage claim is disputed

// Notify chef and manager of admin decision on disputed claim

// Notify chef when their card is charged for a damage claim
export const generateDamageClaimChargedEmail = (data: {
  chefEmail: string;
  chefName: string;
  claimTitle: string;
  chargedAmount: string;
  locationName: string;
  claimId: number;
} & BookingEmailContext): EmailContent => {
  return renderBookingNotice(data, { to: data.chefEmail, recipientName: data.chefName, key: 'bookingClaimCharged',
    action: 'bookingViewClaim', url: `${getSubdomainUrl('chef')}/dashboard?view=damage-claims&claimId=${data.claimId}`,
    facts: [{ label: tEmail(data.locale, 'bookingClaim'), value: data.claimTitle },
      { label: tEmail(data.locale, 'bookingTotalPaid'), value: `CAD $${data.chargedAmount}` }] });
};

// ===================================
// SELLER APPLICATION ADMIN NOTIFICATION EMAILS
// ===================================

// Notify admin when a chef submits a new seller (platform) application
export const generateNewSellerApplicationAdminEmail = (data: {
  adminEmail: string;
  chefName: string;
  chefEmail: string;
  hasDocuments: boolean;
  submittedAt: Date;
}): EmailContent => {
  const subject = `New Seller Application from ${data.chefName}`;
  const dashboardUrl = `${getDashboardUrl('admin')}?section=applications`;
  const formattedDate = data.submittedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">New Seller Application</h2>
      <p class="message" style="margin-bottom: 20px;">A chef has submitted a new seller application on the Local Cooks platform and is awaiting your review.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Name:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.chefEmail}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Submitted:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Documents:</span> <strong style="color: #1e293b;">${data.hasDocuments ? 'Included' : 'Not yet uploaded'}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Pending Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Application</a>
      </div>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: data.adminEmail,
    subject,
    text: `New Seller Application\n\nA chef has submitted a seller application.\n\nName: ${data.chefName}\nEmail: ${data.chefEmail}\nSubmitted: ${formattedDate}\nDocuments: ${data.hasDocuments ? 'Included' : 'Not yet uploaded'}\n\nReview at: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// ===================================
// NEW USER REGISTRATION NOTIFICATION EMAILS
// ===================================

// Notify admin about new user registration
export const generateNewUserRegistrationAdminEmail = (data: {
  adminEmail: string;
  newUserName: string;
  newUserEmail: string;
  userRole: 'admin' | 'manager' | 'chef';
  registrationDate: Date;
}): EmailContent => {
  const roleLabel = data.userRole.charAt(0).toUpperCase() + data.userRole.slice(1);
  const subject = `New ${roleLabel} Registration - ${data.newUserName}`;
  const dashboardUrl = `${getDashboardUrl('admin')}?section=overview`;
  const formattedDate = data.registrationDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const roleColor = data.userRole === 'admin' ? '#dc2626' : data.userRole === 'manager' ? '#2563eb' : '#16a34a';
  const roleBg = data.userRole === 'admin' ? '#fef2f2' : data.userRole === 'manager' ? '#eff6ff' : '#f0fdf4';
  const roleBorder = data.userRole === 'admin' ? '#fecaca' : data.userRole === 'manager' ? '#dbeafe' : '#dcfce7';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">New User Registration</h2>
      <p class="message" style="margin-bottom: 20px;">A new user has registered on the platform.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Name:</span> <strong style="color: #1e293b;">${data.newUserName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.newUserEmail}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Registered:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: ${roleBg}; color: ${roleColor}; border: 1px solid ${roleBorder}; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">${roleLabel}</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Users</a>
      </div>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best regards,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: data.adminEmail,
    subject,
    text: `New ${roleLabel} Registration\n\nName: ${data.newUserName}\nEmail: ${data.newUserEmail}\nRegistered: ${formattedDate}\n\nView users: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// ===================================
// CANCELLATION REQUEST ACCEPT/DECLINE EMAILS
// ===================================

// Chef notice: Cancellation request accepted by manager
export const generateCancellationAcceptedEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName?: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingType: 'kitchen' | 'storage' | 'equipment';
  bookingName?: string;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingLabel = data.bookingType === 'kitchen' ? 'kitchen booking'
    : data.bookingType === 'storage' ? 'storage booking' : 'equipment booking';
  const subject = `Cancellation Accepted - ${data.kitchenName}`;
  const dashboardUrl = getDashboardUrl();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your cancellation request for the ${bookingLabel} at <strong>${data.kitchenName}</strong> has been accepted by the kitchen manager.</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #166534; margin: 0;">Cancellation does not confirm a refund. Any refund is handled separately.</p>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        ${data.locationName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View your bookings</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" style="color: hsl(347, 91%, 51%); text-decoration: none;">${getSupportEmail()}</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Your cancellation request for the ${bookingLabel} at ${data.kitchenName} has been accepted by the kitchen manager.

Kitchen: ${data.kitchenName}
${data.locationName ? `Location: ${data.locationName}` : ''}
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

Cancellation does not confirm a refund. Any refund is handled separately.

View bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Chef notice: Cancellation request declined by manager
export const generateCancellationDeclinedEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName?: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingType: 'kitchen' | 'storage' | 'equipment';
  bookingName?: string;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingLabel = data.bookingType === 'kitchen' ? 'kitchen booking'
    : data.bookingType === 'storage' ? 'storage booking' : 'equipment booking';
  const subject = `Cancellation Declined - ${data.kitchenName}`;
  const dashboardUrl = getDashboardUrl();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your cancellation request for the ${bookingLabel} at <strong>${data.kitchenName}</strong> was declined by the kitchen manager. Your booking remains confirmed.</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #991b1b; margin: 0;">Your booking is still active. Please contact the kitchen manager if you have concerns.</p>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        ${data.locationName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View your bookings</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" style="color: hsl(347, 91%, 51%); text-decoration: none;">${getSupportEmail()}</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
Hi ${firstName},

Your cancellation request for the ${bookingLabel} at ${data.kitchenName} was declined by the kitchen manager. Your booking remains confirmed.

Kitchen: ${data.kitchenName}
${data.locationName ? `Location: ${data.locationName}` : ''}
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

Please contact the kitchen manager if you have concerns.

View bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

type TourRequestEmailDetails = {
  tourId: number; kitchenName: string; locationName?: string; address?: string;
  tourDate: string | Date; durationMinutes: number; startTime?: string; timezone?: string;
};

function tourRequestFacts(data: TourRequestEmailDetails) {
  if (!Number.isSafeInteger(data.tourId) || data.tourId <= 0 || !Number.isFinite(new Date(data.tourDate).getTime())
    || !Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0) throw new Error('Invalid tour request details');
  return [{ label: 'Kitchen', value: data.kitchenName },
    ...(data.locationName ? [{ label: 'Location', value: data.locationName }] : []),
    ...(data.address ? [{ label: 'Address', value: data.address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.address) }] : []),
    { label: 'Requested time', value: formatTourDate(new Date(data.tourDate)) + ', ' + formatTourSlotRange(data.tourDate, data.durationMinutes, true) },
    { label: 'Reference', value: 'TOUR-' + data.tourId }];
}

export const generateTourRequestedChefEmail = (data: TourRequestEmailDetails & { chefEmail: string; chefName: string }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName, tour: data,
    subject: 'Tour request received · ' + data.kitchenName,
    heading: 'Your kitchen tour request is sent',
    message: 'We’ve received your request to tour ' + data.kitchenName + '. Your requested time is not yet confirmed. We’ll email you when it’s confirmed or declined. Please wait for confirmation before visiting.',
    facts: tourRequestFacts(data), actionLabel: 'View details',
    actionUrl: getSubdomainUrl('chef') + '/dashboard?view=viewings&viewing=' + data.tourId,
    ...(new Date(data.tourDate).getTime() > Date.now() ? { secondaryButton: { label: 'Edit tour request', url: getSubdomainUrl('chef') + '/dashboard?view=viewings&viewing=' + data.tourId + '&action=reschedule' } } : {}),
    actions: new Date(data.tourDate).getTime() > Date.now() ? [
      { label: 'Cancel tour', url: getSubdomainUrl('chef') + '/dashboard?view=viewings&viewing=' + data.tourId + '&action=cancel' },
    ] : [] });

export const generateTourRequestedLocalCooksEmail = (data: TourRequestEmailDetails & { recipientEmail: string; chefName: string }): EmailContent =>
  renderTransactionalEmail({ to: data.recipientEmail, recipientName: 'Local Cooks', tour: data,
    subject: 'Tour request awaiting review · ' + data.kitchenName,
    message: data.chefName + ' requested a kitchen tour. Review the request to forward it to the current kitchen manager or decline it. Forwarding does not confirm the appointment.',
    facts: [{ label: 'Visitor', value: data.chefName }, ...tourRequestFacts(data)], actionLabel: 'Review tour request',
    actionUrl: getSubdomainUrl('admin') + '/admin?section=tour-requests&viewing=' + data.tourId });

export const generateTourManagerChangeEmail = (data: { tourId: number; durationMinutes: number; managerEmail: string; managerName?: string; chefName: string; kitchenName: string; locationName?: string; address?: string; kind: 'cancelled' | 'reschedule_requested'; scheduledAt: Date; requestedAt?: Date; timezone: string; withdrawn?: boolean }): EmailContent => {
  const when = (date: Date) => `${formatTourDate(date)}, ${formatTourSlotRange(date, data.durationMinutes, true)}`;
  const cancelled = data.kind === 'cancelled';
  return renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Manager',
    tour: { tourId: data.tourId, tourDate: data.scheduledAt, durationMinutes: data.durationMinutes,
      ...(!cancelled && data.requestedAt ? { subjectWhen: `${formatTourWhen(data.scheduledAt)} → ${formatTourWhen(data.requestedAt)}` } : {}) },
    subject: `${data.withdrawn ? 'Tour request withdrawn' : cancelled ? 'Kitchen tour cancelled' : 'Kitchen tour reschedule requested'} · TOUR-${data.tourId}`,
    message: data.withdrawn ? `${data.chefName} withdrew their tour request for ${data.kitchenName}. Nothing was confirmed, so no action is needed.` : cancelled ? `${data.chefName}’s tour of ${data.kitchenName} was cancelled.` : `${data.chefName} would like a new time for their tour of ${data.kitchenName}. Review the proposed time below. The original time remains confirmed until the change is accepted.`,
    facts: [{ label: 'Kitchen', value: data.kitchenName },
      ...(data.locationName ? [{ label: 'Location', value: data.locationName }] : []),
      ...(data.address ? [{ label: 'Address', value: data.address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.address) }] : []),
      { label: cancelled ? 'Former time' : 'Original time', value: when(data.scheduledAt) },
      ...(!cancelled && data.requestedAt ? [{ label: 'Proposed time', value: when(data.requestedAt) }] : []),
      { label: 'Reference', value: `TOUR-${data.tourId}` }],
    actionLabel: cancelled ? 'View cancelled tour' : 'Review reschedule request',
    actionUrl: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${data.tourId}${cancelled ? '' : '&action=review-reschedule'}`,
    ...(!cancelled ? { secondaryButton: { label: 'Message customer', url: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${data.tourId}&action=message` } } : {}),
    note: cancelled && !data.withdrawn ? 'Saved calendar events do not update automatically; remove the cancelled tour from your calendar.' : undefined,
  });
};

export const generateTourRequestedManagerEmail = (data: TourRequestEmailDetails & { managerEmail: string; managerName: string; chefName: string; chefNotes?: string }): EmailContent =>
  renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName, tour: data,
    subject: 'Tour request from ' + data.chefName + ' · ' + data.kitchenName,
    heading: data.chefName + ' would like to tour your kitchen',
    message: data.chefName + ' requested a tour of ' + data.kitchenName + '. Confirm the requested time, offer alternatives, or decline the request.',
    facts: [{ label: 'Visitor', value: data.chefName }, ...tourRequestFacts(data),
      ...(data.chefNotes ? [{ label: 'Visitor notes', value: data.chefNotes }] : [])],
    actionLabel: 'Confirm tour', actionUrl: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=confirm',
    secondaryButton: { label: 'Offer alternative times', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=reschedule' },
    actions: [{ label: 'Message customer', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=message' },
      { label: 'Decline request', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=cancel' }] });

function tourCalendarDescription(data: { kitchenName: string; notes?: string; arrivalNotes?: string | null; departureNotes?: string | null; sharedManagerNotes?: string | null }) {
  return [`Kitchen tour at ${data.kitchenName}.`, data.arrivalNotes?.trim() ? `Arrival instructions: ${data.arrivalNotes.trim()}` : '', data.sharedManagerNotes?.trim() ? `Manager notes: ${data.sharedManagerNotes.trim()}` : '', data.notes?.trim() ? `Notes: ${data.notes.trim()}` : ''].filter(Boolean).join('\n\n');
}

export function generateTourCalendarAttachment(data: {
  tourId: number; durationMinutes: number; tourDate: string | Date; kitchenName: string; locationAddress: string;
  notes?: string; arrivalNotes?: string | null; departureNotes?: string | null; sharedManagerNotes?: string | null; confirmedAt?: Date | null; organizerEmail?: string; attendeeEmails?: string[]; calendarSequence?: number; updatedAt?: Date; cancelled?: boolean;
}) {
  const start = new Date(data.tourDate), end = new Date(start.getTime() + data.durationMinutes * 60_000);
  if (!Number.isSafeInteger(data.tourId) || data.tourId <= 0 || !Number.isFinite(start.getTime())
    || !Number.isFinite(end.getTime()) || !Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0
    || !Number.isInteger(data.calendarSequence ?? 0) || (data.calendarSequence ?? 0) < 0
    || (data.calendarSequence ?? 0) > 2147483647 || (data.updatedAt && !Number.isFinite(data.updatedAt.getTime()))) {
    throw new Error('Invalid tour calendar details');
  }
  return { filename: 'kitchen-tour.ics', contentType: `text/calendar; charset=utf-8; method=${data.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    content: generateIcsFile(`Kitchen tour at ${data.kitchenName}`, start, end, data.locationAddress,
      tourCalendarDescription(data),
      data.organizerEmail, data.attendeeEmails, `tour-${data.tourId}@localcooks.com`,
      { sequence: data.calendarSequence ?? 0, modifiedAt: data.updatedAt, cancelled: data.cancelled }) };
}

export const generateTourConfirmedEmail = (data: { tourId: number; durationMinutes: number; isManager: boolean; email: string; recipientName: string; otherPartyName: string; kitchenName: string; locationAddress: string; tourDate: string | Date; timezone?: string; notes?: string; arrivalNotes?: string | null; departureNotes?: string | null; sharedManagerNotes?: string | null; confirmedAt?: Date | null; organizerEmail?: string; attendeeEmails?: string[]; contactEmail?: string; contactPhone?: string | null; calendarSequence?: number; updatedAt?: Date; previousTourDate?: Date; canReschedule?: boolean; canCancel?: boolean }): EmailContent => {
  const startDateTimeObj = new Date(data.tourDate);
  const endDateTimeObj = new Date(startDateTimeObj.getTime() + data.durationMinutes * 60_000);
  if (!Number.isSafeInteger(data.tourId) || data.tourId <= 0 || !Number.isFinite(startDateTimeObj.getTime())
    || !Number.isFinite(endDateTimeObj.getTime()) || !Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0) {
    throw new Error('Invalid tour calendar details');
  }
  const dateStr = formatTourDate(startDateTimeObj);
  const startTime = formatTourSlotRange(startDateTimeObj, data.durationMinutes, true);
  const title = `Kitchen tour at ${data.kitchenName}`;
  const actionUrl = `${getSubdomainUrl(data.isManager ? 'kitchen' : 'chef')}${data.isManager ? '/manager/dashboard' : '/dashboard'}?view=viewings&viewing=${data.tourId}`;
  const canReschedule = data.canReschedule !== false && (data.isManager ? canManagerProposeReschedule : canChefRequestReschedule)({ status: 'confirmed', scheduledAt: data.tourDate });
  const canCancel = data.canCancel !== false && startDateTimeObj.getTime() > Date.now();

  const calendarAttachment = generateTourCalendarAttachment(data);

  const googleCalendarUrl = generateGoogleCalendarUrl(
    title,
    startDateTimeObj,
    endDateTimeObj,
    data.locationAddress,
    tourCalendarDescription(data)
  );

  return {
    ...renderTransactionalEmail({ to: data.email, tour: data, subject: `${data.previousTourDate ? 'Tour rescheduled' : 'Kitchen tour confirmed'} · ${data.kitchenName}`,
      recipientName: data.recipientName, message: data.previousTourDate ? data.isManager
        ? `${data.otherPartyName}’s new tour time at ${data.kitchenName} is confirmed. Review the updated visit details below and replace any event you saved in your calendar.`
        : 'Your new tour time is confirmed. Check the updated details below and replace any event you saved in your calendar.'
        : data.isManager ? `${data.otherPartyName} is coming to tour ${data.kitchenName}. Review the visit details and the arrival instructions shared with them below.`
        : `You’re set to tour ${data.kitchenName} with ${data.otherPartyName}. Here’s everything you need for your visit.`,
      facts: [], sections: [{ title: data.isManager ? 'Tour details' : 'Your visit', facts: [{ label: 'Kitchen', value: data.kitchenName }, { label: data.isManager ? 'Customer' : 'Kitchen manager', value: data.otherPartyName },
        { label: 'Date', value: dateStr }, { label: 'Time', value: startTime },
        ...(data.previousTourDate ? [{ label: 'Previous time', value: `${formatTourDate(data.previousTourDate)}, ${formatTourSlotRange(data.previousTourDate, data.durationMinutes, true)}` }] : []),
        { label: 'Reference', value: `TOUR-${data.tourId}` }], links: [{ label: 'Add to Google Calendar', url: googleCalendarUrl }] },
        { title: data.isManager ? `Preparing for ${data.otherPartyName}’s visit` : 'Arrival', facts: [
        { label: 'Address', value: data.locationAddress, url: data.locationAddress ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.locationAddress) : undefined },
        ...(data.arrivalNotes?.trim() ? [{ label: 'Arrival instructions', value: data.arrivalNotes.trim() }] : []),
        { label: data.contactEmail ? data.isManager ? 'Customer contact' : 'Arrival contact' : 'Tour assistance', value: data.contactEmail || getSupportEmail() },
        ...(data.contactPhone ? [{ label: 'Phone', value: data.contactPhone, url: `tel:${data.contactPhone}` }] : [])] },
        { title: 'Meeting notes', facts: [
        ...(data.sharedManagerNotes?.trim() ? [{ label: 'Manager notes', value: data.sharedManagerNotes.trim() }] : []),
        ...(data.notes ? [{ label: data.isManager ? 'Notes from the customer' : 'Your notes', value: data.notes }] : [])] }],
      heading: data.isManager ? `${data.otherPartyName}’s kitchen tour is ${data.previousTourDate ? 'rescheduled' : 'confirmed'}`
        : data.previousTourDate ? 'Your tour has been rescheduled' : 'Your kitchen tour is confirmed',
      actionLabel: 'View details', actionUrl,
      secondaryButton: canReschedule ? { label: 'Reschedule tour', url: actionUrl + '&action=reschedule' } : { label: data.isManager ? 'Message customer' : 'Message manager', url: actionUrl + '&action=message' },
      actions: [...(canReschedule ? [{ label: data.isManager ? 'Message customer' : 'Message manager', url: actionUrl + '&action=message' }] : []),
        ...(canCancel ? [{ label: 'Cancel tour', url: actionUrl + '&action=cancel' }] : [])],
      note: 'A calendar file is attached. If the tour changes, update the event in your calendar too.',
    }),
    attachments: [calendarAttachment]
  };
};

export const generateTourRejectedChefEmail = (data: TourRequestEmailDetails & { chefEmail: string; chefName: string; cancellationReason?: string; managerNotes?: string; cancelled?: boolean }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName, tour: data,
    subject: (data.cancelled ? 'Kitchen tour cancelled' : 'Tour request declined') + ' · ' + data.kitchenName,
    message: 'Your ' + (data.cancelled ? 'confirmed kitchen tour was cancelled.' : 'kitchen tour request was declined. This appointment was not confirmed.'),
    facts: [...tourRequestFacts(data).map(fact => fact.label === 'Requested time' && data.cancelled ? { ...fact, label: 'Former time' } : fact),
      ...(publicTourCancellationReason(data.cancellationReason) ? [{ label: 'Reason', value: publicTourCancellationReason(data.cancellationReason)! }] : []),
      ...(data.managerNotes ? [{ label: 'Manager notes', value: data.managerNotes }] : [])],
    actionLabel: 'View your tour', actionUrl: getSubdomainUrl('chef') + '/dashboard?view=viewings&viewing=' + data.tourId,
    note: data.cancelled ? 'Saved calendar events do not update automatically; remove the cancelled tour from your calendar.' : undefined });

const LOCAL_COOKS_COMMUNICATION_NOTE = 'For your safety, always communicate through Local Cooks so you can refer back to your messages and arrangements.';

/** Explicit opt-in shell: supplied content stays literal in HTML and plain text. */
export function renderTransactionalEmail(data: {
  to: string; subject: string; recipientName: string; message: string; locale?: string | null;
  tour?: { tourId: number; tourDate: string | Date; durationMinutes: number; subjectWhen?: string };
  facts: { label: string; value: string; url?: string }[]; actionLabel: string; actionUrl: string; note?: string; secondaryLink?: { label: string; url: string };
  secondaryButton?: { label: string; url: string }; heading?: string;
  actions?: { label: string; url: string }[];
  sections?: { title: string; facts: { label: string; value: string; url?: string }[]; links?: { label: string; url: string }[] }[];
}): EmailContent {
  const tourSubjectSuffix = data.tour ? `${data.tour.subjectWhen ?? `${formatTourDate(new Date(data.tour.tourDate))}, ${formatTourSlotRange(data.tour.tourDate, data.tour.durationMinutes, true)}`} · TOUR-${data.tour.tourId}` : undefined;
  const subjectTitle = tourSubjectSuffix && data.subject.endsWith(` · ${tourSubjectSuffix}`)
    ? data.subject.slice(0, -(` · ${tourSubjectSuffix}`).length) : data.subject.replace(/\s*· TOUR-\d+$/, '');
  const heading = data.heading || subjectTitle;
  const subject = tourSubjectSuffix ? `${subjectTitle} · ${tourSubjectSuffix}` : data.subject;
  const buttonStyle = 'display:block;text-align:center;padding:16px 20px;background:#e11d48;color:#ffffff !important;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;line-height:24px;';
  const linkStyle = 'color:#292524;text-decoration:underline;font-size:15px;line-height:24px;';
  const outlineButtonStyle = 'display:block;text-align:center;padding:16px 20px;border:1px solid #292524;color:#292524;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;line-height:24px;';
  const isMessageAction = (action: { url: string }) => /[?&]action=message(?:&|$)/.test(action.url);
  const sections: NonNullable<typeof data.sections> = (data.sections || [{ title: tEmail(data.locale, 'bookingDetails'), facts: data.facts }]).filter(section => section.facts.length);
  const actionLinks = (actions: { label: string; url: string }[]) => actions.map(action =>
    `<p style="margin:12px 0;"><a href="${escapeHtml(action.url)}"${isMessageAction(action) ? ' class="lc-border"' : ''} style="${isMessageAction(action) ? outlineButtonStyle : linkStyle}">${escapeHtml(action.label)}</a></p>`).join('');
  const primaryActions = [{ label: data.actionLabel, url: data.actionUrl }, ...(data.secondaryButton ? [data.secondaryButton] : [])];
  const moreActions = [...(data.actions || []), ...(data.secondaryLink ? [data.secondaryLink] : [])]
    .filter((action, index, all) => !primaryActions.some(primary => primary.url === action.url)
      && !sections.some(section => section.links?.some(link => link.url === action.url))
      && all.findIndex(other => other.url === action.url) === index);
  const note = [data.note, [...primaryActions, ...moreActions].some(isMessageAction) && data.note !== LOCAL_COOKS_COMMUNICATION_NOTE ? LOCAL_COOKS_COMMUNICATION_NOTE : undefined].filter(Boolean).join('\n\n');
  return {
    to: data.to, subject,
    text: `${heading}\n\nHi ${data.recipientName},\n\n${data.message}\n\n${primaryActions.map(action => `${action.label}: ${action.url}`).join('\n')}\n\n${sections.map(section => `${section.title}\n${section.facts.map(fact => `${fact.label}: ${fact.value}${fact.url ? ` (${fact.url})` : ''}`).join('\n')}${section.links?.length ? '\n' + section.links.map(link => `${link.label}: ${link.url}`).join('\n') : ''}`).join('\n\n')}${moreActions.length ? '\n\n' + moreActions.map(action => `${action.label}: ${action.url}`).join('\n') : ''}${note ? `\n\n${note}` : ''}\n\nNeed a hand? Contact ${getSupportEmail()}\nThe Local Cooks Team`,
    html: prepareEmailHtml(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:560px){.email-body,.email-brand,.email-footer{padding-left:24px !important;padding-right:24px !important}.email-title{font-size:24px !important}.email-outer{padding:0 !important}}</style></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#292524;line-height:1.6;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(data.message)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="email-outer" align="center" style="padding:16px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;">
<tr><td class="email-brand" style="padding:16px 40px 24px;">
<img class="email-logo" src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" width="200" height="68" style="display:block;width:200px;max-width:100%;height:auto;border:0;" /></td></tr>
<tr><td class="email-body" style="padding:0 40px 32px;overflow-wrap:anywhere;">
<h1 class="email-title" style="font-size:26px;line-height:1.25;letter-spacing:-0.4px;margin:0 0 24px;">${escapeHtml(heading)}</h1>
<p style="margin:0 0 12px;font-size:16px;">Hi ${escapeHtml(data.recipientName)},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;white-space:pre-line;">${escapeHtml(data.message)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px;"><tr><td>
<a href="${escapeHtml(data.actionUrl)}" class="cta-button" style="${buttonStyle}">${escapeHtml(data.actionLabel)}</a>
${data.secondaryButton ? actionLinks([data.secondaryButton]) : ''}</td></tr></table>
${sections.map(section => `<h2 style="font-size:20px;line-height:1.35;margin:28px 0 16px;padding-top:24px;border-top:1px solid #e7e5e4;">${escapeHtml(section.title)}</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
${section.facts.map(fact => `<tr><td style="padding:0 0 16px;"><p style="margin:0;font-size:13px;color:#57534e;">${escapeHtml(fact.label)}</p><p style="white-space:pre-line;margin:3px 0 0;font-size:16px;line-height:1.5;">${fact.url ? `<a href="${escapeHtml(fact.url)}" style="color:#292524;text-decoration:underline;">${escapeHtml(fact.value)}</a>` : escapeHtml(fact.value)}</p></td></tr>`).join('')}
</table>${actionLinks(section.links || [])}`).join('')}
${moreActions.length ? `<div style="margin-top:8px;">${actionLinks(moreActions)}</div>` : ''}
${note ? `<p style="font-size:14px;line-height:1.6;color:#57534e;margin:24px 0 0;white-space:pre-line;">${escapeHtml(note)}</p>` : ''}
</td></tr><tr><td class="email-footer" style="padding:24px 40px 32px;border-top:1px solid #e7e5e4;font-size:13px;color:#57534e;">
Need a hand? <a href="mailto:${escapeHtml(getSupportEmail())}" style="color:#292524;text-decoration:underline;">Contact Local Cooks</a><br>&copy; ${new Date().getFullYear()} Local Cooks
</td></tr></table></td></tr></table></body></html>`),
  };
}

export const getUniformEmailFooter = () => `
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" style="color: hsl(347, 91%, 51%); text-decoration: none;">${getSupportEmail()}</a></p>
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 15px; color: #64748b; margin: 0;">Best,</p>
        <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin: 4px 0 0 0;">The Local Cooks Team</p>
      </div>
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p>
    </div>
`;

export async function sendChefReportEmail(chefEmail: string, chefName: string, pdfBuffer: Buffer, csvContent: string, period: 'weekly' | 'monthly', startDate: string, endDate: string) {
  const subject = `Your ${period === 'weekly' ? 'Weekly' : 'Monthly'} Seller Report: ${startDate} to ${endDate}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${chefName.split(' ')[0]},</h2>
      <p class="message" style="margin-bottom: 20px;">Your ${period} seller report for the period <strong>${startDate}</strong> to <strong>${endDate}</strong> is ready.</p>
      <p class="message" style="margin-bottom: 20px;">We have attached two files to this email for your convenience:</p>
      <ul style="margin-bottom: 20px; line-height: 1.5; color: #334155;">
        <li><strong>PDF Statement:</strong> An official, human-readable summary of your revenue and deductions.</li>
        <li><strong>CSV Data:</strong> A raw data file of all your orders, suitable for importing into accounting software.</li>
      </ul>
      ${getUniformEmailFooter()}
    </div>
  </div>
</body>
</html>`;

  const textContent = `
Hi ${chefName},

Your ${period} seller report for the period ${startDate} to ${endDate} is ready.
We have attached the PDF statement and CSV data file to this email.

If you have any questions, contact us at ${getSupportEmail()}

Best,
The Local Cooks Team
`;

  return sendEmail({
    to: chefEmail,
    subject,
    html: prepareEmailHtml(htmlContent),
    text: textContent,
    attachments: [
      {
        filename: `LocalCooks_${period}_Report_${startDate}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      },
      {
        filename: `LocalCooks_${period}_Data_${startDate}.csv`,
        content: csvContent,
        contentType: 'text/csv'
      }
    ]
  });
}
