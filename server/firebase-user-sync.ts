import { User } from '@shared/schema';
import { firebaseStorage } from './storage-firebase';

export interface FirebaseUserData {
  uid: string;
  email: string | null;
  displayName?: string;
  emailVerified: boolean;
  role?: 'admin' | 'chef' | 'delivery_partner';
}

interface CreateUserData {
  username: string;
  password: string;
  role: 'admin' | 'chef' | 'delivery_partner';
  isChef: boolean;
  isDeliveryPartner: boolean;
  firebaseUid: string;
  isVerified: boolean;
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

  console.log(`🔄 SYNC TO NEON: Firebase UID ${uid} → Neon database`);
  console.log(`   - Email: ${email}`);
  console.log(`   - Email Verified (Firebase): ${emailVerified}`);
  console.log(`   - Is Google User: ${isGoogleUser}`);
  console.log(`   - Setting is_verified: ${isUserVerified}`);
  console.log(`   - Role: ${role}`);

  if (!email) {
    throw new Error('Email is required for user sync');
  }

  try {
    // Check if user already exists by Firebase UID
    const existingUser = await firebaseStorage.getUserByFirebaseUid(uid);
    if (existingUser) {
      console.log(`✅ EXISTING USER FOUND: ${existingUser.id} (${existingUser.username})`);
      return existingUser;
    }

    // Create new user with NO default roles - let them choose
    const userData: CreateUserData = {
      username: displayName || email,
      password: '', // Empty for Firebase users
      role: (role === 'admin' || role === 'chef' || role === 'delivery_partner') ? role : 'chef', // Use provided role or default to chef
      isChef: false, // No default roles - user must choose
      isDeliveryPartner: false, // No default roles - user must choose
      firebaseUid: uid,
      isVerified: isUserVerified, // Google users are verified, email/password users need verification
    };

    console.log(`➕ CREATING NEW USER with data:`, userData);
    const newUser = await firebaseStorage.createUser(userData);
    console.log(`✅ USER CREATED: ${newUser.id} (${newUser.username})`);
    console.log(`   - is_verified in DB: ${(newUser as any).isVerified}`);

    // Handle email notifications based on user type
    if (!isGoogleUser && email) {
      console.log(`📧 Email/password user - Firebase will handle verification email for ${email}`);
      // Firebase's sendEmailVerification() will be called from the frontend
      // No custom nodemailer email needed for email/password users
    } else if (isGoogleUser && email) {
      console.log(`📧 SENDING WELCOME EMAIL for Google user: ${email}`);
      try {
        // Send welcome email for Google users since they don't get verification emails
        const { sendEmail, generateWelcomeEmail } = await import('./email.js');
        const emailContent = generateWelcomeEmail({
          fullName: displayName || email.split('@')[0],
          email
        });

        const emailSent = await sendEmail(emailContent, {
          trackingId: `google_welcome_${email}_${Date.now()}`
        });

        if (emailSent) {
          console.log(`✅ Welcome email sent to Google user: ${email}`);
        } else {
          console.error(`❌ Failed to send welcome email to Google user: ${email}`);
        }
      } catch (emailError) {
        console.error('❌ Error sending welcome email to Google user:', emailError);
        // Don't fail user creation if email fails
      }
    }

    return newUser;
  } catch (error) {
    console.error('❌ Error in syncFirebaseUserToNeon:', error);
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
    const user = await firebaseStorage.getUserByFirebaseUid(firebaseUid);
    return user ? user.id : null;
  } catch (error) {
    console.error('❌ Error getting Neon user ID from Firebase UID:', error);
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
    console.error('❌ Error ensuring Neon user exists:', error);
    return null;
  }
} 