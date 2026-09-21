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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";

/** The minimum a kitchen needs to appear in the switcher. */
export interface SwitchableKitchen {
  id: number;
  name: string;
}

interface KitchenSwitcherProps {
  kitchens: SwitchableKitchen[];
  activeKitchenId: number;
  /** The shell owns the selection, so it can refuse to switch away from unsaved work. */
  onSelect: (kitchenId: number) => void;
  onAddKitchen: () => void;
}

/**
 * The kitchen switcher, worn as the IDENTITY inside the listing-status banner.
 *
 * WHY IT LOOKS LIKE A FIELD
 *
 * The banner states one kitchen and its publish state, so the switcher has to read as a CONTROL and
 * the state as STATUS. The first version dressed the control as plain text — a borderless button
 * with a 14px grey chevron — which made it indistinguishable from the label beside it; a manager had
 * no reason to believe the kitchen name was interactive, so the menu (and the "Add Kitchen" command
 * that only lives inside it) was never found.
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
  "group inline-flex h-9 max-w-[22rem] items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm transition-colors hover:bg-muted/60 data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

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
  "gap-2 focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground";

export function KitchenSwitcher({
  kitchens,
  activeKitchenId,
  onSelect,
  onAddKitchen,
}: KitchenSwitcherProps) {
  const active = kitchens.find((kitchen) => kitchen.id === activeKitchenId);
  if (!active) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={TRIGGER}>
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold text-primary"
          >
            {active.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="truncate font-medium">{active.name}</span>
          <ChevronsUpDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground"
          />
        </button>
      </DropdownMenuTrigger>

      {/*
       * `align="start"` because the trigger sits at the start of the banner; Radix flips it when
       * there is no room. The label stays in the open menu on purpose — NN/g: "Keep the menu label
       * or description in view when the dropdown is open", so the reader is never asked to remember
       * what they are choosing between.
       */}
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{mt("kitchen")}</DropdownMenuLabel>
        {kitchens.map((kitchen) => (
          <DropdownMenuItem
            key={kitchen.id}
            onSelect={() => onSelect(kitchen.id)}
            className={ITEM}
          >
            <Check
              aria-hidden="true"
              className={cn(CHECK, kitchen.id !== activeKitchenId && "opacity-0")}
            />
            {/*
             * The current kitchen is marked by the check AND by the weight of its name, so the
             * selection is legible at a glance rather than only by spotting a small tick.
             */}
            <span className={cn("truncate", kitchen.id === activeKitchenId && "font-medium")}>
              {kitchen.name}
            </span>
          </DropdownMenuItem>
        ))}

        {/*
         * Rendered for EVERY kitchen count, including one. With a single kitchen this is the only
         * command in the menu, and it is the page's only route to creating a second one — hiding it
         * would strand a manager who has exactly one kitchen.
         */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddKitchen} className={ITEM}>
          <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
          {mt("addKitchen")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default KitchenSwitcher;
