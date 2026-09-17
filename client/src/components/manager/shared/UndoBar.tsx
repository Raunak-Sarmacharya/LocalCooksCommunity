import { useEffect, useState } from "react";

import { tt } from "@/i18n/common-ns";
import { Undo2 } from "@/components/ui/manager-icons";

/**
 * How long the undo affordance stays available after a delete. Shared by the
 * dismissal timer and the countdown so the two can never disagree.
 */
export const UNDO_WINDOW_MS = 6000;

/**
 * Undo affordance after a delete. Deletes are instant and unconfirmed — a
 * confirmation dialog on every row is heavier than the action deserves, and a
 * six-second window with a one-tap restore covers the genuine misclick.
 *
 * It deliberately does not borrow the list row's own chrome (muted fill, grey
 * border, plain text button), so it reads as a transient system message rather
 * than as one more list item, and carries a live countdown so its short life is
 * visible.
 *
 * Lives here rather than beside its first caller because both the check-in /
 * check-out editor and the storage & equipment tabs need the identical thing.
 */
export function UndoBar({
  onUndo,
  label,
  seconds,
}: {
  onUndo: () => void;
  label: string;
  seconds: number;
}) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, label]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 py-1.5 pl-3 pr-1.5 shadow-sm"
    >
      <Undo2 className="size-3.5 shrink-0 text-sky-600" />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-sky-900">{label}</p>
      <button
        type="button"
        onClick={onUndo}
        className="!min-h-0 !min-w-0 shrink-0 rounded-md border border-sky-300 bg-white px-2 py-1 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        {tt("undo")}
      </button>
      <span
        aria-hidden
        className="w-3 shrink-0 text-center text-[11px] tabular-nums text-sky-600"
      >
        {remaining}
      </span>
    </div>
  );
}
