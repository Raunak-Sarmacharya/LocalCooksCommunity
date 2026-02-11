import { useState, useCallback, useRef, useEffect } from "react";
import type { ButtonStatus } from "@/components/ui/status-button";

interface UseStatusButtonOptions {
  /** ms to show the success state before resetting (default 2000) */
  successDuration?: number;
  /** ms to show the error state before resetting (default 2500) */
  errorDuration?: number;
}

/**
 * Drive a StatusButton from any async function (typically a mutation).
 *
 * @example
 * ```tsx
 * const save = useStatusButton(async () => {
 *   await mutation.mutateAsync(data);
 * });
 *
 * <StatusButton
 *   status={save.status}
 *   onClick={save.execute}
 *   labels={{ idle: "Save", loading: "Saving", success: "Saved" }}
 * />
 * ```
 */
export function useStatusButton(
  asyncFn: () => Promise<void>,
  options: UseStatusButtonOptions = {},
) {
  const { successDuration = 2000, errorDuration = 2500 } = options;
  const [status, setStatus] = useState<ButtonStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const execute = useCallback(async () => {
    if (status !== "idle") return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus("loading");

    try {
      await asyncFn();
      setStatus("success");
      timeoutRef.current = setTimeout(
        () => setStatus("idle"),
        successDuration,
      );
    } catch {
      setStatus("error");
      timeoutRef.current = setTimeout(() => setStatus("idle"), errorDuration);
    }
  }, [asyncFn, status, successDuration, errorDuration]);

  const reset = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus("idle");
  }, []);

  return { status, execute, reset } as const;
}
