import { logger } from "@/lib/logger";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Check if Firebase is properly configured
const isFirebaseConfigured = firebaseConfig.apiKey && 
  firebaseConfig.authDomain && 
  firebaseConfig.projectId;

let app: any = null;
let auth: any = null;
let db: any = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  logger.warn('Firebase is not configured. Google authentication will be disabled.');
}

export { auth, db };

/**
 * Resolves once the SDK has finished restoring the persisted session.
 *
 * `auth.currentUser` is **null until that restore completes**, even when a valid session
 * exists on the device. Reading it straight from a mount effect therefore yields null and
 * looks like "not signed in" — which is how the email-confirmation page failed to send its
 * session proof, leaving the account with an invalidated session and no replacement.
 *
 * Always await this before relying on the caller's identity on first paint.
 */
export function waitForFirebaseAuthReady(timeoutMs = 4000): Promise<void> {
  if (!auth || auth.currentUser) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      if (timer) clearTimeout(timer);
      resolve();
    };

    // Fires once with the restored user, or with null when there is genuinely no session.
    // Either answer is what we need; the timeout only guards against a wedged SDK.
    unsubscribe = onAuthStateChanged(auth, finish);
    timer = setTimeout(finish, timeoutMs);
  });
}
