import { useState, useMemo, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, calendarRangeCellClass, calendarRangeDayClass, calendarRangeDayModifiers } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolveStorageIcon } from "@/lib/kitchen-inventory-icons";
import { Icon } from "@iconify/react";
import { chefPrimaryCtaClass } from "@/lib/chef-cta";
import type { DateRange } from "react-day-picker";
import { format, differenceInDays, isBefore, startOfDay, startOfToday } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────

interface StorageListing {
  id: number;
  name: string;
  storageType: "dry" | "cold" | "freezer";
  description?: string;
  basePrice: number; // Daily rate in cents
  minimumBookingDuration: number; // Minimum days required
  climateControl?: boolean;
  isActive?: boolean;
  photos?: string[];
}

interface SelectedStorage {
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}

interface StorageSelectionProps {
  storageListings: StorageListing[];
  selectedStorage: SelectedStorage[];
  onSelectionChange: (selections: SelectedStorage[]) => void;
  kitchenBookingDate?: Date; // Suggested start date
}

/** How many cards to show inline before "Show all" — keeps the booking step short. */
const STORAGE_PREVIEW_COUNT = 4;

function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function calculatePrice(
  listing: StorageListing,
  range: DateRange | undefined
): { days: number; total: number } | null {
  if (!range?.from || !range?.to) return null;
  // Inclusive calendar days (Sep 9–11 = 3), not overnight gaps.
  const days = differenceInDays(range.to, range.from) + 1;
  const minDays = listing.minimumBookingDuration || 1;
  const effectiveDays = Math.max(days, minDays);
  return { days: effectiveDays, total: listing.basePrice * effectiveDays };
}

function typeLabelKey(storageType: StorageListing["storageType"]) {
  if (storageType === "freezer") return "storageSelFreezer";
  if (storageType === "cold") return "storageSelRefrigerator";
  return "storageSelDryStorage";
}

// ── Component ────────────────────────────────────────────────────────────────

