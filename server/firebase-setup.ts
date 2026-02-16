import { logger } from "./logger";
import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

let firebaseAdmin: App | null = null;

export function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    // Check if Firebase Admin is configured using service account credentials (preferred for production)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      logger.info('🔥 Initializing Firebase Admin with service account credentials...');

      try {
        firebaseAdmin = initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
        logger.info('✅ Firebase Admin initialized with service account for project:', process.env.FIREBASE_PROJECT_ID);
        return firebaseAdmin;
      } catch (error: any) {
        logger.error('❌ Failed to initialize Firebase Admin with service account:', error.message);
        // Fall through to try basic initialization
      }
    }

    // Fallback: Check if Firebase Admin is configured using VITE variables
    if (!process.env.VITE_FIREBASE_PROJECT_ID) {
      logger.warn('Firebase Admin not configured - Firebase auth verification will be disabled (missing both service account and VITE_FIREBASE_PROJECT_ID)');
      return null;
    }

    // Initialize Firebase Admin using VITE variables (no service account available)
    try {
      firebaseAdmin = initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      });
      logger.info('🔥 Firebase Admin initialized with default credentials for project:', process.env.VITE_FIREBASE_PROJECT_ID);
    } catch (error: any) {
      logger.info('🔥 Firebase Admin initialization failed, will rely on client-side checks:', error.message || 'Unknown error');
      return null;
    }

    return firebaseAdmin;
  } catch (error) {
    logger.error('❌ Failed to initialize Firebase Admin:', error);
    return null;
  }
}

export async function verifyFirebaseToken(token: string): Promise<DecodedIdToken | null> {
  try {
    const app = initializeFirebaseAdmin();
    if (!app) {
      logger.warn('Firebase Admin not initialized - cannot verify token');
      return null;
    }

    const decodedToken = await getAuth(app).verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    logger.error('Error verifying Firebase token:', error);
    return null;
  }
}

/**
 * Check if Firebase Admin is properly configured
 */
export function isFirebaseAdminConfigured(): boolean {
  return !!(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID);
}

/**
 * Get Firebase user by email using Admin SDK
 * Used to verify email verification status without requiring user to be signed in
 */
export async function getFirebaseUserByEmail(email: string) {
  try {
    const app = initializeFirebaseAdmin();
    if (!app) {
      logger.warn('Firebase Admin not initialized - cannot get user by email');
      return null;
    }

    const userRecord = await getAuth(app).getUserByEmail(email);
    return userRecord;
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      logger.info(`Firebase user not found for email: ${email}`);
      return null;
    }
    logger.error('Error getting Firebase user by email:', error);
    return null;
  }
}

export { firebaseAdmin };
