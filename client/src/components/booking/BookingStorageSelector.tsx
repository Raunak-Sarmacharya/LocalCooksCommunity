import { useMemo, useState } from "react";
import { differenceInDays, format, isBefore, startOfDay, startOfToday } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Icon } from "@iconify/react";
import {
  Calendar,
  calendarRangeCellClass,
  calendarRangeDayClass,
  calendarRangeDayModifiers,
} from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { resolveStorageIcon } from "@/lib/kitchen-inventory-icons";
import { useTranslation } from "react-i18next";
import { BookingPriceSummary } from "./BookingPriceSummary";

interface StorageListing {
  id: number;
  name: string;
  storageType: "dry" | "cold" | "freezer";
  description?: string;
  basePrice: number;
  minimumBookingDuration: number;
  climateControl?: boolean;
  isActive?: boolean;
}

interface SelectedStorage {
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}

interface BookingStorageSelectorProps {
  storageListings: StorageListing[];
  selectedStorage: SelectedStorage[];
  kitchenBookingDate?: Date;
  onSelectionChange: (selections: SelectedStorage[]) => void;
  onDone: () => void;
  onCancel: () => void;
  kitchenSubtotal: number;
  equipmentSubtotal: number;
  taxRatePercent: number;
  serviceFeeRate: number;
  currency?: string;
}

type Stage = "select" | "date-mode" | "dates";
type DateMode = "same" | "different";

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function listingLabel(type: StorageListing["storageType"]) {
  if (type === "freezer") return "Freezer";
  if (type === "cold") return "Refrigerated";
  return "Dry storage";
}

function rangeError(listing: StorageListing, range: DateRange | undefined, minDate: Date) {
  if (!range?.from || !range?.to) return "Choose a start and end date.";
  if (isBefore(range.from, minDate)) return "The start date cannot be in the past.";
  const days = differenceInDays(range.to, range.from) + 1;
  const minimum = listing.minimumBookingDuration || 1;
  if (days < minimum) return `This storage requires at least ${minimum} day${minimum === 1 ? "" : "s"}.`;
  return null;
}

