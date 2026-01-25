import { CustomAlertsProvider, useCustomAlerts } from "@/components/ui/custom-alerts";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { auth } from "./lib/firebase";
import { queryClient } from "./lib/queryClient";
import { useSubdomain } from "@/hooks/use-subdomain";
import { getSubdomainFromHostname, isRouteAccessibleFromSubdomain, type SubdomainType } from "@shared/subdomain-utils";

// Immediate load components (small/critical)
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import ManagerProtectedRoute from "@/components/manager/ManagerProtectedRoute";
import { ProtectedRoute } from "@/lib/protected-route";
import AdminLogin from "@/pages/AdminLogin";
import AdminRegister from "@/pages/AdminRegister";
import AdminLoginTest from "@/pages/AdminLoginTest";
import ManagerLogin from "@/pages/ManagerLogin";
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
import ChefLanding from "@/pages/ChefLanding";
import KitchenLanding from "@/pages/KitchenLanding";
import AdminLanding from "@/pages/AdminLanding";

// Lazy load larger components
const ApplicationForm = lazy(() => import("@/pages/ApplicationForm"));
const Admin = lazy(() => import("@/pages/Admin"));
const ApplicantDashboard = lazy(() => import("@/pages/ApplicantDashboard"));
const DocumentVerification = lazy(() => import("@/pages/DocumentVerification"));
const EmailAction = lazy(() => import("@/pages/EmailAction"));
const Microlearning = lazy(() => import("@/pages/Microlearning"));
const MicrolearningOverview = lazy(() => import("@/pages/MicrolearningOverview"));
const MicrolearningPlayer = lazy(() => import("@/pages/MicrolearningPlayer"));
const EmailVerificationTest = lazy(() => import("@/components/EmailVerificationTest"));
const UnsubscribePage = lazy(() => import("@/pages/UnsubscribePage"));

// Kitchen Booking System components
const ManagerChangePassword = lazy(() => import("@/pages/ManagerChangePassword"));
const ManagerProfile = lazy(() => import("@/pages/ManagerProfile"));
const KitchenAvailabilityManagement = lazy(() => import("@/pages/KitchenAvailabilityManagement"));
const ManagerBookingsPanel = lazy(() => import("@/pages/ManagerBookingsPanel"));
const ManagerBookingDashboard = lazy(() => import("@/pages/ManagerBookingDashboard"));
const KitchenBookingCalendar = lazy(() => import("@/pages/KitchenBookingCalendar"));
const BookingConfirmationPage = lazy(() => import("@/pages/BookingConfirmationPage"));
const PaymentSuccessPage = lazy(() => import("@/pages/PaymentSuccessPage"));
const ShareProfile = lazy(() => import("@/pages/ShareProfile"));
const ApplyToKitchen = lazy(() => import("@/pages/ApplyToKitchen"));

const AdminManageLocations = lazy(() => import("@/pages/AdminManageLocations"));
const ManagerLanding = lazy(() => import("@/pages/ManagerLanding"));
const ManagerKitchenApplications = lazy(() => import("@/pages/ManagerKitchenApplications"));
const ManagerSetupPage = lazy(() => import("@/pages/ManagerSetupPage")); // [NEW]
const ChefSetupPage = lazy(() => import("@/pages/ChefSetupPage"));
const KitchenPreviewPage = lazy(() => import("@/pages/KitchenPreviewPage"));
const KitchenComparisonPage = lazy(() => import("@/pages/KitchenComparisonPage"));
const KitchenRequirementsPage = lazy(() => import("@/pages/KitchenRequirementsPage"));


// Loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    <span className="ml-2">Loading...</span>
  </div>
);



// Subdomain-aware route wrapper
function SubdomainRoute({ path, component, subdomain, children, ...props }: {
  path: string;
  component?: React.ComponentType<any>;
  subdomain: SubdomainType;
  children?: React.ReactNode;
  [key: string]: any;
}) {
  const [location] = useLocation();
  const currentSubdomain = useSubdomain();

  useEffect(() => {
    // Don't redirect if on main domain - let it handle its own routes
    if (!currentSubdomain || currentSubdomain === 'main') return;

    // Redirect if route is not accessible from current subdomain
    if (!isRouteAccessibleFromSubdomain(currentSubdomain, path)) {
      // Determine correct subdomain for this route
      let targetSubdomain: SubdomainType = null;
      if (path.startsWith('/admin')) {
        targetSubdomain = 'admin';
      } else if (path.startsWith('/apply') || path.startsWith('/dashboard') || path.startsWith('/book-kitchen') || path.startsWith('/kitchen-requirements')) {
        targetSubdomain = 'chef';
      } else if (path.startsWith('/manager')) {
        targetSubdomain = 'kitchen';
      }

      if (targetSubdomain && targetSubdomain !== currentSubdomain) {
        const baseDomain = 'localcooks.ca';
        const targetUrl = `https://${targetSubdomain}.${baseDomain}${path}`;
        window.location.href = targetUrl;
      }
    }
  }, [currentSubdomain, path]);

  // Allow routes on main domain - don't block them
  if (currentSubdomain === 'main' || !currentSubdomain) {
    if (children) {
      return <Route path={path} {...props}>{children}</Route>;
    }
    if (component) {
      return <Route path={path} component={component} {...props} />;
    }
  }

  // Only render if accessible from current subdomain (for non-main domains)
  if (currentSubdomain && !isRouteAccessibleFromSubdomain(currentSubdomain, path)) {
    return null;
  }

  if (children) {
    return <Route path={path} {...props}>{children}</Route>;
  }

  if (component) {
    return <Route path={path} component={component} {...props} />;
  }

  return null;
}

