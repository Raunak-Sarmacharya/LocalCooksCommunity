import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { ReactNode } from "react";

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

interface AnimatedButtonProps {
  children: ReactNode;
  state?: ButtonState;
  loadingText?: string;
  successText?: string;
  errorText?: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'google';
}

const buttonVariants = {
  idle: {
    scale: 1,
    transition: { duration: 0.2 }
  },
  hover: {
    scale: 1.02,
    transition: { duration: 0.2 }
  },
  tap: {
    scale: 0.98,
    transition: { duration: 0.1 }
  },
  loading: {
    scale: 0.98,
    transition: { duration: 0.3 }
  },
  success: {
    scale: 1.05,
    transition: { duration: 0.3 }
  }
};

const contentVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
};

export default function AnimatedButton({
  children,
  state = 'idle',
  loadingText = 'Loading...',
  successText = 'Success!',
  errorText = 'Try again',
  className,
  disabled,
  onClick,
  type = 'button',
  variant = 'primary'
}: AnimatedButtonProps) {
  const baseClasses = cn(
    "relative w-full flex items-center justify-center gap-2 px-6 py-3 font-semibold rounded-lg transition-all duration-300",
    "focus:outline-none focus:ring-2 focus:ring-offset-2",
    {
      // Primary variant
      "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary": variant === 'primary' && state !== 'success' && state !== 'error',
      // Success state
      "bg-green-500 text-white": state === 'success',
      // Error state  
      "bg-red-500 text-white": state === 'error',
      // Google variant
      "bg-white border border-gray-200 text-gray-900 shadow-sm hover:bg-gray-50 focus:ring-gray-300": variant === 'google',
      // Secondary variant
      "bg-secondary text-secondary-foreground hover:bg-secondary/90 focus:ring-secondary": variant === 'secondary',
      // Disabled state
      "opacity-50 cursor-not-allowed": disabled || state === 'loading'
    },
    className
  );

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <motion.div
            key="loading"
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{loadingText}</span>
          </motion.div>
        );
      case 'success':
        return (
          <motion.div
            key="success"
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            <span>{successText}</span>
          </motion.div>
        );
      case 'error':
        return (
          <motion.div
            key="error"
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4" />
            <span>{errorText}</span>
          </motion.div>
        );
      default:
        return (
          <motion.div
            key="idle"
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex items-center gap-2"
          >
            {children}
          </motion.div>
        );
    }
  };

  return (
    <motion.button
      type={type}
      className={baseClasses}
      variants={buttonVariants}
      initial="idle"
      whileHover={!disabled && state === 'idle' ? "hover" : "idle"}
      whileTap={!disabled && state === 'idle' ? "tap" : "idle"}
      animate={state === 'loading' ? "loading" : state === 'success' ? "success" : "idle"}
      disabled={disabled || state === 'loading'}
      onClick={onClick}
      layout
    >
      <AnimatePresence mode="wait">
        {renderContent()}
      </AnimatePresence>
    </motion.button>
  );
} 