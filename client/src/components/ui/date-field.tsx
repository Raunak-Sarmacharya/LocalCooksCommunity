import * as React from "react";
import { format } from "date-fns";

import { Calendar as CalendarIcon } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The single-date picker for the whole app: a bordered trigger showing the
 * chosen day, opening the shared shadcn `Calendar`.
 *
 * This exists because the popover + `Calendar` block had been copy-pasted
 * inline in ten files, while a handful of other surfaces still fell back to a
 * native `<input type="date">` — whose browser-chrome calendar looks nothing
 * like the rest of the product and differs per browser. One component means a
 * date field looks and behaves the same wherever it appears.
 *
 * Values are the `yyyy-MM-dd` strings the API stores.
 */

/**
 * Parses to **local** midnight. `new Date("2026-01-05")` is parsed as UTC, which
 * renders as the previous day in any negative-offset timezone — including
 * Newfoundland, where this product operates.
 */
function parse(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

export interface DateFieldProps {
  id?: string;
  /** `yyyy-MM-dd`, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Shown on the trigger while no date is chosen. */
  placeholder: string;
  /** Block days before today. Default true — the common case is an expiry. */
  minToday?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DateField({
  id,
  value,
  onChange,
  placeholder,
  minToday = true,
  disabled,
  className,
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parse(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("w-full sm:w-auto sm:min-w-[240px] justify-center font-normal px-4", className)}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {selected ? format(selected, "PPP") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          disabled={minToday ? (date) => date < new Date(new Date().setHours(0, 0, 0, 0)) : undefined}
          initialFocus
          className="w-[280px] p-3"
        />
      </PopoverContent>
    </Popover>
  );
}

export default DateField;
