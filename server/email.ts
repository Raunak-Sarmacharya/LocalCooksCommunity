import { logger } from "./logger.js";
import nodemailer from 'nodemailer';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

// Dynamic import for timezone-utils to handle Vercel serverless path resolution
// Use a cached function that falls back to a local implementation if import fails

type CreateBookingDateTimeFn = (dateStr: string, timeStr: string, timezone?: string) => Date;

// Local fallback implementation that doesn't require the external module
function createBookingDateTimeFallback(dateStr: string, timeStr: string, timezone: string = 'America/St_Johns'): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
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

// Create a transporter with enhanced configuration for Vercel serverless
const createTransporter = (config: EmailConfig) => {
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
    connectionTimeout: isProduction ? 15000 : 60000, // 15s production, 60s development
    greetingTimeout: isProduction ? 10000 : 30000, // 10s production, 30s development
    socketTimeout: isProduction ? 15000 : 60000, // 15s production, 60s development
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

// Enhanced send email function with Vercel serverless optimizations
export const sendEmail = async (content: EmailContent, options?: { trackingId?: string }): Promise<boolean> => {
  const startTime = Date.now();
  let transporter: any = null;

  try {
    // Check for duplicate emails if trackingId is provided
    if (options?.trackingId) {
      const lastSent = recentEmails.get(options.trackingId);
      const now = Date.now();

      if (lastSent && (now - lastSent) < DUPLICATE_PREVENTION_WINDOW) {
        logger.info(`Preventing duplicate email for tracking ID: ${options.trackingId} (sent ${now - lastSent}ms ago)`);
        return true; // Return true to avoid breaking existing code
      }

      // Update the tracking map with current timestamp
      recentEmails.set(options.trackingId, now);

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

    transporter = createTransporter(config);

    // Enhanced from address with proper formatting using Vercel environment variables
    const fromName = getOrganizationName();
    const fromEmail = process.env.EMAIL_FROM || `${fromName} <${config.auth.user}>`;

    // Verify SMTP connection (skip in production for faster execution)
    if (!isProduction) {
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

    // Enhanced email options with better headers for MailChannels compatibility
    const mailOptions: any = {
      from: fromEmail,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      // Add attachments if provided (e.g., .ics calendar files)
      attachments: content.attachments || [],
      // Optimized headers for better deliverability with Hostinger SMTP
      headers: {
        'Organization': organizationName,
        'X-Mailer': 'Local Cooks Community',
        // Proper sender identification for DKIM/SPF alignment
        'Sender': config.auth.user,
        'Return-Path': config.auth.user,
        'Reply-To': config.auth.user,
        // Standard priority headers (avoid high priority to reduce spam score)
        'Importance': 'Normal',
        // Merge any additional headers from content
        ...(content.headers || {})
      },
      // Proper encoding settings for DKIM
      encoding: 'utf8' as const,
      // Enhanced delivery options for Hostinger SMTP
      envelope: {
        from: config.auth.user,
        to: content.to
      },
      // DKIM-compatible message ID with proper domain
      messageId: `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`,
      date: new Date(),
      // DKIM signing is handled by Hostinger SMTP server
    };

    // Send the email with enhanced timeout protection and retry logic (critical for serverless)
    let info;
    let attempts = 0;
    const maxAttempts = 2; // Allow one retry for better reliability

    while (attempts < maxAttempts) {
      attempts++;
      logger.info(`📧 Attempt ${attempts}/${maxAttempts} sending email to ${content.to}`);

      try {
        const emailPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Email sending timeout - exceeded 25 seconds')), 25000); // Increased timeout
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

    return true;
  } catch (error) {
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
const generateIcsFile = (
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  location: string,
  description: string,
  organizerEmail?: string,
  attendeeEmails?: string[],
  eventUid?: string // Optional: Use same UID for synchronization
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
    'METHOD:REQUEST', // Indicates this is a calendar invitation
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`, // When the event was created
    `DTSTART:${startDateStr}`, // Start time in UTC
    `DTEND:${endDateStr}`, // End time in UTC
    `SUMMARY:${escapeIcalText(title)}`,
    `DESCRIPTION:${escapeIcalText(description)}`,
    `LOCATION:${escapeIcalText(location)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0', // Increment on updates for synchronization
    'TRANSP:OPAQUE', // Indicates busy time
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
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M', // 15 minutes before
    'DESCRIPTION:Reminder: Kitchen booking in 15 minutes',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:EMAIL',
    'TRIGGER:-P1D', // 1 day before
    'DESCRIPTION:Reminder: Kitchen booking tomorrow',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  );

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
  timezone: string = 'America/St_Johns'
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
    const startDateTime = createBookingDateTime(bookingDateStr, startTime, timezone);
    const endDateTime = createBookingDateTime(bookingDateStr, endTime, timezone);

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
    background: #f1f5f9;
  }
  .email-container { 
    max-width: 600px; 
    margin: 0 auto; 
    background: white; 
    border-radius: 12px; 
    overflow: hidden; 
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }
  .header { 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white; 
    padding: 24px 32px; 
    text-align: center; 
  }
  .header-image {
    max-width: 280px;
    height: auto;
    display: block;
    margin: 0 auto;
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
    background: #f8fafc; 
    padding: 24px 32px; 
    text-align: center; 
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <a href="${getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Start Food Safety Training</a>
      </div>` : ''}${applicationData.status === 'cancelled' ? `
      <p class="message" style="margin-top: 24px; margin-bottom: 20px;">You can submit a new application anytime when you&#8217;re ready to join Local Cooks.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${getWebsiteUrl()}/apply" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Submit New Application</a>
      </div>` : ''}
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

Start training: ${getDashboardUrl()}` : ''}${applicationData.status === 'cancelled' ? `You can submit a new application anytime: ${getWebsiteUrl()}/apply` : ''}

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject,
    text,
    html
  };
};

// Generate vendor login credentials
const generateVendorCredentials = (fullName: string, phone: string) => {
  // Clean phone number and remove country code (1) if present
  let cleanPhone = phone.replace(/[^0-9]/g, ''); // Remove all non-digits
  // If phone starts with '1' and has 11 digits, remove the leading '1' (US/Canada country code)
  if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    cleanPhone = cleanPhone.substring(1);
  }
  const username = cleanPhone;
  const namePrefix = fullName.replace(/[^a-zA-Z]/g, '').toLowerCase().substring(0, 3) || 'usr';
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
  }
): EmailContent => {
  const { username, password } = generateVendorCredentials(userData.fullName, userData.phone);
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <a href="https://localcook.shop/app/shop/index.php" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0 8px 8px 0;">Access Chef Dashboard</a>
        <a href="${getVendorDashboardUrl()}" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">Set Up Stripe Payments</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
  Access: https://localcook.shop/app/shop/index.php
• Stripe Payments — set up payment processing to start receiving payments
  Access: ${getVendorDashboardUrl()}

If you have any questions, contact us at support@localcook.shop

Warmly,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Chef Account Approved',
    text,
    html,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your application to Local Cooks. We&#8217;ve received both your application and supporting documents.</p>
      <p class="message" style="margin-bottom: 20px;">Our team will review everything together. You&#8217;ll receive another email once the review is complete, typically within 2&#8211;3 business days.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject: 'Application and Documents Received',
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <a href="${getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Upload Documents</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

Upload documents: ${getDashboardUrl()}

If you have any questions, contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: applicationData.email,
    subject: 'Application Received - Next Steps',
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <a href="${getDashboardUrl()}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">${userData.status === 'approved' ? 'Access Your Dashboard' : 'Update Document'}</a>
      </div>` : ''}
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

${userData.adminFeedback ? `Feedback: ${userData.adminFeedback}\n\n` : ''}${userData.status === 'approved' ? `Access your dashboard: ${getDashboardUrl()}` : userData.status === 'rejected' ? `Update your document: ${getDashboardUrl()}` : ''}

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html
  };
};


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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
`;

  return sendEmail({
    to: applicationData.email,
    subject,
    html: htmlContent,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
`;

  return sendEmail({
    to: applicationData.email,
    subject,
    html: htmlContent,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you need help, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you need help, contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Password Reset Request - Local Cooks',
    text,
    html,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
    html,
    headers: {
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'Importance': 'Normal',
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
  }
): EmailContent => {
  // Map role to userType for getDashboardUrl
  const userType: 'chef' | 'kitchen' | 'admin' = 
    userData.role === 'manager' ? 'kitchen' : 
    userData.role === 'admin' ? 'admin' : 'chef';
  
  const dashboardUrl = getDashboardUrl(userType);
  const firstName = userData.fullName.split(' ')[0];
  const isManager = userData.role === 'manager';

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

${signOff}
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject: 'Welcome to Local Cooks',
    text,
    html
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
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  // In development, use localhost (with subdomain prefix if available)
  if (!isProduction) {
    const devBase = process.env.BASE_URL || 'http://localhost:5001';
    // If BASE_URL is a localhost URL, use it as-is (subdomain routing handled by client)
    if (devBase.includes('localhost') || devBase.includes('127.0.0.1')) {
      return devBase;
    }
    // If BASE_URL is a real domain in dev mode, fall through to production logic
  }

  // Production (and non-localhost dev): Always construct from BASE_DOMAIN
  if (userType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${userType}.${baseDomain}`;
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
  return process.env.VENDOR_DASHBOARD_URL || 'https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php';
};

// Helper function to get the correct promo URL for customer app
const getPromoUrl = (): string => {
  return 'https://localcook.shop/app/index.php';
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for updating your documents. Our team will review them and update your verification status as soon as possible.</p>
      <p class="message" style="margin-bottom: 20px;">You&#8217;ll receive another email once your documents have been reviewed.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Under Review</span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html,
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
    return userData.greeting || 'Hello! 👋';
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
        src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" 
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
    html,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Warmly,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: userData.email,
    subject,
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: userData.email, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: userData.email, subject, text, html };
};

export const generateBookingNotificationEmail = (bookingData: { managerEmail: string; managerName?: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; bookingId: number; referenceCode?: string | null }): EmailContent => {
  const chefFirstName = bookingData.chefName.split(' ')[0];
  const chefLastName = bookingData.chefName.includes(' ') ? bookingData.chefName.split(' ').slice(1).join(' ') : '';
  const subject = `New Booking Request from ${chefFirstName}${chefLastName ? ' ' + chefLastName : ''}`;
  const timezone = bookingData.timezone || 'America/St_Johns';
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
  const calendarUrl = generateCalendarUrl(
    bookingData.managerEmail,
    calendarTitle,
    bookingData.bookingDate,
    bookingData.startTime,
    bookingData.endTime,
    locationName,
    calendarDescription,
    timezone
  );

  // Generate .ics file for proper calendar integration (works with all calendar systems including Google Calendar)
  // Use consistent UID for synchronization - both chef and manager will get the same event
  const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split('T')[0] : bookingData.bookingDate.split('T')[0];
  const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
  const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
  const icsContent = generateIcsFile(
    calendarTitle,
    startDateTime,
    endDateTime,
    locationName,
    calendarDescription,
    getSupportEmail(),
    [bookingData.managerEmail], // Manager is the primary attendee for this email
    eventUid // Use consistent UID for synchronization
  );

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime}</strong></p>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Next Steps:</p>
      <p class="message" style="margin-bottom: 20px;">Please review this request and respond within 24&#8211;48 hours so ${chefFirstName} can confirm their production schedule.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${bookingDetailsUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review &amp; Respond to Request</a>
      </div>
      <p class="message" style="margin-top: 20px;">You can approve or decline this booking directly from your dashboard. If you need to discuss any details with the chef, you can use the built-in chat feature.</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 20px 0 0 0;">A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: hsl(347, 91%, 51%); text-decoration: none;">add it to your calendar</a>.</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 16px 0 0 0;">If you have any questions about this request, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
Time: ${bookingData.startTime} - ${bookingData.endTime}

Next Steps:
Please review this request and respond within 24-48 hours so ${chefFirstName} can confirm their production schedule.

Review & Respond: ${bookingDetailsUrl}

You can approve or decline this booking directly from your dashboard. If you need to discuss any details with the chef, you can use the built-in chat feature.

Add to calendar: ${calendarUrl}

If you have any questions about this request, simply reply to this email or contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.managerEmail,
    subject,
    text,
    html,
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: bookingData.managerEmail, subject, text, html };
};

// Booking confirmed notification email for managers (when manager confirms a booking)
export const generateBookingStatusChangeNotificationEmail = (bookingData: { managerEmail: string; managerName?: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; status: string; timezone?: string; locationName?: string; addons?: string }): EmailContent => {
  const chefFirstName = bookingData.chefName.split(' ')[0];
  const timezone = bookingData.timezone || 'America/St_Johns';
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
  const durationMins = (endH * 60 + endM) - (startH * 60 + startM);
  const durationHrs = Math.floor(durationMins / 60);
  const durationRemMins = durationMins % 60;
  const durationStr = durationRemMins > 0 ? `${durationHrs}h ${durationRemMins}m` : `${durationHrs}h`;

  const subject = `You Confirmed a Booking for ${formattedDate}`;

  // Generate calendar URL based on email provider - SAME event as chef receives for perfect sync
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.\n\nChef: ${bookingData.chefName}\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed`;
  const calendarUrl = generateCalendarUrl(
    bookingData.managerEmail,
    calendarTitle,
    bookingData.bookingDate,
    bookingData.startTime,
    bookingData.endTime,
    locationName,
    calendarDescription,
    timezone
  );

  // Generate .ics file for proper calendar integration
  // Use consistent UID for synchronization - both chef and manager will get the same event
  const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split('T')[0] : bookingData.bookingDate.split('T')[0];
  const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
  const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
  const icsContent = generateIcsFile(
    calendarTitle,
    startDateTime,
    endDateTime,
    locationName,
    calendarDescription,
    getSupportEmail(),
    [bookingData.managerEmail], // Manager is the primary attendee for this email
    eventUid // Use consistent UID for synchronization
  );

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 24px;">Thank you for confirming this booking. The chef has been notified, and your kitchen is now reserved for their session.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Booking Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Chef:</span> <strong style="color: #1e293b;">${bookingData.chefName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime} (${durationStr})</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.addons ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Equipment/Storage:</span> <strong style="color: #1e293b;">${bookingData.addons}</strong></p>` : ''}
      </div>
      <div style="margin: 0 0 24px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Confirmed</span>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Add to Your Calendar:</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        <a href="${calendarUrl}" target="_blank" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 8px 8px 0;">&#128197; Add to Google Calendar</a>
        <a href="cid:kitchen-booking.ics" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">&#128197; Download ICS File</a>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Before the Session:</p>
      <p class="message" style="margin-bottom: 20px;">The chef will arrive at ${bookingData.startTime}. Please ensure the kitchen and requested equipment are accessible and ready. You can reach ${chefFirstName} directly through the chat in your dashboard if you need to coordinate any details.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Need to Cancel or Reschedule?</p>
      <p class="message" style="margin-bottom: 20px;">If something comes up, please use the dashboard tools and notify the chef as soon as possible. Cancellations within 24 hours may affect your booking acceptance rate.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions or need assistance, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
Time: ${bookingData.startTime} – ${bookingData.endTime} (${durationStr})
Kitchen: ${bookingData.kitchenName}
${bookingData.addons ? `Equipment/Storage: ${bookingData.addons}\n` : ''}
Add to your calendar: ${calendarUrl}

Before the Session:
The chef will arrive at ${bookingData.startTime}. Please ensure the kitchen and requested equipment are accessible and ready. You can reach ${chefFirstName} directly through the chat in your dashboard if you need to coordinate any details.

Need to Cancel or Reschedule?
If something comes up, please use the dashboard tools and notify the chef as soon as possible. Cancellations within 24 hours may affect your booking acceptance rate.

Dashboard: ${dashboardUrl}

If you have any questions or need assistance, simply reply to this email or contact us at support@localcook.shop

Thank you for being part of Local Cooks.

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.managerEmail,
    subject,
    text,
    html,
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingRequestEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; locationAddress?: string }): EmailContent => {
  const subject = `Your Booking Request Has Been Submitted`;
  const timezone = bookingData.timezone || 'America/St_Johns';
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
  const calendarUrl = generateCalendarUrl(
    bookingData.chefEmail,
    calendarTitle,
    bookingData.bookingDate,
    bookingData.startTime,
    bookingData.endTime,
    locationName,
    calendarDescription,
    timezone
  );

  // Generate .ics file for proper calendar integration (works with all calendar systems including Google Calendar)
  // Use consistent UID for synchronization - both chef and manager will get the same event
  const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split('T')[0] : bookingData.bookingDate.split('T')[0];
  const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
  const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
  const icsContent = generateIcsFile(
    calendarTitle,
    startDateTime,
    endDateTime,
    locationName,
    calendarDescription,
    getSupportEmail(),
    [bookingData.chefEmail], // Chef is the primary attendee
    eventUid // Use consistent UID for synchronization
  );

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Thank you for submitting your booking request for ${bookingData.kitchenName}. We&#8217;ve sent it to the kitchen manager and are awaiting their confirmation.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Request Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${bookingData.locationAddress}</strong></p>` : (locationName !== bookingData.kitchenName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${locationName}</strong></p>` : '')}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime}</strong></p>
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
        <a href="${calendarUrl}" target="_blank" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 8px 0 0;">Add to Calendar</a>
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">View My Bookings</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
Time: ${bookingData.startTime} – ${bookingData.endTime}
Status: Pending Manager Confirmation

What happens next:
The kitchen manager will review your request and respond within 24–48 hours. You'll receive an email notification as soon as they confirm or decline your booking.

In the meantime, you can use the built-in chat with the kitchen manager if you need to clarify any details about your request.

You can also check your request status anytime from your dashboard: ${dashboardUrl}

Add to calendar: ${calendarUrl}

If you have any questions, simply reply to this email or contact us at support@localcook.shop

Best,
The Local Cooks Team

${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.chefEmail,
    subject,
    text,
    html,
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingConfirmationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; locationAddress?: string; addons?: string }): EmailContent => {
  const timezone = bookingData.timezone || 'America/St_Johns';
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const dashboardUrl = getDashboardUrl();
  const firstName = bookingData.chefName.split(' ')[0];

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);
  const formattedDate = bookingDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Compute duration from start/end time
  const [startH, startM] = bookingData.startTime.split(':').map(Number);
  const [endH, endM] = bookingData.endTime.split(':').map(Number);
  const durationMins = (endH * 60 + endM) - (startH * 60 + startM);
  const durationHrs = Math.floor(durationMins / 60);
  const durationRemMins = durationMins % 60;
  const durationStr = durationRemMins > 0 ? `${durationHrs}h ${durationRemMins}m` : `${durationHrs}h`;

  const subject = `Your Kitchen Booking Is Confirmed for ${formattedDate}`;

  // Generate calendar URL based on email provider
  const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
  const calendarDescription = `Confirmed kitchen booking for ${bookingData.kitchenName}.\n\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed${bookingData.specialNotes ? `\n\nNotes: ${bookingData.specialNotes}` : ''}`;
  const calendarUrl = generateCalendarUrl(
    bookingData.chefEmail,
    calendarTitle,
    bookingData.bookingDate,
    bookingData.startTime,
    bookingData.endTime,
    locationName,
    calendarDescription,
    timezone
  );

  // Generate .ics file for proper calendar integration (works with all calendar systems including Google Calendar)
  // Use consistent UID for synchronization - both chef and manager will get the same event
  const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split('T')[0] : bookingData.bookingDate.split('T')[0];
  const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
  const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
  const icsContent = generateIcsFile(
    calendarTitle,
    startDateTime,
    endDateTime,
    locationName,
    calendarDescription,
    getSupportEmail(),
    [bookingData.chefEmail], // Chef is the primary attendee
    eventUid // Use consistent UID for synchronization
  );

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 24px;">Great news &#8212; your booking at ${bookingData.kitchenName} has been confirmed!</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Booking Details:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Kitchen:</span> <strong style="color: #1e293b;">${bookingData.kitchenName}</strong></p>
        ${bookingData.locationAddress ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${bookingData.locationAddress}</strong></p>` : (locationName !== bookingData.kitchenName ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${locationName}</strong></p>` : '')}
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Date:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Time:</span> <strong style="color: #1e293b;">${bookingData.startTime} &#8211; ${bookingData.endTime} (${durationStr})</strong></p>
        ${bookingData.addons ? `<p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Equipment/Storage Booked:</span> <strong style="color: #1e293b;">${bookingData.addons}</strong></p>` : ''}
      </div>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Confirmed</span>
      </div>
      <p class="message" style="margin-top: 24px; margin-bottom: 8px; font-weight: 600; color: #1e293b;">Add to Your Calendar:</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        <a href="${calendarUrl}" target="_blank" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 8px 8px 0;">&#128197; Add to Google Calendar</a>
        <a href="cid:kitchen-booking.ics" style="display: inline-block; padding: 10px 24px; background: #f1f5f9; color: #475569 !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; border: 1px solid #e2e8f0; margin: 0 0 8px 0;">&#128197; Download ICS File</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px 0; text-align: center;">(Or open the attached calendar invite to add this booking to your preferred calendar app)</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Before Your Session:</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px 4px;">
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Arrive 10&#8211;15 minutes early for check-in</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 16px; color: hsl(347, 91%, 55%); font-size: 16px; line-height: 24px;">&#8226;</td>
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Review the kitchen&#8217;s specific terms and policies in your dashboard</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Need to Make Changes?</p>
      <p class="message" style="margin-bottom: 20px;">If you need to reschedule or cancel, please use your dashboard.</p>
      <p class="message" style="margin-bottom: 20px;">You can also reach the kitchen manager directly through the chat in your dashboard.</p>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">Contact us anytime at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a> or reply to this email.</p>
      <p class="message" style="margin-top: 20px; font-style: italic; color: #64748b;">We&#8217;re excited for your upcoming session and look forward to supporting your culinary work!</p>
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

