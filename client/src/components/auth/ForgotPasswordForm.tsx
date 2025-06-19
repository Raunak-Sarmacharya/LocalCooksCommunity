import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

interface ForgotPasswordFormProps {
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

export default function ForgotPasswordForm({ onSuccess, onGoBack }: ForgotPasswordFormProps) {
  const [formState, setFormState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const handleSubmit = async (data: ForgotPasswordFormData) => {
    setFormState('loading');
    setErrorMessage(null);

    try {
      console.log('🔄 Submitting forgot password request for:', data.email);
      
      const response = await fetch('/api/firebase/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      console.log('📡 Forgot password response status:', response.status);
      
      const responseData = await response.json();
      console.log('📡 Forgot password response:', responseData);

      if (!response.ok) {
        console.error('❌ Forgot password failed:', responseData);
        throw new Error(responseData.message || 'Failed to send reset email');
      }

      console.log('✅ Forgot password request successful');
      setFormState('success');
      if (onSuccess) {
        setTimeout(onSuccess, 2000);
      }
    } catch (error: any) {
      console.error('❌ Forgot password error:', error);
      setFormState('error');
      setErrorMessage(error.message || 'An unexpected error occurred');
    }
  };

  return (
    <motion.div
      className="w-full max-w-md mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Title */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Reset your password
        </h2>
        <p className="text-gray-600">
          Enter your email address and we'll send you a link to reset your password.
        </p>
      </motion.div>

      {/* Form */}
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <motion.div variants={itemVariants}>
          <AnimatedInput
            type="email"
            label="Email Address"
            placeholder="Enter your email"
            icon={<Mail className="w-5 h-5" />}
            error={form.formState.errors.email?.message}
            {...form.register('email')}
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
            {formState === 'loading' ? 'Sending...' : 
             formState === 'success' ? 'Email sent!' : 
             'Send reset link'}
          </AnimatedButton>
        </motion.div>
      </form>

      {/* Success Message */}
      <AnimatePresence>
        {formState === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-6 p-4 bg-green-50 rounded-lg border border-green-100"
          >
            <p className="text-sm text-green-800">
              <strong>Check your email!</strong> We've sent a password reset link to your email address.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
} 