import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

interface ManagerProtectedRouteProps {
  children: React.ReactNode;
}

export default function ManagerProtectedRoute({ children }: ManagerProtectedRouteProps) {
  const [, setLocation] = useLocation();
  const { user: firebaseUser, loading: firebaseLoading } = useFirebaseAuth();
  
  // Try Firebase auth first
  const { data: firebaseUserData, isLoading: firebaseProfileLoading, error: firebaseProfileError } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null;
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'firebase'
        };
      } catch (error) {
        console.error('ManagerProtectedRoute - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Fallback to session auth if Firebase auth fails (backward compatibility)
  const { data: sessionUserData, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null;
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        console.error('ManagerProtectedRoute - Session auth error:', error);
        return null;
      }
    },
    enabled: !firebaseUser && !firebaseLoading, // Only try session if Firebase is not available
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Use Firebase user if available, otherwise fall back to session user
  const user = firebaseUserData || sessionUserData;
  const loading = firebaseLoading || (firebaseUser ? firebaseProfileLoading : sessionLoading);
  const error = firebaseProfileError || sessionError;
  
  const isManager = user?.role === 'manager' || user?.isManager;

  console.log('ManagerProtectedRoute - Hybrid auth state:', {
    loading,
    hasFirebaseUser: !!firebaseUser,
    hasFirebaseUserData: !!firebaseUserData,
    hasSessionUserData: !!sessionUserData,
    finalUser: !!user,
    userRole: user?.role,
    isManager,
    authMethod: user?.authMethod,
    error
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-gray-600">Checking manager session...</p>
          <p className="text-xs text-gray-400 mt-2">Verifying credentials...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Authentication Error: {String(error)}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/manager/login" />;
  }

  if (!isManager) {
    return <Redirect to="/" />;
  }

  // Force password change if manager hasn't changed their password yet
  // has_seen_welcome === false means they need to change password
  if ((user as any).has_seen_welcome === false) {
    return <Redirect to="/manager/change-password" />;
  }

  return <>{children}</>;
}

