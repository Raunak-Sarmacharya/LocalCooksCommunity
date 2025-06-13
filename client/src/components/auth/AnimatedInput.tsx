import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

interface AnimatedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onDrag'> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  showPasswordToggle?: boolean;
  validationState?: 'idle' | 'valid' | 'invalid';
}

const inputVariants = {
  idle: {
    scale: 1,
    borderColor: "rgb(229, 231, 235)", // gray-200
    backgroundColor: "rgb(255, 255, 255)",
    boxShadow: "0 0 0 0px rgba(66, 133, 244, 0)",
    transition: { duration: 0.2 }
  },
  focus: {
    scale: 1.01,
    borderColor: "rgb(66, 133, 244)", // blue-500
    backgroundColor: "rgb(249, 250, 251)", // gray-50
    boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)",
    transition: { duration: 0.2 }
  },
  valid: {
    borderColor: "rgb(34, 197, 94)", // green-500
    backgroundColor: "rgb(247, 254, 231)", // green-50
    transition: { duration: 0.3 }
  },
  invalid: {
    borderColor: "rgb(239, 68, 68)", // red-500
    backgroundColor: "rgb(254, 242, 242)", // red-50
    x: [-2, 2, -2, 2, 0], // Shake animation
    transition: { duration: 0.5 }
  }
};

const labelVariants = {
  idle: {
    y: 0,
    scale: 1,
    color: "rgb(107, 114, 128)", // gray-500
    transition: { duration: 0.2 }
  },
  focus: {
    y: -8,
    scale: 0.85,
    color: "rgb(66, 133, 244)", // blue-500
    transition: { duration: 0.2 }
  },
  filled: {
    y: -8,
    scale: 0.85,
    color: "rgb(107, 114, 128)", // gray-500
    transition: { duration: 0.2 }
  }
};

const AnimatedInput = forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ label, error, icon, showPasswordToggle, validationState = 'idle', className, type = 'text', value, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [internalValue, setInternalValue] = useState(value || '');

    const inputType = showPasswordToggle && !showPassword ? 'password' : showPasswordToggle && showPassword ? 'text' : type;
    const hasValue = Boolean(value || internalValue);
    
    const getInputState = () => {
      if (validationState === 'valid') return 'valid';
      if (validationState === 'invalid') return 'invalid';
      if (isFocused) return 'focus';
      return 'idle';
    };

    const getLabelState = () => {
      if (isFocused) return 'focus';
      if (hasValue) return 'filled';
      return 'idle';
    };

    return (
      <div className="relative">
        <motion.div 
          className="relative"
          variants={inputVariants}
          animate={getInputState()}
        >
          {/* Icon */}
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10">
              {icon}
            </div>
          )}

          {/* Input */}
          <input
            ref={ref}
            type={inputType}
            value={value}
            className={cn(
              "w-full px-4 py-3 border rounded-lg outline-none transition-all duration-200",
              "placeholder-transparent peer",
              icon ? "pl-10" : "",
              showPasswordToggle ? "pr-12" : "",
              className
            )}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            onChange={(e) => {
              setInternalValue(e.target.value);
              props.onChange?.(e);
            }}
            {...props}
          />

          {/* Floating Label */}
          {label && (
            <motion.label
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none origin-left z-10"
              variants={labelVariants}
              animate={getLabelState()}
              style={{
                color: 'inherit'
              }}
            >
              {label}
            </motion.label>
          )}

          {/* Password Toggle */}
          {showPasswordToggle && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors z-10"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </motion.div>

        {/* Error Message */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-2 text-sm text-red-500 flex items-center gap-1"
          >
            <span>{error}</span>
          </motion.div>
        )}

        {/* Password Strength Indicator */}
        {showPasswordToggle && hasValue && (
          <PasswordStrengthIndicator password={String(value || internalValue)} />
        )}
      </div>
    );
  }
);

AnimatedInput.displayName = "AnimatedInput";

// Password Strength Indicator Component
function PasswordStrengthIndicator({ password }: { password: string }) {
  const getStrength = (password: string) => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strength = getStrength(password);
  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2"
    >
      <div className="flex gap-1 mb-1">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full bg-gray-200",
              strength > i ? strengthColors[Math.min(strength - 1, 4)] : ""
            )}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: i * 0.1 }}
          />
        ))}
      </div>
      <div className="text-xs text-gray-500">
        Password strength: <span className={cn(
          "font-medium",
          strength <= 1 ? "text-red-500" : strength <= 2 ? "text-orange-500" : strength <= 3 ? "text-yellow-500" : strength <= 4 ? "text-blue-500" : "text-green-500"
        )}>
          {strengthLabels[Math.max(0, strength - 1)]}
        </span>
      </div>
    </motion.div>
  );
}

export default AnimatedInput; 