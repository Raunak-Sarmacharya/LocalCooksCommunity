import admin from 'firebase-admin';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    // Check if Firebase Admin is configured
    if (!process.env.FIREBASE_PROJECT_ID) {
      console.warn('Firebase Admin not configured - Firebase auth verification will be disabled');
      return null;
    }

    // Initialize Firebase Admin
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    // If we have service account credentials, use them
    if (serviceAccount.clientEmail && serviceAccount.privateKey) {
      firebaseAdmin = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
      console.log('🔥 Firebase Admin initialized with service account credentials');
    } else {
      // Fallback to default credentials (works in some cloud environments)
      firebaseAdmin = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
      console.log('🔥 Firebase Admin initialized with default credentials');
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
  return !!process.env.FIREBASE_PROJECT_ID && 
         (!!process.env.FIREBASE_CLIENT_EMAIL || !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export { firebaseAdmin };
