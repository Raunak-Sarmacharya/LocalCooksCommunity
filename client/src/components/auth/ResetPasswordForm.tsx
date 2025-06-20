import { zodResolver } from "@hookform/resolvers/zod";
import { verifyPasswordResetCode } from "firebase/auth";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Lock, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { auth } from "../../lib/firebase";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";

const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/\d/, "Password must contain at least one number"),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordFormProps {
  oobCode?: string; // Firebase reset code from URL
  token?: string; // Legacy token support
  email?: string; // Email from password reset URL
  onSuccess?: () => void;
  onGoBack?: () => void;
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

export default function ResetPasswordForm({ oobCode, token, email, onSuccess, onGoBack }: ResetPasswordFormProps) {
  const [formState, setFormState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFirebaseReset, setIsFirebaseReset] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    // Determine if this is a Firebase reset (oobCode) or legacy reset (token)
    setIsFirebaseReset(!!oobCode);
    
    if (!oobCode && !token) {
      setErrorMessage("No reset code provided. Please request a new password reset link.");
      return;
    }

    // If this is a Firebase reset, verify the oobCode to extract the email
    if (oobCode) {
      const verifyCode = async () => {
        try {
          console.log('🔍 Verifying Firebase reset code to extract email...');
          const emailFromCode = await verifyPasswordResetCode(auth, oobCode);
          console.log('✅ Successfully verified reset code for email:', emailFromCode);
          setVerifiedEmail(emailFromCode);
        } catch (error: any) {
          console.error('❌ Failed to verify reset code:', error);
          if (error.code === 'auth/invalid-action-code') {
            setErrorMessage("This password reset link has expired or is invalid. Please request a new password reset from the login page.");
          } else if (error.code === 'auth/expired-action-code') {
            setErrorMessage("This password reset link has expired. Please request a new password reset from the login page.");
          } else {
            setErrorMessage("Invalid reset link. Please request a new password reset from the login page.");
          }
        }
      };
      
      verifyCode();
    }
  }, [oobCode, token]);

  const handleSubmit = async (data: ResetPasswordFormData) => {
    setFormState('loading');
    setErrorMessage(null);

    try {
      const endpoint = isFirebaseReset ? '/api/firebase/reset-password' : '/api/auth/reset-password';
      
      // For Firebase reset, use the verified email from the oobCode
      // For legacy reset, use the email prop if available
      const emailToUse = isFirebaseReset ? verifiedEmail : email;
      
      const body = isFirebaseReset 
        ? { oobCode, newPassword: data.password, email: emailToUse }
        : { token, newPassword: data.password };

      console.log('🔄 Password reset attempt:', { 
        endpoint, 
        isFirebaseReset, 
        hasOobCode: !!oobCode, 
        hasToken: !!token,
        hasEmail: !!emailToUse,
        email: emailToUse
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('❌ Password reset failed:', responseData);
        
        // Handle specific error types more gracefully
        if (responseData.message?.includes('invalid-action-code') || responseData.message?.includes('Invalid or expired')) {
          throw new Error('This password reset link has expired. Please request a new password reset from the login page.');
        } else if (responseData.message?.includes('weak-password')) {
          throw new Error('Password is too weak. Please choose a stronger password with at least 8 characters, including uppercase, lowercase, and numbers.');
        } else {
          throw new Error(responseData.message || 'Failed to reset password');
        }
      }

      console.log('✅ Password reset successful');
      setFormState('success');
      if (onSuccess) {
        setTimeout(onSuccess, 1500); // Shorter delay for better UX
      }
    } catch (error: any) {
      console.error('❌ Password reset error:', error);
      setFormState('error');
      setErrorMessage(error.message || 'An unexpected error occurred. Please try again.');
    }
  };

  // Don't render the form if we have a Firebase reset code but haven't verified the email yet
  if (isFirebaseReset && !verifiedEmail && !errorMessage) {
    return (
      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Verifying Reset Link
          </h2>
          <p className="text-gray-600 mb-6">
            Please wait while we verify your password reset link...
          </p>
        </motion.div>
      </motion.div>
    );
  }

  // Show error if no reset code provided
  if (!oobCode && !token) {
    return (
      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-red-600 mb-3">
            Invalid Reset Link
          </h2>
          <p className="text-gray-600 mb-6">
            No reset code provided. Please request a new password reset link.
          </p>
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Go to Login Page
            </button>
          )}
        </motion.div>
      </motion.div>
    );
  }

  // Show error if Firebase code verification failed
  if (isFirebaseReset && errorMessage) {
    return (
      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-red-600 mb-3">
            Reset Link Error
          </h2>
          <p className="text-gray-600 mb-6">
            {errorMessage}
          </p>
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Request New Reset Link
            </button>
          )}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="w-full max-w-md mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Back Button */}
      {onGoBack && (
        <motion.button
          variants={itemVariants}
          onClick={onGoBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Back to login</span>
        </motion.button>
      )}

      {/* Title */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Set new password
        </h2>
        <p className="text-gray-600">
          Please enter your new password below.
        </p>
        {isFirebaseReset && (
          <p className="text-xs text-blue-600 mt-2">
            Using Firebase secure password reset
          </p>
        )}
      </motion.div>

      {/* Form */}
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <motion.div variants={itemVariants}>
          <AnimatedInput
            type="password"
            label="New Password"
            placeholder="New password"
            icon={<Lock className="w-5 h-5" />}
            error={form.formState.errors.password?.message}
            showPasswordToggle={true}
            {...form.register('password')}
          />
        </motion.div>

        <motion.div variants={itemVariants}>
          <AnimatedInput
            type="password"
            label="Confirm Password"
            placeholder="Confirm new password"
            icon={<Lock className="w-5 h-5" />}
            error={form.formState.errors.confirmPassword?.message}
            showPasswordToggle={true}
            {...form.register('confirmPassword')}
          />
        </motion.div>

        {/* Error Message */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <motion.div variants={itemVariants}>
          <AnimatedButton
            type="submit"
            disabled={formState === 'loading' || formState === 'success'}
            className="w-full"
          >
            {formState === 'loading' ? 'Resetting...' : 
             formState === 'success' ? 'Password reset!' : 
             'Reset password'}
          </AnimatedButton>
        </motion.div>
      </form>

      {/* Success Message */}
      {formState === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-4 bg-green-50 rounded-lg border border-green-100"
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">
                <strong>Password reset successful!</strong>
              </p>
              <p className="text-xs text-green-600 mt-1">
                Redirecting you to the login page...
              </p>
            </div>
          </div>
          {onGoBack && (
            <div className="mt-4 pt-3 border-t border-green-200">
              <button
                onClick={onGoBack}
                className="text-sm text-green-700 hover:text-green-800 hover:underline transition-colors"
              >
                Continue to login →
              </button>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
} 