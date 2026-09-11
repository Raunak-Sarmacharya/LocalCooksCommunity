import { logger } from "@/lib/logger";
import { getRoleLoginOrigin } from "@shared/subdomain-utils";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ResetPasswordForm from "../components/auth/ResetPasswordForm";

function clientVercelEnv(): string | undefined {
  return import.meta.env.VITE_VERCEL_ENV || undefined;
}

/**
 * Redirects to the correct subdomain login page based on user role.
 * Preview (`VERCEL_ENV=preview`) → dev-chef / etc.; production → chef.localcooks.ca.
 */
function redirectToRoleLogin(role: string | null, setLocation: (path: string) => void) {
  const isLocalhost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');

  if (isLocalhost) {
    const redirectPath = role === 'manager' ? '/manager/login' : '/auth';
    console.log('[redirectToRoleLogin] localhost redirect:', redirectPath);
    setLocation(redirectPath);
    return;
  }

  const redirectPaths: Record<string, string> = {
    manager: '/manager/login',
    chef: '/auth',
    admin: '/admin/login',
  };

  const detectedRole = role || 'chef';
  const subdomain = getRoleLoginOrigin(detectedRole, window.location.hostname, {
    vercelEnv: clientVercelEnv(),
  });
  const path = redirectPaths[detectedRole] || redirectPaths.chef;
  const fullUrl = `${subdomain}${path}`;

  console.log('[redirectToRoleLogin] env-aware redirect:', { role, detectedRole, fullUrl, vercelEnv: clientVercelEnv() });
  logger.info('🔄 Redirecting to role login:', fullUrl);
  window.location.href = fullUrl;
}

/**
 * Detects user role from a Firebase continueUrl embedded in the reset link.
 * Mirrors the logic in EmailAction.tsx for consistency.
 */
function detectRoleFromContinueUrl(continueUrl: string): 'manager' | 'chef' | 'admin' | null {
  try {
    const url = new URL(continueUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) {
      return pathname.includes('/manager') ? 'manager' : 'chef';
    }
    if (hostname.includes('chef') || hostname.startsWith('chef.')) {
      return 'chef';
    }
    if (hostname.includes('admin') || hostname.startsWith('admin.')) {
      return 'admin';
    }
    if (pathname.includes('/manager')) return 'manager';
    if (pathname.includes('/admin')) return 'admin';
    if (pathname.includes('/auth') || pathname.includes('/chef')) return 'chef';
    return null;
  } catch {
    return null;
  }
}

/**
 * Detects user role from the current browser hostname (fallback).
 */
function detectRoleFromHostname(): 'manager' | 'chef' | 'admin' {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) return 'manager';
  if (hostname.includes('chef') || hostname.startsWith('chef.')) return 'chef';
  if (hostname.includes('admin') || hostname.startsWith('admin.')) return 'admin';
  return 'chef';
}

export default function PasswordReset() {
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    // Get reset parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('oobCode');
    const tokenParam = urlParams.get('token');
    const modeParam = urlParams.get('mode');
    const emailParam = urlParams.get('email');
    const roleParam = urlParams.get('role');
    const continueUrlParam = urlParams.get('continueUrl');

    // Detect role from multiple sources (priority: continueUrl > URL param > hostname)
    let detectedRole: string | null = roleParam;
    if (!detectedRole && continueUrlParam) {
      detectedRole = detectRoleFromContinueUrl(decodeURIComponent(continueUrlParam));
    }
    if (!detectedRole) {
      detectedRole = detectRoleFromHostname();
    }

    console.log('[PasswordReset] mount detected:', { detectedRole, hostname: window.location.hostname, roleParam, continueUrlParam, pathname: window.location.pathname });

    setOobCode(codeParam);
    setToken(tokenParam);
    setMode(modeParam);
    setEmail(emailParam);
    setRole(detectedRole);

    // If mode is invalid, redirect immediately
    if (modeParam && modeParam !== 'resetPassword') {
      logger.info('Invalid reset mode:', modeParam);
      redirectToRoleLogin(detectedRole, setLocation);
      return;
    }

    // ENTERPRISE: Cross-subdomain redirect.
    // If the Firebase Action URL points to the wrong subdomain (e.g., kitchen
    // for a chef user), redirect to the correct subdomain before rendering.
    const isLocalhost = window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.localhost');

    if (!isLocalhost && detectedRole) {
      const currentHostname = window.location.hostname.toLowerCase();
      const isCorrectSubdomain =
        (detectedRole === 'manager' && (currentHostname.includes('kitchen') || currentHostname.startsWith('kitchen.'))) ||
        (detectedRole === 'chef' && (currentHostname.includes('chef') || currentHostname.startsWith('chef.'))) ||
        (detectedRole === 'admin' && (currentHostname.includes('admin') || currentHostname.startsWith('admin.')));

      if (!isCorrectSubdomain) {
        const targetSubdomain = getRoleLoginOrigin(detectedRole, window.location.hostname, {
          vercelEnv: clientVercelEnv(),
        });
        const fullUrl = `${targetSubdomain}${window.location.pathname}${window.location.search}`;
        logger.info('🌐 Cross-subdomain redirect from PasswordReset:', fullUrl);
        window.location.href = fullUrl;
        return;
      }
    }
  }, [setLocation]);

  const handleSuccess = () => {
    logger.info('✅ Password reset completed successfully');
    setIsSuccess(true);
    // No auto-redirect; user can click "Continue to Login" when ready
  };

  const handleGoBack = () => {
    // Defensive: always re-read role from URL since React state can be stale
    // or the component may have been rendered by a cached/old build.
    const urlParams = new URLSearchParams(window.location.search);
    const roleFromUrl = urlParams.get('role');
    const continueUrlParam = urlParams.get('continueUrl');

    let effectiveRole: string | null = roleFromUrl;
    if (!effectiveRole && continueUrlParam) {
      effectiveRole = detectRoleFromContinueUrl(decodeURIComponent(continueUrlParam));
    }
    if (!effectiveRole) {
      effectiveRole = detectRoleFromHostname();
    }

    console.log('[PasswordReset] handleGoBack:', { roleState: role, roleFromUrl, effectiveRole, hostname: window.location.hostname });
    redirectToRoleLogin(effectiveRole, setLocation);
  };

  // Show success state instead of redirecting immediately
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Password Reset Successful!
          </h2>
          
          <p className="text-gray-600 mb-6">
            Your password has been successfully updated. You can now log in with your new password.
          </p>

          <button
            onClick={handleGoBack}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            Continue to {role === 'manager' ? 'Manager' : role === 'admin' ? 'Admin' : 'Chef'} Login
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full"
      >
        <ResetPasswordForm
          oobCode={oobCode || undefined}
          token={token || undefined}
          email={email || undefined}
          onSuccess={handleSuccess}
          onGoBack={handleGoBack}
        />
      </motion.div>
    </div>
  );
} 