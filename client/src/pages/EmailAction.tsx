/**
 * EmailAction.tsx - Enterprise-Grade Email Action Handler
 * 
 * This component handles Firebase email actions (verification, password reset)
 * and provides role-based subdomain routing for multi-tenant architecture.
 * 
 * ARCHITECTURE:
 * - Managers → kitchen.localcooks.ca
 * - Chefs → chef.localcooks.ca
 * - Admins → admin.localcooks.ca
 * 
 * Firebase sends users to this page with query params:
 * - mode: 'verifyEmail' | 'resetPassword' | 'recoverEmail'
 * - oobCode: One-time action code
 * - continueUrl: Role-based redirect URL (set during registration)
 * - lang: Locale (optional)
 */

import { applyActionCode } from "firebase/auth";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, XCircle, ArrowRight } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useFirebaseAuth } from "../hooks/use-auth";
import { auth } from "../lib/firebase";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

type ActionStatus = 'loading' | 'success' | 'error';
type ActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail';

/**
 * Production subdomain configuration for role-based routing
 * This is the single source of truth for domain redirects
 */
const PRODUCTION_SUBDOMAINS = {
  manager: 'https://kitchen.localcooks.ca',
  chef: 'https://chef.localcooks.ca',
  admin: 'https://admin.localcooks.ca',
} as const;

/**
 * Default redirect paths for each role after email verification
 */
const DEFAULT_REDIRECT_PATHS = {
  manager: '/manager/login?verified=true',
  chef: '/auth?verified=true',
  admin: '/admin/login?verified=true',
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Determines the user role from a continueUrl
 * Parses the URL to identify which subdomain/path pattern matches
 */
function detectRoleFromContinueUrl(continueUrl: string): 'manager' | 'chef' | 'admin' | null {
  try {
    const url = new URL(continueUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    // Check subdomain patterns
    if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) {
      // Kitchen subdomain - check path for manager vs chef
      if (pathname.includes('/manager')) {
        return 'manager';
      }
      // Default kitchen to chef if no manager path
      return 'chef';
    }

    if (hostname.includes('chef') || hostname.startsWith('chef.')) {
      return 'chef';
    }

    if (hostname.includes('admin') || hostname.startsWith('admin.')) {
      return 'admin';
    }

    // Check path patterns as fallback
    if (pathname.includes('/manager')) return 'manager';
    if (pathname.includes('/admin')) return 'admin';
    if (pathname.includes('/auth') || pathname.includes('/chef')) return 'chef';

    return null;
  } catch (error) {
    console.error('❌ Failed to parse continueUrl:', error);
    return null;
  }
}

/**
 * Determines the user role from the current hostname
 * Used as fallback when continueUrl is not available
 */
function detectRoleFromCurrentHostname(): 'manager' | 'chef' | 'admin' | null {
  const hostname = window.location.hostname.toLowerCase();

  if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) {
    return 'manager'; // Kitchen subdomain defaults to manager
  }

  if (hostname.includes('chef') || hostname.startsWith('chef.')) {
    return 'chef';
  }

  if (hostname.includes('admin') || hostname.startsWith('admin.')) {
    return 'admin';
  }

  // Localhost development - check path
  const pathname = window.location.pathname.toLowerCase();
  if (pathname.includes('/manager')) return 'manager';
  if (pathname.includes('/admin')) return 'admin';

  return 'chef'; // Default fallback
}

/**
 * Builds the final redirect URL based on role and continueUrl
 * If continueUrl is valid and from a trusted domain, use it directly
 * Otherwise, construct a URL based on detected role
 */
