import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * NumericInput — Enterprise-grade numeric input following shadcn patterns.
 * 
 * Fixes common UX issues with type="number":
 * - No scroll hijacking (mouse wheel won't change values)
 * - No spinner arrows cluttering the UI
 * - inputMode="numeric" or "decimal" for mobile numeric keyboard
 * - Blocks invalid characters (e, +, -, etc.)
 * - Optional suffix label (e.g. "hours", "days", "%")
 * - Consistent styling with shadcn Input
 */

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  /** Called with the raw string value */
  onValueChange?: (value: string) => void
  /** Allow decimal values (default: false — integers only) */
  allowDecimals?: boolean
  /** Suffix label displayed inside the input (e.g. "hours", "days", "%") */
  suffix?: string
}

const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ className, onValueChange, allowDecimals = false, suffix, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      if (raw === "") {
        onValueChange?.(raw)
        return
      }
      if (allowDecimals) {
        if (/^\d*\.?\d{0,2}$/.test(raw)) {
          onValueChange?.(raw)
        }
      } else {
        if (/^\d*$/.test(raw)) {
          onValueChange?.(raw)
        }
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (["e", "E", "+", "-"].includes(e.key)) {
        e.preventDefault()
      }
      if (!allowDecimals && e.key === ".") {
        e.preventDefault()
      }
    }

    if (suffix) {
      return (
        <div className={cn(
          "flex items-center h-10 rounded-md border border-input bg-background ring-offset-background",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
          className
        )}>
          <input
            ref={ref}
            type="text"
            inputMode={allowDecimals ? "decimal" : "numeric"}
            autoComplete="off"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="flex-1 h-full bg-transparent border-0 outline-none px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-0 tabular-nums"
            {...props}
          />
          <span className="flex items-center justify-center border-l border-input bg-muted text-muted-foreground text-xs select-none shrink-0 h-full px-2.5">
            {suffix}
          </span>
        </div>
      )
    }

    return (
      <input
        ref={ref}
        type="text"
        inputMode={allowDecimals ? "decimal" : "numeric"}
        autoComplete="off"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 tabular-nums",
          className
        )}
        {...props}
      />
    )
  }
)
NumericInput.displayName = "NumericInput"

export { NumericInput }
