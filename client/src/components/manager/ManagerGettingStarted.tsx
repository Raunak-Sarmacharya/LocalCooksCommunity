import { useEffect, useState, type ElementType } from "react";
import { SiStripe } from "react-icons/si";
import {
  Boxes,
  CalendarClock,
  Check,
  ChevronDown,
  Eye,
  ImageIcon,
  Package,
  Phone,
  Rocket,
  Storefront,
} from "@/components/ui/manager-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";
import {
  GETTING_STARTED_PHASES,
  GETTING_STARTED_PHASE_LABEL_KEYS,
  type GettingStartedItem,
  type GettingStartedItemId,
  type GettingStartedPhaseId,
} from "@/lib/manager-getting-started";

/*
 * Every string here comes from the `manager` catalog. There is NO English fallback table.
 *
 * There was one while the copy was still being decided, and it was a second definition of the same
 * fact: the catalog and the table could drift apart, and the guard that measures string lengths read
 * the TABLE rather than what a user actually sees. Both are gone — `en-CA` is the one source, and
 * `ManagerGettingStarted.test.tsx` measures the catalogs themselves.
 *
 * `scripts/i18n-lint.mjs` guarantees every key below exists in `en-CA` and that `fr-CA` and `uk` hold
 * exactly the same set, so a missing key cannot reach production and render as a raw id.
 *
 * THE LENGTHS ARE LOAD-BEARING, and they are a TRANSLATION constraint as much as an English one. The
 * panel is `20rem`, sized for the longest string in ANY locale — `fr-CA` runs ~30% longer than
 * English ("Plus de photos, plus de réservations" is 36 characters against 25). A string over budget
 * does not wrap, because every one is `truncate`d; it is cut mid-sentence, which is worse.
 */
const HIDDEN_STAGE_HINT_KEYS: Record<"setup" | "live", string> = {
  setup: "gettingStartedMoreAfterSetup",
  live: "gettingStartedMoreAfterLive",
};

const copy = (key: string): string => mt(key);

/**
 * The row's glyph, small and quiet, on the right.
 *
 * These used to be 32px filled circles in the brand colour — nine coloured chips down one narrow
 * panel, which is what made the list read as heavy. A 14px muted glyph keeps the row scannable and
 * costs almost nothing visually.
 *
 * The Stripe mark keeps its OWN colour (`text-stripe`): it is a third-party brand, not a UI icon, and
 * painting it brand-red made it read as a missing asset.
 */
const ITEM_ICONS: Record<GettingStartedItemId, { Icon: ElementType; iconClassName?: string }> = {
  "finish-setup": { Icon: Rocket },
  phone: { Icon: Phone },
  stripe: { Icon: SiStripe, iconClassName: "text-stripe" },
  "publish-kitchen": { Icon: Storefront },
  photos: { Icon: ImageIcon },
  tours: { Icon: Eye },
  equipment: { Icon: Package },
  storage: { Icon: Boxes },
  "first-booking": { Icon: CalendarClock },
};

/**
 * Once-per-session memory of the completion state.
 *
 * `sessionStorage`, not the database: the celebration is a moment, not a fact worth a column and a
 * migration, and it is per-device by nature. Without it the widget would re-celebrate on every mount.
 */
const CELEBRATED_KEY = "localcooks.gettingStarted.celebrated";

