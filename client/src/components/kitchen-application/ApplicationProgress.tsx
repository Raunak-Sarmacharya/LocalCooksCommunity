import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * One outstanding-or-done item in the progress bar's list.
 *
 * `state` is a THREE-way thing, not a boolean, because a step can be *waiting on someone else*
 * rather than on the chef. "Request to apply" is done the moment it is submitted and then sits
 * under review — rendering it as an unticked box the chef can click would be a lie about whose
 * move it is.
 */
export type ProgressItemState = "done" | "todo" | "waiting";

export interface ProgressItem {
  /** Stable key; also the anchor `#id` a destination scrolls to. */
  id: string;
  label: string;
  /** Optional one-line qualifier shown under the label. */
  hint?: string;
  state: ProgressItemState;
  /** Omitted for items that cannot be acted on (waiting, or already done with nothing to change). */
  onNavigate?: () => void;
}

interface ApplicationProgressProps {
  /** Heading — "Request to apply" or "Kitchen documents". */
  title: string;
  /**
   * The REQUIRED checklist. This is what the percentage counts.
   *
   * Optional fields are deliberately kept out of `items` rather than mixed in and tagged: the bar
   * answers "can I submit yet", and an optional field can never change that answer. Counting them
   * would make 100% unreachable-looking and would let the bar read 60% on a form that is ready.
   */
  items: ProgressItem[];
  /** Items that are genuinely optional. Shown in a quieter sub-group; never counted in the bar. */
  optionalItems?: ProgressItem[];
  /**
   * The submit action itself, shown as a trailing status row.
   *
   * Kept out of `items` on purpose. "Sent when you submit" can never be *done* before the chef
   * submits, so counting it would peg a fully-completed form at 90% and keep telling the chef
   * something is missing when nothing is.
   */
  statusItem?: ProgressItem;
  /** Heading for the optional sub-group. Only rendered when `optionalItems` is non-empty. */
  optionalLabel?: string;
  /**
   * Explanatory lines under the bar, rendered as separate items.
   *
   * An array, not one string: the copy here does two genuinely different jobs (what is left, and
   * what happens after), and running them together into a single blob made both unreadable.
   */
  captions?: string[];
  /** Rendered as a `Note`-style footnote below the list (the "already sent and approved" note). */
  footer?: string;
  /** Cancel + Submit. Lives on the bar so the actions never scroll out of reach. */
  actions?: ReactNode;
  /** Extra classes for the wrapper — the host decides the offset. */
  className?: string;
}

/**
 * The application's ONE overall progress indicator.
 *
 * Before this there were five per-section percentage chips, one in each section header. Five numbers
 * that never add up to anything the chef can act on: they could see "Additional Information 66%" and
 * still have no idea whether they were allowed to submit. This replaces all five with one bar that
 * counts the requirements the chef is actually up against, and a list naming exactly what is missing.
 *
 * WHY THE LIST IS ALWAYS SHOWN
 *
 * The bar is the answer to "how am I doing" and the list is the answer to "what next" — but the
 * second is the one that is worth anything, and it is short. Hiding it behind a disclosure made
 * the chef click the control that reports a problem to find out what the problem was. It now sits
 * open in the rail, where its fixed width keeps it readable and it costs the form no vertical room.
 *
 * WHY REQUIRED AND OPTIONAL ARE SEPARATE GROUPS
 *
 * The whole value of this card is that a full bar means "you may submit". If optional fields were
 * counted, the bar could sit at 80% on a form that would submit happily, and the chef would hunt
 * for a missing field that does not exist. Required items come first and own the percentage;
 * optional ones follow in a quieter group that is visibly *not* part of the count.
 *
 * WHY `waiting` EXISTS
 *
 * Submitting ends the chef's part, not the task — the remaining time belongs to LocalCooks and the
 * kitchen. Such an item renders as a spinner-ish "with them", not as a checkbox the chef failed to
 * tick, and it counts as done so a submitted phase reads 100% rather than freezing at whatever
 * fraction the tracker happened to hold.
 */
