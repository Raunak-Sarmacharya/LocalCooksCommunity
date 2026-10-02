import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Plus,
} from "@/components/ui/manager-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";

/** The minimum a kitchen needs to appear in the switcher. */
export interface SwitchableKitchen {
  id: number;
  name: string;
  listingStatus?: "active" | "draft";
  isActive?: boolean;
}

interface KitchenSwitcherProps {
  kitchens: SwitchableKitchen[];
  activeKitchenId: number;
  /** The shell owns the selection, so it can refuse to switch away from unsaved work. */
  onSelect: (kitchenId: number) => void;
  onAddKitchen: () => void;
}

/**
 * A visible Add Kitchen action beside the current-kitchen selector.
 *
 * Creation is a primary task on this page, so managers can see it without opening
 * the selector. The adjacent controls share one frame but retain separate targets:
 * the plus starts creation, and the kitchen name opens the list when there is a choice.
 *
 * NN/g, *Dropdowns: Design Guidelines*: a control that reveals a list "has a dropdown arrow next to
 * them" and "tends to be supported by a field label or a title". So it is bordered and field-like at
 * rest rather than only on hover, and it carries the app's own switcher glyph.
 *
 * `ChevronsUpDown` rather than `ChevronDown`: this is the same glyph the sidebar's account menu uses,
 * and it reads "switch between these" rather than "open a menu". The app already owns that
 * vocabulary, so the two switchers agree.
 *
 * `modal={false}` because a modal menu wraps itself in react-remove-scroll, which sets
 * `overflow: hidden` on <body> and makes the page scrollbar vanish while the menu is open. Non-modal
 * leaves the page scrollable; dismissal, Escape and keyboard navigation come from the menu's own
 * layer either way.
 */
const TRIGGER =
  "group inline-flex !min-h-0 h-full min-w-0 max-w-[18rem] items-center gap-2 px-3 text-sm transition-colors hover:bg-muted/60 data-[state=open]:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/** The item's check column. Held open when unselected so every name starts on the same x. */
const CHECK = "h-4 w-4 shrink-0 text-primary";
/**
 * `data-[highlighted]` as well as `focus:`: Radix sets the attribute on pointer-move AND on keyboard
 * navigation, so the row highlights even if a future primitive stops moving DOM focus onto it.
 *
 * The stock `focus:bg-accent` is overridden because `--accent` is pure white — the same as
 * `--popover` — so the shipped highlight is invisible on this menu.
 */
const ITEM =
  "gap-3 rounded-xl px-3 py-2.5 focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground";

export function KitchenSwitcher({
  kitchens,
  activeKitchenId,
  onSelect,
  onAddKitchen,
}: KitchenSwitcherProps) {
  const active = kitchens.find((kitchen) => kitchen.id === activeKitchenId);
  const controlRef = useRef<HTMLDivElement>(null);
  const [controlWidth, setControlWidth] = useState<number>();
  useEffect(() => {
    const control = controlRef.current;
    if (!control || kitchens.length < 2) return;
    const measure = () => setControlWidth(control.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(control);
    return () => observer.disconnect();
  }, [Boolean(active), kitchens.length > 1]);
  if (!active) return null;

  const identity = <>
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold text-primary"
    >
      {active.name.trim().charAt(0).toUpperCase()}
    </span>
    <span className="min-w-0 truncate font-medium">{active.name}</span>
  </>;

  return (
    <div ref={controlRef} className="inline-flex h-11 w-80 min-w-0 max-w-full items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_8px_-6px_rgba(15,23,42,0.25)]">
      <button type="button" onClick={onAddKitchen}
        className="inline-flex !min-h-0 h-full shrink-0 items-center gap-2 border-r border-border px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
        <Plus aria-hidden="true" className="h-4 w-4" />
        {mt("addKitchen")}
      </button>
      {kitchens.length === 1 ? (
        <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-sm">
          {identity}
        </div>
      ) : (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn(TRIGGER, "flex-1 justify-between")}>
            {identity}
            <ChevronsUpDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground"
            />
          </button>
        </DropdownMenuTrigger>

        {/* Keep the menu aligned to the selector's right edge; Radix flips it near the viewport edge. */}
        <DropdownMenuContent align="end" style={controlWidth ? { width: controlWidth } : undefined} className="w-80 overflow-hidden rounded-[1.25rem] border-border/80 p-2 shadow-[0_18px_42px_-20px_rgba(15,23,42,0.42)]">
          <DropdownMenuLabel className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">{mt("kitchen")}</DropdownMenuLabel>
          <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "min(50vh, max(0px, calc(var(--radix-dropdown-menu-content-available-height) - 6rem)))" }}>
            {kitchens.map((kitchen) => {
              const status = kitchen.isActive === false
                ? mt("listingStatusHiddenLabel")
                : kitchen.listingStatus === "active"
                  ? mt("listingStatusLiveLabel")
                  : mt("listingStatusDraftLabel");
              return (
                <DropdownMenuItem
                  key={kitchen.id}
                  aria-label={`${kitchen.name}, ${status}`}
                  onSelect={() => onSelect(kitchen.id)}
                  className={ITEM}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(CHECK, kitchen.id !== activeKitchenId && "opacity-0")}
                  />
                  <span className={cn("min-w-0 flex-1 truncate", kitchen.id === activeKitchenId && "font-medium")}>
                    {kitchen.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", kitchen.isActive === false ? "bg-amber-600" : kitchen.listingStatus === "active" ? "bg-emerald-600" : "bg-muted-foreground/50")} />
                    {status}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      )}
    </div>
  );
}

export default KitchenSwitcher;
