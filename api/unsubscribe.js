/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * The unsubscribe functionality has been moved to server/routes.ts as part of the unified entry point.
 * All API requests now route through api/index.js (bundled from server/index.ts).
 * 
 * This file is kept temporarily for backward compatibility but should not be used.
 * The route is now available at: POST /api/unsubscribe (handled by server/routes.ts)
 */
// Unsubscribe API endpoint for Vercel
import { Pool } from '@neondatabase/serverless';

// Database connection
let pool;
try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1
    });

    // Create unsubscribe_requests table if it doesn't exist
    pool.query(`
      CREATE TABLE IF NOT EXISTS unsubscribe_requests (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        feedback TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(err => {
      console.log('Table creation skipped (may already exist):', err.message);
    });
  }
} catch (error) {
  console.error('Database connection error:', error);
}

// Use the same email functionality as promo emails
async function sendEmailUsingServerFunction(emailContent, options = {}) {
  try {
    // Import the same email function used by promo emails
    const { sendEmail } = await import('../server/email.js');

    console.log('📧 Sending email using server email function:', {
      to: emailContent.to,
      subject: emailContent.subject,
      trackingId: options.trackingId
    });

    // Use the same sendEmail function as promo emails
    const result = await sendEmail(emailContent, options);

    if (result) {
      console.log('✅ Email sent successfully via server function');
    } else {
      console.error('❌ Email sending failed via server function');
    }

    return result;
  } catch (error) {
    console.error('Email sending error:', error);
    return false;
  }
}

export default async function handler(req, res) {
  // Set CORS headers for cross-origin requests
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://local-cooks-community.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000'
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, reason, feedback, timestamp } = req.body;

    console.log('Unsubscribe request received:', {
      email: email ? email.replace(/(.{3}).*@/, '$1***@') : 'missing',
      reason: reason || 'not specified',
      hasFeedback: !!feedback,
      timestamp: timestamp || 'not provided',
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin
    });

    if (!email) {
      console.error('Unsubscribe request missing email address');
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('Invalid email format:', email);
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    console.log(`✅ Processing unsubscribe request for: ${email}`);

    // Store unsubscribe request in database
    if (pool) {
      try {
        await pool.query(
          'INSERT INTO unsubscribe_requests (email, reason, feedback, created_at) VALUES ($1, $2, $3, NOW())',
          [email, reason || 'Not specified', feedback || null]
        );
        console.log('✅ Unsubscribe request stored in database');
      } catch (dbError) {
        console.log('Database storage failed:', dbError.message);
      }
    }

    // Create unsubscribe notification email content
    const unsubscribeNotificationContent = {
      to: 'localcooks@localcook.shop',
      subject: `🚫 Unsubscribe Request - ${email}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks - Unsubscribe Request</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; margin-top: 0;">New Unsubscribe Request</h2>
            
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #dc2626; font-weight: 600;">
                📧 Email: <span style="font-weight: normal;">${email}</span>
              </p>
            </div>
            
            <div style="margin: 20px 0;">
              <h3 style="color: #374151; margin-bottom: 10px;">Request Details:</h3>
              <ul style="color: #6b7280; line-height: 1.6;">
                <li><strong>Timestamp:</strong> ${new Date(timestamp || Date.now()).toLocaleString()}</li>
                <li><strong>Reason:</strong> ${reason || 'Not specified'}</li>
                ${feedback ? `<li><strong>Feedback:</strong> ${feedback}</li>` : ''}
              </ul>
            </div>
            
            <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 6px; padding: 15px; margin: 20px 0;">
              <h4 style="color: #0369a1; margin: 0 0 10px 0;">Action Required:</h4>
              <p style="color: #0c4a6e; margin: 0; font-size: 14px;">
                Please manually remove <strong>${email}</strong> from all email lists and marketing databases within 24 hours.
              </p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                This is an automated notification from the Local Cooks unsubscribe system.
              </p>
            </div>
          </div>
        </div>
      `,
      text: `
        Local Cooks - Unsubscribe Request
        
        New unsubscribe request received:
        
        Email: ${email}
        Timestamp: ${new Date(timestamp || Date.now()).toLocaleString()}
        Reason: ${reason || 'Not specified'}
        ${feedback ? `Feedback: ${feedback}` : ''}
        
        ACTION REQUIRED: Please manually remove ${email} from all email lists and marketing databases within 24 hours.
      `
    };

    // Send notification email to admin
    const emailSent = await sendEmailUsingServerFunction(unsubscribeNotificationContent, {
      trackingId: `unsubscribe_${email}_${Date.now()}`
    });

    if (!emailSent) {
      console.error('Failed to send unsubscribe notification email');
      return res.status(500).json({
        success: false,
        message: 'Failed to process unsubscribe request'
      });
    }

    // Send confirmation email to user
    const userConfirmationContent = {
      to: email,
      subject: 'Local Cooks - Unsubscribe Request Received',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks</h1>
            <p style="color: white; margin: 5px 0 0 0; opacity: 0.9;">Unsubscribe Confirmation</p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; margin-top: 0;">We've Received Your Request</h2>
            
            <p style="color: #374151; line-height: 1.6;">
              Hi there,
            </p>
            
            <p style="color: #374151; line-height: 1.6;">
              We've received your request to unsubscribe from our email communications. We're sorry to see you go!
            </p>
            
            <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #0c4a6e;">
                <strong>What happens next:</strong><br>
                Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
              </p>
            </div>
            
            <p style="color: #374151; line-height: 1.6;">
              If you have any questions or if this was done in error, please don't hesitate to contact us at 
              <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>.
            </p>
            
            <p style="color: #374151; line-height: 1.6;">
              Thank you for being part of the Local Cooks community!
            </p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Local Cooks Team<br>
                <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>
              </p>
            </div>
          </div>
        </div>
      `,
      text: `
        Local Cooks - Unsubscribe Confirmation
        
        Hi there,
        
        We've received your request to unsubscribe from our email communications. We're sorry to see you go!
        
        What happens next:
        Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
        
        If you have any questions or if this was done in error, please contact us at localcooks@localcook.shop.
        
        Thank you for being part of the Local Cooks community!
        
        Local Cooks Team
        localcooks@localcook.shop
      `
    };

    // Send confirmation to user
    await sendEmailUsingServerFunction(userConfirmationContent, {
      trackingId: `unsubscribe_confirmation_${email}_${Date.now()}`
    });

    console.log(`✅ Unsubscribe request processed for: ${email}`);

    res.json({
      success: true,
      message: 'Unsubscribe request processed successfully'
    });

  } catch (error) {
    console.error('Error processing unsubscribe request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}