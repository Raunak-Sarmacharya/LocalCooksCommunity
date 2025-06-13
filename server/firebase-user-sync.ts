import { User } from '@shared/schema';
import { firebaseStorage } from './storage-firebase';

export interface FirebaseUserData {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  role?: 'admin' | 'applicant';
}

/**
 * Sync Firebase user to Neon database
 * This is the core translation function: Firebase UID ↔ Neon User ID
 * NO SESSIONS REQUIRED - Pure stateless JWT architecture
 */
export async function syncFirebaseUserToNeon(userData: FirebaseUserData): Promise<User> {
  const { uid, email, displayName, emailVerified, role } = userData;

  try {
    // Step 1: Check if user already exists by Firebase UID
    let user = await firebaseStorage.getUserByFirebaseUid(uid);
    
    if (user) {
      console.log(`🔍 Firebase user ${uid} already exists in Neon DB with ID ${user.id}`);
      return user;
    }

    // Step 2: Try to find existing user by username/email and link them
    if (displayName) {
      const existingUser = await firebaseStorage.getUserByUsername(displayName);
      if (existingUser && !existingUser.firebaseUid) {
        // Link existing user to Firebase UID
        const updatedUser = await firebaseStorage.updateUserFirebaseUid(existingUser.id, uid);
        if (updatedUser) {
          console.log(`🔗 Linked existing user ${existingUser.id} to Firebase UID ${uid}`);
          return updatedUser;
        }
      }
    }

    if (email) {
      const existingUser = await firebaseStorage.getUserByUsername(email);
      if (existingUser && !existingUser.firebaseUid) {
        // Link existing user to Firebase UID
        const updatedUser = await firebaseStorage.updateUserFirebaseUid(existingUser.id, uid);
        if (updatedUser) {
          console.log(`🔗 Linked existing user ${existingUser.id} to Firebase UID ${uid}`);
          return updatedUser;
        }
      }
    }

    // Step 3: Create new user in Neon DB
    const isUserVerified = emailVerified === true;
    console.log(`🔍 FIREBASE SYNC DEBUG:`);
    console.log(`   - Firebase UID: ${uid}`);
    console.log(`   - Email: ${email}`);
    console.log(`   - Display Name: ${displayName}`);
    console.log(`   - emailVerified (from Firebase): ${emailVerified}`);
    console.log(`   - emailVerified type: ${typeof emailVerified}`);
    console.log(`   - isUserVerified (calculated): ${isUserVerified}`);
    console.log(`   - Role: ${role}`);
    
    const newUser = await firebaseStorage.createUser({
      username: displayName || email || `firebase_${uid}`,
      password: '', // Empty password for Firebase users
      role: role || 'applicant',
      firebaseUid: uid,
      isVerified: isUserVerified, // Google users are verified, email/password users need verification
      has_seen_welcome: false // All new users should see welcome screen
    });

    console.log(`✨ CREATED USER RESULT:`);
    console.log(`   - Neon User ID: ${newUser.id}`);
    console.log(`   - Username: ${newUser.username}`);
    console.log(`   - isVerified in DB: ${(newUser as any).isVerified}`);
    console.log(`   - has_seen_welcome in DB: ${(newUser as any).has_seen_welcome}`);
    console.log(`   - Firebase UID: ${(newUser as any).firebaseUid}`);
    return newUser;

  } catch (error) {
    console.error('❌ Error syncing Firebase user to Neon:', error);
    throw new Error(`Failed to sync Firebase user: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    return await syncFirebaseUserToNeon(userData);
  } catch (error) {
    console.error('❌ Error ensuring Neon user exists:', error);
    return null;
  }
} 