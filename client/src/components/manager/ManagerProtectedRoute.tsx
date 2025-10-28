import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";

interface ManagerProtectedRouteProps {
  children: React.ReactNode;
}

export default function ManagerProtectedRoute({ children }: ManagerProtectedRouteProps) {
  const [, setLocation] = useLocation();
  
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
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const user = sessionUser;
  const loading = sessionLoading;
  const error = sessionError;
  
  const isManager = user?.role === 'manager';

  console.log('ManagerProtectedRoute - Session-only auth state:', {
    loading,
    hasSessionUser: !!sessionUser,
    finalUser: !!user,
    userRole: user?.role,
    isManager,
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
    return <Redirect to="/login" />;
  }

  if (!isManager) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

