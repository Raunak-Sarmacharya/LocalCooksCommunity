import nodemailer from 'nodemailer';

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
}

// Add email tracking to prevent duplicates
const recentEmails = new Map<string, number>();
const DUPLICATE_PREVENTION_WINDOW = 30000; // 30 seconds

// Create a transporter with configuration
const createTransporter = (config: EmailConfig) => {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
  });
};

// Get email configuration from environment variables
const getEmailConfig = (): EmailConfig => {
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

// Send email function
export const sendEmail = async (content: EmailContent, options?: { trackingId?: string }): Promise<boolean> => {
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
    console.log('Using email configuration:', {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.auth.user ? '****' : 'not set', // Don't log actual credentials
    });

    const transporter = createTransporter(config);

    // Set the from address
    const from = process.env.EMAIL_FROM || `Local Cooks <${config.auth.user}>`;

    // Verify SMTP connection
    try {
      await new Promise((resolve, reject) => {
        transporter.verify((error, success) => {
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

    // Send the email
    const info = await transporter.sendMail({
      from,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      if ('code' in error) {
        console.error('Error code:', (error as any).code);
      }
    }
    return false;
  }
};

// Generate application status change email
export const generateStatusChangeEmail = (
  applicationData: {
    fullName: string;
    email: string;
    status: string;
  }
): EmailContent => {
  const statusMessages: Record<string, { subject: string; message: string }> = {
    new: {
      subject: 'Your Application Has Been Received',
      message: 'We have received your application and will review it shortly.',
    },
    inReview: {
      subject: 'Your Application is Under Review',
      message: 'Your application is currently being reviewed by our team.',
    },
    approved: {
      subject: 'Your Application Has Been Approved!',
      message: 'Congratulations! Your application has been approved. Welcome to the Local Cooks community!',
    },
    rejected: {
      subject: 'Update on Your Application',
      message: 'We regret to inform you that your application has not been approved at this time.',
    },
    cancelled: {
      subject: 'Your Application Has Been Cancelled',
      message: 'Your application has been cancelled as requested.',
    },
  };

  const statusStyles: Record<string, { badge: string; badgeBg: string; badgeShadow: string; emoji: string; cta?: { text: string; url: string } }> = {
    new: {
      badge: 'Received',
      badgeBg: 'linear-gradient(90deg, #e0e7ff 0%, #c7d2fe 100%)',
      badgeShadow: '0 2px 8px 0 rgba(79,70,229,0.10)',
      emoji: '📥',
    },
    inReview: {
      badge: 'In Review',
      badgeBg: 'linear-gradient(90deg, #fef9c3 0%, #fde68a 100%)',
      badgeShadow: '0 2px 8px 0 rgba(234,179,8,0.10)',
      emoji: '🔎',
    },
    approved: {
      badge: 'Approved',
      badgeBg: 'linear-gradient(90deg, #bbf7d0 0%, #4ade80 100%)',
      badgeShadow: '0 2px 8px 0 rgba(16,185,129,0.10)',
      emoji: '🎉',
      cta: {
        text: 'Get Started',
        url: 'https://localcooks.community/dashboard',
      },
    },
    rejected: {
      badge: 'Not Approved',
      badgeBg: 'linear-gradient(90deg, #fee2e2 0%, #fecaca 100%)',
      badgeShadow: '0 2px 8px 0 rgba(239,68,68,0.10)',
      emoji: '❌',
    },
    cancelled: {
      badge: 'Cancelled',
      badgeBg: 'linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 100%)',
      badgeShadow: '0 2px 8px 0 rgba(107,114,128,0.10)',
      emoji: '🛑',
    },
  };

  const { subject, message } = statusMessages[applicationData.status] || {
    subject: 'Update on Your Application Status',
    message: `Your application status has been updated to: ${applicationData.status}`,
  };
  const style = statusStyles[applicationData.status] || statusStyles['new'];

  const html = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:linear-gradient(135deg,#f8fafc 0%,#eef2ff 100%);padding:0;margin:0;min-height:100vh;">
    <tr>
      <td align="center" style="padding:0;margin:0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:40px auto 0 auto;background:#fff;border-radius:18px;box-shadow:0 4px 32px 0 rgba(0,0,0,0.07);overflow:hidden;">
          <tr>
            <td style="padding:0;">
              <!-- Header -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:linear-gradient(90deg,#6366f1 0%,#818cf8 100%);padding:0;">
                <tr>
                  <td style="padding:32px 32px 16px 32px;text-align:center;">
                    <img src="https://localcooks.community/assets/logo-white.png" alt="Local Cooks Logo" style="display:inline-block;height:48px;width:auto;vertical-align:middle;" />
                    <h1 style="margin:12px 0 0 0;font-family: 'Lobster', cursive;font-size:2rem;font-weight:700;color:#fff;letter-spacing:-1px;">Local Cooks</h1>
                  </td>
                </tr>
              </table>
              <!-- Status Badge -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding:32px 32px 0 32px;">
                    <span style="display:inline-block;padding:10px 28px;font-size:1.1rem;font-weight:600;border-radius:999px;background:${style.badgeBg};box-shadow:${style.badgeShadow};color:#222;letter-spacing:0.5px;vertical-align:middle;">
                      <span style="font-size:1.5rem;vertical-align:middle;margin-right:8px;">${style.emoji}</span>
                      ${style.badge}
                    </span>
                  </td>
                </tr>
              </table>
              <!-- Main Content -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:32px 32px 0 32px;">
                    <h2 style="font-family:'Segoe UI',Arial,sans-serif;font-size:1.5rem;font-weight:700;color:#4f46e5;margin:0 0 12px 0;letter-spacing:-0.5px;">Hello ${applicationData.fullName},</h2>
                    <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:1.1rem;line-height:1.7;color:#222;margin:0 0 18px 0;">${message}</p>
                    <div style="margin:24px 0 0 0;">
                      <span style="display:inline-block;font-family:'Segoe UI',Arial,sans-serif;font-size:1rem;font-weight:500;color:#6366f1;background:linear-gradient(90deg,#eef2ff 0%,#c7d2fe 100%);padding:8px 20px;border-radius:8px;box-shadow:0 1px 4px 0 rgba(99,102,241,0.07);">Status: <strong>${applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1)}</strong></span>
                    </div>
                  </td>
                </tr>
                <!-- CTA Button for Approved -->
                ${applicationData.status === 'approved' && style.cta ? `
                <tr>
                  <td align="center" style="padding:32px 32px 0 32px;">
                    <a href="${style.cta.url}" style="display:inline-block;padding:16px 40px;font-size:1.1rem;font-weight:700;color:#fff;background:linear-gradient(90deg,#22d3ee 0%,#4ade80 100%);border-radius:999px;box-shadow:0 4px 16px 0 rgba(34,211,238,0.13);text-decoration:none;transition:box-shadow 0.2s;">${style.cta.text} &rarr;</a>
                  </td>
                </tr>
                ` : ''}
                <!-- Divider -->
                <tr>
                  <td style="padding:40px 32px 0 32px;">
                    <div style="height:1px;width:100%;background:linear-gradient(90deg,#e0e7ff 0%,#f3f4f6 100%);opacity:0.7;"></div>
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td style="padding:32px 32px 32px 32px;text-align:center;">
                    <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.95rem;color:#888;line-height:1.6;margin:0 0 8px 0;">Thank you for your interest in <a href="https://localcooks.ca" style="color:#6366f1;font-weight:600;text-decoration:none;">Local Cooks</a>!</p>
                    <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.95rem;color:#888;line-height:1.6;margin:0 0 8px 0;">If you have any questions, just reply to this email or contact us at <a href="mailto:support@localcooks.community" style="color:#6366f1;text-decoration:underline;">support@localcooks.community</a>.</p>
                    <div style="margin:24px auto 0 auto;width:60px;height:4px;border-radius:2px;background:linear-gradient(90deg,#6366f1 0%,#818cf8 100%);opacity:0.18;"></div>
                    <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.85rem;color:#bbb;line-height:1.5;margin:18px 0 0 0;">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  `;

  return {
    to: applicationData.email,
    subject,
    html,
  };
};
