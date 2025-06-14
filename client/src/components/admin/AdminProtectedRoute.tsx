import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const [, setLocation] = useLocation();
  
  // Admin uses ONLY session-based auth (NeonDB) - no Firebase needed
  const { data: sessionUser, isLoading: sessionLoading, error: sessionError } = useQuery({
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
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        console.log('AdminProtectedRoute - Session user data:', userData);
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        console.error('AdminProtectedRoute - Session auth error:', error);
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Admin uses ONLY session authentication
  const user = sessionUser;
  const loading = sessionLoading;
  const error = sessionError;
  
  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  // Debug logging
  console.log('AdminProtectedRoute - Session-only auth state:', {
    loading,
    hasSessionUser: !!sessionUser,
    finalUser: !!user,
    userRole: user?.role,
    isAdmin,
    error
  });

  // Show loading while checking session authentication
  if (loading) {
    console.log('AdminProtectedRoute - Loading session auth...', {
      sessionLoading,
      hasSessionUser: !!sessionUser
    });
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-gray-600">Checking admin session...</p>
          <p className="text-xs text-gray-400 mt-2">Verifying credentials...</p>
        </div>
      </div>
    );
  }

  // If there's an error, show it
  if (error) {
    console.log('AdminProtectedRoute - Auth error:', error);
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
    console.log('AdminProtectedRoute - No session user found, redirecting to admin login', {
      sessionUser,
      sessionLoading
    });
    return <Redirect to="/admin/login" />;
  }

  // Check if user has admin role
  if (!isAdmin) {
    console.log('AdminProtectedRoute - User is not an admin, redirecting to login. User role:', user.role);
    console.log('AdminProtectedRoute - Full user object:', user);
    return <Redirect to="/admin/login" />;
  }

  console.log('AdminProtectedRoute - Admin access granted for user:', {
    username: user.username || user.displayName || user.email,
    role: user.role,
    authMethod: 'session'
  });
  return <>{children}</>;
}