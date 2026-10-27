import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

/** Pill choices: one (radio) or any (toggle buttons). Arrow keys aren't wired; each pill is its own tab stop. */
export function ChoicePills<T extends string>({ label, options, value, onChange, className }: {
  label: string; options: Option<T>[]; className?: string;
} & ({ value: T | undefined; onChange: (value: T) => void } | { value: T[]; onChange: (value: T[]) => void })) {
  const multiple = Array.isArray(value);
  const on = (option: T) => (multiple ? (value as T[]).includes(option) : value === option);
  const pick = (option: T) => multiple
    ? (onChange as (value: T[]) => void)(on(option) ? (value as T[]).filter((v) => v !== option) : [...(value as T[]), option])
    : (onChange as (value: T) => void)(option);
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role={multiple ? undefined : "radio"}
          aria-checked={multiple ? undefined : on(option.value)}
          aria-pressed={multiple ? on(option.value) : undefined}
          onClick={() => pick(option.value)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full bg-background px-4 text-sm transition-shadow",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            on(option.value) ? "font-semibold shadow-[inset_0_0_0_2px_hsl(var(--foreground))]" : "shadow-[inset_0_0_0_1px_hsl(var(--input))] hover:shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.5)]",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
