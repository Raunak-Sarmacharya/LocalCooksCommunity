import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Loader2, Shield } from "lucide-react";

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
    y: 20,
    scale: 0.9,
    transition: { duration: 0.3 }
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, delay: 0.1 }
  }
};

const dotsVariants = {
  start: {
    transition: {
      staggerChildren: 0.2,
      repeat: Infinity,
      repeatDelay: 0.5
    }
  }
};

const dotVariants = {
  start: {
    y: [0, -10, 0],
    transition: {
      duration: 0.6,
      ease: "easeInOut"
    }
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
            transition={{ duration: 0.5, type: "spring" }}
            className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6"
          >
            <CheckCircle className="w-8 h-8 text-green-600" />
          </motion.div>
        );
      case 'verifying':
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-6"
          >
            <Shield className="w-8 h-8 text-blue-600" />
          </motion.div>
        );
      default:
        return (
          <div className="flex items-center justify-center mb-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 text-primary"
            >
              <Loader2 className="w-full h-full" />
            </motion.div>
          </div>
        );
    }
  };

  const renderLoadingDots = () => {
    if (type !== 'loading') return null;
    
    return (
      <motion.div 
        className="flex space-x-2 mt-4"
        variants={dotsVariants}
        animate="start"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-primary/60"
            variants={dotVariants}
          />
        ))}
      </motion.div>
    );
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <motion.div
            className="bg-white rounded-xl shadow-2xl p-8 max-w-md mx-4 text-center"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {renderIcon()}
            
            <motion.h3 
              className="text-xl font-semibold text-gray-900 mb-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {message}
            </motion.h3>
            
            <motion.p 
              className="text-gray-600 text-sm leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              {submessage}
            </motion.p>

            {renderLoadingDots()}
            
            {type === 'loading' && (
              <motion.div 
                className="flex items-center justify-center mt-6 text-xs text-gray-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <Shield className="w-4 h-4 mr-2" />
                <span>Your data is protected</span>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
} 