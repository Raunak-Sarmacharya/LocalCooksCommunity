import { CURRENT_POLICY_VERSION } from "../shared/policy-config";

import { logger } from "./logger";
import { User } from '@shared/schema';
import { userService } from './domains/users/user.service';

export interface FirebaseUserData {
  uid: string;
  email: string | null;
  displayName?: string;
  emailVerified: boolean;
  role?: 'admin' | 'chef' | 'manager';
}

interface CreateUserData {
  username: string;
  password: string;
  role: 'admin' | 'chef' | 'manager';
  isChef: boolean;
  isManager: boolean;
  isPortalUser: boolean;
  firebaseUid: string;
  isVerified: boolean;
  hasSeenWelcome?: boolean;
  managerProfileData: Record<string, any>;
  termsAccepted?: boolean;
  termsAcceptedAt?: Date;
  termsVersion?: string;

}

/**
 * Sync Firebase user to Neon database
 * This is the core translation function: Firebase UID ↔ Neon User ID
 * NO SESSIONS REQUIRED - Pure stateless JWT architecture
 */
export async function syncFirebaseUserToNeon(params: {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName?: string;
  role?: string;
}): Promise<User> {
  const { uid, email, emailVerified, displayName, role } = params;

  // Determine if user should be marked as verified
  // Google users are automatically verified, email/password users need email verification
  const isGoogleUser = emailVerified === true;
  const isUserVerified = isGoogleUser; // Only Google users are pre-verified

  logger.info(`🔄 SYNC TO NEON: Firebase UID ${uid} → Neon database`);
  logger.info(`   - Email: ${email}`);
  logger.info(`   - Email Verified (Firebase): ${emailVerified}`);
  logger.info(`   - Is Google User: ${isGoogleUser}`);
  logger.info(`   - Setting is_verified: ${isUserVerified}`);
  logger.info(`   - Role: ${role}`);

  if (!email) {
    throw new Error('Email is required for user sync');
  }

  try {
    // Check if user already exists by Firebase UID
    const existingUser = await userService.getUserByFirebaseUid(uid);
    if (existingUser) {
      logger.info(`✅ EXISTING USER FOUND: ${existingUser.id} (${existingUser.username})`);
      return existingUser;
    }

    // Handle role assignment - manager role is separate from chef
    let finalRole: 'admin' | 'chef' | 'manager';
    let isChef = false;
    let isManager = false;

    // Log the role received for debugging
    logger.info(`🔍 Role received in syncFirebaseUserToNeon: "${role}"`);

    // CRITICAL: Don't default to 'chef' - this causes admins/managers to be created as chefs
    if (!role || role === 'null' || role === 'undefined') {
      logger.error(`❌ ERROR: No role provided in syncFirebaseUserToNeon during registration. Cannot create user without role.`);
      logger.error(`   - Received role value: ${role}`);
      logger.error(`   - This should not happen - role should be detected from URL path in frontend`);
      throw new Error('Role is required for user registration. Please register from the appropriate page (admin, manager, or chef).');
    }

    if (role === 'admin') {
      finalRole = 'admin';
      isChef = true;
      logger.info(`🎯 Admin role assignment: role="admin" → isChef=true (admin has full access)`);
    } else if (role === 'manager') {
      finalRole = 'manager';
      isManager = true;
      logger.info(`🎯 Manager role assignment: role="manager" → isManager=true`);
    } else if (role === 'chef') {
      finalRole = 'chef';
      isChef = true;
      logger.info(`🎯 Chef role assignment: role="chef" → isChef=true`);
    } else {
      // Unknown role value - don't default, throw error
      logger.error(`❌ ERROR: Unknown role value "${role}" in syncFirebaseUserToNeon`);
      throw new Error(`Invalid role: ${role}. Valid roles are: admin, manager, chef`);
    }

    // Admins and managers should skip the welcome screen
    const hasSeenWelcome = finalRole === 'admin' || finalRole === 'manager';

    const userData: CreateUserData = {
      username: email, // Always use email as username to ensure consistency
      password: '', // Empty for Firebase users
      role: finalRole,
      isChef: isChef, // Set correctly based on role (admin or chef)
      isManager: isManager, // Set correctly for manager role
      isPortalUser: false,
      firebaseUid: uid,
      isVerified: isUserVerified, // Google users are verified, email/password users need verification
      hasSeenWelcome: hasSeenWelcome, // Admins and managers skip welcome screen
      managerProfileData: {},
      termsAccepted: true,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_POLICY_VERSION,

    };

    logger.info(`➕ CREATING NEW USER with data:`, userData);
    let newUser = await userService.createUser({
      ...userData,
      has_seen_welcome: hasSeenWelcome
    });

    // createUser strips privileged flags (isChef/isManager). Set them after insert
    // so newly registered chefs are actually chefs in Neon.
    const flaggedUser = await userService.updateUser(newUser.id, {
      isChef,
      isManager,
    });
    if (flaggedUser) {
      newUser = flaggedUser;
    }

    logger.info(`✅ USER CREATED: ${newUser.id} (${newUser.username})`);
    logger.info(`   - is_verified in DB: ${(newUser as any).isVerified}`);
    logger.info(`   - isChef in DB: ${(newUser as any).isChef}`);
    logger.info(`   - has_seen_welcome in DB: ${(newUser as any).has_seen_welcome} (admins/managers skip welcome screen)`);

    // In-app welcome for new chefs (bell / notification center)
    if (isChef) {
      try {
        const { notificationService } = await import("./services/notification.service");
        await notificationService.notifyChefWelcome(
          newUser.id,
          displayName || email.split("@")[0] || "Chef"
        );
      } catch (welcomeNotifErr) {
        logger.warn(`Failed to create chef welcome notification for ${newUser.id}:`, welcomeNotifErr);
      }
    }

    // Handle email notifications based on user type
    if (!isGoogleUser && email) {
      logger.info(`📧 Email/password user - Firebase will handle verification email for ${email}`);
      // Firebase's sendEmailVerification() will be called from the frontend
      // Welcome email will be sent after verification via /api/sync-verification-status
    } else if (isGoogleUser && email) {
      logger.info(`📧 SENDING WELCOME EMAIL for Google user: ${email}`);
      try {
        // ENTERPRISE: Send welcome email for Google users since they don't get verification emails
        // Mark welcomeEmailSentAt for idempotency
        const { sendEmail, generateWelcomeEmail } = await import('./email');
        const emailContent = generateWelcomeEmail({
          fullName: displayName || email.split('@')[0],
          email,
          role: finalRole as 'chef' | 'manager' | 'admin'
        });

        const emailSent = await sendEmail(emailContent, {
          trackingId: `google_welcome_${email}_${Date.now()}`
        });

        if (emailSent) {
          // ENTERPRISE: Mark welcome email as sent with timestamp (idempotency)
          await userService.updateUser(newUser.id, { welcomeEmailSentAt: new Date() });
          logger.info(`✅ Welcome email sent to Google user: ${email}`);
        } else {
          logger.error(`❌ Failed to send welcome email to Google user: ${email}`);
        }
      } catch (emailError) {
        logger.error('❌ Error sending welcome email to Google user:', emailError);
        // Don't fail user creation if email fails
      }
    }

    // Send notification to admins about new user registration
    try {
      const { sendEmail, generateNewUserRegistrationAdminEmail } = await import('./email');
      const { db } = await import('./db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // Get all admin users to notify
      const admins = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.role, 'admin'));
      
      for (const admin of admins) {
        if (admin.username && admin.username !== email) {
          const adminEmail = generateNewUserRegistrationAdminEmail({
            adminEmail: admin.username,
            newUserName: displayName || email.split('@')[0],
            newUserEmail: email,
            userRole: finalRole,
            registrationDate: new Date(),
          });
          await sendEmail(adminEmail, {
            trackingId: `new_user_admin_notify_${admin.username}_${Date.now()}`
          });
          logger.info(`✅ Admin notification sent to ${admin.username} about new ${finalRole} registration`);
        }
      }
    } catch (adminNotifyError) {
      logger.error('❌ Error sending admin notification for new user:', adminNotifyError);
      // Don't fail user creation if admin notification fails
    }

    return newUser;
  } catch (error) {
    logger.error('❌ Error in syncFirebaseUserToNeon:', error);
    throw error;
  }
}

/**
 * Get Neon user ID from Firebase UID
 * This is the key translation function used throughout the app
 * NO SESSIONS - Direct Firebase UID → Neon User ID lookup
 */
export async function getNeonUserIdFromFirebaseUid(firebaseUid: string): Promise<number | null> {
  try {
    const user = await userService.getUserByFirebaseUid(firebaseUid);
    return user ? user.id : null;
  } catch (error) {
    logger.error('❌ Error getting Neon user ID from Firebase UID:', error);
    return null;
  }
}

/**
 * Ensure user exists in Neon DB for a Firebase user
 * Auto-creates if needed - NO SESSIONS REQUIRED
 */
export async function ensureNeonUserExists(userData: FirebaseUserData): Promise<User | null> {
  try {
    return await syncFirebaseUserToNeon({
      uid: userData.uid,
      email: userData.email,
      emailVerified: userData.emailVerified,
      displayName: userData.displayName,
      role: userData.role
    });
  } catch (error) {
    logger.error('❌ Error ensuring Neon user exists:', error);
    return null;
  }
} 