export function StorageSelection({
  storageListings,
  selectedStorage,
  onSelectionChange,
  kitchenBookingDate,
}: StorageSelectionProps) {
  const { t } = useTranslation("booking");

  const validateRange = useCallback(
    (listing: StorageListing, range: DateRange | undefined, minDate: Date): string | null => {
      if (!range?.from) return null;
      if (isBefore(range.from, minDate)) return t("storageSelStartDatePast");
      if (!range.to) return null;
      if (isBefore(range.to, range.from)) return t("storageSelEndBeforeStart");
      const days = differenceInDays(range.to, range.from) + 1;
      const minDays = listing.minimumBookingDuration || 1;
      if (days < minDays) {
        return t("storageSelMinDaysRequired", { minDays });
      }
      return null;
    },
    [t]
  );

  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [pendingRanges, setPendingRanges] = useState<
    Record<number, DateRange | undefined>
  >({});
  /** Controlled month per listing — prevents DayPicker remount/reset flicker while picking a range. */
  const [calendarMonthById, setCalendarMonthById] = useState<Record<number, Date>>({});

  const activeListings = useMemo(
    () => storageListings.filter((l) => l.isActive !== false),
    [storageListings]
  );

  const needsShowAll = activeListings.length > STORAGE_PREVIEW_COUNT;

  // Keep selected units visible in the preview, fill remaining slots with others
  const previewListings = useMemo(() => {
    if (!needsShowAll) return activeListings;
    const selectedIds = new Set(selectedStorage.map((s) => s.storageListingId));
    const selected = activeListings.filter((l) => selectedIds.has(l.id));
    const rest = activeListings.filter((l) => !selectedIds.has(l.id));
    const out: StorageListing[] = [];
    const seen = new Set<number>();
    for (const listing of [...selected, ...rest]) {
      if (seen.has(listing.id)) continue;
      seen.add(listing.id);
      out.push(listing);
      if (out.length >= STORAGE_PREVIEW_COUNT) break;
    }
    return out;
  }, [activeListings, needsShowAll, selectedStorage]);

  // Stable for the session so `disabled` doesn't churn every render and flicker the grid.
  const minDate = useMemo(() => startOfToday(), []);
  const defaultMonth = useMemo(
    () => monthStart(kitchenBookingDate ? startOfDay(kitchenBookingDate) : minDate),
    [kitchenBookingDate, minDate]
  );

  const isDateDisabled = useCallback(
    (date: Date) => isBefore(date, minDate),
    [minDate]
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleOpenPopover = (listingId: number) => {
    const existing = selectedStorage.find(
      (s) => s.storageListingId === listingId
    );
    setPendingRanges((prev) => ({
      ...prev,
      [listingId]: existing
        ? { from: existing.startDate, to: existing.endDate }
        : undefined,
    }));
    setCalendarMonthById((prev) => ({
      ...prev,
      [listingId]: monthStart(existing?.startDate || defaultMonth),
    }));
    setOpenPopoverId(listingId);
  };

  const handleClosePopover = () => {
    setOpenPopoverId(null);
  };

  const handleRangeSelect = (
    listingId: number,
    range: DateRange | undefined,
    selectedDay: Date | undefined
  ) => {
    const current = pendingRanges[listingId];
    let newRange = range;
    // Starting a new range after a complete one — keep the clicked day as the new start.
    if (current?.from && current?.to && selectedDay) {
      newRange = { from: selectedDay, to: undefined };
    }
    setPendingRanges((prev) => ({ ...prev, [listingId]: newRange }));
  };

  const handleConfirm = (listingId: number) => {
    const listing = activeListings.find((l) => l.id === listingId);
    const range = pendingRanges[listingId];
    if (!listing || !range?.from || !range?.to) return;
    if (validateRange(listing, range, minDate)) return;

    const newSelection: SelectedStorage = {
      storageListingId: listingId,
      startDate: range.from,
      endDate: range.to,
    };

    const idx = selectedStorage.findIndex(
      (s) => s.storageListingId === listingId
    );
    if (idx >= 0) {
      const updated = [...selectedStorage];
      updated[idx] = newSelection;
      onSelectionChange(updated);
    } else {
      onSelectionChange([...selectedStorage, newSelection]);
    }
    setOpenPopoverId(null);
  };

  const handleRemove = (listingId: number) => {
    onSelectionChange(
      selectedStorage.filter((s) => s.storageListingId !== listingId)
    );
    setPendingRanges((prev) => {
      const next = { ...prev };
      delete next[listingId];
      return next;
    });
  };

  // ── Shared calendar popover content ──────────────────────────────────────

  const renderCalendarContent = (storage: StorageListing) => {
    const range = pendingRanges[storage.id];
    const error = validateRange(storage, range, minDate);
    const price = calculatePrice(storage, range);
    const minDays = storage.minimumBookingDuration || 1;
    const isEdit = selectedStorage.some(
      (s) => s.storageListingId === storage.id
    );
    const month = calendarMonthById[storage.id] ?? defaultMonth;

    return (
      <div className="flex w-72 flex-col">
        <div className="border-b border-border px-3 pb-2 pt-3">
          <p className="text-sm font-medium text-foreground">{storage.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("storageSelMinDaysPrice", {
              minDays,
              price: formatCents(storage.basePrice),
            })}
          </p>
        </div>

        <Calendar
          mode="range"
          selected={range}
          onSelect={(r: DateRange | undefined, day: Date) =>
            handleRangeSelect(storage.id, r, day)
          }
          numberOfMonths={1}
          month={month}
          onMonthChange={(next) =>
            setCalendarMonthById((prev) => ({
              ...prev,
              [storage.id]: monthStart(next),
            }))
          }
          disabled={isDateDisabled}
          className="mx-auto w-full px-2 py-2"
          classNames={{
            months: "flex w-full flex-col",
            month: "w-full space-y-2",
            caption: "relative flex w-full items-center justify-center pt-0.5",
            caption_label: "text-sm font-medium",
            table: "w-full table-fixed border-collapse",
            head_cell:
              "w-[14.28%] pb-1 text-center text-[0.7rem] font-normal text-muted-foreground",
            cell: calendarRangeCellClass,
            day: calendarRangeDayClass,
            ...calendarRangeDayModifiers,
          }}
        />

        <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <Icon icon="mdi:alert-circle-outline" className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {range?.from && !range?.to && (
            <p className="text-xs text-muted-foreground text-center py-1">
              {t("storageSelClickEndDate")}
            </p>
          )}

          {price && !error && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground">
                {t("storageSelDaysTimesPrice", {
                  days: price.days,
                  price: formatCents(storage.basePrice),
                })}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatCents(price.total)}
              </span>
            </div>
          )}

          <Button
            size="sm"
            className={chefPrimaryCtaClass("w-full")}
            disabled={!range?.from || !range?.to || !!error}
            onClick={() => handleConfirm(storage.id)}
          >
            <Icon icon="mdi:check" className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            {isEdit ? t("storageSelUpdateDates") : t("storageSelAddStorage")}
          </Button>
        </div>
      </div>
    );
  };

  const renderDatePopover = (
    storage: StorageListing,
    opts: { align: "start" | "end"; trigger: ReactNode }
  ) => (
    <Popover
      // Nested inside the "Show all" Dialog — modal popovers fight the dialog
      // focus trap and make the calendar open/close/jump on each click.
      modal={false}
      open={openPopoverId === storage.id}
      onOpenChange={(open) => {
        if (open) handleOpenPopover(storage.id);
        else handleClosePopover();
      }}
    >
      <PopoverTrigger asChild>{opts.trigger}</PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align={opts.align}
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {renderCalendarContent(storage)}
      </PopoverContent>
    </Popover>
  );

  const renderCard = (storage: StorageListing) => {
    const isSelected = selectedStorage.some(
      (s) => s.storageListingId === storage.id
    );
    const selection = selectedStorage.find(
      (s) => s.storageListingId === storage.id
    );
    const minDays = storage.minimumBookingDuration || 1;
    const selectionPrice = selection
      ? calculatePrice(storage, {
          from: selection.startDate,
          to: selection.endDate,
        })
      : null;
    const typeText = t(typeLabelKey(storage.storageType));

    return (
      <div
        key={storage.id}
        className={cn(
          "rounded-xl border px-3 py-2.5 transition-colors",
          isSelected
            ? "border-[#F51042]/40 bg-[#F51042]/[0.03]"
            : "border-gray-200 bg-white"
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] text-[#F51042]">
            <Icon
              icon={resolveStorageIcon(storage.storageType, storage.name)}
              width={16}
              height={16}
              className="text-[#F51042]"
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{storage.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {typeText}
                  {storage.climateControl ? ` · ${t("storageSelClimateCtrl")}` : ""}
                  {` · ${t("storageSelMinDaysShort", { minDays })}`}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-900 shrink-0">
                {formatCents(storage.basePrice)}
                <span className="text-xs font-normal text-muted-foreground">
                  {t("storageSelPerDay")}
                </span>
              </p>
            </div>

            <div className="mt-2">
              {isSelected && selection ? (
                <div className="flex items-center justify-between gap-2 rounded-md bg-primary/5 border border-primary/10 pl-2 pr-0.5 py-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Icon icon="mdi:check" className="h-3.5 w-3.5 text-primary flex-shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-900">
                        {format(selection.startDate, "MMM d")} &mdash;{" "}
                        {format(selection.endDate, "MMM d")}
                      </p>
                      {selectionPrice && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatCents(selectionPrice.total)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-shrink-0">
                    {renderDatePopover(storage, {
                      align: "end",
                      trigger: (
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                        </Button>
                      ),
                    })}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(storage.id)}
                    >
                      <Icon icon="mdi:close" className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : (
                renderDatePopover(storage, {
                  align: "start",
                  trigger: (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-xs h-8 font-normal text-muted-foreground hover:text-foreground"
                    >
                      <Icon icon="mdi:calendar-month-outline" className="h-3.5 w-3.5 mr-2" aria-hidden />
                      {t("storageSelSelectDates")}
                    </Button>
                  ),
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGrid = (listings: StorageListing[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{listings.map(renderCard)}</div>
  );

  if (activeListings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <Icon icon="mdi:archive-outline" className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" aria-hidden />
        <p className="text-sm text-muted-foreground">{t("storageSelNoStorage")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {renderGrid(previewListings)}

      {needsShowAll && (
        <>
          <button
            type="button"
            className="inline-flex items-center text-sm font-medium text-[#F51042] hover:text-[#d10e39]"
            onClick={() => setShowAllOpen(true)}
          >
            {t("storageSelShowAll", {
              count: activeListings.length,
              defaultValue: `Show all ${activeListings.length} storage options`,
            })}
            <Icon icon="mdi:chevron-right" className="ml-0.5 h-4 w-4" aria-hidden />
          </button>

          <Dialog open={showAllOpen} onOpenChange={setShowAllOpen}>
            <DialogContent className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
              <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
                <DialogTitle>
                  {t("storageSelAllTitle", "Storage options")}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    "storageSelAllDesc",
                    "Pick fridge, freezer, or dry storage and set your dates."
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {renderGrid(activeListings)}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
