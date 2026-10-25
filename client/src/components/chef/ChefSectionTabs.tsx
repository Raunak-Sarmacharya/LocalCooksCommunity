import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { chefNavOwner } from "@/lib/chef-nav-sections";
import { cn } from "@/lib/utils";

/** The pages of one sidebar item as tabs (Kitchens: Find · My kitchens · Tours). Shows only when there is more than one. */
export function ChefSectionTabs({ activeView, hiddenItems, onSelect }: { activeView: string; hiddenItems: string[]; onSelect: (view: string) => void }) {
  const { t } = useTranslation("chef");
  const tr = t as unknown as TFunction;
  const owner = chefNavOwner(activeView);
  if (!owner?.members?.length) return null;
  const tabs = [{ id: owner.id, labelKey: owner.tabLabelKey || owner.labelKey }, ...owner.members.filter((m) => !hiddenItems.includes(m.id) || m.id === activeView)];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={tr(owner.labelKey as never)} className="-mt-1 mb-5 flex gap-5 overflow-x-auto border-b [scrollbar-width:none]">
      {tabs.map((tab) => {
        const on = tab.id === activeView;
        return (
          <button key={tab.id} type="button" onClick={() => onSelect(tab.id)} aria-current={on ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors", on ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {tr(tab.labelKey as never)}
          </button>
        );
      })}
    </nav>
  );
}
