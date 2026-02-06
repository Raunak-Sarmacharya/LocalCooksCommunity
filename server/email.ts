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
          console.log(`Successfully loaded timezone-utils from: ${timezoneUtilsUrl}`);
          return;
        }
      } catch {
        // Continue to next path
        continue;
      }
    }

    console.warn('Failed to load timezone-utils from any path, using fallback implementation');
  } catch (error) {
    console.error('Error during timezone-utils initialization:', error);
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
    console.log('🔄 Forcing direct SMTP connection (bypassing MailChannels)');
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
        console.log(`Preventing duplicate email for tracking ID: ${options.trackingId} (sent ${now - lastSent}ms ago)`);
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
      console.error('Email configuration is missing. Please set EMAIL_USER and EMAIL_PASS environment variables.');
      return false;
    }

    const config = getEmailConfig();
    const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

    console.log('📧 COMPREHENSIVE EMAIL SEND INITIATED:', {
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
              console.error('SMTP connection verification failed:', error);
              reject(error);
            } else {
              console.log('SMTP connection verified successfully');
              resolve(success);
            }
          });
        });
      } catch (verifyError) {
        console.error('Failed to verify SMTP connection:', verifyError);
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
      console.log(`📧 Attempt ${attempts}/${maxAttempts} sending email to ${content.to}`);

      try {
        const emailPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Email sending timeout - exceeded 25 seconds')), 25000); // Increased timeout
        });

        info = await Promise.race([emailPromise, timeoutPromise]);

        // If successful, break out of retry loop
        console.log(`✅ Email sent successfully on attempt ${attempts}`);
        break;
      } catch (attemptError) {
        console.warn(`⚠️ Attempt ${attempts} failed for ${content.to}:`, attemptError instanceof Error ? attemptError.message : String(attemptError));

        if (attempts >= maxAttempts) {
          throw attemptError; // Re-throw on final attempt
        }

        // Wait briefly before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }

    const executionTime = Date.now() - startTime;
    console.log('Email sent successfully:', {
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
    console.error('Error sending email:', {
      error: error instanceof Error ? error.message : error,
      executionTime: `${executionTime}ms`,
      to: content.to,
      subject: content.subject,
      trackingId: options?.trackingId,
      isProduction: process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
    });

    if (error instanceof Error) {
      console.error('Error details:', error.message);
      if ('code' in error) {
        console.error('Error code:', (error as any).code);
      }
      if ('responseCode' in error) {
        console.error('SMTP Response code:', (error as any).responseCode);
      }
    }

    // Close the transporter connection on error (important for serverless)
    if (transporter && typeof transporter.close === 'function') {
      try {
        transporter.close();
      } catch (closeError) {
        console.error('Error closing transporter:', closeError);
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
    console.error('Error generating calendar URL:', error);
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
  // Create professional, non-promotional subject line
  const getSubjectLine = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Application Approved - Local Cooks Community';
      case 'rejected':
        return 'Application Update - Local Cooks Community';
      case 'cancelled':
        return 'Application Status Update - Local Cooks Community';
      case 'under_review':
        return 'Application Under Review - Local Cooks Community';
      default:
        return 'Application Status Update - Local Cooks Community';
    }
  };

  const subject = getSubjectLine(applicationData.status);

  // Generate plain text version for better deliverability
  const generatePlainText = (status: string, fullName: string) => {
    const statusMessages = {
      approved: `Congratulations! Your application has been approved.`,
      rejected: `Thank you for your application. After careful review, we are unable to move forward at this time.`,
      cancelled: `Your application has been cancelled.`,
      under_review: `Your application is currently under review.`,
      pending: `Your application has been received and is pending review.`
    };

    return `Hello ${fullName},

${statusMessages[status as keyof typeof statusMessages] || 'Your application status has been updated.'}

Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

${status === 'approved' ? `Access your dashboard: ${getDashboardUrl()}

🎓 NEXT STEP: Complete your food safety training to unlock all features and get certified!` : ''}${status === 'cancelled' ? `

You can submit a new application anytime: ${getWebsiteUrl()}/apply` : ''}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
  };

  const getMessage = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Congratulations! Your application has been approved. You now have full access to the Local Cooks platform, including our comprehensive food safety training program.';
      case 'rejected':
        return 'Thank you for your application. After careful review, we are unable to move forward with your application at this time. We appreciate your interest in Local Cooks.';
      case 'cancelled':
        return 'Your application has been cancelled. You can submit a new application anytime when you\'re ready to join the Local Cooks community.';
      case 'under_review':
        return 'Your application is currently under review by our team. We will notify you once the review is complete.';
      case 'pending':
        return 'Your application has been received and is pending review. We will contact you with updates soon.';
      default:
        return 'Your application status has been updated. Please check your dashboard for more details.';
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
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">${message}</p>
      <div class="status-badge${applicationData.status === 'approved' ? ' approved' : applicationData.status === 'rejected' ? ' rejected' : applicationData.status === 'cancelled' ? ' cancelled' : ''}">
        Status: ${applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1)}
      </div>
      ${applicationData.status === 'approved' ? `
      <div class="info-box">
        <strong>🎓 Your Next Step: Food Safety Training</strong>
        <p>You now have full access to our comprehensive food safety training program. Complete all 22 training videos to:</p>
        <ul style="margin: 8px 0; padding-left: 20px;">
          <li>Earn your official Local Cooks certification</li>
          <li>Learn essential HACCP principles</li>
          <li>Access advanced platform features</li>
          <li>Build customer trust with verified status</li>
        </ul>
      </div>
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Start Food Safety Training</a>` : ''}${applicationData.status === 'cancelled' ? `
      <div class="info-box">
        <strong>Ready to Apply Again?</strong>
        <p>You can submit a new application anytime when you're ready to join the Local Cooks community. We look forward to welcoming you to our platform!</p>
      </div>
      <a href="${getWebsiteUrl()}/apply" class="cta-button" style="color: white !important; text-decoration: none !important;">Submit New Application</a>` : ''}
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: applicationData.email,
    subject,
    text: generatePlainText(applicationData.status, applicationData.fullName),
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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chef Account Approved - Login Credentials Included</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Congratulations ${userData.fullName}!</h2>
      <p class="message">
        Your documents have been approved and you are now <strong>fully verified</strong>! You can now start accepting orders and serving customers through our Local Cooks platform.
      </p>
      <div class="status-badge approved">Status: Approved</div>
      
      <div class="info-box">
        <strong>Your Login Credentials:</strong>
        <table class="credentials-table">
          <tr>
            <td>Username:</td>
            <td><code>${username}</code></td>
          </tr>
          <tr>
            <td>Password:</td>
            <td><code>${password}</code></td>
          </tr>
        </table>
      </div>
      
      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> Please change your password after your first login for security.
        </p>
      </div>
      
      <div class="info-box">
        <strong>🚀 Next Steps - Choose Your Path:</strong>
        <p>You now have two important accounts to set up:</p>
      </div>
      
      <div style="text-align: center; margin: 24px 0; width: 100%;">
        <div style="display: block; margin: 0 auto; max-width: 320px;">
          <a href="https://localcook.shop/app/shop/index.php" class="cta-button" style="display: block; width: 100%; background: #2563eb; color: white !important; margin-bottom: 16px; box-sizing: border-box;">
            👨‍🍳 Access Chef Dashboard
          </a>
          <a href="${getVendorDashboardUrl()}" class="cta-button" style="display: block; width: 100%; background: #16a34a; color: white !important; box-sizing: border-box;">
            💳 Set Up Stripe Payments
          </a>
        </div>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          <strong>👨‍🍳 Chef Dashboard:</strong> Use your credentials above to log into your chef dashboard where you can manage your profile, products, and orders.
          <br><br>
          <strong>💳 Stripe Payments:</strong> Set up your payment processing to start receiving payments from customers. This is required to get paid for orders.
        </p>
      </div>
      
      <div class="divider"></div>
      
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks Community</strong>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: 'Chef Account Approved - Login Credentials Included',
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
  const supportEmail = getSupportEmail();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application and Documents Received - Under Review</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to Local Cooks! We have received both your application and your supporting documents.
      </p>
      <p class="message">
        Our team will now review your application and documents together. You'll receive another email once the review is complete.
      </p>
      <div class="status-badge">Status: Under Review</div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: applicationData.email,
    subject: 'Application and Documents Received - Under Review',
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
  const supportEmail = getSupportEmail();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Cooks Application Confirmation - Next Steps</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to Local Cooks! We have received your application and it will be reviewed soon.
      </p>
      <p class="message">
        <strong>Next Steps:</strong> Please visit your dashboard to upload the required documents to complete your application.
      </p>
      <div class="status-badge">Status: Under Review</div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: applicationData.email,
    subject: 'Local Cooks Application Confirmation - Next Steps',
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
  // Create professional, non-promotional subject line
  const getSubjectLine = (documentType: string, status: string) => {
    const docName = documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';
    switch (status) {
      case 'approved':
        return `${docName} Approved - Local Cooks Community`;
      case 'rejected':
        return `${docName} Update Required - Local Cooks Community`;
      default:
        return `${docName} Status Update - Local Cooks Community`;
    }
  };

  const subject = getSubjectLine(userData.documentType, userData.status);

  // Generate plain text version for better deliverability
  const generatePlainText = (documentType: string, status: string, fullName: string, adminFeedback?: string) => {
    const docName = documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';
    const statusMessages = {
      approved: `Great news! Your ${docName} has been approved.`,
      rejected: `Your ${docName} requires some updates before it can be approved.`,
      pending: `Your ${docName} is being reviewed by our team.`
    };

    return `Hello ${fullName},

${statusMessages[status as keyof typeof statusMessages] || `Your ${docName} status has been updated.`}

Document: ${docName}
Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

${adminFeedback ? `Admin Feedback: ${adminFeedback}\n\n` : ''}${status === 'approved' ? `Access your dashboard: ${getDashboardUrl()}` : status === 'rejected' ? `Please update your document and resubmit: ${getDashboardUrl()}` : ''}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
  };

  const getMessage = (documentType: string, status: string) => {
    const docName = documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';
    switch (status) {
      case 'approved':
        return `Congratulations! Your ${docName} has been approved by our verification team. This brings you one step closer to being fully verified on Local Cooks.`;
      case 'rejected':
        return `Your ${docName} could not be approved at this time. Please review the feedback below and upload an updated document.`;
      case 'pending':
        return `Your ${docName} is currently being reviewed by our verification team. We will notify you once the review is complete.`;
      default:
        return `Your ${docName} status has been updated. Please check your dashboard for more details.`;
    }
  };

  const message = getMessage(userData.documentType, userData.status);
  const docName = userData.documentType === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate';

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
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">${message}</p>
      <div class="status-badge${userData.status === 'approved' ? ' approved' : userData.status === 'rejected' ? ' rejected' : ''}">
        📄 ${docName}: ${userData.status.charAt(0).toUpperCase() + userData.status.slice(1)}
      </div>
      ${userData.adminFeedback ? `
      <div class="info-box">
        <strong>💬 Admin Feedback:</strong><br>
        ${userData.adminFeedback}
      </div>` : ''}
      ${userData.status === 'approved' ? `<a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>` : userData.status === 'rejected' ? `<a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Update Document</a>` : ''}
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject,
    text: generatePlainText(userData.documentType, userData.status, userData.fullName, userData.adminFeedback),
    html
  };
};


export async function sendApplicationReceivedEmail(applicationData: any) {
  const supportEmail = getSupportEmail();
  const organizationName = getOrganizationName();

  const subject = `Application Received - ${organizationName}`;

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
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to join ${organizationName}. 
        We've received your application and our team will review it shortly.
      </p>
      <div class="status-badge">Status: Under Review</div>
      <div class="info-box">
        <strong>What happens next?</strong><br>
        Our team typically reviews applications within 2-3 business days. 
        You'll receive an email notification once we've made a decision.
      </div>
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Track Application Status</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in ${organizationName}!</p>
      <div class="footer-links">
        <a href="mailto:${supportEmail}">Support</a> • 
        <a href="mailto:${supportEmail}?subject=Unsubscribe">Unsubscribe</a> • 
        <a href="${getPrivacyUrl()}">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const textContent = `
Application Received - ${organizationName}

Hello ${applicationData.fullName},

Thank you for submitting your application to join ${organizationName}. We've received your application and our team will review it shortly.

Status: Under Review

What happens next?
Our team typically reviews applications within 2-3 business days. You'll receive an email notification once we've made a decision.

Track your application status: ${getDashboardUrl()}

Thank you for your interest in ${organizationName}!

If you have any questions, contact us at ${supportEmail}

© ${new Date().getFullYear()} ${organizationName}
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
  const supportEmail = getSupportEmail();
  const organizationName = getOrganizationName();

  const subject = `Application Update - ${organizationName}`;

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
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for your interest in joining ${organizationName}. After careful review, we're unable to approve your application at this time.
      </p>
      <div class="status-badge">Status: Not Approved</div>
      
      ${reason ? `
      <div class="info-box">
        <strong>Feedback:</strong> ${reason}
      </div>
      ` : ''}
      
      <div class="info-box">
        <strong>📚 Next Steps:</strong><br>
        We encourage you to gain more experience and reapply in the future. 
        We'd be happy to reconsider your application when you're ready.
      </div>
      
      <a href="${getWebsiteUrl()}/apply" class="cta-button" style="color: white !important; text-decoration: none !important;">Learn About Requirements</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in ${organizationName}!</p>
      <div class="footer-links">
        <a href="mailto:${supportEmail}">Support</a> • 
        <a href="mailto:${supportEmail}?subject=Unsubscribe">Unsubscribe</a> • 
        <a href="${getPrivacyUrl()}">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const textContent = `
Application Update - ${organizationName}

Hello ${applicationData.fullName},

Thank you for your interest in joining ${organizationName}. After careful review, we're unable to approve your application at this time.

Status: Not Approved

${reason ? `Feedback: ${reason}\n\n` : ''}Next Steps:
We encourage you to gain more experience and reapply in the future. We'd be happy to reconsider your application when you're ready.

Learn more about requirements: ${getWebsiteUrl()}/apply

Thank you for your interest in ${organizationName}!

If you have any questions, contact us at ${supportEmail}

© ${new Date().getFullYear()} ${organizationName}
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
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        We received a request to reset your password for your Local Cooks account. If you didn't make this request, you can safely ignore this email.
      </p>
      <p class="message">
        Click the button below to create a new password. This link will expire in 1 hour for security.
      </p>
      <a href="${userData.resetUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Reset My Password</a>
      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> If you didn't request this password reset, please contact our support team immediately.
        </p>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Keep your account secure with <strong>Local Cooks</strong></p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: 'Password Reset Request - Local Cooks',
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
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification Required - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Welcome ${userData.fullName}!</h2>
      <p class="message">
        Thank you for joining Local Cooks Community! We're excited to have you on board.
      </p>
      <p class="message">
        To complete your registration and activate your account, please verify your email address by clicking the button below.
      </p>
      <a href="${userData.verificationUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Verify My Email</a>
      <div class="status-badge">Status: Verification Required</div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks</strong> community!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: 'Email Verification Required - Local Cooks',
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
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Created - Local Cooks Community</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        Welcome to Local Cooks Community! Your account has been successfully created and verified.
      </p>
      <p class="message">
        You can now access your dashboard to complete your profile setup and start your food safety training modules.
      </p>
      <div class="status-badge approved">Status: Account Active</div>
      <a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for joining <strong>Local Cooks</strong> Community!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  // Plain text version for email clients that don't support HTML
  const text = `
Hello ${userData.fullName},

Welcome to Local Cooks Community! Your account has been successfully created and verified.

You can now access your dashboard to complete your profile setup and start your food safety training modules.

Status: Account Active

Access your dashboard at: ${dashboardUrl}

Thank you for joining Local Cooks Community!

If you have any questions, contact us at ${getSupportEmail()}.

© ${new Date().getFullYear()} Local Cooks Community
  `.trim();

  return {
    to: userData.email,
    subject: 'Account Created - Local Cooks Community',
    text,
    html
  };
};

// Helper function to get the correct subdomain URL based on user type
const getSubdomainUrl = (userType: 'chef' | 'kitchen' | 'admin' | 'main' = 'main'): string => {
  const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';

  // In development, use localhost
  if (process.env.NODE_ENV !== 'production' && !process.env.BASE_URL) {
    return 'http://localhost:5000';
  }

  // Use BASE_URL if explicitly set (for backward compatibility)
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
    // Extract subdomain from BASE_URL if it contains one
    const url = new URL(process.env.BASE_URL);
    const hostname = url.hostname;
    const parts = hostname.split('.');

    // If BASE_URL already has a subdomain, use it
    if (parts.length >= 3) {
      return process.env.BASE_URL;
    }

    // Otherwise, construct subdomain URL
    if (userType === 'main') {
      return process.env.BASE_URL;
    }
    return `https://${userType}.${baseDomain}`;
  }

  // Production: construct subdomain URL
  if (userType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${userType}.${baseDomain}`;
};

// Helper function to get the correct website URL based on environment
const getWebsiteUrl = (): string => {
  return getSubdomainUrl('main');
};

// Helper function to get the correct dashboard URL based on user type
const getDashboardUrl = (userType: 'chef' | 'kitchen' | 'admin' = 'chef'): string => {
  const baseUrl = getSubdomainUrl(userType);
  
  // Return just the base URL without any path
  // kitchen.localcooks.ca for managers, chef.localcooks.ca for chefs
  return baseUrl;
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
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        Thank you for updating your documents. Our team will review them and update your verification status as soon as possible.
      </p>
      <p class="message">
        You'll receive another email once your documents have been reviewed.
      </p>
      <div class="status-badge">
        📄 Document Update Received
      </div>
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: "Document Update Received - Local Cooks",
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
  const subject = 'All Documents Approved - Welcome to Local Cooks Community!';

  // Generate plain text version
  const generatePlainText = (fullName: string, approvedDocuments: string[], adminFeedback?: string) => {
    const docList = approvedDocuments.join(', ');

    return `Hello ${fullName},

🎉 Congratulations! All your submitted documents have been approved by our verification team.

Approved Documents: ${docList}

You are now fully verified and can start using Local Cooks Community as a chef.

${adminFeedback ? `Admin Feedback: ${adminFeedback}\n\n` : ''}Access your dashboard: ${getDashboardUrl()}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
  };

  const docList = userData.approvedDocuments.join(', ');

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
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        🎉 <strong>Congratulations!</strong> All your submitted documents have been approved by our verification team.
      </p>
      <p class="message">
        You are now fully verified and can start using Local Cooks Community as a chef.
      </p>
      <div class="status-badge approved">
        ✅ All Documents Approved
      </div>
      <div class="info-box">
        <strong>📄 Approved Documents:</strong><br>
        ${userData.approvedDocuments.map(doc => `• ${doc}`).join('<br>')}
      </div>
      ${userData.adminFeedback ? `
      <div class="info-box">
        <strong>💬 Admin Feedback:</strong><br>
        ${userData.adminFeedback}
      </div>` : ''}
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject,
    text: generatePlainText(userData.fullName, userData.approvedDocuments, userData.adminFeedback),
    html
  };
};


