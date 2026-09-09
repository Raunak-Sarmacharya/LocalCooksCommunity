import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "@iconify/react";
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
            <Icon icon="mdi:loading" className="h-4 w-4 animate-spin" aria-hidden />
            <span>{loadingText}</span>
          </>
        );
      case 'success':
        return (
          <>
            <Icon icon="mdi:check" className="h-4 w-4" aria-hidden />
            <span>{successText}</span>
          </>
        );
      case 'error':
        return (
          <>
            <Icon icon="mdi:alert-circle-outline" className="h-4 w-4" aria-hidden />
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
        "w-full h-12 rounded-full text-base font-semibold transition-all duration-300",
        variant === 'primary' && state === 'idle' && "bg-[#F51042] text-white shadow-lg hover:bg-[#D90E3A] hover:shadow-xl",
        state === 'success' && "bg-green-500 hover:bg-green-600",
        variant === 'google' && "bg-white border border-gray-200 text-gray-900 shadow-sm hover:bg-gray-50 hover:shadow-md",
        className
      )}
      disabled={disabled || state === 'loading'}
      onClick={onClick}
    >
      {renderContent()}
    </Button>
  );
}