function Router() {
  const subdomain = useSubdomain();
  const [location, setLocation] = useLocation();

  // Handle backward compatibility redirects on client side
  // NOTE: Don't redirect if on main domain (localcooks.ca) - it's a completely separate project
  useEffect(() => {
    // Never redirect from localcooks.ca - it's a separate independent project
    if (!subdomain || subdomain === 'main') return; // Skip in development or on main domain

    const path = location;

    // Only redirect if we're on a subdomain that's not the correct one
    // Main domain (subdomain === 'main') should never redirect

    // At this point, subdomain is guaranteed to be one of: 'chef' | 'kitchen' | 'admin'
    // (not 'main' or null due to early return above)

    // Redirect admin routes to admin subdomain
    if ((path.startsWith('/admin') || path.startsWith('/admin/')) && subdomain !== 'admin') {
      window.location.href = `https://admin.localcooks.ca${path}`;
      return;
    }

    // Redirect chef routes to chef subdomain
    if ((path.startsWith('/apply') || path.startsWith('/dashboard') ||
      path.startsWith('/book-kitchen') || path.startsWith('/share-profile') || path.startsWith('/kitchen-requirements')) &&
      subdomain !== 'chef') {
      window.location.href = `https://chef.localcooks.ca${path}`;
      return;
    }

    // Redirect manager routes to kitchen subdomain
    if (path.startsWith('/manager') &&
      subdomain !== 'kitchen' && subdomain !== 'admin') {
      window.location.href = `https://kitchen.localcooks.ca${path}`;
      return;
    }
  }, [subdomain, location]);

  // Determine which landing page to show based on subdomain
  const getLandingPage = () => {
    if (subdomain === 'chef') {
      return ChefLanding;
    } else if (subdomain === 'kitchen') {
      return KitchenLanding;
    } else if (subdomain === 'admin') {
      return AdminLanding;
    } else if (subdomain === 'main') {
      return Home;
    }
    // Invalid/Unknown subdomain -> 404
    return NotFound;
  };

  const LandingPage = getLandingPage();

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <SubdomainRoute path="/apply" component={ApplicationForm} subdomain={subdomain} />
        <Route path="/success" component={Success} />
        <Route path="/auth" component={EnhancedAuthPage} />

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
        <SubdomainRoute path="/dashboard" component={ApplicantDashboard} subdomain={subdomain} />
        <SubdomainRoute path="/chef-setup" component={ChefSetupPage} subdomain={subdomain} />
        <ProtectedRoute path="/document-verification" component={DocumentVerification} />
        <ProtectedRoute path="/microlearning/overview" component={MicrolearningOverview} />
        <ProtectedRoute path="/microlearning/player" component={MicrolearningPlayer} />
        <ProtectedRoute path="/microlearning" component={MicrolearningOverview} />

        {/* Kitchen Booking Routes */}
        <SubdomainRoute path="/book-kitchen" component={KitchenBookingCalendar} subdomain={subdomain} />
        <SubdomainRoute path="/book-kitchen/confirm" component={BookingConfirmationPage} subdomain={subdomain} />
        <SubdomainRoute path="/payment-success" component={PaymentSuccessPage} subdomain={subdomain} />
        <ProtectedRoute path="/share-profile" component={ShareProfile} />

        {/* Kitchen Application Routes (New - Replaces Share Profile) */}

        <SubdomainRoute path="/apply-kitchen/:locationId" component={ApplyToKitchen} subdomain={subdomain} />
        <SubdomainRoute path="/compare-kitchens" component={KitchenComparisonPage} subdomain={subdomain} />
        <SubdomainRoute path="/kitchen-requirements/:locationId" component={KitchenRequirementsPage} subdomain={subdomain} />

        <SubdomainRoute path="/admin/login" component={AdminLogin} subdomain={subdomain} />
        <SubdomainRoute path="/admin-register" component={AdminRegister} subdomain={subdomain} />
        <SubdomainRoute path="/admin/register" component={AdminRegister} subdomain={subdomain} />
        <Route path="/admin">
          {subdomain === 'admin' || !subdomain ? (
            <AdminProtectedRoute>
              <Admin />
            </AdminProtectedRoute>
          ) : null}
        </Route>
        <Route path="/admin/manage-locations">
          {subdomain === 'admin' || !subdomain ? (
            <AdminProtectedRoute>
              <AdminManageLocations />
            </AdminProtectedRoute>
          ) : null}
        </Route>

        {/* Manager Routes */}
        <Route path="/manager" component={ManagerLanding} />
        <Route path="/manager/login" component={ManagerLogin} />
        <Route path="/manager/change-password" component={ManagerChangePassword} />
        <Route path="/manager/profile">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerProfile />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/dashboard">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerBookingDashboard />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/setup"> {/* [NEW] Full-screen onboarding */}
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              {/* Reset layout to full screen without header/sidebar from dashboard */}
              <ManagerSetupPage />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/availability">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <KitchenAvailabilityManagement />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/bookings">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerBookingsPanel />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/booking-dashboard">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerBookingDashboard />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/applications">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerKitchenApplications />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/stripe-connect/return">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerBookingDashboard />
            </ManagerProtectedRoute>
          ) : null}
        </Route>
        <Route path="/manager/stripe-connect/refresh">
          {(subdomain === 'kitchen' || subdomain === 'admin' || !subdomain) ? (
            <ManagerProtectedRoute>
              <ManagerBookingDashboard />
            </ManagerProtectedRoute>
          ) : null}
        </Route>

        {/* Kitchen Preview Page - Public, no auth required */}
        <Route path="/kitchen-preview/:locationId" component={KitchenPreviewPage} />

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
            <SonnerToaster />
            <Router />
          </TooltipProvider>
        </CustomAlertsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
