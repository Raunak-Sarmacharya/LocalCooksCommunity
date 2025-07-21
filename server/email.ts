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
  headers?: Record<string, string>;
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
      ciphers: 'SSLv3'
    },
    // Reduced timeouts for serverless functions (max 10s execution time)
    connectionTimeout: isProduction ? 15000 : 60000, // 15s production, 60s development
    greetingTimeout: isProduction ? 10000 : 30000, // 10s production, 30s development
    socketTimeout: isProduction ? 15000 : 60000, // 15s production, 60s development
    // Add authentication method
    authMethod: 'PLAIN',
    // Enable debug for troubleshooting in development only
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development',
    // Pool configuration for better performance
    pool: isProduction ? true : false,
    maxConnections: 1, // Single connection for serverless
    maxMessages: 1, // Single message per connection for serverless
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
    const mailOptions = {
      from: fromEmail,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      // Enhanced headers for better deliverability and MailChannels compatibility
      headers: {
        'Organization': organizationName,
        'X-Mailer': 'Local Cooks Community v2.0',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal',
        // Enhanced MailChannels and DKIM-friendly sender identification
        'Sender': config.auth.user,
        'Return-Path': config.auth.user,
        'Reply-To': config.auth.user,
        // Enhanced MailChannels headers for better routing
        'X-MC-PreserveRecipients': 'false',
        'X-MC-Track': 'opens,clicks',
        'X-MC-Tags': 'application,local-cooks',
        'X-MC-Subaccount': process.env.EMAIL_SUBACCOUNT || 'main',
        // Anti-spam and deliverability headers
        'List-Unsubscribe': `<mailto:${getUnsubscribeEmail()}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'List-Id': `<local-cooks.${domain}>`,
        // Enhanced authentication and tracking headers
        'X-Local-Cooks-Version': '2.0',
        'X-Local-Cooks-Type': content.subject.includes('Application') ? 'application' : 'system',
        'X-Local-Cooks-Tracking': options?.trackingId || `auto_${Date.now()}`,
        // Add DMARC-friendly headers
        'X-Vercel-Deployment': process.env.VERCEL_DEPLOYMENT_ID || 'local',
        'X-Vercel-URL': process.env.VERCEL_URL || 'localhost',
        'X-Vercel-Region': process.env.VERCEL_REGION || 'unknown',
        // Merge any additional headers from content
        ...(content.headers || {})
      },
      // Proper encoding settings for DKIM and MailChannels
      encoding: 'utf8' as const,
      // Enhanced delivery options for MailChannels compatibility
      envelope: {
        from: config.auth.user,
        to: content.to
      },
      // DKIM-compatible message ID with proper domain
      messageId: `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`,
      date: new Date(),
      // DKIM signing is handled by Hostinger SMTP server or MailChannels
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
  // Use the specific email address for unsubscribe requests
  return 'localcooks@localcook.shop';
};

// Helper function to get support email based on configured domain
const getSupportEmail = (): string => {
  const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
  return `support@${domain}`;
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
      
      <a href="https://local-cooks-community.vercel.app/apply" class="cta-button" style="color: white !important; text-decoration: none !important;">Learn About Requirements</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in ${organizationName}!</p>
      <div class="footer-links">
        <a href="mailto:${supportEmail}">Support</a> • 
        <a href="mailto:${supportEmail}?subject=Unsubscribe">Unsubscribe</a> • 
        <a href="https://local-cooks-community.vercel.app/privacy">Privacy Policy</a>
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

Learn more about requirements: https://local-cooks-community.vercel.app/apply

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
export const generateWelcomeEmail = (
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
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>
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

  return {
    to: userData.email,
    subject: 'Account Created - Local Cooks Community',
    html
  };
};

// Helper function to get the correct website URL based on environment
const getWebsiteUrl = (): string => {
  // Use environment variable if set, otherwise use the configured domain
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // For production, use the actual domain
  const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
  if (domain && domain !== 'auto-sync.local') {
    return `https://${domain}`;
  }
  
  // Fallback for development
  return process.env.NODE_ENV === 'production' 
    ? 'https://local-cooks-community.vercel.app' 
    : 'http://localhost:5000';
};

// Helper function to get the correct dashboard URL
const getDashboardUrl = (): string => {
  const baseUrl = getWebsiteUrl();
  return `${baseUrl}/auth?redirect=/dashboard`;
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
  };

  const subject = userData.subject || `🎁 Exclusive Promo Code: ${userData.promoCode}`;
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
      border: ${
        userData.promoCodeStyling?.borderWidth || userData.promoCodeStyling?.borderStyle || userData.promoCodeStyling?.borderColor 
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
      border-radius: ${
        userData.header?.styling?.borderRadius || 
        (userData.emailContainer?.borderRadius ? 
          `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
          '12px 12px 0 0')
      };
      -webkit-border-radius: ${
        userData.header?.styling?.borderRadius || 
        (userData.emailContainer?.borderRadius ? 
          `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
          '12px 12px 0 0')
      };
      -moz-border-radius: ${
        userData.header?.styling?.borderRadius || 
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
        border-radius: ${
          userData.header?.styling?.borderRadius || 
          (userData.emailContainer?.borderRadius ? 
            `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
            '12px 12px 0 0')
        } !important;
        -webkit-border-radius: ${
          userData.header?.styling?.borderRadius || 
          (userData.emailContainer?.borderRadius ? 
            `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
            '12px 12px 0 0')
        } !important;
        -moz-border-radius: ${
          userData.header?.styling?.borderRadius || 
          (userData.emailContainer?.borderRadius ? 
            `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
            '12px 12px 0 0')
        } !important;
        border-top-left-radius: ${
          userData.emailContainer?.borderRadius || '12px'
        } !important;
        border-top-right-radius: ${
          userData.emailContainer?.borderRadius || '12px'
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
      border-radius: ${
        userData.header?.styling?.borderRadius || 
        (userData.emailContainer?.borderRadius ? 
          `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
          '12px 12px 0 0')
      };
      -webkit-border-radius: ${
        userData.header?.styling?.borderRadius || 
        (userData.emailContainer?.borderRadius ? 
          `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : 
          '12px 12px 0 0')
      };
      -moz-border-radius: ${
        userData.header?.styling?.borderRadius || 
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
