import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "./use-auth";

interface HybridAuthUser {
  id?: number;
  uid?: string;
  username?: string;
  email?: string;
  displayName?: string;
  role?: string;
  authMethod?: 'firebase' | 'session';
  emailVerified?: boolean;
}

interface HybridAuthResult {
  user: HybridAuthUser | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
}

// Hook to get session-based user from /api/user
function useSessionAuth() {
  return useQuery({
    queryKey: ["/api/user"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            console.log('Session auth: Not authenticated (401)');
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        console.log('Session auth successful:', userData);
        
        return {
          ...userData,
          authMethod: 'session' as const
        };
      } catch (error) {
        console.log('Session auth failed:', error);
        return null;
      }
    },
    retry: (failureCount, error) => {
      // Only retry on network errors, not 401s
      return failureCount < 2 && !error?.message?.includes('401');
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

export function useHybridAuth(): HybridAuthResult {
  const firebaseAuth = useFirebaseAuth();
  const sessionAuth = useSessionAuth();

  // Determine which auth method to use
  let user: HybridAuthUser | null = null;
  let loading = false;
  let error: string | null = null;
  let authMethod: 'firebase' | 'session' | null = null;

  // Check session auth first (for admin login)
  if (sessionAuth.data) {
    user = {
      id: sessionAuth.data.id,
      username: sessionAuth.data.username,
      email: sessionAuth.data.email,
      role: sessionAuth.data.role,
      authMethod: 'session'
    };
    authMethod = 'session';
    console.log('Using session auth:', user);
  }
  // Fallback to Firebase auth
  else if (firebaseAuth.user) {
    user = {
      uid: firebaseAuth.user.uid,
      email: firebaseAuth.user.email || undefined,
      displayName: firebaseAuth.user.displayName || undefined,
      role: firebaseAuth.user.role,
      emailVerified: firebaseAuth.user.emailVerified,
      authMethod: 'firebase'
    };
    authMethod = 'firebase';
    console.log('Using Firebase auth:', user);
  }

  // Determine loading state
  loading = sessionAuth.isLoading || firebaseAuth.loading;

  // Determine error state
  error = sessionAuth.error?.message || firebaseAuth.error;

  // Determine if user is admin
  const isAdmin = user?.role === 'admin';

  console.log('Hybrid auth result:', {
    hasUser: !!user,
    authMethod,
    userRole: user?.role,
    isAdmin,
    loading
  });

  return {
    user,
    loading,
    error,
    isAdmin
  };
} 