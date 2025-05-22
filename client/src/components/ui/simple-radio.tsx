import * as React from "react"
import { cn } from "@/lib/utils"

interface SimpleRadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  onValueChange?: (value: string) => void
  defaultValue?: string
}

const SimpleRadioGroup = React.forwardRef<
  HTMLDivElement,
  SimpleRadioGroupProps
>(({ className, children, value, onValueChange, defaultValue, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue || "")
  
  // Sync with external value if provided
  React.useEffect(() => {
    if (value !== undefined) {
      setInternalValue(value)
    }
  }, [value])
  
  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue)
    onValueChange?.(newValue)
  }
  
  // Clone and enhance children with the current value and change handler
  const enhancedChildren = React.Children.map(children, child => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, {
        isSelected: internalValue === (child.props.value || ""),
        onSelect: () => handleValueChange(child.props.value || ""),
      })
    }
    return child
  })
  
  return (
    <div 
      ref={ref} 
      className={cn("grid gap-2", className)}
      {...props}
    >
      {enhancedChildren}
    </div>
  )
})
SimpleRadioGroup.displayName = "SimpleRadioGroup"

interface SimpleRadioItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  id?: string
  isSelected?: boolean
  onSelect?: () => void
}

const SimpleRadioItem = React.forwardRef<
  HTMLDivElement,
  SimpleRadioItemProps
>(({ className, children, value, id, isSelected, onSelect, ...props }, ref) => {
  return (
    <div 
      ref={ref}
      className={cn("inline-flex items-center", className)}
      onClick={onSelect}
      {...props}
    >
      <div 
        className={cn(
          "relative w-4 h-4 rounded-full border-2 border-gray-300 mr-2",
          isSelected && "border-primary",
        )}
      >
        {isSelected && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary" />
        )}
      </div>
      <label htmlFor={id} className="cursor-pointer">{children}</label>
    </div>
  )
})
SimpleRadioItem.displayName = "SimpleRadioItem"

export { SimpleRadioGroup, SimpleRadioItem }