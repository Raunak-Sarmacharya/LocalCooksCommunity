import { prepareEmailHtml } from "./email-theme";
import { logger } from "./logger.js";
import { escapeHtml } from './security';
import { isE2eOutboundSuppressed } from "./e2e-outbound-guard.js";
import { stripCountryCode } from "./phone-utils";
import nodemailer from 'nodemailer';
import { isPlatformEmailRecipientBlocked } from './email-recipient-policy';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { tEmail } from "./i18n/outbound";
import { addHour, calendarDateForBookingTime, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { matchingLocalInstants } from '@shared/booking-dst';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourDate, formatTourClock, formatTourSlotRange } from '@shared/tour-time';
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
  const startTime = Date.now();
  let transporter: any = null;
  let smtpStarted = false, failureLogged = false, messageId: string | undefined;

  try {
    if (isPlatformEmailRecipientBlocked(content.to)) {
      await persistEmailLog({ ...content, ...options, status: 'skipped_policy',
        errorMessage: 'The support contact inbox cannot receive platform-generated email.' });
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
      acceptanceUnknown ? 'acceptance_unknown' : 'smtp_rejected');

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

    if (options?.reportDeliveryFailure && smtpStarted) throw new SmtpDeliveryError(smtpFailureKind(error));
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

// Helper function to get support email based on configured domain
const getSupportEmail = (): string => {
  const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
  return `support@${domain}`;
};

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
          text: encodeURIComponent(title),
          dates: `${startDateStr}/${endDateStr}`, // ISO 8601 format in UTC
          details: encodeURIComponent(description),
          location: encodeURIComponent(location),
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
): { ics: string; linksHtml: string; linksText: string; timeLabel: string } {
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
  const timeLabel = groups.map(group => `${group.startTime}–${group.endTime}`).join(', ');
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
    label: `${group.startTime}–${group.endTime}`,
    url: generateCalendarUrl(recipient, title, booking.bookingDate, group.startTime, group.endTime,
      location, exactDescription, timezone, booking.operatingWindowStartTime || undefined),
  }));
  return {
    ics,
    linksHtml: links.map(link => `<a href="${link.url}" target="_blank" style="display:inline-block;margin:4px 8px 4px 0;color:#F51042;text-decoration:underline">Add ${link.label} to calendar</a>`).join(''),
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
        <a href="https://stagingwebapp.localcook.shop/app/shop/index.php" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0 8px 8px 0;">Access Chef Dashboard</a>
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
  Access: https://stagingwebapp.localcook.shop/app/shop/index.php
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

// Generate magic link (passwordless sign-in) email with unified design
// Role determines the correct subdomain for the link target (though EmailAction handles cross-subdomain redirects)
export const generateMagicLinkEmail = (
  userData: {
    fullName: string;
    email: string;
    signInUrl: string;
    /** Recipient preferred locale (BCP 47). Defaults to en-CA. */
    locale?: string | null;
  }
): EmailContent => {
  const firstName = userData.fullName.split(' ')[0];
  const locale = userData.locale;
  const subject = locale && locale.startsWith('fr')
    ? 'Votre lien de connexion - Local Cooks'
    : locale && locale.startsWith('uk')
      ? 'Ваше посилання для входу - Local Cooks'
      : 'Your Sign-In Link - Local Cooks';

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
      <p class="message" style="margin-bottom: 20px;">Here&#8217;s your secure sign-in link for Local Cooks. Click the button below to access your account instantly — no password needed.</p>
      <p class="message" style="margin-bottom: 20px;">For your security, this link will expire in <strong>10 minutes</strong> and can only be used once.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #eff6ff; color: #1d4ed8; border: 1px solid #dbeafe; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Secure Sign-In</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${userData.signInUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Sign In to My Account</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;"><strong>Didn&#8217;t request this?</strong> If you didn&#8217;t try to sign in, you can safely ignore this email. Your account remains secure.</p>
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

Here's your secure sign-in link for Local Cooks. Use the link below to sign in instantly — no password needed.

Sign in: ${userData.signInUrl}

For your security, this link will expire in 10 minutes and can only be used once.

If you didn't request this, you can safely ignore this email. Your account remains secure.

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html: prepareEmailHtml(html),
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      'Importance': 'High',
      'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`
    }
  };
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
  return process.env.VENDOR_DASHBOARD_URL || 'https://stagingwebapp.localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Fstagingwebapp.localcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php';
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
      background: ${userData.header?.styling?.backgroundColor || 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)'};
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
      color: ${userData.footer?.styling?.linkColor || '#F51042'};
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
      background: ${userData.header?.styling?.backgroundColor || 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)'};
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
             style="color: #F51042; text-decoration: underline;">
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

export const generateBookingNotificationEmail = (bookingData: { managerEmail: string; managerName?: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; bookingId: number; referenceCode?: string | null; operatingWindowStartTime?: string | null; selectedSlots?: unknown }): EmailContent => {
  const chefFirstName = bookingData.chefName.split(' ')[0];
  const chefLastName = bookingData.chefName.includes(' ') ? bookingData.chefName.split(' ').slice(1).join(' ') : '';
  const subject = `New Booking Request from ${chefFirstName}${chefLastName ? ' ' + chefLastName : ''}`;
  const timezone = DEFAULT_TIMEZONE;
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const bookingDetailsUrl = `${getSubdomainUrl('kitchen')}/manager/booking/${bookingData.bookingId}`;
  const dashboardUrl = getDashboardUrl('kitchen');
  const managerFirstName = bookingData.managerName ? bookingData.managerName.split(' ')[0] : bookingData.managerEmail.split('@')[0];

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);
  const formattedDate = bookingDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Generate calendar URL based on email provider - SAME event as chef receives for perfect sync
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.\n\nChef: ${bookingData.chefName}\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Pending Approval${bookingData.specialNotes ? `\n\nNotes: ${bookingData.specialNotes}` : ''}`;
  const calendar = bookingCalendarParts(bookingData, bookingData.managerEmail, calendarTitle,
    locationName, calendarDescription, timezone);
  const icsContent = calendar.ics;



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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 24px;">You've received a new booking request for ${bookingData.kitchenName} that needs your review.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Chef Information:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Name:</span> <strong style="color: #1e293b;">${bookingData.chefName}</strong></p>
      </div>
      <div style="margin: 0 0 24px 0; text-align: center;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0;">View Chef's Profile</a>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Booking Request Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        ${bookingData.referenceCode ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Reference:</span> <strong style="color: #1e293b; font-family: monospace;">${bookingData.referenceCode}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${calendar.timeLabel}</strong></p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Next Steps:</p>
      <p class="message" style="margin-bottom: 20px;">Please review this request and respond within 24&#8211;48 hours so ${chefFirstName} can confirm their production schedule.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingDetailsUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review &amp; Respond to Request</a>
      </div>
      <p class="message" style="margin-top: 20px;">You can approve or decline this booking directly from your dashboard. If you need to discuss any details with the chef, you can use the built-in chat feature.</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 20px 0 0 0;">A calendar invite has been attached to this email. ${calendar.linksHtml}</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 16px 0 0 0;">If you have any questions about this request, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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
Hi ${managerFirstName},

You've received a new booking request for ${bookingData.kitchenName} that needs your review.

Chef Information:
Name: ${bookingData.chefName}

Booking Request Details:
Kitchen: ${bookingData.kitchenName}
Date: ${formattedDate}
Time: ${calendar.timeLabel}

Next Steps:
Please review this request and respond within 24-48 hours so ${chefFirstName} can confirm their production schedule.

Review & Respond: ${bookingDetailsUrl}

You can approve or decline this booking directly from your dashboard. If you need to discuss any details with the chef, you can use the built-in chat feature.

${calendar.linksText}

If you have any questions about this request, simply reply to this email or contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.managerEmail,
    subject,
    text,
    html: prepareEmailHtml(html),
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

// Payment received notification email for managers
export const generateBookingPaymentReceivedEmail = (data: {
  managerEmail: string;
  chefName: string;
  kitchenName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  amountCents: number;
  currency: string;
  bookingId: number;
  locationName?: string;
}): EmailContent => {
  const subject = `Payment Received - ${data.kitchenName} Booking`;
  const formattedAmount = `$${(data.amountCents / 100).toFixed(2)} ${data.currency}`;
  const bookingDateObj = data.bookingDate instanceof Date ? data.bookingDate : new Date(data.bookingDate);
  const formattedDate = bookingDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingDetailsUrl = `${getSubdomainUrl('kitchen')}/manager/booking/${data.bookingId}`;

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Payment Received</h2>
      <p class="message" style="margin-bottom: 20px;">Payment has been received for a kitchen booking. The booking is now confirmed and ready.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} &#8211; ${data.endTime}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount:</span> <strong style="color: #16a34a;">${formattedAmount}</strong></p>
      </div>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Paid</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingDetailsUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Booking Details</a>
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
Payment Received

Chef: ${data.chefName}
Kitchen: ${data.kitchenName}
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}
Amount: ${formattedAmount}

The booking is now confirmed and ready.

View booking: ${bookingDetailsUrl}

If you have any questions, contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Booking cancellation notification email for managers (when chef cancels)
export const generateBookingCancellationNotificationEmail = (bookingData: { managerEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string }): EmailContent => {
  const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
  const formattedDate = new Date(bookingData.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Booking Cancelled</h2>
      <p class="message" style="margin-bottom: 20px;">A chef has cancelled their booking at ${bookingData.kitchenName}.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${bookingData.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime}</strong></p>
        ${bookingData.cancellationReason ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${bookingData.cancellationReason}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Cancelled</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getSubdomainUrl('kitchen')}/manager/bookings" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Bookings</a>
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
Booking Cancelled

Chef: ${bookingData.chefName}
Kitchen: ${bookingData.kitchenName}
Date: ${formattedDate}
Time: ${bookingData.startTime} – ${bookingData.endTime}
${bookingData.cancellationReason ? `Reason: ${bookingData.cancellationReason}\n` : ''}
View bookings: ${getSubdomainUrl('kitchen')}/manager/bookings

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: bookingData.managerEmail, subject, text, html: prepareEmailHtml(html) };
};

// Booking confirmed notification email for managers (when manager confirms a booking)
export const generateBookingStatusChangeNotificationEmail = (bookingData: { managerEmail: string; managerName?: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; status: string; timezone?: string; locationName?: string; addons?: string; operatingWindowStartTime?: string | null; durationHours?: number; selectedSlots?: unknown }): EmailContent => {
  const chefFirstName = bookingData.chefName.split(' ')[0];
  const timezone = DEFAULT_TIMEZONE;
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const dashboardUrl = getDashboardUrl('kitchen');
  const managerFirstName = bookingData.managerName ? bookingData.managerName.split(' ')[0] : bookingData.managerEmail.split('@')[0];

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);
  const formattedDate = bookingDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Compute duration from start/end time
  const [startH, startM] = bookingData.startTime.split(':').map(Number);
  const [endH, endM] = bookingData.endTime.split(':').map(Number);
  const durationMins = bookingData.durationHours != null
    ? bookingData.durationHours * 60 : ((endH * 60 + endM) - (startH * 60 + startM) + 1440) % 1440;
  const durationHrs = Math.floor(durationMins / 60);
  const durationRemMins = durationMins % 60;
  const durationStr = durationRemMins > 0 ? `${durationHrs}h ${durationRemMins}m` : `${durationHrs}h`;

  const subject = `You Confirmed a Booking for ${formattedDate}`;

  // Generate calendar URL based on email provider - SAME event as chef receives for perfect sync
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.\n\nChef: ${bookingData.chefName}\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed`;
  const calendar = bookingCalendarParts(bookingData, bookingData.managerEmail, calendarTitle,
    locationName, calendarDescription, timezone);
  const icsContent = calendar.ics;

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 24px;">Thank you for confirming this booking. The chef has been notified, and your kitchen is now reserved for their session.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Booking Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${bookingData.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${calendar.timeLabel} (${durationStr})</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.addons ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Equipment/Storage:</span> <strong style="color: #1e293b;">${bookingData.addons}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 24px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Confirmed</span>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Add to Your Calendar:</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        ${calendar.linksHtml}
        <a href="cid:kitchen-booking.ics" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">&#128197; Download ICS File</a>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Before the Session:</p>
      <p class="message" style="margin-bottom: 20px;">The chef will arrive at ${bookingData.startTime}. Please ensure the kitchen and requested equipment are accessible and ready. You can reach ${chefFirstName} directly through the chat in your dashboard if you need to coordinate any details.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Need to Cancel or Reschedule?</p>
      <p class="message" style="margin-bottom: 20px;">If something comes up, please use the dashboard tools and notify the chef as soon as possible. Cancellations within 24 hours may affect your booking acceptance rate.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions or need assistance, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
      <p class="message" style="margin-top: 20px; color: #64748b;">Thank you for being part of Local Cooks.</p>
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
Hi ${managerFirstName},

