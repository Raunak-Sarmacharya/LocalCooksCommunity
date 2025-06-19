import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function ForgotPasswordPage() {
  const [, setLocation] = useLocation();

  const handleSuccess = () => {
    // Stay on the page to show success message
    console.log('✅ Password reset email sent successfully');
  };

  const handleGoBack = () => {
    setLocation('/auth');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Back Button at Top */}
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={handleGoBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Back to Login</span>
        </motion.button>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <ForgotPasswordForm
            onSuccess={handleSuccess}
            onGoBack={handleGoBack}
          />
        </div>
      </motion.div>
    </div>
  );
} 