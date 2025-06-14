import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { queryClient } from "./lib/queryClient";

// Immediate load components (small/critical)
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import { ProtectedRoute } from "@/lib/protected-route";
import AdminLogin from "@/pages/AdminLogin";
import AdminLoginTest from "@/pages/AdminLoginTest";
import AuthTest from "@/pages/AuthTest";
import EnhancedAuthPage from "@/pages/EnhancedAuthPage";
import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";
import Success from "@/pages/Success";
import WelcomeScreen from "@/pages/welcome-screen";

// Lazy load larger components
const ApplicationForm = lazy(() => import("@/pages/ApplicationForm"));
const Admin = lazy(() => import("@/pages/Admin"));
const ApplicantDashboard = lazy(() => import("@/pages/ApplicantDashboard"));
const DocumentVerification = lazy(() => import("@/pages/DocumentVerification"));
const Microlearning = lazy(() => import("@/pages/Microlearning"));

// Loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    <span className="ml-2">Loading...</span>
  </div>
);

function Router() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Switch>
        <Route path="/" component={Home} />
        <ProtectedRoute path="/apply" component={ApplicationForm} />
        <Route path="/success" component={Success} />
        <Route path="/auth" component={EnhancedAuthPage} />
        <Route path="/auth-test" component={AuthTest} />
        <Route path="/admin-test" component={AdminLoginTest} />
        <Route path="/welcome-test">
          <WelcomeScreen onComplete={() => console.log('Welcome test completed')} />
        </Route>
        <ProtectedRoute path="/dashboard" component={ApplicantDashboard} />
        <ProtectedRoute path="/document-verification" component={DocumentVerification} />
        <ProtectedRoute path="/microlearning" component={Microlearning} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin">
          <AdminProtectedRoute>
            <Admin />
          </AdminProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
