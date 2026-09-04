import { logger } from "@/lib/logger";
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
import { clearAuthIntent, getAuthIntent, resolveVerificationReturnPath } from "@/lib/auth-intent";
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
type ActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'signIn';

/**
 * Detects if the current hostname is a staging/dev environment
 * Preview = VITE_VERCEL_ENV=preview, or already on a `dev-*` host.
 */
function isStagingEnvironment(): boolean {
  if (import.meta.env.VITE_VERCEL_ENV === 'preview') return true;
  const hostname = window.location.hostname.toLowerCase();
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    return parts[0].startsWith('dev-') || hostname.startsWith('dev.');
  }
  return false;
}

/**
 * Gets the base domain from the current hostname
 * e.g., 'chef.localcooks.ca'        → 'localcooks.ca'
 *       'dev-chef.localcooks.ca'    → 'localcooks.ca'
 *       'chef.localhost'             → 'localhost'   (BUG FIX previously returned 'chef.localhost')
 *       'kitchen.chef.localhost'    → 'localhost'
 *       'admin.127.0.0.1'           → '127.0.0.1'
 */
function getBaseDomain(): string {
  const hostname = window.location.hostname.toLowerCase();
  const hostWithoutPort = hostname.split(':')[0];
  const parts = hostWithoutPort.split('.');

  if (hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1') {
    return 'localhost';
  }

  // FIX: any hostname that terminates in .localhost or .127.0.0.1 is a dev host;
  // strip all prefix labels and return localhost as the base domain.
  // Without this, chef.localhost → parts.length=2 → falls through to return 'chef.localhost',
  // causing getSubdomainForRole to build chef.chef.localhost (double prefix).
  if (hostWithoutPort.endsWith('.localhost')) return 'localhost';
  if (hostWithoutPort.endsWith('.127.0.0.1')) return '127.0.0.1';

  if (parts.length >= 3) {
    return parts.slice(-2).join('.');
  }

  return hostWithoutPort;
}

/**
 * Production/staging subdomain configuration for role-based routing.
 * - Localhost: preserves the CURRENT page protocol/port to avoid mismatches.
 * - Production: applies staging dev- prefix when appropriate.
 */
function getSubdomainForRole(role: 'manager' | 'chef' | 'admin'): string {
  const baseDomain = getBaseDomain();
  const isLocalhostLike = baseDomain === 'localhost' || baseDomain === '127.0.0.1';
  const isStaging = !isLocalhostLike && isStagingEnvironment();
  const prefix = isStaging ? 'dev-' : '';

  const subdomainMap = {
    manager: 'kitchen',
    chef: 'chef',
    admin: 'admin',
  } as const;

  if (isLocalhostLike) {
    // Preserve current page protocol + port — avoids forcing http when user is on
    // a proxied https dev setup, and keeps the port we actually listened on.
    const protocol = window.location.protocol; // 'http:' or 'https:'
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${protocol}//${subdomainMap[role]}.${baseDomain}${port}`;
  }

  return `https://${prefix}${subdomainMap[role]}.${baseDomain}`;
}

/**
 * Default redirect paths for each role after email verification
 */
const DEFAULT_REDIRECT_PATHS = {
  manager: '/manager/login?verified=true',
  chef: '/auth?verified=true',
  admin: '/admin/login?verified=true',
} as const;

/**
 * Post sign-in redirect paths for each role (after magic link login)
 */
