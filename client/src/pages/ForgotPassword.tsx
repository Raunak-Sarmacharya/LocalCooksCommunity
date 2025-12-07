import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import ForgotPasswordForm from "../components/auth/ForgotPasswordForm";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [emailSent, setEmailSent] = useState(false);
  
  // Get role from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const role = urlParams.get('role');

  const handleSuccess = () => {
    setEmailSent(true);
  };

  const handleGoBack = () => {
    const redirectPath = role === 'manager' ? '/manager/login' : '/auth';
    setLocation(redirectPath);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex flex-col">
      {/* Back Button - Now at the top */}
      <div className="p-6">
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={handleGoBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Back to {role === 'manager' ? 'Manager ' : ''}Login</span>
        </motion.button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8"
          >
            <ForgotPasswordForm
              onSuccess={handleSuccess}
              onGoBack={handleGoBack}
              role={role || undefined}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
} 