export function ApplicationProgress({
  title,
  items,
  optionalItems,
  statusItem,
  optionalLabel,
  captions,
  footer,
  actions,
  className,
}: ApplicationProgressProps) {
  const { t } = useTranslation("kitchen");

  const { doneCount, totalCount, percent } = useMemo(() => {
    const total = items.length;
    const todo = items.filter((item) => item.state === "todo");
    const done = total - todo.length;
    return {
      doneCount: done,
      totalCount: total,
      // Guard the empty case: an item-less phase should read as nothing to do, not as 0%.
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [items]);

  const isComplete = doneCount === totalCount;
  const showOptional = Boolean(optionalItems && optionalItems.length > 0);

  return (
    /*
     * A plain block. The wrapper deliberately does NOT paint a background, add negative margins, or
     * set its own `sticky`: the HOST decides placement and stickiness.
     *
     * This component is rendered in two very different slots — a `20rem` rail beside the form on
     * `lg`, and a plain block above the form below `lg` — and the wrapper previously carried
     * full-width mobile-bar chrome (`-mx-1 px-1 bg-background/95 backdrop-blur`). Inside the narrow
     * rail those negative margins pushed the translucent background 4px past both edges of its own
     * column, so the blur washed over the column border; and a nested `sticky top-0` fought the
     * rail's own `lg:top-6`.
     *
     * The `Card` inside already supplies the visible surface, so the wrapper needs no paint at all.
     */
    <div className={cn("min-w-0", className)}>
      <Card
        className={cn(
          "flex flex-col shadow-none",
          isComplete ? "border-success/30" : "border-primary/30",
        )}
      >
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              {isComplete ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              {title}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t("appProgressCount", {
                defaultValue: "{done} of {total} ready",
                done: doneCount,
                total: totalCount,
              })}
            </span>
          </div>

          {/* The bar. Tinted by state so the colour says the same thing the count does. */}
          <Progress
            value={percent}
            className={cn(
              "mt-2 h-1.5",
              isComplete ? "[&>div]:bg-success" : "[&>div]:bg-primary",
            )}
          />

          {/* Explanatory lines — one per row, never merged into a paragraph. */}
          {captions && captions.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {captions.map((line) => (
                <li key={line} className="text-xs leading-relaxed text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            The list is ALWAYS visible, not a disclosure.
            Its whole job is to name what is missing; hiding the answer behind a click on the one
            control that reports the problem makes the chef hunt for it.
          */}
          {totalCount > 0 ? (
            <ul className="mt-3 space-y-1 border-t pt-3">
              {items.map((item) => (
                <li key={item.id}>
                  <ProgressRow item={item} />
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            Optional fields, in their own quieter group. No icons-by-state and no percentage weight:
            a tick here must not look like a step towards being allowed to submit.
          */}
          {showOptional ? (
            <div className="mt-3 border-t pt-3">
              <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {optionalLabel ?? t("appProgressOptional", { defaultValue: "Optional" })}
              </p>
              <ul className="mt-1.5 space-y-1">
                {optionalItems!.map((item) => (
                  <li key={item.id}>
                    <ProgressRow item={item} muted />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The submit action, as a status row rather than a checklist item. */}
          {statusItem ? (
            <ul className="mt-3 border-t pt-3">
              <li>
                <ProgressRow item={statusItem} />
              </li>
            </ul>
          ) : null}

          {footer ? (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{footer}</p>
          ) : null}
        </CardContent>

        {/*
          Actions on the bar itself. Whether Submit is actually enabled is the host's call, because
          only the host knows about in-flight submissions and server-side blocks.

          No layout classes beyond the border, and that is deliberate. `CardFooter`'s own base is
          `flex flex-col sm:flex-row`, so a bare `flex-col` here does NOT win: tailwind-merge treats
          `flex-col` and `sm:flex-row` as different classes, the `sm:` variant survives, and the
          footer silently flips back to a ROW from 640px up. That is what squeezed the "still needed"
          text into a one-word-per-line column beside the buttons. With a single `w-full` child there
          is nothing to arrange, so the base classes are harmless and nothing needs overriding.
        */}
        {actions ? (
          <CardFooter className="mt-auto border-t p-4 pt-3">{actions}</CardFooter>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * One row. A `<button>` only when there is somewhere to go — a row that looks clickable and is not
 * is worse than plain text, and most rows here are informational.
 *
 * `muted` drops the state icon entirely. Used for the optional group, where a tick would imply the
 * field counted towards the bar.
 */
function ProgressRow({ item, muted = false }: { item: ProgressItem; muted?: boolean }) {
  const inner = (
    <>
      {muted ? null : <ProgressRowIcon state={item.state} />}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            !muted && item.state === "todo"
              ? "font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          {item.label}
        </span>
        {item.hint ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.hint}</span>
        ) : null}
      </span>
    </>
  );

  const shape = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
    muted && "py-1",
  );

  if (!item.onNavigate) {
    return <span className={shape}>{inner}</span>;
  }

  return (
    <button
      type="button"
      onClick={item.onNavigate}
      className={cn(
        shape,
        "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {inner}
    </button>
  );
}

/** Done = filled tick, todo = open ring, waiting = spinner (the ball is in someone else's court). */
function ProgressRowIcon({ state }: { state: ProgressItemState }) {
  if (state === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
  }
  if (state === "waiting") {
    return <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" aria-hidden="true" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
}

export default ApplicationProgress;