function buildRedirectUrl(continueUrl: string | null): string {
  // Trusted domains for security validation
  const TRUSTED_DOMAINS = [
    'localcooks.ca',
    'kitchen.localcooks.ca',
    'chef.localcooks.ca',
    'admin.localcooks.ca',
    'localhost',
  ];

  // If we have a valid continueUrl from a trusted domain, use it
  if (continueUrl) {
    try {
      const url = new URL(decodeURIComponent(continueUrl));
      const isTrusted = TRUSTED_DOMAINS.some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );

      if (isTrusted) {
        console.log('✅ Using trusted continueUrl:', continueUrl);
        return decodeURIComponent(continueUrl);
      } else {
        console.warn('⚠️ ContinueUrl not from trusted domain, ignoring:', url.hostname);
      }
    } catch (error) {
      console.error('❌ Failed to parse continueUrl:', error);
    }
  }

  // Fallback: Build URL based on detected role
  const role = continueUrl
    ? detectRoleFromContinueUrl(continueUrl)
    : detectRoleFromCurrentHostname();

  console.log('🔍 Detected role for redirect:', role);

  // For localhost, use relative paths
  const isLocalhost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');

  if (isLocalhost) {
    const defaultPath = role ? DEFAULT_REDIRECT_PATHS[role] : '/auth?verified=true';
    console.log('📍 Using localhost redirect path:', defaultPath);
    return defaultPath;
  }

  // Production: Build full URL with subdomain
  const subdomain = role ? PRODUCTION_SUBDOMAINS[role] : PRODUCTION_SUBDOMAINS.chef;
  const path = role ? DEFAULT_REDIRECT_PATHS[role] : DEFAULT_REDIRECT_PATHS.chef;
  const fullUrl = `${subdomain}${path}`;

  console.log('🌐 Using production redirect URL:', fullUrl);
  return fullUrl;
}

/**
 * Safely redirects to a URL, using window.location.href for cross-origin
 */
