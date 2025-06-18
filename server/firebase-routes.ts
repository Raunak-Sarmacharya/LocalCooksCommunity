import { insertApplicationSchema } from '@shared/schema';
import { Express, Request, Response } from 'express';
import { fromZodError } from 'zod-validation-error';
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
        role: role || 'applicant'
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

      // Import Firebase Admin
      const { admin } = await import('./firebase-admin');
      
      if (!admin) {
        console.error('Firebase Admin not initialized');
        return res.status(500).json({ 
          message: "Password reset service unavailable. Please try again later." 
        });
      }

      try {
        // Check if user exists in Firebase
        const userRecord = await admin.auth().getUserByEmail(email);
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
        const resetLink = await admin.auth().generatePasswordResetLink(email, {
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

      // Import Firebase Admin
      const { admin } = await import('./firebase-admin');
      
      if (!admin) {
        console.error('Firebase Admin not initialized');
        return res.status(500).json({ 
          message: "Password reset service unavailable. Please try again later." 
        });
      }

      try {
        // Verify the reset code and get the email
        const email = await admin.auth().verifyPasswordResetCode(oobCode);
        console.log(`✅ Password reset code verified for: ${email}`);

        // Confirm the password reset
        await admin.auth().confirmPasswordReset(oobCode, newPassword);
        console.log(`✅ Password reset confirmed for: ${email}`);

        // Update the password hash in our Neon database for consistency
        const userRecord = await admin.auth().getUserByEmail(email);
        const neonUser = await firebaseStorage.getUserByFirebaseUid(userRecord.uid);
        
        if (neonUser) {
          // Hash the new password and update in Neon DB
          const bcrypt = await import('bcryptjs');
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
          role: role || 'applicant'
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
      
      res.json({
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
        stats: {
          totalApplications: applications.length,
          approvedApplications: applications.filter(app => app.status === 'approved').length,
          completedLessons: microlearningProgress.length
        }
      });
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({ error: 'Failed to get dashboard data' });
    }
  });

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

  console.log('🔥 Firebase authentication routes registered successfully');
  console.log('✨ Session-free architecture active - JWT tokens only');
} 