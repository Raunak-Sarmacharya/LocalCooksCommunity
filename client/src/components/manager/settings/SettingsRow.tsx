import type { ReactNode } from "react";

import { Info, Lock } from "@/components/ui/manager-icons";
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
  /**
   * Marks the row with the `*` the page's FormLegend explains. Communication
   * only — the caller still owns enforcing it.
   */
  required?: boolean;
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
  /**
   * Why this setting cannot be edited right now. Passing this dims the whole
   * row and shows the reason in place of the hint, so a control that is
   * deliberately inert never reads as broken.
   */
  disabledReason?: string;
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
 *
 * When `disabledReason` is set the row dims its control and swaps the hint for
 * the reason. Callers are responsible for actually disabling the control —
 * this only communicates why.
 */
export function SettingsRow({
  id,
  label,
  required = false,
  hint,
  help,
  layout = "inline",
  disabledReason,
  className,
  children,
}: SettingsRowProps) {
  const locked = Boolean(disabledReason);

  const heading = (
    // `flex-1` matters: with `flex-wrap`, a long hint would otherwise give the
    // heading a max-content basis, push the control onto a second line, and
    // `justify-between` would then park that control on the *left*.
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <Label
          htmlFor={id}
          className={cn("text-sm font-medium", locked && "text-muted-foreground")}
        >
          {label}
        </Label>
        {required ? (
          <span aria-hidden className="text-sm text-destructive">
            *
          </span>
        ) : null}
        {help ? <RowHelp label={label}>{help}</RowHelp> : null}
      </div>
      {locked ? (
        <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" />
          {disabledReason}
        </p>
      ) : hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className={cn("px-4 py-3", locked && "opacity-60", className)}>
        {heading}
        <div className="mt-2">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3",
        locked && "opacity-60",
        className,
      )}
    >
      {heading}
      <div className="shrink-0">{children}</div>
    </div>
  );
}
