import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { cn } from "@/lib/utils"

const CustomRadioGroup = React.forwardRef<
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
CustomRadioGroup.displayName = "CustomRadioGroup"

const CustomRadioItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <div className="inline-flex items-center justify-center">
      <RadioGroupPrimitive.Item
        ref={ref}
        className={cn(
          // Simplified pure circle with fixed dimensions
          "appearance-none m-0 outline-none border-0",
          "w-4 h-4 rounded-full border-2 border-gray-300 bg-white",
          "data-[state=checked]:border-primary data-[state=checked]:bg-white",
          "data-[state=checked]:ring-0",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      <div 
        className={cn(
          "absolute pointer-events-none w-2 h-2 rounded-full bg-primary transform scale-0",
          // Show inner dot only when checked
          "data-[state=checked]:scale-100",
        )}
        aria-hidden="true"
        data-state={props.checked ? "checked" : "unchecked"}
      />
    </div>
  )
})
CustomRadioItem.displayName = "CustomRadioItem"

export { CustomRadioGroup, CustomRadioItem }