Thank you for confirming this booking. The chef has been notified, and your kitchen is now reserved for their session.

Booking Details:
Chef: ${bookingData.chefName}
Date: ${formattedDate}
Time: ${calendar.timeLabel} (${durationStr})
Kitchen: ${bookingData.kitchenName}
${bookingData.addons ? `Equipment/Storage: ${bookingData.addons}\n` : ''}
${calendar.linksText}

Before the Session:
The chef will arrive at ${bookingData.startTime}. Please ensure the kitchen and requested equipment are accessible and ready. You can reach ${chefFirstName} directly through the chat in your dashboard if you need to coordinate any details.

Need to Cancel or Reschedule?
If something comes up, please use the dashboard tools and notify the chef as soon as possible. Cancellations within 24 hours may affect your booking acceptance rate.

Dashboard: ${dashboardUrl}

If you have any questions or need assistance, simply reply to this email or contact us at support@localcooks.ca

Thank you for being part of Local Cooks.

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.managerEmail,
    subject,
    text,
    html: prepareEmailHtml(html),
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingRequestEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; locationAddress?: string; operatingWindowStartTime?: string | null; selectedSlots?: unknown }): EmailContent => {
  const subject = `Your Booking Request Has Been Submitted`;
  const timezone = DEFAULT_TIMEZONE;
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const dashboardUrl = getDashboardUrl();
  const firstName = bookingData.chefName.split(' ')[0];

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);
  const formattedDate = bookingDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Generate calendar URL based on email provider
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Kitchen booking request for ${bookingData.kitchenName}.\n\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Pending Approval${bookingData.specialNotes ? `\n\nNotes: ${bookingData.specialNotes}` : ''}`;
  const calendar = bookingCalendarParts(bookingData, bookingData.chefEmail, calendarTitle,
    locationName, calendarDescription, timezone);
  const icsContent = calendar.ics;

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
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your booking request for ${bookingData.kitchenName}. We&#8217;ve sent it to the kitchen manager and are awaiting their confirmation.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Request Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${bookingData.locationAddress}</strong></p>` : (locationName !== bookingData.kitchenName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${locationName}</strong></p>` : '')}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${calendar.timeLabel}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Status:</span> <strong style="color: #f59e0b;">Pending Manager Confirmation</strong></p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What happens next:</p>
      <p class="message" style="margin-bottom: 20px;">The kitchen manager will review your request and respond within 24&#8211;48 hours. You&#8217;ll receive an email notification as soon as they confirm or decline your booking.</p>
      <p class="message" style="margin-bottom: 20px;">In the meantime, you can use the built-in chat with the kitchen manager if you need to clarify any details about your request.</p>
      <p class="message" style="margin-bottom: 20px;">You can also check your request status anytime from your dashboard.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Pending Confirmation</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        ${calendar.linksHtml}
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

Thank you for submitting your booking request for ${bookingData.kitchenName}. We've sent it to the kitchen manager and are awaiting their confirmation.

Request Details:
Kitchen: ${bookingData.kitchenName}
${bookingData.locationAddress ? `Location: ${bookingData.locationAddress}\n` : ''}Date: ${formattedDate}
Time: ${calendar.timeLabel}
Status: Pending Manager Confirmation

What happens next:
The kitchen manager will review your request and respond within 24–48 hours. You'll receive an email notification as soon as they confirm or decline your booking.

In the meantime, you can use the built-in chat with the kitchen manager if you need to clarify any details about your request.

You can also check your request status anytime from your dashboard: ${dashboardUrl}

${calendar.linksText}

If you have any questions, simply reply to this email or contact us at support@localcooks.ca

Best,
The Local Cooks Team

${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html),
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingConfirmationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; locationAddress?: string; addons?: string; checkInWindowMinutesBefore?: number; noShowGraceMinutes?: number; operatingWindowStartTime?: string | null; durationHours?: number; selectedSlots?: unknown; bookingId?: number; actionUrl?: string; isStaff?: boolean; checkinEnabled?: boolean; checkoutEnabled?: boolean; arrivalInstructions?: string; departureInstructions?: string; contactEmail?: string; paymentSummary?: string }): EmailContent => {
  const timezone = DEFAULT_TIMEZONE;
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const dashboardUrl = bookingData.actionUrl || getDashboardUrl();
  const firstName = bookingData.chefName.split(' ')[0];

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);
  const formattedDate = new Date(`${bookingDateObj.toISOString().slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

  // Compute duration from start/end time
  const [startH, startM] = bookingData.startTime.split(':').map(Number);
  const [endH, endM] = bookingData.endTime.split(':').map(Number);
  const durationMins = Array.isArray(bookingData.selectedSlots) && bookingData.selectedSlots.length > 0
    ? bookingData.selectedSlots.length * 60 : bookingData.durationHours != null
    ? bookingData.durationHours * 60 : ((endH * 60 + endM) - (startH * 60 + startM) + 1440) % 1440;
  const durationHrs = Math.floor(durationMins / 60);
  const durationRemMins = durationMins % 60;
  const durationStr = durationRemMins > 0 ? `${durationHrs}h ${durationRemMins}m` : `${durationHrs}h`;

  const subject = `${bookingData.isStaff ? 'Kitchen Booking Confirmed' : 'Your Kitchen Booking Is Confirmed'} for ${formattedDate}`;

  // Generate calendar URL based on email provider
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Confirmed kitchen booking for ${bookingData.kitchenName}.\n\nDate: ${formattedDate}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed${bookingData.specialNotes ? `\n\nNotes: ${bookingData.specialNotes}` : ''}`;
  const calendar = bookingCalendarParts(bookingData, bookingData.chefEmail, calendarTitle,
    bookingData.locationAddress || locationName, calendarDescription, timezone);
  const icsContent = calendar.ics;

  const changeGuidance = bookingData.isStaff
    ? 'Open the booking to review its current status and any cancellation request. Coordinate date/time change requests with the chef and Local Cooks at support@localcooks.ca.'
    : `Open the booking for current actions or to request cancellation. To request a date/time change, contact ${bookingData.contactEmail || 'support@localcooks.ca'}. Your confirmed dates remain in place until a change is agreed.`;
  const guidance = bookingData.isStaff ? [
    `Reference: Booking #${bookingData.bookingId}`,
    bookingData.paymentSummary,
    'Review the confirmed itinerary and any current tasks from the booking link.',
    bookingData.arrivalInstructions ? `Arrival instructions shared with the chef: ${bookingData.arrivalInstructions}` : '',
    bookingData.departureInstructions ? `Departure instructions shared with the chef: ${bookingData.departureInstructions}` : '',
    'Saved calendar events do not update automatically. Open the booking for the current schedule and actions.',
  ].filter(Boolean).join('\n') : [
    `Reference: ${bookingData.bookingId ? `Booking #${bookingData.bookingId}` : 'Kitchen booking'}`,
    bookingData.paymentSummary,
    bookingData.checkinEnabled === true
      ? (bookingData.checkInWindowMinutesBefore != null && bookingData.noShowGraceMinutes != null
        ? `Check-in opens ${bookingData.checkInWindowMinutesBefore} minutes before your session. If you have not checked in, you may be marked a no-show ${bookingData.noShowGraceMinutes} minutes after it begins.`
        : 'Check in for each visit when the action opens. View the booking for the current check-in window and requirements.')
      : 'Arrival tracking is off. Your confirmed reservation remains valid; follow the arrival instructions.',
    bookingData.checkoutEnabled === true ? 'Request checkout for each visit. Manager inspection remains pending until reviewed.' : 'Departure tracking is off. Follow the departure instructions.',
    bookingData.arrivalInstructions ? `Arrival instructions: ${bookingData.arrivalInstructions}` : 'Open the booking for current arrival guidance. Contact the manager if instructions are missing.',
    bookingData.departureInstructions ? `Departure instructions: ${bookingData.departureInstructions}` : '',
    bookingData.contactEmail ? `Kitchen contact: ${bookingData.contactEmail}` : 'For help contact support@localcooks.ca.',
    'Saved calendar events do not update automatically. Open the booking for the current schedule and actions.',
  ].filter(Boolean).join('\n');
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
      <p class="message" style="margin-bottom: 24px;">The booking at ${bookingData.kitchenName} has been confirmed!</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Booking Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${bookingData.locationAddress}</strong></p>` : (locationName !== bookingData.kitchenName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${locationName}</strong></p>` : '')}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${calendar.timeLabel} (${durationStr}; ${timezone})</strong></p>
        ${bookingData.addons ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Equipment/Storage Booked:</span> <strong style="color: #1e293b;">${bookingData.addons}</strong></p>` : ''}
      </div>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Confirmed</span>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Add to Your Calendar:</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        ${calendar.linksHtml}
        <a href="cid:kitchen-booking.ics" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">&#128197; Download ICS File</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px 0; text-align: center;">(Or open the attached calendar invite to add this booking to your preferred calendar app)</p>
      <p class="message" style="white-space:pre-line">${escapeHtml(guidance)}</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Need to Make Changes?</p>
      <p class="message" style="margin-bottom: 20px;">${escapeHtml(changeGuidance)}</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View booking and current actions</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">Contact us anytime at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a> or reply to this email.</p>
      <p class="message" style="margin-top: 20px; font-style: italic; color: #64748b;">Open the current booking whenever you need the latest status and available actions.</p>
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

The booking at ${bookingData.kitchenName} has been confirmed!

Booking Details:
Kitchen: ${bookingData.kitchenName}
${bookingData.locationAddress ? `Location: ${bookingData.locationAddress}\n` : ''}Date: ${formattedDate}
Time: ${calendar.timeLabel} (${durationStr}; ${timezone})
${bookingData.addons ? `Equipment/Storage Booked: ${bookingData.addons}\n` : ''}
${calendar.linksText}
(Or open the attached calendar invite to add this booking to your preferred calendar app)

${guidance}

Need to Make Changes?
${changeGuidance}
Current booking: ${dashboardUrl}

Contact us anytime at support@localcooks.ca or reply to this email.

Open the current booking whenever you need the latest status and available actions.

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html),
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
    }]
  };
};

export const generateBookingCancellationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string }): EmailContent => {
  const firstName = bookingData.chefName.split(' ')[0];
  const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
  const formattedDate = new Date(bookingData.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <p class="message" style="margin-bottom: 20px;">Your kitchen booking has been cancelled.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime}</strong></p>
        ${bookingData.cancellationReason ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${bookingData.cancellationReason}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Cancelled</span>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 20px;">You can make a new booking anytime from your dashboard.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getSubdomainUrl('chef')}/book-kitchen" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Browse Available Kitchens</a>
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

Your kitchen booking has been cancelled.

Kitchen: ${bookingData.kitchenName}
Date: ${formattedDate}
Time: ${bookingData.startTime} – ${bookingData.endTime}
${bookingData.cancellationReason ? `Reason: ${bookingData.cancellationReason}\n` : ''}
You can make a new booking anytime from your dashboard: ${getSubdomainUrl('chef')}/book-kitchen

If you have any questions, contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: bookingData.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Kitchen availability change notification email for chefs
export const generateKitchenAvailabilityChangeEmail = (data: { chefEmail: string; chefName: string; kitchenName: string; changeType: string; details: string }): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Kitchen Availability Update - ${data.kitchenName}`;

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
      <p class="message" style="margin-bottom: 20px;">The availability for <strong>${data.kitchenName}</strong> has been updated. Please check the updated availability before making your next booking.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Change:</span> <strong style="color: #1e293b;">${data.changeType}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Details:</span> <strong style="color: #1e293b;">${data.details}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getSubdomainUrl('chef')}/book-kitchen" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Kitchen Availability</a>
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

