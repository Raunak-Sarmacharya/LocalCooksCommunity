import React from "react";

// Radio group and item components for pure circle radio buttons
export function PureRadioGroup({
  defaultValue = "",
  onValueChange,
  children,
  className = "",
}: {
  defaultValue?: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    onValueChange(newValue);
  };

  return (
    <div className={className}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        
        return React.cloneElement(child as React.ReactElement<any>, {
          checked: value === child.props.value,
          onChange: () => handleChange(child.props.value)
        });
      })}
    </div>
  );
}

export function PureRadioItem({
  value,
  checked,
  onChange,
  children
}: {
  value: string;
  checked?: boolean;
  onChange?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div 
      className="flex items-start"
      onClick={() => onChange && onChange()}
    >
      <div className="flex-shrink-0 mt-0.5">
        <div className={`
          w-4 h-4 rounded-full border-2 relative cursor-pointer
          ${checked ? 'border-primary' : 'border-gray-300'}
        `}>
          {checked && (
            <div className="absolute inset-0 m-auto w-[6px] h-[6px] rounded-full bg-primary" />
          )}
        </div>
      </div>
      <div className="ml-3 cursor-pointer">{children}</div>
    </div>
  );
}