import { logger } from "@/lib/logger";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ResetPasswordForm from "../components/auth/ResetPasswordForm";

/**
 * Redirects to the correct subdomain login page based on user role.
 * Uses full-page redirect for cross-subdomain navigation.
 */
function redirectToRoleLogin(role: string | null, setLocation: (path: string) => void) {
  const isLocalhost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');

  if (isLocalhost) {
    const redirectPath = role === 'manager' ? '/manager/login' : '/auth';
    setLocation(redirectPath);
    return;
  }

  const redirectPaths: Record<string, string> = {
    manager: '/manager/login',
    chef: '/auth',
    admin: '/admin/login',
  };

  const subdomainMap: Record<string, string> = {
    manager: 'https://kitchen.localcooks.ca',
    chef: 'https://chef.localcooks.ca',
    admin: 'https://admin.localcooks.ca',
  };

  const detectedRole = role || 'chef';
  const subdomain = subdomainMap[detectedRole] || subdomainMap.chef;
  const path = redirectPaths[detectedRole] || redirectPaths.chef;

  logger.info('🔄 Redirecting to role login:', `${subdomain}${path}`);
  window.location.href = `${subdomain}${path}`;
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
    
    setOobCode(codeParam);
    setToken(tokenParam);
    setMode(modeParam);
    setEmail(emailParam);
    setRole(roleParam);

    // Check if this is a valid password reset request
    if (modeParam && modeParam !== 'resetPassword') {
      logger.info('Invalid reset mode:', modeParam);
      redirectToRoleLogin(roleParam, setLocation);
    }
  }, [setLocation]);

  const handleSuccess = () => {
    logger.info('✅ Password reset completed successfully');
    setIsSuccess(true);
    // No auto-redirect; user can click "Continue to Login" when ready
  };

  const handleGoBack = () => {
    redirectToRoleLogin(role, setLocation);
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
            Continue to {role === 'manager' ? 'Manager' : ''} Login
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