import admin from 'firebase-admin';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    // Check if Firebase Admin is configured using VITE variables
    if (!process.env.VITE_FIREBASE_PROJECT_ID) {
      console.warn('Firebase Admin not configured - Firebase auth verification will be disabled (missing VITE_FIREBASE_PROJECT_ID)');
      return null;
    }

    // Initialize Firebase Admin using VITE variables (no service account available)
    try {
      firebaseAdmin = admin.initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      });
      console.log('🔥 Firebase Admin initialized with default credentials for project:', process.env.VITE_FIREBASE_PROJECT_ID);
    } catch (error) {
      console.log('🔥 Firebase Admin initialization failed, will rely on client-side checks:', error.message);
      return null;
    }

    return firebaseAdmin;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error);
    return null;
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const app = initializeFirebaseAdmin();
    if (!app) {
      console.warn('Firebase Admin not initialized - cannot verify token');
      return null;
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return null;
  }
}

/**
 * Check if Firebase Admin is properly configured
 */
export function isFirebaseAdminConfigured(): boolean {
  return !!process.env.VITE_FIREBASE_PROJECT_ID;
}

export { firebaseAdmin };
