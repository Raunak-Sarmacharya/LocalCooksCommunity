import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import React from "react";
import { Redirect, Route } from "wouter";

/**
 * Route guard that enforces Terms & Privacy Policy acceptance.
 * If the user is authenticated but has NOT accepted the current policy version,
 * they are redirected to /accept-terms with a redirect parameter.
 *
 * This wraps ProtectedRoute, ManagerProtectedRoute, and AdminProtectedRoute
 * after their role checks but before rendering the protected content.
 */
export function TermsProtectedRoute({
  children,
  currentPath,
}: {
  children: React.ReactNode;
  currentPath: string;
}) {
  const { user, loading } = useFirebaseAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  if (!user) {
    return <>{children}</>;
  }

  const needsAcceptance =
    !user.termsAccepted ||
    !user.termsVersion ||
    user.termsVersion !== CURRENT_POLICY_VERSION;

  if (needsAcceptance && currentPath !== "/accept-terms") {
    const redirectParam = encodeURIComponent(currentPath);
    return <Redirect to={`/accept-terms?redirect=${redirectParam}`} />;
  }

  return <>{children}</>;
}
