import * as React from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Radix SelectItem rejects value=""; map empty options through this sentinel. */
const EMPTY = "__empty__";

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "defaultValue" | "size"> & {
  value?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
};

function readOption(child: React.ReactNode): { value: string; label: React.ReactNode; disabled?: boolean } | null {
  if (!React.isValidElement(child) || child.type !== "option") return null;
  const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
  return { value: props.value == null ? "" : String(props.value), label: props.children, disabled: props.disabled };
}

/** Drop-in replacement for a native <select> that renders the house Radix Select. Callers keep option children and onChange. */
export function NativeSelect({ className, children, id, value, disabled, onChange, "aria-label": ariaLabel, required, name }: Props) {
  const options = React.Children.toArray(children).map(readOption).filter((item): item is NonNullable<typeof item> => !!item);
  const raw = value == null ? "" : String(value);
  return (
    <Select
      value={raw === "" ? EMPTY : raw}
      disabled={disabled}
      required={required}
      onValueChange={(next) => {
        const mapped = next === EMPTY ? "" : next;
        onChange?.({ target: { value: mapped, name: name ?? "", id: id ?? "" } } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn(className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt, index) => (
          <SelectItem key={`${opt.value}-${index}`} value={opt.value === "" ? EMPTY : opt.value} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
NativeSelect.displayName = "NativeSelect";