const POST_SIGNIN_REDIRECT_PATHS = {
  manager: '/manager/dashboard',
  chef: '/dashboard',
  admin: '/admin',
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Aggressively normalizes Firebase action mode parameter.
 * Handles case variations, whitespace, and potential invisible/Unicode characters.
 * Firebase Admin SDK, console templates, or proxies may send modes with slight variations.
 *
 * DEFENSE-IN-DEPTH MATCHING: supports every plausible sign-in variant:
 *   signIn | signin | SIGNIN | SignIn | sign-in | sign_in | sign in | oobSignIn | signinlink | signInWithEmailLink
 */
function normalizeActionMode(mode: string | null): ActionMode | null {
  if (!mode) return null;

  // Unicode normalize + trim + strip invisible control chars
  const cleaned = mode
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .trim();

  // Lowercase alpha-only comparison (strips hyphens, underscores, spaces, digits — everything)
  const lower = cleaned.toLowerCase().replace(/[^a-z]/g, '');

  // Debug log: include raw bytes so we can catch spoofed homoglyphs / invisible Unicode
  const hexDump = Array.from(mode).map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join(' ');
  logger.info(`🔍 Mode normalization: raw="${mode}", cleaned="${cleaned}", lowerAlpha="${lower}", hex=[${hexDump}]`);

  // --- Exact lower-alpha match (primary, handles 99.9% of cases including canonical camelCase) ---
  if (lower === 'verifyemail') return 'verifyEmail';
  if (lower === 'resetpassword') return 'resetPassword';
  if (lower === 'recoveremail') return 'recoverEmail';
  if (lower === 'signin') return 'signIn';

  // --- Substring fallback: catches sign-in / sign_in / signInWithEmailLink etc ---
  //    (order matters — most specific first)
  if (lower.includes('resetpassword') || lower.includes('passwordreset')) return 'resetPassword';
  if (lower.includes('verifyemail')    || lower.includes('emailverify'))    return 'verifyEmail';
  if (lower.includes('recoveremail')   || lower.includes('emailrecover'))   return 'recoverEmail';
  if (lower.includes('signin') || lower.includes('signintwithemail') || lower.includes('emaillink') || lower.includes('magiclink')) {
    logger.info(`✅ signIn matched via lowerAlpha substring: lower="${lower}"`);
    return 'signIn';
  }

  // --- Exact canonical fallback ---
  const CANONICAL: ActionMode[] = ['verifyEmail', 'resetPassword', 'recoverEmail', 'signIn'];
  for (const c of CANONICAL) {
    if (cleaned === c) {
      logger.info(`✅ Matched canonical mode via exact cleaned string: "${c}"`);
      return c;
    }
    // Case-insensitive exact cleaned match
    if (cleaned.toLowerCase() === c.toLowerCase()) {
      logger.info(`✅ Matched canonical mode via case-insensitive cleaned: "${c}"`);
      return c;
    }
  }

  logger.warn(`⚠️ Could not normalize action mode: raw="${mode}", cleaned="${cleaned}", lower="${lower}"`);
  return null;
}

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
    logger.error('❌ Failed to parse continueUrl:', error);
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
 * 
 * @param continueUrl - The continueUrl from Firebase params
 * @param databaseRole - Role fetched from the database (overrides continueUrl)
 * @param forSignIn - If true, use post-sign-in paths (dashboard) instead of verification paths
 */
function isKitchenFlowPath(pathOrUrl: string): boolean {
  try {
    const path = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl).pathname
      : pathOrUrl.split("?")[0];
    return (
      path.includes("/kitchen-preview") ||
      path.includes("/apply-kitchen") ||
      path.includes("/book-kitchen") ||
      path.includes("/book/")
    );
  } catch {
    return false;
  }
}

