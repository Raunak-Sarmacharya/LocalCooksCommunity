import { User } from '@shared/schema';
import { firebaseStorage } from './storage-firebase';

export interface FirebaseUserData {
  uid: string;
  email: string | null;
  displayName?: string;
  emailVerified: boolean;
  role?: 'admin' | 'applicant';
}

interface CreateUserData {
  username: string;
  password: string;
  role: 'admin' | 'applicant';
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
  const { uid, email, emailVerified, displayName, role = 'applicant' } = params;
  
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

    // Create new user with appropriate verification status
    const userData: CreateUserData = {
      username: displayName || email,
      password: '', // Empty for Firebase users
      role: role as 'admin' | 'applicant',
      firebaseUid: uid,
      isVerified: isUserVerified, // Google users are verified, email/password users need verification
    };

    console.log(`➕ CREATING NEW USER with data:`, userData);
    const newUser = await firebaseStorage.createUser(userData);
    console.log(`✅ USER CREATED: ${newUser.id} (${newUser.username})`);
    console.log(`   - is_verified in DB: ${(newUser as any).isVerified}`);

    // For email/password users (not Google), send verification email
    if (!isGoogleUser && email) {
      console.log(`📧 SENDING VERIFICATION EMAIL to ${email}`);
      try {
        const crypto = await import('crypto');
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpiry = new Date(Date.now() + 86400000); // 24 hours from now
        
        // Store verification token in database
        const { pool } = await import('./db.js');
        await pool.query(`
          INSERT INTO email_verification_tokens (email, token, expires_at, created_at) 
          VALUES ($1, $2, $3, NOW()) 
          ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()
        `, [email, verificationToken, verificationTokenExpiry]);

        // Generate verification URL
        const verificationUrl = `${process.env.BASE_URL || 'https://local-cooks-community.vercel.app'}/auth/verify-email?token=${verificationToken}`;

        // Send verification email
        const { sendEmail, generateEmailVerificationEmail } = await import('./email.js');
        const emailContent = generateEmailVerificationEmail({
          fullName: displayName || email.split('@')[0],
          email,
          verificationToken,
          verificationUrl
        });

        const emailSent = await sendEmail(emailContent, {
          trackingId: `email_verification_${email}_${Date.now()}`
        });

        if (emailSent) {
          console.log(`✅ Verification email sent to ${email}`);
        } else {
          console.error(`❌ Failed to send verification email to ${email}`);
        }
      } catch (emailError) {
        console.error('❌ Error sending verification email:', emailError);
        // Don't fail user creation if email fails
      }
    } else if (isGoogleUser) {
      console.log(`✅ Google user - no verification email needed`);
      
      // Send welcome email for Google users
      try {
        const { sendEmail, generateWelcomeEmail } = await import('./email.js');
        const emailContent = generateWelcomeEmail({
          fullName: displayName || email.split('@')[0],
          email
        });

        await sendEmail(emailContent, {
          trackingId: `welcome_${email}_${Date.now()}`
        });
        console.log(`✅ Welcome email sent to ${email}`);
      } catch (emailError) {
        console.error('❌ Error sending welcome email:', emailError);
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