import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveEquipmentIcon, resolveStorageIcon } from "@/lib/kitchen-inventory-icons";
export interface EquipmentListing {
  id: number;
  category: string;
  equipmentType: string;
  brand?: string;
  model?: string;
  description?: string | null;
  availabilityType: 'included' | 'rental';
  sessionRate?: number; // Flat per-session rate in dollars (converted from cents)
  currency?: string;
}

export interface StorageListing {
  id: number;
  storageType: string;
  name: string;
  description?: string;
  basePrice?: number;
  pricePerCubicFoot?: number;
  pricingModel: string;
  dimensionsLength?: number;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  totalVolume?: number;
  climateControl?: boolean;
  currency?: string;
}

type PublicKitchen = { equipment?: { included: EquipmentListing[]; rental: EquipmentListing[] }; storage?: StorageListing[] };
function PreviewIcon({
  icon,
  className,
  size = 16,
}: {
  icon: string;
  className?: string;
  size?: number;
}) {
  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    />
  );
}

const ADDON_PREVIEW_COUNT = 18;


function titleCaseLabel(value: string, t?: any) {
  const formatted = value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
  return t ? t("dbEnum_" + value.toLowerCase(), { defaultValue: formatted }) : formatted;
}

function groupByCategory(items: EquipmentListing[]) {
  const groups = new Map<string, EquipmentListing[]>();
  for (const item of items) {
    const key = (item.category || "").trim() || "General";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries());
}

function ExpandableInventory({

  itemCount,
  children,
  alwaysExpanded = false,
}: {
  itemCount: number;
  children: (visibleCount: number) => ReactNode;
  alwaysExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = !alwaysExpanded && itemCount > ADDON_PREVIEW_COUNT;
  const visibleCount = !needsToggle || expanded ? itemCount : ADDON_PREVIEW_COUNT;
  const hiddenCount = itemCount - ADDON_PREVIEW_COUNT;
  const { t } = useTranslation("kitchen");

  return (
    <div>
      {children(visibleCount)}
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-[#F51042]"
        >
          <PreviewIcon icon="mdi:chevron-down" size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          {expanded ? t("showLess", "Show less") : t("viewAllAndMore", { itemCount, hiddenCount, defaultValue: `View all ${itemCount} · ${hiddenCount} more` })}
        </button>
      )}
    </div>
  );
}

function InventoryTypeIcon({ icon }: { icon: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] text-[#F51042]">
      <Icon icon={icon} width={16} height={16} className="text-[#F51042]" aria-hidden />
    </span>
  );
}

function NameCell({ name, hint }: { name: string; hint?: string }) {
  const showHint =
    Boolean(hint?.trim()) && !name.toLowerCase().includes(hint!.trim().toLowerCase());

  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]">
      <span className="min-w-0 break-words text-sm text-gray-900">{name}</span>
      {showHint ? (
        <span className="hidden min-w-0 break-words text-xs text-gray-400 sm:inline">{hint}</span>
      ) : null}
    </span>
  );
}

function PriceCell({ amount, unit }: { amount: string; unit: string }) {
  return (
    <span className="shrink-0 text-sm text-gray-900">
      {amount}
      <span className="ml-1 text-xs font-normal text-gray-400">{unit}</span>
    </span>
  );
}

function CompactList({ children, columns = 1 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <ul
      className={cn(
        "min-w-0",
        columns === 2
          ? "grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6"
          : "divide-y divide-gray-100"
      )}
    >
      {children}
    </ul>
  );
}

function IncludedEquipmentList({
  items,
  alwaysExpanded,
  columns = 1,
}: {
  items: EquipmentListing[];
  alwaysExpanded?: boolean;
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const groups = groupByCategory(items);
  const showGroups = groups.length > 1;
  let rendered = 0;

  return (
    <ExpandableInventory itemCount={items.length} alwaysExpanded={alwaysExpanded}>
      {(visibleCount) => (
        <div className="space-y-3">
          {groups.map(([category, groupItems]) => {
            const remaining = visibleCount - rendered;
            if (remaining <= 0) return null;
            const visible = groupItems.slice(0, remaining);
            rendered += visible.length;

            return (
              <div key={category}>
                {showGroups && (
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                    {titleCaseLabel(category, t)}
                  </p>
                )}
                <CompactList columns={columns}>
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center gap-2 py-1.5"
                    >
                      <InventoryTypeIcon
                        icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                      />
                      <NameCell
                        name={titleCaseLabel(item.equipmentType, t)}
                        hint={[item.brand, item.model].filter(Boolean).join(" ")}
                      />
                    </li>
                  ))}
                </CompactList>
              </div>
            );
          })}
        </div>
      )}
    </ExpandableInventory>
  );
}

