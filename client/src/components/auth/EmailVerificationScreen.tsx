import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Clock, Mail, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import AnimatedButton from "./AnimatedButton";

interface EmailVerificationScreenProps {
  email: string;
  onResend: () => Promise<void>;
  onGoBack: () => void;
  resendLoading?: boolean;
}

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const emailIconVariants = {
  idle: {
    scale: 1,
    rotate: 0,
    transition: { duration: 0.3 }
  },
  bounce: {
    scale: [1, 1.1, 1],
    rotate: [0, -5, 5, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      repeatDelay: 2
    }
  }
};

export default function EmailVerificationScreen({
  email,
  onResend,
  onGoBack,
  resendLoading = false
}: EmailVerificationScreenProps) {
  const [countdown, setCountdown] = useState(0);
  const [resendState, setResendState] = useState<'idle' | 'loading' | 'success'>('idle');

  useEffect(() => {
    if (countdown > 0) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [countdown]);

  const handleResend = async () => {
    setResendState('loading');
    try {
      await onResend();
      setResendState('success');
      setCountdown(60); // 60 second cooldown
      
      // Reset to idle after showing success
      setTimeout(() => {
        setResendState('idle');
      }, 2000);
    } catch (error) {
      setResendState('idle');
    }
  };

  const getResendButtonState = () => {
    if (resendLoading || resendState === 'loading') return 'loading';
    if (resendState === 'success') return 'success';
    return 'idle';
  };

  return (
    <motion.div
      className="w-full max-w-md mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Back Button */}
      <motion.button
        variants={itemVariants}
        onClick={onGoBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>Back to login</span>
      </motion.button>

      {/* Email Icon */}
      <motion.div
        variants={itemVariants}
        className="flex justify-center mb-8"
      >
        <motion.div
          className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center"
          variants={emailIconVariants}
          initial="idle"
          animate="bounce"
        >
          <Mail className="w-12 h-12 text-blue-600" />
        </motion.div>
      </motion.div>

      {/* Title and Description */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Check your email
        </h2>
        <p className="text-gray-600 leading-relaxed">
          We sent a verification link to:
        </p>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-2 p-3 bg-gray-50 rounded-lg border"
        >
          <span className="font-semibold text-gray-900">{email}</span>
        </motion.div>
      </motion.div>

      {/* Instructions */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <p className="text-gray-600 text-sm leading-relaxed">
          Click the link to verify your account and unlock your learning journey.
        </p>
      </motion.div>

      {/* Resend Button */}
      <motion.div variants={itemVariants} className="mb-6">
        <AnimatedButton
          state={getResendButtonState()}
          loadingText="Sending..."
          successText="Email sent!"
          onClick={handleResend}
          disabled={countdown > 0 || resendLoading}
          variant="primary"
          className={countdown > 0 ? "opacity-50 cursor-not-allowed" : ""}
        >
          <RefreshCw className="w-4 h-4" />
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend Email'}
        </AnimatedButton>
      </motion.div>

      {/* Help Options */}
      <motion.div variants={itemVariants} className="space-y-4">
        <div className="flex items-center justify-center text-sm text-gray-500">
          <Clock className="w-4 h-4 mr-2" />
          <span>Didn't receive it? Check your spam folder</span>
        </div>
        
        <div className="flex items-center justify-center text-sm text-gray-500">
          <Mail className="w-4 h-4 mr-2" />
          <span>Wrong email? 
            <button 
              onClick={onGoBack}
              className="text-blue-600 hover:underline ml-1"
            >
              Go back
            </button>
          </span>
        </div>
      </motion.div>

      {/* Success Animation */}
      <AnimatePresence>
        {resendState === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: -20 }}
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/20 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="bg-white rounded-xl p-6 shadow-2xl max-w-sm mx-4 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"
              >
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </motion.div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Email Sent!
              </h3>
              <p className="text-gray-600 text-sm">
                Check your inbox for the verification link.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
} 