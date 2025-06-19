import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import Logo from "@/components/ui/logo";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function PasswordReset() {
  const [, setLocation] = useLocation();
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [isValidLink, setIsValidLink] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Extract oobCode from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('oobCode');
    const mode = urlParams.get('mode');
    
    console.log('🔗 Password reset page loaded with:', { code: code?.substring(0, 8) + '...', mode });
    
    if (code && mode === 'resetPassword') {
      setOobCode(code);
      // Validate the code by making a test call
      validateResetCode(code);
    } else if (code) {
      // Has code but wrong mode
      setIsValidLink(false);
      setErrorMessage('This link is not a password reset link. Please check your email for the correct link.');
    } else {
      // No code at all
      setIsValidLink(false);
      setErrorMessage('No reset code found. Please request a new password reset from the login page.');
    }
  }, []);

  const validateResetCode = async (code: string) => {
    try {
      // Try to validate the code without actually resetting the password
      console.log('🔍 Validating reset code...');
      
      // For now, assume it's valid if we have a code
      // Firebase will handle validation during actual reset
      setIsValidLink(true);
    } catch (error) {
      console.error('❌ Error validating reset code:', error);
      setIsValidLink(false);
      setErrorMessage('This password reset link has expired or is invalid. Please request a new one.');
    }
  };

  const handleSuccess = () => {
    console.log('✅ Password reset successful, redirecting to auth page');
    setLocation('/auth?message=password-reset-success');
  };

  const handleGoBack = () => {
    setLocation('/auth');
  };

  const handleRequestNewReset = () => {
    setLocation('/forgot-password');
  };

  if (isValidLink === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Validating reset link...</p>
        </div>
      </div>
    );
  }

  if (isValidLink === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <Logo className="w-16 h-16 mx-auto mb-6" />
            <div className="mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-4">
                Reset Link Issue
              </h1>
              <p className="text-gray-600 mb-6">
                {errorMessage || 'This password reset link is invalid or has expired.'}
              </p>
            </div>
            
            <div className="space-y-3">
              <button
                onClick={handleRequestNewReset}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
                Request New Reset Link
              </button>
              <button
                onClick={handleGoBack}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-xl transition-all duration-200"
              >
                Back to Login
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <Logo className="w-16 h-16 mx-auto mb-6" />
            <h1 className="text-3xl font-bold text-gray-900">
              <span className="font-logo text-primary">Local Cooks</span>
            </h1>
            <p className="text-gray-600 mt-2">Password Reset</p>
          </div>

          <ResetPasswordForm
            oobCode={oobCode || undefined}
            onSuccess={handleSuccess}
            onGoBack={handleGoBack}
          />
        </div>
      </motion.div>
    </div>
  );
} 