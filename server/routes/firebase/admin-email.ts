import { logger } from "../../logger";
import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { users } from '@shared/schema';
import { and, isNotNull, ne } from 'drizzle-orm';

const router = Router();

// 🔥 Admin Flexible Email Endpoint (Firebase Auth + Admin Role)
router.post('/admin/send-company-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        logger.info(`🔥 POST /api/admin/send-company-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

        const {
            emailType = 'general', // 'promotional', 'general', 'announcement', 'newsletter'
            emailMode,
            recipients,
            promoCode, // Optional for non-promotional emails
            promoCodeLabel,
            message,
            customMessage,
            greeting,
            subject,
            previewText,
            header,
            footer,
            orderButton,
            usageSteps,
            emailContainer,
            dividers,
            promoCodeStyling,
            promoStyle,
            sections,
            customDesign
        } = req.body;

        // Validate required fields
        const messageContent = customMessage || message;
        if (!messageContent || messageContent.length < 10) {
            logger.info('🔥 Company email request - Invalid message:', {
                customMessage: customMessage?.substring(0, 50),
                message: message?.substring(0, 50),
                messageLength: messageContent?.length
            });
            return res.status(400).json({ error: 'Message content is required (minimum 10 characters)' });
        }

        // For promotional emails, require promo code
        if (emailType === 'promotional' && !promoCode) {
            logger.info('🔥 Company email request - Missing promo code for promotional email');
            return res.status(400).json({ error: 'Promo code is required for promotional emails' });
        }

        // Parse recipients
        let targetEmails: string[] = [];
        if (emailMode === 'all') {
            // Get all user emails from database
            try {
                const result = await db
                    .select({ email: users.username })
                    .from(users)
                    .where(
                        and(
                            isNotNull(users.username),
                            ne(users.username, '')
                        )
                    );
                targetEmails = result.map(row => row.email as string);
            } catch (error) {
                logger.error('🔥 Error fetching user emails:', error);
                return res.status(500).json({ error: 'Failed to fetch user emails' });
            }
        } else if (emailMode === 'custom' && recipients) {
            const customEmails = recipients.split(',').map((email: string) => email.trim()).filter((email: string) => email.length > 0);
            targetEmails = customEmails;
        } else {
            return res.status(400).json({ error: 'Invalid email mode or recipients' });
        }

        // Validate that we have at least one email
        if (targetEmails.length === 0) {
            logger.info('🔥 Company email request - No valid email addresses provided');
            return res.status(400).json({ error: 'At least one email address is required' });
        }

        logger.info(`🔥 Admin ${req.neonUser?.username} sending ${emailType} email to ${targetEmails.length} recipient(s)`);

        // Import the email functions
        const { sendEmail, generatePromoCodeEmail } = await import('../../email');

        // Send emails to all recipients
        const results: Array<{ email: string; status: string; error?: string }> = [];
        let successCount = 0;
        let failureCount = 0;

        for (const targetEmail of targetEmails) {
            try {
                // Generate flexible email for each recipient
                const emailContent = generatePromoCodeEmail({
                    email: targetEmail,
                    promoCode,
                    promoCodeLabel: promoCodeLabel || '🎁 Special Offer Code For You',
                    customMessage: messageContent,
                    greeting: greeting || 'Hello! 👋',
                    subject: subject || `🎁 Special Offer: ${promoCode}`,
                    previewText,
                    header: header || {
                        title: 'Special Offer Just For You!',
                        subtitle: 'Don\'t miss out on this exclusive deal'
                    },
                    footer,
                    orderButton: orderButton || {
                        text: '🌟 Start Shopping Now',
                        url: 'https://localcooks.ca'
                    },
                    usageSteps: usageSteps || {
                        enabled: true,
                        title: '🚀 How to use your offer:',
                        steps: [
                            `Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>`,
                            'Browse our amazing local cooks and their delicious offerings',
                            promoCode ? 'Apply your promo code during checkout' : 'Complete your order',
                            'Enjoy your special offer!'
                        ]
                    },
                    emailContainer: emailContainer || {
                        maxWidth: '600px',
                        backgroundColor: '#f1f5f9',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                        opacity: '1'
                    },
                    dividers,
                    promoCodeStyling,
                    promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
                    sections
                });

                // Send email
                const emailSent = await sendEmail(emailContent, {
                    trackingId: `promo_email_${targetEmail}_${Date.now()}`
                });

                if (emailSent) {
                    logger.info(`🔥 ${emailType} email sent successfully to ${targetEmail}`);
                    results.push({ email: targetEmail, status: 'success' });
                    successCount++;
                } else {
                    logger.error(`🔥 Failed to send ${emailType} email to ${targetEmail}`);
                    results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
                    failureCount++;
                }
            } catch (error) {
                logger.error(`🔥 Error sending ${emailType} email to ${targetEmail}:`, error);
                results.push({ email: targetEmail, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
                failureCount++;
            }
        }

        // Return results
        if (successCount > 0) {
            res.json({
                success: true,
                message: `${emailType} emails sent: ${successCount} successful, ${failureCount} failed`,
                emailType,
                results: results,
                summary: {
                    total: targetEmails.length,
                    successful: successCount,
                    failed: failureCount
                }
            });
        } else {
            res.status(500).json({
                error: 'All email sending failed',
                message: `Failed to send ${emailType} emails to any recipients.`,
                results: results
            });
        }
    } catch (error) {
        logger.error('🔥 Error sending company email:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
});

// 🔥 Admin Promo Email Endpoint (Firebase Auth + Admin Role) - Backward Compatibility
router.post('/admin/send-promo-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        logger.info(`🔥 POST /api/admin/send-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

        const {
            email,
            customEmails,
            emailMode,
            promoCode,
            customMessage,
            message,
            promoCodeLabel,
            greeting,
            recipientType,
            designSystem,
            isPremium,
            sections,
            orderButton,
            header,
            footer,
            usageSteps,
            emailContainer,
            subject,
            previewText,
            promoStyle,
            promoCodeStyling,
            buttonText,
            orderUrl
        } = req.body;

        // Handle both customMessage and message fields (different frontend components use different names)
        const messageContent = customMessage || message;

        // Validate required fields based on email mode
        if (emailMode === 'custom') {
            if (!customEmails || !Array.isArray(customEmails) || customEmails.length === 0) {
                logger.info('Promo email request - Missing custom emails');
                return res.status(400).json({ error: 'At least one email address is required' });
            }
        } else {
            if (!email) {
                logger.info('Promo email request - Missing email');
                return res.status(400).json({ error: 'Email is required' });
            }
        }

        // Promo code is now optional - if empty, it will be a general company email
        if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
            logger.info('🔥 Promo email request - Invalid promo code length');
            return res.status(400).json({ error: 'Promo code must be at least 3 characters long if provided' });
        }

        if (!messageContent || messageContent.length < 10) {
            logger.info('Promo email request - Invalid message:', {
                customMessage: customMessage?.substring(0, 50),
                message: message?.substring(0, 50),
                messageContent: messageContent?.substring(0, 50)
            });
            return res.status(400).json({ error: 'Message must be at least 10 characters' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailMode === 'custom') {
            // Validate all custom emails
            for (const customEmail of customEmails) {
                if (!emailRegex.test(customEmail)) {
                    return res.status(400).json({
                        error: 'Invalid email',
                        message: `Please provide a valid email address: ${customEmail}`
                    });
                }
            }
        } else {
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    error: 'Invalid email',
                    message: 'Please provide a valid email address'
                });
            }
        }

        // Validate promo code only if provided (basic validation - alphanumeric, length check)
        if (promoCode && promoCode.length > 0 && (promoCode.length < 3 || promoCode.length > 50)) {
            return res.status(400).json({
                error: 'Invalid promo code',
                message: 'Promo code must be between 3 and 50 characters'
            });
        }

        // Validate message length
        if (messageContent.length > 1000) {
            return res.status(400).json({
                error: 'Invalid message',
                message: 'Message must be less than 1000 characters'
            });
        }

        // Determine target emails
        const targetEmails = emailMode === 'custom' ? customEmails : [email];
        logger.info(`🔥 Admin ${req.neonUser?.username} sending promo email to ${targetEmails.length} recipient(s) with code: ${promoCode}`);

        // Import the email functions
        const { sendEmail, generatePromoCodeEmail } = await import('../../email');

        // Send emails to all recipients
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const targetEmail of targetEmails) {
            try {
                // Generate the promo email with custom message and styling for each recipient
                const emailContent = generatePromoCodeEmail({
                    email: targetEmail,
                    promoCode: promoCode.trim(),
                    customMessage: messageContent.trim(),
                    greeting: greeting,
                    promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
                    promoCodeStyling: promoCodeStyling,
                    designSystem: designSystem,
                    isPremium: isPremium || false,
                    sections: sections || [],
                    orderButton: orderButton || {
                        text: buttonText || 'Get Started',
                        url: orderUrl || 'https://localcooks.ca',
                        styling: {
                            backgroundColor: '#F51042',
                            color: '#ffffff',
                            fontSize: '16px',
                            fontWeight: '600',
                            padding: '12px 24px',
                            borderRadius: '8px',
                            textAlign: 'center'
                        }
                    },
                    header: header || {
                        title: 'Local Cooks Header',
                        subtitle: 'Premium Quality Food Subheader',
                        styling: {
                            backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                            titleColor: '#ffffff',
                            subtitleColor: '#ffffff',
                            titleFontSize: '32px',
                            subtitleFontSize: '18px',
                            padding: '24px',
                            borderRadius: '0px',
                            textAlign: 'center'
                        }
                    },
                    footer: footer || {
                        mainText: 'Thank you for being part of the Local Cooks community!',
                        contactText: 'Questions? Contact us at support@localcooks.com',
                        copyrightText: '© 2024 Local Cooks. All rights reserved.',
                        showContact: true,
                        showCopyright: true,
                        styling: {
                            backgroundColor: '#f8fafc',
                            textColor: '#64748b',
                            linkColor: '#F51042',
                            fontSize: '14px',
                            padding: '24px 32px',
                            textAlign: 'center',
                            borderColor: '#e2e8f0'
                        }
                    },
                    usageSteps: usageSteps || {
                        title: '🚀 How to use your promo code:',
                        steps: [
                            `Visit our website: <a href="${orderUrl || 'https://localcooks.ca'}" style="color: #1d4ed8;">${orderUrl || 'https://localcooks.ca'}</a>`,
                            'Browse our amazing local cooks and their delicious offerings',
                            'Apply your promo code during checkout',
                            'Enjoy your special offer!'
                        ],
                        enabled: true,
                        styling: {
                            backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                            borderColor: '#93c5fd',
                            titleColor: '#1d4ed8',
                            textColor: '#1e40af',
                            linkColor: '#1d4ed8',
                            padding: '20px',
                            borderRadius: '8px'
                        }
                    },
                    emailContainer: emailContainer || {
                        maxWidth: '600px',
                        backgroundColor: '#f1f5f9',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
                    },
                    dividers: {
                        enabled: true,
                        style: 'solid',
                        color: '#e2e8f0',
                        thickness: '1px',
                        margin: '24px 0',
                        opacity: '1'
                    },
                    subject: subject,
                    previewText: previewText,
                    promoCodeLabel: promoCodeLabel
                });

                // Send the email
                const emailSent = await sendEmail(emailContent, {
                    trackingId: `promo_custom_${targetEmail}_${promoCode}_${Date.now()}`
                });

                if (emailSent) {
                    logger.info(`🔥 Promo email sent successfully to ${targetEmail} with code ${promoCode}`);
                    results.push({ email: targetEmail, status: 'success' });
                    successCount++;
                } else {
                    logger.error(`🔥 Failed to send promo email to ${targetEmail}`);
                    results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
                    failureCount++;
                }
            } catch (error) {
                logger.error(`🔥 Error sending promo email to ${targetEmail}:`, error);
                results.push({ email: targetEmail, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
                failureCount++;
            }
        }

        // Return results
        if (successCount > 0) {
            return res.status(200).json({
                message: `Promo code emails sent: ${successCount} successful, ${failureCount} failed`,
                results: results,
                promoCode: promoCode,
                sentBy: req.neonUser?.username,
                timestamp: new Date().toISOString(),
                summary: {
                    total: targetEmails.length,
                    successful: successCount,
                    failed: failureCount
                }
            });
        } else {
            return res.status(500).json({
                error: 'All email sending failed',
                message: 'Failed to send promo code emails to any recipients.',
                results: results
            });
        }

    } catch (error) {
        logger.error('🔥 Error sending promo email:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'An error occurred while sending the promo code email'
        });
    }
});