function readCelebrated(): boolean {
  try {
    return window.sessionStorage.getItem(CELEBRATED_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Celebrating again is harmless.
    return false;
  }
}

function markCelebrated(): void {
  try {
    window.sessionStorage.setItem(CELEBRATED_KEY, "1");
  } catch {
    /* see above */
  }
}

/**
 * The marker on a row that is NOT done: a dotted ring.
 *
 * Drawn rather than imported. mdi ships no dotted circle, and `circle-outline` — the nearest thing —
 * is a solid ring that reads as a small dot at this size. A dasharray with round caps gives the
 * "not yet" ring exactly, and it can be sized to match the tick beside it so the column stays even.
 */
function NotDoneMarker() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="text-muted-foreground/60">
      <circle
        cx="7"
        cy="7"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="0.1 3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The progress ring, drawn rather than imported.
 *
 * A ring is one `<circle>` with a dash offset — pulling in a charting library for twelve lines of SVG
 * would be a dependency to maintain for nothing. The offset is transitioned so it animates when a row
 * completes, which is the one moment it is worth watching.
 *
 * THE TRACK COLOUR IS THE WHOLE THING. It used to be `stroke-muted`, and `--muted` is
 * `220 14.3% 95.9%` against a sidebar of `0 0% 100%` — about 1.05:1, i.e. invisible. All that showed
 * was the brand arc, so a partly-complete ring read as a broken fragment of a circle. It is now a
 * deliberately darker grey that is legible on white; the arc still carries the value.
 *
 * In icon mode it grows to fill the rail's button and prints the PERCENTAGE inside, because the two
 * text lines beside it are hidden there — without a number the collapsed rail would show a ring with
 * no way to read it.
 */
function ProgressRing({ value, complete }: { value: number; complete: boolean }) {
  const size = 22;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <span
      className={cn(
        "relative flex size-[22px] shrink-0 items-center justify-center",
        /*
         * In the rail the button's content box is only 16px (`!size-8` minus `!p-2`), so laying the
         * ring out in flow means it overflows that box and its position depends on overflow maths —
         * which is what left it skewed right. Pinning it with `inset-0 m-auto` centres it on the
         * BUTTON instead, and ignores the padding entirely. Deterministic at any button size.
         */
        "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:inset-0",
        "group-data-[collapsible=icon]:m-auto group-data-[collapsible=icon]:size-[30px]",
      )}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted-foreground/35"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={cn(
            "transition-[stroke-dashoffset] duration-500 ease-out",
            complete ? "stroke-emerald-500" : "stroke-primary",
          )}
        />
      </svg>
      {/*
        Both overlays fill the ring and centre their own content, so neither depends on the static
        position of an absolutely-positioned child inside a flex container — which browsers do not
        agree on.
      */}
      {complete ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Check
            className={cn(
              "size-3 text-emerald-600 animate-in zoom-in-50 duration-300",
              "group-data-[collapsible=icon]:size-4",
            )}
          />
        </span>
      ) : (
        <span
          className={cn(
            "absolute inset-0 hidden items-center justify-center",
            "text-[10px] font-medium tabular-nums leading-none text-foreground",
            "group-data-[collapsible=icon]:flex",
          )}
        >
          {Math.round(clamped * 100)}%
        </span>
      )}
    </span>
  );
}

export interface ManagerGettingStartedProps {
  items: GettingStartedItem[];
  completed: number;
  total: number;
  /** Which stage's rows are held back, so the list can say what unlocks them. `null` when none are. */
  hiddenStage?: "setup" | "live" | null;
  /**
   * The answers are not in yet.
   *
   * The widget renders NOTHING while this is true rather than a wrong stage: with setup unknown, a
   * host would see "Finish setting up" flash and then be replaced by the real list.
   */
  isLoading?: boolean;
  onSelectItem?: (id: GettingStartedItemId) => void;
}

/**
 * The manager dashboard's Getting Started widget.
 *
 * THREE THINGS THIS IS DELIBERATELY SHAPED AROUND
 *
 * 1. **The label is never the same twice.** "Getting started" is true on day one and wrong by week
 *    two — the host has started, and the list now holds growth work as well as setup. So the launcher
 *    names the STAGE they are in and the SINGLE next action beneath it, and both change on their own.
 *
 * 2. **The panel opens INSIDE the sidebar.** It used to be a flyout anchored to the sidebar's right
 *    edge, which meant a second placement to maintain and a second thing to get wrong: on mobile the
 *    sidebar is a SHEET, so a right-anchored popover opened past the viewport edge. Expanding in place
 *    cannot overflow at any width, and it keeps the list in the column it belongs to.
 *
 *    It grows UPWARD — the group is bottom-anchored (`mt-auto`), so the panel sits above the launcher
 *    and pushes into the space above rather than below the fold.
 *
 * 3. **Completion is acknowledged, then it leaves.** The last row ticking turns the ring green with a
 *    tick and says so for a few seconds before the widget retires for the session.
 */
