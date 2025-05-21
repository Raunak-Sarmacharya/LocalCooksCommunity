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
    // The relative inline-flex div around it is fine if you need it for layout
    <div className="relative inline-flex items-center justify-center">
      <RadioGroupPrimitive.Item
        ref={ref}
        className={cn(
          // **Here are the key changes for the simple red outline**
          "h-1 w-5 rounded-full border-2 border-red-500", // Make it a circle, 2px red border
          "data-[state=checked]:bg-red-500", // Fill with red when checked
          "disabled:cursor-not-allowed disabled:opacity-50", // Keep disabled styles
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2", // Red focus ring for accessibility
          className // Allows external classes to be merged
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          {/* Inner dot will be white when the item is checked */}
          <div className="h-2.5 w-2.5 rounded-full bg-white" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    </div>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }