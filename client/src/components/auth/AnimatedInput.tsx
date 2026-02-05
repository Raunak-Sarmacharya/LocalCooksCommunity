import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

interface AnimatedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onDrag'> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  showPasswordToggle?: boolean;
  validationState?: 'idle' | 'valid' | 'invalid';
}

const AnimatedInput = forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ label, error, icon, showPasswordToggle, validationState = 'idle', className, type = 'text', value, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const [internalValue, setInternalValue] = useState(value || '');

    const inputType = showPasswordToggle && !showPassword ? 'password' : showPasswordToggle && showPassword ? 'text' : type;
    const hasValue = Boolean(value || internalValue);

    return (
      <div className="space-y-2">
        {/* Label */}
        {label && (
          <Label 
            htmlFor={props.id || props.name}
            className={cn(
              "text-sm font-medium",
              validationState === 'invalid' && "text-destructive",
              validationState === 'valid' && "text-green-600"
            )}
          >
            {label}
          </Label>
        )}

        {/* Input Container */}
        <div className="relative">
          {/* Icon */}
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
              {icon}
            </div>
          )}

          {/* Input */}
          <Input
            ref={ref}
            type={inputType}
            value={value}
            className={cn(
              "h-12",
              icon && "pl-10",
              showPasswordToggle && "pr-10",
              validationState === 'invalid' && "border-destructive focus-visible:ring-destructive",
              validationState === 'valid' && "border-green-500 focus-visible:ring-green-500",
              className
            )}
            onChange={(e) => {
              setInternalValue(e.target.value);
              props.onChange?.(e);
            }}
            {...props}
          />

          {/* Password Toggle */}
          {showPasswordToggle && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-sm text-destructive">
            {error}
          </p>
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
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              index < strength ? strengthColors[strength - 1] : "bg-muted"
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Password strength: <span className={cn(
          "font-medium",
          strength <= 1 ? "text-red-500" :
          strength <= 2 ? "text-orange-500" :
          strength <= 3 ? "text-yellow-500" :
          strength <= 4 ? "text-blue-500" : "text-green-500"
        )}>{strengthLabels[strength] || strengthLabels[0]}</span>
      </p>
    </div>
  );
}

export default AnimatedInput; 