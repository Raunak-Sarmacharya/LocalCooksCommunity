import { insertApplicationSchema } from '@shared/schema';
import { Express, Request, Response } from 'express';
import fs from 'fs';
import { fromZodError } from 'zod-validation-error';
import { pool } from './db';
import { getFileUrl, upload, uploadToBlob } from './fileUpload';
import { initializeFirebaseAdmin } from './firebase-admin';
import {
  requireAdmin,
  requireFirebaseAuthWithUser,
  verifyFirebaseAuth
} from './firebase-auth-middleware';
import { syncFirebaseUserToNeon } from './firebase-user-sync';
import { firebaseStorage } from './storage-firebase';

export function registerFirebaseRoutes(app: Express) {

  // 🔥 Firebase User Registration Endpoint
  // This is called during registration to create new users
  app.post('/api/firebase-register-user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
      if (!req.firebaseUser) {
        return res.status(401).json({ error: 'Firebase authentication required' });
      }

      const { displayName, role, emailVerified } = req.body;

      // Check if user already exists
      const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'This account is already registered. Please sign in instead.',
          user: {
            id: existingUser.id,
            username: existingUser.username,
            role: existingUser.role,
            firebaseUid: existingUser.firebaseUid
          }
        });
      }

      // Create new user during registration
      const user = await syncFirebaseUserToNeon({
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email || null,
        displayName,
        emailVerified: emailVerified !== undefined ? emailVerified : req.firebaseUser.email_verified,
        role: role || 'chef'
      });

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          firebaseUid: user.firebaseUid
        },
        message: 'Account created successfully'
      });
    } catch (error) {
      console.error('Error registering Firebase user:', error);
      res.status(500).json({
        error: 'Failed to create account',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Firebase Password Reset Request - Uses Firebase's built-in password reset
  app.post('/api/firebase/forgot-password', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      console.log(`🔥 Firebase password reset requested for: ${email}`);

      // Get Firebase Admin instance
      const firebaseApp = initializeFirebaseAdmin();

      if (!firebaseApp) {
        console.error('Firebase Admin not initialized');
        return res.status(500).json({
          message: "Password reset service unavailable. Please try again later."
        });
      }

      try {
        // Get auth instance using modular SDK
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth(firebaseApp);

        // Check if user exists in Firebase
        const userRecord = await auth.getUserByEmail(email);
        console.log(`✅ Firebase user found: ${userRecord.uid}`);

        // Check if this user exists in our Neon database and is email/password user
        const neonUser = await firebaseStorage.getUserByFirebaseUid(userRecord.uid);

        if (!neonUser) {
          console.log(`❌ User not found in Neon DB for Firebase UID: ${userRecord.uid}`);
          // Don't reveal if user exists or not for security
          return res.status(200).json({
            message: "If an account with this email exists, you will receive a password reset link."
          });
        }

        // Only allow password reset for email/password users (those with hashed passwords in Neon)
        // Firebase OAuth users (Google, etc.) should use their OAuth provider's password reset
        if (!neonUser.password || neonUser.password === '') {
          console.log(`❌ User ${userRecord.uid} is OAuth user, no password reset needed`);
          return res.status(400).json({
            message: "This account uses Google/OAuth sign-in. Please use 'Sign in with Google' or contact your OAuth provider to reset your password."
          });
        }

        // Generate password reset link using Firebase
        const resetUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/auth/reset-password`;
        const resetLink = await auth.generatePasswordResetLink(email, {
          url: resetUrl,
          handleCodeInApp: true,
        });

        console.log(`✅ Firebase password reset link generated for: ${email}`);

        // Optionally send custom email here or let Firebase handle it
        // For now, let Firebase send the default email

        return res.status(200).json({
          message: "If an account with this email exists, you will receive a password reset link.",
          resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined // Only show in dev
        });

      } catch (firebaseError: any) {
        if (firebaseError.code === 'auth/user-not-found') {
          console.log(`❌ Firebase user not found: ${email}`);
          // Don't reveal if user exists or not for security
          return res.status(200).json({
            message: "If an account with this email exists, you will receive a password reset link."
          });
        } else {
          console.error(`❌ Firebase error:`, firebaseError);
          return res.status(500).json({
            message: "Error processing password reset request. Please try again later."
          });
        }
      }

    } catch (error) {
      console.error("Error in Firebase forgot password:", error);
      return res.status(500).json({
        message: "Internal server error. Please try again later."
      });
    }
  });

  // 🔥 Firebase Password Reset Confirmation - Uses Firebase's built-in password reset
  app.post('/api/firebase/reset-password', async (req: Request, res: Response) => {
    try {
      const { oobCode, newPassword } = req.body;

      if (!oobCode || !newPassword) {
        return res.status(400).json({ message: "Reset code and new password are required" });
      }

      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      console.log(`🔥 Firebase password reset confirmation with code: ${oobCode.substring(0, 8)}...`);

      // Get Firebase Admin instance
      const firebaseApp = initializeFirebaseAdmin();

      if (!firebaseApp) {
        console.error('Firebase Admin not initialized');
        return res.status(500).json({
          message: "Password reset service unavailable. Please try again later."
        });
      }

      try {
        // Get auth instance using modular SDK
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth(firebaseApp);

        // Verify the reset code and get the email
        const email = await (auth as any).verifyPasswordResetCode(oobCode);
        console.log(`✅ Password reset code verified for: ${email}`);

        // Confirm the password reset
        await (auth as any).confirmPasswordReset(oobCode, newPassword);
        console.log(`✅ Password reset confirmed for: ${email}`);

        // Update the password hash in our Neon database for consistency
        const userRecord = await auth.getUserByEmail(email);
        const neonUser = await firebaseStorage.getUserByFirebaseUid(userRecord.uid);

        if (neonUser) {
          // Hash the new password and update in Neon DB
          const bcrypt = require('bcryptjs');
          const hashedPassword = await bcrypt.hash(newPassword, 12);

          // Update using raw query since password might not be in schema
          const { pool } = await import('./db');
          if (pool) {
            await pool.query(
              'UPDATE users SET password = $1 WHERE firebase_uid = $2',
              [hashedPassword, userRecord.uid]
            );
            console.log(`✅ Password hash updated in Neon DB for user: ${neonUser.id}`);
          }
        }

        return res.status(200).json({
          message: "Password reset successfully. You can now log in with your new password."
        });

      } catch (firebaseError: any) {
        console.error(`❌ Firebase password reset error:`, firebaseError);

        if (firebaseError.code === 'auth/invalid-action-code') {
          return res.status(400).json({ message: "Invalid or expired reset code" });
        } else if (firebaseError.code === 'auth/weak-password') {
          return res.status(400).json({ message: "Password is too weak. Please choose a stronger password." });
        } else {
          return res.status(500).json({
            message: "Error resetting password. Please try again later."
          });
        }
      }

    } catch (error) {
      console.error("Error in Firebase reset password:", error);
      return res.status(500).json({
        message: "Internal server error. Please try again later."
      });
    }
  });

  // 🔥 Firebase User Sync Endpoint (Legacy - for existing flows)
  // This is called by the frontend when a user logs in/registers
  app.post('/api/firebase-sync-user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
      if (!req.firebaseUser) {
        return res.status(401).json({ error: 'Firebase authentication required' });
      }

      const { displayName, role, emailVerified, isRegistration } = req.body;

      // If this is explicitly marked as registration, allow user creation
      if (isRegistration) {
        // Check if user already exists
        const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
        if (existingUser) {
          return res.json({
            success: true,
            user: {
              id: existingUser.id,
              username: existingUser.username,
              role: existingUser.role,
              firebaseUid: existingUser.firebaseUid
            },
            message: 'User already exists'
          });
        }

        // Create new user during registration
        const user = await syncFirebaseUserToNeon({
          uid: req.firebaseUser.uid,
          email: req.firebaseUser.email || null,
          displayName,
          emailVerified: emailVerified !== undefined ? emailVerified : req.firebaseUser.email_verified,
          role: role || 'chef'
        });

        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            firebaseUid: user.firebaseUid
          }
        });
      }

      // For sign-in (not registration), only sync if user already exists
      const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
      if (!existingUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'This account is not registered with Local Cooks. Please create an account first.'
        });
      }

      res.json({
        success: true,
        user: {
          id: existingUser.id,
          username: existingUser.username,
          role: existingUser.role,
          firebaseUid: existingUser.firebaseUid
        }
      });
    } catch (error) {
      console.error('Error syncing Firebase user:', error);
      res.status(500).json({
        error: 'Failed to sync user',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Get Current User Profile (with Firebase Auth)
  app.get('/api/user/profile', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // req.neonUser is now populated by middleware with Neon user data
      // req.firebaseUser contains Firebase auth data

      // Return flat structure expected by frontend
      res.json({
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        is_verified: (req.neonUser as any).isVerified || req.firebaseUser!.email_verified,
        has_seen_welcome: (req.neonUser as any).has_seen_welcome || false,
        isChef: (req.neonUser as any).isChef || false,
        isDeliveryPartner: (req.neonUser as any).isDeliveryPartner || false,
        // Also include original structure for compatibility
        neonUser: {
          id: req.neonUser!.id,
          username: req.neonUser!.username,
          role: req.neonUser!.role,
        },
        firebaseUser: {
          uid: req.firebaseUser!.uid,
          email: req.firebaseUser!.email,
          emailVerified: req.firebaseUser!.email_verified,
        }
      });
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({ error: 'Failed to get user profile' });
    }
  });

  // 🔥 Get Current User (Firebase compatible /api/user endpoint)
  // IMPORTANT: This endpoint does NOT auto-create users for sign-in
  app.get('/api/user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
      if (!req.firebaseUser) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Get user from database by Firebase UID
      const user = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);

      if (!user) {
        // Do NOT auto-create for sign-in - return 404 to indicate user needs to register
        return res.status(404).json({
          error: 'User not found',
          message: 'This account is not registered with Local Cooks. Please create an account first.'
        });
      }

      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        is_verified: (user as any).isVerified,
        has_seen_welcome: (user as any).has_seen_welcome,
        firebaseUid: (user as any).firebaseUid
      });
    } catch (error) {
      console.error('Error getting user:', error);
      res.status(500).json({ error: 'Failed to get user data' });
    }
  });

  // 🔥 Set has_seen_welcome = true for current user
  app.post('/api/user/seen-welcome', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
      if (!req.firebaseUser) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Get user from database by Firebase UID
      const user = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      await firebaseStorage.setUserHasSeenWelcome(user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      res.status(500).json({ error: 'Failed to update welcome status' });
    }
  });

  // 🔥 Submit Application (with Firebase Auth, NO SESSIONS)
  app.post('/api/firebase/applications', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // Validate the request body
      const parsedData = insertApplicationSchema.safeParse(req.body);

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Associate application with the authenticated Neon user
      const applicationData = {
        ...parsedData.data,
        userId: req.neonUser!.id // This is the Neon user ID from the middleware
      };

      console.log(`📝 Creating application: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

      const application = await firebaseStorage.createApplication(applicationData);

      res.json({
        success: true,
        application,
        message: 'Application submitted successfully'
      });
    } catch (error) {
      console.error('Error creating application:', error);
      res.status(500).json({
        error: 'Failed to create application',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Get User's Applications (with Firebase Auth, NO SESSIONS)
  app.get('/api/firebase/applications/my', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // Get applications for the authenticated Neon user
      const applications = await firebaseStorage.getApplicationsByUserId(req.neonUser!.id);

      console.log(`📋 Retrieved ${applications.length} applications: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

      res.json(applications);
    } catch (error) {
      console.error('Error getting user applications:', error);
      res.status(500).json({ error: 'Failed to get applications' });
    }
  });

  // 🔥 Admin Routes (Firebase Auth + Admin Role, NO SESSIONS)
  app.get('/api/firebase/admin/applications', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      const applications = await firebaseStorage.getAllApplications();

      console.log(`👑 Admin ${req.firebaseUser!.uid} requested all applications`);

      res.json(applications);
    } catch (error) {
      console.error('Error getting all applications:', error);
      res.status(500).json({ error: 'Failed to get applications' });
    }
  });

  // 🔥 Get User Dashboard Data (Firebase Auth, NO SESSIONS)
  app.get('/api/firebase/dashboard', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // This demonstrates the translation pattern:
      // Firebase UID → Neon User ID → Data from multiple tables

      const userId = req.neonUser!.id; // Neon user ID
      const firebaseUid = req.firebaseUser!.uid; // Firebase UID

      console.log(`🏠 Dashboard request: Firebase UID ${firebaseUid} → Neon User ID ${userId}`);

      // Fetch data from multiple sources using Neon user ID
      const [applications, microlearningProgress] = await Promise.all([
        firebaseStorage.getApplicationsByUserId(userId),
        firebaseStorage.getMicrolearningProgress(userId)
      ]);

      res.json({
        user: {
          id: userId,
          username: req.neonUser!.username,
          role: req.neonUser!.role,
          firebaseUid: firebaseUid
        },
        applications,
        microlearningProgress,
      });
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({ error: 'Failed to get dashboard data' });
    }
  });

  // 🔥 Submit Delivery Partner Application (with Firebase Auth, NO SESSIONS)
  app.post('/api/firebase/delivery-partner-applications', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // Import the delivery partner schema
      const { insertDeliveryPartnerApplicationSchema } = await import('@shared/schema');
      
      // Validate the request body
      const parsedData = insertDeliveryPartnerApplicationSchema.safeParse(req.body);

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Associate application with the authenticated Neon user
      const applicationData = {
        ...parsedData.data,
        userId: req.neonUser!.id // This is the Neon user ID from the middleware
      };

      console.log(`🚚 Creating delivery partner application: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

      const application = await firebaseStorage.createDeliveryPartnerApplication(applicationData);

      res.json({
        success: true,
        application,
        message: 'Delivery partner application submitted successfully'
      });
    } catch (error) {
      console.error('Error creating delivery partner application:', error);
      res.status(500).json({
        error: 'Failed to create delivery partner application',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Get User's Delivery Partner Applications (with Firebase Auth, NO SESSIONS)
  app.get('/api/firebase/delivery-partner-applications/my', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      // Get delivery partner applications for the authenticated Neon user
      const applications = await firebaseStorage.getDeliveryPartnerApplicationsByUserId(req.neonUser!.id);

      console.log(`📋 Retrieved ${applications.length} delivery partner applications: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

      res.json(applications);
    } catch (error) {
      console.error('Error getting user delivery partner applications:', error);
      res.status(500).json({ error: 'Failed to get delivery partner applications' });
    }
  });

  // 🔥 Admin Routes for Delivery Partner Applications (Firebase Auth + Admin Role, NO SESSIONS)
  app.get('/api/firebase/admin/delivery-partner-applications', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      const applications = await firebaseStorage.getAllDeliveryPartnerApplications();

      console.log(`👑 Admin ${req.firebaseUser!.uid} requested all delivery partner applications`);

      res.json(applications);
    } catch (error) {
      console.error('Error getting all delivery partner applications:', error);
      res.status(500).json({ error: 'Failed to get delivery partner applications' });
    }
  });

  // 🔥 Update User Application Type (Firebase Auth, NO SESSIONS) - DEPRECATED
  app.post('/api/firebase/user/update-application-type', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const { applicationType } = req.body;

      if (!applicationType || !['chef', 'delivery_partner'].includes(applicationType)) {
        return res.status(400).json({
          error: 'Invalid application type. Must be "chef" or "delivery_partner"'
        });
      }

      console.log(`🎯 Updating application type: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id} → Type: ${applicationType}`);

      await firebaseStorage.updateUserApplicationType(req.neonUser!.id, applicationType);

      res.json({
        success: true,
        message: 'Application type updated successfully'
      });
    } catch (error) {
      console.error('Error updating application type:', error);
      res.status(500).json({
        error: 'Failed to update application type',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Update User Roles (Firebase Auth, NO SESSIONS)
  app.post('/api/firebase/user/update-roles', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const { isChef, isDeliveryPartner } = req.body;

      if (typeof isChef !== 'boolean' || typeof isDeliveryPartner !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid role data. isChef and isDeliveryPartner must be boolean values'
        });
      }

      if (!isChef && !isDeliveryPartner) {
        return res.status(400).json({
          error: 'User must have at least one role (chef or delivery partner)'
        });
      }

      console.log(`🎯 Updating user roles: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id} → Chef: ${isChef}, Delivery: ${isDeliveryPartner}`);

      await firebaseStorage.updateUserRoles(req.neonUser!.id, { isChef, isDeliveryPartner });

      res.json({
        success: true,
        message: 'User roles updated successfully'
      });
    } catch (error) {
      console.error('Error updating user roles:', error);
      res.status(500).json({
        error: 'Failed to update user roles',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 File Upload Endpoint (Firebase Auth, NO SESSIONS)
  app.post('/api/upload', 
    upload.single('file'), 
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        let fileUrl: string;
        let fileName: string;

        if (isProduction) {
          // Upload to Vercel Blob in production
          fileUrl = await uploadToBlob(req.file, req.neonUser!.id);
          // Extract filename from Vercel Blob URL for response
          fileName = fileUrl.split('/').pop() || req.file.originalname;
        } else {
          // Use local storage in development
          fileUrl = getFileUrl(req.file.filename);
          fileName = req.file.filename;
        }

        // Return success response with file information
        return res.status(200).json({
          success: true,
          url: fileUrl,
          fileName: fileName,
          size: req.file.size,
          type: req.file.mimetype
        });
      } catch (error) {
        console.error("Firebase file upload error:", error);
        
        // Clean up uploaded file on error (development only)
        if (req.file && req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            console.error('Error cleaning up file:', e);
          }
        }
        
        return res.status(500).json({ 
          error: "File upload failed",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  // 🔥 Microlearning Progress Endpoint (Firebase Auth, NO SESSIONS)
  app.post('/api/firebase/microlearning/progress', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const { videoId, progress, completed } = req.body;
      const userId = req.neonUser!.id; // Neon user ID from Firebase UID translation

      console.log(`📺 Video progress update: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${userId}`);

      await firebaseStorage.updateVideoProgress({
        userId,
        videoId,
        progress,
        completed
      });

      res.json({ success: true, message: 'Progress updated' });
    } catch (error) {
      console.error('Error updating video progress:', error);
      res.status(500).json({ error: 'Failed to update progress' });
    }
  });

  // 🔥 Health Check Endpoint (No Auth Required)
  app.get('/api/firebase-health', (req: Request, res: Response) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      message: 'Firebase Auth → Neon DB bridge is working',
      architecture: 'Stateless JWT - No Sessions Required',
      auth: {
        firebaseConfigured: !!process.env.FIREBASE_PROJECT_ID,
        neonConfigured: !!process.env.DATABASE_URL,
        sessionFree: true
      }
    });
  });

  // 🔥 Admin Flexible Email Endpoint (Firebase Auth + Admin Role)
  app.post('/api/admin/send-company-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      console.log(`🔥 POST /api/admin/send-company-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

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
        console.log('🔥 Company email request - Invalid message:', {
          customMessage: customMessage?.substring(0, 50),
          message: message?.substring(0, 50),
          messageLength: messageContent?.length
        });
        return res.status(400).json({ error: 'Message content is required (minimum 10 characters)' });
      }

      // For promotional emails, require promo code
      if (emailType === 'promotional' && !promoCode) {
        console.log('🔥 Company email request - Missing promo code for promotional email');
        return res.status(400).json({ error: 'Promo code is required for promotional emails' });
      }

      // Parse recipients
      let targetEmails: string[] = [];
      if (emailMode === 'all') {
        // Get all user emails from database
        try {
          const result = await pool.query('SELECT email FROM users WHERE email IS NOT NULL AND email != \'\'');
          targetEmails = result.rows.map(row => row.email);
        } catch (error) {
          console.error('🔥 Error fetching user emails:', error);
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
        console.log('🔥 Company email request - No valid email addresses provided');
        return res.status(400).json({ error: 'At least one email address is required' });
      }

      console.log(`🔥 Admin ${req.neonUser?.username} sending ${emailType} email to ${targetEmails.length} recipient(s)`);

      // Import the email functions
      const { sendEmail, generatePromoCodeEmail } = await import('./email');

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
            console.log(`🔥 ${emailType} email sent successfully to ${targetEmail}`);
            results.push({ email: targetEmail, status: 'success' });
            successCount++;
          } else {
            console.error(`🔥 Failed to send ${emailType} email to ${targetEmail}`);
            results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
            failureCount++;
          }
        } catch (error) {
          console.error(`🔥 Error sending ${emailType} email to ${targetEmail}:`, error);
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
      console.error('🔥 Error sending company email:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  });

  // 🔥 Admin Promo Email Endpoint (Firebase Auth + Admin Role) - Backward Compatibility
  app.post('/api/admin/send-promo-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      console.log(`🔥 POST /api/admin/send-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

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
          console.log('Promo email request - Missing custom emails');
          return res.status(400).json({ error: 'At least one email address is required' });
        }
      } else {
        if (!email) {
          console.log('Promo email request - Missing email');
          return res.status(400).json({ error: 'Email is required' });
        }
      }

      // Promo code is now optional - if empty, it will be a general company email
      if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
        console.log('🔥 Promo email request - Invalid promo code length');
        return res.status(400).json({ error: 'Promo code must be at least 3 characters long if provided' });
      }

      if (!messageContent || messageContent.length < 10) {
        console.log('Promo email request - Invalid message:', {
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
      console.log(`🔥 Admin ${req.neonUser?.username} sending promo email to ${targetEmails.length} recipient(s) with code: ${promoCode}`);

      // Import the email functions
      const { sendEmail, generatePromoCodeEmail } = await import('./email');

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
            console.log(`🔥 Promo email sent successfully to ${targetEmail} with code ${promoCode}`);
            results.push({ email: targetEmail, status: 'success' });
            successCount++;
          } else {
            console.error(`🔥 Failed to send promo email to ${targetEmail}`);
            results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
            failureCount++;
          }
        } catch (error) {
          console.error(`🔥 Error sending promo email to ${targetEmail}:`, error);
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
      console.error('🔥 Error sending promo email:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred while sending the promo code email'
      });
    }
  });

  // 🔥 Test Promo Email Endpoint (Firebase Auth + Admin Role)
  app.post('/api/test-promo-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      console.log(`🔥 POST /api/test-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

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

      console.log(`🔥 Admin ${req.neonUser?.username} testing promo email`);

      // Import the email functions
      const { sendEmail, generatePromoCodeEmail } = await import('./email');

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
      console.error('🔥 Error sending test promo email:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred while testing promo email'
      });
    }
  });

  // 🔥 Preview Promo Email Endpoint (Firebase Auth + Admin Role)
  app.post('/api/preview-promo-email', requireFirebaseAuthWithUser, requireAdmin,
    async (req: Request, res: Response) => {
      try {
        console.log(`🔥 POST /api/preview-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);

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

        console.log(`🔥 Admin ${req.neonUser?.username} previewing promo email`);

        // Import the email functions
        const { generatePromoCodeEmail } = await import('./email');

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
        console.error('🔥 Error generating promo email preview:', error);
        return res.status(500).json({
          error: 'Internal server error',
          message: 'An error occurred while generating email preview'
        });
      }
    });

  // 🚗 NHTSA Vehicle API Endpoints
  
  // Server-side caching for vehicle data
  const vehicleCache = {
    makes: null as any[] | null,
    makesByType: new Map<string, any[]>(),
    modelsByMake: new Map<string, any[]>(),
    lastFetch: 0,
    cacheExpiry: 10 * 60 * 1000, // 10 minutes
  };

  const isCacheValid = () => Date.now() - vehicleCache.lastFetch < vehicleCache.cacheExpiry;

  // Get all vehicle makes (4-wheeled vehicles only)
  app.get('/api/vehicles/makes', async (req: Request, res: Response) => {
    try {
      const { type } = req.query;
      
      // Check cache first
      if (type && vehicleCache.makesByType.has(type as string) && isCacheValid()) {
        return res.json({
          success: true,
          makes: vehicleCache.makesByType.get(type as string)
        });
      }
      
      if (!type && vehicleCache.makes && isCacheValid()) {
        return res.json({
          success: true,
          makes: vehicleCache.makes
        });
      }

      const response = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json');
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Filter for 4-wheeled vehicles only (exclude motorcycles, etc.)
      const fourWheeledMakes = data.Results.filter((make: any) => {
        // Filter out motorcycle manufacturers and other non-4-wheeled vehicles
        const excludedMakes = [
          'HARLEY-DAVIDSON', 'YAMAHA', 'KAWASAKI', 'SUZUKI', 'HONDA MOTORCYCLE',
          'BMW MOTORRAD', 'DUCATI', 'TRIUMPH', 'INDIAN', 'VICTORY', 'APRILIA',
          'KTM', 'HUSQVARNA', 'MOTO GUZZI', 'MV AGUSTA', 'BENELLI', 'NORTON',
          'ROYAL ENFIELD', 'HUSABERG', 'GAS GAS', 'SHERCO', 'BETA', 'TM RACING'
        ];
        
        return !excludedMakes.some(excluded => 
          make.Make_Name.toUpperCase().includes(excluded) || 
          excluded.includes(make.Make_Name.toUpperCase())
        );
      });

      const formattedMakes = fourWheeledMakes.map((make: any) => ({
        id: make.Make_ID,
        name: make.Make_Name
      }));

      // Cache the results
      if (type) {
        vehicleCache.makesByType.set(type as string, formattedMakes);
      } else {
        vehicleCache.makes = formattedMakes;
      }
      vehicleCache.lastFetch = Date.now();

      res.json({
        success: true,
        makes: formattedMakes
      });
    } catch (error) {
      console.error('Error fetching vehicle makes:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle makes',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });



  // Get models for a specific make using make name (more efficient)
  app.get('/api/vehicles/models/by-name/:makeName', async (req: Request, res: Response) => {
    try {
      const { makeName } = req.params;
      const decodedMakeName = decodeURIComponent(makeName);
      
      // Check cache first (use make name as key)
      if (vehicleCache.modelsByMake.has(decodedMakeName) && isCacheValid()) {
        return res.json({
          success: true,
          models: vehicleCache.modelsByMake.get(decodedMakeName)
        });
      }
      
      // Direct call to NHTSA API with make name (no need to lookup make ID)
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(decodedMakeName)}?format=json`);
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      console.log(`🚗 NHTSA API returned ${data.Results?.length || 0} models for make: ${decodedMakeName}`);
      
      // Filter for 4-wheeled vehicles only, but be much less aggressive
      const fourWheeledModels = data.Results.filter((model: any) => {
        // Only exclude very obvious non-4-wheeled vehicle models
        const modelName = model.Model_Name.toUpperCase();
        
        // Very specific exclusions only for obvious non-4-wheeled vehicles
        const excludedPatterns = [
          // Motorcycle patterns
          /MOTORCYCLE$/i,
          /BIKE$/i,
          /SCOOTER$/i,
          /MOPED$/i,
          /ATV$/i,
          /QUAD$/i,
          /TRIKE$/i,
          /SIDECAR$/i,
          
          // Very specific motorcycle model names
          /^HARLEY/i,
          /^YAMAHA\s+(R|MT|YZ|WR|XT|TW|TTR|PW|GRIZZLY|RAPTOR|WOLVERINE|KODIAK|BIG\s+BEAR)/i,
          /^KAWASAKI\s+(NINJA|ZX|VERSYS|CONCOURS|VULCAN|CONCORDE|KLX|KX|KLR|BRUTE\s+FORCE)/i,
          /^SUZUKI\s+(GSX|HAYABUSA|V-STROM|BURGMAN|ADDRESS|GSF|SV|DL|RM|RMZ|DR|DRZ)/i,
          /^HONDA\s+(CBR|CB|VFR|VTR|CRF|CR|XR|TRX|RUBICON|FOREMAN|RECON|RANCHER)/i,
          /^BMW\s+(R|S|F|G|K|HP|C|CE)/i,
          /^DUCATI\s+(MONSTER|PANIGALE|MULTISTRADA|HYPERMOTARD|SCRAMBLER|DIAPER|STREETFIGHTER)/i,
          /^TRIUMPH\s+(SPEED|STREET|TIGER|BONNEVILLE|SCRAMBLER|THRUXTON|ROCKET|DAYTONA)/i,
          /^INDIAN\s+(CHIEF|SCOUT|ROADMASTER|CHALLENGER|FTR|SPRINGFIELD)/i,
          /^VICTORY\s+(VEGAS|HAMMER|VISION|CROSS\s+COUNTRY|CROSS\s+ROADS|GUNNER)/i,
          /^APRILIA\s+(RS|TUONO|SHIVER|MANA|CAPONORD|PEGASO|ETV|RXV|SXV)/i,
          /^KTM\s+(RC|DUKE|ADVENTURE|EXC|SX|EXC|XC|FREERIDE)/i,
          /^HUSQVARNA\s+(FE|FC|TC|TE|WR|YZ|CR|CRF|KX|RM|SX|EXC)/i,
          /^MOTO\s+GUZZI\s+(V7|V9|CALIFORNIA|GRISO|STELVIO|NORGE|BREVA|BELLAGIO)/i,
          /^MV\s+AGUSTA\s+(F3|F4|BRUTALE|DRAGSTER|RIVALE|STRADALE|TURISMO|F3|F4)/i,
          /^BENELLI\s+(TNT|BN|TRK|LEONCINO|ZENTO|IMPERIALE|502C|752S)/i,
          /^NORTON\s+(COMMANDO|DOMINATOR|ATLAS|MANX|INTER|ES2|16H)/i,
          /^ROYAL\s+ENFIELD\s+(CLASSIC|BULLET|THUNDERBIRD|CONTINENTAL|HIMALAYAN|INTERCEPTOR|GT)/i,
          /^HUSABERG\s+(FE|FC|TE|TC|WR|CR|CRF|KX|RM|SX|EXC)/i,
          /^GAS\s+GAS\s+(EC|MC|TXT|RAGA|PAMPERA|TRIALS|ENDURO|MOTOCROSS)/i,
          /^SHERCO\s+(SE|ST|SC|4T|2T|RACING|FACTORY|WORK|TRIALS)/i,
          /^BETA\s+(RR|RE|RS|EVO|FACTORY|RACING|ENDURO|TRIALS|MOTOCROSS)/i,
          /^TM\s+RACING\s+(EN|MX|SM|RACING|FACTORY|ENDURO|MOTOCROSS|SUPERMOTO)/i
        ];
        
        // Check if model matches any excluded patterns
        return !excludedPatterns.some(pattern => pattern.test(modelName));
      });

      console.log(`🚗 After filtering, ${fourWheeledModels.length} models remain for make: ${decodedMakeName}`);
      
      const formattedModels = fourWheeledModels.map((model: any) => ({
        id: model.Model_ID || model.Model_ID, // Use actual NHTSA ID if available
        name: model.Model_Name
      }));

      // Cache the results
      vehicleCache.modelsByMake.set(decodedMakeName, formattedModels);

      res.json({
        success: true,
        models: formattedModels
      });
    } catch (error) {
      console.error('Error fetching vehicle models:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });



  // Decode VIN for additional vehicle information
  app.get('/api/vehicles/decode-vin/:vin', async (req: Request, res: Response) => {
    try {
      const { vin } = req.params;
      
      if (!vin || vin.length < 8) {
        return res.status(400).json({
          error: 'Invalid VIN',
          message: 'VIN must be at least 8 characters long'
        });
      }
      
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`);
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract relevant vehicle information
      const vehicleInfo: any = {};
      data.Results.forEach((result: any) => {
        if (result.Variable && result.Value) {
          switch (result.Variable) {
            case 'Make':
              vehicleInfo.make = result.Value;
              break;
            case 'Model':
              vehicleInfo.model = result.Value;
              break;
            case 'Model Year':
              vehicleInfo.year = result.Value;
              break;
            case 'Vehicle Type':
              vehicleInfo.type = result.Value;
              break;
            case 'Body Class':
              vehicleInfo.bodyClass = result.Value;
              break;
            case 'Engine Model':
              vehicleInfo.engine = result.Value;
              break;
            case 'Transmission Style':
              vehicleInfo.transmission = result.Value;
              break;
          }
        }
      });
      
      res.json({
        success: true,
        vehicle: vehicleInfo
      });
    } catch (error) {
      console.error('Error decoding VIN:', error);
      res.status(500).json({
        error: 'Failed to decode VIN',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('🔥 Firebase authentication routes registered successfully');
  console.log('✨ Session-free architecture active - JWT tokens only');
  console.log('🚗 NHTSA Vehicle API endpoints registered successfully');
} 