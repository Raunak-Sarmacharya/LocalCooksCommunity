import { insertApplicationSchema, insertChefKitchenApplicationSchema, updateChefKitchenApplicationStatusSchema, updateChefKitchenApplicationDocumentsSchema, updateLocationRequirementsSchema, updateApplicationTierSchema, chefKitchenApplications } from '@shared/schema';
import { initializeConversation, sendSystemNotification, notifyTierTransition } from './chat-service';
import { platformSettings } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { chefLocationAccess } from '@shared/schema';
import { db } from './db';
import { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { fromZodError } from 'zod-validation-error';
import { pool } from './db';
import { upload, uploadToBlob } from './fileUpload';
import { handleFileUpload } from './upload-handler';
import { initializeFirebaseAdmin } from './firebase-admin';
import {
  requireAdmin,
  requireManager,
  requireFirebaseAuthWithUser,
  verifyFirebaseAuth
} from './firebase-auth-middleware';
import { syncFirebaseUserToNeon } from './firebase-user-sync';
import { firebaseStorage } from './storage-firebase';
import { storage } from './storage';
import { getSubdomainFromHeaders, isRoleAllowedForSubdomain } from '@shared/subdomain-utils';

export function registerFirebaseRoutes(app: Express) {

  // Helper function to get authenticated user from session (for admin endpoints)
  async function getAuthenticatedUserFromSession(req: Request): Promise<{ id: number; username: string; role: string | null } | null> {
    // Check Passport session first
    if ((req as any).isAuthenticated?.() && (req as any).user) {
      return (req as any).user as any;
    }

    // Check direct session data (for admin login via req.session.userId)
    if ((req.session as any)?.userId) {
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      if (user) {
        return user;
      }
    }

    // Check session user object
    if ((req.session as any)?.user) {
      return (req.session as any).user;
    }

    return null;
  }

  // Session-based admin middleware (for admin endpoints that use session auth)
  // IMPORTANT: This middleware ONLY checks session auth and IGNORES any Firebase tokens
  async function requireSessionAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      // Explicitly ignore any Authorization headers - this endpoint uses session auth only
      // Delete any Firebase-related request properties to prevent accidental Firebase auth
      delete (req as any).firebaseUser;

      const user = await getAuthenticatedUserFromSession(req);

      if (!user) {
        console.log('❌ Session admin auth failed: No session found');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Session authentication required. Please login as an admin.'
        });
      }

      if (user.role !== 'admin') {
        console.log(`❌ Session admin auth failed: User ${user.id} is not an admin (role: ${user.role})`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required',
          userRole: user.role || 'none'
        });
      }

      // Set user on request for use in handlers
      (req as any).sessionUser = user;
      (req as any).neonUser = user; // For backward compatibility with existing code

      console.log(`✅ Session admin auth: User ${user.id} (${user.username}) authenticated as admin`);
      next();
    } catch (error) {
      console.error('Session admin auth error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Authentication verification failed'
      });
    }
  }

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

      // Validate subdomain-role matching for registration
      const subdomain = getSubdomainFromHeaders(req.headers);
      // For registration, we only have the role, not the flags yet
      if (role && !isRoleAllowedForSubdomain(role, subdomain, false, false, false)) {
        const requiredSubdomain = role === 'chef' ? 'chef' :
          role === 'manager' ? 'kitchen' :
            role === 'admin' ? 'admin' : null;

        return res.status(403).json({
          error: `Access denied. ${role} users must register from the ${requiredSubdomain} subdomain.`,
          requiredSubdomain: requiredSubdomain
        });
      }

      // Create new user during registration
      const user = await syncFirebaseUserToNeon({
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email || null,
        displayName,
        emailVerified: emailVerified !== undefined ? emailVerified : req.firebaseUser.email_verified,
        role: role // Don't set default role - let user choose
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

      // Validate subdomain-role matching for login
      const subdomain = getSubdomainFromHeaders(req.headers);
      const isPortalUser = (existingUser as any).isPortalUser || (existingUser as any).is_portal_user || false;
      const isChef = (existingUser as any).isChef || (existingUser as any).is_chef || false;
      const isManager = (existingUser as any).isManager || (existingUser as any).is_manager || false;
      if (!isRoleAllowedForSubdomain(existingUser.role, subdomain, isPortalUser, isChef, isManager)) {
        // Determine effective role for error message
        const effectiveRole = existingUser.role || (isManager ? 'manager' : isChef ? 'chef' : null);
        const requiredSubdomain = effectiveRole === 'chef' ? 'chef' :
          effectiveRole === 'manager' ? 'kitchen' :
            effectiveRole === 'admin' ? 'admin' : null;

        return res.status(403).json({
          error: `Access denied. ${effectiveRole || 'user'} users must login from the ${requiredSubdomain} subdomain.`,
          requiredSubdomain: requiredSubdomain
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

      // Fetch user's full name from applications
      let userFullName = null;
      let stripeConnectAccountId = null;
      let stripeConnectOnboardingStatus = null;

      if (pool) {
        try {
          // Get full name from chef applications
          const chefAppResult = await pool.query(
            'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.neonUser!.id]
          );
          if (chefAppResult.rows.length > 0 && chefAppResult.rows[0].full_name) {
            userFullName = chefAppResult.rows[0].full_name;
          }

          // Fetch Stripe Connect account information
          const stripeResult = await pool.query(
            'SELECT stripe_connect_account_id, stripe_connect_onboarding_status FROM users WHERE id = $1',
            [req.neonUser!.id]
          );
          if (stripeResult.rows.length > 0) {
            stripeConnectAccountId = stripeResult.rows[0].stripe_connect_account_id || null;
            stripeConnectOnboardingStatus = stripeResult.rows[0].stripe_connect_onboarding_status || null;
          }
        } catch (dbError) {
          console.error('Error fetching user data:', dbError);
        }
      }

      // Log user data for debugging
      console.log(`[USER PROFILE] Returning profile for user ${req.neonUser!.id}:`, {
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        isChef: req.neonUser!.isChef,
        isManager: req.neonUser!.isManager,
        rawNeonUser: req.neonUser
      });

      // Return flat structure expected by frontend
      res.json({
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        is_verified: req.neonUser!.isVerified !== undefined ? req.neonUser!.isVerified : req.firebaseUser!.email_verified,
        has_seen_welcome: req.neonUser!.has_seen_welcome || false,
        isChef: req.neonUser!.isChef || false,
        displayName: userFullName || null, // User's full name from application
        fullName: userFullName || null, // Alias for compatibility
        stripeConnectAccountId: stripeConnectAccountId, // Stripe Connect account ID
        stripe_connect_account_id: stripeConnectAccountId, // Alias for compatibility
        stripeConnectOnboardingStatus: stripeConnectOnboardingStatus, // Stripe Connect onboarding status
        stripe_connect_onboarding_status: stripeConnectOnboardingStatus, // Alias for compatibility
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
  app.post('/api/firebase/applications',
    upload.fields([
      { name: 'foodSafetyLicense', maxCount: 1 },
      { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
      try {
        console.log(`📝 POST /api/firebase/applications - User ${req.neonUser!.id} submitting chef application`);

        // Handle file uploads if present
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        let foodSafetyLicenseUrl: string | undefined;
        let foodEstablishmentCertUrl: string | undefined;

        if (files) {
          // Upload food safety license if provided
          if (files['foodSafetyLicense']?.[0]) {
            try {
              foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicense'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food safety license:', uploadError);
            }
          }

          // Upload food establishment cert if provided
          if (files['foodEstablishmentCert']?.[0]) {
            try {
              foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCert'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food establishment cert:', uploadError);
            }
          }
        }

        // Prepare application data from form body and uploaded files
        const applicationData = {
          ...req.body,
          userId: req.neonUser!.id, // This is the Neon user ID from the middleware
          // Use uploaded file URLs if available, otherwise use provided URLs
          foodSafetyLicenseUrl: foodSafetyLicenseUrl || req.body.foodSafetyLicenseUrl || undefined,
          foodEstablishmentCertUrl: foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl || undefined,
        };

        // Set document status to pending if URLs are provided
        if (applicationData.foodSafetyLicenseUrl) {
          applicationData.foodSafetyLicenseStatus = "pending";
        }
        if (applicationData.foodEstablishmentCertUrl) {
          applicationData.foodEstablishmentCertStatus = "pending";
        }

        // Validate the request body
        const parsedData = insertApplicationSchema.safeParse(applicationData);

        if (!parsedData.success) {
          const validationError = fromZodError(parsedData.error);
          console.log('❌ Validation failed:', validationError.details);
          return res.status(400).json({
            message: "Validation error",
            errors: validationError.details
          });
        }

        console.log(`📝 Creating application: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

        const application = await firebaseStorage.createApplication(parsedData.data);

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
      const userId = req.neonUser!.id;
      const firebaseUid = req.firebaseUser!.uid;

      console.log(`[APPLICATIONS] Fetching applications for user ID: ${userId} (Firebase UID: ${firebaseUid})`);
      console.log(`[APPLICATIONS] User object:`, {
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        isChef: (req.neonUser as any).isChef
      });

      // Get applications for the authenticated Neon user
      const applications = await firebaseStorage.getApplicationsByUserId(userId);

      console.log(`[APPLICATIONS] Retrieved ${applications.length} applications for user ${userId}`);
      if (applications.length > 0) {
        console.log(`[APPLICATIONS] First application sample:`, {
          id: applications[0].id,
          userId: applications[0].userId,
          status: applications[0].status
        });
      }

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

  // 🔥 Get Current User Info (Firebase Auth, NO SESSIONS)
  // Returns Neon user ID for client-side use (e.g., chat service)
  app.get('/api/firebase/user/me', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      res.json({
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        firebaseUid: req.firebaseUser!.uid,
      });
    } catch (error) {
      console.error('Error getting user info:', error);
      res.status(500).json({ error: 'Failed to get user info' });
    }
  });

  // 🔥 Update User Roles (Firebase Auth, NO SESSIONS)
  app.post('/api/firebase/user/update-roles', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const { isChef } = req.body;

      if (typeof isChef !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid role data. isChef must be a boolean value'
        });
      }

      console.log(`🎯 Updating user roles: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id} → Chef: ${isChef}`);

      await firebaseStorage.updateUserRoles(req.neonUser!.id, { isChef });

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

  // 🔥 File Upload Endpoint (Firebase Auth, NO SESSIONS) - Uses Cloudflare R2
  app.post('/api/upload',
    upload.single('file'),
    requireFirebaseAuthWithUser,
    handleFileUpload
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

  // �� Cancel Application (Firebase Auth, NO SESSIONS)
  app.patch('/api/firebase/applications/:id/cancel', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // First get the application to verify ownership
      const application = await firebaseStorage.getApplicationById(id);

      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Check if the application belongs to the authenticated user (unless admin)
      if (application.userId !== req.neonUser!.id && req.neonUser!.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. You can only cancel your own applications." });
      }

      const updateData = {
        id,
        status: "cancelled" as const
      };

      const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Send email notification about application cancellation
      try {
        if (updatedApplication.email) {
          const { generateStatusChangeEmail, sendEmail } = await import('./email');

          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.fullName || "Applicant",
            email: updatedApplication.email,
            status: 'cancelled'
          });

          await sendEmail(emailContent, {
            trackingId: `cancel_${updatedApplication.id}_${Date.now()}`
          });

          console.log(`Cancellation email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
        } else {
          console.warn(`Cannot send cancellation email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending cancellation email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error cancelling application:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // 🔥 Admin Cancel Application (Firebase Auth + Admin Role, NO SESSIONS)
  app.patch('/api/firebase/admin/applications/:id/cancel', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // Get the application
      const application = await firebaseStorage.getApplicationById(id);

      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      const updateData = {
        id,
        status: "cancelled" as const
      };

      const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Send email notification about application cancellation
      try {
        if (updatedApplication.email) {
          const { generateStatusChangeEmail, sendEmail } = await import('./email');

          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.fullName || "Applicant",
            email: updatedApplication.email,
            status: 'cancelled'
          });

          await sendEmail(emailContent, {
            trackingId: `admin_cancel_${updatedApplication.id}_${Date.now()}`
          });

          console.log(`Admin cancellation email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
        } else {
          console.warn(`Cannot send admin cancellation email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending admin cancellation email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error cancelling application (admin):", error);
      return res.status(500).json({ message: "Internal server error" });
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

  // 🔥 Public Platform Settings Endpoint (for chefs to see service fee rate)
  app.get('/api/platform-settings/service-fee-rate', async (req: Request, res: Response) => {
    try {
      const [setting] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'service_fee_rate'))
        .limit(1);

      if (setting) {
        const rate = parseFloat(setting.value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          return res.json({
            key: 'service_fee_rate',
            value: setting.value,
            rate: rate,
            percentage: (rate * 100).toFixed(2),
            description: setting.description,
          });
        }
      }

      // Return default if not set
      return res.json({
        key: 'service_fee_rate',
        value: '0.05',
        rate: 0.05,
        percentage: '5.00',
        description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
      });
    } catch (error) {
      console.error('Error getting service fee rate:', error);
      res.status(500).json({
        error: 'Failed to get service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Admin Platform Settings Endpoints
  // Get service fee rate (admin endpoint with full details)
  // NOTE: Admins use session-based auth, not Firebase auth
  app.get('/api/admin/platform-settings/service-fee-rate', requireSessionAdmin, async (req: Request, res: Response) => {
    try {
      const [setting] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'service_fee_rate'))
        .limit(1);

      if (setting) {
        const rate = parseFloat(setting.value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          return res.json({
            key: 'service_fee_rate',
            value: setting.value,
            rate: rate,
            percentage: (rate * 100).toFixed(2),
            description: setting.description,
            updatedAt: setting.updatedAt,
          });
        }
      }

      // Return default if not set
      return res.json({
        key: 'service_fee_rate',
        value: '0.05',
        rate: 0.05,
        percentage: '5.00',
        description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
      });
    } catch (error) {
      console.error('Error getting service fee rate:', error);
      res.status(500).json({
        error: 'Failed to get service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update service fee rate
  // NOTE: Admins use session-based auth, not Firebase auth
  app.put('/api/admin/platform-settings/service-fee-rate', requireSessionAdmin, async (req: Request, res: Response) => {
    try {
      const { rate } = req.body;

      if (rate === undefined || rate === null) {
        return res.status(400).json({ error: 'Rate is required' });
      }

      const rateValue = typeof rate === 'string' ? parseFloat(rate) : rate;

      if (isNaN(rateValue) || rateValue < 0 || rateValue > 1) {
        return res.status(400).json({ error: 'Rate must be a number between 0 and 1 (e.g., 0.05 for 5%)' });
      }

      // Get user ID from session (set by requireSessionAdmin middleware)
      const userId = (req as any).sessionUser?.id || (req as any).neonUser?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Check if setting exists
      const [existing] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'service_fee_rate'))
        .limit(1);

      if (existing) {
        // Update existing
        const [updated] = await db
          .update(platformSettings)
          .set({
            value: rateValue.toString(),
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(platformSettings.key, 'service_fee_rate'))
          .returning();

        return res.json({
          key: 'service_fee_rate',
          value: updated.value,
          rate: rateValue,
          percentage: (rateValue * 100).toFixed(2),
          description: updated.description,
          updatedAt: updated.updatedAt,
          message: 'Service fee rate updated successfully',
        });
      } else {
        // Create new
        const [created] = await db
          .insert(platformSettings)
          .values({
            key: 'service_fee_rate',
            value: rateValue.toString(),
            description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
            updatedBy: userId,
          })
          .returning();

        return res.json({
          key: 'service_fee_rate',
          value: created.value,
          rate: rateValue,
          percentage: (rateValue * 100).toFixed(2),
          description: created.description,
          updatedAt: created.updatedAt,
          message: 'Service fee rate created successfully',
        });
      }
    } catch (error) {
      console.error('Error updating service fee rate:', error);
      res.status(500).json({
        error: 'Failed to update service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // =============================================================================
  // 🍳 CHEF KITCHEN APPLICATIONS - Direct Kitchen Application Flow
  // =============================================================================
  // These endpoints replace the "Share Profile" workflow
  // Chefs can apply directly to kitchens without requiring platform application approval

  /**
   * 🔥 Submit Kitchen Application (Firebase Auth)
   * POST /api/firebase/chef/kitchen-applications
   * 
   * Allows a chef to submit an application to a specific kitchen location.
   * Chefs can apply even without having a platform application approved.
   * If previously rejected, submitting again will reset the application to inReview.
   */
  app.post('/api/firebase/chef/kitchen-applications',
    upload.fields([
      { name: 'foodSafetyLicenseFile', maxCount: 1 },
      { name: 'foodEstablishmentCertFile', maxCount: 1 },
      { name: 'tier2_insurance_document', maxCount: 1 },
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
      try {
        console.log(`🍳 POST /api/firebase/chef/kitchen-applications - Chef ${req.neonUser!.id} submitting kitchen application`);

        // Handle file uploads if present
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        let foodSafetyLicenseUrl: string | undefined;
        let foodEstablishmentCertUrl: string | undefined;
        const tierFileUrls: Record<string, string> = {};

        if (files) {
          // Upload food safety license if provided
          if (files['foodSafetyLicenseFile']?.[0]) {
            try {
              foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food safety license:', uploadError);
            }
          }

          // Upload food establishment cert if provided
          if (files['foodEstablishmentCertFile']?.[0]) {
            try {
              foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food establishment cert:', uploadError);
            }
          }

          // Upload tier-specific files
          const tierFileFields = [
            'tier2_insurance_document',
            'tier2_allergen_plan',
            'tier2_supplier_list',
            'tier2_quality_control',
            'tier2_traceability',
            'tier3_food_safety_plan',
            'tier3_production_timeline',
            'tier3_cleaning_schedule',
            'tier3_training_records',
          ];

          for (const field of tierFileFields) {
            if (files[field]?.[0]) {
              try {
                const url = await uploadToBlob(files[field][0], req.neonUser!.id, 'documents');
                tierFileUrls[field] = url;
                console.log(`✅ Uploaded ${field}: ${url}`);
              } catch (uploadError) {
                console.error(`❌ Failed to upload ${field}:`, uploadError);
              }
            }
          }
        }

        // Parse custom fields data if provided
        let customFieldsData: Record<string, any> | undefined;
        if (req.body.customFieldsData) {
          try {
            customFieldsData = typeof req.body.customFieldsData === 'string'
              ? JSON.parse(req.body.customFieldsData)
              : req.body.customFieldsData;
          } catch (error) {
            console.error('Error parsing customFieldsData:', error);
            customFieldsData = undefined;
          }
        }

        // Parse tier data if provided
        let tierData: Record<string, any> | undefined;
        if (req.body.tier_data) {
          try {
            tierData = typeof req.body.tier_data === 'string'
              ? JSON.parse(req.body.tier_data)
              : req.body.tier_data;
            // Add tier file URLs to tier data
            if (Object.keys(tierFileUrls).length > 0) {
              tierData = { ...tierData, tierFiles: tierFileUrls };
            }
          } catch (error) {
            console.error('Error parsing tier_data:', error);
          }
        }

        // Verify the location exists and get requirements
        const locationId = parseInt(req.body.locationId);
        const location = await firebaseStorage.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ error: 'Kitchen location not found' });
        }

        // Get location requirements to validate fields properly
        const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);

        // Parse and validate form data
        // Handle phone: validate based on location requirements
        let phoneValue: string = '';
        const phoneInput = req.body.phone ? req.body.phone.trim() : '';

        // Validate phone based on location requirements
        if (requirements.requirePhone) {
          // Phone is required - must be provided and valid
          if (!phoneInput || phoneInput === '') {
            return res.status(400).json({
              error: 'Validation error',
              message: 'Phone number is required for this location',
              details: [{
                code: 'too_small',
                minimum: 1,
                type: 'string',
                inclusive: true,
                exact: false,
                message: 'Phone number is required',
                path: ['phone']
              }]
            });
          }
          // Validate phone format using the required phone schema
          const { phoneNumberSchema } = await import('@shared/phone-validation.js');
          const phoneValidation = phoneNumberSchema.safeParse(phoneInput);
          if (!phoneValidation.success) {
            const validationError = fromZodError(phoneValidation.error);
            return res.status(400).json({
              error: 'Validation error',
              message: validationError.message,
              details: validationError.details
            });
          }
          phoneValue = phoneValidation.data;
        } else {
          // Phone is optional - validate format only if provided
          if (phoneInput && phoneInput !== '') {
            const { optionalPhoneNumberSchema } = await import('@shared/phone-validation.js');
            const phoneValidation = optionalPhoneNumberSchema.safeParse(phoneInput);
            if (!phoneValidation.success) {
              const validationError = fromZodError(phoneValidation.error);
              return res.status(400).json({
                error: 'Validation error',
                message: validationError.message,
                details: validationError.details
              });
            }
            // optionalPhoneNumberSchema returns null for empty, but we need string for DB
            phoneValue = phoneValidation.data || '';
          }
          // If phone not provided and not required, phoneValue remains empty string
        }

        // Parse businessDescription JSON to extract individual fields for validation
        let businessInfo: any = {};
        if (req.body.businessDescription) {
          try {
            businessInfo = typeof req.body.businessDescription === 'string'
              ? JSON.parse(req.body.businessDescription)
              : req.body.businessDescription;
          } catch (error) {
            console.error('Error parsing businessDescription:', error);
            businessInfo = {};
          }
        }

        // Parse fullName to extract firstName and lastName for validation
        const fullNameParts = (req.body.fullName || '').trim().split(/\s+/);
        const firstName = fullNameParts[0] || '';
        const lastName = fullNameParts.slice(1).join(' ') || '';

        // Validate firstName
        if (requirements.requireFirstName && (!firstName || firstName.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'First name is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'First name is required',
              path: ['firstName']
            }]
          });
        }

        // Validate lastName
        if (requirements.requireLastName && (!lastName || lastName.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Last name is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Last name is required',
              path: ['lastName']
            }]
          });
        }

        // Validate email
        if (requirements.requireEmail && (!req.body.email || req.body.email.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Email is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Email is required',
              path: ['email']
            }]
          });
        }

        // Validate businessName
        if (requirements.requireBusinessName && (!businessInfo.businessName || businessInfo.businessName.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Business name is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Business name is required',
              path: ['businessName']
            }]
          });
        }

        // Validate businessType
        if (requirements.requireBusinessType && (!businessInfo.businessType || businessInfo.businessType.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Business type is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Business type is required',
              path: ['businessType']
            }]
          });
        }

        // Validate experience
        if (requirements.requireExperience && (!businessInfo.experience || businessInfo.experience.trim() === '') && (!req.body.cookingExperience || req.body.cookingExperience.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Experience level is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Experience level is required',
              path: ['experience']
            }]
          });
        }

        // Validate businessDescription
        if (requirements.requireBusinessDescription && (!businessInfo.description || businessInfo.description.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Business description is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Business description is required',
              path: ['businessDescription']
            }]
          });
        }

        // Validate foodSafetyLicense (food handler cert)
        if (requirements.requireFoodHandlerCert && (!req.body.foodSafetyLicense)) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Food handler certificate is required for this location',
            details: [{
              code: 'custom',
              message: 'Food handler certificate is required',
              path: ['foodSafetyLicense']
            }]
          });
        }

        // Validate foodHandlerCertExpiry
        if (requirements.requireFoodHandlerExpiry && (!businessInfo.foodHandlerCertExpiry || businessInfo.foodHandlerCertExpiry.trim() === '') && (!req.body.foodSafetyLicenseExpiry || req.body.foodSafetyLicenseExpiry.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Food handler certificate expiry date is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Food handler certificate expiry date is required',
              path: ['foodHandlerCertExpiry']
            }]
          });
        }

        // Food establishment cert is now a Tier 2 requirement - not validated at initial application
        let foodEstablishmentCertValue: "yes" | "no" | "notSure" = "no"; // Default to "no" if not required
        foodEstablishmentCertValue = req.body.foodEstablishmentCert || "no";

        // Validate usageFrequency
        if (requirements.requireUsageFrequency && (!businessInfo.usageFrequency || businessInfo.usageFrequency.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Usage frequency is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Usage frequency is required',
              path: ['usageFrequency']
            }]
          });
        }

        // Validate sessionDuration
        if (requirements.requireSessionDuration && (!businessInfo.sessionDuration || businessInfo.sessionDuration.trim() === '')) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'Session duration is required for this location',
            details: [{
              code: 'too_small',
              minimum: 1,
              type: 'string',
              message: 'Session duration is required',
              path: ['sessionDuration']
            }]
          });
        }

        // Note: termsAgree and accuracyAgree are validated client-side in the form
        // The form won't submit if these are required but not checked
        // Server-side validation could be added if needed, but client-side is sufficient for boolean checkboxes

        const formData: any = {
          chefId: req.neonUser!.id,
          locationId: locationId,
          fullName: req.body.fullName || `${firstName} ${lastName}`.trim() || 'N/A',
          email: req.body.email || '',
          phone: phoneValue, // Empty string if not required (database has notNull constraint)
          kitchenPreference: req.body.kitchenPreference || "commercial",
          businessDescription: req.body.businessDescription || undefined,
          cookingExperience: req.body.cookingExperience || businessInfo.experience || undefined,
          foodSafetyLicense: req.body.foodSafetyLicense || "no",
          foodSafetyLicenseUrl: foodSafetyLicenseUrl || req.body.foodSafetyLicenseUrl || undefined,
          foodSafetyLicenseExpiry: req.body.foodSafetyLicenseExpiry || businessInfo.foodHandlerCertExpiry || undefined,
          foodEstablishmentCert: foodEstablishmentCertValue,
          foodEstablishmentCertUrl: foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl || undefined,
          foodEstablishmentCertExpiry: req.body.foodEstablishmentCertExpiry || businessInfo.foodEstablishmentCertExpiry || undefined,
          customFieldsData: customFieldsData || undefined,
        };

        // Add tier fields if provided
        if (req.body.current_tier) {
          formData.current_tier = parseInt(req.body.current_tier);
        }
        if (tierData) {
          formData.tier_data = tierData;
        }

        // Validate Tier 2 required documents when submitting Tier 2 application
        const currentTier = parseInt(req.body.current_tier) || 1;
        if (currentTier === 2) {
          // Check if Food Establishment Certificate is required and provided
          if (requirements.tier2_food_establishment_cert_required) {
            const hasFoodEstablishmentCert = foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl;
            if (!hasFoodEstablishmentCert) {
              return res.status(400).json({
                error: 'Validation error',
                message: 'Food Establishment Certificate is required for Tier 2',
                details: [{
                  code: 'custom',
                  message: 'Food Establishment Certificate is required',
                  path: ['foodEstablishmentCert']
                }]
              });
            }
          }

          // Check if Insurance Document is required and provided
          if (requirements.tier2_insurance_document_required) {
            const hasInsuranceDoc = tierFileUrls['tier2_insurance_document'];
            if (!hasInsuranceDoc) {
              return res.status(400).json({
                error: 'Validation error',
                message: 'Insurance Document is required for Tier 2',
                details: [{
                  code: 'custom',
                  message: 'Insurance Document is required',
                  path: ['tier2_insurance_document']
                }]
              });
            }
          }
        }

        // Handle Tier 4 license fields
        if (req.body.government_license_number) {
          formData.government_license_number = req.body.government_license_number;
        }
        if (req.body.government_license_received_date) {
          formData.government_license_received_date = req.body.government_license_received_date;
        }
        if (req.body.government_license_expiry_date) {
          formData.government_license_expiry_date = req.body.government_license_expiry_date;
        }

        // Validate with Zod schema (phone is already validated above)
        const parsedData = insertChefKitchenApplicationSchema.safeParse(formData);

        if (!parsedData.success) {
          const validationError = fromZodError(parsedData.error);
          console.log('❌ Validation failed:', validationError.details);
          return res.status(400).json({
            error: 'Validation error',
            message: validationError.message,
            details: validationError.details
          });
        }

        // Create/update the application - merge extra tier fields that Zod strips
        const applicationData = {
          ...parsedData.data,
          // Include tier fields (not in Zod schema but needed for storage)
          ...(req.body.current_tier && { current_tier: parseInt(req.body.current_tier) }),
          ...(tierData && { tier_data: tierData }),
          ...(foodEstablishmentCertUrl && { foodEstablishmentCertUrl }),
        };
        const application = await firebaseStorage.createChefKitchenApplication(applicationData as any);

        console.log(`✅ Kitchen application created/updated: Chef ${req.neonUser!.id} → Location ${parsedData.data.locationId}, ID: ${application.id}`);

        // Note: Conversation will be initialized when Tier 1 is approved
        // This allows managers to review applications before starting chat

        res.status(201).json({
          success: true,
          application,
          message: 'Kitchen application submitted successfully. The kitchen manager will review your application.',
          isResubmission: application.createdAt < application.updatedAt,
        });
      } catch (error) {
        console.error('Error creating kitchen application:', error);
        res.status(500).json({
          error: 'Failed to submit kitchen application',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  /**
   * 🔥 Get Chef's Kitchen Applications (Firebase Auth)
   * GET /api/firebase/chef/kitchen-applications
   * 
   * Returns all kitchen applications for the authenticated chef.
   */
  app.get('/api/firebase/chef/kitchen-applications', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const chefId = req.neonUser!.id;
      const firebaseUid = req.firebaseUser!.uid;

      console.log(`[KITCHEN APPLICATIONS] Fetching kitchen applications for chef ID: ${chefId} (Firebase UID: ${firebaseUid})`);
      console.log(`[KITCHEN APPLICATIONS] User object:`, {
        id: req.neonUser!.id,
        username: req.neonUser!.username,
        role: req.neonUser!.role,
        isChef: (req.neonUser as any).isChef
      });

      const applications = await firebaseStorage.getChefKitchenApplicationsByChefId(chefId);

      console.log(`[KITCHEN APPLICATIONS] Retrieved ${applications.length} kitchen applications for chef ${chefId}`);
      if (applications.length > 0) {
        console.log(`[KITCHEN APPLICATIONS] First application sample:`, {
          id: applications[0].id,
          chefId: applications[0].chefId,
          locationId: applications[0].locationId,
          status: applications[0].status
        });
      }

      // Enrich with location details
      const enrichedApplications = await Promise.all(
        applications.map(async (app) => {
          const location = await firebaseStorage.getLocationById(app.locationId);
          return {
            ...app,
            location: location ? {
              id: (location as any).id,
              name: (location as any).name,
              address: (location as any).address,
              city: (location as any).city,
            } : null,
          };
        })
      );

      res.json(enrichedApplications);
    } catch (error) {
      console.error('Error getting chef kitchen applications:', error);
      res.status(500).json({ error: 'Failed to get kitchen applications' });
    }
  });

  /**
   * 🔥 Get Chef's Application for Specific Location (Firebase Auth)
   * GET /api/firebase/chef/kitchen-applications/location/:locationId
   * 
   * Returns the chef's application for a specific location if one exists.
   * Useful for checking application status before booking.
   */
  app.get('/api/firebase/chef/kitchen-applications/location/:locationId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const locationId = parseInt(req.params.locationId);

      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'Invalid location ID' });
      }

      console.log(`🍳 GET /api/firebase/chef/kitchen-applications/location/${locationId} - Chef ${req.neonUser!.id}`);

      const application = await firebaseStorage.getChefKitchenApplication(req.neonUser!.id, locationId);

      if (!application) {
        return res.status(404).json({
          error: 'No application found',
          hasApplication: false,
          canBook: false,
          message: 'You have not applied to this kitchen yet.',
        });
      }

      // Get location details
      const location = await firebaseStorage.getLocationById(locationId);

      res.json({
        ...application,
        hasApplication: true,
        canBook: application.status === 'approved' && !!application.tier2_completed_at, // Can book after completing Tier 2 (only Tier 1 and 2 are in use)
        location: location ? {
          id: (location as any).id,
          name: (location as any).name,
          address: (location as any).address,
        } : null,
      });
    } catch (error) {
      console.error('Error getting chef kitchen application:', error);
      res.status(500).json({ error: 'Failed to get kitchen application' });
    }
  });

  /**
   * 🔥 Get Chef's Kitchen Access Status (Firebase Auth)
   * GET /api/firebase/chef/kitchen-access-status/:locationId
   * 
   * Returns detailed booking eligibility status for a location.
   * Used by frontend to determine what UI to show (apply/wait/book).
   */
  app.get('/api/firebase/chef/kitchen-access-status/:locationId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const locationId = parseInt(req.params.locationId);

      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'Invalid location ID' });
      }

      console.log(`🍳 GET /api/firebase/chef/kitchen-access-status/${locationId} - Chef ${req.neonUser!.id}`);

      const accessStatus = await firebaseStorage.getChefKitchenApplicationStatus(req.neonUser!.id, locationId);

      res.json(accessStatus);
    } catch (error) {
      console.error('Error getting kitchen access status:', error);
      res.status(500).json({ error: 'Failed to get kitchen access status' });
    }
  });

  /**
   * 🔥 Get Chef's Approved Kitchens (Firebase Auth)
   * GET /api/firebase/chef/approved-kitchens
   * 
   * Returns all locations where the chef has approved applications.
   * These are the kitchens where the chef can make bookings.
   */
  app.get('/api/firebase/chef/approved-kitchens', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      console.log(`🍳 GET /api/firebase/chef/approved-kitchens - Chef ${req.neonUser!.id}`);

      const approvedKitchens = await firebaseStorage.getChefApprovedKitchens(req.neonUser!.id);

      console.log(`[APPROVED KITCHENS] Returning ${approvedKitchens.length} approved locations for chef ${req.neonUser!.id}`);
      if (approvedKitchens.length > 0) {
        console.log(`[APPROVED KITCHENS] First location sample:`, approvedKitchens[0]);
      }

      res.json(approvedKitchens);
    } catch (error) {
      console.error('Error getting approved kitchens:', error);
      res.status(500).json({ error: 'Failed to get approved kitchens' });
    }
  });

  /**
   * 🔥 Cancel Kitchen Application (Firebase Auth)
   * PATCH /api/firebase/chef/kitchen-applications/:id/cancel
   * 
   * Allows a chef to withdraw/cancel their pending application.
   * Only works for applications in 'inReview' status.
   */
  app.patch('/api/firebase/chef/kitchen-applications/:id/cancel', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);

      if (isNaN(applicationId)) {
        return res.status(400).json({ error: 'Invalid application ID' });
      }

      console.log(`🍳 PATCH /api/firebase/chef/kitchen-applications/${applicationId}/cancel - Chef ${req.neonUser!.id}`);

      const cancelledApplication = await firebaseStorage.cancelChefKitchenApplication(applicationId, req.neonUser!.id);

      res.json({
        success: true,
        application: cancelledApplication,
        message: 'Application cancelled successfully',
      });
    } catch (error) {
      console.error('Error cancelling kitchen application:', error);
      res.status(500).json({
        error: 'Failed to cancel application',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * 🔥 Update Kitchen Application Documents (Firebase Auth)
   * PATCH /api/firebase/chef/kitchen-applications/:id/documents
   * 
   * Allows a chef to update their documents on an existing application.
   * Resets document verification status to pending.
   */
  app.patch('/api/firebase/chef/kitchen-applications/:id/documents',
    upload.fields([
      { name: 'foodSafetyLicenseFile', maxCount: 1 },
      { name: 'foodEstablishmentCertFile', maxCount: 1 }
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
      try {
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
          return res.status(400).json({ error: 'Invalid application ID' });
        }

        console.log(`🍳 PATCH /api/firebase/chef/kitchen-applications/${applicationId}/documents - Chef ${req.neonUser!.id}`);

        // Verify the application belongs to this chef
        const existing = await firebaseStorage.getChefKitchenApplicationById(applicationId);
        if (!existing || existing.chefId !== req.neonUser!.id) {
          return res.status(403).json({ error: 'Application not found or access denied' });
        }

        // Handle file uploads
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        const updateData: any = { id: applicationId };

        if (files) {
          if (files['foodSafetyLicenseFile']?.[0]) {
            try {
              updateData.foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded updated food safety license: ${updateData.foodSafetyLicenseUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food safety license:', uploadError);
            }
          }

          if (files['foodEstablishmentCertFile']?.[0]) {
            try {
              updateData.foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
              console.log(`✅ Uploaded updated food establishment cert: ${updateData.foodEstablishmentCertUrl}`);
            } catch (uploadError) {
              console.error('❌ Failed to upload food establishment cert:', uploadError);
            }
          }
        }

        const updatedApplication = await firebaseStorage.updateChefKitchenApplicationDocuments(updateData);

        res.json({
          success: true,
          application: updatedApplication,
          message: 'Documents updated successfully. They will be reviewed by the manager.',
        });
      } catch (error) {
        console.error('Error updating kitchen application documents:', error);
        res.status(500).json({
          error: 'Failed to update documents',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  // =============================================================================
  // 👨‍🍳 MANAGER KITCHEN APPLICATIONS - Review Chef Applications
  // =============================================================================
  // These endpoints are for kitchen managers to review and approve/reject chef applications

  /**
   * 🔥 Get Kitchen Applications for Manager (Firebase Auth)
   * GET /api/manager/kitchen-applications
   * 
   * Returns all chef applications for locations managed by the authenticated manager.
   */
  app.get('/api/manager/kitchen-applications', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
      // Firebase auth verified by middleware - req.neonUser is guaranteed to be a manager
      const user = req.neonUser!;
      console.log(`👨‍🍳 GET /api/manager/kitchen-applications - Manager ${user.id}`);

      const applications = await firebaseStorage.getChefKitchenApplicationsForManager(user.id);

      res.json(applications);
    } catch (error) {
      console.error('Error getting kitchen applications for manager:', error);
      res.status(500).json({ error: 'Failed to get applications' });
    }
  });

  /**
   * 🔥 Get Kitchen Applications by Location (Firebase Auth)
   * GET /api/manager/kitchen-applications/location/:locationId
   * 
   * Returns all chef applications for a specific location.
   * Manager must have access to this location.
   */
  app.get('/api/manager/kitchen-applications/location/:locationId', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
      // Firebase auth verified by middleware - req.neonUser is guaranteed to be a manager
      const user = req.neonUser!;
      const locationId = parseInt(req.params.locationId);

      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'Invalid location ID' });
      }

      console.log(`👨‍🍳 GET /api/manager/kitchen-applications/location/${locationId} - Manager ${user.id}`);

      // Verify manager has access to this location
      const location = await firebaseStorage.getLocationById(locationId);
      if (!location || (location as any).managerId !== user.id) {
        return res.status(403).json({ error: 'Access denied to this location' });
      }

      const applications = await firebaseStorage.getChefKitchenApplicationsByLocationId(locationId);

      res.json(applications);
    } catch (error) {
      console.error('Error getting kitchen applications for location:', error);
      res.status(500).json({ error: 'Failed to get applications' });
    }
  });

  /**
   * 🔥 Review Kitchen Application (Approve/Reject) (Firebase Auth)
   * PATCH /api/manager/kitchen-applications/:id/status
   * 
   * Allows a manager to approve or reject a chef's kitchen application.
   */
  app.patch('/api/manager/kitchen-applications/:id/status', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
      // Firebase auth verified by middleware - req.neonUser is guaranteed to be a manager
      const user = req.neonUser!;
      const applicationId = parseInt(req.params.id);

      if (isNaN(applicationId)) {
        return res.status(400).json({ error: 'Invalid application ID' });
      }

      console.log(`👨‍🍳 PATCH /api/manager/kitchen-applications/${applicationId}/status - Manager ${user.id}`);

      // Validate request body
      const { status, feedback } = req.body;

      if (!status || !['approved', 'rejected', 'inReview'].includes(status)) {
        return res.status(400).json({ error: 'Status must be "approved", "rejected", or "inReview"' });
      }

      // Get the application
      const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Verify manager has access to this location
      const location = await firebaseStorage.getLocationById(application.locationId);
      if (!location || (location as any).managerId !== user.id) {
        return res.status(403).json({ error: 'Access denied to this application' });
      }

      // Update the status with tier support
      const updateData: any = { id: applicationId, status, feedback };
      if (req.body.current_tier !== undefined) {
        updateData.current_tier = req.body.current_tier;
      }
      if (req.body.tier_data !== undefined) {
        updateData.tier_data = req.body.tier_data;
      }

      const updatedApplication = await firebaseStorage.updateChefKitchenApplicationStatus(
        updateData,
        user.id
      );

      console.log(`✅ Application ${applicationId} ${status} by Manager ${user.id}`);

      // Handle tier transitions and chat initialization
      if (status === 'approved' && updatedApplication) {
        const currentTier = updatedApplication.current_tier ?? 1;
        const previousTier = application.current_tier ?? 1;

        // Notify tier transitions (handles initialization and system messages)
        if (currentTier > previousTier) {
          await notifyTierTransition(applicationId, previousTier, currentTier);
        }

        // Grant the chef access to this location
        try {
          // Check if chef already has access
          const existingAccess = await db
            .select()
            .from(chefLocationAccess)
            .where(
              and(
                eq(chefLocationAccess.chefId, application.chefId),
                eq(chefLocationAccess.locationId, application.locationId)
              )
            );

          if (existingAccess.length === 0) {
            // Grant access
            await db.insert(chefLocationAccess).values({
              chefId: application.chefId,
              locationId: application.locationId,
              grantedBy: req.neonUser!.id,
              grantedAt: new Date(),
            });
            console.log(`✅ Granted chef ${application.chefId} access to location ${application.locationId}`);
          } else {
            console.log(`ℹ️ Chef ${application.chefId} already has access to location ${application.locationId}`);
          }
        } catch (accessError) {
          console.error('Error granting chef access:', accessError);
          // Don't fail the request, just log the error
        }
      }

      // TODO: Send email notification to chef about the decision

      res.json({
        success: true,
        application: updatedApplication,
        message: `Application ${status} successfully`,
      });
    } catch (error) {
      console.error('Error updating kitchen application status:', error);
      res.status(500).json({
        error: 'Failed to update application status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * 🔥 Verify Kitchen Application Documents (Firebase Auth)
   * PATCH /api/manager/kitchen-applications/:id/verify-documents
   * 
   * Allows a manager to verify the uploaded documents (approve/reject individual docs).
   */
  app.patch('/api/manager/kitchen-applications/:id/verify-documents', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
      // Firebase auth verified by middleware - req.neonUser is guaranteed to be a manager
      const user = req.neonUser!;
      const applicationId = parseInt(req.params.id);

      if (isNaN(applicationId)) {
        return res.status(400).json({ error: 'Invalid application ID' });
      }

      console.log(`👨‍🍳 PATCH /api/manager/kitchen-applications/${applicationId}/verify-documents - Manager ${user.id}`);

      const { foodSafetyLicenseStatus, foodEstablishmentCertStatus } = req.body;

      // Validate statuses
      const validStatuses = ['pending', 'approved', 'rejected'];
      if (foodSafetyLicenseStatus && !validStatuses.includes(foodSafetyLicenseStatus)) {
        return res.status(400).json({ error: 'Invalid food safety license status' });
      }
      if (foodEstablishmentCertStatus && !validStatuses.includes(foodEstablishmentCertStatus)) {
        return res.status(400).json({ error: 'Invalid food establishment cert status' });
      }

      // Get the application
      const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Verify manager has access
      const location = await firebaseStorage.getLocationById(application.locationId);
      if (!location || (location as any).managerId !== user.id) {
        return res.status(403).json({ error: 'Access denied to this application' });
      }

      // Update document statuses
      const updateData: any = { id: applicationId };
      if (foodSafetyLicenseStatus) updateData.foodSafetyLicenseStatus = foodSafetyLicenseStatus;
      if (foodEstablishmentCertStatus) updateData.foodEstablishmentCertStatus = foodEstablishmentCertStatus;

      const updatedApplication = await firebaseStorage.updateChefKitchenApplicationDocuments(updateData);

      // Send system message when documents are verified
      if (updatedApplication?.chat_conversation_id) {
        const documentName = foodSafetyLicenseStatus === 'approved'
          ? 'Food Safety License'
          : foodEstablishmentCertStatus === 'approved'
            ? 'Food Establishment Certificate'
            : 'Document';
        if (foodSafetyLicenseStatus === 'approved' || foodEstablishmentCertStatus === 'approved') {
          await sendSystemNotification(
            updatedApplication.chat_conversation_id,
            'DOCUMENT_VERIFIED',
            { documentName }
          );
        }
      }

      res.json({
        success: true,
        application: updatedApplication,
        message: 'Document verification updated',
      });
    } catch (error) {
      console.error('Error verifying kitchen application documents:', error);
      res.status(500).json({
        error: 'Failed to verify documents',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // =============================================================================
  // 📋 LOCATION REQUIREMENTS - Custom Application Requirements per Location
  // =============================================================================

  /**
   * 🔥 Get Location Requirements (Manager)
   * GET /api/manager/locations/:locationId/requirements
   */
  app.get('/api/manager/locations/:locationId/requirements',
    requireFirebaseAuthWithUser,
    requireManager,
    async (req: Request, res: Response) => {
      try {
        const user = req.neonUser!;
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
          return res.status(400).json({ error: 'Invalid location ID' });
        }

        // Verify manager access
        const location = await firebaseStorage.getLocationById(locationId);
        if (!location || (location as any).managerId !== user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);
        res.json(requirements);
      } catch (error) {
        console.error('Error getting location requirements:', error);
        res.status(500).json({ error: 'Failed to get requirements' });
      }
    }
  );

  /**
   * 🔥 Update Location Requirements (Manager)
   * PUT /api/manager/locations/:locationId/requirements
   */
  app.put('/api/manager/locations/:locationId/requirements',
    requireFirebaseAuthWithUser,
    requireManager,
    async (req: Request, res: Response) => {
      try {
        const user = req.neonUser!;
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
          return res.status(400).json({ error: 'Invalid location ID' });
        }

        // Verify manager access
        const location = await firebaseStorage.getLocationById(locationId);
        if (!location || (location as any).managerId !== user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Validate request body with Zod schema
        const parseResult = updateLocationRequirementsSchema.safeParse(req.body);
        if (!parseResult.success) {
          const validationError = fromZodError(parseResult.error);
          console.error('❌ Validation error updating location requirements:', validationError.message);
          return res.status(400).json({
            error: 'Validation error',
            message: validationError.message,
            details: validationError.details
          });
        }

        const updates = parseResult.data;
        const requirements = await firebaseStorage.upsertLocationRequirements(locationId, updates);

        console.log(`✅ Location requirements updated for location ${locationId} by manager ${user.id}`);
        res.json({ success: true, requirements });
      } catch (error) {
        // Safe error logging - handle circular references and unusual error structures
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('❌ Error updating location requirements:', errorMessage);
        if (errorStack) {
          console.error('Stack trace:', errorStack);
        }
        res.status(500).json({
          error: 'Failed to update requirements',
          message: errorMessage
        });
      }
    }
  );

  /**
   * 🔥 Get Location Requirements (Public - for chefs)
   * GET /api/public/locations/:locationId/requirements
   */
  app.get('/api/public/locations/:locationId/requirements', async (req: Request, res: Response) => {
    try {
      const locationId = parseInt(req.params.locationId);

      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'Invalid location ID' });
      }

      const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);
      res.json(requirements);
    } catch (error) {
      console.error('Error getting location requirements:', error);
      res.status(500).json({ error: 'Failed to get requirements' });
    }
  });

  /**
   * 🔥 Update Application Tier (Manager)
   * PATCH /api/manager/kitchen-applications/:id/tier
   * 
   * Allows managers to advance applications to the next tier
   */
  app.patch('/api/manager/kitchen-applications/:id/tier', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
      const user = req.neonUser!;
      const applicationId = parseInt(req.params.id);

      if (isNaN(applicationId)) {
        return res.status(400).json({ error: 'Invalid application ID' });
      }

      // Validate request body
      const parsed = updateApplicationTierSchema.safeParse({
        id: applicationId,
        ...req.body,
      });

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation error',
          message: parsed.error.message,
        });
      }

      // Get the application
      const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Verify manager has access
      const location = await firebaseStorage.getLocationById(application.locationId);
      if (!location || (location as any).managerId !== user.id) {
        return res.status(403).json({ error: 'Access denied to this application' });
      }

      // Update tier
      const updatedApplication = await firebaseStorage.updateApplicationTier(
        applicationId,
        parsed.data.current_tier,
        parsed.data.tier_data
      );

      // Send system notification for tier transition
      if (updatedApplication?.chat_conversation_id) {
        const fromTier = application.current_tier ?? 1;
        const toTier = parsed.data.current_tier;
        await notifyTierTransition(applicationId, fromTier, toTier);
      }

      res.json({
        success: true,
        application: updatedApplication,
        message: `Application advanced to Tier ${parsed.data.current_tier}`,
      });
    } catch (error) {
      console.error('Error updating application tier:', error);
      res.status(500).json({
        error: 'Failed to update application tier',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Firebase microlearning completion endpoint
  // Note: :userId can be either a Neon numeric ID or a Firebase UID
  app.get('/api/firebase/microlearning/completion/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const userIdParam = req.params.userId;
      const currentUserId = req.neonUser!.id;
      const currentFirebaseUid = req.firebaseUser!.uid;

      // Determine if the request is for the current user
      // Support both Neon numeric ID and Firebase UID for compatibility
      const isNumeric = !isNaN(parseInt(userIdParam));
      const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
      const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
      const isAdmin = req.neonUser!.role === 'admin';

      // Verify user can access this completion (either their own or admin)
      if (!isOwnData && !isAdmin) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Use the current user's Neon ID for own data, or the requested ID for admin
      const targetUserId = isOwnData ? currentUserId : requestedUserId;
      if (!targetUserId) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      const completion = await firebaseStorage.getMicrolearningCompletion(targetUserId);

      if (!completion) {
        return res.status(404).json({ message: 'No completion found' });
      }

      res.json(completion);
    } catch (error) {
      console.error('Error getting microlearning completion status:', error);
      res.status(500).json({ message: 'Failed to get completion status' });
    }
  });

  // Firebase microlearning certificate endpoint
  // Note: :userId can be either a Neon numeric ID or a Firebase UID
  app.get('/api/firebase/microlearning/certificate/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const userIdParam = req.params.userId;
      const currentUserId = req.neonUser!.id;
      const currentFirebaseUid = req.firebaseUser!.uid;

      // Determine if the request is for the current user
      // Support both Neon numeric ID and Firebase UID for compatibility
      const isNumeric = !isNaN(parseInt(userIdParam));
      const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
      const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
      const isAdmin = req.neonUser!.role === 'admin';

      // Verify user can access this certificate (either their own or admin)
      if (!isOwnData && !isAdmin) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Use the current user's Neon ID for own data, or the requested ID for admin
      const targetUserId = isOwnData ? currentUserId : requestedUserId;
      if (!targetUserId) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      const completion = await firebaseStorage.getMicrolearningCompletion(targetUserId);
      if (!completion || !completion.confirmed) {
        return res.status(404).json({ message: 'No confirmed completion found' });
      }

      const user = await firebaseStorage.getUser(targetUserId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Return certificate URL
      const certificateUrl = `/api/certificates/microlearning-${targetUserId}-${Date.now()}.pdf`;

      res.json({
        success: true,
        certificateUrl,
        completionDate: completion.completedAt,
        message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl'
      });
    } catch (error) {
      console.error('Error getting microlearning certificate:', error);
      res.status(500).json({ message: 'Failed to get certificate' });
    }
  });

  // Firebase microlearning progress by userId (GET)
  // Note: :userId can be either a Neon numeric ID or a Firebase UID
  app.get('/api/firebase/microlearning/progress/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const userIdParam = req.params.userId;
      const currentUserId = req.neonUser!.id;
      const currentFirebaseUid = req.firebaseUser!.uid;

      // Determine if the request is for the current user
      // Support both Neon numeric ID and Firebase UID for compatibility
      const isNumeric = !isNaN(parseInt(userIdParam));
      const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
      const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
      const isAdmin = req.neonUser!.role === 'admin';

      // Verify user can access this data (either their own or admin)
      if (!isOwnData && !isAdmin) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Use the current user's Neon ID for own data, or the requested ID for admin
      const targetUserId = isOwnData ? currentUserId : requestedUserId;
      if (!targetUserId) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      const progress = await firebaseStorage.getMicrolearningProgress(targetUserId);
      const completionStatus = await firebaseStorage.getMicrolearningCompletion(targetUserId);

      // Check if user has approved application
      const applications = await firebaseStorage.getApplicationsByUserId(targetUserId);
      const hasApproval = applications.some((app: any) => app.status === 'approved');

      const isCompleted = completionStatus?.confirmed || false;
      const accessLevel = isAdmin || hasApproval || isCompleted ? 'full' : 'limited';

      res.json({
        success: true,
        progress: progress || [],
        completionConfirmed: completionStatus?.confirmed || false,
        completedAt: completionStatus?.completedAt,
        hasApprovedApplication: hasApproval,
        accessLevel: accessLevel,
        isAdmin: isAdmin
      });
    } catch (error) {
      console.error('Error fetching microlearning progress:', error);
      res.status(500).json({ message: 'Failed to fetch progress' });
    }
  });

  // Firebase microlearning complete endpoint
  app.post('/api/firebase/microlearning/complete', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
      const { userId, completionDate, videoProgress } = req.body;
      const currentUserId = req.neonUser!.id;

      // Verify user can complete this (either their own or admin)
      if (currentUserId !== userId && req.neonUser!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if user has approved application
      const applications = await firebaseStorage.getApplicationsByUserId(userId);
      const hasApproval = applications.some((app: any) => app.status === 'approved');
      const isAdmin = req.neonUser!.role === 'admin';

      if (!hasApproval && !isAdmin) {
        return res.status(403).json({
          message: 'Application approval required to complete full certification',
          accessLevel: 'limited',
          requiresApproval: true
        });
      }

      // Verify all required videos are completed
      const requiredVideos = [
        'basics-personal-hygiene', 'basics-temperature-danger', 'basics-cross-contamination',
        'basics-allergen-awareness', 'basics-food-storage', 'basics-cooking-temps',
        'basics-cooling-reheating', 'basics-thawing', 'basics-receiving', 'basics-fifo',
        'basics-illness-reporting', 'basics-pest-control', 'basics-chemical-safety', 'basics-food-safety-plan',
        'howto-handwashing', 'howto-sanitizing', 'howto-thermometer', 'howto-cleaning-schedule',
        'howto-equipment-cleaning', 'howto-uniform-care', 'howto-wound-care', 'howto-inspection-prep'
      ];
      const completedVideos = videoProgress.filter((v: any) => v.completed).map((v: any) => v.videoId);
      const allRequired = requiredVideos.every((videoId: string) => completedVideos.includes(videoId));

      if (!allRequired) {
        return res.status(400).json({
          message: 'All required videos must be completed before certification',
          missingVideos: requiredVideos.filter(id => !completedVideos.includes(id))
        });
      }

      const user = await firebaseStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const completionData = {
        userId,
        completedAt: new Date(completionDate),
        videoProgress,
        confirmed: true,
        certificateGenerated: false
      };

      await firebaseStorage.createMicrolearningCompletion(completionData);

      res.json({
        success: true,
        message: 'Microlearning completed successfully',
        completionConfirmed: true
      });
    } catch (error) {
      console.error('Error completing microlearning:', error);
      res.status(500).json({ message: 'Failed to complete microlearning' });
    }
  });

  // Firebase upload file endpoint (alias for /api/upload)
  app.post('/api/firebase/upload-file',
    upload.single('file'),
    requireFirebaseAuthWithUser,
    handleFileUpload
  );

  console.log('🔥 Firebase authentication routes registered successfully');
  console.log('✨ Session-free architecture active - JWT tokens only');
  console.log('⚙️ Admin platform settings endpoints registered successfully');
  console.log('🍳 Chef kitchen application endpoints registered successfully');
} 