// ===================================
// KITCHEN BOOKING EMAILS
// ===================================

export const generateManagerMagicLinkEmail = (userData: { email: string; name: string; resetToken: string }): EmailContent => {
  const subject = 'Set Up Your Manager Account - Local Cooks';
  // Use kitchen subdomain for manager password reset
  const baseUrl = getDashboardUrl('kitchen');
  const resetUrl = `${baseUrl}/password-reset?token=${userData.resetToken}&role=manager`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${userData.name},</h2><p class="message">Your manager account has been created for the Local Cooks commercial kitchen booking system!</p><p class="message">Click the button below to set up your password and access your manager dashboard:</p><a href="${resetUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Set Up Password</a><div class="info-box"><strong>🔐 Account Access:</strong><br>You'll be able to manage kitchen schedules, view bookings, and set up availability for your location.</div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: userData.email, subject, text: `Hello ${userData.name}, Your manager account has been created. Click here to set up your password: ${resetUrl}`, html };
};

// Manager credentials email with username and password
export const generateManagerCredentialsEmail = (userData: { email: string; name: string; username: string; password: string }): EmailContent => {
  const subject = 'Your Manager Account - Local Cooks Community';
  // Use kitchen subdomain for manager login
  const loginUrl = `${getDashboardUrl('kitchen')}/manager/login`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${userData.name || 'Manager'},</h2><p class="message">Your manager account has been created for the Local Cooks kitchen booking system!</p><div class="info-box"><strong>🔐 Your Login Credentials:</strong><table class="credentials-table"><tr><td>Username:</td><td><code>${userData.username}</code></td></tr><tr><td>Password:</td><td><code>${userData.password}</code></td></tr></table></div><div class="warning-box"><p class="warning-text"><strong>⚠️ Important:</strong> Please change your password after your first login for security.</p></div><p class="message">You'll be able to manage kitchen schedules, view bookings, and set up availability for your locations.</p><a href="${loginUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Login Now</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: userData.email, subject, text: `Hello ${userData.name || 'Manager'}, Your manager account has been created! Username: ${userData.username}, Password: ${userData.password}. Login at: ${loginUrl}`, html };
};

