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
          
          // --- Ensure Neon DB is synced (only for fresh logins or new users) ---
          if (!isSessionRestoration || !userSnap.exists()) {
            try {
              await fetch("/api/firebase-sync-user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  role: role || "applicant"
                })
              });
            } catch (err) {
              console.error("Failed to sync Firebase user to Neon DB:", err);
            }
          }
          // --- End Neon DB sync ---
          
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
          // Check if user is logged in via NeonDB session when Firebase user is null
          const authMethod = localStorage.getItem('authMethod');
          const userId = localStorage.getItem('userId');
          
          if ((authMethod === 'neon-database' || authMethod === 'firebase-neon-hybrid') && userId) {
            try {
              // Try to get user info from session
              const response = await fetch('/api/user', {
                credentials: 'include'
              });
              
              if (response.ok) {
                const sessionUser = await response.json();
                console.log('Restored session user:', sessionUser);
                
                setUser({
                  uid: sessionUser.firebase_uid || `neon_${sessionUser.id}`,
                  email: sessionUser.email || null,
                  displayName: sessionUser.username,
                  photoURL: null,
                  emailVerified: true,
                  providers: ['neon-database'],
                  role: sessionUser.role,
                });
                return; // Exit early if session user found
              } else {
                // Session expired, clear localStorage
                localStorage.removeItem('authMethod');
                localStorage.removeItem('userId');
              }
            } catch (sessionError) {
              console.warn('Failed to restore session:', sessionError);
              localStorage.removeItem('authMethod');
              localStorage.removeItem('userId');
            }
          }
          
          setUser(null);
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
  }, [isInitializing]);

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      // Try Firebase authentication first
      await signInWithEmailAndPassword(auth, email, password);
    } catch (firebaseError: any) {
      console.log('Firebase authentication failed:', firebaseError.message);
      
      // If Firebase auth fails with invalid credentials, try hybrid login (NeonDB fallback)
      if (firebaseError.code === 'auth/invalid-credential' || 
          firebaseError.code === 'auth/user-not-found' ||
          firebaseError.code === 'auth/wrong-password') {
        
        console.log('Attempting fallback to NeonDB authentication...');
        
        try {
          const response = await fetch('/api/hybrid-login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email,
              password,
            }),
          });

                               if (response.ok) {
            const data = await response.json();
            console.log('✅ Hybrid login successful:', data.authMethod);
            console.log('Session info:', data.session);
            
            // Create a pseudo-Firebase user object for compatibility
            const neonUser = data.user;
            
            // Store session information for NeonDB users
            localStorage.setItem('authMethod', data.authMethod);
            // Use the session userId for consistency with backend
            localStorage.setItem('userId', data.session?.userId || neonUser.id?.toString() || '');
            
            setUser({
              uid: data.session?.userId || neonUser.firebase_uid || `neon_${neonUser.id}`,
              email: email,
              displayName: neonUser.username,
              photoURL: null,
              emailVerified: true, // Assume verified for NeonDB users
              providers: ['neon-database'],
              role: neonUser.role,
            });
            
            return; // Success, exit the function
          } else {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Database authentication failed');
          }
        } catch (neonError: any) {
          console.error('Hybrid login also failed:', neonError.message);
          setError(`Authentication failed: ${neonError.message}`);
          return;
        }
      } else {
        // For other Firebase errors (network, etc.), just show the Firebase error
        setError(firebaseError.message);
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const signup = async (email: string, password: string, displayName?: string) => {
    setError(null);
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setError(null);
    setLoading(true);
    try {
      // Check if user is logged in via NeonDB session
      const authMethod = localStorage.getItem('authMethod');
      
      if (authMethod === 'neon-database' || authMethod === 'firebase-neon-hybrid') {
        // Also call the session logout endpoint for NeonDB users
        try {
          await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
          });
        } catch (sessionError) {
          console.warn('Session logout failed:', sessionError);
        }
        
        // Clear localStorage
        localStorage.removeItem('authMethod');
        localStorage.removeItem('userId');
      }
      
      // Always try Firebase logout (it will silently fail if not signed in via Firebase)
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
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setError(e.message);
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
      const response = await fetch('/api/user', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return userData;
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