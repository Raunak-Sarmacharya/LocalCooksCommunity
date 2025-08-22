import { auth } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export interface UserExistenceResult {
  exists: boolean;
  email?: string;
  error?: string;
  canSignIn: boolean;
  canRegister: boolean;
}

/**
 * Check if a user exists by temporarily signing in with Google and checking backend
 * This is used to determine if a user should be allowed to sign in or needs to register
 */
export async function checkUserExistsForGoogleAuth(): Promise<UserExistenceResult> {
  try {
    console.log('🔍 Starting Google user existence check...');
    
    // Create a temporary Google sign-in to get user info
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    
    // Sign in temporarily to get user info
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const email = user.email;
    
    if (!email) {
      // Sign out the temporary user
      await auth.signOut();
      return {
        exists: false,
        canSignIn: false,
        canRegister: false,
        error: 'No email found in Google account'
      };
    }
    
    console.log(`🔍 Checking if user exists in backend: ${email}`);
    
    // Check if user exists in our backend system
    const token = await user.getIdToken();
    const response = await fetch('/api/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      // User exists in backend - they can sign in
      console.log('✅ User exists in backend - can sign in');
      return {
        exists: true,
        email,
        canSignIn: true,
        canRegister: false
      };
    } else if (response.status === 404) {
      // User doesn't exist in backend - they need to register
      console.log('❌ User does not exist in backend - needs to register');
      // Sign out the temporary user
      await auth.signOut();
      return {
        exists: false,
        email,
        canSignIn: false,
        canRegister: true
      };
    } else {
      // Some other error
      console.error('❌ Error checking user existence:', response.status);
      await auth.signOut();
      return {
        exists: false,
        email,
        canSignIn: false,
        canRegister: false,
        error: 'Failed to verify user account'
      };
    }
    
  } catch (error: any) {
    console.error('❌ Error in Google user existence check:', error);
    
    // Make sure to sign out any temporary session
    try {
      await auth.signOut();
    } catch (signOutError) {
      console.error('Error signing out:', signOutError);
    }
    
    // Handle specific Firebase errors
    if (error.code === 'auth/popup-closed-by-user') {
      return {
        exists: false,
        canSignIn: false,
        canRegister: false,
        error: 'Sign-in cancelled by user'
      };
    }
    
    return {
      exists: false,
      canSignIn: false,
      canRegister: false,
      error: error.message || 'Failed to check user existence'
    };
  }
}

/**
 * SECURITY FIX: Removed email existence check to prevent email enumeration attacks
 * The previous checkUserExistsByEmail function was a security vulnerability
 * that allowed attackers to determine if an email address exists in the system.
 * 
 * Instead, users should attempt registration directly, and the system will
 * handle duplicate email detection during the registration process.
 */
export async function checkUserExistsByEmail(email: string): Promise<UserExistenceResult> {
  // SECURITY FIX: Always return that email is available to prevent enumeration
  console.log(`🔒 Email existence check requested for: ${email} (security: always available)`);
  
  return {
    exists: false,
    email,
    canSignIn: false,
    canRegister: true,
    error: 'Email existence check disabled for security'
  };
} 