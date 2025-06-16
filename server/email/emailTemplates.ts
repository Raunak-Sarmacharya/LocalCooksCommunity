import { EmailContent } from './emailService';
import { getUniformEmailStyles } from './emailStyles';
import { getDashboardUrl, getSupportEmail, getUnsubscribeEmail, getVendorDashboardUrl, getWebsiteUrl } from './emailUtils';

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

${status === 'approved' ? `Access your dashboard: ${getDashboardUrl()}` : ''}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">${message}</p>
      <div class="status-badge${applicationData.status === 'approved' ? ' approved' : applicationData.status === 'rejected' ? ' rejected' : ''}">
        Status: ${applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1)}
      </div>
      ${applicationData.status === 'approved' ? `<a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>` : ''}
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
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
  <title>Vendor Account Approved - Login Credentials Included</title>
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
      
      <div style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
        <a href="https://localcook.shop/app/shop/index.php" class="cta-button" style="flex: 1; min-width: 200px; background: #2563eb; color: white !important;">
          🏪 Access Vendor Account
        </a>
        <a href="${getVendorDashboardUrl()}" class="cta-button" style="flex: 1; min-width: 200px; background: #16a34a; color: white !important;">
          💳 Set Up Stripe Payments
        </a>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          <strong>🏪 Vendor Account:</strong> Use your credentials above to log into your vendor dashboard where you can manage your profile, products, and orders.
          <br><br>
          <strong>💳 Stripe Payments:</strong> Set up your payment processing to start receiving payments from customers. This is required to get paid for orders.
        </p>
      </div>
      
      <div class="divider"></div>
      
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks</strong> verified vendor community!</p>
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${new Date().getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;

    return {
        to: userData.email,
        subject: 'Vendor Account Approved - Login Credentials Included',
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
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
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
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
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
        html
    };
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
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
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
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
      <div class="logo-container">
        <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" alt="Local Cooks Logo" class="logo-image" />
        <h1 class="logo-text">Local Cooks</h1>
      </div>
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
      <p class="footer-text">If you have any questions, just reply to this email or contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
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