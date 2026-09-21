import type { ReactNode } from "react";

import { AlertTriangle, Info, Lock } from "@/components/ui/manager-icons";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Inline help affordance for a settings row.
 *
 * Explanatory copy lives behind this instead of in the page body, so a row can
 * explain itself without adding a paragraph that every manager reads on every
 * visit.
 *
 * `compact` shrinks it to sit beside a small field label — the default 28px hit
 * target is right for a full-width settings row but would set the height of a
 * dense inline form.
 */
export function RowHelp({
  label,
  children,
  compact,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "!min-h-0 !min-w-0 inline-flex items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "h-4 w-4" : "h-7 w-7",
          )}
        >
          <Info className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The full-width message beneath a row.
 *
 * `w-full` is what puts it on its own line: the inline row is a `flex-wrap` container, so a
 * full-width child cannot share a line with the label and the control.
 *
 * Both tones are TINTED, never `text-muted-foreground`. The hint above it is already muted, so an
 * advisory in the same grey reads as more subtext and gets skipped — which defeats the point of
 * showing a number the manager has to act on.
 *
 * Both stay in the amber family so a manager reads one kind of message, not two; severity is
 * carried by the shade and the icon instead of by a second hue. The softer tone is the readout,
 * the deeper tone plus the icon is the one to fix.
 *
 * The `dark:` halves follow the convention the rest of the app already uses for tinted text
 * (`text-amber-700 dark:text-amber-400`) — a light-mode-only shade goes muddy on a dark surface.
 */
const ADVISORY_TONE_CLASS: Record<"info" | "warning", string> = {
  info: "text-amber-600 dark:text-amber-400",
  warning: "text-amber-700 dark:text-amber-400",
};

function RowAdvisory({ advisory }: { advisory: NonNullable<SettingsRowProps["advisory"]> }) {
  const isWarning = advisory.tone === "warning";
  return (
    <p
      className={cn(
        "flex w-full items-start gap-1.5 text-xs",
        ADVISORY_TONE_CLASS[advisory.tone],
      )}
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : null}
      <span>{advisory.text}</span>
    </p>
  );
}

interface SettingsRowProps {
  /** Wires the label to its control for click-to-focus and screen readers. */
  id?: string;
  label: string;
  /**
   * Renders a red asterisk after the label. Pair it with `<FormLegend />` at the
   * top of the form, which is the convention this repo already uses everywhere
   * else — the asterisk itself is `aria-hidden`, so the legend carries the meaning.
   * Communication only — the caller still owns enforcing it.
   */
  required?: boolean;
  /** One short line of context. Omit when the label already says it. */
  hint?: string;
  /** Longer explanation, revealed from the ⓘ next to the label. */
  help?: ReactNode;
  /**
   * A live message about the value currently in the control.
   *
   * Deliberately NOT the ⓘ. `hint` is static context and `help` is the optional explanation, but
   * anything the manager has to ACT on has to be on screen: a popover is invisible to anyone who
   * never opens it, and once opened it closes again, leaving the reader to hold the number in
   * working memory. (NN/g, "Don't use tooltips for information that is vital to task completion.")
   *
   * Rendered full-width beneath the row so it sits with the control, not beside the label.
   */
  advisory?: {
    /** `warning` adds the amber treatment and an icon; `info` stays muted. */
    tone: "info" | "warning";
    text: string;
  };
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
  advisory,
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
          {required ? (
            <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
          ) : null}
        </Label>
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
        {advisory ? <RowAdvisory advisory={advisory} /> : null}
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
      {advisory ? <RowAdvisory advisory={advisory} /> : null}
    </div>
  );
}
