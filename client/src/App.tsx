import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";

import Home from "@/pages/Home";
import ApplicationForm from "@/pages/ApplicationForm";
import Success from "@/pages/Success";
import Admin from "@/pages/Admin";
import AdminLogin from "@/pages/AdminLogin";
import AuthPage from "@/pages/auth-page";
import ApplicantDashboard from "@/pages/ApplicantDashboard";
import DocumentVerification from "@/pages/DocumentVerification";
import Microlearning from "@/pages/Microlearning";
import NotFound from "@/pages/not-found";
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import { ProtectedRoute } from "@/lib/protected-route";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <ProtectedRoute path="/apply" component={ApplicationForm} />
      <Route path="/success" component={Success} />
      <Route path="/auth" component={AuthPage} />
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