function performRedirect(url: string, setLocation: (path: string) => void): void {
  const isRelative = url.startsWith('/');
  const isSameOrigin = url.startsWith(window.location.origin);

  if (isRelative) {
    // Use wouter for same-origin relative paths (SPA navigation)
    console.log('🔄 SPA navigation to:', url);
    setLocation(url);
  } else if (isSameOrigin) {
    // Use wouter for same-origin full URLs
    const path = url.replace(window.location.origin, '');
    console.log('🔄 SPA navigation to:', path);
    setLocation(path);
  } else {
    // Use full page redirect for cross-origin (different subdomain)
    console.log('🌐 Cross-origin redirect to:', url);
    window.location.href = url;
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function EmailAction() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<ActionStatus>('loading');
  const [message, setMessage] = useState('');
  const [actionType, setActionType] = useState<ActionMode | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const { updateUserVerification } = useFirebaseAuth();

  // Prevent double execution in React StrictMode
  const hasExecuted = useRef(false);

  useEffect(() => {
    // Prevent double execution
    if (hasExecuted.current) return;
    hasExecuted.current = true;

    const handleEmailAction = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode') as ActionMode | null;
        const oobCode = urlParams.get('oobCode');
        const email = urlParams.get('email');
        const continueUrl = urlParams.get('continueUrl');
        const lang = urlParams.get('lang') || 'en';

        console.log('📧 Email action detected:', {
          mode,
          oobCode: oobCode?.substring(0, 8) + '...',
          email,
          continueUrl: continueUrl ? decodeURIComponent(continueUrl) : null,
          lang,
          allParams: Object.fromEntries(urlParams.entries())
        });

        if (!mode || !oobCode) {
          throw new Error('Invalid email action link');
        }

        setActionType(mode);

        switch (mode) {
          case 'verifyEmail':
            await handleEmailVerification(oobCode, continueUrl);
            break;

          case 'resetPassword':
            handlePasswordReset(oobCode, email, continueUrl);
            break;

          case 'recoverEmail':
            // Handle email recovery (when user wants to revert email change)
            await handleEmailRecovery(oobCode, continueUrl);
            break;

          default:
            throw new Error(`Unknown action mode: ${mode}`);
        }
      } catch (error: any) {
        console.error('❌ Email action error:', error);
        setStatus('error');
        setMessage(error.message || 'Invalid or expired link');

        // Redirect to auth page after 5 seconds
        const fallbackUrl = buildRedirectUrl(null).replace('?verified=true', '');
        setTimeout(() => {
          performRedirect(fallbackUrl, setLocation);
        }, 5000);
      }
    };

    /**
     * Handle email verification action
     * ENTERPRISE-GRADE: Uses public endpoint to sync verification status
     * because user is NOT signed in when clicking the verification link
     */
    const handleEmailVerification = async (oobCode: string, continueUrl: string | null) => {
      try {
        console.log('🔍 Applying email verification action code...');
        
        // First, check the action code to get the email address
        const { checkActionCode } = await import('firebase/auth');
        const actionCodeInfo = await checkActionCode(auth, oobCode);
        const email = actionCodeInfo.data.email;
        
        console.log('📧 Action code info:', {
          operation: actionCodeInfo.operation,
          email: email
        });
        
        // Apply the action code to verify the email in Firebase
        await applyActionCode(auth, oobCode);
        console.log('✅ Email verification successful in Firebase');

        // ENTERPRISE: Call public endpoint to sync verification to database
        // This endpoint uses Firebase Admin SDK to verify the email is actually verified
        // and sends the welcome email. It doesn't require authentication because
        // the user is NOT signed in when clicking the verification link.
        if (email) {
          console.log('🔄 Calling public verify-email-complete endpoint...');
          try {
            const syncResponse = await fetch('/api/user/verify-email-complete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ email })
            });

            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log('✅ DATABASE VERIFICATION SYNC SUCCESS:', syncResult);
              console.log(`   - Database verified: ${syncResult.databaseVerified}`);
              console.log(`   - Welcome email sent: ${syncResult.welcomeEmailSent}`);
            } else {
              const errorData = await syncResponse.json().catch(() => ({}));
              console.error('❌ DATABASE VERIFICATION SYNC FAILED:', syncResponse.status, errorData);
              // Don't fail - Firebase verification succeeded, user can still log in
            }
          } catch (syncError) {
            console.error('❌ Error calling verify-email-complete:', syncError);
            // Don't fail - Firebase verification succeeded
          }
        }

        // Also try to update auth context if user happens to be signed in
        console.log('🔄 Attempting to update auth context (may fail if not signed in)...');
        try {
          await updateUserVerification();
          console.log('✅ Auth context updated');
        } catch (updateError) {
          // Expected to fail if user is not signed in - this is normal
          console.log('ℹ️ Auth context update skipped (user not signed in)');
        }

        setStatus('success');
        setMessage('Your email has been verified successfully! You can now log in to your account.');

        // Build the redirect URL based on continueUrl or detected role
        const finalRedirectUrl = buildRedirectUrl(continueUrl);
        setRedirectUrl(finalRedirectUrl);

        console.log('🎯 Will redirect to:', finalRedirectUrl);

        // Start countdown and progress animation
        // Redirect happens via the useEffect below

      } catch (verifyError: any) {
        console.error('❌ Email verification failed:', verifyError);
        throw new Error(
          verifyError.code === 'auth/invalid-action-code'
            ? 'This verification link has expired or is invalid.'
            : verifyError.code === 'auth/expired-action-code'
              ? 'This verification link has expired. Please request a new verification email.'
              : 'Failed to verify email. Please try again or request a new verification link.'
        );
      }
    };

    /**
     * Handle password reset action - redirect to password reset form
     */
    const handlePasswordReset = (
      oobCode: string,
      email: string | null,
      continueUrl: string | null
    ) => {
      console.log('🔄 Redirecting to password reset page');

      // Detect role for proper subdomain routing after reset
      const role = continueUrl ? detectRoleFromContinueUrl(continueUrl) : detectRoleFromCurrentHostname();

      // Build reset URL with all necessary params
      const resetParams = new URLSearchParams({
        oobCode,
        mode: 'resetPassword',
        ...(email && { email }),
        ...(role && { role }),
      });

      const resetUrl = `/password-reset?${resetParams.toString()}`;
      console.log('🔗 Reset URL:', resetUrl);
      setLocation(resetUrl);
    };

    /**
     * Handle email recovery action (revert email change)
     */
    const handleEmailRecovery = async (oobCode: string, continueUrl: string | null) => {
      try {
        console.log('🔍 Applying email recovery action code...');
        await applyActionCode(auth, oobCode);
        console.log('✅ Email recovery successful');

        setStatus('success');
        setMessage('Your email has been restored to the previous address.');

        const finalRedirectUrl = buildRedirectUrl(continueUrl);
        setRedirectUrl(finalRedirectUrl);

        setTimeout(() => {
          performRedirect(finalRedirectUrl, setLocation);
        }, 3000);

      } catch (error: any) {
        console.error('❌ Email recovery failed:', error);
        throw new Error('Failed to recover email. The link may have expired.');
      }
    };

    handleEmailAction();
  }, [setLocation, updateUserVerification]);

  // ============================================================================
  // COUNTDOWN & REDIRECT EFFECT
  // ============================================================================

  useEffect(() => {
    if (status !== 'success' || !redirectUrl) return;

    // Animate progress bar smoothly over 3 seconds
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 2; // Increment by 2% every 60ms = 100% in 3 seconds
      });
    }, 60);

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Perform redirect after 3 seconds
    const redirectTimeout = setTimeout(() => {
      performRedirect(redirectUrl, setLocation);
    }, 3000);

    return () => {
      clearInterval(progressInterval);
      clearInterval(countdownInterval);
      clearTimeout(redirectTimeout);
    };
  }, [status, redirectUrl, setLocation]);

  // ============================================================================
  // UI HELPERS
  // ============================================================================

  const handleGoToLogin = useCallback(() => {
    const fallbackUrl = buildRedirectUrl(null).replace('?verified=true', '');
    performRedirect(fallbackUrl, setLocation);
  }, [setLocation]);

  const handleRedirectNow = useCallback(() => {
    if (redirectUrl) {
      performRedirect(redirectUrl, setLocation);
    }
  }, [redirectUrl, setLocation]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-red-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-2xl border-0 overflow-hidden">
          <CardContent className="p-8">
            {/* Loading State */}
            {status === 'loading' && (
              <div className="text-center space-y-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200 }}
                  className="flex justify-center"
                >
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center">
                      <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                    </div>
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-blue-200"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                </motion.div>
                
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    {actionType === 'verifyEmail' && 'Verifying your email...'}
                    {actionType === 'resetPassword' && 'Processing...'}
                    {actionType === 'recoverEmail' && 'Recovering email...'}
                    {!actionType && 'Processing...'}
                  </h1>
                  <p className="text-gray-500">Please wait a moment</p>
                </div>
              </div>
            )}

            {/* Success State */}
            {status === 'success' && (
              <div className="text-center space-y-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
                  className="flex justify-center"
                >
                  <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    {actionType === 'verifyEmail' && 'Email Verified!'}
                    {actionType === 'recoverEmail' && 'Email Restored!'}
                    {!actionType && 'Success!'}
                  </h1>
                  <p className="text-gray-600">{message}</p>
                </motion.div>

                {/* Redirect Progress Section */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="space-y-4 pt-4 border-t border-gray-100"
                >
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm font-medium">
                      Redirecting in {countdown} second{countdown !== 1 ? 's' : ''}...
                    </span>
                  </div>

                  <Progress value={progress} className="h-2 bg-gray-100" />

                  {redirectUrl && (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                      <ArrowRight className="w-3 h-3" />
                      <span className="truncate max-w-[250px]">
                        {redirectUrl.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                  )}

                  <Button
                    onClick={handleRedirectNow}
                    variant="outline"
                    size="sm"
                    className="mt-2"
                  >
                    Go to Login Now
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </motion.div>
              </div>
            )}

            {/* Error State */}
            {status === 'error' && (
              <div className="text-center space-y-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200 }}
                  className="flex justify-center"
                >
                  <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                    <XCircle className="w-10 h-10 text-red-600" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
                  <p className="text-gray-600 mb-6">{message}</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  <Button
                    onClick={handleGoToLogin}
                    variant="destructive"
                    className="w-full"
                  >
                    Go to Login
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </motion.div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-gray-400 mt-4"
        >
          LocalCooks • Secure Email Verification
        </motion.p>
      </motion.div>
    </div>
  );
}