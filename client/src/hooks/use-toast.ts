/**
 * Unified Toast Hook - Sonner-backed Implementation
 * 
 * This module provides backward compatibility with the old Radix-based toast API
 * while delegating all toast rendering to Sonner for a unified, modern UX.
 * 
 * Supports BOTH APIs:
 *   // Old API (backward compatible):
 *   toast({ title: "Success", description: "..." });
 *   toast({ title: "Error", description: "...", variant: "destructive" });
 * 
 *   // New Sonner-style API:
 *   toast.success("Success", { description: "..." });
 *   toast.error("Error", { description: "..." });
 * 
 * Under the hood, all are rendered via Sonner with proper semantic types.
 */

import { toast as sonnerToast } from "sonner";
import type { ReactNode } from "react";

interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
  action?: ReactNode;
}

interface SonnerOptions {
  description?: ReactNode;
  duration?: number;
  action?: ReactNode;
}

interface ToastReturn {
  id: string | number;
  dismiss: () => void;
  update: (options: ToastOptions) => void;
}

/**
 * Helper to create toast return object
 */
function createToastReturn(toastId: string | number): ToastReturn {
  return {
    id: toastId,
    dismiss: () => sonnerToast.dismiss(toastId),
    update: (newOptions: ToastOptions) => {
      sonnerToast.dismiss(toastId);
      toast(newOptions);
    },
  };
}

/**
 * Unified toast function that delegates to Sonner
 * Maintains backward compatibility with the old API
 */
function toastBase(options: ToastOptions): ToastReturn {
  const { title, description, variant, duration, action } = options;
  
  // Convert title to string for Sonner (it expects string as first param)
  const titleStr = typeof title === "string" ? title : String(title || "");
  
  // Build Sonner options
  const sonnerOptions: SonnerOptions = {
    description,
    duration,
    action,
  };
  
  let toastId: string | number;
  
  // Route to appropriate Sonner method based on variant
  if (variant === "destructive") {
    toastId = sonnerToast.error(titleStr, sonnerOptions);
  } else if (titleStr.toLowerCase().includes("success") || 
             titleStr.toLowerCase().includes("saved") ||
             titleStr.toLowerCase().includes("created") ||
             titleStr.toLowerCase().includes("updated") ||
             titleStr.toLowerCase().includes("deleted") ||
             titleStr.toLowerCase().includes("complete")) {
    toastId = sonnerToast.success(titleStr, sonnerOptions);
  } else if (titleStr.toLowerCase().includes("error") ||
             titleStr.toLowerCase().includes("failed") ||
             titleStr.toLowerCase().includes("invalid")) {
    toastId = sonnerToast.error(titleStr, sonnerOptions);
  } else if (titleStr.toLowerCase().includes("warning") ||
             titleStr.toLowerCase().includes("caution")) {
    toastId = sonnerToast.warning(titleStr, sonnerOptions);
  } else if (titleStr.toLowerCase().includes("info") ||
             titleStr.toLowerCase().includes("note")) {
    toastId = sonnerToast.info(titleStr, sonnerOptions);
  } else {
    // Default toast
    toastId = sonnerToast(titleStr, sonnerOptions);
  }
  
  return createToastReturn(toastId);
}

/**
 * Extended toast function with Sonner-style methods attached
 * Supports both old API and new Sonner-style API
 */
interface ToastFunction {
  (options: ToastOptions): ToastReturn;
  success: (title: string, options?: SonnerOptions) => ToastReturn;
  error: (title: string, options?: SonnerOptions) => ToastReturn;
  warning: (title: string, options?: SonnerOptions) => ToastReturn;
  info: (title: string, options?: SonnerOptions) => ToastReturn;
  loading: (title: string, options?: SonnerOptions) => ToastReturn;
  dismiss: (toastId?: string | number) => void;
  promise: typeof sonnerToast.promise;
}

const toast: ToastFunction = Object.assign(toastBase, {
  success: (title: string, options?: SonnerOptions): ToastReturn => {
    const toastId = sonnerToast.success(title, options);
    return createToastReturn(toastId);
  },
  error: (title: string, options?: SonnerOptions): ToastReturn => {
    const toastId = sonnerToast.error(title, options);
    return createToastReturn(toastId);
  },
  warning: (title: string, options?: SonnerOptions): ToastReturn => {
    const toastId = sonnerToast.warning(title, options);
    return createToastReturn(toastId);
  },
  info: (title: string, options?: SonnerOptions): ToastReturn => {
    const toastId = sonnerToast.info(title, options);
    return createToastReturn(toastId);
  },
  loading: (title: string, options?: SonnerOptions): ToastReturn => {
    const toastId = sonnerToast.loading(title, options);
    return createToastReturn(toastId);
  },
  dismiss: (toastId?: string | number) => {
    if (toastId) {
      sonnerToast.dismiss(toastId);
    } else {
      sonnerToast.dismiss();
    }
  },
  promise: sonnerToast.promise,
});

/**
 * useToast hook - provides toast function with backward compatibility
 * The state management is now handled by Sonner internally
 */
function useToast() {
  return {
    toast,
    dismiss: (toastId?: string | number) => {
      if (toastId) {
        sonnerToast.dismiss(toastId);
      } else {
        sonnerToast.dismiss();
      }
    },
    // Empty toasts array for backward compatibility - Sonner manages its own state
    toasts: [] as const,
  };
}

export { useToast, toast };
