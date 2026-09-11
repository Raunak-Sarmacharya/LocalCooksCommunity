import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Loader2 } from "lucide-react";

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  submessage?: string;
  type?: 'loading' | 'success' | 'verifying';
}

const overlayVariants = {
  hidden: {
    opacity: 0,
    transition: { duration: 0.3 }
  },
  visible: {
    opacity: 1,
    transition: { duration: 0.3 }
  }
};

const contentVariants = {
  hidden: {
    opacity: 0,
    y: 16,
    scale: 0.97,
    transition: { duration: 0.2 }
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, delay: 0.05, ease: "easeOut" }
  }
};

export default function LoadingOverlay({ 
  isVisible, 
  message = "Signing you in...", 
  submessage = "Please wait while we verify your credentials securely.",
  type = 'loading'
}: LoadingOverlayProps) {
  const renderIcon = () => {
    switch (type) {
      case 'success':
        return (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.45, type: "spring", stiffness: 220, damping: 16 }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50"
          >
            <CheckCircle className="h-6 w-6 text-emerald-600" strokeWidth={2} />
          </motion.div>
        );
      case 'verifying':
      default:
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            className="h-8 w-8 text-primary"
          >
            <Loader2 className="h-full w-full" strokeWidth={2.25} />
          </motion.div>
        );
    }
  };

  return typeof document !== 'undefined' ? createPortal(
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-md"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <motion.div
            role="status"
            aria-live="polite"
            aria-busy={type !== 'success'}
            className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-slate-200/80 bg-white px-7 py-8 text-center shadow-[0_16px_45px_rgba(44,44,44,0.12)] sm:px-9"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <div className="mb-5 flex w-full justify-center">
              {renderIcon()}
            </div>
            
            <motion.h3 
              className="mb-2 max-w-xs text-center text-xl font-semibold tracking-tight text-[#2C2C2C]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {message}
            </motion.h3>
            
            <motion.p 
              className="mx-auto max-w-[19rem] text-center text-sm leading-6 text-slate-600"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.28 }}
            >
              {submessage}
            </motion.p>
            
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  ) : null;
}
