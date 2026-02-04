import { auth, db } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  doc,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { createContext, ReactNode, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getSubdomainFromHostname } from "@shared/subdomain-utils";
import { User, UserWithFlags } from "@shared/schema";

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
}

// Added for backward compatibility during refactoring
interface AuthUserLegacyFields {
  is_verified: boolean;
  has_seen_welcome: boolean;
  fullName: string | null;
  username: string | null;
  application_type: 'chef';
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authPhase: AuthPhase; // ENTERPRISE: Explicit auth phase for state machine
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  signInWithGoogle: (isRegistration?: boolean) => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  handleEmailLinkSignIn: () => Promise<void>;
  isUserVerified: (user: AuthUser | null) => boolean;
  updateUserVerification: () => Promise<AuthUser | null>;
  sendVerificationEmail: (email: string, fullName: string) => Promise<boolean>;
  resendFirebaseVerification: () => Promise<boolean>;
  refreshUserData: () => Promise<void>;
  syncUserWithBackend: (firebaseUser: any, role?: string, isRegistration?: boolean, password?: string) => Promise<boolean>;
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

  const syncUserWithBackend = async (firebaseUser: any, role?: string, isRegistration = false, password?: string) => {
    try {
      console.log('🔥 SYNC DEBUG - Starting backend sync for:', firebaseUser.uid, isRegistration ? '(REGISTRATION)' : '(SIGN-IN)');

      const token = await firebaseUser.getIdToken();

      // Auto-determine role based on current URL path AND subdomain during registration
      let finalRole = role;
      if (isRegistration && !finalRole) {
        const currentPath = window.location.pathname;
        const hostname = window.location.hostname;
        const subdomain = getSubdomainFromHostname(hostname);
        console.log(`🔍 Role detection for registration - Current path: ${currentPath}, Subdomain: ${subdomain}, Provided role: ${role}`);

        // CRITICAL: Check subdomain first (most reliable indicator)
        if (subdomain === 'admin') {
          finalRole = 'admin';
          console.log('👑 Auto-setting role to admin based on admin subdomain');
        } else if (subdomain === 'kitchen') {
          // Kitchen subdomain could be manager or chef - check path
          if (currentPath.includes('/manager') || currentPath.includes('manager')) {
            finalRole = 'manager';
            console.log('🏢 Auto-setting role to manager based on kitchen subdomain + manager path');
          } else {
            finalRole = 'chef';
            console.log('👨‍🍳 Auto-setting role to chef based on kitchen subdomain');
          }
        } else if (subdomain === 'chef') {
          finalRole = 'chef';
          console.log('👨‍🍳 Auto-setting role to chef based on chef subdomain');
        } else {
          // No subdomain match - check URL path as fallback
          if (currentPath === '/admin-register' || currentPath === '/admin/register' || currentPath === '/admin-login' || currentPath === '/admin/login') {
            finalRole = 'admin';
            console.log('👑 Auto-setting role to admin based on admin URL path');
          } else if (currentPath === '/manager-register' || currentPath === '/manager/register' || currentPath === '/manager-login' || currentPath === '/manager/login') {
            finalRole = 'manager';
            console.log('🏢 Auto-setting role to manager based on manager URL path');
          } else if (currentPath === '/auth') {
            finalRole = 'chef';
            console.log('👨‍🍳 Auto-setting role to chef based on /auth URL');
          } else {
            // CRITICAL: Don't default to chef - this causes admins/managers to be created as chefs
            // Instead, log a warning and let the backend handle it
            console.warn(`⚠️ WARNING: No role detected from subdomain "${subdomain}" or URL path "${currentPath}" during registration. Role will be determined by backend.`);
            finalRole = undefined; // Let backend determine or fail
          }
        }

        console.log(`✅ Final role determined: ${finalRole || 'undefined (will be determined by backend)'}`);
      } else if (isRegistration && finalRole) {
        console.log(`✅ Using provided role for registration: ${finalRole}`);
      } else {
        console.log(`ℹ️ Not a registration, using provided role: ${finalRole || 'none'}`);
      }

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
          role: finalRole || undefined, // Use auto-determined role (send undefined if not set, not null)
          isRegistration: isRegistration,
          password: password // Include password for email/password registrations
        })
      });

      console.log('📤 SYNC REQUEST DEBUG:', {
        endpoint,
        isRegistration,
        role: finalRole,
        currentPath: window.location.pathname,
        email: firebaseUser.email
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ SYNC SUCCESS:', result);
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ SYNC FAILED:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('❌ SYNC ERROR:', error);
      return false;
    }
  };

  // ENTERPRISE: Single stable onAuthStateChanged listener
  // Uses refs to access current state values, preventing multiple listener creation
  // Empty dependency array ensures this effect only runs once on mount
  useEffect(() => {
    console.log('📊 AUTH PHASE: Setting up onAuthStateChanged listener (runs once)');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          console.log('🔥 AUTH STATE CHANGE - User detected:', firebaseUser.uid);
          console.log('📊 AUTH PHASE: authenticating → syncing');
          
          // Only set to syncing if we're in authenticating phase (login/register in progress)
          // For session restoration, we skip the authenticating phase
          if (pendingSyncRef.current || pendingRegistrationRef.current) {
            setAuthPhase('syncing');
          }

          // Check if this is a verification redirect from email
          const urlParams = new URLSearchParams(window.location.search);
          const isVerificationRedirect = urlParams.has('verified') || window.location.href.includes('continueUrl');

          if (isVerificationRedirect) {
            console.log('📧 EMAIL VERIFICATION REDIRECT DETECTED - Reloading user data');
            await firebaseUser.reload(); // Refresh verification status
          }

          // Get providers list
          const providers = firebaseUser.providerData.map(p => p.providerId);
          console.log('🔥 AUTH PROVIDERS:', providers);
          console.log('🔥 EMAIL VERIFIED:', firebaseUser.emailVerified);

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
                isManager: userData.isManager || userData.is_manager || false,
                isPortalUser: userData.isPortalUser || userData.is_portal_user || false,
              };
              console.log('🔥 BACKEND USER DATA:', {
                role,
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome,
                isManager: userData.isManager,
                isPortalUser: userData.isPortalUser
              });
              
              // ENTERPRISE: User exists in backend, mark as synced
              hasSyncedThisSession.current = true;
            } else {
              console.log('🔥 NEW USER - No backend profile found, will need to sync');
            }
          } catch (error) {
            console.error('❌ BACKEND USER FETCH ERROR:', error);
            // Continue without default role if backend fails
          }

          // ENTERPRISE: Use refs to check sync conditions (prevents stale closures)
          const shouldSync = isInitializingRef.current || pendingSyncRef.current || pendingRegistrationRef.current || isVerificationRedirect;

          if (shouldSync && !hasSyncedThisSession.current) {
            console.log('🔥 SYNCING USER - Conditions met:', {
              isInitializing: isInitializingRef.current,
              pendingSync: pendingSyncRef.current,
              pendingRegistration: pendingRegistrationRef.current,
              isVerificationRedirect,
              hasSyncedThisSession: hasSyncedThisSession.current,
              uid: firebaseUser.uid,
              emailVerified: firebaseUser.emailVerified
            });

            const syncSuccess = await syncUserWithBackend(firebaseUser, role, pendingRegistrationRef.current);
            if (syncSuccess) {
              setPendingSync(false);
              setPendingRegistration(false);
              hasSyncedThisSession.current = true;
              console.log('✅ USER SYNCED - Backend sync complete');

              // If this was a verification redirect, clean up the URL
              if (isVerificationRedirect) {
                console.log('🧹 CLEANING UP VERIFICATION URL');
                window.history.replaceState({}, document.title, window.location.pathname);
              }
            } else {
              console.error('❌ USER SYNC FAILED - Will retry on next auth state change');
              setAuthPhase('error');
            }
          } else if (hasSyncedThisSession.current) {
            console.log('ℹ️ SKIPPING SYNC - Already synced this session');
          } else {
            console.log('ℹ️ SKIPPING SYNC - Session restoration or no sync needed');
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
          });
          
          // ENTERPRISE: Set auth phase to ready after successful user setup
          console.log('📊 AUTH PHASE: syncing → ready');
          setAuthPhase('ready');
        } else {
          console.log('🔥 AUTH STATE CHANGE - No user (logged out)');
          setUser(null);
          setPendingSync(false);
          setPendingRegistration(false);
          hasSyncedThisSession.current = false;
          setAuthPhase('idle');
        }
      } catch (err) {
        console.error("Auth state change error:", err);
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
    console.log('📊 AUTH PHASE: idle → authenticating (login)');
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

        // If user is not verified, check Firebase email verification
        if (!userData.is_verified) {
          console.log('❌ User not verified in database - checking Firebase verification');

          // Reload user to get latest verification status
          await cred.user.reload();

          if (cred.user.emailVerified) {
            // User verified in Firebase but not in our database - update our database
            console.log('✅ Firebase verified but database not updated - syncing...');
            setPendingSync(true);
            // Don't sign out, let the sync update the verification status
          } else {
            // User not verified in Firebase either
            console.log('❌ User not verified in Firebase - signing out');
            setAuthPhase('error');
            await signOut(auth);
            throw new Error('Please verify your email before logging in. Check your inbox for a verification link from Firebase.');
          }
        }

        // User is verified, allow login
        console.log('✅ User verified - login successful');
        setPendingSync(true);

      } else {
        // User doesn't exist in our database
        setAuthPhase('error');
        await signOut(auth);
        throw new Error('Account not found. Please register first.');
      }

    } catch (firebaseError: any) {
      console.error('Login failed:', firebaseError.message);
      setAuthPhase('error');
      setPendingSync(false);

      // Re-throw the error so components can handle it with user-friendly messages
      throw firebaseError;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (email: string, password: string, displayName?: string) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    console.log('📊 AUTH PHASE: idle → authenticating (signup)');
    try {
      setPendingSync(true); // Force sync on new signup
      setPendingRegistration(true); // Mark as registration
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Update the Firebase profile with displayName
      if (displayName) {
        await updateProfile(cred.user, { displayName });
        console.log('📝 Updated Firebase profile with displayName:', displayName);

        // Also update Firestore document with displayName and role (if detected)
        try {
          // Detect role from URL path
          const currentPath = window.location.pathname;
          let detectedRole: string | null = null;

          if (currentPath === '/admin-register' || currentPath === '/admin/register' || currentPath === '/admin-login' || currentPath === '/admin/login') {
            detectedRole = 'admin';
          } else if (currentPath === '/manager-register' || currentPath === '/manager/register' || currentPath === '/manager-login' || currentPath === '/manager/login') {
            detectedRole = 'manager';
          } else if (currentPath === '/auth') {
            detectedRole = 'chef';
          }

          const userDocRef = doc(db, "users", cred.user.uid);
          await setDoc(userDocRef, {
            email: cred.user.email,
            displayName: displayName,
            role: detectedRole, // Set detected role instead of null
            isChef: detectedRole === 'chef' || detectedRole === 'admin',
            isManager: detectedRole === 'manager',
            isAdmin: detectedRole === 'admin', // Track admin in Firestore
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          console.log('📝 Updated Firestore with displayName and role:', { displayName, role: detectedRole });
        } catch (firestoreError) {
          console.error('❌ Failed to update Firestore:', firestoreError);
          // Don't fail registration if Firestore fails
        }
      }

      // IMPORTANT: Manually sync the user before signing them out
      // Pass the updated user object and password for proper database storage
      console.log('📧 USER REGISTERED - Syncing to database with password and displayName');

      // Get the updated user object with displayName
      await cred.user.reload(); // Refresh the user object
      const updatedUser = auth.currentUser || cred.user;

      // Wait a moment for profile update to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      // Detect role from URL path for registration
      const currentPath = window.location.pathname;
      const currentUrl = window.location.href;
      let detectedRole: string | undefined = undefined;

      console.log('🔍 ROLE DETECTION DEBUG:', {
        pathname: currentPath,
        fullUrl: currentUrl,
        hash: window.location.hash,
        search: window.location.search
      });

      // Check for admin paths first (most specific)
      if (currentPath === '/admin-register' || currentPath === '/admin/register' ||
        currentPath === '/admin-login' || currentPath === '/admin/login' ||
        currentPath.startsWith('/admin-register') || currentPath.startsWith('/admin/register') ||
        currentPath.startsWith('/admin-login') || currentPath.startsWith('/admin/login')) {
        detectedRole = 'admin';
        console.log('👑 Detected admin role from URL path during signup');
      } else if (currentPath === '/manager-register' || currentPath === '/manager/register' ||
        currentPath === '/manager-login' || currentPath === '/manager/login' ||
        currentPath.startsWith('/manager-register') || currentPath.startsWith('/manager/register') ||
        currentPath.startsWith('/manager-login') || currentPath.startsWith('/manager/login')) {
        detectedRole = 'manager';
        console.log('🏢 Detected manager role from URL path during signup');
      } else if (currentPath === '/auth' || currentPath.startsWith('/auth')) {
        detectedRole = 'chef';
        console.log('👨‍🍳 Detected chef role from URL path during signup');
      } else {
        console.warn(`⚠️ No role detected from URL path "${currentPath}" during signup - role will be determined by backend`);
        console.warn(`   Full URL: ${currentUrl}`);
      }

      console.log(`✅ Final detected role for registration: "${detectedRole || 'undefined'}"`);

      // CRITICAL: Ensure role is set before syncing
      if (!detectedRole) {
        console.error(`❌ CRITICAL: No role detected during registration!`);
        console.error(`   - Current path: ${currentPath}`);
        console.error(`   - Full URL: ${currentUrl}`);
        throw new Error('Role detection failed. Please register from the appropriate page (admin, manager, or chef).');
      }

      const syncSuccess = await syncUserWithBackend(updatedUser, detectedRole, true, password);

      if (syncSuccess) {
        console.log('✅ User synced successfully during registration');
      } else {
        console.error('❌ User sync failed during registration');
      }

      // CRITICAL: Send Firebase's built-in email verification
      console.log('📧 Sending Firebase email verification...');
      let emailSent = false;
      try {
        // For localhost development, don't include actionCodeSettings to avoid domain whitelist issues
        // Firebase will use its default email template which works without domain configuration
        // Check for localhost, 127.0.0.1, and any subdomain of localhost (e.g., kitchen.localhost)
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.endsWith('.localhost');

        if (isLocalhost) {
          // Simple verification without custom redirect - works on localhost
          console.log('📧 Using simple email verification (localhost mode)');
          await sendEmailVerification(updatedUser);
        } else {
          // ENTERPRISE: Determine the correct redirect URL based on user role
          // Production subdomains: kitchen.localcooks.ca (managers), chef.localcooks.ca (chefs), admin.localcooks.ca (admins)
          let redirectUrl = `${window.location.origin}/auth?verified=true`;

          // Determine redirect based on detected role
          if (detectedRole === 'manager') {
            redirectUrl = 'https://kitchen.localcooks.ca/manager/login?verified=true';
          } else if (detectedRole === 'chef') {
            redirectUrl = 'https://chef.localcooks.ca/auth?verified=true';
          } else if (detectedRole === 'admin') {
            redirectUrl = 'https://admin.localcooks.ca/admin/login?verified=true';
          }

          console.log(`📧 Using redirect URL for ${detectedRole}: ${redirectUrl}`);

          await sendEmailVerification(updatedUser, {
            url: redirectUrl,
            handleCodeInApp: false,
          });
        }
        console.log('✅ Firebase email verification sent successfully');
        emailSent = true;
      } catch (emailError: any) {
        console.error('❌ Failed to send Firebase verification email:', emailError);
        console.error('❌ Error code:', emailError?.code);
        console.error('❌ Error message:', emailError?.message);

        // If domain not whitelisted, try without actionCodeSettings
        if (emailError?.code === 'auth/unauthorized-continue-uri') {
          console.log('🔄 Retrying email verification without custom redirect...');
          try {
            await sendEmailVerification(updatedUser);
            console.log('✅ Firebase email verification sent (fallback mode)');
            emailSent = true;
          } catch (retryError) {
            console.error('❌ Fallback email verification also failed:', retryError);
          }
        }
      }

      if (!emailSent) {
        console.warn('⚠️ Verification email was not sent - user will need to request resend');
      }

      // CRITICAL: Sign out the user immediately after registration and sync
      // They need to verify their email before they can log in
      console.log('📧 USER REGISTERED - Signing out to require email verification');
      await signOut(auth);

      // Reset states
      setPendingSync(false);
      setPendingRegistration(false);

    } catch (e: any) {
      // Don't set raw Firebase error - let the components handle user-friendly messages
      // setError(e.message);
      setPendingSync(false);
      setPendingRegistration(false);

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

      // SECURITY FIX: Clear all localStorage data to prevent cross-user data leakage
      localStorage.clear();
      console.log('🧹 LOGOUT: Cleared all localStorage data');

      // SECURITY FIX: Clear all React Query cache to prevent cross-user data leakage
      queryClient.clear();
      console.log('🧹 LOGOUT: Cleared all React Query cache');

      // SECURITY FIX: Destroy server session to prevent cross-user data leakage
      try {
        await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include'
        });
        console.log('🧹 LOGOUT: Destroyed server session');
      } catch (sessionError) {
        console.error('Failed to destroy server session:', sessionError);
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

  const signInWithGoogle = async (isRegistration = false) => {
    setError(null);
    setLoading(true);
    setAuthPhase('authenticating'); // ENTERPRISE: Set auth phase to authenticating
    console.log('📊 AUTH PHASE: idle → authenticating (Google sign-in)');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });

      if (isRegistration) {
        // For REGISTRATION: Sign in directly and create user
        console.log('🔥 GOOGLE REGISTRATION - Starting registration flow');
        setPendingSync(true);
        setPendingRegistration(true);

        const result = await signInWithPopup(auth, provider);
        console.log('✅ GOOGLE REGISTRATION - Firebase sign-in complete:', result.user.uid);

        // Auto-determine role from subdomain AND URL path before sync
        const currentPath = window.location.pathname;
        const hostname = window.location.hostname;
        const subdomain = getSubdomainFromHostname(hostname);
        let detectedRole: string | undefined = undefined;

        console.log(`🔍 Role detection - Path: ${currentPath}, Subdomain: ${subdomain}`);

        // CRITICAL: Check subdomain first (most reliable indicator)
        if (subdomain === 'admin') {
          detectedRole = 'admin';
          console.log('👑 Detected role: admin from admin subdomain');
        } else if (subdomain === 'kitchen') {
          // Kitchen subdomain could be manager or chef - check path
          if (currentPath.includes('/manager') || currentPath.includes('manager')) {
            detectedRole = 'manager';
            console.log('🏢 Detected role: manager from kitchen subdomain + manager path');
          } else {
            detectedRole = 'chef';
            console.log('👨‍🍳 Detected role: chef from kitchen subdomain');
          }
        } else if (subdomain === 'chef') {
          detectedRole = 'chef';
          console.log('👨‍🍳 Detected role: chef from chef subdomain');
        } else {
          // No subdomain match - check URL path as fallback
          if (currentPath === '/admin-login' || currentPath === '/admin/login' || currentPath === '/admin-register' || currentPath === '/admin/register') {
            detectedRole = 'admin';
            console.log('👑 Detected role: admin from URL path');
          } else if (currentPath === '/manager-register' || currentPath === '/manager/register' || currentPath === '/manager-login' || currentPath === '/manager/login') {
            detectedRole = 'manager';
            console.log('🏢 Detected role: manager from URL path');
          } else if (currentPath === '/auth') {
            detectedRole = 'chef';
            console.log('👨‍🍳 Detected role: chef from URL path');
          } else {
            // CRITICAL: Don't default to 'chef' - this causes admins/managers to be created as chefs
            // Log warning and let backend handle it or fail
            console.warn(`⚠️ WARNING: No role detected from subdomain "${subdomain}" or URL path "${currentPath}" during Google registration. Role will be determined by backend or registration will fail.`);
            detectedRole = undefined; // Let backend determine or fail
          }
        }

        // Manually trigger sync for registration with detected role
        const syncSuccess = await syncUserWithBackend(result.user, detectedRole, true);

        // Create/update Firestore document with the correct role
        try {
          const userDocRef = doc(db, "users", result.user.uid);
          await setDoc(userDocRef, {
            email: result.user.email,
            displayName: result.user.displayName,
            role: detectedRole || null, // Set the detected role (null if undefined)
            isChef: detectedRole === 'chef' || detectedRole === 'admin',
            isManager: detectedRole === 'manager',
            isAdmin: detectedRole === 'admin', // Track admin in Firestore (not in Neon schema)
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true }); // Use merge to update if document already exists
          console.log(`📝 Created/updated Firestore document for Google user with role: ${detectedRole}`);
        } catch (firestoreError) {
          console.error('❌ Failed to create/update Firestore document:', firestoreError);
          // Don't fail registration if Firestore fails
        }
        if (syncSuccess) {
          console.log('✅ Google registration sync completed');
          setPendingSync(false);
          setPendingRegistration(false);
        } else {
          console.error('❌ Google registration sync failed');
          throw new Error('Failed to create account. Please try again.');
        }
      } else {
        // For SIGN-IN: Check if user exists using a simple backend call first
        console.log('🔍 GOOGLE SIGN-IN - Checking user existence...');

        // First, sign in to get the user's email/UID
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        if (!user.email) {
          await auth.signOut();
          throw new Error('No email found in Google account');
        }

        console.log(`🔍 Checking if user exists in backend: ${user.email}`);

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
          console.log('✅ GOOGLE SIGN-IN - User exists, completing sign-in');
          setPendingSync(true);
        } else if (response.status === 404) {
          // User doesn't exist in backend - they need to register
          console.log('❌ User does not exist in backend - needs to register');
          await auth.signOut();
          throw new Error('This Google account is not registered with Local Cooks. Please create an account first.');
        } else {
          // Some other error
          console.error('❌ Error checking user existence:', response.status);
          const errorText = await response.text();
          console.error('❌ Error response:', errorText);
          await auth.signOut();
          throw new Error('Failed to verify user account. Please try again.');
        }
      }
    } catch (e: any) {
      // Clean up state on error
      setPendingSync(false);
      setPendingRegistration(false);

      // Re-throw the error so components can handle it with user-friendly messages
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const actionCodeSettings = {
    url: window.location.origin + "/auth",
    handleCodeInApp: true,
  };

  const sendEmailLink = async (email: string) => {
    setError(null);
    setLoading(true);
    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
    } catch (e: any) {
      setError(e.message);
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
          email = window.prompt('Please provide your email for confirmation') || '';
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
   * ENTERPRISE: Production subdomain configuration for role-based routing
   * Single source of truth for all email verification redirects
   */
  const PRODUCTION_SUBDOMAINS = {
    manager: 'https://kitchen.localcooks.ca',
    chef: 'https://chef.localcooks.ca',
    admin: 'https://admin.localcooks.ca',
  } as const;

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
   * Builds enterprise-grade verification redirect URL based on role
   * Uses production subdomains in production, relative paths in development
   */
  const buildVerificationRedirectUrl = (role?: 'manager' | 'chef' | 'admin'): string => {
    const detectedRole = role || detectRoleFromContext();
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost');

    if (isLocalhost) {
      // Development: use relative paths for localhost
      return DEFAULT_REDIRECT_PATHS[detectedRole];
    }

    // Production: use full subdomain URLs
    return `${PRODUCTION_SUBDOMAINS[detectedRole]}${DEFAULT_REDIRECT_PATHS[detectedRole]}`;
  };

  // Send verification email to a user (Firebase only)
  const sendVerificationEmail = async (email: string, fullName: string) => {
    try {
      // Use Firebase's built-in verification email only
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error('No user is currently signed in');
      }

      if (firebaseUser.emailVerified) {
        console.log('User is already verified');
        return true;
      }

      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.localhost');

      console.log('📧 Sending Firebase verification email to:', email);

      if (isLocalhost) {
        // Development: Simple verification without custom redirect
        console.log('📧 Using simple verification (localhost mode)');
        await sendEmailVerification(firebaseUser);
      } else {
        // Production: Use role-based redirect URL
        const redirectUrl = buildVerificationRedirectUrl();
        console.log(`📧 Using redirect URL: ${redirectUrl}`);
        await sendEmailVerification(firebaseUser, {
          url: redirectUrl,
          handleCodeInApp: false, // Let Firebase handle the email action page
        });
      }

      console.log('✅ Firebase verification email sent successfully');
      return true;
    } catch (error) {
      console.error('❌ Error sending Firebase verification email:', error);
      throw error;
    }
  };

  // Update user verification status
  const updateUserVerification = async () => {
    try {
      // Get current Firebase user and token
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated Firebase user');
        return null;
      }

      // **CRITICAL: Reload Firebase user to get latest verification status**
      await currentUser.reload();
      console.log('🔄 UPDATING VERIFICATION STATUS');
      console.log(`   - Firebase emailVerified: ${currentUser.emailVerified}`);

      const token = await currentUser.getIdToken();

      // **CRITICAL: Call the manual sync endpoint to update database verification status**
      try {
        console.log('🔄 CALLING MANUAL VERIFICATION SYNC');
        const syncResponse = await fetch('/api/sync-verification-status', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (syncResponse.ok) {
          const syncResult = await syncResponse.json();
          console.log('✅ VERIFICATION SYNC SUCCESS:', syncResult);
          console.log(`   - Database is_verified: ${syncResult.databaseVerified}`);
          console.log(`   - Firebase emailVerified: ${syncResult.firebaseVerified}`);
        } else {
          console.error('❌ VERIFICATION SYNC FAILED:', syncResponse.status);
          const errorText = await syncResponse.text();
          console.error('❌ Sync error details:', errorText);
        }
      } catch (syncError) {
        console.error('❌ Error calling verification sync:', syncError);
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
        console.log('✅ UPDATED USER DATA FETCHED:', {
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
        };

        setUser(updatedUser);
        return updatedUser;
      } else {
        console.error('Failed to fetch user data:', response.status);
      }
    } catch (error) {
      console.error('Error updating user verification:', error);
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
        console.log('User is already verified');
        return true;
      }

      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.localhost');

      console.log('📧 Resending Firebase verification email...');

      if (isLocalhost) {
        // Development: Simple verification without custom redirect
        console.log('📧 Using simple verification (localhost mode)');
        await sendEmailVerification(firebaseUser);
      } else {
        // Production: Use role-based redirect URL
        const redirectUrl = buildVerificationRedirectUrl();
        console.log(`📧 Using redirect URL: ${redirectUrl}`);
        await sendEmailVerification(firebaseUser, {
          url: redirectUrl,
          handleCodeInApp: false, // Let Firebase handle the email action page
        });
      }

      console.log('✅ Firebase verification email resent successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to resend Firebase verification email:', error);
      throw error;
    }
  };

  // Refresh user data from backend (useful after role changes)
  const refreshUserData = async () => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        console.warn('No Firebase user available for refresh');
        return;
      }

      console.log('🔄 Refreshing user data from backend...');
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        console.log('✅ User data refreshed from backend:', {
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
        };

        setUser(updatedUser);
        console.log('✅ Auth context user updated with fresh data');
        
        // ENTERPRISE FIX: Set authPhase to ready after successful refresh
        // Don't trigger artificial loading state - it causes onboarding reset
        setAuthPhase('ready');
      } else {
        console.error('❌ Failed to refresh user data:', response.status);
      }
    } catch (error) {
      console.error('❌ Error refreshing user data:', error);
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