The availability for ${data.kitchenName} has been updated.

Change: ${data.changeType}
Details: ${data.details}

View availability: ${getSubdomainUrl('chef')}/book-kitchen

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Kitchen settings change notification email for chefs and managers
export const generateKitchenSettingsChangeEmail = (data: { email: string; name: string; kitchenName: string; changes: string; isChef: boolean }): EmailContent => {
  const firstName = data.name.split(' ')[0];
  const subject = `Kitchen Settings Updated - ${data.kitchenName}`;
  const ctaUrl = data.isChef ? `${getSubdomainUrl('chef')}/book-kitchen` : getDashboardUrl('kitchen');
  const ctaLabel = data.isChef ? 'View Kitchen Details' : 'View Kitchen Settings';
  const extraNote = data.isChef ? ' This may affect your existing or future bookings.' : '';

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
      <p class="message" style="margin-bottom: 20px;">The settings for <strong>${data.kitchenName}</strong> have been updated.${extraNote}</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Changes:</span> <strong style="color: #1e293b;">${data.changes}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${ctaUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">${ctaLabel}</a>
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

The settings for ${data.kitchenName} have been updated.${extraNote}

Changes: ${data.changes}

${ctaLabel}: ${ctaUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.email, subject, text, html: prepareEmailHtml(html) };
};

// Chef profile request notification email for managers
export const generateChefProfileRequestEmail = (data: { managerEmail: string; chefName: string; chefEmail: string; locationName: string; locationId: number }): EmailContent => {
  const subject = `Chef Access Request - ${data.locationName}`;
  const reviewUrl = `${getSubdomainUrl('kitchen')}/manager/applications`;

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">New Chef Access Request</h2>
      <p class="message" style="margin-bottom: 20px;">A chef has requested access to your location and kitchen facilities. Please review and approve or reject from your manager dashboard.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.chefEmail}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Pending Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${reviewUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Chef Request</a>
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
New Chef Access Request

Chef: ${data.chefName} (${data.chefEmail})
Location: ${data.locationName}
Status: Pending Review

Review: ${reviewUrl}

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.managerEmail, subject, text, html: prepareEmailHtml(html) };
};