export const generateBookingNotificationEmail = (bookingData: { managerEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string; bookingId: number }): EmailContent => {
  const subject = `New Kitchen Booking - ${bookingData.kitchenName}`;
  const timezone = bookingData.timezone || 'America/St_Johns';
  const locationName = bookingData.locationName || bookingData.kitchenName;
  const bookingDetailsUrl = `${getDashboardUrl('kitchen')}/manager/booking/${bookingData.bookingId}`;

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);

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
  const calendarButtonText = detectEmailProvider(bookingData.managerEmail) === 'outlook' ? '📅 Add to Outlook Calendar' :
    detectEmailProvider(bookingData.managerEmail) === 'yahoo' ? '📅 Add to Yahoo Calendar' :
      detectEmailProvider(bookingData.managerEmail) === 'apple' ? '📅 Add to Apple Calendar' :
        '📅 Add to Calendar';

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

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New Kitchen Booking</h2><p class="message">A chef has made a booking for your kitchen:</p><div class="info-box"><strong>👨‍🍳 Chef:</strong> ${bookingData.chefName}<br><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}${bookingData.specialNotes ? `<br><br><strong>📝 Notes:</strong> ${bookingData.specialNotes}` : ''}</div><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>📎 Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${bookingDetailsUrl}" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">Review Booking</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return {
    to: bookingData.managerEmail,
    subject,
    text: `New Kitchen Booking - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Add to calendar: ${calendarUrl}`,
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
  const bookingDetailsUrl = `${getDashboardUrl('kitchen')}/manager/booking/${data.bookingId}`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">💰 Payment Received!</h2><p class="message">Great news! Payment has been received for a kitchen booking:</p><div class="info-box"><strong>👨‍🍳 Chef:</strong> ${data.chefName}<br><strong>🏢 Kitchen:</strong> ${data.kitchenName}<br><strong>📅 Date:</strong> ${formattedDate}<br><strong>⏰ Time:</strong> ${data.startTime} - ${data.endTime}<br><strong>💵 Amount:</strong> <span style="color: #16a34a; font-weight: 600;">${formattedAmount}</span><br><strong>📊 Payment Status:</strong> <span style="color: #16a34a; font-weight: 600;">Paid</span></div><p class="message">The booking is now confirmed and ready. Please review the booking details.</p><div style="text-align: center; margin: 24px 0;"><a href="${bookingDetailsUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Booking Details</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Payment Received! Chef: ${data.chefName}, Kitchen: ${data.kitchenName}, Date: ${formattedDate}, Time: ${data.startTime} - ${data.endTime}, Amount: ${formattedAmount}. View booking: ${bookingDetailsUrl}`,
    html
  };
};

