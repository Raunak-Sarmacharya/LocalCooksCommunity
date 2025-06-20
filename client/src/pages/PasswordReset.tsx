import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ResetPasswordForm from "../components/auth/ResetPasswordForm";

export default function PasswordReset() {
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    // Get reset parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('oobCode');
    const tokenParam = urlParams.get('token');
    const modeParam = urlParams.get('mode');
    const emailParam = urlParams.get('email');
    
    setOobCode(codeParam);
    setToken(tokenParam);
    setMode(modeParam);
    setEmail(emailParam);

    // Check if this is a valid password reset request
    if (modeParam && modeParam !== 'resetPassword') {
      console.log('Invalid reset mode:', modeParam);
      setLocation('/auth');
    }
  }, [setLocation]);

  const handleSuccess = () => {
    console.log('✅ Password reset completed successfully');
    setIsSuccess(true);
    // Redirect to login after showing success message
    setTimeout(() => {
      setLocation('/auth');
    }, 3000);
  };

  const handleGoBack = () => {
    setLocation('/auth');
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
          
          <div className="flex items-center justify-center gap-2 text-sm text-blue-600 mb-4">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Redirecting to login...</span>
          </div>
          
          <button
            onClick={handleGoBack}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            Continue to Login
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