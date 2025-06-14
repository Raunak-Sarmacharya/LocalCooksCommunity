import { auth, db } from "@/lib/firebase";
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
    getDoc,
    serverTimestamp,
    setDoc,
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
          
          // Get providers list
          const providers = firebaseUser.providerData.map(p => p.providerId);
          console.log('🔥 AUTH PROVIDERS:', providers);

          // Check for user role in Firestore
          let role = "applicant";
          try {
            const userDocRef = doc(db, "users", firebaseUser.uid);
            const userSnap = await getDoc(userDocRef);
            
            if (userSnap.exists()) {
              const userData = userSnap.data();
              role = userData.role || "applicant";
              console.log('🔥 FIRESTORE ROLE:', role);
            } else {
              console.log('🔥 NEW USER - Creating Firestore document');
              // Create user document in Firestore for new users
              await setDoc(userDocRef, {
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                role: "applicant",
                createdAt: serverTimestamp(),
                lastLoginAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          } catch (firestoreError) {
            console.error('Firestore error:', firestoreError);
          }
          
          // **IMPROVED SYNC LOGIC**
          // Sync if this is the first initialization, pending sync is requested, or pending registration
          const shouldSync = isInitializing || pendingSync || pendingRegistration;
          
          if (shouldSync) {
            console.log('🔥 SYNCING USER - Conditions met:', {
              isInitializing,
              pendingSync,
              pendingRegistration,
              uid: firebaseUser.uid
            });
            
            const syncSuccess = await syncUserWithBackend(firebaseUser, role, pendingRegistration);
            if (syncSuccess) {
              setPendingSync(false);
              setPendingRegistration(false);
              console.log('✅ USER SYNCED - Backend sync complete');
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
      setError(firebaseError.message);
      setPendingSync(false);
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
            role: "applicant",
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
      
      const syncSuccess = await syncUserWithBackend(updatedUser, "applicant", true, password);
      
      if (syncSuccess) {
        console.log('✅ User synced successfully during registration');
      } else {
        console.error('❌ User sync failed during registration');
      }

      // CRITICAL: Send Firebase's built-in email verification
      console.log('📧 Sending Firebase email verification...');
      try {
        await sendEmailVerification(updatedUser, {
          url: `${window.location.origin}/auth?verified=true`,
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
      setError(e.message);
      setPendingSync(false);
      setPendingRegistration(false);
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
      setError(e.message);
      setPendingSync(false);
      setPendingRegistration(false);
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

  // Send verification email to a user
  const sendVerificationEmail = async (email: string, fullName: string) => {
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: email, 
          fullName: fullName 
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to send verification email');
      }
      
      return true;
    } catch (error) {
      console.error('Error sending verification email:', error);
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

      const token = await currentUser.getIdToken();
      
      const response = await fetch('/api/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return userData;
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
        url: `${window.location.origin}/auth?verified=true`,
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