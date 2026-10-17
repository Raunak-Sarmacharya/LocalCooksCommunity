import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * The single time picker for the whole app: a house `Select` of clock times,
 * labelled by the same `formatTime` every other screen uses.
 *
 * This exists because the app still had native `<input type="time">` controls
 * whose browser chrome (and per-browser 12/24-hour behaviour) looked nothing
 * like the rest of the product. Values are the `HH:mm` strings the API stores;
 * "" means unset, which shows the placeholder.
 */

/** `HH:mm` → minutes since midnight. Anything malformed is ignored. */
function toMinutes(time?: string): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Every `stepMinutes` across the day, bounded by `min`/`max`.
 *
 * A value that is off the grid (say 09:07 saved before a step changed) is
 * appended so opening the menu never silently drops the stored time.
 */
export function timeOptions(stepMinutes = 30, min?: string, max?: string, value = ""): string[] {
  const step = Math.max(1, Math.floor(stepMinutes));
  const lowest = toMinutes(min);
  const highest = toMinutes(max);
  const options: string[] = [];
  for (let at = 0; at < 24 * 60; at += step) {
    if (lowest !== null && at < lowest) continue;
    if (highest !== null && at > highest) continue;
    options.push(fromMinutes(at));
  }
  if (value && !options.includes(value)) options.push(value);
  return options.sort();
}

export interface TimeSelectProps {
  id?: string;
  /** `HH:mm`, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Gap between options. 30 by default; use 5 for recorded arrival/departure times. */
  stepMinutes?: number;
  /** Earliest offered time (`HH:mm`, inclusive). */
  min?: string;
  /** Latest offered time (`HH:mm`, inclusive). */
  max?: string;
  disabled?: boolean;
  /** Shown on the trigger while no time is chosen. */
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}

export function TimeSelect({
  id,
  value,
  onChange,
  stepMinutes = 30,
  min,
  max,
  disabled,
  // The native datetime-local control showed "--:--" for an unset time; keep the
  // same affordance without inventing a sentence that would need translating.
  placeholder = "--:--",
  "aria-label": ariaLabel,
  className,
}: TimeSelectProps) {
  const options = React.useMemo(
    () => timeOptions(stepMinutes, min, max, value),
    [stepMinutes, min, max, value],
  );

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("min-w-0", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {formatTime(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default TimeSelect;
