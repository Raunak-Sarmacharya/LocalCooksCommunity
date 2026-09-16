import type { ReactNode } from "react";

import { Info } from "@/components/ui/manager-icons";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Inline help affordance for a settings row.
 *
 * Explanatory copy lives behind this instead of in the page body, so a row can
 * explain itself without adding a paragraph that every manager reads on every
 * visit.
 */
export function RowHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface SettingsRowProps {
  /** Wires the label to its control for click-to-focus and screen readers. */
  id?: string;
  label: string;
  /** One short line of context. Omit when the label already says it. */
  hint?: string;
  /** Longer explanation, revealed from the ⓘ next to the label. */
  help?: ReactNode;
  /**
   * `inline` — label left, control right, sized to its own content. Use for
   * short values: numbers, currency, toggles.
   * `stacked` — label above, control below. Use for controls that need real
   * width, such as a multi-line description.
   */
  layout?: "inline" | "stacked";
  className?: string;
  children: ReactNode;
}

/**
 * A single row of a settings card.
 *
 * The field name is the row label, so the control reads as "set this value"
 * rather than as a second column of copy. Rows are separated by the card's own
 * `divide-y`, which is what keeps a multi-field card from needing a heading per
 * field.
 */
export function SettingsRow({
  id,
  label,
  hint,
  help,
  layout = "inline",
  className,
  children,
}: SettingsRowProps) {
  const heading = (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {help ? <RowHelp label={label}>{help}</RowHelp> : null}
      </div>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className={cn("px-4 py-3", className)}>
        {heading}
        <div className="mt-2">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3",
        className,
      )}
    >
      {heading}
      <div className="shrink-0">{children}</div>
    </div>
  );
}
