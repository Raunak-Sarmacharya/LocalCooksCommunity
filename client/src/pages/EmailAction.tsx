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
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { useFirebaseAuth } from "../hooks/use-auth";
import { auth } from "../lib/firebase";

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
     */
    const handleEmailVerification = async (oobCode: string, continueUrl: string | null) => {
      try {
        console.log('🔍 Applying email verification action code...');
        await applyActionCode(auth, oobCode);
        console.log('✅ Email verification successful');

        // Update the user verification status in the auth context
        console.log('🔄 Updating user verification status in auth context...');
        try {
          await updateUserVerification();
          console.log('✅ User verification status updated');
        } catch (updateError) {
          // Don't fail verification if context update fails
          console.warn('⚠️ Failed to update auth context, but verification succeeded:', updateError);
        }

        setStatus('success');
        setMessage('Your email has been verified successfully! You can now log in to your account.');

        // Build the redirect URL based on continueUrl or detected role
        const finalRedirectUrl = buildRedirectUrl(continueUrl);
        setRedirectUrl(finalRedirectUrl);

        console.log('🎯 Will redirect to:', finalRedirectUrl);

        // Redirect after 3 seconds
        setTimeout(() => {
          performRedirect(finalRedirectUrl, setLocation);
        }, 3000);

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
  // UI HELPERS
  // ============================================================================

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-16 h-16 text-green-600" />;
      case 'error':
        return <XCircle className="w-16 h-16 text-red-600" />;
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading':
        if (actionType === 'verifyEmail') return 'Verifying your email...';
        if (actionType === 'resetPassword') return 'Processing...';
        if (actionType === 'recoverEmail') return 'Recovering email...';
        return 'Processing...';
      case 'success':
        if (actionType === 'verifyEmail') return 'Email verified!';
        if (actionType === 'recoverEmail') return 'Email restored!';
        return 'Success!';
      case 'error':
        return 'Something went wrong';
    }
  };

  const getColor = () => {
    switch (status) {
      case 'loading':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
    }
  };

  const handleGoToLogin = () => {
    const fallbackUrl = buildRedirectUrl(null).replace('?verified=true', '');
    performRedirect(fallbackUrl, setLocation);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="mb-6 flex justify-center"
        >
          {getIcon()}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={`text-2xl font-bold mb-4 ${getColor()}`}
        >
          {getTitle()}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-gray-600 mb-6"
        >
          {message}
        </motion.p>

        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="space-y-2"
          >
            <p className="text-sm text-gray-500">
              Redirecting you in a moment...
            </p>
            {redirectUrl && (
              <p className="text-xs text-gray-400 truncate">
                → {redirectUrl.replace(/^https?:\/\//, '')}
              </p>
            )}
          </motion.div>
        )}

        {status === 'error' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleGoToLogin}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Go to Login
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}