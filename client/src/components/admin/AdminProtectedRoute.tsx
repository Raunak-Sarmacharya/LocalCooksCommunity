import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { user, isLoading, logoutMutation } = useAuth();
  const [, navigate] = useLocation();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Handle non-admin user trying to access admin route
  useEffect(() => {
    if (!isLoading && !isRedirecting && (user && user.role !== 'admin')) {
      setIsRedirecting(true);
      console.log('Access denied: User is not an admin', user);

      // Log out the current user
      logoutMutation.mutate(undefined, {
        onSuccess: () => {
          // Clear localStorage
          localStorage.removeItem('userId');

          // Invalidate user query to refresh auth state
          queryClient.invalidateQueries({ queryKey: ['/api/user'] });

          // Navigate to admin login
          navigate("/admin/login");
        },
        onError: (error) => {
          console.error('Error logging out:', error);
          // Still redirect to admin login even if logout fails
          navigate("/admin/login");
        }
      });
    }
  }, [user, isLoading, navigate, logoutMutation, isRedirecting]);

  if (isLoading || isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If no user, redirect to admin login
  if (!user) {
    return <Redirect to="/admin/login" />;
  }

  // If user is admin, render children
  if (user.role === 'admin') {
    return <>{children}</>;
  }

  // This should not be reached due to the useEffect above,
  // but adding as a fallback
  return <Redirect to="/admin/login" />;
}