function PricedRow({
  name,
  hint,
  amount,
  unit,
  icon,
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
  icon?: string;
}) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        {icon ? <InventoryTypeIcon icon={icon} /> : null}
        <NameCell name={name} hint={hint} />
      </span>
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

function InventoryPreviewRow({
  name,
  hint,
  amount,
  unit,
  icon,
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
  icon?: string;
}) {
  return (
    <li className="flex min-h-8 min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        {icon ? <InventoryTypeIcon icon={icon} /> : null}
        <span className="min-w-0">
          <span className="block truncate text-sm text-gray-900">{name}</span>
          {hint ? (
            <span className="hidden truncate text-xs text-gray-400 sm:block">{hint}</span>
          ) : null}
        </span>
      </span>
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

export function KitchenEquipmentSections({
  kitchen,
  alwaysExpanded,
  maxVisible,
  previewPerSection,
  section = "all",
  columns = 1,
}: {
  kitchen: PublicKitchen;
  alwaysExpanded?: boolean;
  maxVisible?: number;
  /** Cap each Included / Available-to-rent list while keeping section headers. */
  previewPerSection?: number;
  /** Show only included, only rentals, or both. */
  section?: "included" | "rental" | "all";
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const includedAll = section === "rental" ? [] : kitchen.equipment?.included ?? [];
  const rentalAll = section === "included" ? [] : kitchen.equipment?.rental ?? [];

  if (maxVisible != null) {
    const previewItems = [...includedAll, ...rentalAll].slice(0, maxVisible);
    return (
      <CompactList>
        {previewItems.map((item) => (
          <InventoryPreviewRow
            key={item.id}
            icon={resolveEquipmentIcon(item.equipmentType, item.category)}
            name={titleCaseLabel(item.equipmentType, t)}
            hint={[item.brand, item.model].filter(Boolean).join(" ") || undefined}
            amount={
              item.availabilityType === "rental" && item.sessionRate && item.sessionRate > 0
                ? `$${item.sessionRate.toFixed(2)}`
                : undefined
            }
            unit={
              item.availabilityType === "rental" && item.sessionRate && item.sessionRate > 0
                ? "/session"
                : undefined
            }
          />
        ))}
      </CompactList>
    );
  }

  const included = includedAll;
  const rental = rentalAll;
  const skipToggle = !!alwaysExpanded;
  const includedPreview =
    previewPerSection != null ? included.slice(0, previewPerSection) : included;
  const rentalPreview =
    previewPerSection != null ? rental.slice(0, previewPerSection) : rental;
  const includedList = previewPerSection != null ? includedPreview : included;
  const rentalList = previewPerSection != null ? rentalPreview : rental;

  return (
    <div className="space-y-3">
      {included.length > 0 && (
        <div>
          {section === "all" && (
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("comesWithBooking", "Included")}
              </h3>
              <span className="text-xs text-gray-400">{includedAll.length}</span>
            </div>
          )}
          {previewPerSection != null ? (
            <CompactList>
              {includedList.map((item) => (
                <li key={item.id} className="flex min-w-0 items-center gap-2 py-1.5">
                  <InventoryTypeIcon
                    icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                  />
                  <NameCell
                    name={titleCaseLabel(item.equipmentType, t)}
                    hint={[item.brand, item.model].filter(Boolean).join(" ")}
                  />
                </li>
              ))}
            </CompactList>
          ) : (
            <IncludedEquipmentList items={included} alwaysExpanded={skipToggle} columns={columns} />
          )}
        </div>
      )}

      {rental.length > 0 && (
        <div>
          {section === "all" && (
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("optionalRentals", "Optional Rentals")}
              </h3>
              <span className="text-xs text-gray-400">{rentalAll.length}</span>
            </div>
          )}
          {previewPerSection != null ? (
            <CompactList>
              {rentalList.map((item) => (
                <PricedRow
                  key={item.id}
                  icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                  name={titleCaseLabel(item.equipmentType, t)}
                  hint={[item.brand, item.model].filter(Boolean).join(" ")}
                  amount={
                    item.sessionRate && item.sessionRate > 0
                      ? `$${item.sessionRate.toFixed(2)}`
                      : undefined
                  }
                  unit={item.sessionRate && item.sessionRate > 0 ? "/session" : undefined}
                />
              ))}
            </CompactList>
          ) : (
            <ExpandableInventory itemCount={rental.length} alwaysExpanded={skipToggle}>
              {(visibleCount) => (
                <CompactList columns={columns}>
                  {rental.slice(0, visibleCount).map((item) => (
                    <PricedRow
                      key={item.id}
                      icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                      name={titleCaseLabel(item.equipmentType, t)}
                      hint={[item.brand, item.model].filter(Boolean).join(" ")}
                      amount={
                        item.sessionRate && item.sessionRate > 0
                          ? `$${item.sessionRate.toFixed(2)}`
                          : undefined
                      }
                      unit={item.sessionRate && item.sessionRate > 0 ? "/session" : undefined}
                    />
                  ))}
                </CompactList>
              )}
            </ExpandableInventory>
          )}
        </div>
      )}
    </div>
  );
}

export function KitchenStorageSections({
  kitchen,
  maxVisible,
  alwaysExpanded = false,
  columns = 1,
}: {
  kitchen: PublicKitchen;
  maxVisible?: number;
  alwaysExpanded?: boolean;
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const storageAll = kitchen.storage ?? [];

  const unitFor = (item: StorageListing) => {
    if (item.pricingModel === "per-cubic-foot" || item.pricingModel === "per_cubic_foot") return "base";
    if (item.pricingModel === "hourly") return "/hr";
    if (item.pricingModel === "monthly-flat") return "/mo";
    return "/day";
  };

  if (maxVisible != null) {
    return (
      <CompactList>
        {storageAll.slice(0, maxVisible).map((item) => (
          <InventoryPreviewRow
            key={item.id}
            icon={resolveStorageIcon(item.storageType, item.name)}
            name={item.name || titleCaseLabel(item.storageType, t)}
            hint={item.name ? titleCaseLabel(item.storageType, t) : undefined}
            amount={
              item.basePrice !== undefined && item.basePrice > 0
                ? `$${item.basePrice.toFixed(2)}`
                : undefined
            }
            unit={
              item.basePrice !== undefined && item.basePrice > 0 ? unitFor(item) : undefined
            }
          />
        ))}
      </CompactList>
    );
  }

  const storage = storageAll;
  const skipToggle = !!alwaysExpanded;

  return (
    <ExpandableInventory itemCount={storage.length} alwaysExpanded={skipToggle}>
      {(visibleCount) => (
        <CompactList columns={columns}>
          {storage.slice(0, visibleCount).map((item) => (
            <PricedRow
              key={item.id}
              icon={resolveStorageIcon(item.storageType, item.name)}
              name={item.name || titleCaseLabel(item.storageType, t)}
              hint={item.name ? titleCaseLabel(item.storageType, t) : undefined}
              amount={
                item.basePrice !== undefined && item.basePrice > 0
                  ? `$${item.basePrice.toFixed(2)}`
                  : undefined
              }
              unit={
                item.basePrice !== undefined && item.basePrice > 0 ? unitFor(item) : undefined
              }
            />
          ))}
        </CompactList>
      )}
    </ExpandableInventory>
  );
}

export function InventoryShowAllButton({
  count,
  label,
  onClick,
}: {
  count: number;
  label: string;
  onClick: () => void;
}) {
  const { t } = useTranslation("kitchen");
  return (
    <button
      type="button"
      className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-[#F51042] hover:text-[#d10e39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]"
      onClick={onClick}
    >
      {t("showAllCount", { count, label: t(label, { defaultValue: label }), defaultValue: `Show all ${count} ${label}` })}
      <PreviewIcon icon="mdi:chevron-right" size={16} className="ml-0.5" />
    </button>
  );
}

export function InventoryModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  stacked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  /** Raise above another open dialog (e.g. equipment info). */
  stacked?: boolean;
}) {
  const { t } = useTranslation("kitchen");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollMore, setCanScrollMore] = useState(false);
  const [canScrollBack, setCanScrollBack] = useState(false);

  const updateScrollHint = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollMore(false);
      return;
    }
    setCanScrollMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    setCanScrollBack(el.scrollTop > 8);
  }, []);

  useEffect(() => {
    if (!open) {
      setCanScrollMore(false);
      return;
    }

    let cancelled = false;
    let el: HTMLDivElement | null = null;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;

    const attach = () => {
      el = scrollRef.current;
      if (!el || cancelled) return;

      updateScrollHint();
      ro = new ResizeObserver(updateScrollHint);
      ro.observe(el);
      mo = new MutationObserver(updateScrollHint);
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      el.addEventListener("scroll", updateScrollHint, { passive: true });
    };

    // Wait for dialog open + list layout before measuring overflow.
    const raf = requestAnimationFrame(() => {
      attach();
      requestAnimationFrame(updateScrollHint);
    });
    const timer = window.setTimeout(() => {
      if (!el) attach();
      updateScrollHint();
    }, 50);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro?.disconnect();
      mo?.disconnect();
      el?.removeEventListener("scroll", updateScrollHint);
    };
  }, [open, children, updateScrollHint]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName={stacked ? "z-[60]" : undefined}
        className={cn(
          "flex max-h-[85dvh] w-[min(100vw-1.5rem,32rem)] flex-col gap-0 overflow-hidden p-0 [overflow-wrap:anywhere] sm:max-w-lg",
          stacked && "z-[60]"
        )}
      >
        <DialogHeader className="min-w-0 shrink-0 space-y-1 border-b border-gray-100 px-4 pb-3 pt-4 pr-14 text-left sm:px-5 sm:pb-3.5 sm:pt-5 sm:pr-14">
          <DialogTitle className="text-base sm:text-lg">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            className="scrollbar-none h-full max-h-[min(62dvh,34rem)] min-h-0 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4"
          >
            {children}
          </div>
          {canScrollBack && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-background to-transparent pb-8 pt-1"><PreviewIcon icon="mdi:chevron-up" /></div>}
          {canScrollMore ? (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background from-40% via-background/85 to-transparent pb-1.5 pt-10"
              aria-hidden
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-muted-foreground shadow-sm">
                <Icon icon="mdi:chevron-down" className="h-4 w-4" />
              </span>
            </div>
          ) : null}
          <span className="sr-only">
            {canScrollMore
              ? t("scrollForMore", "Scroll for more")
              : null}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KitchenInventoryModals({ kitchen, openModal, setOpenModal }: {
 kitchen: PublicKitchen;
 openModal: "equipment" | "storage" | null;
 setOpenModal: (modal: "equipment" | "storage" | null) => void;
}) {
 const { t } = useTranslation("kitchen");
 const included = kitchen.equipment?.included ?? [];
 const rental = kitchen.equipment?.rental ?? [];
 return <>
      <InventoryModal
        open={openModal === "equipment"}
        onOpenChange={(open) => setOpenModal(open ? "equipment" : null)}
        title={t("equipment", "Equipment")}
        description={t(
          "equipmentSheetDesc",
          "Included with your booking, plus equipment you can rent by the session."
        )}
      >
        {included.length > 0 && rental.length > 0 ? (
          <Tabs
            defaultValue="included"
            className="w-full"
          >
            <TabsList className="mb-3 h-auto w-full justify-start gap-0 rounded-none border-b border-gray-200 bg-transparent p-0">
              <TabsTrigger
                value="included"
                className="rounded-none border-b-2 border-transparent px-3 py-2 text-sm shadow-none data-[state=active]:border-[#F51042] data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
              >
                {t("comesWithBooking", "Included")}
                <span className="ml-1.5 text-xs text-gray-400">{included.length}</span>
              </TabsTrigger>
              <TabsTrigger
                value="rental"
                className="rounded-none border-b-2 border-transparent px-3 py-2 text-sm shadow-none data-[state=active]:border-[#F51042] data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
              >
                {t("optionalRentals", "Optional Rentals")}
                <span className="ml-1.5 text-xs text-gray-400">{rental.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="included" className="mt-0 focus-visible:ring-0">
              <KitchenEquipmentSections
                kitchen={kitchen}
                section="included"
                alwaysExpanded
                columns={2}
              />
            </TabsContent>
            <TabsContent value="rental" className="mt-0 focus-visible:ring-0">
              <KitchenEquipmentSections
                kitchen={kitchen}
                section="rental"
                alwaysExpanded
                columns={2}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <KitchenEquipmentSections kitchen={kitchen} alwaysExpanded columns={2} />
        )}
      </InventoryModal>

      <InventoryModal
        open={openModal === "storage"}
        onOpenChange={(open) => setOpenModal(open ? "storage" : null)}
        title={t("storage", "Storage")}
        description={t(
          "storageSheetDesc",
          "Dry, cold, and freezer space you can add to your booking."
        )}
      >
        <KitchenStorageSections kitchen={kitchen} alwaysExpanded columns={2} />
      </InventoryModal>

 </>;
}
