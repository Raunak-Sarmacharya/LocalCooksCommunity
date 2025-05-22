import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
// import { Circle } from "lucide-react" // Not needed for a simple circle outline

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <div className="relative inline-flex items-center justify-center">
      <RadioGroupPrimitive.Item
        ref={ref}
        className={cn(
          // Always a small circle
          "h-4 w-4 rounded-full border border-gray-300 bg-white shadow-sm transition-colors duration-200",
          "data-[state=checked]:border-primary data-[state=checked]:ring-2 data-[state=checked]:ring-primary",
          "flex items-center justify-center cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          {/* Minimal filled dot for checked state */}
          <div className="h-2 w-2 rounded-full bg-primary transition-all duration-200 scale-100 data-[state=unchecked]:scale-0" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    </div>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }