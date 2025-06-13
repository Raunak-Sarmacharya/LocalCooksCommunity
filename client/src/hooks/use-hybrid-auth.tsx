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
        console.log('Session auth: Making request to /api/user...');
        console.log('Session auth: Document cookie:', document.cookie);
        
        const response = await fetch("/api/user", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        console.log('Session auth: Response status:', response.status);
        console.log('Session auth: Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          if (response.status === 401) {
            console.log('Session auth: Not authenticated (401)');
            const errorText = await response.text();
            console.log('Session auth: Error response:', errorText);
            return null; // Not authenticated via session
          }
          const errorText = await response.text();
          console.error('Session auth: Failed with status', response.status, ':', errorText);
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        console.log('Session auth successful:', userData);
        
        return {
          ...userData,
          authMethod: 'session' as const
        };
      } catch (error) {
        console.error('Session auth failed:', error);
        return null;
      }
    },
    retry: (failureCount, error) => {
      // Only retry on network errors, not 401s
      return failureCount < 2 && !error?.message?.includes('401');
    },
    staleTime: 30 * 1000, // 30 seconds for debugging
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