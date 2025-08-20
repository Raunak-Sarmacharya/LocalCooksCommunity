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
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providers: string[];
  role?: string;
  application_type?: 'chef' | 'delivery_partner'; // DEPRECATED: kept for backward compatibility
  isChef?: boolean;
  isDeliveryPartner?: boolean;
  is_verified?: boolean;
  has_seen_welcome?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  signInWithGoogle: (isRegistration?: boolean) => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  handleEmailLinkSignIn: () => Promise<void>;
  isUserVerified: (user: any) => boolean;
  updateUserVerification: () => Promise<AuthUser | null>;
  sendVerificationEmail: (email: string, fullName: string) => Promise<boolean>;
  resendFirebaseVerification: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [pendingSync, setPendingSync] = useState(false);
  const [pendingRegistration, setPendingRegistration] = useState(false);

  const syncUserWithBackend = async (firebaseUser: any, role?: string, isRegistration = false, password?: string) => {
    try {
      console.log('🔥 SYNC DEBUG - Starting backend sync for:', firebaseUser.uid, isRegistration ? '(REGISTRATION)' : '(SIGN-IN)');
      
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
          role: role || "applicant",
          isRegistration: isRegistration,
          password: password // Include password for email/password registrations
        })
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          console.log('🔥 AUTH STATE CHANGE - User detected:', firebaseUser.uid);
          
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
          let role = "applicant";
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
              role = userData.role || "chef";
              applicationData = {
                application_type: userData.application_type, // DEPRECATED: kept for backward compatibility
                isChef: userData.isChef || userData.is_chef || false,
                isDeliveryPartner: userData.isDeliveryPartner || userData.is_delivery_partner || false,
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome
              };
              console.log('🔥 BACKEND USER DATA:', {
                role,
                application_type: userData.application_type,
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome
              });
            } else {
              console.log('🔥 NEW USER - No backend profile found, will need to sync');
            }
          } catch (error) {
            console.error('❌ BACKEND USER FETCH ERROR:', error);
            // Continue with default role if backend fails
          }
          
          // **IMPROVED SYNC LOGIC WITH VERIFICATION HANDLING**
          // Sync if this is the first initialization, pending sync is requested, pending registration, OR verification redirect
          const shouldSync = isInitializing || pendingSync || pendingRegistration || isVerificationRedirect;
          
          if (shouldSync) {
            console.log('🔥 SYNCING USER - Conditions met:', {
              isInitializing,
              pendingSync,
              pendingRegistration,
              isVerificationRedirect,
              uid: firebaseUser.uid,
              emailVerified: firebaseUser.emailVerified
            });
            
            const syncSuccess = await syncUserWithBackend(firebaseUser, role, pendingRegistration);
            if (syncSuccess) {
              setPendingSync(false);
              setPendingRegistration(false);
              console.log('✅ USER SYNCED - Backend sync complete');
              
              // If this was a verification redirect, clean up the URL
              if (isVerificationRedirect) {
                console.log('🧹 CLEANING UP VERIFICATION URL');
                window.history.replaceState({}, document.title, window.location.pathname);
              }
            } else {
              console.error('❌ USER SYNC FAILED - Will retry on next auth state change');
              // Keep pendingSync true to retry on next auth state change
            }
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
            isDeliveryPartner: applicationData?.isDeliveryPartner,
            is_verified: applicationData?.is_verified,
            has_seen_welcome: applicationData?.has_seen_welcome,
          });
        } else {
          console.log('🔥 AUTH STATE CHANGE - No user (logged out)');
          setUser(null);
          setPendingSync(false);
          setPendingRegistration(false);
        }
      } catch (err) {
        console.error("Auth state change error:", err);
        setError("Authentication error occurred");
      } finally {
        setLoading(false);
        if (isInitializing) {
          // Small delay to prevent flickering on initial load
          setTimeout(() => setIsInitializing(false), 50);
        }
      }
    });
    
    return () => unsubscribe();
  }, [isInitializing, pendingSync, pendingRegistration]);

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      // First, sign in to Firebase to verify credentials
      const cred = await signInWithEmailAndPassword(auth, email, password);
      
      // Get the user's ID token to check verification status
      const token = await cred.user.getIdToken();
      
      // Check if user is verified in our database
      const response = await fetch('/api/user', {
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
            await signOut(auth);
            throw new Error('Please verify your email before logging in. Check your inbox for a verification link from Firebase.');
          }
        }
        
        // User is verified, allow login
        console.log('✅ User verified - login successful');
        setPendingSync(true);
        
      } else {
        // User doesn't exist in our database
        await signOut(auth);
        throw new Error('Account not found. Please register first.');
      }
      
    } catch (firebaseError: any) {
      console.error('Login failed:', firebaseError.message);
      // Don't set raw Firebase error - let the components handle user-friendly messages
      // setError(firebaseError.message);
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
    try {
      setPendingSync(true); // Force sync on new signup
      setPendingRegistration(true); // Mark as registration
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update the Firebase profile with displayName
      if (displayName) {
        await updateProfile(cred.user, { displayName });
        console.log('📝 Updated Firebase profile with displayName:', displayName);
        
        // Also update Firestore document with displayName
        try {
          const userDocRef = doc(db, "users", cred.user.uid);
          await setDoc(userDocRef, {
            email: cred.user.email,
            displayName: displayName,
            role: "chef", // Base role - user will choose specific roles later
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          console.log('📝 Updated Firestore with displayName:', displayName);
        } catch (firestoreError) {
          console.error('❌ Failed to update Firestore:', firestoreError);
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
      
      const syncSuccess = await syncUserWithBackend(updatedUser, "chef", true, password);
      
      if (syncSuccess) {
        console.log('✅ User synced successfully during registration');
      } else {
        console.error('❌ User sync failed during registration');
      }

      // CRITICAL: Send Firebase's built-in email verification
      console.log('📧 Sending Firebase email verification...');
      try {
              await sendEmailVerification(updatedUser, {
        url: `${window.location.origin}/email-action`,
        handleCodeInApp: true,
      });
        console.log('✅ Firebase email verification sent successfully');
      } catch (emailError) {
        console.error('❌ Failed to send Firebase verification email:', emailError);
        // Still continue with registration, user can request resend later
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async (isRegistration = false) => {
    setError(null);
    setLoading(true);
    try {
      if (!isRegistration) {
        // For sign-in, first check if user exists
        const { checkUserExistsForGoogleAuth } = await import('@/utils/user-existence-check');
        const existenceCheck = await checkUserExistsForGoogleAuth();
        
        if (existenceCheck.error) {
          throw new Error(existenceCheck.error);
        }
        
        if (!existenceCheck.canSignIn) {
          throw new Error(
            existenceCheck.canRegister 
              ? 'This Google account is not registered with Local Cooks. Please create an account first.'
              : 'Unable to sign in with this Google account.'
          );
        }
        
        // User exists and can sign in - they're already signed in from the check
        console.log('✅ GOOGLE SIGN-IN COMPLETE (existing user)');
        setPendingSync(true);
        return;
      }
      
      // For registration or if user check passed, proceed with normal flow
      setPendingSync(true); // Force sync on Google sign in
      setPendingRegistration(isRegistration); // Set registration flag
      const provider = new GoogleAuthProvider();
      // Add prompt to ensure account selection
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      const result = await signInWithPopup(auth, provider);
      console.log('✅ GOOGLE SIGN-IN COMPLETE:', result.user.uid);
      
      // For Google registration, manually trigger sync since user is immediately available
      if (isRegistration) {
        console.log('🔥 GOOGLE REGISTRATION - Manually triggering sync');
        const syncSuccess = await syncUserWithBackend(result.user, "applicant", true);
        if (syncSuccess) {
          console.log('✅ Google registration sync completed');
          setPendingSync(false);
          setPendingRegistration(false);
        } else {
          console.error('❌ Google registration sync failed');
        }
      }
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
  const isUserVerified = (user: any) => {
    return user && user.is_verified === true;
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

      console.log('📧 Sending Firebase verification email to:', email);
      await sendEmailVerification(firebaseUser, {
        url: `${window.location.origin}/email-action`,
        handleCodeInApp: true,
      });
      
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
      const response = await fetch('/api/user', {
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

  // Resend Firebase verification email
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

      console.log('📧 Resending Firebase verification email...');
      await sendEmailVerification(firebaseUser, {
        url: `${window.location.origin}/email-action`,
        handleCodeInApp: true,
      });
      
      console.log('✅ Firebase verification email resent successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to resend Firebase verification email:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useFirebaseAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useFirebaseAuth must be used within an AuthProvider");
  }
  return context;
}