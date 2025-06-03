import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { user, isLoading, error } = useAuth();
  const [, setLocation] = useLocation();

  // Debug logging
  console.log('AdminProtectedRoute - Auth state:', {
    isLoading,
    hasUser: !!user,
    userRole: user?.role,
    isAdmin: user?.role === 'admin'
  });

  if (isLoading) {
    console.log('AdminProtectedRoute - Still loading user data...');
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    console.log('AdminProtectedRoute - No user found, redirecting to admin login');
    return <Redirect to="/admin/login" />;
  }

  // Check if user has admin role
  if (user.role !== 'admin') {
    console.log('AdminProtectedRoute - User is not an admin, redirecting to login. User role:', user.role);
    console.log('AdminProtectedRoute - Full user object:', user);
    return <Redirect to="/admin/login" />;
  }

  console.log('AdminProtectedRoute - Admin access granted for user:', user.username);
  return <>{children}</>;
}