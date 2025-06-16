import nodemailer from 'nodemailer';
import { getDomainFromEmail, getOrganizationName, getUnsubscribeEmail } from './emailUtils';

// Email configuration
export interface EmailConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    }
}

// Email content
export interface EmailContent {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
}

// Add email tracking to prevent duplicates
const recentEmails = new Map<string, number>();
const DUPLICATE_PREVENTION_WINDOW = 30000; // 30 seconds

// Create a transporter with enhanced configuration for spam prevention
export const createTransporter = (config: EmailConfig) => {
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
export const getEmailConfig = (): EmailConfig => {
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

        // Simplified email options to prevent encoding issues
        const mailOptions = {
            from: fromEmail,
            to: content.to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            // Minimal headers to avoid spam filters
            headers: {
                'Organization': organizationName,
                // Merge any additional headers from content
                ...(content.headers || {})
            },
            // Proper encoding settings
            encoding: 'utf8' as const,
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
            messageId: (info as any).messageId,
            accepted: (info as any).accepted,
            rejected: (info as any).rejected,
            response: (info as any).response,
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