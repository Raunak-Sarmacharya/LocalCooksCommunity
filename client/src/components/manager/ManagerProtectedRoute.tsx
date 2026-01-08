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
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
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
    refetchOnWindowFocus: false, // Prevent refetch on focus to avoid loops
    refetchOnMount: false, // Prevent refetch on mount to avoid loops
  });

  // Firebase Auth only - no session fallback
  const user = firebaseUserData;
  const loading = firebaseLoading || firebaseProfileLoading;
  const error = firebaseProfileError;
  
  const isManager = user?.role === 'manager' || user?.isManager;

  console.log('ManagerProtectedRoute - Firebase auth state:', {
    loading,
    hasFirebaseUser: !!firebaseUser,
    hasFirebaseUserData: !!firebaseUserData,
    finalUser: !!user,
    userRole: user?.role,
    isManager,
    authMethod: user?.authMethod,
    error
  });

  // Show loading state while checking authentication
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

  // Show error state if authentication failed
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

  // Redirect to login if no user found (only after loading is complete)
  if (!user) {
    console.log('ManagerProtectedRoute - No user found, redirecting to login');
    return <Redirect to="/manager/login" />;
  }

  // Redirect if user is not a manager (only after loading is complete)
  if (!isManager) {
    console.log('ManagerProtectedRoute - User is not a manager, redirecting');
    return <Redirect to="/" />;
  }

  // Managers go to dashboard - ManagerOnboardingWizard will show if onboarding is needed
  // No password change redirect - managers use onboarding wizard for setup
  return <>{children}</>;
}