// Chef location access approved notification email for chefs
export const generateChefLocationAccessApprovedEmail = (data: { chefEmail: string; chefName: string; locationName: string; locationId: number }): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Kitchen Access Approved - ${data.locationName}`;
  const bookingsUrl = `${getSubdomainUrl('chef')}/book-kitchen`;

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
      <p class="message" style="margin-bottom: 20px;">Your chef profile has been approved for kitchen access at <strong>${data.locationName}</strong>. You can now book kitchen facilities at this location.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingsUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Available Kitchens</a>
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

  const text = `Hi ${firstName},\n\nYour chef profile has been approved for kitchen access at ${data.locationName}. You can now book kitchen facilities at this location.\n\nView available kitchens: ${bookingsUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`;

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Chef kitchen access approved notification email for chefs (when manager approves kitchen profile)
export const generateChefKitchenAccessApprovedEmail = (data: { chefEmail: string; chefName: string; kitchenName: string; kitchenId: number }): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Kitchen Access Approved - ${data.kitchenName}`;
  const bookingsUrl = `${getSubdomainUrl('chef')}/book-kitchen`;

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
      <p class="message" style="margin-bottom: 20px;">Your chef profile has been approved for kitchen access at <strong>${data.kitchenName}</strong>. You can now book this kitchen from your dashboard.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingsUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Available Kitchens</a>
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

  const text = `Hi ${firstName},\n\nYour chef profile has been approved for kitchen access at ${data.kitchenName}. You can now book this kitchen from your dashboard.\n\nView available kitchens: ${bookingsUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`;

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Location notification email changed notification email
export const generateLocationEmailChangedEmail = (data: { email: string; locationName: string; locationId: number }): EmailContent => {
  const subject = `Location Notification Email Updated - ${data.locationName}`;
  const dashboardUrl = getDashboardUrl('kitchen');

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Notification Email Updated</h2>
      <p class="message" style="margin-bottom: 20px;">This email address has been set as the notification email for <strong>${data.locationName}</strong>. You&#8217;ll now receive notifications for bookings, cancellations, and other important updates for this location.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.email}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you didn&#8217;t make this change, contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

  const text = `Notification Email Updated\n\nThis email address has been set as the notification email for ${data.locationName}. You'll now receive notifications for bookings, cancellations, and other important updates.\n\nLocation: ${data.locationName}\nEmail: ${data.email}\n\nView dashboard: ${dashboardUrl}\n\nIf you didn't make this change, contact us at support@localcooks.ca\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`;

  return { to: data.email, subject, text, html: prepareEmailHtml(html) };
};

// ===================================
// STORAGE EXTENSION EMAILS
// ===================================

// Storage extension payment received - notify manager
export const generateStorageExtensionPendingApprovalEmail = (data: {
  managerEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
  totalPrice: number;
  locationName?: string;
}): EmailContent => {
  const subject = `Storage Extension Request - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=bookings`;
  const formattedPrice = `$${(data.totalPrice / 100).toFixed(2)}`;
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Storage Extension Request</h2>
      <p class="message" style="margin-bottom: 20px;">A chef has requested to extend their storage booking. Payment has been received and is awaiting your approval.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Extension:</span> <strong style="color: #1e293b;">${data.extensionDays} days</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">New End Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount Paid:</span> <strong style="color: #16a34a;">${formattedPrice}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Awaiting Approval</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Extension Request</a>
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

  return {
    to: data.managerEmail,
    subject,
    text: `Storage Extension Request\n\nChef: ${data.chefName}\nStorage: ${data.storageName}\nExtension: ${data.extensionDays} days\nNew End Date: ${formattedDate}\nAmount: ${formattedPrice}\nStatus: Awaiting Approval\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Storage extension payment received - notify chef
export const generateStorageExtensionPaymentReceivedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
  totalPrice: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Storage Extension Payment Received - ${data.storageName}`;
  const dashboardUrl = getDashboardUrl();
  const formattedPrice = `$${(data.totalPrice / 100).toFixed(2)}`;
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <p class="message" style="margin-bottom: 20px;">Your payment for the storage extension has been received. The manager has been notified and will review your request shortly.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Extension:</span> <strong style="color: #1e293b;">${data.extensionDays} days</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">New End Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount Paid:</span> <strong style="color: #16a34a;">${formattedPrice}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Awaiting Approval</span>
      </div>
      <p class="message" style="margin-top: 20px; margin-bottom: 20px;">You&#8217;ll receive a confirmation email once the manager approves your extension.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour payment for the storage extension has been received.\n\nStorage: ${data.storageName}\nExtension: ${data.extensionDays} days\nNew End Date: ${formattedDate}\nAmount: ${formattedPrice}\nStatus: Awaiting Approval\n\nView bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Storage extension approved - notify chef
export const generateStorageExtensionApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  newEndDate: Date;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Storage Extension Approved - ${data.storageName}`;
  const dashboardUrl = getDashboardUrl();
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <p class="message" style="margin-bottom: 20px;">Your storage extension has been approved. You can continue using the storage until the new end date.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Extension:</span> <strong style="color: #1e293b;">${data.extensionDays} days</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">New End Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour storage extension has been approved.\n\nStorage: ${data.storageName}\nExtension: ${data.extensionDays} days\nNew End Date: ${formattedDate}\n\nView bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Storage extension rejected - notify chef
export const generateStorageExtensionRejectedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  extensionDays: number;
  rejectionReason?: string;
  refundAmount?: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Storage Extension Declined - ${data.storageName}`;
  const dashboardUrl = getDashboardUrl();
  const refundText = data.refundAmount ? `A refund of $${(data.refundAmount / 100).toFixed(2)} has been processed and will be credited to your original payment method within 5&#8211;10 business days.` : 'Cancellation does not confirm a refund. Any refund is handled separately.';

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
      <p class="message" style="margin-bottom: 20px;">Unfortunately, your storage extension request has been declined.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Requested Extension:</span> <strong style="color: #1e293b;">${data.extensionDays} days</strong></p>
        ${data.rejectionReason ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${data.rejectionReason}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10007; Declined</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">${refundText}</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

  const refundPlainText = data.refundAmount ? `A refund of $${(data.refundAmount / 100).toFixed(2)} has been processed and will be credited within 5-10 business days.` : 'Cancellation does not confirm a refund. Any refund is handled separately.';

  return {
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour storage extension request has been declined.\n\nStorage: ${data.storageName}\nRequested Extension: ${data.extensionDays} days\n${data.rejectionReason ? `Reason: ${data.rejectionReason}\n` : ''}\n${refundPlainText}\n\nView bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// ===================================
// OVERSTAY PENALTY NOTIFICATION EMAILS
// ===================================

// Chef warning: Storage booking is expiring soon
export const generateStorageExpiringWarningEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  endDate: Date;
  daysUntilExpiry: number;
  gracePeriodDays: number;
  penaltyRate: number;
  dailyRateCents: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Storage Booking Expiring ${data.daysUntilExpiry === 0 ? 'Today' : `in ${data.daysUntilExpiry} Day${data.daysUntilExpiry > 1 ? 's' : ''}`}`;
  const dashboardUrl = getDashboardUrl();
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dailyRate = (data.dailyRateCents / 100).toFixed(2);
  const penaltyPerDay = ((data.dailyRateCents * data.penaltyRate) / 100).toFixed(2);
  const expiryText = data.daysUntilExpiry === 0 ? '<strong style="color: #dc2626;">expiring today</strong>' : `expiring in <strong>${data.daysUntilExpiry} day${data.daysUntilExpiry > 1 ? 's' : ''}</strong>`;

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
      <p class="message" style="margin-bottom: 20px;">Your storage booking is ${expiryText}. Please take action to avoid overstay penalties.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">End Date:</span> <strong style="color: #1e293b;">${formattedEndDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Daily Rate:</span> <strong style="color: #1e293b;">$${dailyRate} CAD</strong></p>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; font-weight: 600; color: #92400e; margin: 0 0 8px 0;">Overstay Policy</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0;">
          <tr>
            <td style="padding: 4px 10px 4px 0; vertical-align: top; width: 16px; color: #d97706; font-size: 14px; line-height: 22px;">&#8226;</td>
            <td style="padding: 4px 0; font-size: 14px; line-height: 1.5; color: #92400e;">Grace Period: ${data.gracePeriodDays} days after end date</td>
          </tr>
          <tr>
            <td style="padding: 4px 10px 4px 0; vertical-align: top; width: 16px; color: #d97706; font-size: 14px; line-height: 22px;">&#8226;</td>
            <td style="padding: 4px 0; font-size: 14px; line-height: 1.5; color: #92400e;">Penalty Rate: ${(data.penaltyRate * 100).toFixed(0)}% of daily rate ($${penaltyPerDay}/day)</td>
          </tr>
          <tr>
            <td style="padding: 4px 10px 4px 0; vertical-align: top; width: 16px; color: #d97706; font-size: 14px; line-height: 22px;">&#8226;</td>
            <td style="padding: 4px 0; font-size: 14px; line-height: 1.5; color: #92400e;">Penalties require manager approval before charging</td>
          </tr>
        </table>
      </div>
      <p class="message" style="margin-bottom: 8px;">To avoid penalties, please either:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Extend your storage booking</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Remove your items before the end date</td>
        </tr>
      </table>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Manage My Bookings</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour storage booking for ${data.storageName} is expiring on ${formattedEndDate}. Please extend or remove your items to avoid overstay penalties.\n\nGrace period: ${data.gracePeriodDays} days\nPenalty rate: ${(data.penaltyRate * 100).toFixed(0)}% of daily rate ($${penaltyPerDay}/day)\n\nManage bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

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
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = data.isInGracePeriod 
    ? `Storage Overstay - Grace Period Active` 
    : `Storage Overstay - Penalty Pending Review`;
  const dashboardUrl = getDashboardUrl();
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formattedGraceEnd = data.gracePeriodEndsAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const penaltyAmount = (data.calculatedPenaltyCents / 100).toFixed(2);
  const alertBg = data.isInGracePeriod ? '#fffbeb' : '#fef2f2';
  const alertBorder = data.isInGracePeriod ? '#fef3c7' : '#fecaca';
  const alertColor = data.isInGracePeriod ? '#92400e' : '#991b1b';

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
      <p class="message" style="margin-bottom: 20px;">Your storage booking has exceeded its end date.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">End Date:</span> <strong style="color: #1e293b;">${formattedEndDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Days Overdue:</span> <strong style="color: #1e293b;">${data.daysOverdue}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Grace Period Ends:</span> <strong style="color: #1e293b;">${formattedGraceEnd}</strong></p>
        ${!data.isInGracePeriod ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Calculated Penalty:</span> <strong style="color: #dc2626;">$${penaltyAmount} CAD</strong></p>` : ''}
      </div>
      <div style="background: ${alertBg}; border: 1px solid ${alertBorder}; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: ${alertColor}; margin: 0;">${data.isInGracePeriod ? `You are currently in the <strong>grace period</strong>. No penalties will be charged if you resolve this before <strong>${formattedGraceEnd}</strong>.` : `The grace period has ended. A penalty of <strong>$${penaltyAmount} CAD</strong> has been calculated and is pending manager review.`}</p>
      </div>
      <p class="message" style="margin-bottom: 8px;">To resolve this overstay, please:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Remove your items or resolve the overstay</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Contact the kitchen manager to arrange item removal</td>
        </tr>
      </table>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Manage My Bookings</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour storage booking for ${data.storageName} has exceeded its end date (${formattedEndDate}). Days overdue: ${data.daysOverdue}. ${data.isInGracePeriod ? `Grace period ends: ${formattedGraceEnd}. No penalties yet.` : `Calculated penalty: $${penaltyAmount} CAD (pending manager review).`}\n\nManage bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Chef notice: Penalty charged
export const generatePenaltyChargedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  penaltyAmountCents: number;
  daysOverdue: number;
  chargeDate: Date;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const penaltyAmount = (data.penaltyAmountCents / 100).toFixed(2);
  const subject = `Overstay Penalty Charged - $${penaltyAmount} CAD`;
  const dashboardUrl = getDashboardUrl();
  const formattedDate = data.chargeDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <p class="message" style="margin-bottom: 20px;">An overstay penalty has been charged to your payment method.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Days Overdue:</span> <strong style="color: #1e293b;">${data.daysOverdue}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Penalty Amount:</span> <strong style="color: #dc2626;">$${penaltyAmount} CAD</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Charge Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Penalty Charged</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">This charge was approved by the kitchen manager after the grace period ended. If you believe this charge is in error, please contact the kitchen manager directly.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nAn overstay penalty of $${penaltyAmount} CAD has been charged for ${data.storageName}.\n\nDays overdue: ${data.daysOverdue}\nCharge date: ${formattedDate}\n\nView bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Chef notice: Penalty approved by manager (charge pending)
export const generatePenaltyApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  kitchenName: string;
  daysOverdue: number;
  penaltyAmountCents: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const penaltyAmount = (data.penaltyAmountCents / 100).toFixed(2);
  const subject = `Overstay Penalty Approved - $${penaltyAmount} CAD`;
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
      <p class="message" style="margin-bottom: 20px;">The kitchen manager has approved an overstay penalty for your storage booking.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Days Overdue:</span> <strong style="color: #1e293b;">${data.daysOverdue}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Penalty Amount:</span> <strong style="color: #dc2626;">$${penaltyAmount} CAD</strong></p>
      </div>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #991b1b; margin: 0;">You can dispute this final amount from your bookings dashboard during the configured response window. Collection waits until that window ends and any dispute has been reviewed by Local Cooks.</p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

The kitchen manager has approved an overstay penalty for your storage booking at ${data.kitchenName}.

Storage: ${data.storageName}
Days Overdue: ${data.daysOverdue}
Penalty Amount: $${penaltyAmount} CAD

You can dispute this final amount from your bookings dashboard during the configured response window. Collection waits until that window ends and any dispute has been reviewed by Local Cooks.

View bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Chef notice: Penalty waived by manager
export const generatePenaltyWaivedEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  kitchenName: string;
  daysOverdue: number;
  waiveReason?: string;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Good News: Overstay Penalty Waived`;
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
      <p class="message" style="margin-bottom: 20px;">Good news! The kitchen manager has waived the overstay penalty for your storage booking.</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #166534; margin: 0;">No charges will be applied to your payment method.</p>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Days Overdue:</span> <strong style="color: #1e293b;">${data.daysOverdue}</strong></p>
        ${data.waiveReason ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${data.waiveReason}</strong></p>` : ''}
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

Good news! The kitchen manager has waived the overstay penalty for your storage booking at ${data.kitchenName}.

Storage: ${data.storageName}
Days Overdue: ${data.daysOverdue}
${data.waiveReason ? `Reason: ${data.waiveReason}` : ''}

No charges will be applied to your payment method.

View bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

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
}): EmailContent => {
  const subject = data.isInGracePeriod 
    ? `Storage Overstay Detected - ${data.storageName}` 
    : `Overstay Pending Review - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=overstays`;
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formattedGraceEnd = data.gracePeriodEndsAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const penaltyAmount = (data.calculatedPenaltyCents / 100).toFixed(2);
  const alertBg = data.isInGracePeriod ? '#fffbeb' : '#fef2f2';
  const alertBorder = data.isInGracePeriod ? '#fef3c7' : '#fecaca';
  const alertColor = data.isInGracePeriod ? '#92400e' : '#991b1b';

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Overstay Alert</h2>
      <p class="message" style="margin-bottom: 20px;">A storage booking at <strong>${data.kitchenName}</strong> has exceeded its end date.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName} (${data.chefEmail})</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">End Date:</span> <strong style="color: #1e293b;">${formattedEndDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Days Overdue:</span> <strong style="color: #1e293b;">${data.daysOverdue}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Grace Period Ends:</span> <strong style="color: #1e293b;">${formattedGraceEnd}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Calculated Penalty:</span> <strong style="color: #dc2626;">$${penaltyAmount} CAD</strong></p>
      </div>
      <div style="background: ${alertBg}; border: 1px solid ${alertBorder}; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: ${alertColor}; margin: 0;">${data.isInGracePeriod ? `The chef is currently in the grace period (ends ${formattedGraceEnd}). No action required yet, but you may want to reach out.` : `<strong>Action Required:</strong> The grace period has ended. Please review and decide whether to approve, adjust, or waive the penalty.`}</p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Overstays</a>
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

  return {
    to: data.managerEmail,
    subject,
    text: `Overstay Alert: ${data.storageName} at ${data.kitchenName}\n\nChef: ${data.chefName} (${data.chefEmail})\nDays overdue: ${data.daysOverdue}\nCalculated penalty: $${penaltyAmount} CAD\n${data.isInGracePeriod ? 'Grace period active.' : 'Action required - please review.'}\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// ===================================
// KITCHEN APPLICATION NOTIFICATION EMAILS (Manager)
// ===================================

// Notify manager about new kitchen application from chef
export const generateNewKitchenApplicationManagerEmail = (data: {
  managerEmail: string;
  managerName?: string;
  chefName: string;
  chefEmail: string;
  locationName: string;
  applicationId: number;
  submittedAt: Date;
}): EmailContent => {
  const subject = `New Kitchen Access Application from ${data.chefName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=applications`;
  const managerFirstName = data.managerName ? data.managerName.split(' ')[0] : data.managerEmail.split('@')[0];
  const chefFirstName = data.chefName.split(' ')[0];
  
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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 20px;">You&#8217;ve received a new <strong>request to apply</strong> from a chef interested in ${data.locationName}. Our Team reviews that request first — you&#8217;ll be notified when kitchen documents are ready for your review.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Chef Information:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0;"><span style="color: #64748b;">Name:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
      </div>
      <div style="margin: 0 0 24px 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: #f8fafc; color: #1e293b !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0; border: 1px solid #e2e8f0;">View Dashboard</a>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What to expect:</p>
      <p class="message" style="margin-bottom: 20px;">No action is needed from you right now. We&#8217;ll notify you when ${chefFirstName}'s documents are ready for your review.</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 16px 0 0 0; text-align: center;">We recommend responding within 3&#8211;5 business days.</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 16px 0 0 0;">If you have any questions about this application, you can reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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
Hi ${managerFirstName},

You've received a new request to apply from a chef interested in ${data.locationName}. Our Team reviews that request first — you'll be notified when kitchen documents are ready for your review.

Chef Information:
Name: ${data.chefName}

What to expect:
No action is needed from you right now. We'll notify you when ${chefFirstName}'s documents are ready for your review.

View dashboard at: ${dashboardUrl}

We recommend responding within 3–5 business days.

If you have any questions about this application, you can reply to this email or contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

export const generateKitchenApplicationClearedManagerEmail = (data: {
  managerEmail: string;
  managerName: string;
  chefName: string;
  locationName: string;
}): EmailContent => ({
  to: data.managerEmail,
  subject: `Application cleared by Local Cooks - ${data.chefName}`,
  text: `Hi ${data.managerName},\n\nLocal Cooks approved ${data.chefName}'s request to apply for ${data.locationName}. The application is now visible in your dashboard. You will be notified when the chef submits their Chef Application Requirements for your review.\n\n${getSubdomainUrl('kitchen')}/manager/dashboard?view=applications\n\nThe Local Cooks Team`,
  html: prepareEmailHtml(`<p>Hi ${data.managerName},</p><p>Local Cooks approved <strong>${data.chefName}</strong>'s request to apply for <strong>${data.locationName}</strong>.</p><p>The application is now visible in your dashboard. You will be notified when the chef submits their Chef Application Requirements for your review.</p><p><a href="${getSubdomainUrl('kitchen')}/manager/dashboard?view=applications">View application</a></p>${getUniformEmailFooter()}`),
});

// Notify the kitchen manager when an admin-approved chef submits the
// kitchen-specific coordination documents for review.
export const generateKitchenCoordinationSubmittedManagerEmail = (data: {
  managerEmail: string;
  managerName?: string;
  chefName: string;
  chefEmail: string;
  locationName: string;
  applicationId: number;
  submittedAt: Date;
}): EmailContent => {
  const subject = `Chef Application Requirements Ready for Review – ${data.chefName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=applications`;
  const managerFirstName = data.managerName
    ? data.managerName.split(' ')[0]
    : data.managerEmail.split('@')[0];

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head>
<body>
  <div class="email-container">
    <div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" /></div>
    <div class="content">
      <h2 class="greeting">Hi ${managerFirstName},</h2>
      <p class="message"><strong>${data.chefName}</strong> has submitted their Chef Application Requirements for <strong>${data.locationName}</strong>.</p>
      <p class="message">Please review the documents and approve or request changes so the chef can complete kitchen access.</p>
      <div style="text-align:center;margin:24px 0"><a href="${dashboardUrl}" class="cta-button">Review Chef Application Requirements</a></div>
      <p style="font-size:13px;color:#94a3b8">Submitted ${data.submittedAt.toLocaleString('en-CA')} · Application #${data.applicationId}</p>
    </div>
    <div class="footer"><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks</p></div>
  </div>
</body>
</html>`;

  return {
    to: data.managerEmail,
    subject,
    text: `Hi ${managerFirstName},\n\n${data.chefName} has submitted their Chef Application Requirements for ${data.locationName}. Please review them in your dashboard so the chef can complete kitchen access.\n\nReview: ${dashboardUrl}\nApplication #${data.applicationId}`,
    html: prepareEmailHtml(html),
  };
};

