import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { queryClient } from "./lib/queryClient";
import { auth } from "./lib/firebase";

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
        <Route path="/reset-welcome">
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Reset Welcome Screen (Debug)</h2>
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
                    alert(JSON.stringify(result, null, 2));
                  } else {
                    alert('No Firebase user logged in');
                  }
                } catch (error) {
                  alert('Error: ' + error.message);
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
            <p>This will reset has_seen_welcome to false for the current user</p>
          </div>
        </Route>
        <Route path="/debug-welcome">
          <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            <h2>Welcome Screen Debug</h2>
            <button 
              onClick={async () => {
                try {
                  const firebaseUser = auth.currentUser;
                  if (!firebaseUser) {
                    alert('No Firebase user logged in');
                    return;
                  }
                  
                  console.log('🔍 DEBUG: Firebase user:', firebaseUser.uid);
                  const token = await firebaseUser.getIdToken();
                  
                  // Fetch user data
                  const response = await fetch('/api/user', {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  if (response.ok) {
                    const userData = await response.json();
                    console.log('🔍 DEBUG: User data:', userData);
                    
                    const debugInfo = {
                      'User ID': userData.id,
                      'Username': userData.username,
                      'is_verified': userData.is_verified,
                      'has_seen_welcome': userData.has_seen_welcome,
                      'is_verified type': typeof userData.is_verified,
                      'has_seen_welcome type': typeof userData.has_seen_welcome,
                      'Should show welcome': userData.is_verified && !userData.has_seen_welcome
                    };
                    
                    alert(JSON.stringify(debugInfo, null, 2));
                  } else {
                    const errorText = await response.text();
                    alert('Error fetching user: ' + errorText);
                  }
                } catch (error) {
                  alert('Error: ' + error.message);
                }
              }}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#28a745', 
                color: 'white', 
                border: 'none', 
                borderRadius: '5px',
                cursor: 'pointer',
                marginRight: '10px'
              }}
            >
              Check User Data
            </button>
            
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
                    alert('Reset result: ' + JSON.stringify(result, null, 2));
                  } else {
                    alert('No Firebase user logged in');
                  }
                } catch (error) {
                  alert('Error: ' + error.message);
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
              Reset Welcome Screen
            </button>
            
            <p>Use these buttons to debug the welcome screen logic</p>
          </div>
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
