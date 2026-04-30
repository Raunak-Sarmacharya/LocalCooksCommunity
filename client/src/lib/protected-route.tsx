import { useFirebaseAuth } from "@/hooks/use-auth";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
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
    return (
      <Route path={path}>
        <Redirect to={`/auth?redirect=${path}`} />
      </Route>
    );
  }

  // Terms acceptance gate
  const needsAcceptance =
    !user.termsAccepted ||
    !user.termsVersion ||
    user.termsVersion !== CURRENT_POLICY_VERSION;

  if (needsAcceptance) {
    return (
      <Route path={path}>
        <Redirect to={`/accept-terms?redirect=${path}`} />
      </Route>
    );
  }

  return <Route path={path} component={Component} />;
}