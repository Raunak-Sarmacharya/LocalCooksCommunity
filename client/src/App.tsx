import { CustomAlertsProvider, useCustomAlerts } from "@/components/ui/custom-alerts";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { auth } from "./lib/firebase";
import { queryClient } from "./lib/queryClient";

// Immediate load components (small/critical)
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import { ProtectedRoute } from "@/lib/protected-route";
import AdminLogin from "@/pages/AdminLogin";
import AdminLoginTest from "@/pages/AdminLoginTest";
import AuthTest from "@/pages/AuthTest";
import EnhancedAuthPage from "@/pages/EnhancedAuthPage";
import ForgotPasswordPage from "@/pages/ForgotPassword";
import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";
import PasswordReset from "@/pages/PasswordReset";
import Privacy from "@/pages/Privacy";
import Success from "@/pages/Success";
import Terms from "@/pages/Terms";
import WelcomeScreen from "@/pages/welcome-screen";

// Lazy load larger components
const ApplicationForm = lazy(() => import("@/pages/ApplicationForm"));
const DeliveryPartnerApplicationForm = lazy(() => import("@/pages/DeliveryPartnerApplicationForm"));
const DriverAuthPage = lazy(() => import("@/pages/DriverAuthPage"));
const Admin = lazy(() => import("@/pages/Admin"));
const ApplicantDashboard = lazy(() => import("@/pages/ApplicantDashboard"));
const DocumentVerification = lazy(() => import("@/pages/DocumentVerification"));
const EmailAction = lazy(() => import("@/pages/EmailAction"));
const Microlearning = lazy(() => import("@/pages/Microlearning"));
const MicrolearningOverview = lazy(() => import("@/pages/MicrolearningOverview"));
const MicrolearningPlayer = lazy(() => import("@/pages/MicrolearningPlayer"));
const EmailVerificationTest = lazy(() => import("@/components/EmailVerificationTest"));
const UnsubscribePage = lazy(() => import("@/pages/UnsubscribePage"));
const RoleSelection = lazy(() => import("@/pages/RoleSelection"));

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
        <ProtectedRoute path="/delivery-partner-apply" component={DeliveryPartnerApplicationForm} />
        <Route path="/success" component={Success} />
        <Route path="/auth" component={EnhancedAuthPage} />
        <Route path="/driver-auth" component={DriverAuthPage} />
        <ProtectedRoute path="/role-selection" component={RoleSelection} />
        <Route path="/auth-test" component={AuthTest} />
        <Route path="/admin-test" component={AdminLoginTest} />
        <Route path="/email-action" component={EmailAction} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/password-reset" component={PasswordReset} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/unsubscribe" component={UnsubscribePage} />
        <Route path="/welcome-test">
          <WelcomeScreen onComplete={() => console.log('Welcome test completed')} />
        </Route>
        <Route path="/email-verification-test" component={EmailVerificationTest} />
        <Route path="/reset-welcome">
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Reset Welcome Screen (Debug)</h2>
            <ResetWelcomeButton />
            <p>This will reset has_seen_welcome to false for the current user</p>
          </div>
        </Route>
        <Route path="/debug-welcome">
          <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            <h2>Welcome Screen Debug Dashboard</h2>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <WelcomeStatusButton />
              <ResetWelcomeFlagButton />
              <button 
                onClick={() => {
                  window.location.href = '/auth';
                }}
                style={{ 
                  padding: '10px 20px', 
                  backgroundColor: '#007bff', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
              >
                Go to Auth Page
              </button>
            </div>
            
            <div style={{ 
              backgroundColor: '#f8f9fa', 
              padding: '15px', 
              borderRadius: '5px', 
              fontSize: '14px',
              lineHeight: '1.6'
            }}>
              <h3>How to test Welcome Screen:</h3>
              <ol>
                <li><strong>Check Status:</strong> Click "Check Welcome Status" to see current user state</li>
                <li><strong>Reset Flag:</strong> Click "Reset Welcome Flag" to set has_seen_welcome = false</li>
                <li><strong>Test Flow:</strong> Click "Go to Auth Page" - you should see the welcome screen</li>
                <li><strong>Verify Fix:</strong> Complete welcome screen, then check status again</li>
              </ol>
              
              <h4>Expected Values for New Users:</h4>
              <ul>
                <li>is_verified: true (for Google users)</li>
                <li>has_seen_welcome: false (initially)</li>
                <li>Should Show Welcome: YES ✅</li>
              </ul>
            </div>
          </div>
        </Route>
        <ProtectedRoute path="/dashboard" component={ApplicantDashboard} />
        <ProtectedRoute path="/document-verification" component={DocumentVerification} />
        <ProtectedRoute path="/microlearning/overview" component={MicrolearningOverview} />
        <ProtectedRoute path="/microlearning/player" component={MicrolearningPlayer} />
        <ProtectedRoute path="/microlearning" component={MicrolearningOverview} />
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

function ResetWelcomeButton() {
  const { showAlert } = useCustomAlerts();
  
  return (
    <button 
      onClick={async () => {
        try {
          const firebaseUser = auth.currentUser;
          if (firebaseUser) {
            const token = await firebaseUser.getIdToken();
            const response = await fetch('/api/debug/reset-welcome', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            const result = await response.json();
            showAlert({
              title: "Reset Complete",
              description: JSON.stringify(result, null, 2),
              type: "success"
            });
          } else {
            showAlert({
              title: "Authentication Error",
              description: "No Firebase user logged in",
              type: "error"
            });
          }
        } catch (error: any) {
          showAlert({
            title: "Error",
            description: error.message || 'Unknown error',
            type: "error"
          });
        }
      }}
      style={{ 
        padding: '10px 20px', 
        backgroundColor: '#007bff', 
        color: 'white', 
        border: 'none', 
        borderRadius: '5px',
        cursor: 'pointer'
      }}
    >
      Reset Welcome Screen
    </button>
  );
}

function WelcomeStatusButton() {
  const { showAlert } = useCustomAlerts();
  
  return (
    <button 
      onClick={async () => {
        try {
          const firebaseUser = auth.currentUser;
          if (!firebaseUser) {
            showAlert({
              title: "Authentication Error",
              description: "No Firebase user logged in",
              type: "error"
            });
            return;
          }
          
          const token = await firebaseUser.getIdToken();
          
          // Get comprehensive debug info
          const response = await fetch('/api/debug/welcome-status', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const debugData = await response.json();
            
            const display = {
              'Firebase UID': debugData.firebase_user.uid,
              'Database User ID': debugData.user_id,
              'Username': debugData.username,
              'Email': debugData.firebase_user.email,
              'Is Verified': debugData.is_verified,
              'Has Seen Welcome': debugData.has_seen_welcome,
              'Should Show Welcome': debugData.should_show_welcome_screen ? 'YES ✅' : 'NO ❌',
              'User Role': debugData.role,
              'Data Types': {
                'is_verified': debugData.is_verified_type,
                'has_seen_welcome': debugData.has_seen_welcome_type
              }
            };
            
            console.log('🔍 WELCOME DEBUG DATA:', debugData);
            showAlert({
              title: "Welcome Screen Debug Info",
              description: JSON.stringify(display, null, 2),
              type: "info"
            });
          } else {
            const errorText = await response.text();
            showAlert({
              title: "Error",
              description: 'Error fetching debug data: ' + errorText,
              type: "error"
            });
          }
        } catch (error: any) {
          showAlert({
            title: "Error",
            description: error.message || 'Unknown error',
            type: "error"
          });
        }
      }}
      style={{ 
        padding: '10px 20px', 
        backgroundColor: '#28a745', 
        color: 'white', 
        border: 'none', 
        borderRadius: '5px',
        cursor: 'pointer'
      }}
    >
      Check Welcome Status
    </button>
  );
}

function ResetWelcomeFlagButton() {
  const { showAlert } = useCustomAlerts();
  
  return (
    <button 
      onClick={async () => {
        try {
          const firebaseUser = auth.currentUser;
          if (firebaseUser) {
            const token = await firebaseUser.getIdToken();
            const response = await fetch('/api/user/reset-welcome', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            const result = await response.json();
            showAlert({
              title: "Reset Result",
              description: JSON.stringify(result, null, 2),
              type: "success"
            });
          } else {
            showAlert({
              title: "Authentication Error",
              description: "No Firebase user logged in",
              type: "error"
            });
          }
        } catch (error: any) {
          showAlert({
            title: "Error",
            description: error.message || 'Unknown error',
            type: "error"
          });
        }
      }}
      style={{ 
        padding: '10px 20px', 
        backgroundColor: '#dc3545', 
        color: 'white', 
        border: 'none', 
        borderRadius: '5px',
        cursor: 'pointer'
      }}
    >
      Reset Welcome Flag
    </button>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CustomAlertsProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </CustomAlertsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
