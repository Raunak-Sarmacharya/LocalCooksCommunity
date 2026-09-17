import { mt } from "@/i18n/manager";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

/**
 * Which kitchens a storage or equipment listing applies to.
 *
 * A listing belongs to exactly one kitchen (`storage_listings.kitchen_id` is a
 * NOT NULL FK), so "add this to two kitchens" means two independent rows — each
 * with its own price, availability and active flag. This control is where the
 * manager chooses that set; nothing here changes ownership or booking data.
 *
 * Copy differs by mode:
 * - `create` — the current kitchen is pinned (you are on its page) and the rest
 *   are opt-in. `kitchens` is every kitchen at the location.
 * - `edit`   — the current kitchen is already being saved; the list holds only
 *   the *other* kitchens that already have a matching listing, so the manager
 *   can push the same change to them. `kitchens` is the matched subset.
 *
 * Renders nothing when there is nothing to choose — a single-kitchen location
 * never sees this at all, so the common case stays uncluttered.
 *
 * Laid out as a chip row rather than a vertical checklist: it sits in a drawer
 * footer, and every row it added pushed the configure form into a scroll.
 */
export interface ScopeKitchen {
  id: number;
  name: string;
}

interface KitchenScopeFieldProps {
  /** Kitchens to offer. See the mode notes above for what belongs here. */
  kitchens: ScopeKitchen[];
  /** The kitchen currently open in the sidebar. Pinned in `create` mode. */
  selectedKitchenId: number;
  value: number[];
  onChange: (next: number[]) => void;
  mode?: "create" | "edit";
  disabled?: boolean;
}

export function KitchenScopeField({
  kitchens,
  selectedKitchenId,
  value,
  onChange,
  mode = "create",
  disabled,
}: KitchenScopeFieldProps) {
  const pinned = mode === "create" ? selectedKitchenId : null;
  const selectable = kitchens.filter((k) => k.id !== pinned);

  // Nothing to choose: single-kitchen location (create), or no other kitchen
  // holds a matching listing (edit).
  if (selectable.length === 0) return null;

  const selected = new Set(value);
  const allOn = selectable.every((k) => selected.has(k.id));

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {mode === "create" ? mt("scopeAddTo") : mt("scopeAlsoUpdate")}
          </span>
          {" · "}
          {mode === "create" ? mt("scopeAddToHint") : mt("scopeAlsoUpdateHint")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(allOn ? [] : selectable.map((k) => k.id))}
          className="!h-6 !min-h-0 shrink-0 px-2 text-xs"
        >
          {allOn ? mt("scopeOnlyThis") : mt("scopeAll")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pinned != null && (
          <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs">
            <Check className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">{kitchens.find((k) => k.id === pinned)?.name}</span>
            <span className="shrink-0 text-muted-foreground">{mt("scopeThisKitchen")}</span>
          </span>
        )}

        {selectable.map((kitchen) => {
          const checked = selected.has(kitchen.id);
          return (
            <button
              key={kitchen.id}
              type="button"
              disabled={disabled}
              aria-pressed={checked}
              onClick={() => toggle(kitchen.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                checked
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-muted",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              >
                {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </span>
              <span className="truncate">{kitchen.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
