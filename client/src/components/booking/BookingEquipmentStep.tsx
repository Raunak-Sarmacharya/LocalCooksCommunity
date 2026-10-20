/**
 * Booking step 3: optional rentals as add-on cards (Turo Extras, Peerspace add-ons): each says its price and unit and
 * toggles with one tap; the choice can be changed until the booking is sent. Included equipment is one line with a
 * "See all" list, not a second wall of cards. Many rentals get a search and category filter. On a multi-day booking an
 * added item shows its days, so the chef can drop it from a day (only days it's free are offered).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { resolveEquipmentIcon } from "@/lib/kitchen-inventory-icons";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogHeader } from "@/components/ui/app-dialog";

export type BookingEquipment = { id: number; equipmentType?: string | null; category?: string | null; brand?: string | null;
  description?: string | null; condition?: string | null; sessionRate: number };
export type EquipmentDay = { date: string; label: string; free: boolean; chosen: boolean };

const SEARCH_FROM = 7;
export const equipmentLabel = (item: BookingEquipment) => String(item.equipmentType || "").toLowerCase()
  .replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()).trim();

export function BookingEquipmentStep({ included, rental, selectedIds, onToggle, daysFor, onToggleDay, loading, footer }: {
  included: BookingEquipment[];
  rental: BookingEquipment[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  /** Multi-day only: the booking's days for one rental. */
  daysFor?: (id: number) => EquipmentDay[];
  onToggleDay?: (id: number, date: string) => void;
  loading?: boolean;
  footer?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation("booking");
  const money = (cents: number) => formatCurrency(cents, "CAD", i18n.language);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [includedOpen, setIncludedOpen] = useState(false);
  const categories = useMemo(() => Array.from(new Set(rental.map(item => item.category).filter(Boolean) as string[])), [rental]);
  const many = rental.length >= SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shown = rental.filter(item => (!category || item.category === category)
    && (!needle || [equipmentLabel(item), item.brand, item.description].some(text => text?.toLowerCase().includes(needle))));
  const added = rental.filter(item => selectedIds.includes(item.id));
  const addedTotal = added.reduce((sum, item) => sum + item.sessionRate * (daysFor ? daysFor(item.id).filter(day => day.chosen).length : 1), 0);

  if (loading) return <div className="flex justify-center py-12" role="status" aria-label={t("sheetLoadingSlotsText")}>
    <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#E10939]" aria-hidden /></div>;

  return <div className="space-y-5">
    <div>
      <h3 className="text-base font-semibold text-gray-900">{t("bkEqTitle")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{rental.length ? t("bkEqIntro") : t("bkEqIntroNoRentals")}</p>
    </div>

    {included.length > 0 && <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Check className="h-4 w-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{t("bkEqIncluded", { count: included.length })}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{included.map(equipmentLabel).join(" · ")}</p>
      </div>
      {included.length > 3 && <button type="button" onClick={() => setIncludedOpen(true)}
        className="shrink-0 text-sm font-medium text-[#E10939] hover:underline">{t("bkEqSeeAll")}</button>}
    </div>}

    {rental.length > 0 && <section aria-labelledby="eq-rentals" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="eq-rentals" className="text-sm font-semibold text-gray-900">{t("bkEqRentals")}</h4>
        {added.length > 0 && <p className="text-sm text-gray-700" aria-live="polite">{t("bkEqAddedTotal", { count: added.length, amount: money(addedTotal) })}</p>}
      </div>
      {many && <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("bkEqSearch")} aria-label={t("bkEqSearch")} className="h-11 pl-9" />
        </div>
        {categories.length > 1 && <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("bkEqCategory")}>
          {[null, ...categories].map(value => <button key={value ?? "all"} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}
            className={cn("min-h-9 rounded-full border px-3 text-xs font-medium", category === value ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300")}>
            {value ? t(`bkEqCat_${value}`, { defaultValue: value }) : t("bkEqAll")}
          </button>)}
        </div>}
      </div>}

      <ul className="space-y-2.5">
        {shown.map(item => {
          const on = selectedIds.includes(item.id);
          const days = on && daysFor ? daysFor(item.id) : [];
          const detail = [item.brand?.trim(), item.condition ? t(`bkEqCond_${item.condition}`, { defaultValue: "" }) : ""].filter(Boolean).join(" · ");
          return <li key={item.id} className={cn("rounded-2xl border bg-white p-3 transition-colors", on ? "border-[#E10939] ring-1 ring-[#E10939]/20" : "border-gray-200")}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#E10939]">
                <Icon icon={resolveEquipmentIcon(item.equipmentType ?? "", item.category ?? "")} width={20} height={20} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">{equipmentLabel(item)}</span>
                <span className="block truncate text-xs text-muted-foreground">{t("bkEqPerDay", { amount: money(item.sessionRate) })}{detail ? ` · ${detail}` : ""}</span>
              </span>
              <button type="button" aria-pressed={on} onClick={() => onToggle(item.id)}
                aria-label={t(on ? "bkEqRemoveNamed" : "bkEqAddNamed", { name: equipmentLabel(item) })}
                className={cn("inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-medium transition-colors",
                  on ? "border-[#E10939] bg-[#E10939] text-white hover:bg-[#c90832]" : "border-gray-300 bg-white text-gray-900 hover:border-gray-900")}>
                {on ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{t(on ? "bkEqAdded" : "bkEqAdd")}
              </button>
            </div>
            {item.description?.trim() && <p className="mt-2 line-clamp-2 text-xs text-gray-600">{item.description.trim()}</p>}
            {days.length > 1 && onToggleDay && <div className="mt-3 border-t border-gray-100 pt-2.5">
              <p className="mb-1.5 text-xs font-medium text-gray-600">{t("bkEqDays")}</p>
              <div className="flex flex-wrap gap-1.5">{days.map(day => <button key={day.date} type="button" disabled={!day.free}
                aria-pressed={day.chosen} onClick={() => onToggleDay(item.id, day.date)} title={day.free ? undefined : t("bkEqNotFreeDay")}
                className={cn("min-h-8 rounded-full border px-2.5 text-xs font-medium", !day.free ? "cursor-not-allowed border-dashed border-gray-200 text-gray-400 line-through"
                  : day.chosen ? "border-[#E10939] bg-[#FFF3F5] text-[#E10939]" : "border-gray-200 text-gray-600 hover:border-gray-300")}>
                {day.label}</button>)}</div>
            </div>}
          </li>;
        })}
      </ul>
      {!shown.length && <p className="text-sm text-muted-foreground">{t("bkEqNoMatch")}</p>}
    </section>}

    {footer}

    <Dialog open={includedOpen} onOpenChange={setIncludedOpen}>
      <AppDialogContent className="sm:max-w-lg">
        <AppDialogHeader title={t("bkEqIncluded", { count: included.length })} description={t("sheetIncludedEquipmentDesc")} />
        <AppDialogBody>
          <ul className="divide-y divide-gray-100">{included.map(item => <li key={item.id} className="flex items-center gap-3 py-2.5">
            <Icon icon={resolveEquipmentIcon(item.equipmentType ?? "", item.category ?? "")} width={18} height={18} className="text-[#E10939]" aria-hidden />
            <span className="text-sm text-gray-900">{equipmentLabel(item)}</span>
          </li>)}</ul>
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  </div>;
}
