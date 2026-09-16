import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { forwardRef, useState } from "react";

interface AnimatedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onDrag'> {
  label?: string;
  /** Optional element rendered right-aligned on the same line as the label (e.g. "Forgot password?"). */
  labelRight?: React.ReactNode;
  error?: string;
  icon?: React.ReactNode;
  showPasswordToggle?: boolean;
  /** Strength meter is for set/reset password only — never for sign-in. */
  showPasswordStrength?: boolean;
  validationState?: 'idle' | 'valid' | 'invalid';
}

const AnimatedInput = forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ label, labelRight, error, icon, showPasswordToggle, showPasswordStrength = false, validationState = 'idle', className, type = 'text', value, onChange, ...props }, ref) => {
    const [internalValue, setInternalValue] = useState(value || '');

    const hasValue = Boolean(value || internalValue);
    const fieldClassName = cn(
      "h-12",
      icon && "pl-10",
      validationState === 'invalid' && "border-destructive focus-visible:ring-destructive",
      className
    );
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInternalValue(e.target.value);
      onChange?.(e);
    };

    return (
      <div className="space-y-2">
        {(label || labelRight) && (
          <div className="flex items-baseline justify-between gap-2">
            {label && (
              <Label 
                htmlFor={props.id || props.name}
                className={cn(
                  "text-sm font-medium",
                  validationState === 'invalid' && "text-destructive"
                )}
              >
                {label}
                {props.required && (
                  <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                )}
              </Label>
            )}
            {labelRight && <div className="flex-shrink-0">{labelRight}</div>}
          </div>
        )}

        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground pointer-events-none">
              {icon}
            </div>
          )}

          {showPasswordToggle ? (
            <PasswordInput
              ref={ref}
              id={props.id || props.name}
              value={value}
              className={fieldClassName}
              onChange={handleChange}
              {...props}
            />
          ) : (
            <Input
              ref={ref}
              id={props.id || props.name}
              type={type}
              value={value}
              className={fieldClassName}
              onChange={handleChange}
              {...props}
            />
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">
            {error}
          </p>
        )}

        {showPasswordStrength && hasValue && (
          <PasswordStrengthIndicator password={String(value || internalValue)} />
        )}
      </div>
    );
  }
);

AnimatedInput.displayName = "AnimatedInput";

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
  const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-indigo-600'];

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
          strength <= 4 ? "text-blue-500" : "text-indigo-600"
        )}>{strengthLabels[strength] || strengthLabels[0]}</span>
      </p>
    </div>
  );
}

export default AnimatedInput;
