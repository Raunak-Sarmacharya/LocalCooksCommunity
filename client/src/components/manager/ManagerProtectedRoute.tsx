import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import ManagerOnboardingWizard from "./ManagerOnboardingWizard";
import { requiresEmailVerification } from "@/lib/auth-verification";
import EmailVerificationGate from "@/components/auth/EmailVerificationGate";

interface ManagerProtectedRouteProps {
  children: React.ReactNode;
}

export default function ManagerProtectedRoute({ children }: ManagerProtectedRouteProps) {
  // Subscribe so loader re-renders once manager NS finishes lazy-loading
  // (mt() alone returns raw keys before the backend resource is ready).
  const { t } = useTranslation("manager");
  const [location] = useLocation();
  const { user: firebaseUser, loading: firebaseLoading, authPhase } = useFirebaseAuth();
  
  // Fetch user profile
  const { data: firebaseUserData, isLoading: firebaseProfileLoading, error: firebaseProfileError } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null;
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'firebase'
        };
      } catch (error) {
        logger.error('ManagerProtectedRoute - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false, // Prevent refetch on focus to avoid loops
    refetchOnMount: false, // Prevent refetch on mount to avoid loops
  });

  // ENTERPRISE FIX: Fetch manager locations to check if onboarding is needed BEFORE rendering dashboard
  // This prevents the "flash" of dashboard content before onboarding redirect
  const { data: managerLocations, isLoading: locationsLoading } = useQuery({
    queryKey: ["/api/manager/locations", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return [];
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return [];
        const response = await fetch("/api/manager/locations", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) return [];
        return response.json();
      } catch (error) {
        logger.error('ManagerProtectedRoute - Error fetching locations:', error);
        return [];
      }
    },
    // Only worth asking once the account can actually use the response: manager
    // routes are refused server-side while the email is unconfirmed, so fetching
    // earlier just burns a guaranteed 403.
    enabled:
      !!firebaseUser &&
      !!firebaseUserData &&
      !requiresEmailVerification(firebaseUser, firebaseUserData),
    staleTime: 30 * 1000,
  });

  // Firebase Auth only - no session fallback
  const user = firebaseUserData;
  // ENTERPRISE: Include authPhase in loading check to prevent premature redirects during auth flow
  // This ensures we don't redirect to login while Google sign-in popup is open or sync is in progress
  const isAuthInProgress = authPhase === 'authenticating' || authPhase === 'syncing';
  // Include locations loading in overall loading state to prevent flash
  const loading = firebaseLoading || firebaseProfileLoading || (!!firebaseUserData && locationsLoading) || isAuthInProgress;
  const error = firebaseProfileError;
  
  const isManager = user?.role === 'manager' || user?.isManager;

  logger.info('ManagerProtectedRoute - Firebase auth state:', {
    loading,
    authPhase,
    isAuthInProgress,
    hasFirebaseUser: !!firebaseUser,
    hasFirebaseUserData: !!firebaseUserData,
    finalUser: !!user,
    userRole: user?.role,
    isManager,
    authMethod: user?.authMethod,
    error
  });

  // Show loading state while checking authentication
  if (loading) {
    return (
      <AuthLoadingScreen
        message={t("checkingManagerSession")}
        submessage={t("verifyingCredentials")}
      />
    );
  }

  // Show error state if authentication failed
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Authentication Error: {String(error)}</p>
          <Button 
            onClick={() => window.location.reload()}
          >{mt("retry")}</Button>
        </div>
      </div>
    );
  }

  // Redirect to login if no user found (only after loading is complete)
  if (!user) {
    logger.info('ManagerProtectedRoute - No user found, redirecting to login');
    return <Redirect to="/manager/login" />;
  }

  // Redirect if user is not a manager (only after loading is complete)
  if (!isManager) {
    logger.info('ManagerProtectedRoute - User is not a manager, redirecting');
    return <Redirect to="/" />;
  }

  // An unverified email is no longer a redirect. Sending the manager back to the
  // login screen left them with no route to the profile page that can fix it, so
  // the session is kept and the gate is rendered over the dashboard instead.
  const emailUnverified = requiresEmailVerification(firebaseUser, user);

  // Terms acceptance gate
  // ENTERPRISE FIX: Cross-check with auth context user as well.
  // After terms acceptance, refreshUserData() updates the auth context user synchronously
  // before navigation, but the useQuery cache might still hold stale data.
  // If EITHER source says terms are accepted with the correct version, don't redirect.
  const queryTermsAccepted = user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION;
  const authContextTermsAccepted = firebaseUser?.termsAccepted && 
    firebaseUser?.termsVersion === CURRENT_POLICY_VERSION;
  const needsAcceptance = !queryTermsAccepted && !authContextTermsAccepted;

  // Verification comes first: it is the harder block, and bouncing to terms would
  // hide the one screen that tells the manager why nothing works.
  if (needsAcceptance && !emailUnverified && location !== '/accept-terms') {
    logger.info('ManagerProtectedRoute - Terms not accepted, redirecting to /accept-terms');
    const redirectParam = encodeURIComponent(location);
    return <Redirect to={`/accept-terms?redirect=${redirectParam}`} />;
  }

  // ENTERPRISE FIX: Check if onboarding is needed BEFORE rendering dashboard
  // This prevents the "flash" of dashboard content before onboarding appears
  // Only redirect if:
  // 1. Onboarding is not completed
  // 2. No locations exist
  // 3. Manager has NOT started onboarding (no steps tracked yet)
  // 4. We're not already on the setup page (avoid redirect loop)
  //
  // NOTE: If manager has started onboarding (has any step in managerOnboardingStepsCompleted),
  // they clicked "Save & Exit" and should be allowed to go to dashboard.
  // The OnboardingStatusBanner will prompt them to complete setup.
  const hasStartedOnboarding = user?.managerOnboardingStepsCompleted && 
                                typeof user.managerOnboardingStepsCompleted === 'object' &&
                                Object.keys(user.managerOnboardingStepsCompleted).length > 0;
  // `!emailUnverified` matters: every onboarding save is refused server-side while the
  // email is unconfirmed, so funneling an unverified manager into setup walks them into
  // a flow that cannot complete — and hides the dashboard, the sidebar and the
  // "Getting started" checklist behind a full-screen wizard. Show the gate first; the
  // redirect happens on the next navigation once the address is confirmed.
  const needsOnboarding = !emailUnverified &&
                          !user?.managerOnboardingCompleted && 
                          !hasStartedOnboarding &&
                          Array.isArray(managerLocations) && 
                          managerLocations.length === 0;
  const isOnSetupPage = location === '/manager/setup' || location.startsWith('/manager/setup');
  
  if (needsOnboarding && !isOnSetupPage) {
    logger.info('ManagerProtectedRoute - New manager needs onboarding, redirecting to setup');
    return <Redirect to="/manager/setup" />;
  }

  // Managers go to dashboard - ManagerOnboardingWizard wraps for context
  return (
    <>
      <EmailVerificationGate open={emailUnverified} role="manager" />
      <ManagerOnboardingWizard>
        {children}
      </ManagerOnboardingWizard>
    </>
  );
}