// Notify chef immediately after they submit their kitchen application (submission confirmation)
export const generateKitchenApplicationReceivedChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  locationAddress?: string;
}): EmailContent => {
  const subject = `Application Received – ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl()}?view=kitchen-requests`;
  const firstName = data.chefName.split(' ')[0];

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
      <p class="message" style="margin-bottom: 20px;">Thanks for requesting to apply at <strong>${data.locationName}</strong>. We&#8217;ve received your request and Our Team will review it shortly.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        ${data.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Address:</span> <strong style="color: #1e293b;">${data.locationAddress}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Status:</span> <strong style="color: #d97706;">Under Review</strong></p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What happens next:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Our Team will review your request to apply within 3&#8211;5 business days</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">You&#8217;ll receive an email when a decision has been made</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">You can track your application status in your dashboard at any time</td>
        </tr>
      </table>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#8987; Under Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Applications</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

Thanks for requesting to apply at ${data.locationName}. We've received your request and Our Team will review it shortly.

Kitchen: ${data.locationName}
${data.locationAddress ? `Address: ${data.locationAddress}\n` : ''}Status: Under Review

What happens next:

• Our Team will review your request to apply within 3–5 business days
• You'll receive an email when a decision has been made
• You can track your application status in your dashboard at any time

View your application at: ${dashboardUrl}

If you have any questions, simply reply to this email or contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Notify chef immediately after they submit their Kitchen Coordination documents (submission confirmation)
export const generateKitchenApplicationStep2ReceivedChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  locationAddress?: string;
}): EmailContent => {
  const subject = `Chef Application Requirements Received – ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl()}?view=kitchen-requests`;
  const firstName = data.chefName.split(' ')[0];

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
      <p class="message" style="margin-bottom: 20px;">We&#8217;ve received your Chef Application Requirements for <strong>${data.locationName}</strong>. The kitchen manager will review them and get back to you shortly.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        ${data.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Address:</span> <strong style="color: #1e293b;">${data.locationAddress}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Status:</span> <strong style="color: #d97706;">Chef Application Requirements Under Review</strong></p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What happens next:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">The kitchen manager will review your Chef Application Requirements</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">You&#8217;ll receive an email once you&#8217;re fully approved and able to book</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">You can track your application status in your dashboard at any time</td>
        </tr>
      </table>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#8987; Chef Application Requirements Under Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Applications</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

We've received your Chef Application Requirements for ${data.locationName}. The kitchen manager will review them and get back to you shortly.

Kitchen: ${data.locationName}
${data.locationAddress ? `Address: ${data.locationAddress}\n` : ''}Status: Chef Application Requirements Under Review

What happens next:

• The kitchen manager will review your Chef Application Requirements
• You'll receive an email once you're fully approved and able to book
• You can track your application status in your dashboard at any time

View your application at: ${dashboardUrl}

If you have any questions, simply reply to this email or contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Notify chef when their Step 1 kitchen application is approved by platform admins
export const generateKitchenApplicationSubmittedChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  locationAddress?: string;
}): EmailContent => {
  const subject = `Request to apply approved for ${data.locationName} – Next Steps`;
  const dashboardUrl = `${getDashboardUrl()}?view=kitchen-requests`;
  const firstName = data.chefName.split(' ')[0];
  
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
      <p class="message" style="margin-bottom: 20px;">Good news &#8212; your request to apply for ${data.locationName} has been approved.</p>
      <p class="message" style="margin-bottom: 24px;">You now have access to the chat feature with this kitchen inside your Local Cooks dashboard. This allows you and the kitchen manager to coordinate directly and share any information needed to complete your Chef Application Requirements.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What to do next:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Use the chat in your dashboard to connect with the kitchen manager</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Confirm any requirements or details they need from you</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 10px;">When you&#8217;re ready, complete your Chef Application Requirements by submitting your:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Food establishment certificate</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Insurance documents (if required)</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Any additional information requested in the Chef Application Requirements form</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 20px;">Once your Chef Application Requirements are submitted and approved, you&#8217;ll be able to start booking this kitchen through Local Cooks.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Request to apply approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions about the process, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

Good news — your request to apply for ${data.locationName} has been approved.

You now have access to the chat feature with this kitchen inside your Local Cooks dashboard. This allows you and the kitchen manager to coordinate directly and share any information needed to complete your Chef Application Requirements.

What to do next:

• Use the chat in your dashboard to connect with the kitchen manager
• Confirm any requirements or details they need from you

When you're ready, complete your Chef Application Requirements by submitting your:

• Food establishment certificate
• Insurance documents (if required)
• Any additional information requested in the Chef Application Requirements form

Once your Chef Application Requirements are submitted and approved, you'll be able to start booking this kitchen through Local Cooks.

Go to your dashboard at: ${dashboardUrl}

If you have any questions about the process, simply reply to this email or contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Notify chef when their Chef Application Requirements are fully approved (can now book)
export const generateKitchenApplicationApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  kitchenName?: string;
}): EmailContent => {
  const locationDisplay = data.locationName.trim();
  const subject = `Congratulations! Your kitchen application for ${locationDisplay} is approved — Start booking`;
  const dashboardUrl = `${getEmailLinkOrigin('chef')}/dashboard?view=kitchen-applications`;
  const firstName = data.chefName.split(' ')[0];
  const kitchenDisplay = data.kitchenName?.trim() || locationDisplay;
  
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
      <p class="message" style="margin-bottom: 20px;">Your Chef Application Requirements for ${locationDisplay} has been reviewed and approved.</p>
      <p class="message" style="margin-bottom: 24px;">You now have access to this kitchen through Local Cooks and can begin submitting booking requests based on the kitchen&#8217;s availability.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">What you can do now:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">View ${kitchenDisplay}&#8217;s schedule and available time slots</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Submit booking requests directly from your dashboard</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Coordinate final details with the kitchen via the built-in chat</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 20px;">Please make sure you continue to follow the kitchen&#8217;s specific guidelines and any local food safety requirements when using the space.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Application Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions about bookings or how to use the platform, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

Your Chef Application Requirements for ${locationDisplay} has been reviewed and approved.

You now have access to this kitchen through Local Cooks and can begin submitting booking requests based on the kitchen's availability.

What you can do now:

• View ${kitchenDisplay}'s schedule and available time slots
• Submit booking requests directly from your dashboard
• Coordinate final details with the kitchen via the built-in chat

Please make sure you continue to follow the kitchen's specific guidelines and any local food safety requirements when using the space.

Go to your dashboard at: ${dashboardUrl}

If you have any questions about bookings or how to use the platform, simply reply to this email or contact us at support@localcooks.ca

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Notify chef when their kitchen application is rejected
export const generateKitchenApplicationRejectedEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  feedback?: string;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Kitchen Application Update - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl()}?view=kitchen-requests`;

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
      <p class="message" style="margin-bottom: 20px;">Thank you for your interest in using our kitchen facilities. Unfortunately, your application could not be approved at this time.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        ${data.feedback ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Feedback:</span> <strong style="color: #1e293b;">${data.feedback}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Not Approved</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">You may reapply in the future or explore other kitchen locations on our platform.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Applications</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nThank you for your interest. Unfortunately, your kitchen application to ${data.locationName} could not be approved at this time.${data.feedback ? `\n\nFeedback: ${data.feedback}` : ''}\n\nYou may reapply or explore other locations: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// ===================================
// KITCHEN LICENSE NOTIFICATION EMAILS
// ===================================

// Notify manager when their kitchen license is approved by admin
export const generateKitchenLicenseApprovedEmail = (data: {
  managerEmail: string;
  managerName: string;
  locationName: string;
  approvedAt: Date;
}): EmailContent => {
  const subject = `Your Kitchen Is Approved and Ready to List on Local Cooks`;
  const dashboardUrl = getDashboardUrl('kitchen');
  const firstName = data.managerName.split(' ')[0];
  
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
      <p class="message" style="margin-bottom: 20px;">Great news &#8212; your kitchen license has been reviewed and approved. Your account is now fully set up to host chefs and food businesses on Local Cooks.</p>
      <p class="message" style="margin-bottom: 10px;">From your dashboard, you can now:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Create and publish listings for your kitchen, storage, and equipment</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Set your availability and pricing to match your schedule and capacity</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Review and manage booking requests from verified chefs and food entrepreneurs</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 20px;">This is a great moment to add clear details and good photos to your listings so chefs can quickly understand what your space offers and when it&#8217;s available.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0; text-align: center;">We&#8217;re here to help you get the most out of the platform. If you&#8217;d like guidance on setting up your first listing or optimizing your availability and pricing, simply reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

Great news — your kitchen license has been reviewed and approved. Your account is now fully set up to host chefs and food businesses on Local Cooks.

From your dashboard, you can now:

• Create and publish listings for your kitchen, storage, and equipment
• Set your availability and pricing to match your schedule and capacity
• Review and manage booking requests from verified chefs and food entrepreneurs

This is a great moment to add clear details and good photos to your listings so chefs can quickly understand what your space offers and when it's available.

Go to your dashboard at: ${dashboardUrl}

We're here to help you get the most out of the platform. If you'd like guidance on setting up your first listing or optimizing your availability and pricing, simply reply to this email or contact us at support@localcooks.ca

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html: prepareEmailHtml(html)
  };
};

// Notify manager when their kitchen license is rejected by admin
export const generateKitchenLicenseRejectedEmail = (data: {
  managerEmail: string;
  managerName: string;
  locationName: string;
  feedback?: string;
}): EmailContent => {
  const firstName = data.managerName.split(' ')[0];
  const subject = `Kitchen License Update Required - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=settings-license`;

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
      <p class="message" style="margin-bottom: 20px;">Your kitchen license submission requires attention. It could not be approved at this time.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        ${data.feedback ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Feedback:</span> <strong style="color: #1e293b;">${data.feedback}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Action Required</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">Please review the feedback and upload a new license document from your dashboard.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Upload New License</a>
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

  return {
    to: data.managerEmail,
    subject,
    text: `Hi ${firstName},\n\nYour kitchen license for ${data.locationName} requires attention.${data.feedback ? `\n\nFeedback: ${data.feedback}` : ''}\n\nPlease upload a new license: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
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
}): EmailContent => {
  const isUpdate = data.isUpdate || false;
  const subject = isUpdate 
    ? `Kitchen License Update Pending Review - ${data.locationName}`
    : `Kitchen License Pending Review - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl('admin')}?section=kitchen-licenses`;
  const formattedDate = data.submittedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">${isUpdate ? 'Kitchen License Update Pending Review' : 'Kitchen License Pending Review'}</h2>
      <p class="message" style="margin-bottom: 20px;">${isUpdate 
        ? `A manager has submitted an <strong>updated</strong> kitchen license for your review. The current license remains active until this update is approved.` 
        : 'A manager has submitted a kitchen license for your review.'}</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Manager:</span> <strong style="color: #1e293b;">${data.managerName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.managerEmail}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Submitted:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        ${isUpdate ? '<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Type:</span> <strong style="color: #d97706;">License Update</strong></p>' : ''}
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: ${isUpdate ? '#fef3c7' : '#fffbeb'}; color: ${isUpdate ? '#d97706' : '#d97706'}; border: 1px solid ${isUpdate ? '#fcd34d' : '#fef3c7'}; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; ${isUpdate ? 'Update Pending' : 'Pending Review'}</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">${isUpdate ? 'Review License Update' : 'Review License'}</a>
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

  const textBody = isUpdate 
    ? `Kitchen License Update Pending Review\n\nManager: ${data.managerName} (${data.managerEmail})\nLocation: ${data.locationName}\nSubmitted: ${formattedDate}\nType: License Update (current license remains active)\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`
    : `Kitchen License Pending Review\n\nManager: ${data.managerName} (${data.managerEmail})\nLocation: ${data.locationName}\nSubmitted: ${formattedDate}\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`;

  return {
    to: data.adminEmail,
    subject,
    text: textBody,
    html: prepareEmailHtml(html)
  };
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
}): EmailContent => {
  const firstName = data.managerName.split(" ")[0];
  const dashboardUrl = `${getDashboardUrl("kitchen")}?view=settings-license`;

  // Formatted from parts, not from `new Date("YYYY-MM-DD")` — that parses as UTC
  // midnight and renders a day early west of Greenwich.
  const [y, m, d] = data.expiryDate.slice(0, 10).split("-").map(Number);
  const formattedExpiry = new Date(y, m - 1, d).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const days = data.daysLeft;

  const copy = {
    "30_day": {
      subject: `Your kitchen license expires on ${formattedExpiry} — ${data.locationName}`,
      headline: "Your kitchen license needs renewing",
      badge: { label: "Action needed", bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
      lead: `Your commercial kitchen license for <strong>${data.locationName}</strong> expires on <strong>${formattedExpiry}</strong> — ${days} days from now.`,
      body: `Renewing ahead of the date keeps your listing live the whole time. Upload the new document now and your current license keeps working until we finish reviewing the replacement, so you won't lose any bookings while you wait.`,
      plain: `Your commercial kitchen license for ${data.locationName} expires on ${formattedExpiry} (${days} days from now).\n\nRenewing ahead of the date keeps your listing live the whole time. Upload the new document now and your current license keeps working until we finish reviewing the replacement.`,
    },
    "7_day": {
      subject: `${days} days left to renew your kitchen license — ${data.locationName}`,
      headline: "One week left on your kitchen license",
      badge: { label: "Expires soon", bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
      lead: `Your commercial kitchen license for <strong>${data.locationName}</strong> expires on <strong>${formattedExpiry}</strong> — ${days} days from now.`,
      body: `Once it expires we have to pause <strong>${data.locationName}</strong> and chefs won't be able to book it until a valid license is approved. Upload the renewal now and your current license stays active through the review, so nothing stops.`,
      plain: `Your commercial kitchen license for ${data.locationName} expires on ${formattedExpiry} (${days} days from now).\n\nOnce it expires we have to pause ${data.locationName} and chefs won't be able to book it until a valid license is approved. Upload the renewal now and your current license stays active through the review.`,
    },
    expired: {
      subject: `Your kitchen license has expired — ${data.locationName} is paused`,
      headline: "Your kitchen license has expired",
      badge: { label: "Listing paused", bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
      lead: `Your commercial kitchen license for <strong>${data.locationName}</strong> expired on <strong>${formattedExpiry}</strong>.`,
      body: `We've paused <strong>${data.locationName}</strong> so no new bookings can come in, and it is hidden from chefs searching for a kitchen. Upload the renewed license and we'll review it — most reviews finish within 1–2 business days, and your listing goes live again as soon as it's approved.`,
      plain: `Your commercial kitchen license for ${data.locationName} expired on ${formattedExpiry}.\n\nWe've paused ${data.locationName} so no new bookings can come in, and it is hidden from chefs searching for a kitchen. Upload the renewed license and we'll review it — most reviews finish within 1-2 business days, and your listing goes live again as soon as it's approved.`,
    },
  }[data.stage];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">${copy.lead}</p>
      <p class="message" style="margin-bottom: 20px;">${copy.body}</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: ${copy.badge.bg}; color: ${copy.badge.fg}; border: 1px solid ${copy.badge.border}; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">${copy.badge.label}</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Upload Renewed License</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0; text-align: center;">A valid commercial kitchen license is required for your kitchen to accept bookings. If you have questions about what counts, just reply to this email or contact us at <a href="mailto:support@localcooks.ca" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcooks.ca</a></p>
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

  const text = `Hi ${firstName},

${copy.plain}

Upload renewed license: ${dashboardUrl}

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks`;

  return {
    to: data.managerEmail,
    subject: copy.subject,
    text,
    html: prepareEmailHtml(html),
  };
};

// ===================================
// DAMAGE CLAIM NOTIFICATION EMAILS
// ===================================

// Notify chef when a damage claim is filed against them
export const generateDamageClaimFiledEmail = (data: {
  chefEmail: string;
  chefName: string;
  managerName: string;
  locationName: string;
  claimTitle: string;
  claimedAmount: string;
  damageDate: string;
  responseDeadline: string;
  claimId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Damage Claim Filed - Action Required`;
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
      <p class="message" style="margin-bottom: 20px;">A damage claim has been filed against your booking. Please review and respond before the deadline.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Claim:</span> <strong style="color: #1e293b;">${data.claimTitle}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount:</span> <strong style="color: #1e293b;">${data.claimedAmount}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Filed by:</span> <strong style="color: #1e293b;">${data.managerName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Damage Date:</span> <strong style="color: #1e293b;">${data.damageDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Response Deadline:</span> <strong style="color: #dc2626;">${data.responseDeadline}</strong></p>
      </div>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #991b1b; margin: 0;">You can accept the claim or ask Local Cooks to review it. If you don&#8217;t respond by the deadline, the claim may be automatically approved.</p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review &amp; Respond</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nA damage claim has been filed against your booking at ${data.locationName}.\n\nClaim: ${data.claimTitle}\nAmount: ${data.claimedAmount}\nDeadline: ${data.responseDeadline}\n\nRespond: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Notify manager when chef responds to their damage claim
export const generateDamageClaimResponseEmail = (data: {
  managerEmail: string;
  managerName: string;
  chefName: string;
  claimTitle: string;
  claimedAmount: string;
  response: 'accepted' | 'disputed';
  chefResponse?: string;
  claimId: number;
}): EmailContent => {
  const managerFirstName = data.managerName.split(' ')[0];
  const isAccepted = data.response === 'accepted';
  const subject = `Damage Claim ${isAccepted ? 'Accepted' : 'Disputed'} - ${data.claimTitle}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}?view=damage-claims`;
  const statusColor = isAccepted ? '#16a34a' : '#dc2626';
  const statusText = isAccepted ? 'Accepted' : 'Disputed';
  const badgeBg = isAccepted ? '#f0fdf4' : '#fef2f2';
  const badgeBorder = isAccepted ? '#dcfce7' : '#fecaca';
  const nextSteps = isAccepted
    ? 'You can now charge the chef&#8217;s saved payment method from your dashboard.'
    : 'Local Cooks will review the disputed claim. You will be notified of the decision.';

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 20px;">${data.chefName} has responded to your damage claim.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Claim:</span> <strong style="color: #1e293b;">${data.claimTitle}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount:</span> <strong style="color: #1e293b;">${data.claimedAmount}</strong></p>
        ${data.chefResponse ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Chef&#8217;s Response:</span> <strong style="color: #1e293b;">${data.chefResponse}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: ${badgeBg}; color: ${statusColor}; border: 1px solid ${badgeBorder}; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">${statusText}</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">${nextSteps}</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Claim</a>
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

  return {
    to: data.managerEmail,
    subject,
    text: `Hi ${managerFirstName},\n\n${data.chefName} has ${data.response} your damage claim "${data.claimTitle}" for ${data.claimedAmount}.${data.chefResponse ? `\n\nResponse: ${data.chefResponse}` : ''}\n\n${isAccepted ? 'You can now charge from your dashboard.' : 'Local Cooks will review the disputed claim.'}\n\nView claim: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Notify admin when a damage claim is disputed
export const generateDamageClaimDisputedAdminEmail = (data: {
  adminEmail: string;
  chefName: string;
  chefEmail: string;
  managerName: string;
  locationName: string;
  claimTitle: string;
  claimedAmount: string;
  chefResponse: string;
  claimId: number;
}): EmailContent => {
  const subject = `Damage Claim Disputed - Admin Review Required`;
  const dashboardUrl = `${getDashboardUrl('admin')}?section=damage-claims`;

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
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Damage Claim Dispute &#8212; Review Required</h2>
      <p class="message" style="margin-bottom: 20px;">A chef has disputed a damage claim and requires your review.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Claim:</span> <strong style="color: #1e293b;">${data.claimTitle}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount:</span> <strong style="color: #1e293b;">${data.claimedAmount}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Manager:</span> <strong style="color: #1e293b;">${data.managerName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName} (${data.chefEmail})</strong></p>
      </div>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; font-weight: 600; color: #991b1b; margin: 0 0 4px 0;">Chef&#8217;s Dispute Reason:</p>
        <p style="font-size: 14px; line-height: 1.6; color: #991b1b; margin: 0;">${data.chefResponse}</p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Dispute</a>
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
    text: `Damage Claim Dispute - Review Required\n\nClaim: ${data.claimTitle}\nAmount: ${data.claimedAmount}\nLocation: ${data.locationName}\nManager: ${data.managerName}\nChef: ${data.chefName} (${data.chefEmail})\n\nDispute Reason: ${data.chefResponse}\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Notify chef and manager of admin decision on disputed claim
export const generateDamageClaimDecisionEmail = (data: {
  recipientEmail: string;
  recipientName: string;
  recipientRole: 'chef' | 'manager';
  claimTitle: string;
  claimedAmount: string;
  decision: 'approved' | 'partially_approved' | 'rejected';
  finalAmount?: string;
  decisionReason: string;
  claimId: number;
}): EmailContent => {
  const firstName = data.recipientName.split(' ')[0];
  const isChef = data.recipientRole === 'chef';
  const decisionLabels = {
    approved: 'Approved',
    partially_approved: 'Partially Approved',
    rejected: 'Rejected'
  };
  const decisionColors: Record<string, string> = {
    approved: '#16a34a',
    partially_approved: '#d97706',
    rejected: '#dc2626'
  };
  const badgeBgs: Record<string, string> = {
    approved: '#f0fdf4',
    partially_approved: '#fffbeb',
    rejected: '#fef2f2'
  };
  const badgeBorders: Record<string, string> = {
    approved: '#dcfce7',
    partially_approved: '#fef3c7',
    rejected: '#fecaca'
  };

  const subject = `Damage Claim ${decisionLabels[data.decision]} - ${data.claimTitle}`;
  const dashboardUrl = isChef
    ? getDashboardUrl()
    : getDashboardUrl('kitchen');

  const nextStepsChef = data.decision === 'rejected'
    ? 'No payment will be charged to your account.'
    : 'The approved amount will be charged to your saved payment method.';
  const nextStepsManager = data.decision === 'rejected'
    ? 'The claim has been rejected and no payment will be collected.'
    : 'You can now charge the chef from your dashboard.';

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
      <p class="message" style="margin-bottom: 20px;">Local Cooks has made a decision on the disputed damage claim.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Claim:</span> <strong style="color: #1e293b;">${data.claimTitle}</strong></p>
        ${data.decision === 'partially_approved' && data.finalAmount
          ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Final Amount:</span> <strong style="color: #1e293b;">${data.finalAmount}</strong> <span style="color: #94a3b8;">(originally ${data.claimedAmount})</span></p>`
          : `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount:</span> <strong style="color: #1e293b;">${data.claimedAmount}</strong></p>`}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 8px 0 0 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${data.decisionReason}</strong></p>
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: ${badgeBgs[data.decision]}; color: ${decisionColors[data.decision]}; border: 1px solid ${badgeBorders[data.decision]}; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">${decisionLabels[data.decision]}</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">${isChef ? nextStepsChef : nextStepsManager}</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Details</a>
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
    to: data.recipientEmail,
    subject,
    text: `Hi ${firstName},\n\nLocal Cooks has ${decisionLabels[data.decision].toLowerCase()} the damage claim "${data.claimTitle}".\n\n${data.decisionReason}\n\nView details: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
};

// Notify chef when their card is charged for a damage claim
export const generateDamageClaimChargedEmail = (data: {
  chefEmail: string;
  chefName: string;
  claimTitle: string;
  chargedAmount: string;
  locationName: string;
  claimId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Payment Processed - Damage Claim`;
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
      <p class="message" style="margin-bottom: 20px;">A payment has been processed for a damage claim.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Claim:</span> <strong style="color: #1e293b;">${data.claimTitle}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Amount Charged:</span> <strong style="color: #1e293b;">${data.chargedAmount}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
      </div>
      <div style="margin: 0 0 16px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Payment Complete</span>
      </div>
      <p class="message" style="margin-bottom: 20px;">This charge was made to your saved payment method. A receipt has been sent to your email by Stripe.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Details</a>
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
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nA payment of ${data.chargedAmount} has been processed for the damage claim "${data.claimTitle}" at ${data.locationName}.\n\nView details: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html: prepareEmailHtml(html)
  };
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
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

// ===================================
// BOOKING REFUND EMAIL
// ===================================

// Chef notice: Booking refund processed
export const generateBookingRefundEmail = (data: {
  chefEmail: string;
  chefName: string;
  bookingType: 'kitchen' | 'storage' | 'equipment' | 'bundle';
  bookingName: string;
  locationName?: string;
  refundAmountCents: number;
  isFullRefund: boolean;
  reason?: string;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const refundAmount = (data.refundAmountCents / 100).toFixed(2);
  const bookingTypeLabel = data.bookingType === 'kitchen' ? 'Kitchen Booking' 
    : data.bookingType === 'storage' ? 'Storage Booking'
    : data.bookingType === 'equipment' ? 'Equipment Booking'
    : 'Bundle Booking';
  const subject = data.isFullRefund 
    ? `Refund Processed - $${refundAmount} CAD` 
    : `Partial Refund Processed - $${refundAmount} CAD`;
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
      <p class="message" style="margin-bottom: 20px;">A ${data.isFullRefund ? 'full' : 'partial'} refund has been processed for your ${bookingTypeLabel.toLowerCase()}.</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin: 0 0 24px 0;">
        <p style="font-size: 14px; line-height: 1.6; color: #166534; margin: 0;"><strong>$${refundAmount} CAD</strong> will be returned to your original payment method within 5-10 business days.</p>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Booking:</span> <strong style="color: #1e293b;">${data.bookingName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Type:</span> <strong style="color: #1e293b;">${bookingTypeLabel}</strong></p>
        ${data.locationName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>` : ''}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Refund Amount:</span> <strong style="color: #166534;">$${refundAmount} CAD</strong></p>
        ${data.reason ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Reason:</span> <strong style="color: #1e293b;">${data.reason}</strong></p>` : ''}
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

A ${data.isFullRefund ? 'full' : 'partial'} refund of $${refundAmount} CAD has been processed for your ${bookingTypeLabel.toLowerCase()}.

Booking: ${data.bookingName}
Type: ${bookingTypeLabel}
${data.locationName ? `Location: ${data.locationName}` : ''}
Refund Amount: $${refundAmount} CAD
${data.reason ? `Reason: ${data.reason}` : ''}

The refund will appear on your statement within 5-10 business days.

View bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// ===================================
// KITCHEN CHECK-IN/CHECK-OUT/NO-SHOW EMAILS
// ===================================

// Notify manager when a chef checks in
export const generateKitchenCheckinManagerEmail = (data: {
  managerEmail: string;
  managerName: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.managerName.split(' ')[0];
  const subject = `Chef Checked In - ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingUrl = `${getSubdomainUrl('kitchen')}/manager/booking/${data.bookingId}`;

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
      <p class="message" style="margin-bottom: 20px;"><strong>${data.chefName}</strong> has checked in to your kitchen.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Booking</a>
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

${data.chefName} has checked in to ${data.kitchenName} at ${data.locationName}.
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

View booking: ${bookingUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.managerEmail, subject, text, html: prepareEmailHtml(html) };
};

// Notify chef when their check-in is confirmed
export const generateKitchenCheckinChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Check-In Confirmed - ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dashboardUrl = `${getSubdomainUrl('chef')}/dashboard`;

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
      <p class="message" style="margin-bottom: 20px;">Your check-in has been confirmed. Enjoy your time in the kitchen!</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

Your check-in at ${data.kitchenName} (${data.locationName}) has been confirmed.
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

View your bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Notify manager when a chef requests checkout
export const generateKitchenCheckoutRequestManagerEmail = (data: {
  managerEmail: string;
  managerName: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.managerName.split(' ')[0];
  const subject = `Checkout Requested - ${data.kitchenName}`;
  const bookingUrl = `${getSubdomainUrl('kitchen')}/manager/booking/${data.bookingId}`;

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
      <p class="message" style="margin-bottom: 20px;"><strong>${data.chefName}</strong> has requested checkout from <strong>${data.kitchenName}</strong>. Please review the kitchen condition and clear the checkout or file a damage claim if needed.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Checkout</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you don't review within the checkout window, the booking will be auto-cleared. Contact us at <a href="mailto:${getSupportEmail()}" style="color: hsl(347, 91%, 51%); text-decoration: none;">${getSupportEmail()}</a></p>
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

${data.chefName} has requested checkout from ${data.kitchenName} at ${data.locationName}.
Please review the kitchen condition and clear the checkout or file a damage claim.

Review checkout: ${bookingUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.managerEmail, subject, text, html: prepareEmailHtml(html) };
};

// Reminder email sent to chef in the morning for today's kitchen booking check-in
export const generateKitchenCheckinReminderEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Reminder: Check In Today — ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingUrl = `${getSubdomainUrl('chef')}/booking/${data.bookingId}`;

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
      <p class="message" style="margin-bottom: 20px;">You have a kitchen booking today. Don't forget to <strong>check in</strong> when you arrive — complete the move-in checklist and snap photos to protect yourself.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Check In Now</a>
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

You have a kitchen booking today at ${data.kitchenName} (${data.locationName}).
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

Tap "Check In" when you arrive to complete the move-in checklist and upload condition photos.

Check in now: ${bookingUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Reminder email sent to chef in the morning for today's storage booking check-in
export const generateStorageCheckinReminderEmail = (data: {
  chefEmail: string;
  chefName: string;
  storageName: string;
  startDate: string | Date;
  bookingId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Reminder: Check In Today — ${data.storageName}`;
  const formattedDate = new Date(data.startDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingUrl = `${getSubdomainUrl('chef')}/dashboard`;

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
      <p class="message" style="margin-bottom: 20px;">You have a storage booking starting today. Don't forget to <strong>check in</strong> when you arrive — complete the move-in checklist and upload photos to protect yourself.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Storage:</span> <strong style="color: #1e293b;">${data.storageName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Start Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Check In Now</a>
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

You have a storage booking starting today at ${data.storageName}.
Start Date: ${formattedDate}

Tap "Check In" when you arrive to complete the move-in checklist and upload condition photos.

Check in now: ${bookingUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Notify chef when their checkout is cleared
export const generateKitchenCheckoutClearedChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  isAutoClear: boolean;
  bookingId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const clearedBy = data.isAutoClear ? 'automatically (no issues reported)' : 'by the kitchen manager';
  const subject = `Checkout Complete - ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dashboardUrl = `${getSubdomainUrl('chef')}/dashboard`;

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
      <p class="message" style="margin-bottom: 20px;">Great news! Your kitchen checkout has been cleared ${clearedBy}. Thank you for using Local Cooks!</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
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

Your checkout at ${data.kitchenName} (${data.locationName}) has been cleared ${clearedBy}.
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

View your bookings: ${dashboardUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.chefEmail, subject, text, html: prepareEmailHtml(html) };
};

// Notify manager when a no-show is detected
export const generateKitchenNoShowManagerEmail = (data: {
  managerEmail: string;
  managerName: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.managerName.split(' ')[0];
  const subject = `No-Show Detected - ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const bookingUrl = `${getSubdomainUrl('kitchen')}/manager/booking/${data.bookingId}`;

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
      <p class="message" style="margin-bottom: 20px;">A chef did not check in for their booking within the grace period and has been marked as a no-show.</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View Booking</a>
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

A no-show has been detected for ${data.chefName} at ${data.kitchenName} (${data.locationName}).
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

View booking: ${bookingUrl}

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: data.managerEmail, subject, text, html: prepareEmailHtml(html) };
};

// Notify chef when their booking is marked as no-show
export const generateKitchenNoShowChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  kitchenName: string;
  locationName: string;
  bookingDate: string | Date;
  startTime: string;
  endTime: string;
  bookingId: number;
}): EmailContent => {
  const firstName = data.chefName.split(' ')[0];
  const subject = `Booking Marked as No-Show - ${data.kitchenName}`;
  const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dashboardUrl = `${getSubdomainUrl('chef')}/dashboard`;

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
      <p class="message" style="margin-bottom: 20px;">Your kitchen booking was marked as a no-show because you did not check in within the grace period. If this was an error, please contact the kitchen manager.</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${data.kitchenName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${data.startTime} – ${data.endTime}</strong></p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you believe this is an error, contact us at <a href="mailto:${getSupportEmail()}" style="color: hsl(347, 91%, 51%); text-decoration: none;">${getSupportEmail()}</a></p>
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

Your booking at ${data.kitchenName} (${data.locationName}) has been marked as a no-show because you did not check in within the grace period.
Date: ${formattedDate}
Time: ${data.startTime} – ${data.endTime}

If this was an error, please contact the kitchen manager or reach out to support at ${getSupportEmail()}.

View your bookings: ${dashboardUrl}

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
    { label: 'Requested time', value: formatTourDate(new Date(data.tourDate)) + ', ' + formatTourSlotRange(data.tourDate, data.durationMinutes) },
    { label: 'Reference', value: 'TOUR-' + data.tourId }];
}

export const generateTourRequestedChefEmail = (data: TourRequestEmailDetails & { chefEmail: string; chefName: string }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName, tour: data,
    subject: 'Tour request received — ' + data.kitchenName,
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
    subject: 'Tour request awaiting review — ' + data.kitchenName,
    message: data.chefName + ' requested a kitchen tour. Review the request to forward it to the current kitchen manager or decline it. Forwarding does not confirm the appointment.',
    facts: [{ label: 'Visitor', value: data.chefName }, ...tourRequestFacts(data)], actionLabel: 'Review tour request',
    actionUrl: getSubdomainUrl('admin') + '/admin?section=tour-requests&viewing=' + data.tourId });

export const generateTourManagerChangeEmail = (data: { tourId: number; durationMinutes: number; managerEmail: string; managerName?: string; chefName: string; kitchenName: string; locationName?: string; address?: string; kind: 'cancelled' | 'reschedule_requested'; scheduledAt: Date; requestedAt?: Date; timezone: string }): EmailContent => {
  const when = (date: Date) => `${formatTourDate(date)}, ${formatTourSlotRange(date, data.durationMinutes)}`;
  const cancelled = data.kind === 'cancelled';
  return renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName || 'Manager',
    tour: { tourId: data.tourId, tourDate: data.scheduledAt, durationMinutes: data.durationMinutes },
    subject: `${cancelled ? 'Kitchen tour cancelled' : 'Kitchen tour reschedule requested'} · TOUR-${data.tourId}`,
    message: cancelled ? `${data.chefName}’s tour of ${data.kitchenName} was cancelled.` : `${data.chefName} would like a new time for their tour of ${data.kitchenName}. Review the proposed time below. The original time remains confirmed until the change is accepted.`,
    facts: [{ label: 'Kitchen', value: data.kitchenName },
      ...(data.locationName ? [{ label: 'Location', value: data.locationName }] : []),
      ...(data.address ? [{ label: 'Address', value: data.address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.address) }] : []),
      { label: cancelled ? 'Former time' : 'Original time', value: when(data.scheduledAt) },
      ...(!cancelled && data.requestedAt ? [{ label: 'Proposed time', value: when(data.requestedAt) }] : []),
      { label: 'Reference', value: `TOUR-${data.tourId}` }],
    actionLabel: cancelled ? 'View cancelled tour' : 'Review reschedule request',
    actionUrl: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${data.tourId}${cancelled ? '' : '&action=review-reschedule'}`,
    ...(!cancelled ? { secondaryButton: { label: 'Message chef', url: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${data.tourId}&action=message` } } : {}),
    note: cancelled ? 'Saved calendar events do not update automatically; remove the cancelled tour from your calendar.' : undefined,
  });
};

