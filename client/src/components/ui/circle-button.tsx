import React from "react";

interface RadioOption {
  value: string;
  content: React.ReactNode;
}

interface CircleRadioProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
}

export function CircleRadioButtons({ options, value, onChange }: CircleRadioProps) {
  return (
    <div className="space-y-3">
      {options.map((option) => (
        <div 
          key={option.value}
          className="flex items-center cursor-pointer" 
          onClick={() => onChange(option.value)}
        >
          <div className="flex-shrink-0 relative">
            <div className={`h-4 w-4 rounded-full border-2 ${value === option.value ? 'border-primary' : 'border-gray-300'}`}>
              {value === option.value && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
              )}
            </div>
          </div>
          <div className="ml-3">{option.content}</div>
        </div>
      ))}
    </div>
  );
}