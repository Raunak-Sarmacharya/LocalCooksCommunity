import { useFirebaseAuth } from "@/hooks/use-auth";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { requiresEmailVerification } from "@/lib/auth-verification";
import EmailVerificationGate from "@/components/auth/EmailVerificationGate";
import { Loader2 } from "lucide-react";
import React from "react";
import { Redirect, Route } from "wouter";

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType<any>;
}

export function ProtectedRoute({ path, component: Component }: ProtectedRouteProps) {
  const { user, loading } = useFirebaseAuth();

  if (loading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    const redirect = encodeURIComponent(
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : path
    );
    return (
      <Route path={path}>
        <Redirect to={`/auth?redirect=${redirect}`} replace />
      </Route>
    );
  }

  // An unverified email no longer bounces the user back to /auth: that would
  // strand them in a login loop with no way to reach the one page that can fix
  // it. The session is kept and the gate is shown over the real UI instead.
  const emailUnverified = requiresEmailVerification(user, user);

  // Terms acceptance gate
  const needsAcceptance =
    !user.termsAccepted ||
    !user.termsVersion ||
    user.termsVersion !== CURRENT_POLICY_VERSION;

  if (needsAcceptance && !emailUnverified) {
    return (
      <Route path={path}>
        <Redirect to={`/accept-terms?redirect=${path}`} replace />
      </Route>
    );
  }

  return (
    <Route path={path}>
      <EmailVerificationGate open={emailUnverified} role={user.role} />
      <Component />
    </Route>
  );
}
