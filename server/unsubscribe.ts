import { Request, Response } from 'express';
import { sendEmail } from './email.js';

interface UnsubscribeRequest {
  email: string;
  reason?: string;
  feedback?: string;
  timestamp: string;
}

export const handleUnsubscribeRequest = async (req: Request, res: Response) => {
  try {
    const { email, reason, feedback, timestamp }: UnsubscribeRequest = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email address is required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
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
                <li><strong>Timestamp:</strong> ${new Date(timestamp).toLocaleString()}</li>
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
        Timestamp: ${new Date(timestamp).toLocaleString()}
        Reason: ${reason || 'Not specified'}
        ${feedback ? `Feedback: ${feedback}` : ''}
        
        ACTION REQUIRED: Please manually remove ${email} from all email lists and marketing databases within 24 hours.
      `
    };

    // Send notification email to admin
    const emailSent = await sendEmail(unsubscribeNotificationContent, {
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

    // Send confirmation to user (optional - they might not want more emails)
    await sendEmail(userConfirmationContent, {
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
};