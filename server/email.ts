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

// Create a transporter with enhanced configuration for spam prevention
const createTransporter = (config: EmailConfig) => {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
    // Enhanced configuration for better deliverability
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
      ciphers: 'SSLv3'
    },
    connectionTimeout: 60000, // 60 seconds
    greetingTimeout: 30000, // 30 seconds
    socketTimeout: 60000, // 60 seconds
    // Add authentication method
    authMethod: 'PLAIN',
    // Enable debug for troubleshooting
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
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

// Enhanced send email function with spam prevention
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
      domain: getDomainFromEmail(config.auth.user),
      organization: getOrganizationName(),
      hasEmailFrom: !!process.env.EMAIL_FROM
    });

    const transporter = createTransporter(config);

    // Enhanced from address with proper formatting using Vercel environment variables
    const fromName = getOrganizationName();
    const fromEmail = process.env.EMAIL_FROM || `${fromName} <${config.auth.user}>`;

    // Verify SMTP connection
    try {
      await new Promise((resolve, reject) => {
        transporter.verify((error: any, success: any) => {
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

    // Get domain and other configuration from Vercel environment variables
    const domain = getDomainFromEmail(config.auth.user);
    const unsubscribeEmail = getUnsubscribeEmail();
    const organizationName = getOrganizationName();

    // Enhanced email options with spam prevention headers
    const mailOptions = {
      from: fromEmail,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      // Anti-spam headers
      headers: {
        'X-Mailer': `${organizationName} Platform`,
        'X-Priority': '3', // Normal priority
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal',
        'List-Unsubscribe': `<mailto:${unsubscribeEmail}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        // Authentication headers
        'Message-ID': `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`,
        'Date': new Date().toUTCString(),
        // Content classification
        'Content-Type': 'text/html; charset=UTF-8',
        'MIME-Version': '1.0',
        // Sender reputation
        'Organization': organizationName,
        'X-Sender': fromEmail,
        'Return-Path': config.auth.user,
        // Prevent auto-replies
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated'
      },
      // Enhanced delivery options
      envelope: {
        from: config.auth.user,
        to: content.to
      },
      // Tracking and analytics
      messageId: `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`,
      date: new Date()
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);

    console.log('Email sent successfully:', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
      domain: domain,
      organization: organizationName,
      fromEmail: fromEmail
    });
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      if ('code' in error) {
        console.error('Error code:', (error as any).code);
      }
      if ('responseCode' in error) {
        console.error('SMTP Response code:', (error as any).responseCode);
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
  if (process.env.EMAIL_UNSUBSCRIBE) {
    return process.env.EMAIL_UNSUBSCRIBE;
  }
  
  const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
  return `unsubscribe@${domain}`;
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
    padding: 32px 24px; 
    text-align: center; 
  }
  .logo-container {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .logo-image {
    height: 40px;
    width: auto;
  }
  .logo-text {
    font-family: 'Lobster', cursive;
    font-size: 32px;
    font-weight: normal;
    margin: 0;
    letter-spacing: -0.5px;
    color: white;
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
  .cta-button { 
    display: inline-block; 
    padding: 14px 28px; 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white; 
    text-decoration: none; 
    border-radius: 8px; 
    font-weight: 600;
    margin: 24px 0;
    box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
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
      under_review: `Your application is currently under review by our team.`,
      pending: `Your application has been received and is pending review.`
    };

    return `Hello ${fullName},

${statusMessages[status as keyof typeof statusMessages] || 'Your application status has been updated.'}

Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

Thank you for your interest in Local Cooks Community.

 If you have any questions, please contact us at ${getUnsubscribeEmail().replace('unsubscribe@', 'support@')}.

Best regards,
Local Cooks Community Team

---
This is an automated message from Local Cooks Community.
Visit: https://local-cooks-community.vercel.app
`;
  };

  const getMessage = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Congratulations! Your application has been approved. You can now proceed to the next steps in your Local Cooks journey.';
      case 'rejected':
        return 'Thank you for your application. After careful review, we are unable to move forward with your application at this time. We appreciate your interest in Local Cooks.';
      case 'under_review':
        return 'Your application is currently under review by our team. We will notify you once the review is complete.';
      case 'pending':
        return 'Your application has been received and is pending review. We will contact you with updates soon.';
      default:
        return 'Your application status has been updated. Please check your dashboard for more details.';
    }
  };

  const message = getMessage(applicationData.status);

  // Simplified, professional HTML template
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        ${message}
      </p>
      <div class="status-badge">Status: ${applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1)}</div>
      
      ${applicationData.status === 'approved' ? `
      <a href="https://local-cooks-community.vercel.app/auth?redirect=/dashboard" class="cta-button">Access Your Dashboard</a>
      ` : ''}
      
      <p class="message">
        If you have any questions, please contact us at 
        <a href="mailto:${getUnsubscribeEmail().replace('unsubscribe@', 'support@')}">${getUnsubscribeEmail().replace('unsubscribe@', 'support@')}</a>
      </p>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in Local Cooks Community!</p>
      <div class="footer-links">
        <a href="https://local-cooks-community.vercel.app">Visit our website</a> • 
        <a href="mailto:${getUnsubscribeEmail().replace('unsubscribe@', 'support@')}">Contact Support</a>
      </div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>
  `;

  return {
    to: applicationData.email,
    subject,
    text: generatePlainText(applicationData.status, applicationData.fullName),
    html,
  };
};

// Generate vendor login credentials
const generateVendorCredentials = (fullName: string, phone: string) => {
  const username = phone.replace(/[^0-9]/g, ''); // Clean phone number
  const namePrefix = fullName.replace(/[^a-zA-Z]/g, '').toLowerCase().substring(0, 3) || 'usr';
  const phoneSuffix = phone.replace(/[^0-9]/g, '').slice(-4) || '0000';
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
  <title>🎉 You're Fully Verified! Here are your Vendor Login Credentials</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Congratulations ${userData.fullName}!</h2>
      <p class="message">
        🎊 Your documents have been approved and you are now <strong>fully verified</strong>! You can now start accepting orders and serving customers through our Local Cooks platform.
      </p>
      <div class="status-badge approved">Status: Approved ✓</div>
      
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
      
      <a href="${process.env.VENDOR_DASHBOARD_URL || 'https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php'}" class="cta-button">Access Vendor Login →</a>
      
      <div class="divider"></div>
      
      <div class="info-box">
        <strong>🚀 What's Next?</strong>
        <ul style="margin: 12px 0 0 0; padding-left: 20px;">
          <li>Click the "Access Vendor Login" button above or visit the link provided - you'll be automatically redirected to setup after login</li>
          <li><strong>Set up your Stripe payment profile</strong> for secure payment processing (you'll be guided through this automatically)</li>
          <li>Complete your vendor profile and add your menu items</li>
          <li>Set up your shop preferences and availability</li>
          <li>Start accepting orders from hungry customers!</li>
          <li><strong>Remember to change your password after first login</strong></li>
        </ul>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks</strong> verified vendor community!</p>
      <div class="footer-links">
        <a href="mailto:${process.env.VENDOR_SUPPORT_EMAIL || 'support@localcooks.shop'}">vendor support</a>
      </div>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: '🎉 You\'re Fully Verified! Here are your Vendor Login Credentials',
    html,
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <p class="footer-text">Thank you for your interest in <a href="https://localcooks.ca" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: applicationData.email,
    subject: 'Application and Documents Received - Under Review',
    html,
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <p class="footer-text">Thank you for your interest in <a href="https://localcooks.ca" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: applicationData.email,
    subject: 'Local Cooks Application Confirmation - Next Steps',
    html,
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <a href="https://local-cooks-community.vercel.app/auth?redirect=/dashboard" class="cta-button">Track Application Status</a>
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
Application Received - ${organizationName}

Hello ${applicationData.fullName},

Thank you for submitting your application to join ${organizationName}. We've received your application and our team will review it shortly.

Status: Under Review

What happens next?
Our team typically reviews applications within 2-3 business days. You'll receive an email notification once we've made a decision.

Track your application status: https://local-cooks-community.vercel.app/auth?redirect=/dashboard

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
 
 export async function sendApplicationApprovedEmail(userData: any, username: string, password: string) {
  const supportEmail = getSupportEmail();
  const organizationName = getOrganizationName();
  
  const subject = `Application Approved - ${organizationName}`;
  
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Congratulations ${userData.fullName}!</h2>
      <p class="message">
        We're excited to inform you that your application has been approved! 
        Welcome to the ${organizationName}.
      </p>
      <div class="status-badge approved">Status: Approved ✓</div>
      
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
      
      <a href="https://local-cooks-community.vercel.app/auth?redirect=/dashboard" class="cta-button">Access Your Dashboard</a>
      
      <div class="divider"></div>
      
      <div class="info-box">
        <strong>🚀 What's Next?</strong>
        <ul style="margin: 12px 0 0 0; padding-left: 20px;">
          <li>Log in to your dashboard using the credentials above</li>
          <li>Complete your profile setup</li>
          <li>Start managing your cook profile</li>
          <li>Connect with the community</li>
        </ul>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to ${organizationName}!</p>
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
Application Approved - ${organizationName}

Congratulations ${userData.fullName}!

We're excited to inform you that your application has been approved! Welcome to the ${organizationName}.

Status: Approved ✓

Your Login Credentials:
Username: ${username}
Password: ${password}

IMPORTANT: Please change your password after your first login for security.

Access your dashboard: https://local-cooks-community.vercel.app/auth?redirect=/dashboard

What's Next?
- Log in to your dashboard using the credentials above
- Complete your profile setup
- Start managing your cook profile
- Connect with the community

Welcome to ${organizationName}!

If you have any questions, contact us at ${supportEmail}

© ${new Date().getFullYear()} ${organizationName}
`;

     return sendEmail({
     to: userData.email,
     subject,
     html: htmlContent,
     text: textContent
   });
 }
 
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      
      <a href="https://local-cooks-community.vercel.app/apply" class="cta-button">Learn About Requirements</a>
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

// Generate password reset email
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
  <title>🔒 Password Reset Request - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        We received a request to reset your password for your Local Cooks account. If you didn't make this request, you can safely ignore this email.
      </p>
      
      <div class="info-box">
        <strong>🔐 Reset Your Password</strong><br>
        Click the button below to create a new password. This link will expire in 1 hour for security.
      </div>
      
      <a href="${userData.resetUrl}" class="cta-button" style="display: inline-block; margin: 20px 0;">
        Reset My Password
      </a>
      
      <div class="warning-box">
        <p class="warning-text">
          <strong>Security Notice:</strong> If you didn't request this password reset, please contact our support team immediately.
        </p>
      </div>
      
      <div class="divider"></div>
      
      <div class="info-box">
        <strong>Need Help?</strong><br>
        If you're having trouble with the button above, copy and paste this link into your browser:<br>
        <a href="${userData.resetUrl}" style="word-break: break-all; color: #3b82f6;">${userData.resetUrl}</a>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Keep your account secure with <strong>Local Cooks</strong></p>
      <div class="footer-links">
        <a href="mailto:${process.env.EMAIL_USER?.replace('noreply@', 'support@') || 'support@localcooks.shop'}">contact support</a>
      </div>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: '🔒 Password Reset Request - Local Cooks',
    html,
  };
};

// Generate email verification email
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
  <title>✨ Verify Your Email - Welcome to Local Cooks!</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Welcome ${userData.fullName}! 🎉</h2>
      <p class="message">
        Thank you for joining Local Cooks Community! We're excited to have you on board. To complete your registration and unlock your learning journey, please verify your email address.
      </p>
      
      <div class="info-box">
        <strong>✅ Verify Your Email</strong><br>
        Click the button below to verify your email address and activate your account.
      </div>
      
      <a href="${userData.verificationUrl}" class="cta-button" style="display: inline-block; margin: 20px 0;">
        Verify My Email
      </a>
      
      <div class="info-box">
        <strong>🚀 What's Next?</strong>
        <ul style="margin: 12px 0 0 0; padding-left: 20px;">
          <li>Complete your profile setup</li>
          <li>Start your food safety training modules</li>
          <li>Apply to become a verified cook</li>
          <li>Join our growing community!</li>
        </ul>
      </div>
      
      <div class="divider"></div>
      
      <div class="info-box">
        <strong>Need Help?</strong><br>
        If you're having trouble with the button above, copy and paste this link into your browser:<br>
        <a href="${userData.verificationUrl}" style="word-break: break-all; color: #3b82f6;">${userData.verificationUrl}</a>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks</strong> community!</p>
      <div class="footer-links">
        <a href="mailto:${process.env.EMAIL_USER?.replace('noreply@', 'support@') || 'support@localcooks.shop'}">contact support</a>
      </div>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: userData.email,
    subject: '✨ Verify Your Email - Welcome to Local Cooks!',
    html,
  };
};

// Generate welcome email for new Google sign-up users (SPAM-OPTIMIZED VERSION)
export const generateWelcomeEmail = (
  userData: {
    fullName: string;
    email: string;
  }
): EmailContent => {
  const supportEmail = getSupportEmail();
  
  // Generate plain text version for better deliverability (CRITICAL FOR GMAIL)
  const textContent = `
Account Status Update - Local Cooks Community

Hello ${userData.fullName},

Your Local Cooks Community account has been successfully created and verified.

Status: Account Active

You can now access your dashboard to complete your profile and begin your application process.

Access your dashboard: https://local-cooks-community.vercel.app/dashboard

If you have any questions about your account or need assistance, please contact our support team at ${supportEmail}.

Best regards,
Local Cooks Community Team

---
This is an automated message from Local Cooks Community.
Visit: https://local-cooks-community.vercel.app
`;

  // Simplified HTML template matching working application emails
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Status Update - Local Cooks Community</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        Your Local Cooks Community account has been successfully created and verified. You can now access your dashboard to begin your application process.
      </p>
      <div class="status-badge">Status: Account Active</div>
      
      <a href="https://local-cooks-community.vercel.app/dashboard" class="cta-button">Access Your Dashboard</a>
      
      <p class="message">
        If you have any questions, please contact us at 
        <a href="mailto:${supportEmail}">${supportEmail}</a>
      </p>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in Local Cooks Community!</p>
      <div class="footer-links">
        <a href="https://local-cooks-community.vercel.app">Visit our website</a> • 
        <a href="mailto:${supportEmail}">Contact Support</a>
      </div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>
  `;

  return {
    to: userData.email,
    subject: 'Account Status Update - Local Cooks Community', // Changed from promotional subject
    text: textContent, // CRITICAL: Added plain text version
    html,
  };
};