// 🔥 Test Promo Email Endpoint (Firebase Auth + Admin Role)
router.post('/admin/test-promo-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        logger.info(`🔥 POST /api/admin/test-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

        const {
            email,
            promoCode,
            customMessage,
            message,
            promoCodeLabel,
            greeting,
            designSystem,
            isPremium,
            sections,
            orderButton,
            header,
            footer,
            usageSteps,
            emailContainer,
            subject,
            previewText,
            promoStyle,
            promoCodeStyling
        } = req.body;

        // Handle both customMessage and message fields
        const messageContent = customMessage || message;

        logger.info(`🔥 Admin ${req.neonUser?.username} testing promo email`);

        // Import the email functions
        const { sendEmail, generatePromoCodeEmail } = await import('../../email');

        // Generate test promo email with custom message and styling
        const emailContent = generatePromoCodeEmail({
            email: email || 'test@example.com',
            promoCode: promoCode || 'TEST20',
            customMessage: messageContent || 'This is a test promo code email from the admin panel. Thank you for being an amazing customer!',
            greeting: greeting,
            promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
            promoCodeStyling: promoCodeStyling,
            designSystem: designSystem,
            isPremium: isPremium || false,
            sections: sections || [],
            orderButton: orderButton,
            header: header || {
                title: 'Local Cooks Header',
                subtitle: 'Premium Quality Food Subheader',
                styling: {
                    backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                    titleColor: '#ffffff',
                    subtitleColor: '#ffffff',
                    titleFontSize: '32px',
                    subtitleFontSize: '18px',
                    padding: '24px',
                    borderRadius: '0px',
                    textAlign: 'center'
                }
            },
            footer: footer || {
                mainText: 'Thank you for being part of the Local Cooks community!',
                contactText: 'Questions? Contact us at support@localcooks.com',
                copyrightText: '© 2024 Local Cooks. All rights reserved.',
                showContact: true,
                showCopyright: true,
                styling: {
                    backgroundColor: '#f8fafc',
                    textColor: '#64748b',
                    linkColor: '#F51042',
                    fontSize: '14px',
                    padding: '24px 32px',
                    textAlign: 'center',
                    borderColor: '#e2e8f0'
                }
            },
            usageSteps: usageSteps || {
                title: '🚀 How to use your promo code:',
                steps: [
                    'Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>',
                    'Browse our amazing local cooks and their delicious offerings',
                    'Apply your promo code during checkout',
                    'Enjoy your special offer!'
                ],
                enabled: true,
                styling: {
                    backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                    borderColor: '#93c5fd',
                    titleColor: '#1d4ed8',
                    textColor: '#1e40af',
                    linkColor: '#1d4ed8',
                    padding: '20px',
                    borderRadius: '8px'
                }
            },
            emailContainer: emailContainer || {
                maxWidth: '600px',
                backgroundColor: '#f1f5f9',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
            },
            dividers: {
                enabled: true,
                style: 'solid',
                color: '#e2e8f0',
                thickness: '1px',
                margin: '24px 0',
                opacity: '1'
            },
            subject: subject,
            previewText: previewText,
            promoCodeLabel: promoCodeLabel
        });

        // Send the email
        const emailSent = await sendEmail(emailContent, {
            trackingId: `test_promo_custom_${email || 'test'}_${Date.now()}`
        });

        if (emailSent) {
            return res.status(200).json({
                message: 'Test promo email sent successfully',
                email: email || 'test@example.com',
                promoCode: promoCode || 'TEST20'
            });
        } else {
            return res.status(500).json({
                error: 'Test email failed',
                message: 'Failed to send test promo email'
            });
        }

    } catch (error) {
        logger.error('🔥 Error sending test promo email:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'An error occurred while testing promo email'
        });
    }
});