// Booking cancellation notification email for managers (when chef cancels)
export const generateBookingCancellationNotificationEmail = (bookingData: { managerEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string }): EmailContent => {
  const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Booking Cancelled</h2><p class="message">A chef has cancelled their booking:</p><div class="info-box"><strong>👨‍🍳 Chef:</strong> ${bookingData.chefName}<br><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${new Date(bookingData.bookingDate).toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>📊 Status:</strong> <span style="color: #dc2626; font-weight: 600;">Cancelled</span>${bookingData.cancellationReason ? `<br><br><strong>📝 Reason:</strong> ${bookingData.cancellationReason}` : ''}</div><a href="${getDashboardUrl('kitchen')}/manager/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: bookingData.managerEmail, subject, text: `Booking Cancelled - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${new Date(bookingData.bookingDate).toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}`, html };
};

// Booking status change notification email for managers (when manager confirms/cancels)
export const generateBookingStatusChangeNotificationEmail = (bookingData: { managerEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; status: string; timezone?: string; locationName?: string }): EmailContent => {
  const subject = `Booking ${bookingData.status === 'confirmed' ? 'Confirmed' : 'Updated'} - ${bookingData.kitchenName}`;
  const statusColor = bookingData.status === 'confirmed' ? '#16a34a' : '#dc2626';
  const statusText = bookingData.status === 'confirmed' ? 'Confirmed' : 'Cancelled';
  const timezone = bookingData.timezone || 'America/St_Johns';
  const locationName = bookingData.locationName || bookingData.kitchenName;

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);

  // Generate calendar URL for confirmed bookings based on email provider - SAME event as chef receives for perfect sync
  let calendarUrl = '';
  let calendarButtonText = '📅 Add to Calendar';
  if (bookingData.status === 'confirmed') {
    const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
    const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.\n\nChef: ${bookingData.chefName}\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed`;
    calendarUrl = generateCalendarUrl(
      bookingData.managerEmail,
      calendarTitle,
      bookingData.bookingDate,
      bookingData.startTime,
      bookingData.endTime,
      locationName,
      calendarDescription,
      timezone
    );
    const provider = detectEmailProvider(bookingData.managerEmail);
    calendarButtonText = provider === 'outlook' ? '📅 Add to Outlook Calendar' :
      provider === 'yahoo' ? '📅 Add to Yahoo Calendar' :
        provider === 'apple' ? '📅 Add to Apple Calendar' :
          '📅 Add to Calendar';
  }

  // Generate .ics file for confirmed bookings
  // Use consistent UID for synchronization - both chef and manager will get the same event
  let attachments: EmailContent['attachments'] = [];
  if (bookingData.status === 'confirmed' && calendarUrl) {
    const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split('T')[0] : bookingData.bookingDate.split('T')[0];
    const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
    const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
    const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
    const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.\n\nChef: ${bookingData.chefName}\nDate: ${bookingDateObj.toLocaleDateString()}\nTime: ${bookingData.startTime} - ${bookingData.endTime}\nStatus: Confirmed`;
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
    attachments = [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }];
  }

  const calendarButton = bookingData.status === 'confirmed' && calendarUrl
    ? `<p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>📎 Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl('kitchen')}/manager/bookings" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View Bookings</a></div>`
    : `<a href="${getDashboardUrl('kitchen')}/manager/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Bookings</a>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Booking ${statusText}</h2><p class="message">The booking status has been updated:</p><div class="info-box"><strong>👨‍🍳 Chef:</strong> ${bookingData.chefName}<br><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>📊 Status:</strong> <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span></div>${calendarButton}<div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  const textCalendar = bookingData.status === 'confirmed' && calendarUrl ? ` Add to calendar: ${calendarUrl}` : '';
  return {
    to: bookingData.managerEmail,
    subject,
    text: `Booking ${statusText} - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}, Status: ${statusText}${textCalendar}`,
    html,
    attachments
  };
};

export const generateBookingRequestEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string }): EmailContent => {
  const subject = `Booking Request Received - ${bookingData.kitchenName}`;
  const timezone = bookingData.timezone || 'America/St_Johns';
  const locationName = bookingData.locationName || bookingData.kitchenName;

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);

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
  const provider = detectEmailProvider(bookingData.chefEmail);
  const calendarButtonText = provider === 'outlook' ? '📅 Add to Outlook Calendar' :
    provider === 'yahoo' ? '📅 Add to Yahoo Calendar' :
      provider === 'apple' ? '📅 Add to Apple Calendar' :
        '📅 Add to Calendar';

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

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">We've received your kitchen booking request! The manager has been notified and will review it shortly.</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>📊 Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Approval</span>${bookingData.specialNotes ? `<br><br><strong>📝 Notes:</strong> ${bookingData.specialNotes}` : ''}</div><p class="message">You'll receive a confirmation email once the manager approves your booking.</p><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>📎 Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/book-kitchen" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View My Bookings</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return {
    to: bookingData.chefEmail,
    subject,
    text: `Hello ${bookingData.chefName}, We've received your kitchen booking request! Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Status: Pending Approval. You'll receive a confirmation email once approved. Add to calendar: ${calendarUrl}`,
    html,
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingConfirmationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string | Date; startTime: string; endTime: string; specialNotes?: string; timezone?: string; locationName?: string }): EmailContent => {
  const subject = `Booking Confirmed - ${bookingData.kitchenName}`;
  const timezone = bookingData.timezone || 'America/St_Johns';
  const locationName = bookingData.locationName || bookingData.kitchenName;

  // Convert bookingDate to Date object for display
  const bookingDateObj = bookingData.bookingDate instanceof Date
    ? bookingData.bookingDate
    : new Date(bookingData.bookingDate);

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
  const provider = detectEmailProvider(bookingData.chefEmail);
  const calendarButtonText = provider === 'outlook' ? '📅 Add to Outlook Calendar' :
    provider === 'yahoo' ? '📅 Add to Yahoo Calendar' :
      provider === 'apple' ? '📅 Add to Apple Calendar' :
        '📅 Add to Calendar';

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

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">Great news! Your kitchen booking has been <strong style="color: #16a34a;">CONFIRMED</strong> ✅</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Confirmed</span>${bookingData.specialNotes ? `<br><br><strong>📝 Notes:</strong> ${bookingData.specialNotes}` : ''}</div><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>📎 Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/book-kitchen" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View My Bookings</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you need to make changes, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return {
    to: bookingData.chefEmail,
    subject,
    text: `Hello ${bookingData.chefName}, Great news! Your kitchen booking has been CONFIRMED! Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Add to calendar: ${calendarUrl}`,
    html,
    attachments: [{
      filename: 'kitchen-booking.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }]
  };
};

export const generateBookingCancellationEmail = (bookingData: { chefEmail: string; chefName: string; kitchenName: string; bookingDate: string; startTime: string; endTime: string; cancellationReason?: string }): EmailContent => {
  const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">Your kitchen booking has been cancelled.</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${bookingData.kitchenName}<br><strong>📅 Date:</strong> ${new Date(bookingData.bookingDate).toLocaleDateString()}<br><strong>⏰ Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>📊 Status:</strong> <span style="color: #dc2626; font-weight: 600;">Cancelled</span>${bookingData.cancellationReason ? `<br><br><strong>📝 Reason:</strong> ${bookingData.cancellationReason}` : ''}</div><p class="message">You can make a new booking anytime from your dashboard.</p><a href="${getDashboardUrl()}/book-kitchen" class="cta-button" style="color: white !important; text-decoration: none !important;">Browse Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: bookingData.chefEmail, subject, text: `Hello ${bookingData.chefName}, Your kitchen booking has been cancelled. Kitchen: ${bookingData.kitchenName}, Date: ${new Date(bookingData.bookingDate).toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}${bookingData.cancellationReason ? `. Reason: ${bookingData.cancellationReason}` : ''}`, html };
};

// Kitchen availability change notification email for chefs
export const generateKitchenAvailabilityChangeEmail = (data: { chefEmail: string; chefName: string; kitchenName: string; changeType: string; details: string }): EmailContent => {
  const subject = `Kitchen Availability Update - ${data.kitchenName}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">The availability for <strong>${data.kitchenName}</strong> has been updated.</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${data.kitchenName}<br><strong>📋 Change Type:</strong> ${data.changeType}<br><strong>📝 Details:</strong> ${data.details}</div><p class="message">Please check the updated availability before making your next booking.</p><a href="${getDashboardUrl()}/book-kitchen" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Availability</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, The availability for ${data.kitchenName} has been updated. Change Type: ${data.changeType}. Details: ${data.details}`, html };
};

