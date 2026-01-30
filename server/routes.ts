import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import {
  generateApplicationWithDocumentsEmail,
  generateApplicationWithoutDocumentsEmail,
  generateChefAllDocumentsApprovedEmail,
  generateDocumentStatusChangeEmail,
  generatePromoCodeEmail,
  generateStatusChangeEmail,
  sendEmail,
  generateManagerMagicLinkEmail,
  generateManagerCredentialsEmail,
  generateBookingNotificationEmail,
  generateBookingRequestEmail,
  generateBookingConfirmationEmail,
  generateBookingCancellationEmail,
  generateKitchenAvailabilityChangeEmail,
  generateKitchenSettingsChangeEmail,
  generateChefProfileRequestEmail,
  generateChefLocationAccessApprovedEmail,
  generateChefKitchenAccessApprovedEmail,
  generateBookingCancellationNotificationEmail,
  generateBookingStatusChangeNotificationEmail,
  generateLocationEmailChangedEmail
} from "./email";
import {
  sendSMS,
  generateManagerBookingSMS,
  generateManagerPortalBookingSMS,
  generateChefBookingConfirmationSMS,
  generateChefBookingCancellationSMS,
  generatePortalUserBookingConfirmationSMS,
  generatePortalUserBookingCancellationSMS,
  generateManagerBookingCancellationSMS,
  generateChefSelfCancellationSMS
} from "./sms";
import { getManagerPhone, getChefPhone, getPortalUserPhone, normalizePhoneForStorage } from "./phone-utils";
import { deleteFile, getFileUrl, upload, uploadToBlob } from "./fileUpload";
import { comparePasswords, hashPassword } from "./passwordUtils";
// import { storage } from "./storage";

import { verifyFirebaseToken } from "./firebase-setup";
import { requireFirebaseAuthWithUser, requireManager, requireAdmin, optionalFirebaseAuth } from "./firebase-auth-middleware";
import { deleteConversation } from "./chat-service";
import { pool, db } from "./db";
import { getPresignedUrl } from "./r2-storage";
import { requireChef } from "./routes/middleware";
import { normalizeImageUrl } from "./routes/utils";

import { UserRepository } from "./domains/users/user.repository";
import { UserService } from "./domains/users/user.service";

// Note: Express Request.user type is already defined by @types/passport
// We use type assertions where needed for isChef properties

// Helper function to get authenticated user (supports both session and Firebase auth)


/**
 * Normalizes image URLs to ensure they work in both development and production.
 * Converts relative paths to absolute URLs when needed.
 * Handles R2 custom domain URLs by converting them to API proxy URLs.
 * 
 * @param url - The image URL to normalize (can be null, undefined, or a string)
 * @param req - Express request object to get the origin/host
 * @returns Normalized absolute URL or null if input was null/undefined
 */
// function normalizeImageUrl moved to ./routes/utils