function buildRedirectUrl(
  continueUrl: string | null,
  databaseRole?: 'manager' | 'chef' | 'admin' | null,
  forSignIn: boolean = false
): string {
  // Trusted domains for security validation
  const baseDomain = getBaseDomain();
  const TRUSTED_DOMAINS = [
    baseDomain,
    `kitchen.${baseDomain}`,
    `chef.${baseDomain}`,
    `admin.${baseDomain}`,
    `dev-kitchen.${baseDomain}`,
    `dev-chef.${baseDomain}`,
    `dev-admin.${baseDomain}`,
    `dev.${baseDomain}`,
    'localhost',
    'kitchen.localhost',
    'chef.localhost',
    'admin.localhost',
    '127.0.0.1',
  ];

  const trustedContinueUrl = (raw: string | null): string | null => {
    if (!raw) return null;
    try {
      const url = new URL(decodeURIComponent(raw));
      const isTrusted = TRUSTED_DOMAINS.some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );
      if (isTrusted) {
        return decodeURIComponent(raw);
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  // Saved kitchen tour/book intent — survives magic-link AND verification redirects.
  const intent = getAuthIntent();
  if (intent?.returnPath && isKitchenFlowPath(intent.returnPath)) {
    logger.info('✅ Using pendingAuthIntent return path:', intent.returnPath);
    return intent.returnPath;
  }

  const pendingReturn = resolveVerificationReturnPath();
  if (pendingReturn && isKitchenFlowPath(pendingReturn)) {
    logger.info('✅ Using pendingApplicationModal return path:', pendingReturn);
    return pendingReturn;
  }

  // Honour continueUrl for kitchen flows even when databaseRole is known.
  if (continueUrl) {
    const trusted = trustedContinueUrl(continueUrl);
    if (trusted) {
      try {
        const path = new URL(trusted).pathname;
        if (forSignIn && isKitchenFlowPath(path)) {
          logger.info('✅ Using kitchen-flow continueUrl:', trusted);
          return trusted;
        }
        if (!forSignIn && isKitchenFlowPath(path)) {
          logger.info('✅ Using kitchen-flow continueUrl (verification):', trusted);
          return trusted;
        }
        if (!databaseRole) {
          logger.info('✅ Using trusted continueUrl:', trusted);
          return trusted;
        }
      } catch {
        /* fall through */
      }
    }
  }

  // Fallback: Build URL based on detected or provided role.
  // Never send kitchen-flow users to admin when DB role is wrong.
  let role = databaseRole || (continueUrl
    ? detectRoleFromContinueUrl(continueUrl)
    : detectRoleFromCurrentHostname());

  const kitchenFlowActive =
    (intent?.type === "book" || intent?.type === "tour") ||
    (intent?.returnPath && isKitchenFlowPath(intent.returnPath)) ||
    (pendingReturn && isKitchenFlowPath(pendingReturn)) ||
    (continueUrl && isKitchenFlowPath(continueUrl));

  if (role === "admin" && kitchenFlowActive) {
    logger.warn("⚠️ Overriding admin redirect — active kitchen book/tour flow");
    role = "chef";
  }

  if (role !== "manager" && role !== "chef" && role !== "admin") {
    role = "chef";
  }

  logger.info('🔍 Detected role for redirect:', role);

  // For localhost, use full subdomain URLs for cross-subdomain routing
  const isLocalhost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');

  const redirectPaths = forSignIn ? POST_SIGNIN_REDIRECT_PATHS : DEFAULT_REDIRECT_PATHS;
  const subdomain = role ? getSubdomainForRole(role) : getSubdomainForRole('chef');
  const path = role ? redirectPaths[role] : redirectPaths.chef;

  if (isLocalhost) {
    // For localhost sign-in, always redirect to the correct subdomain URL
    // (this ensures Firebase auth state lives on the correct origin)
    if (forSignIn) {
      const fullUrl = `${subdomain}${path}`;
      logger.info('📍 Using localhost sign-in redirect URL:', fullUrl);
      return fullUrl;
    }
    // For verification, use relative paths if same-origin, otherwise full URL
    const sameOrigin = subdomain === window.location.origin;
    if (sameOrigin) {
      logger.info('📍 Using localhost relative redirect path:', path);
      return path;
    }
    const fullUrl = `${subdomain}${path}`;
    logger.info('📍 Using localhost cross-subdomain redirect URL:', fullUrl);
    return fullUrl;
  }

  // Production/Staging: Build full URL with subdomain (staging applies dev- prefix automatically)
  const fullUrl = `${subdomain}${path}`;

  logger.info('🌐 Using production/staging redirect URL:', fullUrl);
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
    logger.info('🔄 SPA navigation to:', url);
    setLocation(url);
  } else if (isSameOrigin) {
    // Use wouter for same-origin full URLs
    const path = url.replace(window.location.origin, '');
    logger.info('🔄 SPA navigation to:', path);
    setLocation(path);
  } else {
    // Use full page redirect for cross-origin (different subdomain)
    logger.info('🌐 Cross-origin redirect to:', url);
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
        const rawMode = urlParams.get('mode');
        const mode = normalizeActionMode(rawMode) as ActionMode | null;
        const oobCode = urlParams.get('oobCode');
        const email = urlParams.get('email');
        const continueUrl = urlParams.get('continueUrl');
        const lang = urlParams.get('lang') || 'en';

        logger.info('📧 Email action detected:', {
          rawMode,
          mode,
          oobCode: oobCode?.substring(0, 8) + '...',
          email,
          continueUrl: continueUrl ? decodeURIComponent(continueUrl) : null,
          lang,
          allParams: Object.fromEntries(urlParams.entries())
        });

        const e2eDevBypass = urlParams.get('e2eDevBypass') === '1';
        const bypassEmail = urlParams.get('email');
        const isLocalDevHost =
          window.location.hostname === 'localhost' ||
          window.location.hostname.endsWith('.localhost');
        if (e2eDevBypass && bypassEmail && isLocalDevHost) {
          setActionType('verifyEmail');
          await handleE2eDevEmailVerification(bypassEmail, continueUrl);
          return;
        }

        if (!mode || !oobCode) {
          throw new Error('Invalid email action link');
        }

        setActionType(mode);

        // Explicit handler map with exact canonical keys (avoids switch fallthrough bugs)
        const modeIs = (candidate: ActionMode) => {
          const match = mode === candidate;
          logger.debug(`   → comparing mode="${mode}" === "${candidate}" ? ${match}`);
          return match;
        };

        if (modeIs('verifyEmail')) {
          await handleEmailVerification(oobCode, continueUrl);
        } else if (modeIs('resetPassword')) {
          handlePasswordReset(oobCode, email, continueUrl);
        } else if (modeIs('recoverEmail')) {
          await handleEmailRecovery(oobCode, continueUrl);
        } else if (modeIs('signIn')) {
          await handleSignInLink(oobCode, continueUrl, Object.fromEntries(urlParams.entries()));
        } else {
          // LAST-DITCH SNIFF (stale cached bundles / proxy mangling defense).
          // Even if normalizeActionMode returned null for a mode that *contains*
          // sign-in-ish tokens (signin, sign-in, sign_in, magic-link, passwordless)
          // we treat it as signIn rather than erroring out — because the cost of
          // dispatching signIn incorrectly is just "invalid sign-in link", while
          // the cost of throwing here is an unrecoverable dead-end UX.
          const raw = (rawMode ?? '').toLowerCase().replace(/[^a-z]/g, '');
          if (raw && (raw.includes('signin') || raw.includes('emaillink') || raw.includes('magiclink') || raw.includes('passwordless'))) {
            logger.warn(`⚠️ Dispatching as signIn via last-ditch raw-sniff (normalize returned null). rawMode="${rawMode}"`);
            await handleSignInLink(oobCode, continueUrl, Object.fromEntries(urlParams.entries()));
          } else {
            logger.error(`🛑 Giving up on mode dispatch. rawMode="${rawMode}", normalized=${String(mode)}, params=${JSON.stringify(Object.fromEntries(urlParams.entries()))}`);
            throw new Error(`Unknown action mode: ${rawMode}`);
          }
        }
      } catch (error: any) {
        logger.error('❌ Email action error:', error);
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
     * Dev/TestSprite only: complete verification when Firebase throttled oob generation.
     */
    const handleE2eDevEmailVerification = async (
      emailAddress: string,
      continueUrl: string | null
    ) => {
      const syncResponse = await fetch('/api/user/verify-email-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAddress }),
      });
      if (!syncResponse.ok) {
        const errorData = await syncResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to sync email verification');
      }
      const syncResult = await syncResponse.json();
      const databaseRole = syncResult.role ?? null;
      try {
        await updateUserVerification();
      } catch {
        /* user may not be signed in */
      }
      setStatus('success');
      setMessage('Your email has been verified! You can now log in. If you were expecting another email, check your spam folder.');
      setRedirectUrl(buildRedirectUrl(continueUrl, databaseRole));
    };

    /**
     * Handle email verification action
     * ENTERPRISE-GRADE: Uses public endpoint to sync verification status
     * because user is NOT signed in when clicking the verification link
     */
    const handleEmailVerification = async (oobCode: string, continueUrl: string | null) => {
      try {
        logger.info('🔍 Applying email verification action code...');
        
        // First, check the action code to get the email address
        const { checkActionCode } = await import('firebase/auth');
        const actionCodeInfo = await checkActionCode(auth, oobCode);
        const email = actionCodeInfo.data.email;
        
        logger.info('📧 Action code info:', {
          operation: actionCodeInfo.operation,
          email: email
        });
        
        // Apply the action code to verify the email in Firebase
        await applyActionCode(auth, oobCode);
        logger.info('✅ Email verification successful in Firebase');

        // ENTERPRISE: Call public endpoint to sync verification to database
        // This endpoint uses Firebase Admin SDK to verify the email is actually verified
        // and sends the welcome email. It doesn't require authentication because
        // the user is NOT signed in when clicking the verification link.
        let databaseRole: 'manager' | 'chef' | 'admin' | null = null;
        if (email) {
          logger.info('🔄 Calling public verify-email-complete endpoint...');
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
              if (syncResult.role) {
                databaseRole = syncResult.role;
              }
              logger.info('✅ DATABASE VERIFICATION SYNC SUCCESS:', JSON.stringify(syncResult, null, 2));
              logger.info(`   - Database verified: ${syncResult.databaseVerified}`);
              logger.info(`   - Welcome email sent: ${syncResult.welcomeEmailSent}`);
              logger.info(`   - Role from DB: ${databaseRole}`);
              logger.info(`   - Email config status:`, syncResult.emailConfigStatus);
              
              // ENTERPRISE: Warn if email wasn't sent so we can investigate
              if (!syncResult.welcomeEmailSent && !syncResult.welcomeEmailPreviouslySent) {
                logger.warn('⚠️ Welcome email was NOT sent! Check server logs for details.');
                logger.warn('⚠️ Email config:', syncResult.emailConfigStatus);
              }
            } else {
              const errorData = await syncResponse.json().catch(() => ({}));
              logger.error('❌ DATABASE VERIFICATION SYNC FAILED:', syncResponse.status, JSON.stringify(errorData, null, 2));
              // Don't fail - Firebase verification succeeded, user can still log in
            }
          } catch (syncError) {
            logger.error('❌ Error calling verify-email-complete:', syncError);
            // Don't fail - Firebase verification succeeded
          }
        }

        // Also try to update auth context if user happens to be signed in
        logger.info('🔄 Attempting to update auth context (may fail if not signed in)...');
        try {
          await updateUserVerification();
          logger.info('✅ Auth context updated');
        } catch (updateError) {
          // Expected to fail if user is not signed in - this is normal
          logger.info('ℹ️ Auth context update skipped (user not signed in)');
        }

        setStatus('success');
        setMessage('Your email has been verified! You can now log in. If you were expecting another email, check your spam folder.');

        // Build the redirect URL based on continueUrl or detected role
        const finalRedirectUrl = buildRedirectUrl(continueUrl, databaseRole);
        setRedirectUrl(finalRedirectUrl);

        logger.info('🎯 Will redirect to:', finalRedirectUrl);

        // Start countdown and progress animation
        // Redirect happens via the useEffect below

      } catch (verifyError: any) {
        logger.error('❌ Email verification failed:', verifyError);
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
     * ENTERPRISE: Always routes to the correct subdomain for the user's role,
     * preventing chefs from getting stuck on the kitchen subdomain.
     */
    const handlePasswordReset = (
      oobCode: string,
      email: string | null,
      continueUrl: string | null
    ) => {
      logger.info('🔄 Redirecting to password reset page');

      // Detect role for proper subdomain routing after reset
      const role = continueUrl ? detectRoleFromContinueUrl(continueUrl) : detectRoleFromCurrentHostname();

      // Build reset URL with all necessary params
      const resetParams = new URLSearchParams({
        oobCode,
        mode: 'resetPassword',
        ...(email && { email }),
        ...(role && { role }),
      });

      // Redirect to the correct subdomain for the user's role.
      // In production, a full cross-origin redirect ensures chefs land on chef.localcooks.ca
      // even if the Firebase Action URL is configured to kitchen.localcooks.ca.
      const isLocalhost = window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.localhost');

      if (isLocalhost) {
        const resetUrl = `/password-reset?${resetParams.toString()}`;
        logger.info('🔗 Reset URL (localhost):', resetUrl);
        setLocation(resetUrl);
        return;
      }

      // Staging-aware subdomain URL
      const subdomain = role ? getSubdomainForRole(role) : getSubdomainForRole('chef');
      const resetUrl = `${subdomain}/password-reset?${resetParams.toString()}`;
      logger.info('🔗 Reset URL (cross-subdomain):', resetUrl);
      window.location.href = resetUrl;
    };

    /**
     * Handle passwordless magic link sign-in (mode=signIn)
     * 
     * FIREBASE INDUSTRY-STANDARD FLOW (per firebase.google.com/docs/auth/web/email-link-auth):
     * - checkActionCode() / applyActionCode() are NOT used for sign-in links
     *   They only support: verifyEmail | resetPassword | recoverEmail
     *   Using them with mode=signIn throws "unknown mode signIn"
     * - isSignInWithEmailLink() is the SDK authority to validate the link
     * - signInWithEmailLink() requires the EXPLICIT email for anti-phishing security:
     *   1. localStorage  → same-device flow (set when user requested the link)
     *   2. continueUrl  → server-encoded email hint for cross-device UX
     *   3. user prompt  → cross-device fallback (standard Firebase UX)
     * 
     * ADDITIONAL ENTERPRISE STEPS:
     * - Look up the user's actual role from the database
     * - If NOT on the correct subdomain for that role → redirect to the correct subdomain
     *   (preserving all query params) so Firebase auth state is set on the CORRECT origin.
     * - If ALREADY on the correct subdomain → complete sign-in and redirect to dashboard.
     */
    const handleSignInLink = async (
      oobCode: string,
      continueUrl: string | null,
      allParams: Record<string, string>
    ) => {
      try {
        logger.info('🔐 Magic link sign-in detected');

        // ---------------------------------------------------------------------
        // STEP 1 — Use SDK authority to validate this is a sign-in link
        // NOTE: checkActionCode() is NOT called here — it does not support
        // mode=signIn and throws "unknown mode signIn". This was the bug.
        // ---------------------------------------------------------------------
        const { isSignInWithEmailLink } = await import('firebase/auth');
        const signInHref = window.location.href;
        if (!isSignInWithEmailLink(auth, signInHref)) {
          throw new Error('This link is not a valid sign-in link. It may have been tampered with.');
        }

        // ---------------------------------------------------------------------
        // STEP 2 — Resolve the email required by signInWithEmailLink()
        // Priority (industry best practice):
        //   a) localStorage  — same-device, set by sendEmailLink() on request
        //   b) continueUrl   — server-encoded hint for convenient cross-device UX
        //   c) user prompt   — cross-device anti-phishing confirmation
        // ---------------------------------------------------------------------
        let email: string | null = window.localStorage.getItem('emailForSignIn');
        logger.info('📧 Email resolution step 1 (localStorage): ' + (email ? `HIT → ${email}` : 'MISS'));

        if (!email && continueUrl) {
          try {
            const cu = new URL(decodeURIComponent(continueUrl));
            const fromContinue = cu.searchParams.get('email');
            if (fromContinue) {
              email = fromContinue;
              logger.info(`📧 Email resolution step 2 (continueUrl): HIT → ${email}`);
            }
          } catch (parseErr) {
            logger.warn('⚠️ Step 2 continueUrl parse failed (non-fatal):', parseErr instanceof Error ? parseErr.message : String(parseErr));
          }
        }

        if (!email) {
          logger.info('📧 Email resolution step 3: prompting user (cross-device / standard Firebase UX)');
          const userProvided = window.prompt(
            'To complete sign-in, enter the email address you used to request the sign-in link.\n\nThis confirmation protects your account from phishing.'
          );
          email = userProvided ? userProvided.trim() : null;
          if (!email) {
            throw new Error('Email confirmation is required to sign in. Please request a new sign-in email and try again.');
          }
          logger.info(`📧 Email resolution step 3 (prompt): user provided → ${email}`);
        }

        // ---------------------------------------------------------------------
        // STEP 3 — Look up the user's role from the database (lightweight public API)
        // ---------------------------------------------------------------------
        let databaseRole: 'manager' | 'chef' | 'admin' | null = null;
        try {
          logger.info('🔍 Looking up user role from database for:', email);
          const roleResponse = await fetch('/api/user/lookup-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });

          if (roleResponse.ok) {
            const roleData = await roleResponse.json();
            const r = roleData.role;
            if (r === 'manager' || r === 'chef' || r === 'admin') {
              databaseRole = r;
            }
            logger.info(`✅ Resolved role from DB: ${databaseRole}`);
          } else {
            logger.warn('⚠️ Role lookup failed, falling back to continueUrl/hostname detection');
          }
        } catch (lookupError) {
          logger.error('❌ Role lookup error (continuing with fallback):', lookupError);
        }

        // ---------------------------------------------------------------------
        // STEP 4 — Determine target subdomain based on role
        // ---------------------------------------------------------------------
        const detectedFromContinueUrl = continueUrl ? detectRoleFromContinueUrl(continueUrl) : null;
        const detectedFromHostname = detectRoleFromCurrentHostname();
        const finalRole: 'manager' | 'chef' | 'admin' =
          databaseRole
          || detectedFromContinueUrl
          || detectedFromHostname
          || 'chef';

        const targetOrigin = getSubdomainForRole(finalRole);
        const currentOrigin = window.location.origin;
        const exactMatch = targetOrigin === currentOrigin;

        // Loose "on correct subdomain" check — avoids bouncing when we already
        // host a matching role-prefix. Covers:
        //   chef.localhost:5001       → correct for role=chef
        //   dev-chef.localcooks.ca    → correct for role=chef  (staging prefix)
        //   kitchen.localcooks.ca     → correct for role=manager
        //   admin.localcooks.ca       → correct for role=admin
        // Without this loose check, a staging proxy that terminates TLS and sets
        // X-Forwarded-Host but leaves window.location.origin different from the
        // string we build here would cause an infinite redirect / wrong-origin bounce
        // (e.g. https://dev-chef.localcooks.ca → https://chef.localcooks.ca).
        const currentHost = window.location.hostname.toLowerCase();
        const looseMatch = (() => {
          const roleToExpected = new Map<string, string[]>([
            ['chef',    ['chef.']],
            ['manager', ['kitchen.', 'manager.']],
            ['admin',   ['admin.']],
          ]);
          const prefixes = roleToExpected.get(finalRole) ?? [];
          return prefixes.some(p => currentHost.startsWith(p) || currentHost.startsWith(`dev-${p}`));
        })();

        const onCorrectSubdomain = exactMatch || looseMatch;

        logger.info(`📍 Origin check: current=${currentOrigin}, target=${targetOrigin}, exact=${exactMatch}, loose=${looseMatch}, skipRedirect=${onCorrectSubdomain}`);

        // ---------------------------------------------------------------------
        // STEP 5 — If on wrong subdomain → redirect preserving params + email
        // ---------------------------------------------------------------------
        if (!onCorrectSubdomain) {
          logger.info(`🔀 Redirecting to correct subdomain: ${targetOrigin}`);
          const params = new URLSearchParams(allParams);
          // Inject resolved email into continueUrl so the target subdomain page
          // can resolve it without needing localStorage or another prompt
          if (email && continueUrl) {
            try {
              const cu = new URL(decodeURIComponent(continueUrl));
              if (!cu.searchParams.has('email')) {
                cu.searchParams.set('email', email);
                params.set('continueUrl', encodeURIComponent(cu.toString()));
              }
            } catch { /* ignore, continue without injection */ }
          }
          const preservedParams = params.toString();
          const redirectTo = `${targetOrigin}/email-action?${preservedParams}`;
          logger.info(`🔗 Final subdomain redirect URL: ${redirectTo}`);
          window.location.href = redirectTo;
          return;
        }

        // ---------------------------------------------------------------------
        // STEP 6 — On correct subdomain → complete sign-in with SDK
        // ---------------------------------------------------------------------
        logger.info('✅ On correct subdomain, completing sign-in as:', email);
        const { signInWithEmailLink } = await import('firebase/auth');

        await signInWithEmailLink(auth, email, signInHref);
        window.localStorage.removeItem('emailForSignIn');
        logger.info('✅ Magic link sign-in successful (email verified implicitly)');

        setStatus('success');
        setMessage('Sign-in successful! Taking you back to continue where you left off...');

        const finalRedirectUrl = buildRedirectUrl(continueUrl, databaseRole, true);
        if (isKitchenFlowPath(finalRedirectUrl)) {
          clearAuthIntent();
        }
        setRedirectUrl(finalRedirectUrl);
        logger.info('🎯 Will redirect after sign-in:', finalRedirectUrl);

      } catch (signInError: any) {
        logger.error('❌ Magic link sign-in failed:', signInError);
        const isInvalidOrExpired =
          signInError.code === 'auth/invalid-action-code' ||
          signInError.code === 'auth/expired-action-code' ||
          signInError.code === 'auth/invalid-email';
        const friendlyMessage =
          signInError.code === 'auth/invalid-email'
            ? 'The email address provided does not match this sign-in link. Please request a new link or verify the email you entered.'
            : isInvalidOrExpired
              ? 'This sign-in link has expired or is invalid. Links expire after 10 minutes for your security — please request a new one.'
              : signInError.message && !signInError.message.includes('prompt')
                ? signInError.message
                : 'Failed to complete sign-in. Please try again or request a new link.';
        throw new Error(friendlyMessage);
      }
    };

    /**
     * Handle email recovery action (revert email change)
     */
    const handleEmailRecovery = async (oobCode: string, continueUrl: string | null) => {
      try {
        logger.info('🔍 Applying email recovery action code...');
        await applyActionCode(auth, oobCode);
        logger.info('✅ Email recovery successful');

        setStatus('success');
        setMessage('Your email has been restored to the previous address.');

        const finalRedirectUrl = buildRedirectUrl(continueUrl);
        setRedirectUrl(finalRedirectUrl);

        setTimeout(() => {
          performRedirect(finalRedirectUrl, setLocation);
        }, 3000);

      } catch (error: any) {
        logger.error('❌ Email recovery failed:', error);
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
                    {actionType === 'signIn' && 'Signing you in...'}
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
                    {actionType === 'signIn' && 'Signed In!'}
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
                    {actionType === 'signIn' ? 'Go to Dashboard Now' : 'Go to Login Now'}
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