export const generateTourRequestedManagerEmail = (data: TourRequestEmailDetails & { managerEmail: string; managerName: string; chefName: string; chefNotes?: string }): EmailContent =>
  renderTransactionalEmail({ to: data.managerEmail, recipientName: data.managerName, tour: data,
    subject: 'Tour request from ' + data.chefName + ' — ' + data.kitchenName,
    heading: data.chefName + ' would like to tour your kitchen',
    message: data.chefName + ' requested a tour of ' + data.kitchenName + '. Confirm the requested time, offer alternatives, or decline the request.',
    facts: [{ label: 'Visitor', value: data.chefName }, ...tourRequestFacts(data),
      ...(data.chefNotes ? [{ label: 'Visitor notes', value: data.chefNotes }] : [])],
    actionLabel: 'Confirm tour', actionUrl: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=confirm',
    secondaryButton: { label: 'Offer alternative times', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=reschedule' },
    actions: [{ label: 'Message chef', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=message' },
      { label: 'Decline request', url: getSubdomainUrl('kitchen') + '/manager/dashboard?view=viewings&viewing=' + data.tourId + '&action=cancel' }] });

function tourCalendarDescription(data: { kitchenName: string; notes?: string; arrivalNotes?: string | null; departureNotes?: string | null; sharedManagerNotes?: string | null }) {
  return [`Kitchen Tour at ${data.kitchenName}.`, data.arrivalNotes?.trim() ? `Arrival instructions: ${data.arrivalNotes.trim()}` : '', data.departureNotes?.trim() ? `Departure instructions: ${data.departureNotes.trim()}` : '', data.sharedManagerNotes?.trim() ? `Manager notes: ${data.sharedManagerNotes.trim()}` : '', data.notes?.trim() ? `Notes: ${data.notes.trim()}` : ''].filter(Boolean).join('\n\n');
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
    content: generateIcsFile(`Kitchen Tour at ${data.kitchenName}`, start, end, data.locationAddress,
      tourCalendarDescription(data),
      data.organizerEmail, data.attendeeEmails, `tour-${data.tourId}@localcooks.com`,
      { sequence: data.calendarSequence ?? 0, modifiedAt: data.updatedAt, cancelled: data.cancelled }) };
}

export const generateTourConfirmedEmail = (data: { tourId: number; durationMinutes: number; isManager: boolean; email: string; recipientName: string; otherPartyName: string; kitchenName: string; locationAddress: string; tourDate: string | Date; timezone?: string; notes?: string; arrivalNotes?: string | null; departureNotes?: string | null; sharedManagerNotes?: string | null; confirmedAt?: Date | null; organizerEmail?: string; attendeeEmails?: string[]; contactEmail?: string; calendarSequence?: number; updatedAt?: Date; previousTourDate?: Date; canReschedule?: boolean; canCancel?: boolean }): EmailContent => {
  const startDateTimeObj = new Date(data.tourDate);
  const endDateTimeObj = new Date(startDateTimeObj.getTime() + data.durationMinutes * 60_000);
  if (!Number.isSafeInteger(data.tourId) || data.tourId <= 0 || !Number.isFinite(startDateTimeObj.getTime())
    || !Number.isFinite(endDateTimeObj.getTime()) || !Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0) {
    throw new Error('Invalid tour calendar details');
  }
  const dateStr = formatTourDate(startDateTimeObj);
  const startTime = formatTourSlotRange(startDateTimeObj, data.durationMinutes);
  const title = `Kitchen Tour at ${data.kitchenName}`;
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
    ...renderTransactionalEmail({ to: data.email, tour: data, subject: `${data.previousTourDate ? 'Tour rescheduled' : 'Confirmed: Kitchen Tour'} at ${data.kitchenName}`,
      recipientName: data.recipientName, message: data.previousTourDate ? data.isManager
        ? `${data.otherPartyName}’s new tour time at ${data.kitchenName} is confirmed. Review the updated visit details below and replace any event you saved in your calendar.`
        : 'Your new tour time is confirmed. Check the updated details below and replace any event you saved in your calendar.'
        : data.isManager ? `${data.otherPartyName} is coming to tour ${data.kitchenName}. Review the visit details and the arrival instructions shared with them below.`
        : `You’re set to tour ${data.kitchenName} with ${data.otherPartyName}. Here’s everything you need for your visit.`,
      facts: [], sections: [{ title: data.isManager ? 'Tour details' : 'Your visit', facts: [{ label: 'Kitchen', value: data.kitchenName }, { label: data.isManager ? 'Visiting chef' : 'Kitchen manager', value: data.otherPartyName },
        { label: 'Date', value: dateStr }, { label: 'Time', value: startTime },
        ...(data.previousTourDate ? [{ label: 'Previous time', value: `${formatTourDate(data.previousTourDate)}, ${formatTourSlotRange(data.previousTourDate, data.durationMinutes)}` }] : []),
        { label: 'Reference', value: `TOUR-${data.tourId}` }], links: [{ label: 'Add to Google Calendar', url: googleCalendarUrl }] },
        { title: data.isManager ? `Preparing for ${data.otherPartyName}’s visit` : 'Arrival and departure', facts: [
        { label: 'Address', value: data.locationAddress, url: data.locationAddress ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.locationAddress) : undefined },
        ...(data.arrivalNotes?.trim() ? [{ label: 'Arrival instructions', value: data.arrivalNotes.trim() }] : []),
        ...(data.departureNotes?.trim() ? [{ label: 'Departure instructions', value: data.departureNotes.trim() }] : []),
        { label: data.contactEmail ? data.isManager ? 'Chef contact' : 'Arrival contact' : 'Tour assistance', value: data.contactEmail || getSupportEmail() }] },
        { title: 'Meeting notes', facts: [
        ...(data.sharedManagerNotes?.trim() ? [{ label: 'Manager notes', value: data.sharedManagerNotes.trim() }] : []),
        ...(data.notes ? [{ label: data.isManager ? 'Notes from the chef' : 'Your notes', value: data.notes }] : [])] }],
      heading: data.isManager ? `${data.otherPartyName}’s kitchen tour is ${data.previousTourDate ? 'rescheduled' : 'confirmed'}`
        : data.previousTourDate ? 'Your tour has been rescheduled' : 'Your kitchen tour is confirmed',
      actionLabel: 'View details', actionUrl,
      secondaryButton: canReschedule ? { label: 'Reschedule tour', url: actionUrl + '&action=reschedule' } : { label: data.isManager ? 'Message chef' : 'Message manager', url: actionUrl + '&action=message' },
      actions: [...(canReschedule ? [{ label: data.isManager ? 'Message chef' : 'Message manager', url: actionUrl + '&action=message' }] : []),
        ...(canCancel ? [{ label: 'Cancel tour', url: actionUrl + '&action=cancel' }] : [])],
      note: 'A calendar file is attached. If the tour changes, update the event in your calendar too.',
    }),
    attachments: [calendarAttachment]
  };
};

