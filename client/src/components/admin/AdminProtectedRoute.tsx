import { useHybridAuth } from "@/hooks/use-hybrid-auth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { user, loading, error, isAdmin } = useHybridAuth();
  const [, setLocation] = useLocation();

  // Debug logging
  console.log('AdminProtectedRoute - Hybrid auth state:', {
    loading,
    hasUser: !!user,
    userRole: user?.role,
    authMethod: user?.authMethod,
    isAdmin,
    error
  });

  // Show loading for a bit longer to ensure auth is properly checked
  if (loading) {
    console.log('AdminProtectedRoute - Still loading user data...');
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-gray-600">Checking authentication...</p>
          <p className="text-xs text-gray-400 mt-2">Please wait...</p>
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
          <p className="text-red-600 mb-4">Authentication Error: {error}</p>
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
    console.log('AdminProtectedRoute - No user found, redirecting to admin login');
    return <Redirect to="/admin/login" />;
  }

  // Check if user has admin role
  if (!isAdmin) {
    console.log('AdminProtectedRoute - User is not an admin, redirecting to login. User role:', user.role);
    console.log('AdminProtectedRoute - Full user object:', user);
    return <Redirect to="/admin/login" />;
  }

  console.log('AdminProtectedRoute - Admin access granted for user:', user.username || user.displayName, `(${user.authMethod})`);
  return <>{children}</>;
}