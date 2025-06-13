import { auth } from '@/lib/firebase';
import { fetchSignInMethodsForEmail } from 'firebase/auth';

/**
 * Check if an email exists in Firebase using client-side Firebase Auth
 * This is more reliable than Firebase Admin in some deployment environments
 */
export async function checkEmailExistsInFirebase(email: string): Promise<{
  exists: boolean;
  methods: string[];
  error?: string;
}> {
  try {
    if (!auth) {
      return {
        exists: false,
        methods: [],
        error: 'Firebase not configured'
      };
    }

    console.log(`🔍 Client-side Firebase check for: ${email}`);
    
    // Use fetchSignInMethodsForEmail to check if email exists
    const signInMethods = await fetchSignInMethodsForEmail(auth, email);
    
    const exists = signInMethods.length > 0;
    
    console.log(`🔥 Client-side Firebase result: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
    if (exists) {
      console.log(`🔥 Sign-in methods: ${signInMethods.join(', ')}`);
    }
    
    return {
      exists,
      methods: signInMethods,
    };
  } catch (error: any) {
    console.error('🔥 Client-side Firebase check error:', error.message);
    
    // Firebase returns specific error codes
    if (error.code === 'auth/invalid-email') {
      return {
        exists: false,
        methods: [],
        error: 'Invalid email format'
      };
    }
    
    return {
      exists: false,
      methods: [],
      error: error.message
    };
  }
} 