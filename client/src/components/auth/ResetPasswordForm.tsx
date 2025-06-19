import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
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

export default function ResetPasswordForm({ oobCode, token, onSuccess, onGoBack }: ResetPasswordFormProps) {
  const [formState, setFormState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFirebaseReset, setIsFirebaseReset] = useState(false);

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    // Determine if this is a Firebase reset (oobCode) or legacy reset (token)
    setIsFirebaseReset(!!oobCode);
    
    if (!oobCode && !token) {
      setErrorMessage("No reset code provided. Please request a new password reset link.");
    }
  }, [oobCode, token]);

  const handleSubmit = async (data: ResetPasswordFormData) => {
    setFormState('loading');
    setErrorMessage(null);

    try {
      const endpoint = isFirebaseReset ? '/api/firebase/reset-password' : '/api/auth/reset-password';
      const body = isFirebaseReset 
        ? { oobCode, newPassword: data.password }
        : { token, newPassword: data.password };

      console.log('🔄 Password reset attempt:', { 
        endpoint, 
        isFirebaseReset, 
        hasOobCode: !!oobCode, 
        hasToken: !!token 
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

  if (!oobCode && !token) {
    return (
      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Invalid Reset Link
          </h2>
          <p className="text-gray-600 mb-6">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="text-blue-600 hover:text-blue-700 hover:underline transition-colors"
            >
              Back to login
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