// 🔥 Preview Promo Email Endpoint (Firebase Auth + Admin Role)
router.post('/admin/preview-promo-email', requireFirebaseAuthWithUser, requireAdmin,
    async (req: Request, res: Response) => {
        try {
            logger.info(`🔥 POST /api/admin/preview-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

            const {
                promoCode,
                customMessage,
                message,
                promoCodeLabel,
                greeting,
                designSystem,
                isPremium,
                sections,
                orderButton,
                header,
                footer,
                usageSteps,
                emailContainer,
                subject,
                previewText,
                promoStyle,
                promoCodeStyling,
                buttonText,
                orderUrl
            } = req.body;

            // Handle both customMessage and message fields
            const messageContent = customMessage || message;

            // Validate required fields for preview
            if (!promoCode || !messageContent) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Promo code and message are required for preview'
                });
            }

            logger.info(`🔥 Admin ${req.neonUser?.username} previewing promo email`);

            // Import the email functions
            const { generatePromoCodeEmail } = await import('../../email');

            // Generate promo email content for preview with same mapping as send endpoint
            const emailContent = generatePromoCodeEmail({
                email: 'preview@example.com', // Dummy email for preview
                promoCode: promoCode.trim(),
                customMessage: messageContent.trim(),
                message: messageContent.trim(), // Also pass as message for compatibility
                greeting: greeting,
                promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
                promoCodeStyling: promoCodeStyling,
                designSystem: designSystem,
                isPremium: isPremium || false,
                sections: sections || [],
                orderButton: orderButton || {
                    text: buttonText || 'Get Started',
                    url: orderUrl || 'https://localcooks.ca',
                    styling: {
                        backgroundColor: '#F51042',
                        color: '#ffffff',
                        fontSize: '16px',
                        fontWeight: '600',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        textAlign: 'center'
                    }
                },
                header: header || {
                    title: 'Local Cooks Header',
                    subtitle: 'Premium Quality Food Subheader',
                    styling: {
                        backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                        titleColor: '#ffffff',
                        subtitleColor: '#ffffff',
                        titleFontSize: '32px',
                        subtitleFontSize: '18px',
                        padding: '24px',
                        borderRadius: '0px',
                        textAlign: 'center'
                    }
                },
                footer: footer || {
                    mainText: 'Thank you for being part of the Local Cooks community!',
                    contactText: 'Questions? Contact us at support@localcooks.com',
                    copyrightText: '© 2024 Local Cooks. All rights reserved.',
                    showContact: true,
                    showCopyright: true,
                    styling: {
                        backgroundColor: '#f8fafc',
                        textColor: '#64748b',
                        linkColor: '#F51042',
                        fontSize: '14px',
                        padding: '24px 32px',
                        textAlign: 'center',
                        borderColor: '#e2e8f0'
                    }
                },
                usageSteps: usageSteps || {
                    title: '🚀 How to use your promo code:',
                    steps: [
                        `Visit our website: <a href="${orderUrl || 'https://localcooks.ca'}" style="color: #1d4ed8;">${orderUrl || 'https://localcooks.ca'}</a>`,
                        'Browse our amazing local cooks and their delicious offerings',
                        'Apply your promo code during checkout',
                        'Enjoy your special offer!'
                    ],
                    enabled: true,
                    styling: {
                        backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                        borderColor: '#93c5fd',
                        titleColor: '#1d4ed8',
                        textColor: '#1e40af',
                        linkColor: '#1d4ed8',
                        padding: '20px',
                        borderRadius: '8px'
                    }
                },
                emailContainer: emailContainer || {
                    maxWidth: '600px',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
                },
                dividers: {
                    enabled: true,
                    style: 'solid',
                    color: '#e2e8f0',
                    thickness: '1px',
                    margin: '24px 0',
                    opacity: '1'
                },
                subject: subject,
                previewText: previewText,
                promoCodeLabel: promoCodeLabel
            });

            // Return the HTML content directly for preview
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(emailContent.html || '<p>No HTML content generated</p>');

        } catch (error) {
            logger.error('🔥 Error generating promo email preview:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: 'An error occurred while generating email preview'
            });
        }
    });

export const adminEmailRouter = router;