export function ManagerGettingStarted({
  items,
  completed,
  total,
  hiddenStage = null,
  isLoading = false,
  onSelectItem,
}: ManagerGettingStartedProps) {
  const [open, setOpen] = useState(false);
  const [celebrated, setCelebrated] = useState(readCelebrated);

  const isComplete = items.length > 0 && completed === total;

  useEffect(() => {
    if (!isComplete) return;
    markCelebrated();
    const timer = window.setTimeout(() => setCelebrated(true), 6000);
    return () => window.clearTimeout(timer);
  }, [isComplete]);

  // Nothing to say while the answers are unknown, or once the celebration has been seen.
  if (isLoading || !items.length) return null;
  if (isComplete && celebrated) return null;

  const nextItem = items.find((item) => !item.complete) ?? null;
  const visiblePhases = GETTING_STARTED_PHASES.filter((phase) =>
    items.some((item) => item.phase === phase),
  );
  const currentPhase: GettingStartedPhaseId = nextItem?.phase ?? visiblePhases[visiblePhases.length - 1] ?? "get-set-up";
  const stageLabel = isComplete ? copy("gettingStartedAllDone") : copy(GETTING_STARTED_PHASE_LABEL_KEYS[currentPhase]);
  const actionLabel = isComplete ? copy("gettingStartedAllDoneDesc") : copy(nextItem!.labelKey);
  const progressLabel = mt("managerSetupProgress", {
    completed,
    total,
    defaultValue: "{completed} of {total} complete",
  });

  const panel = (
    /*
     * The panel has to LIFT OFF the page. It sits on the sidebar, so a plain border left it reading as
     * part of the background — it needs a real edge and a real shadow to read as a layer above.
     *
     * Two shadow layers, which is the standard "lift" recipe: a wide soft one for depth and a tight
     * one for the contact edge. It renders in full because the popover PORTALS the panel outside the
     * sidebar — inside `SidebarContent` (which is `overflow-auto`) the sides of the blur were cut off
     * at the sidebar's edge, which is part of why it read as flat.
     *
     * `max-h` + scroll is the backstop for a viewport too short to hold the list. It lives on THIS
     * element rather than a wrapper so it cannot clip the shadow it sits under.
     */
    <div
      className={cn(
        "max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-popover p-1.5",
        "ring-1 ring-black/[0.04]",
        "shadow-[0_18px_44px_-14px_rgba(0,0,0,0.34),0_2px_8px_-2px_rgba(0,0,0,0.10)]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 px-1.5 pt-0.5">
        <h2 className="text-[12px] font-semibold text-foreground">
          {isComplete ? copy("gettingStartedAllDone") : stageLabel}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{progressLabel}</span>
      </div>

      {isComplete ? (
        <div className="mt-1.5 rounded-lg bg-emerald-500/10 px-3 py-4 text-center">
          <Check className="mx-auto size-4 text-emerald-600" />
          <p className="mt-1.5 text-[12px] font-medium text-foreground">{copy("gettingStartedAllDone")}</p>
          <p className="text-[11px] text-muted-foreground">{copy("gettingStartedAllDoneDesc")}</p>
        </div>
      ) : null}

      {GETTING_STARTED_PHASES.map((phase) => {
        const phaseItems = items.filter((item) => item.phase === phase);
        if (!phaseItems.length) return null;
        const phaseLabel = copy(GETTING_STARTED_PHASE_LABEL_KEYS[phase]);

        return (
          <section key={phase} className="mt-1.5">
            <h3 className="px-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">{phaseLabel}</h3>
            <ul aria-label={phaseLabel}>
              {phaseItems.map((item) => {
                const meta = ITEM_ICONS[item.id];
                /*
                 * A MILESTONE is not a task. Nothing the host can click makes a customer book, so
                 * rendering it as a button would offer an action the row cannot perform — and a row
                 * that names work but offers no way to do it is the one shape a checklist must never
                 * have. It reads as waiting instead.
                 */
                const actionable = item.kind === "task" && !item.complete;
                const hasDescription = !item.complete && Boolean(item.descriptionKey);
                /*
                 * The marker and the glyph centre on the row's TEXT BLOCK, not on its first line.
                 *
                 * A row that shows a description is two lines (17 + 15 = 32px), so a 14px marker sits
                 * at 9px — which lands it between the label and the description rather than level with
                 * the label. A completed row is one line, so it sits at 2px. Both ends share the
                 * offset so the left and right columns stay in step with each other.
                 */
                const markerOffset = hasDescription ? "mt-[9px]" : "mt-[2px]";

                const body = (
                  <>
                    {/*
                      A bare 14px marker, not a filled chip. The chip was the single heaviest thing in
                      the list — nine tinted circles down one narrow panel.
                    */}
                    <span className={cn("flex w-3.5 shrink-0 justify-center", markerOffset)}>
                      {item.complete ? (
                        <Check className="size-3.5 text-primary" />
                      ) : (
                        <NotDoneMarker />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[12.5px] leading-[17px]",
                          item.complete
                            ? "text-muted-foreground line-through"
                            : "font-medium text-foreground",
                        )}
                      >
                        {copy(item.labelKey)}
                      </span>
                      {/* Completed rows drop the description: the tick already says it. */}
                      {hasDescription ? (
                        <span className="block truncate text-[11px] leading-[15px] text-muted-foreground">
                          {copy(item.descriptionKey!)}
                        </span>
                      ) : null}
                    </span>
                    <meta.Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        markerOffset,
                        item.complete ? "text-muted-foreground/30" : "text-muted-foreground/70",
                        meta.iconClassName,
                      )}
                    />
                  </>
                );

                const rowClass = cn(
                  "flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left",
                  // The app floors every button at 44px. A checklist row is a dense list item, not a
                  // touch target on its own, so the floor is cancelled here (`!` prefix, Tailwind v3).
                  actionable && "!min-h-0 !min-w-0 cursor-pointer transition-colors hover:bg-muted",
                );

                return (
                  <li key={item.id}>
                    {actionable ? (
                      <button
                        type="button"
                        className={rowClass}
                        onClick={() => {
                          setOpen(false);
                          onSelectItem?.(item.id);
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className={rowClass}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* The withheld stage is NAMED, not silently absent. A checklist that just stops reads as a
          dead end; one that says the road continues is an invitation. */}
      {hiddenStage ? (
        <p className="mt-1.5 border-t border-border/60 px-1.5 pt-1.5 text-[11px] leading-4 text-muted-foreground">
          {copy(HIDDEN_STAGE_HINT_KEYS[hiddenStage])}
        </p>
      ) : null}
    </div>
  );

  const launcher = (
    <SidebarMenuButton
      tooltip={`${stageLabel}: ${progressLabel}`}
      aria-label={`${stageLabel}. ${actionLabel}. ${progressLabel}`}
      aria-expanded={open}
      className={cn(
        // `relative` is the containing block for the ring's absolute centring in the rail.
        // `h-auto` because this launcher is two lines, and the app-wide 44px button floor is the
        // minimum we WANT here rather than something to cancel.
        "relative h-auto items-center gap-2 rounded-xl px-2 py-2",
        open && "bg-sidebar-accent",
      )}
    >
      <ProgressRing value={total ? completed / total : 0} complete={isComplete} />
      <span className="grid min-w-0 flex-1 gap-px text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span
          className={cn(
            "truncate text-[11px] font-medium",
            isComplete ? "text-emerald-600" : "text-muted-foreground",
          )}
        >
          {stageLabel}
        </span>
        <span className="truncate text-[13px] font-medium text-foreground">{actionLabel}</span>
      </span>
      {/*
        A DISCLOSURE chevron, not a "go" chevron: the launcher only expands and collapses, it does not
        navigate. Down when closed, up when open — the shape every accordion uses.
      */}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
          "group-data-[collapsible=icon]:hidden",
          open && "rotate-180",
        )}
      />
    </SidebarMenuButton>
  );

  /*
   * The panel ALWAYS opens OUTSIDE, as a flyout beside the sidebar.
   *
   * It was briefly rendered in place, floating above the launcher. That could not work well enough:
   * the panel is ~240px of content in a 16rem column, so the copy had to be cut to fit, and the only
   * way to keep it from reflowing the sidebar was to take it out of flow — at which point it was
   * overlaying the nav anyway, with a shadow that `SidebarContent`'s `overflow-auto` clipped.
   * Outside is simpler, keeps the copy its natural length, and cannot clip anything.
   */
  return (
    /*
     * `relative p-0` is load-bearing, not tidiness.
     *
     * `SidebarGroup` ships its own `p-2`, and this widget lives in `SidebarFooter`, which is `p-2` as
     * well — so the button sat in a 16px box while `SidebarMenuButton` forces
     * `group-data-[collapsible=icon]:!size-8` (32px). A 32px button in a 16px box overflows to the
     * RIGHT, so its centre landed 8px right of the rail's centre and the ring read as skewed. The
     * avatar below is centred precisely because it sits directly in the footer and gets ONE padding.
     *
     * `relative` is the containing block for the ring's absolute centring in the rail.
     */
    <SidebarGroup className="relative p-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{launcher}</PopoverTrigger>
            <PopoverContent
              side="right"
              align="end"
              sideOffset={10}
              // Sized to the copy in EVERY locale, not just English. `fr-CA` is the widest: its longest
              // description is 36 characters against English's 28, and its longest label 34 against 23.
              // 20rem gives the text box ~252px, which holds both with a little headroom.
              className="w-[20rem] p-0"
              // The panel brings its own surface and shadow, so the popover's are stripped. Inline
              // styles, not classes: `PopoverContent` sets `bg-popover`/`border`/`shadow-md` itself
              // and tailwind-merge is not guaranteed to drop them.
              style={{ background: "transparent", border: "none", boxShadow: "none" }}
            >
              {panel}
            </PopoverContent>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

export default ManagerGettingStarted;
