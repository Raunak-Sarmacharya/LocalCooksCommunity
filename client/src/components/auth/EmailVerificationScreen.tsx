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
  idle: { scale: 1 },
  bounce: {
    scale: [1, 1.1, 1],
    transition: {
      duration: 1,
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
  const [resendCount, setResendCount] = useState(0);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendDisabled && resendTimer > 0) {
      timer = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    } else if (resendTimer === 0) {
      setResendDisabled(false);
      setResendTimer(60);
    }
    return () => clearInterval(timer);
  }, [resendDisabled, resendTimer]);

  const handleResend = async () => {
    try {
      setResendError(null);
      setResendDisabled(true);
      setResendCount(prev => prev + 1);
      await onResend();
    } catch (error) {
      setResendError('Failed to resend verification email. Please try again later.');
      setResendDisabled(false);
      setResendTimer(0);
    }
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
        {resendCount > 0 && (
          <p className="text-sm text-gray-500 mt-2">
            {resendCount === 1 ? 'Verification email resent.' : `Verification email resent ${resendCount} times.`}
          </p>
        )}
      </motion.div>

      {/* Resend Button */}
      <motion.div variants={itemVariants} className="flex justify-center">
        <AnimatedButton
          onClick={handleResend}
          disabled={resendDisabled || resendLoading}
          className="flex items-center gap-2"
        >
          {resendLoading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Sending...
            </>
          ) : resendDisabled ? (
            <>
              <Clock className="w-4 h-4" />
              Resend in {resendTimer}s
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Resend verification email
            </>
          )}
        </AnimatedButton>
      </motion.div>

      {/* Error Message */}
      {resendError && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 text-center text-red-600 text-sm"
        >
          {resendError}
        </motion.div>
      )}

      {/* Spam Folder Note */}
      <motion.div
        variants={itemVariants}
        className="mt-8 p-4 bg-yellow-50 rounded-lg border border-yellow-100"
      >
        <p className="text-sm text-yellow-800">
          <strong>Not seeing the email?</strong> Check your spam folder or try using a different email address.
        </p>
      </motion.div>
    </motion.div>
  );
} 