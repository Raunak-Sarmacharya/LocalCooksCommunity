import { logger } from "@/lib/logger";
import { auth, db } from "@/lib/firebase";
import { getAuthIntent } from "@/lib/auth-intent";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { queryClient } from "@/lib/queryClient";
import { createUserWithEmailAndPassword, getAdditionalUserInfo, GoogleAuthProvider, isSignInWithEmailLink, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithEmailLink, signInWithPopup, signOut, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, ReactNode, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getSubdomainFromHostname, getRoleLoginOrigin } from "@shared/subdomain-utils";
import { User, UserWithFlags } from "@shared/schema";
import { createDuplicateAccountError, isDuplicateAccountError } from "@/lib/registration-error";

// ENTERPRISE: Auth Phase State Machine
// Separates Firebase Auth State from Sync State to prevent timing issues
export type AuthPhase = 
  | 'idle'           // Not authenticated
  | 'authenticating' // Firebase auth in progress (popup open, etc.)
  | 'syncing'        // Backend sync in progress
  | 'ready'          // Fully authenticated, sync complete
  | 'error';         // Auth failed

interface AuthUser extends Partial<AuthUserLegacyFields> {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
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
  signup: (email: string, password: string, displayName?: string, accountType?: PublicRegistrationRole, termsAccepted?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  signInWithGoogle: (isRegistration?: boolean, accountType?: PublicRegistrationRole, termsAccepted?: boolean) => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  handleEmailLinkSignIn: () => Promise<void>;
  isUserVerified: (user: AuthUser | null) => boolean;
  updateUserVerification: () => Promise<AuthUser | null>;
  sendVerificationEmail: (email: string, fullName: string) => Promise<boolean>;
  resendFirebaseVerification: () => Promise<boolean>;
  resendEmailVerification: (email: string, password: string) => Promise<boolean>;
  refreshUserData: () => Promise<void>;
  syncUserWithBackend: (firebaseUser: any, accountType?: PublicRegistrationRole, isRegistration?: boolean, termsAccepted?: boolean) => Promise<boolean>;
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

  const syncUserWithBackend = async (firebaseUser: any, accountType?: PublicRegistrationRole, isRegistration = false, termsAccepted = false) => {
    try {
      logger.info('🔥 SYNC DEBUG - Starting backend sync for:', firebaseUser.uid, isRegistration ? '(REGISTRATION)' : '(SIGN-IN)');

      const token = await firebaseUser.getIdToken();

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

          if (response.status === 409 || errorPayload?.code === "EMAIL_EXISTS") {
            throw createDuplicateAccountError(errorPayload?.message || errorPayload?.error);
          }
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
            }
          } catch (error) {
            logger.error('❌ BACKEND USER FETCH ERROR:', error);
            // Continue without default role if backend fails
          }

          // ENTERPRISE: Use refs to check sync conditions (prevents stale closures)
          // Registration is provisioned explicitly by signup/signInWithGoogle so
          // the selected public account type and consent evidence travel in the
          // same request. The auth-state listener must not race that request.
          const shouldSync = !pendingRegistrationRef.current &&
            (isInitializingRef.current || pendingSyncRef.current || isVerificationRedirect);

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
                    has_seen_welcome: userData.has_seen_welcome,
                    hasSeenWelcome: userData.hasSeenWelcome || userData.has_seen_welcome,
                    termsAccepted: userData.termsAccepted || userData.terms_accepted,
                    termsAcceptedAt: userData.termsAcceptedAt || userData.terms_accepted_at,
                    termsVersion: userData.termsVersion || userData.terms_version,
                    isManager: userData.isManager || userData.is_manager || false,
                    isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
                    chefOnboardingCompleted: userData.chefOnboardingCompleted || userData.chef_onboarding_completed || false,
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
            emailVerified: firebaseUser.emailVerified,
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

          if (pendingRegistrationRef.current) {
            // signup()/Google registration is still performing the authoritative
            // Neon provisioning request. It will mark the phase ready only after
            // that request succeeds.
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

        if (!cred.user.emailVerified) {
          logger.info('❌ User not verified in Firebase - signing out');
          setAuthPhase('error');
          await signOut(auth);
          throw new Error('Please verify your email before logging in. Check your inbox and spam folder for the verification link, then click it to continue.');
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

  const signup = async (email: string, password: string, displayName?: string, accountType: PublicRegistrationRole = 'chef', termsAccepted = false) => {
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
        syncSuccess = await syncUserWithBackend(updatedUser, accountType, true, termsAccepted);
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

      // Write optional metadata only after the authoritative database accepts signup.
      // Firestore rules intentionally disallow client deletion, so it cannot be rolled back.
      if (displayName) {
        // Firestore contains non-authoritative profile data only. Application
        // roles are assigned and enforced by the backend/Neon profile.
        try {
          const userDocRef = doc(db, "users", cred.user.uid);
          await setDoc(userDocRef, {
            email: cred.user.email,
            displayName: displayName,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          logger.info('📝 Updated non-authoritative Firestore profile data');
        } catch (firestoreError) {
          logger.error('❌ Failed to update Firestore:', firestoreError);
          // Don't fail registration if Firestore fails
        }
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

      // Removed: Sign out the user immediately after registration
      // Keeping them logged in allows for a smoother UX when they verify their email.
      // They are still unverified, so protected routes will still block them.
      logger.info('📧 USER REGISTERED - Kept logged in (unverified) to allow seamless verification');


      // Reset states
      setPendingSync(false);
      setPendingRegistration(false);

    } catch (e: any) {
      // Don't set raw Firebase error - let the components handle user-friendly messages
      // setError(e.message);
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

  const signInWithGoogle = async (isRegistration = false, accountType: PublicRegistrationRole = 'chef', termsAccepted = false) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    logger.info('📊 AUTH PHASE: idle → authenticating (Google sign-in)');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
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
          setAuthPhase('ready');
          return;
        }

        if (profileResponse.status !== 404) {
          await auth.signOut();
          throw new Error('Unable to verify your account. Please try again.');
        }

        // Manually trigger sync for registration with detected role
        let syncSuccess = false;
        try {
          syncSuccess = await syncUserWithBackend(result.user, accountType, true, termsAccepted);
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

        // Keep Firestore profile data non-authoritative; role comes from Neon.
        try {
          const userDocRef = doc(db, "users", result.user.uid);
          await setDoc(userDocRef, {
            email: result.user.email,
            displayName: result.user.displayName,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true }); // Use merge to update if document already exists
          logger.info('📝 Created/updated non-authoritative Firestore profile data');
        } catch (firestoreError) {
          logger.error('❌ Failed to create/update Firestore document:', firestoreError);
          // Don't fail registration if Firestore fails
        }
        if (syncSuccess) {
          logger.info('✅ Google registration sync completed');
          hasSyncedThisSession.current = true;
          pendingSyncRef.current = false;
          pendingRegistrationRef.current = false;
          setPendingSync(false);
          setPendingRegistration(false);
          await refreshUserData();
          setAuthPhase('ready');
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
        } else if (response.status === 404) {
          // User doesn't exist in backend - they need to register
          logger.info('❌ User does not exist in backend - needs to register');
          await auth.signOut();
          throw new Error('This Google account is not registered with Local Cooks. Please create an account first.');
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
    setLoading(true);
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
        body: JSON.stringify({ email, returnUrl })
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
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLinkSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
          // Keep cross-device confirmation inside the branded EmailAction UI.
          // Preserving the Firebase query parameters keeps the one-time link valid.
          const actionUrl = `/email-action${window.location.search}${window.location.hash}`;
          window.location.replace(actionUrl);
          return;
        }
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem('emailForSignIn');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Function to check if user is verified
  const isUserVerified = (user: AuthUser | null): boolean => {
    return !!(user && (user.isVerified === true || user.is_verified === true || user.emailVerified === true));
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
          emailVerified: currentUser.emailVerified,
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
  const refreshUserData = async () => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        logger.warn('No Firebase user available for refresh');
        return;
      }

      logger.info('🔄 Refreshing user data from backend...');
      const token = await firebaseUser.getIdToken();
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
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          emailVerified: firebaseUser.emailVerified,
          providers: firebaseUser.providerData.map((p: any) => p.providerId),
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
      } else {
        logger.error('❌ Failed to refresh user data:', response.status);
      }
    } catch (error) {
      logger.error('❌ Error refreshing user data:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        authPhase,
        login,
        signup,
        logout,
        signInWithGoogle,
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
