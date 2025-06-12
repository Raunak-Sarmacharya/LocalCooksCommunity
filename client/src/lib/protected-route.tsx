import { useFirebaseAuth } from "@/hooks/use-auth";
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

  return <Route path={path} component={Component} />;
}