export function BookingStorageSelector({
  storageListings,
  selectedStorage,
  kitchenBookingDate,
  onSelectionChange,
  onDone,
  onCancel,
  kitchenSubtotal,
  equipmentSubtotal,
  taxRatePercent,
  serviceFeeRate,
  currency,
}: BookingStorageSelectorProps) {
  const { t } = useTranslation("booking");
  const activeListings = useMemo(
    () => storageListings.filter((listing) => listing.isActive !== false),
    [storageListings]
  );
  const [stage, setStage] = useState<Stage>("select");
  const [dateMode, setDateMode] = useState<DateMode>("same");
  const [selectedIds, setSelectedIds] = useState<number[]>(() =>
    selectedStorage.map((selection) => selection.storageListingId)
  );
  const [activeDateId, setActiveDateId] = useState<number | null>(
    selectedStorage[0]?.storageListingId ?? null
  );
  const [ranges, setRanges] = useState<Record<number, DateRange | undefined>>(() =>
    Object.fromEntries(
      selectedStorage.map((selection) => [
        selection.storageListingId,
        { from: selection.startDate, to: selection.endDate },
      ])
    )
  );
  const [sameRange, setSameRange] = useState<DateRange | undefined>(() => {
    if (!selectedStorage.length) return undefined;
    const first = selectedStorage[0];
    const allSame = selectedStorage.every(
      (selection) =>
        startOfDay(selection.startDate).getTime() === startOfDay(first.startDate).getTime() &&
        startOfDay(selection.endDate).getTime() === startOfDay(first.endDate).getTime()
    );
    return allSame ? { from: first.startDate, to: first.endDate } : undefined;
  });

  const minDate = useMemo(() => startOfToday(), []);
  const defaultMonth = kitchenBookingDate ? startOfDay(kitchenBookingDate) : minDate;
  const selectedListings = activeListings.filter((listing) => selectedIds.includes(listing.id));
  const currentListing =
    selectedListings.find((listing) => listing.id === activeDateId) ?? selectedListings[0];
  const draftStorageSubtotal = selectedListings.reduce((sum, listing) => {
    const listingRange = dateMode === "same" && stage === "dates" ? sameRange : ranges[listing.id];
    if (!listingRange?.from || !listingRange?.to) return sum;
    const days = Math.max(
      differenceInDays(listingRange.to, listingRange.from) + 1,
      listing.minimumBookingDuration || 1
    );
    return sum + listing.basePrice * days;
  }, 0);

  const priceSummary = (
    <BookingPriceSummary
      kitchenSubtotal={kitchenSubtotal}
      equipmentSubtotal={equipmentSubtotal}
      storageSubtotal={draftStorageSubtotal}
      taxRatePercent={taxRatePercent}
      serviceFeeRate={serviceFeeRate}
      currency={currency}
      focusAddon="storage"
    />
  );

  const toggleStorage = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const proceedFromSelection = () => {
    if (!selectedIds.length) {
      onSelectionChange([]);
      onDone();
      return;
    }
    if (selectedIds.length === 1) {
      setDateMode("different");
      setActiveDateId(selectedIds[0]);
      setStage("dates");
      return;
    }
    setStage("date-mode");
  };

  const saveDates = () => {
    if (dateMode === "same") {
      if (!sameRange?.from || !sameRange?.to) return;
      const hasError = selectedListings.some((listing) => rangeError(listing, sameRange, minDate));
      if (hasError) return;
      onSelectionChange(
        selectedListings.map((listing) => ({
          storageListingId: listing.id,
          startDate: sameRange.from!,
          endDate: sameRange.to!,
        }))
      );
      onDone();
      return;
    }

    const ready = selectedListings.every((listing) => !rangeError(listing, ranges[listing.id], minDate));
    if (!ready) return;
    onSelectionChange(
      selectedListings.map((listing) => ({
        storageListingId: listing.id,
        startDate: ranges[listing.id]!.from!,
        endDate: ranges[listing.id]!.to!,
      }))
    );
    onDone();
  };

  if (stage === "select") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeListings.map((storage) => {
              const selected = selectedIds.includes(storage.id);
              return (
                <button
                  key={storage.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleStorage(storage.id)}
                  className={cn(
                    "flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-all",
                    selected
                      ? "border-[#F51042] bg-[#F51042]/[0.04] ring-1 ring-[#F51042]/20"
                      : "border-gray-200 bg-white hover:border-[#F51042]/40"
                  )}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#F51042]">
                    <Icon
                      icon={resolveStorageIcon(storage.storageType, storage.name)}
                      width={20}
                      height={20}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900">{storage.name}</span>
                      <span className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-[#F51042] bg-[#F51042] text-white" : "border-gray-300"
                      )}>
                        {selected ? (
                          <Icon icon="mdi:check" width={12} height={12} aria-hidden />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {listingLabel(storage.storageType)} · {formatCents(storage.basePrice)}/day
                    </span>
                    <span className="mt-1 block text-[11px] text-gray-500">
                      Min. {storage.minimumBookingDuration || 1} day{(storage.minimumBookingDuration || 1) === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 border-t bg-white px-5 py-3">
          {priceSummary}
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <Button variant="ghost" className="rounded-xl" onClick={onCancel}>Cancel</Button>
            <p className="text-xs text-muted-foreground">
              {selectedIds.length
                ? `${selectedIds.length} storage option${selectedIds.length === 1 ? "" : "s"} selected`
                : t("sheetNoStorageSelected", "No storage selected")}
            </p>
            <Button className={chefPrimaryCtaClass()} onClick={proceedFromSelection}>
              {selectedIds.length ? "Choose dates" : "Continue without storage"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "date-mode") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="text-sm font-semibold text-gray-900">How would you like to set the dates?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You selected {selectedIds.length} storage options. You can reserve them together or set a different range for each.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => { setDateMode("same"); setStage("dates"); }}
              className="rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-[#F51042] hover:bg-[#F51042]/[0.03]"
            >
              <Icon icon="mdi:calendar-range" width={21} height={21} className="text-[#F51042]" aria-hidden />
              <span className="mt-3 block text-sm font-semibold text-gray-900">Same date range</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Apply one start and end date to every selected storage.</span>
            </button>
            <button
              type="button"
              onClick={() => { setDateMode("different"); setActiveDateId(selectedIds[0]); setStage("dates"); }}
              className="rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-[#F51042] hover:bg-[#F51042]/[0.03]"
            >
              <Icon icon="mdi:calendar-multiple" width={21} height={21} className="text-[#F51042]" aria-hidden />
              <span className="mt-3 block text-sm font-semibold text-gray-900">Different dates</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Choose a separate range for each selected storage.</span>
            </button>
          </div>
        </div>
        <div className="space-y-3 border-t px-5 py-3">
          {priceSummary}
          <div className="flex items-center justify-between border-t pt-3">
            <Button variant="ghost" className="rounded-xl" onClick={onCancel}>Cancel</Button>
            <Button variant="outline" className={chefOutlineCtaClass()} onClick={() => setStage("select")}>
              <Icon icon="mdi:arrow-left" width={16} height={16} className="mr-2" aria-hidden /> Back to storage
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const range = dateMode === "same" ? sameRange : ranges[currentListing?.id];
  const validationListing = dateMode === "same"
    ? selectedListings.reduce<StorageListing | undefined>((strictest, listing) =>
        !strictest || (listing.minimumBookingDuration || 1) > (strictest.minimumBookingDuration || 1)
          ? listing
          : strictest,
      undefined)
    : currentListing;
  const error = validationListing ? rangeError(validationListing, range, minDate) : null;
  const allDifferentReady = selectedListings.every(
    (listing) => !rangeError(listing, ranges[listing.id], minDate)
  );
  const canSave = dateMode === "same" ? !error : allDifferentReady;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {dateMode === "different" && selectedListings.length > 1 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {selectedListings.map((listing) => {
              const complete = !rangeError(listing, ranges[listing.id], minDate);
              return (
                <button
                  key={listing.id}
                  type="button"
                  onClick={() => setActiveDateId(listing.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    currentListing?.id === listing.id
                      ? "border-[#F51042] bg-[#F51042]/5 text-[#F51042]"
                      : "border-gray-200 text-gray-600"
                  )}
                >
                  {complete ? (
                    <Icon icon="mdi:check" width={12} height={12} aria-hidden />
                  ) : null}
                  {listing.name}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon icon="mdi:calendar-month-outline" width={16} height={16} className="text-[#F51042]" aria-hidden />
            <p className="text-sm font-semibold text-gray-900">
              {dateMode === "same" ? "Dates for all selected storage" : currentListing?.name}
            </p>
          </div>
          <Calendar
            mode="range"
            selected={range}
            onSelect={(nextRange) => {
              if (dateMode === "same") setSameRange(nextRange);
              else if (currentListing) setRanges((current) => ({ ...current, [currentListing.id]: nextRange }));
            }}
            numberOfMonths={2}
            defaultMonth={range?.from ?? defaultMonth}
            disabled={(date) => isBefore(date, minDate)}
            className="mx-auto w-full bg-transparent p-1"
            classNames={{
              months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
              month: "min-w-0 flex-1 space-y-2",
              table: "w-full table-fixed border-collapse",
              head_cell: "w-[14.28%] text-center text-[0.7rem] font-normal text-muted-foreground",
              cell: calendarRangeCellClass,
              day: calendarRangeDayClass,
              ...calendarRangeDayModifiers,
            }}
          />
        </div>

        {error ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700">
            <Icon icon="mdi:alert-circle-outline" width={16} height={16} className="shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : range?.from && range?.to ? (
          <p className="mt-3 text-xs font-medium text-gray-900">
            {format(range.from, "MMM d, yyyy")} — {format(range.to, "MMM d, yyyy")}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 border-t bg-white px-5 py-3">
        {priceSummary}
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Button variant="ghost" className="rounded-xl" onClick={onCancel}>Cancel</Button>
          <Button
            variant="outline"
            className={chefOutlineCtaClass()}
            onClick={() => setStage(selectedIds.length > 1 ? "date-mode" : "select")}
          >
            <Icon icon="mdi:arrow-left" width={16} height={16} className="mr-2" aria-hidden /> Back
          </Button>
          <Button
            className={chefPrimaryCtaClass()}
            disabled={!canSave}
            onClick={saveDates}
          >
            <Icon icon="mdi:check" width={16} height={16} className="mr-2" aria-hidden /> Save storage
          </Button>
        </div>
      </div>
    </div>
  );
}
