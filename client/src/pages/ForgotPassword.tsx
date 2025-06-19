import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import Logo from "@/components/ui/logo";
import { motion } from "framer-motion";
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
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <Logo className="w-16 h-16 mx-auto mb-6" />
            <h1 className="text-3xl font-bold text-gray-900">
              <span className="font-logo text-primary">Local Cooks</span>
            </h1>
            <p className="text-gray-600 mt-2">Community Application Platform</p>
          </div>

          <ForgotPasswordForm
            onSuccess={handleSuccess}
            onGoBack={handleGoBack}
          />
        </div>
      </motion.div>
    </div>
  );
} 