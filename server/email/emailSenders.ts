import { sendEmail } from './emailService';
import { getSupportEmail, getWebsiteUrl, getPrivacyUrl } from './emailUtils';
import { getUniformEmailStyles } from './emailStyles';

export async function sendApplicationReceivedEmail(applicationData: any) {
    const supportEmail = getSupportEmail();
    const organizationName = 'Local Cooks Community';

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
      <a href="${getWebsiteUrl()}/dashboard" class="cta-button" style="color: white !important; text-decoration: none !important;">Track Application Status</a>
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

Track your application status: ${getWebsiteUrl()}/dashboard

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

export async function sendApplicationRejectedEmail(applicationData: any, reason?: string) {
    const supportEmail = getSupportEmail();
    const organizationName = 'Local Cooks Community';

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