// Kitchen settings change notification email for chefs and managers
export const generateKitchenSettingsChangeEmail = (data: { email: string; name: string; kitchenName: string; changes: string; isChef: boolean }): EmailContent => {
  const subject = `Kitchen Settings Updated - ${data.kitchenName}`;
  const greeting = data.isChef ? `Hello ${data.name},` : `Hello ${data.name},`;
  const message = data.isChef
    ? `The settings for <strong>${data.kitchenName}</strong> have been updated. This may affect your existing or future bookings.`
    : `The settings for <strong>${data.kitchenName}</strong> have been updated.`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">${greeting}</h2><p class="message">${message}</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${data.kitchenName}<br><strong>📝 Changes:</strong> ${data.changes}</div>${data.isChef ? `<p class="message">Please review the updated settings before making your next booking.</p><a href="${getDashboardUrl()}/book-kitchen" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Details</a>` : `<a href="${getDashboardUrl('kitchen')}/manager/booking-dashboard" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Settings</a>`}<div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.email, subject, text: `${greeting} ${message} Kitchen: ${data.kitchenName}. Changes: ${data.changes}`, html };
};

// Chef profile request notification email for managers
export const generateChefProfileRequestEmail = (data: { managerEmail: string; chefName: string; chefEmail: string; locationName: string; locationId: number }): EmailContent => {
  const subject = `Chef Access Request - ${data.locationName}`;
  const reviewUrl = `${getDashboardUrl('kitchen')}/manager/applications`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New Chef Access Request</h2><p class="message">A chef has requested access to your location and kitchen facilities:</p><div class="info-box"><strong>👨‍🍳 Chef Name:</strong> ${data.chefName}<br><strong>📧 Chef Email:</strong> ${data.chefEmail}<br><strong>📍 Location:</strong> ${data.locationName}<br><strong>📊 Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Review</span></div><p class="message">Please review the chef's profile and approve or reject their request from your manager dashboard.</p><a href="${reviewUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Chef Request</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.managerEmail, subject, text: `New Chef Access Request - Chef: ${data.chefName} (${data.chefEmail}) has requested access to location: ${data.locationName}. Status: Pending Review. Please review from your manager dashboard.`, html };
};

// Chef location access approved notification email for chefs
export const generateChefLocationAccessApprovedEmail = (data: { chefEmail: string; chefName: string; locationName: string; locationId: number }): EmailContent => {
  const subject = `Kitchen Access Approved - ${data.locationName}`;
  const bookingsUrl = `${getDashboardUrl()}/book-kitchen`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! The manager has <strong style="color: #16a34a;">APPROVED</strong> your chef profile for kitchen access at <strong>${data.locationName}</strong> ✅</p><div class="info-box"><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">You can now book kitchen facilities at this location. Start making your bookings from your dashboard!</p><a href="${bookingsUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, Great news! The manager has approved your chef profile for kitchen access at ${data.locationName}. You can now book kitchen facilities at this location.`, html };
};

// Chef kitchen access approved notification email for chefs (when manager approves kitchen profile)
export const generateChefKitchenAccessApprovedEmail = (data: { chefEmail: string; chefName: string; kitchenName: string; kitchenId: number }): EmailContent => {
  const subject = `Kitchen Access Approved - ${data.kitchenName}`;
  const bookingsUrl = `${getDashboardUrl()}/book-kitchen`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! The manager has <strong style="color: #16a34a;">APPROVED</strong> your chef profile for kitchen access at <strong>${data.kitchenName}</strong> ✅</p><div class="info-box"><strong>🏢 Kitchen:</strong> ${data.kitchenName}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">You can now book this kitchen. Start making your bookings from your dashboard!</p><a href="${bookingsUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, Great news! The manager has approved your chef profile for kitchen access at ${data.kitchenName}. You can now book this kitchen.`, html };
};