export const generateTourRejectedChefEmail = (data: TourRequestEmailDetails & { chefEmail: string; chefName: string; cancellationReason?: string; managerNotes?: string; cancelled?: boolean }): EmailContent =>
  renderTransactionalEmail({ to: data.chefEmail, recipientName: data.chefName, tour: data,
    subject: (data.cancelled ? 'Kitchen Tour Cancelled' : 'Kitchen Tour Request Declined') + ' — ' + data.kitchenName,
    message: 'Your ' + (data.cancelled ? 'confirmed kitchen tour was cancelled.' : 'kitchen tour request was declined. This appointment was not confirmed.'),
    facts: [...tourRequestFacts(data).map(fact => fact.label === 'Requested time' && data.cancelled ? { ...fact, label: 'Former time' } : fact),
      ...(publicTourCancellationReason(data.cancellationReason) ? [{ label: 'Reason', value: publicTourCancellationReason(data.cancellationReason)! }] : []),
      ...(data.managerNotes ? [{ label: 'Manager notes', value: data.managerNotes }] : [])],
    actionLabel: 'View your tour', actionUrl: getSubdomainUrl('chef') + '/dashboard?view=viewings&viewing=' + data.tourId,
    note: data.cancelled ? 'Saved calendar events do not update automatically; remove the cancelled tour from your calendar.' : undefined });

