import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * CurrencyInput — Enterprise-grade currency input following shadcn InputGroup pattern.
 * 
 * Fixes common UX issues with type="number":
 * - No scroll hijacking (mouse wheel won't change values)
 * - No spinner arrows cluttering the UI
 * - Built-in $ prefix with proper visual grouping
 * - inputMode="decimal" for mobile numeric keyboard
 * - Blocks invalid characters (e, +, -, etc.)
 * - Consistent styling with shadcn Input
 */

export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size"> {
  /** Called with the raw string value (e.g. "12.50") */
  onValueChange?: (value: string) => void
  /** Currency symbol to display (default: "$") */
  symbol?: string
  /** Size variant */
  size?: "default" | "sm"
}

const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, onValueChange, symbol = "$", size = "default", ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      // Allow empty, digits, and one decimal point with up to 2 decimal places
      if (raw === "" || /^\d*\.?\d{0,2}$/.test(raw)) {
        onValueChange?.(raw)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Block e, E, +, - which are valid in type="number" but not for currency
      if (["e", "E", "+", "-"].includes(e.key)) {
        e.preventDefault()
      }
    }

    return (
      <div className={cn(
        "flex items-center rounded-md border border-input bg-background ring-offset-background",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        size === "sm" ? "h-8" : "h-10",
        className
      )}>
        <span className={cn(
          "flex items-center justify-center border-r border-input bg-muted text-muted-foreground select-none shrink-0",
          size === "sm" ? "h-full w-7 text-xs px-1.5" : "h-full w-9 text-sm px-2.5"
        )}>
          {symbol}
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex-1 bg-transparent border-0 outline-none placeholder:text-muted-foreground font-mono tabular-nums",
            "focus:outline-none focus:ring-0",
            size === "sm" ? "h-full px-2 text-xs" : "h-full px-3 text-sm"
          )}
          {...props}
        />
      </div>
    )
  }
)
CurrencyInput.displayName = "CurrencyInput"

export { CurrencyInput }
