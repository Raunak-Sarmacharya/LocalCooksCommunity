import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";

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
    backgroundColor: "rgba(249, 250, 251, 0.5)", // gray-50/50
    boxShadow: "0 0 0 0px rgba(59, 130, 246, 0)",
    transition: { duration: 0.2 }
  },
  focus: {
    scale: 1.002,
    borderColor: "rgb(59, 130, 246)", // blue-500
    backgroundColor: "rgb(255, 255, 255)", // white
    boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.08)",
    transition: { duration: 0.2 }
  },
  valid: {
    borderColor: "rgb(34, 197, 94)", // green-500
    backgroundColor: "rgba(240, 253, 244, 0.5)", // green-50/50
    transition: { duration: 0.3 }
  },
  invalid: {
    borderColor: "rgb(239, 68, 68)", // red-500
    backgroundColor: "rgba(254, 242, 242, 0.5)", // red-50/50
    x: [-1, 1, -1, 1, 0], // Gentle shake animation
    transition: { duration: 0.5 }
  }
};

const labelVariants = {
  idle: {
    y: 0,
    scale: 1,
    color: "rgb(107, 114, 128)", // gray-500 - better positioning
    transition: { duration: 0.2 }
  },
  focus: {
    y: -28, // More space to prevent cutoff
    scale: 0.82,
    color: "rgb(59, 130, 246)", // blue-500
    transition: { duration: 0.2 }
  },
  filled: {
    y: -28, // Consistent positioning
    scale: 0.82,
    color: "rgb(107, 114, 128)", // gray-500
    transition: { duration: 0.2 }
  }
};

const AnimatedInput = forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ label, error, icon, showPasswordToggle, validationState = 'idle', className, type = 'text', value, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [internalValue, setInternalValue] = useState(value || '');
    const [hasAutofill, setHasAutofill] = useState(false);

    const inputType = showPasswordToggle && !showPassword ? 'password' : showPasswordToggle && showPassword ? 'text' : type;
    const hasValue = Boolean(value || internalValue);
    
    // Handle browser autofill detection
    useEffect(() => {
      const checkAutofill = () => {
        const input = document.querySelector(`input[name="${props.name}"]`) as HTMLInputElement;
        if (input && input.matches(':-webkit-autofill')) {
          setHasAutofill(true);
        }
      };
      
      // Check periodically for autofill
      const interval = setInterval(checkAutofill, 100);
      setTimeout(() => clearInterval(interval), 2000);
      
      return () => clearInterval(interval);
    }, [props.name]);

    const getInputState = () => {
      if (validationState === 'valid') return 'valid';
      if (validationState === 'invalid') return 'invalid';
      if (isFocused) return 'focus';
      return 'idle';
    };

    const getLabelState = () => {
      if (isFocused || hasValue || hasAutofill) return 'focus';
      return 'idle';
    };

    return (
      <div className="relative mb-1">
        <motion.div 
          className="relative"
          variants={inputVariants}
          animate={getInputState()}
        >
          {/* Floating Label */}
          {label && (
            <motion.label
              className={cn(
                "absolute pointer-events-none origin-left z-20 text-sm font-medium px-2 bg-white rounded",
                "select-none", // Prevent text selection
                icon ? "left-8" : "left-2",
                "top-3.5" // Better initial positioning - slightly above center
              )}
              variants={labelVariants}
              animate={getLabelState()}
              style={{
                color: 'inherit',
                transformOrigin: 'left center'
              }}
            >
              {label}
            </motion.label>
          )}

          {/* Icon */}
          {icon && (
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors z-10 pointer-events-none">
              {icon}
            </div>
          )}

          {/* Input */}
          <input
            ref={ref}
            type={inputType}
            value={value}
            className={cn(
              "w-full border rounded-xl outline-none transition-all duration-200 h-14 text-sm bg-transparent",
              "placeholder-transparent peer relative z-10",
              // Proper padding to prevent field content cutoff and center text vertically
              icon ? "pl-12 pr-4" : "pl-4 pr-4",
              showPasswordToggle ? "pr-12" : "",
              // Always center the text vertically, adjust top padding when label is floating
              hasValue || isFocused || hasAutofill ? "pt-6 pb-2" : "py-4",
              // Handle autofill styling
              "autofill:bg-blue-50 autofill:text-blue-900",
              className
            )}
            placeholder=""
            autoComplete={props.autoComplete || "off"}
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
            onAnimationStart={(e) => {
              // Detect autofill animation
              if (e.animationName === 'onAutoFillStart') {
                setHasAutofill(true);
              }
            }}
            {...props}
            style={{
              ...props.style,
              // Ensure field content doesn't get cut off and text is centered
              clipPath: 'none',
              overflow: 'visible',
              // Better text vertical alignment
              verticalAlign: 'middle',
              textAlign: 'left',
            }}
          />

          {/* Password Toggle */}
          {showPasswordToggle && (
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors z-20"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1} // Don't include in tab order
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
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              index < strength ? strengthColors[strength - 1] : "bg-gray-200"
            )}
          />
        ))}
      </div>
      <div className="text-xs text-gray-500">
        Password strength: <span className={cn(
          "font-medium",
          strength <= 1 ? "text-red-500" :
          strength <= 2 ? "text-orange-500" :
          strength <= 3 ? "text-yellow-500" :
          strength <= 4 ? "text-blue-500" : "text-green-500"
        )}>{strengthLabels[strength] || strengthLabels[0]}</span>
      </div>
    </motion.div>
  );
}

export default AnimatedInput; 