const LOCAL_COOKS_COMMUNICATION_NOTE = 'For your safety, always communicate through Local Cooks so you can refer back to your messages and arrangements.';

/** Explicit opt-in shell: supplied content stays literal in HTML and plain text. */
export function renderTransactionalEmail(data: {
  to: string; subject: string; recipientName: string; message: string;
  tour?: { tourId: number; tourDate: string | Date; durationMinutes: number };
  facts: { label: string; value: string; url?: string }[]; actionLabel: string; actionUrl: string; note?: string; secondaryLink?: { label: string; url: string };
  secondaryButton?: { label: string; url: string }; heading?: string;
  actions?: { label: string; url: string }[];
  sections?: { title: string; facts: { label: string; value: string; url?: string }[]; links?: { label: string; url: string }[] }[];
}): EmailContent {
  const tourSubjectSuffix = data.tour ? `${formatTourDate(new Date(data.tour.tourDate))}, ${formatTourSlotRange(data.tour.tourDate, data.tour.durationMinutes)} · TOUR-${data.tour.tourId}` : undefined;
  const subjectTitle = tourSubjectSuffix && data.subject.endsWith(` · ${tourSubjectSuffix}`)
    ? data.subject.slice(0, -(` · ${tourSubjectSuffix}`).length) : data.subject.replace(/\s*· TOUR-\d+$/, '');
  const heading = data.heading || subjectTitle;
  const subject = tourSubjectSuffix ? `${subjectTitle} · ${tourSubjectSuffix}` : data.subject;
  const buttonStyle = 'display:block;text-align:center;padding:16px 20px;background:#e11d48;color:#ffffff !important;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;line-height:24px;';
  const linkStyle = 'color:#292524;text-decoration:underline;font-size:15px;line-height:24px;';
  const outlineButtonStyle = 'display:block;text-align:center;padding:16px 20px;border:1px solid #292524;color:#292524;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;line-height:24px;';
  const isMessageAction = (action: { url: string }) => /[?&]action=message(?:&|$)/.test(action.url);
  const sections: NonNullable<typeof data.sections> = (data.sections || [{ title: 'Details', facts: data.facts }]).filter(section => section.facts.length);
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
