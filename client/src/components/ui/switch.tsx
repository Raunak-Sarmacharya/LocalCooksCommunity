import * as React from "react";
import "./switch.css";

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, id, className }, ref) => {
    const uniqueId = id || React.useId();

    return (
      <div className={`switch-parent ${className || ""}`}>
        <input
          type="checkbox"
          className="switch-checkbox"
          id={uniqueId}
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          disabled={disabled}
          ref={ref}
        />
        <label className="switch-label" htmlFor={uniqueId}>
          <span className="switch-slider" />
        </label>
      </div>
    );
  }
);

Switch.displayName = "Switch";

export { Switch };
