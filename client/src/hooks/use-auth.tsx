import { auth, db } from "@/lib/firebase";
import {
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    isSignInWithEmailLink,
    onAuthStateChanged,
    sendSignInLinkToEmail,
    signInWithEmailAndPassword,
    signInWithEmailLink,
    signInWithPopup,
    signOut,
    updateProfile,
} from "firebase/auth";
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    updateDoc,
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
  signInWithGoogle: () => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  handleEmailLinkSignIn: () => Promise<void>;
  isUserVerified: (user: any) => boolean;
  updateUserVerification: () => Promise<AuthUser | null>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Flag to track if we need to sync with backend
  const [pendingSync, setPendingSync] = useState(false);

  // Helper function to sync user with backend
  const syncUserWithBackend = async (firebaseUser: any, role?: string, forceSync = false) => {
    try {
      console.log("🔥 BACKEND SYNC initiated:");
      console.log("   - Firebase UID:", firebaseUser.uid);
      console.log("   - Email:", firebaseUser.email);
      console.log("   - Display Name:", firebaseUser.displayName);
      console.log("   - emailVerified:", firebaseUser.emailVerified);
      console.log("   - Force Sync:", forceSync);
      
      const token = await firebaseUser.getIdToken();
      const syncResponse = await fetch("/api/firebase-sync-user", {
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
          role: role || "applicant"
        })
      });
      
      if (syncResponse.ok) {
        const syncResult = await syncResponse.json();
        console.log("✅ User synced with backend database:", syncResult);
        return true;
      } else {
        console.error("❌ Sync response not OK:", syncResponse.status);
        const errorText = await syncResponse.text();
        console.error("❌ Sync error details:", errorText);
        return false;
      }
    } catch (err) {
      console.error("❌ Failed to sync Firebase user to backend:", err);
      return false;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // Get providers
          const providers = firebaseUser.providerData.map((p) => p.providerId);
          
          // Check if this is a session restoration (not a fresh login)
          const isSessionRestoration = isInitializing;
          
          // Sync Firestore user doc
          const userRef = doc(db, "users", firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          let role: string | undefined = undefined;
          
          if (!userSnap.exists()) {
            // Only create new user document if user doesn't exist
            await setDoc(userRef, {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              emailVerified: firebaseUser.emailVerified,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              authProviders: providers,
              primaryAuthMethod: providers[0],
              isActive: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
              role: "applicant", // default role
            });
            role = "applicant";
            setPendingSync(true); // New user needs backend sync
          } else {
            const data = userSnap.data();
            role = data.role;
            
            // Only update lastLoginAt for fresh logins, not session restorations
            if (!isSessionRestoration) {
              await updateDoc(userRef, {
                lastLoginAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          
          // Only sync with backend if:
          // 1. It's a new user (pendingSync = true), OR
          // 2. It's not a session restoration (fresh login), OR
          // 3. User doesn't exist in Firestore (new user)
          if (pendingSync || !isSessionRestoration || !userSnap.exists()) {
            console.log('🔥 SYNC DEBUG - About to sync user with backend');
            const syncSuccess = await syncUserWithBackend(firebaseUser, role);
            if (syncSuccess) {
              setPendingSync(false);
              console.log('🔥 SYNC DEBUG - User synced successfully, should check welcome screen');
            }
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
          
          // CRITICAL: For new users, ensure they go through auth page for welcome screen
          if (pendingSync || !userSnap.exists()) {
            console.log('🔥 NEW USER DETECTED - Should redirect to auth page for welcome screen');
            // Set a flag that can be checked by components to show welcome screen
            localStorage.setItem('localcooks_new_user', 'true');
          }
        } else {
          // No Firebase user, set to null
          setUser(null);
          setPendingSync(false);
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
  }, [isInitializing, pendingSync]);

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      // Pure Firebase authentication - modern, secure, stateless
      setPendingSync(true); // Force sync on fresh login
      await signInWithEmailAndPassword(auth, email, password);
    } catch (firebaseError: any) {
      console.error('Firebase authentication failed:', firebaseError.message);
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
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
    } catch (e: any) {
      setError(e.message);
      setPendingSync(false);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setError(null);
    setLoading(true);
    try {
      // Simple Firebase logout - clean and stateless
      setPendingSync(false);
      await signOut(auth);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      setPendingSync(true); // Force sync on Google sign in
      const provider = new GoogleAuthProvider();
      // Add prompt to ensure account selection
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      const result = await signInWithPopup(auth, provider);
      
      // CRITICAL: For new Google sign-ins, redirect to auth page to ensure welcome screen
      console.log('🔥 GOOGLE SIGN-IN COMPLETED - Checking if new user');
      if (result.user) {
        // Small delay to let the auth state change process
        setTimeout(() => {
          console.log('🔥 REDIRECTING TO AUTH PAGE for welcome screen check');
          window.location.href = '/auth';
        }, 1000);
      }
    } catch (e: any) {
      setError(e.message);
      setPendingSync(false);
    } finally {
      setLoading(false);
    }
  };

  const actionCodeSettings = {
    url: window.location.origin + "/auth", // Fixed to match correct auth route
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

  const authContextValue = {
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
  };

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useFirebaseAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useFirebaseAuth must be used within an AuthProvider");
  return context;
}