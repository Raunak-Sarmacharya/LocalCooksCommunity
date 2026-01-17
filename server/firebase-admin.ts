import admin from 'firebase-admin';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    // Check if Firebase Admin is configured using service account credentials (preferred for production)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('🔥 Initializing Firebase Admin with service account credentials...');
      
      try {
        firebaseAdmin = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
        console.log('✅ Firebase Admin initialized with service account for project:', process.env.FIREBASE_PROJECT_ID);
        return firebaseAdmin;
      } catch (error: any) {
        console.error('❌ Failed to initialize Firebase Admin with service account:', error.message);
        // Fall through to try basic initialization
      }
    }

    // Fallback: Check if Firebase Admin is configured using VITE variables
    if (!process.env.VITE_FIREBASE_PROJECT_ID) {
      console.warn('Firebase Admin not configured - Firebase auth verification will be disabled (missing both service account and VITE_FIREBASE_PROJECT_ID)');
      return null;
    }

    // Initialize Firebase Admin using VITE variables (no service account available)
    try {
      firebaseAdmin = admin.initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      });
      console.log('🔥 Firebase Admin initialized with default credentials for project:', process.env.VITE_FIREBASE_PROJECT_ID);
    } catch (error: any) {
      console.log('🔥 Firebase Admin initialization failed, will rely on client-side checks:', error.message || 'Unknown error');
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
  return !!(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID);
}

export { firebaseAdmin };
