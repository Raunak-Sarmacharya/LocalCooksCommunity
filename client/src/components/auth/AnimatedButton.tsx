import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const getVariant = () => {
    if (state === 'success') return 'default';
    if (state === 'error') return 'destructive';
    if (variant === 'google') return 'outline';
    if (variant === 'secondary') return 'secondary';
    return 'default';
  };

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{loadingText}</span>
          </>
        );
      case 'success':
        return (
          <>
            <Check className="w-4 h-4" />
            <span>{successText}</span>
          </>
        );
      case 'error':
        return (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>{errorText}</span>
          </>
        );
      default:
        return children;
    }
  };

  return (
    <Button
      type={type}
      variant={getVariant()}
      className={cn(
        "w-full h-12 text-base font-semibold",
        state === 'success' && "bg-green-500 hover:bg-green-600",
        variant === 'google' && "bg-white border border-gray-200 text-gray-900 shadow-sm hover:bg-gray-50",
        className
      )}
      disabled={disabled || state === 'loading'}
      onClick={onClick}
    >
      {renderContent()}
    </Button>
  );
} 