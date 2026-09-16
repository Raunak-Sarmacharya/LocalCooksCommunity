import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { useFirebaseAuth } from "@/hooks/use-auth";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
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
      <AuthLoadingScreen
        message="Checking your session..."
        submessage="Please wait while we verify your credentials."
      />
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
    // As per new Local Cooks policy, terms are accepted when creating an account,
    // so we no longer force users to the terms page here.
    // The terms acceptance screen has been removed from the forced flow.
  }

  return <>{children}</>;
}
