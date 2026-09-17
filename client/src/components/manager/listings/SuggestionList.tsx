import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { PlusCircle, Search } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

/**
 * The platform's suggestions, as a preview list.
 *
 * Selecting an entry only previews it — the caller fills its form and nothing is
 * written until the caller's own submit runs. That is why nothing here is ever
 * disabled: a kitchen can legitimately hold two of the same thing, so "already
 * listed" is shown as a muted note rather than a tick that blocks a second add.
 *
 * No inner scrolling container: it sits in a page column and the page scrolls.
 * A popover could not hold a list this long — it gets clamped to the viewport and
 * the remainder becomes unreachable.
 */
export interface AddSuggestion {
  id: string;
  name: string;
  /** Category heading. Items are grouped in first-seen order. */
  group: string;
  /** Short right-aligned hint, e.g. "$18/day". */
  meta?: string;
  /** Muted note, e.g. "1 already listed". Informational only — never blocks. */
  note?: string;
}

interface SuggestionListProps {
  title: string;
  hint: string;
  searchPlaceholder: string;
  items: AddSuggestion[];
  /** The previewed suggestion, or `null` for "create your own". */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  createOwnLabel: string;
  createOwnHint: string;
  emptyLabel: string;
}

export function SuggestionList({
  title,
  hint,
  searchPlaceholder,
  items,
  selectedId,
  onSelect,
  createOwnLabel,
  createOwnHint,
  emptyLabel,
}: SuggestionListProps) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    const byGroup = new Map<string, AddSuggestion[]>();
    for (const item of matched) {
      const bucket = byGroup.get(item.group);
      if (bucket) bucket.push(item);
      else byGroup.set(item.group, [item]);
    }
    return Array.from(byGroup, ([name, groupItems]) => ({ name, items: groupItems }));
  }, [items, query]);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="max-h-[34rem] overflow-y-auto pr-1">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          groups.map((group) => (
            <div key={group.name}>
              <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.name}
              </p>
              {group.items.map((item) => {
                const active = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      active ? "bg-primary/10 font-medium" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.name}</span>
                      {item.note && (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          {item.note}
                        </span>
                      )}
                    </span>
                    {item.meta && (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {item.meta}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        aria-pressed={selectedId === null}
        onClick={() => onSelect(null)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md border border-dashed px-2 py-2 text-left text-xs transition-colors",
          selectedId === null ? "border-primary/40 bg-primary/10 font-medium" : "hover:bg-muted",
        )}
      >
        <PlusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block">{createOwnLabel}</span>
          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
            {createOwnHint}
          </span>
        </span>
      </button>
    </div>
  );
}
