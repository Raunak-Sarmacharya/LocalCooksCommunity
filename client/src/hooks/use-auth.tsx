import { logger } from "@/lib/logger";
import { auth, db } from "@/lib/firebase";
import { getAuthIntent } from "@/lib/auth-intent";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { queryClient } from "@/lib/queryClient";
import { createUserWithEmailAndPassword, deleteUser, getAdditionalUserInfo, GoogleAuthProvider, isSignInWithEmailLink, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithEmailLink, signInWithPopup, signOut, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, ReactNode, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getSubdomainFromHostname, getRoleLoginOrigin } from "@shared/subdomain-utils";
import { User, UserWithFlags } from "@shared/schema";
import { duplicateAccountErrorFromResponse, isDuplicateAccountError } from "@/lib/registration-error";
import { isPhoneAuthInProgress } from "@/lib/phone-registration";
import { createMissingProfileError, rememberAuthMethod } from "@/lib/login-challenge";
import {
  clearPendingGoogleRegistration,
  isAbandonedGoogleRegistration,
  markPendingGoogleRegistration,
  pendingGoogleRegistration,
} from "@/lib/pending-google-registration";
import { LAST_ACCOUNT_KEY, getLastAccount } from "@/lib/last-account";
import { normalizePhoneNumber } from "@shared/phone-validation";
// See the ladder documented there: this is the outermost (longest) auth timeout.
import { AUTH_PHASE_TIMEOUT_MS } from "@/config/auth-timing";

// ENTERPRISE: Auth Phase State Machine
// Separates Firebase Auth State from Sync State to prevent timing issues
export type AuthPhase = 
  | 'idle'           // Not authenticated
  | 'authenticating' // Firebase auth in progress (popup open, etc.)
  | 'syncing'        // Backend sync in progress
  | 'ready'          // Fully authenticated, sync complete
  | 'error';         // Auth failed

export interface AuthUser extends Partial<AuthUserLegacyFields> {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  phoneNumber?: string | null;
  providers: string[];
  role?: string;
  isChef?: boolean;
  isManager?: boolean;
  isPortalUser?: boolean;
  isVerified?: boolean;
  hasSeenWelcome?: boolean;
  termsAccepted?: boolean;
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
  chefOnboardingCompleted?: boolean;
}

// Added for backward compatibility during refactoring
interface AuthUserLegacyFields {
  is_verified: boolean;
  has_seen_welcome: boolean;
  fullName: string | null;
  username: string | null;
  application_type: 'chef';
}

export type PublicRegistrationRole = 'chef' | 'manager';


interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authPhase: AuthPhase; // ENTERPRISE: Explicit auth phase for state machine
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string, accountType?: PublicRegistrationRole, termsAccepted?: boolean, phoneNumber?: string) => Promise<void>;
  logout: () => Promise<void>;
  signInWithGoogle: (isRegistration?: boolean, accountType?: PublicRegistrationRole, termsAccepted?: boolean, profile?: { displayName: string; phoneNumber: string }) => Promise<'existing' | 'registered'>;
  /**
   * Authenticate with Google and STOP — nothing is provisioned.
   *
   * The register step uses this so the visitor can confirm their name and supply the
   * phone number BEFORE anything is written. `signInWithGoogle(..., isRegistration)`
   * provisions immediately, which is how a Google signup used to create an account
   * with no phone at all and no confirmation step.
   *
   * `existing` is true when the Google account already has a LocalCooks profile, in
   * which case the caller should complete the sign-in rather than collect details.
   *
   * Deliberately does NOT touch `loading` or `authPhase`: those drive the host's
   * loading gate, which REPLACES the card and unmounts the register form — losing the
   * very values this call exists to prefill. The caller shows its own busy state.
   */
  authenticateWithGoogle: () => Promise<{ existing: boolean; email: string; displayName: string }>;
  /**
   * Abandon an in-flight Google registration immediately — see the note on the
   * implementation. Used when the visitor navigates away from the register step without
   * a page load, which the load-time sweep cannot see.
   */
  discardPendingGoogleRegistration: () => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  handleEmailLinkSignIn: () => Promise<void>;
  isUserVerified: (user: AuthUser | null) => boolean;
  updateUserVerification: () => Promise<AuthUser | null>;
  sendVerificationEmail: (email: string, fullName: string) => Promise<boolean>;
  resendFirebaseVerification: () => Promise<boolean>;
  resendEmailVerification: (email: string, password: string) => Promise<boolean>;
  /**
   * Refetch the profile and rebuild the auth-context user.
   *
   * Pass `{ forceToken: false }` for anything background (polling, noticing a change made
   * in another tab). Forcing a token refresh against a refresh token that an email change
   * invalidated makes the SDK sign the user out globally.
   */
  refreshUserData: (options?: { forceToken?: boolean }) => Promise<AuthUser | null>;
  syncUserWithBackend: (firebaseUser: any, accountType?: PublicRegistrationRole, isRegistration?: boolean, termsAccepted?: boolean, phoneNumber?: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [pendingSync, setPendingSync] = useState(false);
  const [pendingRegistration, setPendingRegistration] = useState(false);

  // ENTERPRISE: Auth Phase State Machine
  // Tracks the full auth lifecycle: idle → authenticating → syncing → ready
  const [authPhase, setAuthPhase] = useState<AuthPhase>('idle');

  // ENTERPRISE: Refs to prevent duplicate syncs and access current values in callbacks
  // Using refs instead of state in useEffect dependencies prevents multiple listener creation
  const hasSyncedThisSession = useRef(false);
  const pendingSyncRef = useRef(false);
  const pendingRegistrationRef = useRef(false);
  const isInitializingRef = useRef(true);

  // Keep refs in sync with state for access in callbacks
  useEffect(() => {
    pendingSyncRef.current = pendingSync;
  }, [pendingSync]);

  useEffect(() => {
    pendingRegistrationRef.current = pendingRegistration;
  }, [pendingRegistration]);

  useEffect(() => {
    isInitializingRef.current = isInitializing;
  }, [isInitializing]);

  // `loading` above only tracks the individual SDK call (signInWithPopup,
  // signInWithEmailLink, createUserWithEmailAndPassword...). It flips back to
  // false while `onAuthStateChanged` is still fetching /api/user/profile and
  // provisioning the account — which is exactly the window that made the app
  // flash the login screen "for a second" right after a successful registration
  // or magic-link sign-in, even though the session was fine.
  //
  // Consumers read `loading` as "the auth session is not settled yet, do not
  // render an authenticated or unauthenticated decision". Folding the phase
  // machine in is what makes that true:
  //   authenticating -> Firebase round-trip still in flight
  //   syncing        -> backend provisioning / profile fetch still in flight
  //   isInitializing -> first auth-state resolution after a page load
  const isAuthPhaseBusy = authPhase === 'authenticating' || authPhase === 'syncing';
  const isSessionSettling = loading || isAuthPhaseBusy || isInitializing;

  // Safety valve for the phase machine above. If a phase never resolves, release
  // it so `isSessionSettling` can fall back to false and the user lands on a
  // screen instead of an endless spinner.
  useEffect(() => {
    if (!isAuthPhaseBusy) return;
    const timer = setTimeout(() => {
      logger.warn(
        `⏱️ Auth phase "${authPhase}" ran longer than ${AUTH_PHASE_TIMEOUT_MS}ms — releasing the loading gate`
      );
      setAuthPhase(auth.currentUser ? 'ready' : 'idle');
    }, AUTH_PHASE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [authPhase, isAuthPhaseBusy]);

  const syncUserWithBackend = async (firebaseUser: any, accountType?: PublicRegistrationRole, isRegistration = false, termsAccepted = false, phoneNumber?: string) => {
    try {
      logger.info('🔥 SYNC DEBUG - Starting backend sync for:', firebaseUser.uid, isRegistration ? '(REGISTRATION)' : '(SIGN-IN)');

      // Registration may have just linked a phone credential. Force-refresh so
      // the backend validates current provider claims rather than a cached token.
      const token = await firebaseUser.getIdToken(isRegistration);

      // Use different endpoints based on whether this is registration or sign-in
      const endpoint = isRegistration ? "/api/firebase-register-user" : "/api/firebase-sync-user";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          emailVerified: firebaseUser.emailVerified,
          accountType: isRegistration ? accountType : undefined,
          termsAccepted: isRegistration ? termsAccepted : undefined,
          phoneNumber: isRegistration ? phoneNumber : undefined,
          isRegistration: isRegistration,
        })
      });

      logger.info('📤 SYNC REQUEST DEBUG:', {
        endpoint,
        isRegistration,
        accountType,
        currentPath: window.location.pathname,
        email: firebaseUser.email
      });

      if (response.ok) {
        const result = await response.json();
        logger.info('✅ SYNC SUCCESS:', result);

        // The account exists now, so any "attempt in flight" marker is spent. Leaving
        // it would sign the visitor out on their next visit.
        if (isRegistration) clearPendingGoogleRegistration();

        // Registration is complete only after Neon accepts the account. Mirror
        // the non-authoritative profile here so every registration path,
        // including Google + linked phone, writes the same Firestore document.
        if (isRegistration) {
          try {
            await setDoc(doc(db, "users", firebaseUser.uid), {
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              phoneNumber: phoneNumber || firebaseUser.phoneNumber || null,
              emailVerified: firebaseUser.emailVerified === true,
              phoneVerified: Boolean(firebaseUser.phoneNumber),
              createdAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }, { merge: true });
            logger.info('📝 Created/updated non-authoritative Firestore profile data');
          } catch (firestoreError) {
            logger.error('❌ Failed to create/update Firestore document:', firestoreError);
          }

          // Complete both the React state and its synchronous mirrors together.
          // onAuthStateChanged reads the refs, so waiting for the state effects can
          // otherwise leave the UI permanently stuck in the `syncing` phase.
          hasSyncedThisSession.current = true;
          pendingSyncRef.current = false;
          pendingRegistrationRef.current = false;
          setPendingSync(false);
          setPendingRegistration(false);
          setAuthPhase('ready');
        }
        return true;
      } else {
        const errorText = await response.text();
        logger.error('❌ SYNC FAILED:', response.status, errorText);
        if (isRegistration) {
          let errorPayload: { code?: string; message?: string; error?: string } | null = null;
          try {
            errorPayload = JSON.parse(errorText);
          } catch {
            // Non-JSON responses continue through the existing generic failure path.
          }

          // WHICH identifier collided has to survive this layer. The server
          // already says so — `PHONE_EXISTS` or `EMAIL_EXISTS` — and this used to
          // accept only the email code and hand the result to a builder that
          // hardcoded `EMAIL_EXISTS` anyway. Between the two, a taken phone number
          // reached the form labelled as a taken email address, pointing the
          // visitor at the one field that was fine.
          const duplicateError = duplicateAccountErrorFromResponse(response.status, errorPayload);
          if (duplicateError) throw duplicateError;
        }
        return false;
      }
    } catch (error) {
      logger.error('❌ SYNC ERROR:', error);
      if (isRegistration && isDuplicateAccountError(error)) throw error;
      return false;
    }
  };

  // ENTERPRISE: Single stable onAuthStateChanged listener
  // Uses refs to access current state values, preventing multiple listener creation
  // Empty dependency array ensures this effect only runs once on mount
  useEffect(() => {
    logger.info('📊 AUTH PHASE: Setting up onAuthStateChanged listener (runs once)');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          logger.info('🔥 AUTH STATE CHANGE - User detected:', firebaseUser.uid);
          logger.info('📊 AUTH PHASE: authenticating → syncing');
          
          // Only set to syncing if we're in authenticating phase (login/register in progress)
          // For session restoration, we skip the authenticating phase
          if (pendingSyncRef.current || pendingRegistrationRef.current) {
            setAuthPhase('syncing');
          }

          // Check if this is a verification redirect from email
          const urlParams = new URLSearchParams(window.location.search);
          const isVerificationRedirect = urlParams.has('verified') || window.location.href.includes('continueUrl');

          if (isVerificationRedirect) {
            logger.info('📧 EMAIL VERIFICATION REDIRECT DETECTED - Reloading user data');
            await firebaseUser.reload(); // Refresh verification status
          }

          // Get providers list
          const providers = firebaseUser.providerData.map(p => p.providerId);
          logger.info('🔥 AUTH PROVIDERS:', providers);
          logger.info('🔥 EMAIL VERIFIED:', firebaseUser.emailVerified);

          // Check for user role and data from backend API (not Firestore)
          let role = null; // Don't set default role - let backend determine
          let applicationData = null;
          try {
            const token = await firebaseUser.getIdToken();
            const response = await fetch('/api/user/profile', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });

            if (response.ok) {
              const userData = await response.json();
              role = userData.role;
              applicationData = {
                application_type: userData.application_type, // DEPRECATED: kept for backward compatibility
                isChef: userData.isChef || userData.is_chef || false,
                is_verified: userData.is_verified,
                isVerified: userData.isVerified || userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome,
                hasSeenWelcome: userData.hasSeenWelcome || userData.has_seen_welcome,
                termsAccepted: userData.termsAccepted || userData.terms_accepted,
                termsAcceptedAt: userData.termsAcceptedAt || userData.terms_accepted_at,
                termsVersion: userData.termsVersion || userData.terms_version,
                isManager: userData.isManager || userData.is_manager || false,
                isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
                chefOnboardingCompleted: userData.chefOnboardingCompleted || userData.chef_onboarding_completed || false,
                phoneNumber: userData.phoneNumber || userData.managerProfileData?.phone || null,
                phoneVerified: userData.phoneVerified === true,
                // Server-side verification mirror — see the note on refreshUserData.
                emailVerified: userData.emailVerified === true,
              };
              logger.info('🔥 BACKEND USER DATA:', {
                role,
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome,
                isManager: userData.isManager,
                isPortalUser: userData.isPortalUser
              });
              
              // ENTERPRISE: User exists in backend, mark as synced
              hasSyncedThisSession.current = true;
            } else {
              logger.info('🔥 NEW USER - No backend profile found, will need to sync');

              // A "Continue with Google" registration that was never confirmed must
              // not leave the visitor signed in. `authenticateWithGoogle` marks the
              // attempt before anything is provisioned; if the marker is still there
              // when a profileless session appears, the form was abandoned — so clear
              // the session instead of leaving someone signed in to an account that
              // does not exist and cannot be finished.
              //
              // Deliberately keyed on that marker rather than on "profileless sessions
              // are invalid": round 7 established that a pre-existing Firebase identity
              // with no profile is an interrupted registration and keeps its recovery
              // route. Only an attempt this flow started is signed out here.
              if (isAbandonedGoogleRegistration(firebaseUser.uid)) {
                const pending = pendingGoogleRegistration();
                logger.info('🚪 Abandoned Google registration — clearing it');
                clearPendingGoogleRegistration();
                try {
                  if (pending?.createdIdentity) {
                    // THIS attempt created the identity, so remove it. Merely signing out
                    // would leave a Firebase Auth user with no profile, and
                    // `/api/firebase/auth-method-hints` finds that uid and reports
                    // `profile-incomplete` for ever after — so the visitor's own address
                    // is later offered "Continue with Google" and an email link for an
                    // account that does not exist and can never complete.
                    await deleteUser(firebaseUser);
                    logger.info('✅ Rolled back the abandoned Google identity');
                  } else {
                    await auth.signOut();
                  }
                } catch (cleanupError) {
                  // Most likely auth/requires-recent-login. Signing out is the weaker
                  // outcome but still better than leaving a live session behind.
                  logger.warn('Could not delete the abandoned Google identity; signing out instead', cleanupError);
                  await auth.signOut().catch(() => undefined);
                }
                return;
              }
            }
          } catch (error) {
            logger.error('❌ BACKEND USER FETCH ERROR:', error);
            // Continue without default role if backend fails
          }

          // ENTERPRISE: Use refs to check sync conditions (prevents stale closures)
          // Registration is provisioned explicitly by signup/signInWithGoogle so
          // the selected public account type and consent evidence travel in the
          // same request. The auth-state listener must not race that request.
          //
          // Deliberately NOT keyed on isInitializingRef: that is true on every fresh
          // page load, so this used to fire a POST on every refresh against the auth
          // rate limiter — and a 429 there signed the user out. Sync now runs only
          // where it is needed: after sign-in/registration (pendingSync) and after a
          // verification redirect. The is_verified mirror is still repaired by
          // /api/user/profile and by requireFirebaseAuthWithUser on every request,
          // and the welcome email is sent by the verify-email-complete path.
          const shouldSync = !pendingRegistrationRef.current &&
            !isPhoneAuthInProgress() &&
            (pendingSyncRef.current || isVerificationRedirect);

          if (shouldSync && !hasSyncedThisSession.current) {
            logger.info('🔥 SYNCING USER - Conditions met:', {
              isInitializing: isInitializingRef.current,
              pendingSync: pendingSyncRef.current,
              pendingRegistration: pendingRegistrationRef.current,
              isVerificationRedirect,
              hasSyncedThisSession: hasSyncedThisSession.current,
              uid: firebaseUser.uid,
              emailVerified: firebaseUser.emailVerified
            });

            const syncSuccess = await syncUserWithBackend(firebaseUser);
            if (syncSuccess) {
              setPendingSync(false);
              setPendingRegistration(false);
              hasSyncedThisSession.current = true;
              logger.info('✅ USER SYNCED - Backend sync complete');

              // If this was a verification redirect, clean up the URL
              if (isVerificationRedirect) {
                logger.info('🧹 CLEANING UP VERIFICATION URL');
                window.history.replaceState({}, document.title, window.location.pathname);
              }

              // ENTERPRISE: Fetch fresh profile data after sync so user state gets all fields
              try {
                const token = await firebaseUser.getIdToken();
                const freshResponse = await fetch('/api/user/profile', {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });
                if (freshResponse.ok) {
                  const userData = await freshResponse.json();
                  role = userData.role;
                  applicationData = {
                    application_type: userData.application_type,
                    isChef: userData.isChef || userData.is_chef || false,
                    is_verified: userData.is_verified,
                    isVerified: userData.isVerified || userData.is_verified,
                    emailVerified: userData.emailVerified === true,
                    has_seen_welcome: userData.has_seen_welcome,
                    hasSeenWelcome: userData.hasSeenWelcome || userData.has_seen_welcome,
                    termsAccepted: userData.termsAccepted || userData.terms_accepted,
                    termsAcceptedAt: userData.termsAcceptedAt || userData.terms_accepted_at,
                    termsVersion: userData.termsVersion || userData.terms_version,
                    isManager: userData.isManager || userData.is_manager || false,
                    isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
                    chefOnboardingCompleted: userData.chefOnboardingCompleted || userData.chef_onboarding_completed || false,
                    phoneNumber: userData.phoneNumber || userData.managerProfileData?.phone || null,
                    phoneVerified: userData.phoneVerified === true,
                  };
                  logger.info('🔥 RE-FETCHED BACKEND USER DATA AFTER SYNC');
                }
              } catch (e) {
                logger.error('❌ FAILED TO RE-FETCH PROFILE AFTER SYNC', e);
              }
            } else {
              logger.error('❌ USER SYNC FAILED - clearing Firebase-only session');
              await signOut(auth);
              setUser(null);
              setAuthPhase('error');
              return;
            }
          } else if (hasSyncedThisSession.current) {
            logger.info('ℹ️ SKIPPING SYNC - Already synced this session');
          } else {
            logger.info('ℹ️ SKIPPING SYNC - Session restoration or no sync needed');
          }

          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            // Claim OR the server's verification mirror. The claim is a cache that lags an
            // email change by up to an hour, and forcing a refresh to clear it can sign the
            // user out — so the mirror is what makes a confirmation visible promptly.
            emailVerified: firebaseUser.emailVerified || applicationData?.emailVerified === true,
            phoneVerified: Boolean(firebaseUser.phoneNumber) || applicationData?.phoneVerified === true,
            phoneNumber: applicationData?.phoneNumber,
            providers,
            role,
            application_type: applicationData?.application_type, // DEPRECATED: kept for backward compatibility
            isChef: applicationData?.isChef,
            isManager: applicationData?.isManager,
            isPortalUser: applicationData?.isPortalUser,
            is_verified: applicationData?.is_verified,
            isVerified: applicationData?.isVerified,
            has_seen_welcome: applicationData?.has_seen_welcome,
            hasSeenWelcome: applicationData?.hasSeenWelcome,
            termsAccepted: applicationData?.termsAccepted,
            termsAcceptedAt: applicationData?.termsAcceptedAt,
            termsVersion: applicationData?.termsVersion,
            chefOnboardingCompleted: applicationData?.chefOnboardingCompleted,
          });

          if (pendingRegistrationRef.current || isPhoneAuthInProgress()) {
            // signup()/Google registration is still performing the authoritative
            // Neon provisioning request, or a phone registration is waiting for
            // its required verified email. Neither state is application-authorized.
            setAuthPhase('syncing');
            return;
          }
          
          // ENTERPRISE: Set auth phase to ready after successful user setup
          logger.info('📊 AUTH PHASE: syncing → ready');
          setAuthPhase('ready');
        } else {
          logger.info('🔥 AUTH STATE CHANGE - No user (logged out)');
          setUser(null);
          setPendingSync(false);
          setPendingRegistration(false);
          hasSyncedThisSession.current = false;
          setAuthPhase('idle');
        }
      } catch (err) {
        logger.error("Auth state change error:", err);
        setError("Authentication error occurred");
        setAuthPhase('error');
      } finally {
        setLoading(false);
        if (isInitializingRef.current) {
          // Small delay to prevent flickering on initial load
          setTimeout(() => setIsInitializing(false), 50);
        }
      }
    });

    return () => unsubscribe();
  }, []); // ENTERPRISE: Empty deps - create listener ONCE on mount

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    logger.info('📊 AUTH PHASE: idle → authenticating (login)');
    try {
      // First, sign in to Firebase to verify credentials
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Get the user's ID token to check verification status
      const token = await cred.user.getIdToken();

      // Check if user is verified in our database
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();

        // Firebase is authoritative for ownership of the email address. Always
        // reload and check it, even if an old database row says verified.
        await cred.user.reload();

        if (!cred.user.emailVerified && !cred.user.phoneNumber) {
          logger.info('❌ User has no verified email or phone - signing out');
          setAuthPhase('error');
          await signOut(auth);
          throw new Error('Please verify your email or phone number before logging in.');
        }

        if (!userData.is_verified) {
          // User verified in Firebase but not in our database - update our database
          logger.info('✅ Firebase verified but database not updated - syncing...');
          setPendingSync(true);
        }

        // User is verified, allow login
        logger.info('✅ User verified - login successful');
        setPendingSync(true);

      } else {
        // User doesn't exist in our database
        setAuthPhase('error');
        await signOut(auth);
        throw new Error('Account not found. Please register first.');
      }

    } catch (firebaseError: any) {
      logger.error('Login failed:', firebaseError.message);
      setAuthPhase('error');
      setPendingSync(false);

      // Re-throw the error so components can handle it with user-friendly messages
      throw firebaseError;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (email: string, password: string, displayName?: string, accountType: PublicRegistrationRole = 'chef', termsAccepted = false, phoneNumber?: string) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    logger.info('📊 AUTH PHASE: idle → authenticating (signup)');
    try {
      setPendingSync(true); // Force sync on new signup
      setPendingRegistration(true); // Mark as registration
      pendingSyncRef.current = true;
      pendingRegistrationRef.current = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Update the Firebase profile with displayName
      if (displayName) {
        await updateProfile(cred.user, { displayName });
        logger.info('📝 Updated Firebase profile with displayName:', displayName);
      }

      // IMPORTANT: Manually sync the user before signing them out
      // Pass the updated user object and password for proper database storage
      logger.info('📧 USER REGISTERED - Syncing to database with password and displayName');

      // Get the updated user object with displayName
      await cred.user.reload(); // Refresh the user object
      const updatedUser = auth.currentUser || cred.user;

      // Wait a moment for profile update to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      let syncSuccess = false;
      try {
        syncSuccess = await syncUserWithBackend(updatedUser, accountType, true, termsAccepted, phoneNumber);
      } catch (syncError) {
        if (isDuplicateAccountError(syncError)) {
          try {
            await cred.user.delete();
            logger.info('✅ Rolled back Firebase user after duplicate database account was detected');
          } catch (deleteError) {
            logger.error('❌ Failed to roll back Firebase user after duplicate account conflict:', deleteError);
          }
        }
        throw syncError;
      }

      if (syncSuccess) {
        logger.info('✅ User synced successfully during registration');
        setAuthPhase('ready');
      } else {
        logger.error('❌ User sync failed during registration, rolling back Firebase user');
        // CRITICAL FIX: Rollback the Firebase user if backend sync fails
        try {
          await cred.user.delete();
          logger.info('✅ Successfully rolled back (deleted) orphaned Firebase user');
        } catch (deleteError) {
          logger.error('❌ Failed to rollback Firebase user:', deleteError);
        }
        
        // Reset states and throw error to stop the flow
        setPendingSync(false);
        setPendingRegistration(false);
        setAuthPhase('error');
        throw new Error('Failed to create account in the database. Please try again.');
      }

      // CRITICAL: Send Custom Backend email verification
      logger.info('📧 Sending Custom email verification...');
      let emailSent = false;
      try {
        await sendVerificationEmailWithFallback({
          email: updatedUser.email!,
          role: accountType,
          returnUrl:
            getAuthIntent()?.returnPath ||
            `${window.location.pathname}${window.location.search}`,
        });
        logger.info("✅ Custom email verification sent successfully");
        emailSent = true;
      } catch (emailError: any) {
        logger.error("❌ Failed to send Custom verification email:", emailError);
      }

      if (!emailSent) {
        logger.warn('⚠️ Verification email was not sent - user will need to request resend');
      }

      // The provisioning request has landed, but `onAuthStateChanged` raced it:
      // the listener read /api/user/profile before Neon accepted the account, so
      // the context user can still be missing role / verification / terms. Re-read
      // the profile before resolving so a caller that hides its loader the moment
      // `signup()` returns is hiding it in front of a complete session, not a
      // half-populated one.
      await refreshUserData();

      // Removed: Sign out the user immediately after registration
      // Keeping them logged in allows for a smoother UX when they verify their email.
      // They are still unverified, so protected routes will still block them.
      logger.info('📧 USER REGISTERED - Kept logged in (unverified) to allow seamless verification');


    } catch (e: any) {
      // Don't set raw Firebase error - let the components handle user-friendly messages
      // setError(e.message);
      pendingSyncRef.current = false;
      pendingRegistrationRef.current = false;
      setPendingSync(false);
      setPendingRegistration(false);
      setAuthPhase('error');
      logger.info('📊 AUTH PHASE: authenticating → error (signup failed)');

      // Re-throw the error so components can handle it with user-friendly messages
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setError(null);
    setLoading(true);
    try {
      setPendingSync(false);
      setPendingRegistration(false);

      // Keep uid-scoped kitchen preview walkthrough so the same account is not toured again.
      const walkthroughFlags: [string, string][] = [];
      const authMethodHint = localStorage.getItem('localcooks-auth-method-hint');
      // Also kept across sign-out: offering the last account back on the next
      // visit is the entire point of the welcome-back card, and the record is
      // browser-local. "Not you?" is the user-facing way to remove it.
      const lastAccountRecord = localStorage.getItem(LAST_ACCOUNT_KEY);
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("lc.kitchenPreview.walkthrough") && localStorage.getItem(key) === "1") {
            walkthroughFlags.push([key, "1"]);
          }
        }
      } catch {
        // ignore
      }
      localStorage.clear();
      try {
        for (const [key, val] of walkthroughFlags) localStorage.setItem(key, val);
        if (authMethodHint) localStorage.setItem('localcooks-auth-method-hint', authMethodHint);
        if (lastAccountRecord) localStorage.setItem(LAST_ACCOUNT_KEY, lastAccountRecord);
      } catch {
        // ignore
      }
      logger.info('🧹 LOGOUT: Cleared all localStorage data');

      // SECURITY FIX: Clear all React Query cache to prevent cross-user data leakage
      queryClient.clear();
      logger.info('🧹 LOGOUT: Cleared all React Query cache');

      // SECURITY FIX: Destroy server session to prevent cross-user data leakage
      try {
        await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include'
        });
        logger.info('🧹 LOGOUT: Destroyed server session');
      } catch (sessionError) {
        logger.error('Failed to destroy server session:', sessionError);
        // Continue with Firebase logout even if session destruction fails
      }

      await signOut(auth);
      
      // ENTERPRISE: Reset auth phase and session sync flag on logout
      hasSyncedThisSession.current = false;
      setAuthPhase('idle');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Authenticate with Google and STOP — see the contract on AuthContextType.
   *
   * The popup necessarily leaves a Firebase session behind; nothing else is written.
   * No application account is created, so the visitor still has to confirm their
   * details before one exists.
   */
  const authenticateWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const result = await signInWithPopup(auth, provider);
    const googleUser = result.user;

    if (!googleUser.email) {
      await auth.signOut();
      throw new Error('No email found in Google account');
    }

    // Neon is authoritative for whether an account exists. Firebase's `isNewUser`
    // describes the Google identity in Firebase, not a LocalCooks profile.
    const token = await googleUser.getIdToken();
    const response = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (response.status !== 404 && !response.ok) {
      await auth.signOut();
      throw new Error('Unable to verify your account. Please try again.');
    }

    const existing = response.ok;
    if (!existing) {
      // Nothing is provisioned yet, so this is an attempt in flight. Mark it: walking
      // away from the form must not leave the visitor signed in to an account that was
      // never created — and must not leave the Firebase identity behind either.
      //
      // `isNewUser` describes whether the POPUP created this Firebase identity, which
      // is what decides whether an abandonment DELETES it or merely signs out of it.
      markPendingGoogleRegistration({
        uid: googleUser.uid,
        email: googleUser.email,
        createdIdentity: getAdditionalUserInfo(result)?.isNewUser === true,
      });
    }

    return {
      existing,
      email: googleUser.email,
      displayName: googleUser.displayName?.trim() || googleUser.email.split('@')[0],
    };
  };

  /**
   * Abandon an in-flight Google registration NOW, rather than waiting for the next
   * auth-state pass.
   *
   * The register step's "Already have an account? Log in" link leaves WITHOUT a page
   * load, so the load-time sweep never runs and the orphaned Firebase identity — the
   * thing that makes the address resolve as `profile-incomplete` and be offered sign-in
   * routes it can never complete — survives. Explicit navigation is safe to hook here:
   * unlike the loading gate, it does not unmount the flow mid-registration.
   *
   * A no-op unless the current session really is the pending attempt.
   */
  const discardPendingGoogleRegistration = async () => {
    const current = auth.currentUser;
    const pending = pendingGoogleRegistration();
    if (!current || !pending || pending.uid !== current.uid) return;
    clearPendingGoogleRegistration();
    try {
      if (pending.createdIdentity) {
        await deleteUser(current);
        logger.info('✅ Discarded the pending Google registration and its identity');
      } else {
        await auth.signOut();
      }
    } catch (error) {
      logger.warn('Could not discard the pending Google registration cleanly', error);
      await auth.signOut().catch(() => undefined);
    }
  };

  const signInWithGoogle = async (isRegistration = false, accountType: PublicRegistrationRole = 'chef', termsAccepted = false, profile?: { displayName: string; phoneNumber: string }) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    logger.info('📊 AUTH PHASE: idle → authenticating (Google sign-in)');
    try {
      const provider = new GoogleAuthProvider();
      // `login_hint` pre-selects the account this browser last used, so the
      // chooser costs one confirming click instead of a hunt. Google ignores it
      // when it matches no active session, so sending it is never harmful — and
      // it is only sent on sign-in, never registration, where hinting a
      // previous identity would be wrong.
      const hintedAccount = isRegistration ? null : getLastAccount();
      provider.setCustomParameters({
        prompt: 'select_account',
        ...(hintedAccount ? { login_hint: hintedAccount.email } : {}),
      });

      if (isRegistration) {
        // For REGISTRATION: Sign in directly and create user
        logger.info('🔥 GOOGLE REGISTRATION - Starting registration flow');
        setPendingSync(true);
        setPendingRegistration(true);
        pendingSyncRef.current = true;
        pendingRegistrationRef.current = true;

        const result = await signInWithPopup(auth, provider);
        logger.info('✅ GOOGLE REGISTRATION - Firebase sign-in complete:', result.user.uid);

        const isNewGoogleUser = getAdditionalUserInfo(result)?.isNewUser === true;

        // Firebase's `isNewUser` describes the Google identity in Firebase, not
        // whether a LocalCooks profile exists. Always use Neon as the
        // authoritative application-account check. This also lets an
        // interrupted registration safely resume when Firebase was created but
        // backend provisioning never completed.
        const token = await result.user.getIdToken();
        const profileResponse = await fetch('/api/user/profile', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (profileResponse.ok) {
          logger.info('✅ GOOGLE REGISTRATION - Existing LocalCooks profile found; completing as sign-in');
          hasSyncedThisSession.current = true;
          pendingSyncRef.current = false;
          pendingRegistrationRef.current = false;
          setPendingSync(false);
          setPendingRegistration(false);
          await refreshUserData();
          await rememberAuthMethod(result.user.email, 'google', result.user.displayName);
          setAuthPhase('ready');
          return 'existing';
        }

        if (profileResponse.status !== 404) {
          await auth.signOut();
          throw new Error('Unable to verify your account. Please try again.');
        }

        const googleDisplayName = profile?.displayName?.trim() || result.user.displayName?.trim();
        if (!googleDisplayName) {
          await auth.signOut();
          throw new Error('Your Google account must provide a display name.');
        }

        await updateProfile(result.user, { displayName: googleDisplayName });
        await result.user.reload();
        const googleUser = auth.currentUser || result.user;

        const normalizedProfilePhone = profile?.phoneNumber
          ? normalizePhoneNumber(profile.phoneNumber)
          : undefined;

        // Manually trigger sync for registration with detected role
        let syncSuccess = false;
        try {
          syncSuccess = await syncUserWithBackend(googleUser, accountType, true, termsAccepted, normalizedProfilePhone || undefined);
        } catch (syncError) {
          if (isNewGoogleUser) {
            try {
              await result.user.delete();
              logger.info('✅ Rolled back new Google identity after backend provisioning failed');
            } catch (deleteError) {
              logger.error('❌ Failed to roll back Google identity after provisioning failure:', deleteError);
            }
          } else {
            await auth.signOut();
          }
          throw syncError;
        }

        if (syncSuccess) {
          logger.info('✅ Google registration sync completed');
          hasSyncedThisSession.current = true;
          pendingSyncRef.current = false;
          pendingRegistrationRef.current = false;
          setPendingSync(false);
          setPendingRegistration(false);
          await refreshUserData();
          await rememberAuthMethod(googleUser.email, 'google', googleUser.displayName);
          setAuthPhase('ready');
          return 'registered';
        } else {
          logger.error('❌ Google registration sync failed');
          if (isNewGoogleUser) {
            await result.user.delete().catch((deleteError) => {
              logger.error('❌ Failed to roll back Google identity after provisioning failure:', deleteError);
            });
          } else {
            await auth.signOut();
          }
          throw new Error('Failed to create account. Please try again.');
        }
      } else {
        // For SIGN-IN: Check if user exists using a simple backend call first
        logger.info('🔍 GOOGLE SIGN-IN - Checking user existence...');

        // First, sign in to get the user's email/UID
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        if (!user.email) {
          await auth.signOut();
          throw new Error('No email found in Google account');
        }

        logger.info(`🔍 Checking if user exists in backend: ${user.email}`);

        // Check if user exists in our backend system using /api/user/profile
        const token = await user.getIdToken();
        const response = await fetch('/api/user/profile', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          // User exists in backend - sign in successful
          logger.info('✅ GOOGLE SIGN-IN - User exists, completing sign-in');
          setPendingSync(true);
          await rememberAuthMethod(user.email, 'google', user.displayName);
          return 'existing';
        } else if (response.status === 404) {
          // User doesn't exist in backend - they need to register
          logger.info('❌ User does not exist in backend - needs to register');

          // Roll back the Firebase identity this attempt just created.
          //
          // A Google sign-in CREATES a Firebase Auth user as a side effect, so
          // merely signing out leaves one behind. That orphan has no LocalCooks
          // profile, yet `/api/firebase/auth-method-hints` finds the Firebase uid
          // and resolves it as `profile-incomplete` for ever after — so the same
          // address is later offered a sign-in route it can never complete, and
          // anyone can inflate the Firebase user table by picking an account we
          // do not know. The registration branch already deletes on failure; this
          // path did not.
          //
          // Only an identity created by THIS attempt is deleted. A pre-existing
          // Firebase user with no profile is a genuinely interrupted
          // registration, and must keep its recovery route.
          if (getAdditionalUserInfo(result)?.isNewUser === true) {
            try {
              await user.delete();
              logger.info('✅ Rolled back the Firebase identity created by this attempt');
            } catch (deleteError) {
              logger.error('❌ Failed to roll back the Firebase identity:', deleteError);
              await auth.signOut();
            }
          } else {
            await auth.signOut();
          }

          throw createMissingProfileError(user.email);
        } else {
          // Some other error
          logger.error('❌ Error checking user existence:', response.status);
          const errorText = await response.text();
          logger.error('❌ Error response:', errorText);
          await auth.signOut();
          throw new Error('Failed to verify user account. Please try again.');
        }
      }
    } catch (e: any) {
      // Clean up state on error
      pendingSyncRef.current = false;
      pendingRegistrationRef.current = false;
      setPendingSync(false);
      setPendingRegistration(false);
      setAuthPhase('error');
      logger.info('📊 AUTH PHASE: authenticating → error (Google sign-in failed)');

      // Re-throw the error so components can handle it with user-friendly messages
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const sendEmailLink = async (email: string) => {
    setError(null);
    try {
      // Try custom branded email endpoint first (uses server-side Firebase Admin + custom template)
      logger.info(`📧 Sending custom magic link email to: ${email}`);
      const intent = getAuthIntent();
      const returnUrl =
        intent?.returnPath ||
        `${window.location.pathname}${window.location.search}`;
      const customEmailResponse = await fetch('/api/firebase/send-magic-link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the origin the user is actually on. Without it the server has to guess, and
        // its guess (a public host) differs from where `emailForSignIn` was written — so the
        // link opened on a different origin, localStorage was empty, and the user was asked
        // to retype an address we had just masked. It also sent the post-sign-in redirect to
        // a different environment than the one they started from.
        body: JSON.stringify({ email, returnUrl, origin: window.location.origin })
      });

      if (!customEmailResponse.ok) {
        const customError = await customEmailResponse.json().catch(() => null);
        throw new Error(customError?.error || 'Unable to request a sign-in link. Please try again.');
      }

      logger.info(`✅ Magic-link request accepted for: ${email}`);
      // The server intentionally returns the same response for known and unknown
      // accounts. Never bypass that eligibility check with the client SDK.
      window.localStorage.setItem('emailForSignIn', email);
    } catch (e: any) {
      logger.error('❌ Error sending magic link email:', e);
      setError(e.message);
      throw e;
    }
  };

  const handleEmailLinkSignIn = async () => {
    setError(null);
    setLoading(true);
    // Without this the phase machine sits in `idle` for the whole round-trip, so
    // every loader gated on it disappears while the SDK is still exchanging the
    // link for a session — the login form then flashes before the redirect.
    setAuthPhase('authenticating');
    try {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
          // Keep cross-device confirmation inside the branded EmailAction UI.
          // Preserving the Firebase query parameters keeps the one-time link valid.
          const actionUrl = `/email-action${window.location.search}${window.location.hash}`;
          setAuthPhase(auth.currentUser ? 'ready' : 'idle');
          window.location.replace(actionUrl);
          return;
        }
        await signInWithEmailLink(auth, email, window.location.href);
        await rememberAuthMethod(email, 'email-link');
        window.localStorage.removeItem('emailForSignIn');
      } else {
        // Not a sign-in link at all — do not leave the phase machine hanging in
        // `authenticating`, or every loader stays up until the watchdog fires.
        setAuthPhase(auth.currentUser ? 'ready' : 'idle');
      }
    } catch (e: any) {
      setError(e.message);
      setAuthPhase('error');
    } finally {
      setLoading(false);
    }
  };

  // Function to check if user is verified
  const isUserVerified = (user: AuthUser | null): boolean => {
    return !!(user && (user.phoneVerified === true || user.emailVerified === true));
  };

  /**
   * ENTERPRISE: Role login origins — preview → dev-*, production → bare subdomain.
   */
  const DEFAULT_REDIRECT_PATHS = {
    manager: '/manager/login?verified=true',
    chef: '/auth?verified=true',
    admin: '/admin/login?verified=true',
  } as const;

  /**
   * Determines user role from current URL context (subdomain + path)
   */
  const detectRoleFromContext = (): 'manager' | 'chef' | 'admin' => {
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const subdomain = getSubdomainFromHostname(hostname);

    // Check subdomain first (most reliable)
    if (subdomain === 'admin') return 'admin';
    if (subdomain === 'chef') return 'chef';
    if (subdomain === 'kitchen') {
      // Kitchen subdomain - check path for manager vs chef
      if (pathname.includes('/manager')) return 'manager';
      return 'chef';
    }

    // Check path patterns as fallback
    if (pathname.includes('/admin')) return 'admin';
    if (pathname.includes('/manager')) return 'manager';

    // Default to chef
    return 'chef';
  };

  /**
   * Builds verification redirect URL based on role + VERCEL_ENV / host.
   * Preview → https://dev-chef.localcooks.ca/... ; production → https://chef.localcooks.ca/...
   */
  const buildVerificationRedirectUrl = (role?: 'manager' | 'chef' | 'admin'): string => {
    const detectedRole = role || detectRoleFromContext();
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost');

    if (isLocalhost) {
      return DEFAULT_REDIRECT_PATHS[detectedRole];
    }

    const origin = getRoleLoginOrigin(detectedRole, hostname, {
      vercelEnv: import.meta.env.VITE_VERCEL_ENV,
    });
    return `${origin}${DEFAULT_REDIRECT_PATHS[detectedRole]}`;
  };

  // Send verification email to a user (Firebase only)
  const sendVerificationEmail = async (email: string, fullName: string) => {
    try {
      logger.info('📧 Sending Custom verification email to:', email);
      const response = await fetch('/api/firebase/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!response.ok) {
        throw new Error('Failed to send verification email');
      }

      logger.info('✅ Custom verification email sent successfully');
      return true;
    } catch (error) {
      logger.error('❌ Error sending Custom verification email:', error);
      throw error;
    }
  };

  // Update user verification status
  const updateUserVerification = async () => {
    try {
      // Get current Firebase user and token
      const currentUser = auth.currentUser;
      if (!currentUser) {
        logger.error('No authenticated Firebase user');
        return null;
      }

      // **CRITICAL: Reload Firebase user to get latest verification status**
      await currentUser.reload();
      logger.info('🔄 UPDATING VERIFICATION STATUS');
      logger.info(`   - Firebase emailVerified: ${currentUser.emailVerified}`);

      const token = await currentUser.getIdToken(true);

      // **CRITICAL: Call the manual sync endpoint to update database verification status**
      try {
        logger.info('🔄 CALLING MANUAL VERIFICATION SYNC');
        const syncResponse = await fetch('/api/sync-verification-status', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (syncResponse.ok) {
          const syncResult = await syncResponse.json();
          logger.info('✅ VERIFICATION SYNC SUCCESS:', syncResult);
          logger.info(`   - Database is_verified: ${syncResult.databaseVerified}`);
          logger.info(`   - Firebase emailVerified: ${syncResult.firebaseVerified}`);
        } else {
          logger.error('❌ VERIFICATION SYNC FAILED:', syncResponse.status);
          const errorText = await syncResponse.text();
          logger.error('❌ Sync error details:', errorText);
        }
      } catch (syncError) {
        logger.error('❌ Error calling verification sync:', syncError);
      }

      // Now fetch the updated user data from the API
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        logger.info('✅ UPDATED USER DATA FETCHED:', {
          id: userData.id,
          email: userData.username,
          is_verified: userData.is_verified,
          has_seen_welcome: userData.has_seen_welcome
        });

        // Update the user state with fresh Firebase info + database data
        const updatedUser: AuthUser = {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          // The profile reports the server's own verification mirror, which is written the
          // moment a confirmation lands. Trusting it here is what lets a verification
          // surface without forcing a token refresh.
          emailVerified: currentUser.emailVerified || userData.emailVerified === true,
          phoneVerified: Boolean(currentUser.phoneNumber) || userData.phoneVerified === true,
          phoneNumber: userData.phoneNumber || userData.managerProfileData?.phone || null,
          providers: currentUser.providerData.map((p: any) => p.providerId),
          role: userData.role,
          isChef: userData.isChef || userData.is_chef || false,
          isManager: userData.isManager || userData.is_manager || false,
          isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
          isVerified: userData.isVerified || userData.is_verified,
          is_verified: userData.is_verified,
          hasSeenWelcome: userData.hasSeenWelcome || userData.has_seen_welcome,
          has_seen_welcome: userData.has_seen_welcome,
          termsAccepted: userData.termsAccepted || userData.terms_accepted,
          termsAcceptedAt: userData.termsAcceptedAt || userData.terms_accepted_at,
          termsVersion: userData.termsVersion || userData.terms_version,
          chefOnboardingCompleted: userData.chefOnboardingCompleted || userData.chef_onboarding_completed || false,
        };

        setUser(updatedUser);
        return updatedUser;
      } else {
        logger.error('Failed to fetch user data:', response.status);
      }
    } catch (error) {
      logger.error('Error updating user verification:', error);
    }

    return null;
  };

  /**
   * Resend Firebase verification email with role-based redirect URL
   * ENTERPRISE: Uses production subdomains for multi-tenant architecture
   */
  const resendFirebaseVerification = async () => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error('No user is currently signed in');
      }

      if (firebaseUser.emailVerified) {
        logger.info('User is already verified');
        return true;
      }

      logger.info('📧 Resending Custom verification email...');
      
      await sendVerificationEmailWithFallback({
        email: firebaseUser.email!,
        role: 'chef',
      });

      logger.info('✅ Custom verification email resent successfully');
      return true;
    } catch (error) {
      logger.error('❌ Failed to resend Custom verification email:', error);
      throw error;
    }
  };

  // Temporarily signs in to resend email verification for users who are signed out
  const resendEmailVerification = async (email: string, password: string) => {
    try {
      logger.info('📧 Sending verification email...');
      await sendVerificationEmailWithFallback({ email });
      
      logger.info('✅ Verification email resent successfully.');
      return true;
    } catch (error) {
      logger.error('❌ Error in resendEmailVerification:', error);
      throw error;
    }
  };

  // Refresh user data from backend (useful after role changes)
  //
  // `forceToken` must stay false for any refresh triggered by polling or by noticing a
  // change made elsewhere. Forcing a token refresh against an invalidated refresh token
  // makes the Firebase SDK sign the user out GLOBALLY — and an email change invalidates
  // that token — so a background refresh that forces one can log the user out of a session
  // that was about to be restored. Only force it for explicit user-initiated actions
  // (sign-in, registration, "I have verified my email").
  const refreshUserData = async ({ forceToken = true }: { forceToken?: boolean } = {}) => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        logger.warn('No Firebase user available for refresh');
        return null;
      }

      logger.info('🔄 Refreshing user data from backend...', { forceToken });
      // `reload()` can itself trigger a token refresh when the cached token has expired, so
      // a background refresh skips it and relies on the profile's verification mirror.
      if (forceToken) await firebaseUser.reload();
      const currentUser = auth.currentUser || firebaseUser;
      const token = await currentUser.getIdToken(forceToken);
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        logger.info('✅ User data refreshed from backend:', {
          role: userData.role,
          isChef: userData.isChef || userData.is_chef,
          is_verified: userData.is_verified,
          has_seen_welcome: userData.has_seen_welcome
        });

        // Update the user object with fresh data
        const updatedUser: AuthUser = {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          // The profile reports the server's own verification mirror, which is written the
          // moment a confirmation lands. Trusting it here is what lets a verification
          // surface without forcing a token refresh.
          emailVerified: currentUser.emailVerified || userData.emailVerified === true,
          phoneVerified: Boolean(currentUser.phoneNumber) || userData.phoneVerified === true,
          phoneNumber: userData.phoneNumber || userData.managerProfileData?.phone || null,
          providers: currentUser.providerData.map((p: any) => p.providerId),
          role: userData.role, // Don't set default role - let it be null if no role selected
          application_type: userData.application_type, // DEPRECATED: kept for backward compatibility
          isChef: userData.isChef || userData.is_chef || false,
          isManager: userData.isManager || userData.is_manager || false,
          isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
          is_verified: userData.is_verified,
          isVerified: userData.isVerified || userData.is_verified,
          has_seen_welcome: userData.has_seen_welcome,
          hasSeenWelcome: userData.hasSeenWelcome || userData.has_seen_welcome,
          termsAccepted: userData.termsAccepted || userData.terms_accepted,
          termsAcceptedAt: userData.termsAcceptedAt || userData.terms_accepted_at,
          termsVersion: userData.termsVersion || userData.terms_version,
          chefOnboardingCompleted: userData.chefOnboardingCompleted || userData.chef_onboarding_completed || false,
        };

        setUser(updatedUser);
        logger.info('✅ Auth context user updated with fresh data');
        
        // ENTERPRISE FIX: Set authPhase to ready after successful refresh
        // Don't trigger artificial loading state - it causes onboarding reset
        setAuthPhase('ready');
        queryClient.setQueryData(['/api/user/profile', currentUser.uid], userData);
        return updatedUser;
      } else {
        logger.error('❌ Failed to refresh user data:', response.status);
        return null;
      }
    } catch (error) {
      logger.error('❌ Error refreshing user data:', error);
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        // See `isSessionSettling`: this stays true until Firebase, the backend
        // sync and the first profile read have all resolved.
        loading: isSessionSettling,
        error,
        authPhase,
        login,
        signup,
        logout,
        signInWithGoogle,
        authenticateWithGoogle,
        discardPendingGoogleRegistration,
        sendEmailLink,
        handleEmailLinkSignIn,
        isUserVerified,
        updateUserVerification,
        sendVerificationEmail,
        resendFirebaseVerification,
        resendEmailVerification,
        refreshUserData,
        syncUserWithBackend,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useFirebaseAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useFirebaseAuth must be used within an AuthProvider");
  }
  return context;
}