Great news — your booking at ${bookingData.kitchenName} has been confirmed!

Booking Details:
Kitchen: ${bookingData.kitchenName}
${bookingData.locationAddress ? `Location: ${bookingData.locationAddress}\n` : ''}Date: ${formattedDate}
Time: ${bookingData.startTime} – ${bookingData.endTime} (${durationStr})
${bookingData.addons ? `Equipment/Storage Booked: ${bookingData.addons}\n` : ''}
Add to your calendar: ${calendarUrl}
(Or open the attached calendar invite to add this booking to your preferred calendar app)

Before Your Session:
• Arrive 10–15 minutes early for check-in
• Review the kitchen's specific terms and policies in your dashboard

Need to Make Changes?
If you need to reschedule or cancel, please use your dashboard: ${dashboardUrl}
You can also reach the kitchen manager directly through the chat in your dashboard.

Contact us anytime at support@localcook.shop or reply to this email.

We're excited for your upcoming session and look forward to supporting your culinary work!

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: bookingData.chefEmail,
    subject,
    text,
    html,
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

If you have any questions, contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return { to: bookingData.chefEmail, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: data.chefEmail, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: data.email, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: data.managerEmail, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: data.chefEmail, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  return { to: data.chefEmail, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you didn&#8217;t make this change, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  const text = `Notification Email Updated\n\nThis email address has been set as the notification email for ${data.locationName}. You'll now receive notifications for bookings, cancellations, and other important updates.\n\nLocation: ${data.locationName}\nEmail: ${data.email}\n\nView dashboard: ${dashboardUrl}\n\nIf you didn't make this change, contact us at support@localcook.shop\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`;

  return { to: data.email, subject, text, html };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
  const refundText = data.refundAmount ? `A refund of $${(data.refundAmount / 100).toFixed(2)} has been processed and will be credited to your original payment method within 5&#8211;10 business days.` : 'A refund will be processed shortly.';

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

  const refundPlainText = data.refundAmount ? `A refund of $${(data.refundAmount / 100).toFixed(2)} has been processed and will be credited within 5-10 business days.` : 'A refund will be processed shortly.';

  return {
    to: data.chefEmail,
    subject,
    text: `Hi ${firstName},\n\nYour storage extension request has been declined.\n\nStorage: ${data.storageName}\nRequested Extension: ${data.extensionDays} days\n${data.rejectionReason ? `Reason: ${data.rejectionReason}\n` : ''}\n${refundPlainText}\n\nView bookings: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
  };
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${managerFirstName},</h2>
      <p class="message" style="margin-bottom: 20px;">You&#8217;ve received a new application from a chef requesting access to ${data.locationName}.</p>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Chef Information:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0;"><span style="color: #64748b;">Name:</span> <strong style="color: #1e293b;">${data.chefName}</strong></p>
      </div>
      <div style="margin: 0 0 24px 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: #f8fafc; color: #1e293b !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0; border: 1px solid #e2e8f0;">View Dashboard</a>
      </div>
      <p class="message" style="margin-bottom: 8px; font-weight: 600; color: #1e293b;">Next steps:</p>
      <p class="message" style="margin-bottom: 20px;">Please review ${chefFirstName}&#8217;s profile and application in your dashboard and decide whether to approve or decline their request.</p>
      <div style="margin: 0 0 8px 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review Application</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 16px 0 0 0; text-align: center;">We recommend responding within 3&#8211;5 business days.</p>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 16px 0 0 0;">If you have any questions about this application, you can reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

You've received a new application from a chef requesting access to ${data.locationName}.

Chef Information:
Name: ${data.chefName}

Next steps:
Please review ${chefFirstName}'s profile and application in your dashboard and decide whether to approve or decline their request.

Review application at: ${dashboardUrl}

We recommend responding within 3–5 business days.

If you have any questions about this application, you can reply to this email or contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html
  };
};

// Notify chef when their Step 1 kitchen application is approved by the manager
export const generateKitchenApplicationSubmittedChefEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  locationAddress?: string;
}): EmailContent => {
  const subject = `Step 1 Approved for ${data.locationName} – Next Steps`;
  const dashboardUrl = getDashboardUrl();
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Good news &#8212; your Step 1 application for ${data.locationName} has been approved.</p>
      <p class="message" style="margin-bottom: 24px;">You now have access to the chat feature with this kitchen inside your Local Cooks dashboard. This allows you and the kitchen manager to coordinate directly and share any information needed to complete Step 2.</p>
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
      <p class="message" style="margin-bottom: 10px;">When you&#8217;re ready, complete Step 2 of your application by submitting your:</p>
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
          <td style="padding: 6px 0; font-size: 15px; line-height: 1.65; color: #475569;">Any additional information requested in the Step 2 form</td>
        </tr>
      </table>
      <p class="message" style="margin-bottom: 20px;">Once Step 2 is submitted and approved, you&#8217;ll be able to start booking this kitchen through Local Cooks.</p>
      <div style="margin: 16px 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Step 1 Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions about the process, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

Good news — your Step 1 application for ${data.locationName} has been approved.

You now have access to the chat feature with this kitchen inside your Local Cooks dashboard. This allows you and the kitchen manager to coordinate directly and share any information needed to complete Step 2.

What to do next:

• Use the chat in your dashboard to connect with the kitchen manager
• Confirm any requirements or details they need from you

When you're ready, complete Step 2 of your application by submitting your:

• Food establishment certificate
• Insurance documents (if required)
• Any additional information requested in the Step 2 form

Once Step 2 is submitted and approved, you'll be able to start booking this kitchen through Local Cooks.

Go to your dashboard at: ${dashboardUrl}

If you have any questions about the process, simply reply to this email or contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html
  };
};

// Notify chef when their Step 2 kitchen application is fully approved (can now book)
export const generateKitchenApplicationApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  kitchenName?: string;
}): EmailContent => {
  const subject = `You're Fully Approved for ${data.locationName} – You Can Now Book`;
  const dashboardUrl = getDashboardUrl();
  const firstName = data.chefName.split(' ')[0];
  const kitchenDisplay = data.kitchenName || data.locationName;
  
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Great news &#8212; your Step 2 application for ${data.locationName} has been approved.</p>
      <p class="message" style="margin-bottom: 24px;">You now have full access to this kitchen through Local Cooks and can start submitting booking requests based on the kitchen&#8217;s availability.</p>
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
        <span style="display: inline-block; padding: 4px 12px; background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#10003; Fully Approved</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Go to Your Dashboard</a>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions about bookings or how to use the platform, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

Great news — your Step 2 application for ${data.locationName} has been approved.

You now have full access to this kitchen through Local Cooks and can start submitting booking requests based on the kitchen's availability.

What you can do now:

• View ${kitchenDisplay}'s schedule and available time slots
• Submit booking requests directly from your dashboard
• Coordinate final details with the kitchen via the built-in chat

Please make sure you continue to follow the kitchen's specific guidelines and any local food safety requirements when using the space.

Go to your dashboard at: ${dashboardUrl}

If you have any questions about bookings or how to use the platform, simply reply to this email or contact us at support@localcook.shop

Best,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.chefEmail,
    subject,
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin: 24px 0 0 0; text-align: center;">We&#8217;re here to help you get the most out of the platform. If you&#8217;d like guidance on setting up your first listing or optimizing your availability and pricing, simply reply to this email or contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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

We're here to help you get the most out of the platform. If you'd like guidance on setting up your first listing or optimizing your availability and pricing, simply reply to this email or contact us at support@localcook.shop

Best regards,
The Local Cooks Team

© ${new Date().getFullYear()} Local Cooks
  `.trim();

  return {
    to: data.managerEmail,
    subject,
    text,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">Your kitchen license submission requires attention. The admin team was unable to approve it at this time.</p>
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
}): EmailContent => {
  const subject = `Kitchen License Pending Review - ${data.locationName}`;
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Kitchen License Pending Review</h2>
      <p class="message" style="margin-bottom: 20px;">A manager has submitted a kitchen license for your review.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Manager:</span> <strong style="color: #1e293b;">${data.managerName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Email:</span> <strong style="color: #1e293b;">${data.managerEmail}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Location:</span> <strong style="color: #1e293b;">${data.locationName}</strong></p>
        <p style="font-size: 15px; line-height: 1.8; color: #475569; margin: 0;"><span style="color: #64748b;">Submitted:</span> <strong style="color: #1e293b;">${formattedDate}</strong></p>
      </div>
      <div style="margin: 0 0 4px 0; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background: #fffbeb; color: #d97706; border: 1px solid #fef3c7; border-radius: 100px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">&#9679; Pending Review</span>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review License</a>
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
    text: `Kitchen License Pending Review\n\nManager: ${data.managerName} (${data.managerEmail})\nLocation: ${data.locationName}\nSubmitted: ${formattedDate}\n\nReview: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
        <p style="font-size: 14px; line-height: 1.6; color: #991b1b; margin: 0;">You can accept the claim or dispute it for admin review. If you don&#8217;t respond by the deadline, the claim may be automatically approved.</p>
      </div>
      <div style="margin: 16px 0 0 0; text-align: center;">
        <a href="${dashboardUrl}" class="cta-button" style="display: inline-block; padding: 10px 24px; background: hsl(347, 91%, 51%); color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 500; font-size: 14px; letter-spacing: 0.01em; box-shadow: none; margin: 0;">Review &amp; Respond</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
    : 'The claim has been escalated to admin for review. You will be notified of the decision.';

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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    text: `Hi ${managerFirstName},\n\n${data.chefName} has ${data.response} your damage claim "${data.claimTitle}" for ${data.claimedAmount}.${data.chefResponse ? `\n\nResponse: ${data.chefResponse}` : ''}\n\n${isAccepted ? 'You can now charge from your dashboard.' : 'Escalated to admin for review.'}\n\nView claim: ${dashboardUrl}\n\nBest regards,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting" style="font-size: 22px; margin-bottom: 12px;">Hi ${firstName},</h2>
      <p class="message" style="margin-bottom: 20px;">The admin has made a decision on the disputed damage claim.</p>
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    text: `Hi ${firstName},\n\nThe admin has ${decisionLabels[data.decision].toLowerCase()} the damage claim "${data.claimTitle}".\n\n${data.decisionReason}\n\nView details: ${dashboardUrl}\n\nBest,\nThe Local Cooks Team\n\n© ${new Date().getFullYear()} Local Cooks`,
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0 0;">If you have any questions, contact us at <a href="mailto:support@localcook.shop" style="color: hsl(347, 91%, 51%); text-decoration: none;">support@localcook.shop</a></p>
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
    html
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
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
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
    html
  };
};
