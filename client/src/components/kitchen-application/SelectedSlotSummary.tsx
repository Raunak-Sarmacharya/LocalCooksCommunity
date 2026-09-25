import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface SelectedSlotSummaryProps {
  /** Already-formatted range strings, in the order they were picked. */
  ranges: string[];
  /** Shown when nothing is selected. */
  emptyLabel?: string;
  /** Rendered inside the popover above the full list, e.g. "5 hours selected". */
  countLabel?: string;
  /** Heading inside the popover. */
  popoverTitle?: string;
  /** How many chips to show before collapsing into "+N". */
  maxVisible?: number;
  className?: string;
}

/**
 * Compact summary of the manager/chef's chosen time slots.
 *
 * Shows at most `maxVisible` chips, then a single "+N" trigger that opens a
 * popover listing every selection. Keeps long selections from wrapping into a
 * wall of badges in the review/summary panels.
 */
export function SelectedSlotSummary({
  ranges,
  emptyLabel = "—",
  countLabel,
  popoverTitle,
  maxVisible = 2,
  className,
}: SelectedSlotSummaryProps) {
  if (ranges.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }

  const visible = ranges.slice(0, maxVisible);
  const overflow = ranges.length - visible.length;

  return (
    <div className={className ?? "flex flex-wrap items-center gap-1.5"}>
      {visible.map((range) => (
        <Badge key={range} variant="secondary" className="whitespace-nowrap text-xs">
          {range}
        </Badge>
      ))}
      {overflow > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={popoverTitle ? `${popoverTitle} (+${overflow})` : `+${overflow}`}
              className="inline-flex h-[22px] items-center rounded-full border border-border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            >
              +{overflow}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <p className="text-xs font-semibold text-foreground">{popoverTitle}</p>
              {countLabel ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{countLabel}</span> : null}
            </div>
            <ul className="max-h-56 space-y-0.5 overflow-y-auto p-1.5">
              {ranges.map((range) => (
                <li
                  key={range}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                  {range}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default SelectedSlotSummary;