export async function registerRoutes(app: Express): Promise<Server> {
  console.log("[Routes] Registering all routes including chef-kitchen-access and portal user routes...");
  // Set up authentication routes and middleware
  // Session auth removed in favor of Firebase Auth

  // Enable optional Firebase auth globally for all routes
  // This populates req.firebaseUser and req.neonUser if a token is present
  app.use(optionalFirebaseAuth);





  // NOTE: Google OAuth now handled entirely by Firebase Auth
  // No session-based Google OAuth needed for users

  // Mount Auth Router (Legacy - removed in favor of Firebase Auth)
  // app.use("/api/auth", (await import("./routes/auth")).default);

  // Mount User Router (profile, onboarding)
  app.use("/api/user", (await import("./routes/user")).default);

  // Legacy logout endpoint alias (frontend calls /api/logout)
  app.post("/api/logout", (req, res) => {
    console.log("🚪 Logout request received (Firebase Auth is stateless)");
    res.json({ success: true, message: "Logged out successfully" });
  });

  // Mount Applications Router
  app.use("/api/applications", (await import("./routes/applications")).default);

  // Mount Locations Router
  app.use("/api", (await import("./routes/locations")).default);

  // Mount Microlearning Router
  app.use("/api/microlearning", (await import("./routes/microlearning")).default);
  // Also mount at /api/firebase/microlearning for chef frontend compatibility
  app.use("/api/firebase/microlearning", (await import("./routes/microlearning")).default);


  // Mount Files Router
  app.use("/api/files", (await import("./routes/files")).default);

  const userRepo = new UserRepository();
  const userService = new UserService(userRepo);

  // Check if user exists by username (for Google+password flow)
  app.get("/api/user-exists", async (req, res) => {
    const username = req.query.username as string;
    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }
    const exists = await userService.checkUsernameExists(username);
    res.json({ exists });
  });

  // Get current user from Firebase auth (used by manager applications page)
  app.get("/api/firebase/user/me", requireFirebaseAuthWithUser, async (req, res) => {
    try {
      const user = req.neonUser!;
      res.json({
        ...user,
        is_verified: user.isVerified,
        has_seen_welcome: user.has_seen_welcome
      });
    } catch (error) {
      console.error("[API] Error getting user:", error);
      res.status(500).json({ error: "Failed to get user info" });
    }
  });

  // Sync User (Firebase -> Neon) - Legacy endpoint, delegates to /api/user/sync
  // Called after Firebase login to ensure user exists in Neon and update metadata
  app.post("/api/firebase-sync-user", requireFirebaseAuthWithUser, async (req, res) => {
    try {
      let user = req.neonUser!;
      
      // CRITICAL: Update is_verified status if Firebase reports email is verified
      const firebaseEmailVerified = req.firebaseUser?.email_verified;
      if (firebaseEmailVerified && !user.isVerified) {
        console.log(`📧 Updating is_verified for user ${user.id} - Firebase email verified`);
        const updatedUser = await userService.updateUser(user.id, { isVerified: true });
        if (updatedUser) {
          user = updatedUser;
        }
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error syncing user:", error);
      res.status(500).json({ error: "Failed to sync user" });
    }
  });

  // Register User (Firebase -> Neon)
  // Called when a new Firebase user signs up
  app.post("/api/firebase-register-user", async (req, res) => {
    try {
      // Manually verify token since we don't have a user in DB yet
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
      }

      const token = authHeader.split("Bearer ")[1];
      const decodedToken = await verifyFirebaseToken(token);

      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }

      const { email, uid, role, ...otherData } = req.body;

      if (decodedToken.uid !== uid) {
        return res.status(403).json({ error: "Token mismatch" });
      }

      // Check if user already exists by Firebase UID
      const existingByUid = await userService.getUserByFirebaseUid(uid);
      if (existingByUid) {
        console.log(`✅ User already exists with Firebase UID ${uid}, returning existing user`);
        return res.json(existingByUid);
      }

      // ENTERPRISE FIX: Also check if user exists by email/username
      // This handles the case where user was deleted from Firebase but not Neon, or vice versa
      const existingByUsername = await userService.getUserByUsername(email);
      if (existingByUsername) {
        // User exists in Neon but with different/no Firebase UID
        // Link the new Firebase account to existing Neon user
        if (!existingByUsername.firebaseUid) {
          console.log(`🔗 Linking Firebase UID ${uid} to existing Neon user ${existingByUsername.id}`);
          const updatedUser = await userService.updateUser(existingByUsername.id, { 
            firebaseUid: uid,
            isVerified: decodedToken.email_verified || existingByUsername.isVerified
          });
          return res.json(updatedUser || existingByUsername);
        } else if (existingByUsername.firebaseUid !== uid) {
          // User exists with a DIFFERENT Firebase UID - this is a conflict
          // The old Firebase account may have been deleted and user is re-registering
          console.log(`⚠️ User ${email} exists with different Firebase UID. Old: ${existingByUsername.firebaseUid}, New: ${uid}`);
          console.log(`🔄 Updating Firebase UID to new account (user may have re-registered in Firebase)`);
          const updatedUser = await userService.updateUser(existingByUsername.id, { 
            firebaseUid: uid,
            isVerified: decodedToken.email_verified || false // Reset verification for new Firebase account
          });
          return res.json(updatedUser || existingByUsername);
        }
        // Same Firebase UID - just return existing user
        return res.json(existingByUsername);
      }

      // Create new user - no existing user found
      console.log(`📝 Creating new user: ${email} with role: ${role || 'user'}`);
      const finalRole = role || "user";
      const newUser = await userService.createUser({
        username: email,
        firebaseUid: uid,
        role: finalRole,
        isVerified: decodedToken.email_verified || false,
        ...otherData
      });

      // Send registration emails
      try {
        const { sendEmail, generateWelcomeEmail, generateNewUserRegistrationAdminEmail } = await import('./email');
        const { db } = await import('./db');
        const { users } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        
        const displayName = otherData.displayName || email.split('@')[0];
        
        // Always send welcome email to new users (all roles: chef, manager, admin)
        console.log(`📧 Sending welcome email to new ${finalRole}: ${email}`);
        const welcomeEmail = generateWelcomeEmail({
          fullName: displayName,
          email
        });
        const welcomeSent = await sendEmail(welcomeEmail, {
          trackingId: `welcome_${finalRole}_${email}_${Date.now()}`
        });
        if (welcomeSent) {
          console.log(`✅ Welcome email sent to new ${finalRole}: ${email}`);
        } else {
          console.log(`❌ Failed to send welcome email to ${email}`);
        }
        
        // Send notification to admins about new user registration
        const admins = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.role, 'admin'));
        
        for (const admin of admins) {
          if (admin.username && admin.username !== email) {
            const adminEmail = generateNewUserRegistrationAdminEmail({
              adminEmail: admin.username,
              newUserName: displayName,
              newUserEmail: email,
              userRole: finalRole,
              registrationDate: new Date(),
            });
            const adminSent = await sendEmail(adminEmail, {
              trackingId: `new_user_admin_${admin.username}_${Date.now()}`
            });
            if (adminSent) {
              console.log(`✅ Admin notification sent to ${admin.username} about new ${finalRole} registration`);
            }
          }
        }
      } catch (emailError) {
        console.error('❌ Error sending registration emails:', emailError);
        // Don't fail registration if email fails
      }

      res.status(201).json(newUser);
    } catch (error: any) {
      console.error("Error registering user:", error);
      
      // Provide more specific error messages
      if (error.message?.includes('already taken') || error.code === '23505') {
        return res.status(409).json({ 
          error: "Email already registered", 
          code: "EMAIL_EXISTS",
          message: "This email is already registered. Please try signing in instead."
        });
      }
      
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  // Unsubscribe endpoint - public endpoint for email unsubscribe requests
  app.post('/api/unsubscribe', async (req: Request, res: Response) => {
    try {
      const { email, reason, feedback, timestamp } = req.body;

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
  });


  // ===================================
  // KITCHEN BOOKING SYSTEM - MANAGER ROUTES
  // ===================================

  // IMPORTANT: Put route must be defined BEFORE get route with same base path
  // to avoid Express routing conflicts. Specific routes must come before generic ones.

  // ===================================
  // MANAGER ROUTES
  // ===================================
  // All manager routes are now handled in ./routes/manager.ts
  app.use("/api/manager", (await import("./routes/manager")).default);
  
  // Manager notifications routes
  app.use("/api/manager/notifications", (await import("./routes/notifications")).default);

  // ===================================
  // KITCHEN BOOKING SYSTEM - CHEF ROUTES
  // ===================================

  // Middleware (requireChef) moved to ./routes/middleware
  // It is now imported at the top level

  // Chef notifications routes
  app.use("/api/chef/notifications", (await import("./routes/chef-notifications")).default);

  // Mount Kitchens Router
  app.use("/api", (await import("./routes/kitchens")).default);

  // Payment endpoints
  // Create PaymentIntent for booking

  // Mount Bookings Router
  app.use("/api", (await import("./routes/bookings")).default);

  // Mount Equipment Router (includes /manager/... and /chef/... paths)
  app.use("/api", (await import("./routes/equipment")).default);

  // Mount Storage Listings Router (includes /manager/... and /chef/... paths)
  app.use("/api", (await import("./routes/storage-listings")).default);

  // share-profile and profiles routes moved to kitchens.ts

  // ===================================
  // ADMIN ROUTES
  // ===================================
  // All admin routes are now handled in ./routes/admin.ts
  app.use("/api/admin", (await import("./routes/admin")).default);


  // ===================================
  // WEBHOOK ROUTES
  // ===================================
  app.use("/api/webhooks", (await import("./routes/webhooks")).default);


  // ===============================
  // PORTAL USER AUTHENTICATION ROUTES
  // ===============================
  // Extracted to ./routes/portal-auth.ts
  app.use("/api", (await import("./routes/portal-auth")).default);


  // ===============================
  // PORTAL ROUTES
  // ===============================
  app.use("/api/portal", (await import("./routes/portal")).default);





  // Chef Routes
  app.use("/api/chef", (await import("./routes/chef")).default);

  const httpServer = createServer(app);
  return httpServer;
}
