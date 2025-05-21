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
export const sendEmail = async (content: EmailContent): Promise<boolean> => {
  try {
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

  const { subject, message } = statusMessages[applicationData.status] || {
    subject: 'Update on Your Application Status',
    message: `Your application status has been updated to: ${applicationData.status}`,
  };

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Hello ${applicationData.fullName},</h2>
      <p>${message}</p>
      <p>Your application status is now: <strong>${applicationData.status}</strong></p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea;">
        <p style="color: #666;">Thank you for your interest in Local Cooks!</p>
        <p style="color: #666;">If you have any questions, please contact us.</p>
      </div>
    </div>
  `;

  return {
    to: applicationData.email,
    subject,
    html,
  };
};
