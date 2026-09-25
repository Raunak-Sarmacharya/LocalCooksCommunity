import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatJourneyClock(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

/**
 * Compact single-line time slot.
 *
 * The range reads as one line (`10:00 – 11:00 AM`) with the check sitting
 * directly after the text, so there is no dead space between the label and the
 * tick at the far edge. Previously this was `min-h-16` with the end time on a
 * second line, which made each slot feel oversized in the tour + apply grids.
 */
export default function KitchenJourneyTimeSlot({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  const [start, end] = label.split(" – ");
  const stripMeridiem = (value: string) => value.replace(/\s?[AP]M$/i, "");
  // Both ends usually share a meridiem ("10:00 AM – 11:00 AM"). Drop it from each
  // side so the range fits one tight line — "10:00 – 11:00" — which matters on
  // narrow phones where the grid is only two columns wide.
  const sharesMeridiem = !!start.match(/[AP]M$/i) && !!end?.match(/[AP]M$/i) && stripMeridiem(start) !== stripMeridiem(end);
  const display = !end
    ? start
    : sharesMeridiem
      ? `${stripMeridiem(start)} – ${stripMeridiem(end)}`
      : `${start} – ${end}`;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-center text-[13px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        selected ? "border-primary bg-primary/5 text-foreground" : "border-border bg-background text-foreground hover:border-primary/60 hover:bg-primary/[0.03]"
      )}
    >
      <span className="truncate">{display}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
