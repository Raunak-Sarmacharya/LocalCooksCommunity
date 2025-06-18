import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import Logo from "@/components/ui/logo";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function PasswordReset() {
  const [, setLocation] = useLocation();
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [isValidLink, setIsValidLink] = useState<boolean | null>(null);

  useEffect(() => {
    // Extract oobCode from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('oobCode');
    const mode = urlParams.get('mode');
    
    console.log('🔗 Password reset page loaded with:', { code: code?.substring(0, 8) + '...', mode });
    
    if (code && mode === 'resetPassword') {
      setOobCode(code);
      setIsValidLink(true);
    } else {
      setIsValidLink(false);
    }
  }, []);

  const handleSuccess = () => {
    console.log('✅ Password reset successful, redirecting to auth page');
    setLocation('/auth?message=password-reset-success');
  };

  const handleGoBack = () => {
    setLocation('/auth');
  };

  if (isValidLink === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Verifying reset link...</p>
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
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Invalid Reset Link
            </h1>
            <p className="text-gray-600 mb-6">
              This password reset link is invalid or has expired. Please request a new password reset.
            </p>
            <button
              onClick={handleGoBack}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
            >
              Back to Login
            </button>
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
            <h1 className="text-3xl font-bold text-gray-900">Local Cooks</h1>
            <p className="text-gray-600 mt-2">Community Application Platform</p>
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