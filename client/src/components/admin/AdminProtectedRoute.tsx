import { logger } from "@/lib/logger";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const [, setLocation] = useLocation();
  
  // Admin uses Firebase auth (session auth removed)
  const { user: firebaseUser, loading: firebaseLoading } = useFirebaseAuth();
  
  const { data: user, isLoading: profileLoading, error: profileError } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        logger.info('AdminProtectedRoute - Firebase user data:', userData);
        return userData;
      } catch (error) {
        logger.error('AdminProtectedRoute - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const loading = firebaseLoading || profileLoading;
  const error = profileError;
  
  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  // Debug logging
  logger.info('AdminProtectedRoute - Firebase auth state:', {
    loading,
    hasFirebaseUser: !!firebaseUser,
    hasProfileUser: !!user,
    finalUser: !!user,
    userRole: user?.role,
    isAdmin,
    error
  });

  // Show loading while checking Firebase authentication
  if (loading) {
    logger.info('AdminProtectedRoute - Loading Firebase auth...', {
      firebaseLoading,
      hasFirebaseUser: !!firebaseUser,
      profileLoading
    });
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-gray-600">Checking admin authentication...</p>
          <p className="text-xs text-gray-400 mt-2">Verifying credentials...</p>
        </div>
      </div>
    );
  }

  // If there's an error, show it
  if (error) {
    logger.info('AdminProtectedRoute - Auth error:', error);
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
    logger.info('AdminProtectedRoute - No Firebase user found, redirecting to admin login', {
      firebaseUser,
      firebaseLoading
    });
    return <Redirect to="/admin/login" />;
  }

  // Check if user has admin role
  if (!isAdmin) {
    logger.info('AdminProtectedRoute - User is not an admin, redirecting to login. User role:', user.role);
    logger.info('AdminProtectedRoute - Full user object:', user);
    return <Redirect to="/admin/login" />;
  }

  logger.info('AdminProtectedRoute - Admin access granted for user:', {
    username: user.username || user.displayName || user.email,
    role: user.role,
    authMethod: 'firebase'
  });
  return <>{children}</>;
}