// Location notification email changed notification email
export const generateLocationEmailChangedEmail = (data: { email: string; locationName: string; locationId: number }): EmailContent => {
  const subject = `Location Notification Email Updated - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/dashboard`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Location Notification Email Updated</h2><p class="message">This email address has been set as the notification email for <strong>${data.locationName}</strong>.</p><div class="info-box"><strong>📍 Location:</strong> ${data.locationName}<br><strong>📧 Notification Email:</strong> ${data.email}</div><p class="message">You will now receive email notifications for bookings, cancellations, and other important updates for this location.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Dashboard</a><div class="divider"></div></div><div class="footer"><p class="footer-text">If you didn't make this change, please contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  return { to: data.email, subject, text: `Location Notification Email Updated - This email address has been set as the notification email for ${data.locationName}. You will now receive email notifications for bookings, cancellations, and other important updates for this location.`, html };
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
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/bookings`;
  const formattedPrice = `$${(data.totalPrice / 100).toFixed(2)}`;
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Storage Extension Request</h2><p class="message">A chef has requested to extend their storage booking. Payment has been received and is awaiting your approval.</p><div class="info-box"><strong>👨‍🍳 Chef:</strong> ${data.chefName}<br><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 Extension:</strong> ${data.extensionDays} days<br><strong>📆 New End Date:</strong> ${formattedDate}<br><strong>💰 Amount Paid:</strong> ${formattedPrice}<br><strong>📊 Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Awaiting Approval</span></div><p class="message">Please review and approve or reject this extension request from your manager dashboard.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Extension Request</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Storage Extension Request - Chef: ${data.chefName}, Storage: ${data.storageName}, Extension: ${data.extensionDays} days, New End Date: ${formattedDate}, Amount: ${formattedPrice}. Status: Awaiting Approval. Please review from your manager dashboard.`,
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
  const subject = `Storage Extension Payment Received - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const formattedPrice = `$${(data.totalPrice / 100).toFixed(2)}`;
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Your payment for the storage extension has been received! The manager has been notified and will review your request shortly.</p><div class="info-box"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 Extension:</strong> ${data.extensionDays} days<br><strong>📆 New End Date:</strong> ${formattedDate}<br><strong>💰 Amount Paid:</strong> ${formattedPrice}<br><strong>📊 Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Awaiting Manager Approval</span></div><p class="message">You'll receive a confirmation email once the manager approves your extension.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Your payment for the storage extension has been received! Storage: ${data.storageName}, Extension: ${data.extensionDays} days, New End Date: ${formattedDate}, Amount: ${formattedPrice}. Status: Awaiting Manager Approval.`,
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
  const subject = `Storage Extension Approved - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const formattedDate = data.newEndDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! Your storage extension has been <strong style="color: #16a34a;">APPROVED</strong> ✅</p><div class="info-box"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 Extension:</strong> ${data.extensionDays} days<br><strong>📆 New End Date:</strong> ${formattedDate}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">Your storage booking has been extended. You can continue using the storage until the new end date.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Great news! Your storage extension has been APPROVED! Storage: ${data.storageName}, Extension: ${data.extensionDays} days, New End Date: ${formattedDate}.`,
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
  const subject = `Storage Extension Declined - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const refundText = data.refundAmount ? `A refund of $${(data.refundAmount / 100).toFixed(2)} has been processed and will be credited to your original payment method within 5-10 business days.` : 'A refund will be processed shortly.';
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Unfortunately, your storage extension request has been declined.</p><div class="info-box"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 Requested Extension:</strong> ${data.extensionDays} days<br><strong>📊 Status:</strong> <span style="color: #dc2626; font-weight: 600;">Declined</span>${data.rejectionReason ? `<br><br><strong>📝 Reason:</strong> ${data.rejectionReason}` : ''}</div><p class="message">${refundText}</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Unfortunately, your storage extension request has been declined. Storage: ${data.storageName}, Requested Extension: ${data.extensionDays} days.${data.rejectionReason ? ` Reason: ${data.rejectionReason}.` : ''} ${refundText}`,
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
  const subject = `⚠️ Storage Booking Expiring ${data.daysUntilExpiry === 0 ? 'Today' : `in ${data.daysUntilExpiry} Day${data.daysUntilExpiry > 1 ? 's' : ''}`}`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dailyRate = (data.dailyRateCents / 100).toFixed(2);
  const penaltyPerDay = ((data.dailyRateCents * data.penaltyRate) / 100).toFixed(2);
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Your storage booking is ${data.daysUntilExpiry === 0 ? '<strong style="color: #dc2626;">expiring today</strong>' : `expiring in <strong>${data.daysUntilExpiry} day${data.daysUntilExpiry > 1 ? 's' : ''}</strong>`}. Please take action to avoid overstay penalties.</p><div class="info-box"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 End Date:</strong> ${formattedEndDate}<br><strong>💰 Daily Rate:</strong> $${dailyRate} CAD</div><div class="info-box" style="background-color: #fef3c7; border-color: #f59e0b;"><strong>⚠️ Overstay Policy:</strong><br>• <strong>Grace Period:</strong> ${data.gracePeriodDays} days after end date<br>• <strong>Penalty Rate:</strong> ${(data.penaltyRate * 100).toFixed(0)}% of daily rate per day ($${penaltyPerDay}/day)<br>• Penalties require manager approval before charging</div><p class="message">To avoid penalties, please either:</p><ul style="margin: 16px 0; padding-left: 20px;"><li>Extend your storage booking</li><li>Remove your items before the end date</li></ul><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Manage My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Your storage booking for ${data.storageName} is expiring on ${formattedEndDate}. Please extend or remove your items to avoid overstay penalties. Grace period: ${data.gracePeriodDays} days. Penalty rate: ${(data.penaltyRate * 100).toFixed(0)}% of daily rate per day.`,
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
  const subject = data.isInGracePeriod 
    ? `📦 Storage Overstay - Grace Period Active` 
    : `⚠️ Storage Overstay - Penalty Pending Review`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formattedGraceEnd = data.gracePeriodEndsAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const penaltyAmount = (data.calculatedPenaltyCents / 100).toFixed(2);
  
  const graceMessage = data.isInGracePeriod 
    ? `<p class="message">You are currently in the <strong>grace period</strong>. No penalties will be charged if you resolve this before <strong>${formattedGraceEnd}</strong>.</p>`
    : `<p class="message" style="color: #dc2626;">The grace period has ended. A penalty of <strong>$${penaltyAmount} CAD</strong> has been calculated and is pending manager review.</p>`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Your storage booking has exceeded its end date.</p><div class="info-box" style="background-color: ${data.isInGracePeriod ? '#fef3c7' : '#fee2e2'}; border-color: ${data.isInGracePeriod ? '#f59e0b' : '#dc2626'};"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>📅 End Date:</strong> ${formattedEndDate}<br><strong>⏰ Days Overdue:</strong> ${data.daysOverdue}<br><strong>🛡️ Grace Period Ends:</strong> ${formattedGraceEnd}${!data.isInGracePeriod ? `<br><strong>💰 Calculated Penalty:</strong> $${penaltyAmount} CAD` : ''}</div>${graceMessage}<p class="message">To resolve this overstay, please:</p><ul style="margin: 16px 0; padding-left: 20px;"><li>Extend your storage booking, or</li><li>Contact the kitchen manager to arrange item removal</li></ul><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Manage My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Your storage booking for ${data.storageName} has exceeded its end date (${formattedEndDate}). Days overdue: ${data.daysOverdue}. ${data.isInGracePeriod ? `Grace period ends: ${formattedGraceEnd}. No penalties yet.` : `Calculated penalty: $${penaltyAmount} CAD (pending manager review).`}`,
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
  const subject = `💳 Overstay Penalty Charged - $${(data.penaltyAmountCents / 100).toFixed(2)} CAD`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  const formattedDate = data.chargeDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const penaltyAmount = (data.penaltyAmountCents / 100).toFixed(2);
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">An overstay penalty has been charged to your payment method.</p><div class="info-box" style="background-color: #fee2e2; border-color: #dc2626;"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>⏰ Days Overdue:</strong> ${data.daysOverdue}<br><strong>💰 Penalty Amount:</strong> $${penaltyAmount} CAD<br><strong>📅 Charge Date:</strong> ${formattedDate}</div><p class="message">This charge was approved by the kitchen manager after the grace period ended. If you believe this charge is in error, please contact the kitchen manager directly.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View My Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, An overstay penalty of $${penaltyAmount} CAD has been charged for ${data.storageName}. Days overdue: ${data.daysOverdue}. Charge date: ${formattedDate}.`,
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
    ? `📦 Storage Overstay Detected - ${data.storageName}` 
    : `⚠️ Overstay Pending Review - ${data.storageName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/overstays`;
  const formattedEndDate = data.endDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formattedGraceEnd = data.gracePeriodEndsAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const penaltyAmount = (data.calculatedPenaltyCents / 100).toFixed(2);
  
  const actionMessage = data.isInGracePeriod 
    ? `<p class="message">The chef is currently in the grace period (ends ${formattedGraceEnd}). No action required yet, but you may want to reach out to the chef.</p>`
    : `<p class="message" style="color: #dc2626;"><strong>Action Required:</strong> The grace period has ended. Please review and decide whether to approve, adjust, or waive the penalty.</p>`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Overstay Alert</h2><p class="message">A storage booking at <strong>${data.kitchenName}</strong> has exceeded its end date.</p><div class="info-box" style="background-color: ${data.isInGracePeriod ? '#fef3c7' : '#fee2e2'}; border-color: ${data.isInGracePeriod ? '#f59e0b' : '#dc2626'};"><strong>📦 Storage:</strong> ${data.storageName}<br><strong>👤 Chef:</strong> ${data.chefName} (${data.chefEmail})<br><strong>📅 End Date:</strong> ${formattedEndDate}<br><strong>⏰ Days Overdue:</strong> ${data.daysOverdue}<br><strong>🛡️ Grace Period Ends:</strong> ${formattedGraceEnd}<br><strong>💰 Calculated Penalty:</strong> $${penaltyAmount} CAD</div>${actionMessage}<a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Overstays</a><div class="divider"></div></div><div class="footer"><p class="footer-text">This is an automated notification from Local Cooks Community.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Overstay Alert: ${data.storageName} at ${data.kitchenName}. Chef: ${data.chefName}. Days overdue: ${data.daysOverdue}. Calculated penalty: $${penaltyAmount} CAD. ${data.isInGracePeriod ? 'Grace period active.' : 'Action required - please review.'}`,
    html
  };
};

// ===================================
// KITCHEN APPLICATION NOTIFICATION EMAILS (Manager)
// ===================================

// Notify manager about new kitchen application from chef
export const generateNewKitchenApplicationManagerEmail = (data: {
  managerEmail: string;
  chefName: string;
  chefEmail: string;
  locationName: string;
  applicationId: number;
  submittedAt: Date;
}): EmailContent => {
  const subject = `New Kitchen Application - ${data.chefName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/applications`;
  const formattedDate = data.submittedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New Kitchen Application</h2><p class="message">A chef has submitted an application to use your kitchen:</p><div class="info-box"><strong>👨‍🍳 Chef Name:</strong> ${data.chefName}<br><strong>📧 Email:</strong> ${data.chefEmail}<br><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📅 Submitted:</strong> ${formattedDate}</div><p class="message">Please review this application and approve or reject it from your manager dashboard.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Application</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `New Kitchen Application - Chef: ${data.chefName} (${data.chefEmail}) has applied to ${data.locationName}. Submitted: ${formattedDate}. Please review from your manager dashboard.`,
    html
  };
};

// Notify chef when their kitchen application is approved
export const generateKitchenApplicationApprovedEmail = (data: {
  chefEmail: string;
  chefName: string;
  locationName: string;
  kitchenName?: string;
}): EmailContent => {
  const subject = `Kitchen Application Approved - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl()}/book-kitchen`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! 🎉 Your kitchen application has been <strong style="color: #16a34a;">APPROVED</strong>!</p><div class="info-box"><strong>🏢 Location:</strong> ${data.locationName}${data.kitchenName ? `<br><strong>🍳 Kitchen:</strong> ${data.kitchenName}` : ''}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">You can now book time slots at this kitchen. Visit your dashboard to make your first booking!</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Book Kitchen Now</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Great news! Your kitchen application to ${data.locationName} has been APPROVED! You can now book time slots at this kitchen.`,
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
  const subject = `Kitchen Application Update - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Thank you for your interest in using our kitchen facilities. Unfortunately, your application could not be approved at this time.</p><div class="info-box"><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📊 Status:</strong> <span style="color: #dc2626; font-weight: 600;">Not Approved</span>${data.feedback ? `<br><br><strong>📝 Feedback:</strong> ${data.feedback}` : ''}</div><p class="message">You may reapply in the future or explore other kitchen locations on our platform.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View My Applications</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, Thank you for your interest. Unfortunately, your kitchen application to ${data.locationName} could not be approved at this time.${data.feedback ? ` Feedback: ${data.feedback}` : ''}`,
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
  const subject = `Kitchen License Approved - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/booking-dashboard`;
  const formattedDate = data.approvedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.managerName},</h2><p class="message">Great news! 🎉 Your kitchen license has been <strong style="color: #16a34a;">APPROVED</strong> by the admin team!</p><div class="info-box"><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📅 Approved On:</strong> ${formattedDate}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">Your kitchen is now fully licensed and can accept chef applications and bookings.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Dashboard</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Hello ${data.managerName}, Great news! Your kitchen license for ${data.locationName} has been APPROVED! Approved on: ${formattedDate}. Your kitchen can now accept chef applications and bookings.`,
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
  const subject = `Kitchen License Update Required - ${data.locationName}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/booking-dashboard`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.managerName},</h2><p class="message">Your kitchen license submission requires attention. The admin team was unable to approve it at this time.</p><div class="info-box"><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📊 Status:</strong> <span style="color: #dc2626; font-weight: 600;">Rejected</span>${data.feedback ? `<br><br><strong>📝 Feedback:</strong> ${data.feedback}` : ''}</div><p class="message">Please review the feedback and upload a new license document from your dashboard.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Upload New License</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Hello ${data.managerName}, Your kitchen license for ${data.locationName} requires attention.${data.feedback ? ` Feedback: ${data.feedback}` : ''} Please upload a new license document.`,
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
  const dashboardUrl = `${getDashboardUrl('admin')}/admin`;
  const formattedDate = data.submittedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Kitchen License Pending Review</h2><p class="message">A manager has submitted a kitchen license for your review:</p><div class="info-box"><strong>👤 Manager:</strong> ${data.managerName}<br><strong>📧 Email:</strong> ${data.managerEmail}<br><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📅 Submitted:</strong> ${formattedDate}<br><strong>📊 Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Review</span></div><p class="message">Please review and approve or reject this license from the admin dashboard.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review License</a><div class="divider"></div></div><div class="footer"><p class="footer-text">This is an automated notification from Local Cooks Community.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.adminEmail,
    subject,
    text: `Kitchen License Pending Review - Manager: ${data.managerName} (${data.managerEmail}) submitted license for ${data.locationName}. Submitted: ${formattedDate}. Please review from admin dashboard.`,
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
  const subject = `Damage Claim Filed - Action Required`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">A damage claim has been filed against your booking. Please review and respond before the deadline.</p><div class="info-box"><strong>📋 Claim:</strong> ${data.claimTitle}<br><strong>💰 Amount:</strong> ${data.claimedAmount}<br><strong>🏢 Location:</strong> ${data.locationName}<br><strong>👤 Filed by:</strong> ${data.managerName}<br><strong>📅 Damage Date:</strong> ${data.damageDate}<br><strong>⏰ Response Deadline:</strong> <span style="color: #dc2626; font-weight: 600;">${data.responseDeadline}</span></div><p class="message">You can accept the claim or dispute it for admin review. If you don't respond by the deadline, the claim may be automatically approved.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review & Respond</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, A damage claim has been filed against your booking at ${data.locationName}. Claim: ${data.claimTitle}. Amount: ${data.claimedAmount}. Please respond by ${data.responseDeadline}.`,
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
  const isAccepted = data.response === 'accepted';
  const subject = `Damage Claim ${isAccepted ? 'Accepted' : 'Disputed'} - ${data.claimTitle}`;
  const dashboardUrl = `${getDashboardUrl('kitchen')}/manager/booking-dashboard`;
  
  const statusColor = isAccepted ? '#16a34a' : '#dc2626';
  const statusText = isAccepted ? 'ACCEPTED' : 'DISPUTED';
  const nextSteps = isAccepted 
    ? 'You can now charge the chef\'s saved payment method from your dashboard.'
    : 'The claim has been escalated to admin for review. You will be notified of the decision.';
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.managerName},</h2><p class="message">${data.chefName} has responded to your damage claim.</p><div class="info-box"><strong>📋 Claim:</strong> ${data.claimTitle}<br><strong>💰 Amount:</strong> ${data.claimedAmount}<br><strong>📊 Status:</strong> <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span>${data.chefResponse ? `<br><br><strong>💬 Chef's Response:</strong> ${data.chefResponse}` : ''}</div><p class="message">${nextSteps}</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Claim</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.managerEmail,
    subject,
    text: `Hello ${data.managerName}, ${data.chefName} has ${data.response} your damage claim "${data.claimTitle}" for ${data.claimedAmount}.${data.chefResponse ? ` Response: ${data.chefResponse}` : ''} ${nextSteps}`,
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
  const dashboardUrl = `${getDashboardUrl('admin')}/admin`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Damage Claim Dispute - Review Required</h2><p class="message">A chef has disputed a damage claim and requires your review:</p><div class="info-box"><strong>📋 Claim:</strong> ${data.claimTitle}<br><strong>💰 Amount:</strong> ${data.claimedAmount}<br><strong>🏢 Location:</strong> ${data.locationName}<br><strong>👤 Manager:</strong> ${data.managerName}<br><strong>👨‍🍳 Chef:</strong> ${data.chefName} (${data.chefEmail})<br><br><strong>💬 Chef's Dispute Reason:</strong><br>${data.chefResponse}</div><p class="message">Please review the evidence and make a decision.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Dispute</a><div class="divider"></div></div><div class="footer"><p class="footer-text">This is an automated notification from Local Cooks Community.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.adminEmail,
    subject,
    text: `Damage Claim Dispute - Claim: ${data.claimTitle}, Amount: ${data.claimedAmount}, Location: ${data.locationName}, Manager: ${data.managerName}, Chef: ${data.chefName}. Chef's reason: ${data.chefResponse}. Please review from admin dashboard.`,
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
  const isChef = data.recipientRole === 'chef';
  const decisionLabels = {
    approved: 'Approved',
    partially_approved: 'Partially Approved',
    rejected: 'Rejected'
  };
  const decisionColors = {
    approved: '#16a34a',
    partially_approved: '#f59e0b',
    rejected: '#dc2626'
  };
  
  const subject = `Damage Claim ${decisionLabels[data.decision]} - ${data.claimTitle}`;
  const dashboardUrl = isChef 
    ? `${getDashboardUrl()}/dashboard`
    : `${getDashboardUrl('kitchen')}/manager/booking-dashboard`;
  
  const amountText = data.decision === 'partially_approved' && data.finalAmount
    ? `<br><strong>💰 Final Amount:</strong> ${data.finalAmount} (originally ${data.claimedAmount})`
    : `<br><strong>💰 Amount:</strong> ${data.claimedAmount}`;
  
  const nextStepsChef = data.decision === 'rejected' 
    ? 'No payment will be charged to your account.'
    : 'The approved amount will be charged to your saved payment method.';
  const nextStepsManager = data.decision === 'rejected'
    ? 'The claim has been rejected and no payment will be collected.'
    : 'You can now charge the chef from your dashboard.';
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.recipientName},</h2><p class="message">The admin has made a decision on the disputed damage claim.</p><div class="info-box"><strong>📋 Claim:</strong> ${data.claimTitle}${amountText}<br><strong>📊 Decision:</strong> <span style="color: ${decisionColors[data.decision]}; font-weight: 600;">${decisionLabels[data.decision]}</span><br><br><strong>📝 Reason:</strong> ${data.decisionReason}</div><p class="message">${isChef ? nextStepsChef : nextStepsManager}</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Details</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.recipientEmail,
    subject,
    text: `Hello ${data.recipientName}, The admin has ${decisionLabels[data.decision].toLowerCase()} the damage claim "${data.claimTitle}". ${data.decisionReason}`,
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
  const subject = `Payment Processed - Damage Claim`;
  const dashboardUrl = `${getDashboardUrl()}/dashboard`;
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">A payment has been processed for a damage claim.</p><div class="info-box"><strong>📋 Claim:</strong> ${data.claimTitle}<br><strong>💰 Amount Charged:</strong> ${data.chargedAmount}<br><strong>🏢 Location:</strong> ${data.locationName}<br><strong>📊 Status:</strong> <span style="color: #16a34a; font-weight: 600;">Payment Complete</span></div><p class="message">This charge was made to your saved payment method. A receipt has been sent to your email by Stripe.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Details</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.chefEmail,
    subject,
    text: `Hello ${data.chefName}, A payment of ${data.chargedAmount} has been processed for the damage claim "${data.claimTitle}" at ${data.locationName}.`,
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
  const subject = `New ${data.userRole.charAt(0).toUpperCase() + data.userRole.slice(1)} Registration - ${data.newUserName}`;
  const dashboardUrl = `${getDashboardUrl('admin')}/admin`;
  const formattedDate = data.registrationDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const roleColor = data.userRole === 'admin' ? '#dc2626' : data.userRole === 'manager' ? '#2563eb' : '#16a34a';
  const roleLabel = data.userRole.charAt(0).toUpperCase() + data.userRole.slice(1);
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New User Registration</h2><p class="message">A new user has registered on the platform:</p><div class="info-box"><strong>👤 Name:</strong> ${data.newUserName}<br><strong>📧 Email:</strong> ${data.newUserEmail}<br><strong>🏷️ Role:</strong> <span style="color: ${roleColor}; font-weight: 600;">${roleLabel}</span><br><strong>📅 Registered:</strong> ${formattedDate}</div><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Users</a><div class="divider"></div></div><div class="footer"><p class="footer-text">This is an automated notification from Local Cooks Community.</p><div class="divider"></div><p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p></div></div></body></html>`;
  
  return {
    to: data.adminEmail,
    subject,
    text: `New ${roleLabel} Registration - Name: ${data.newUserName}, Email: ${data.newUserEmail}, Registered: ${formattedDate}`,
    html
  };
};
