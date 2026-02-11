import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";
import { forwardRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ButtonStatus = "idle" | "loading" | "success" | "error";

interface StatusButtonProps extends Omit<ButtonProps, "children"> {
  /** Current status of the button — controls animation state */
  status: ButtonStatus;
  /** Custom labels for each state. Falls back to sensible defaults. */
  labels?: {
    idle: string;
    loading?: string;
    success?: string;
    error?: string;
  };
  children?: React.ReactNode;
  /** Show the animated text‑morphing effect (default: true) */
  animate?: boolean;
}

// ---------------------------------------------------------------------------
// StatusButton Component
// ---------------------------------------------------------------------------

export const StatusButton = forwardRef<HTMLButtonElement, StatusButtonProps>(
  (
    {
      status,
      labels,
      children,
      className,
      disabled,
      animate = true,
      variant,
      size,
      ...props
    },
    ref,
  ) => {
    const idleLabel =
      labels?.idle ?? (typeof children === "string" ? children : "Submit");

    const text = (() => {
      switch (status) {
        case "idle":
          return idleLabel;
        case "loading":
          return labels?.loading ?? `${idleLabel}…`;
        case "success":
          return labels?.success ?? "Done";
        case "error":
          return labels?.error ?? "Failed";
      }
    })();

    const isActive = status !== "idle";

    return (
      <div className="relative inline-flex">
        <Button
          ref={ref}
          variant={variant}
          size={size}
          className={cn(
            "relative transition-all duration-300 disabled:opacity-100",
            isActive &&
              "bg-muted text-muted-foreground hover:bg-muted cursor-not-allowed border-muted shadow-sm",
            className,
          )}
          disabled={disabled || isActive}
          {...props}
        >
          {animate ? (
            <span className="flex items-center justify-center">
              <AnimatePresence mode="popLayout" initial={false}>
                {text.split("").map((char, i) => (
                  <motion.span
                    key={`${char}-${i}-${status}`}
                    layout
                    initial={{ opacity: 0, scale: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0, filter: "blur(4px)" }}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 30,
                      mass: 1,
                    }}
                    className="inline-block"
                  >
                    {char === " " ? "\u00A0" : char}
                  </motion.span>
                ))}
              </AnimatePresence>
            </span>
          ) : (
            <span>{text}</span>
          )}
        </Button>

        {/* Floating status indicator badge */}
        <div className="absolute -top-1 -right-1 z-10 pointer-events-none">
          <AnimatePresence mode="wait">
            {isActive && (
              <motion.div
                initial={{
                  opacity: 0,
                  scale: 0,
                  x: -8,
                  filter: "blur(4px)",
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  x: 0,
                  filter: "blur(0px)",
                }}
                exit={{
                  opacity: 0,
                  scale: 0,
                  x: -8,
                  filter: "blur(4px)",
                }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={cn(
                  "flex items-center justify-center size-5 rounded-full ring-2",
                  status === "loading" &&
                    "bg-muted text-muted-foreground ring-background",
                  status === "success" &&
                    "bg-primary text-primary-foreground ring-background",
                  status === "error" &&
                    "bg-destructive text-destructive-foreground ring-background",
                )}
              >
                <AnimatePresence mode="popLayout">
                  {status === "loading" && (
                    <motion.div
                      key="loader"
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                      >
                        <path
                          fill="currentColor"
                          d="M12 2A10 10 0 1 0 22 12A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8A8 8 0 0 1 12 20Z"
                          opacity=".5"
                        />
                        <path
                          fill="currentColor"
                          d="M20 12h2A10 10 0 0 0 12 2V4A8 8 0 0 1 20 12Z"
                        >
                          <animateTransform
                            attributeName="transform"
                            dur="1s"
                            from="0 12 12"
                            repeatCount="indefinite"
                            to="360 12 12"
                            type="rotate"
                          />
                        </path>
                      </svg>
                    </motion.div>
                  )}

                  {status === "success" && (
                    <motion.div
                      key="check"
                      initial={{
                        scale: 0,
                        opacity: 0,
                        filter: "blur(4px)",
                      }}
                      animate={{
                        scale: 1,
                        opacity: 1,
                        filter: "blur(0px)",
                      }}
                      exit={{
                        scale: 0,
                        opacity: 0,
                        filter: "blur(4px)",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 25,
                      }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <Check className="size-3" />
                    </motion.div>
                  )}

                  {status === "error" && (
                    <motion.div
                      key="error"
                      initial={{
                        scale: 0,
                        opacity: 0,
                        filter: "blur(4px)",
                      }}
                      animate={{
                        scale: 1,
                        opacity: 1,
                        filter: "blur(0px)",
                      }}
                      exit={{
                        scale: 0,
                        opacity: 0,
                        filter: "blur(4px)",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 25,
                      }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <X className="size-3" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  },
);

StatusButton.displayName = "StatusButton";

