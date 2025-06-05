import React from "react";

interface CircleRadioGroupProps {
  defaultValue?: string;
  value?: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function CircleRadioGroup({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: CircleRadioGroupProps) {
  const [selectedValue, setSelectedValue] = React.useState(defaultValue || value || "");

  React.useEffect(() => {
    if (value !== undefined) {
      setSelectedValue(value);
    }
  }, [value]);

  const handleChange = (newValue: string) => {
    setSelectedValue(newValue);
    onValueChange(newValue);
  };

  // Clone children with selected state
  const enhancedChildren = React.Children.map(children, child => {
    if (React.isValidElement(child) && child.type === CircleRadioItem) {
      return React.cloneElement(child as React.ReactElement<CircleRadioItemProps>, {
        selected: selectedValue === child.props.value,
        onClick: () => handleChange(child.props.value),
      });
    }
    return child;
  });

  return (
    <div className={className}>
      {enhancedChildren}
    </div>
  );
}

interface CircleRadioItemProps {
  value: string;
  id?: string;
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export function CircleRadioItem({ value, id, selected, onClick, children }: CircleRadioItemProps) {
  return (
    <div className="relative cursor-pointer" onClick={onClick}>
      <div className="flex items-center space-x-3 py-2">
        <div className="inline-block relative">
          {/* Outer circle */}
          <div className={`w-4 h-4 rounded-full border-2 ${selected ? 'border-primary' : 'border-gray-300'}`}>
            {/* Inner dot - only shown when selected */}
            {selected && <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"></div>}
          </div>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}