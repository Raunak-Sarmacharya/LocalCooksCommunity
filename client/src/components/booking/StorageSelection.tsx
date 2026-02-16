import { useState, useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Package,
  X,
  Calendar as CalendarIcon,
  AlertCircle,
  Check,
  Snowflake,
  Thermometer,
  Pencil,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { format, differenceInDays, isBefore, startOfToday } from "date-fns";

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

// ── Storage type visual config ───────────────────────────────────────────────

const STORAGE_TYPE_CONFIG: Record<
  string,
  { icon: typeof Package; label: string; iconBg: string; badgeClass: string }
> = {
  freezer: {
    icon: Snowflake,
    label: "Freezer",
    iconBg: "bg-blue-50 text-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  cold: {
    icon: Thermometer,
    label: "Refrigerator",
    iconBg: "bg-cyan-50 text-cyan-600",
    badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  dry: {
    icon: Package,
    label: "Dry Storage",
    iconBg: "bg-amber-50 text-amber-600",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function calculatePrice(
  listing: StorageListing,
  range: DateRange | undefined
): { days: number; total: number } | null {
  if (!range?.from || !range?.to) return null;
  const days = Math.ceil(differenceInDays(range.to, range.from));
  const minDays = listing.minimumBookingDuration || 1;
  const effectiveDays = Math.max(days, minDays);
  return { days: effectiveDays, total: listing.basePrice * effectiveDays };
}

function validateRange(
  listing: StorageListing,
  range: DateRange | undefined,
  minDate: Date
): string | null {
  if (!range?.from) return null;
  if (isBefore(range.from, minDate)) return "Start date cannot be in the past";
  if (!range.to) return null;
  if (isBefore(range.to, range.from)) return "End date must be after start date";
  const days = Math.ceil(differenceInDays(range.to, range.from));
  const minDays = listing.minimumBookingDuration || 1;
  if (days < minDays) {
    return `Minimum ${minDays} day${minDays > 1 ? "s" : ""} required`;
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function StorageSelection({
  storageListings,
  selectedStorage,
  onSelectionChange,
  kitchenBookingDate,
}: StorageSelectionProps) {
  const [openPopoverId, setOpenPopoverId] = useState<number | null>(null);
  const [pendingRanges, setPendingRanges] = useState<
    Record<number, DateRange | undefined>
  >({});

  const activeListings = useMemo(
    () => storageListings.filter((l) => l.isActive !== false),
    [storageListings]
  );

  const minDate = startOfToday();
  const defaultMonth = kitchenBookingDate || new Date();

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleOpenPopover = (listingId: number) => {
    // Seed pending range from existing selection if editing
    const existing = selectedStorage.find(
      (s) => s.storageListingId === listingId
    );
    setPendingRanges((prev) => ({
      ...prev,
      [listingId]: existing
        ? { from: existing.startDate, to: existing.endDate }
        : undefined,
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
    // If both dates exist and user clicks a new day, start a fresh range
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

    return (
      <div className="flex flex-col">
        {/* Popover header */}
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <p className="text-sm font-medium text-foreground">{storage.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Min {minDays} day{minDays > 1 ? "s" : ""} &middot;{" "}
            {formatCents(storage.basePrice)}/day
          </p>
        </div>

        {/* Calendar */}
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r: DateRange | undefined, day: Date) =>
            handleRangeSelect(storage.id, r, day)
          }
          numberOfMonths={1}
          defaultMonth={defaultMonth}
          disabled={(date: Date) => isBefore(date, minDate)}
          className="p-2"
        />

        {/* Footer: validation, price preview, confirm */}
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {range?.from && !range?.to && (
            <p className="text-xs text-muted-foreground text-center py-1">
              Click an end date to complete the range
            </p>
          )}

          {price && !error && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground">
                {price.days} day{price.days > 1 ? "s" : ""} &times;{" "}
                {formatCents(storage.basePrice)}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatCents(price.total)}
              </span>
            </div>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={!range?.from || !range?.to || !!error}
            onClick={() => handleConfirm(storage.id)}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {isEdit ? "Update Dates" : "Add Storage"}
          </Button>
        </div>
      </div>
    );
  };

  // ── Empty state ──────────────────────────────────────────────────────────

  if (activeListings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <Package className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No storage available for this kitchen
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {activeListings.map((storage) => {
        const isSelected = selectedStorage.some(
          (s) => s.storageListingId === storage.id
        );
        const selection = selectedStorage.find(
          (s) => s.storageListingId === storage.id
        );
        const config =
          STORAGE_TYPE_CONFIG[storage.storageType] || STORAGE_TYPE_CONFIG.dry;
        const TypeIcon = config.icon;
        const minDays = storage.minimumBookingDuration || 1;
        const selectionPrice = selection
          ? calculatePrice(storage, {
              from: selection.startDate,
              to: selection.endDate,
            })
          : null;

        return (
          <div
            key={storage.id}
            className={cn(
              "rounded-lg border transition-all duration-200",
              isSelected
                ? "border-primary/40 bg-primary/[0.02]"
                : "border-border"
            )}
          >
            {/* ── Row: type icon + name + badge + price ── */}
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    config.iconBg
                  )}
                >
                  <TypeIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {storage.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs h-[18px] px-1.5 py-0 font-medium leading-none",
                        config.badgeClass
                      )}
                    >
                      {config.label}
                    </Badge>
                    {storage.climateControl && (
                      <span className="text-xs text-muted-foreground">
                        Climate ctrl
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <p className="text-sm font-semibold text-foreground">
                  {formatCents(storage.basePrice)}
                  <span className="text-xs font-normal text-muted-foreground">
                    /day
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Min {minDays}d
                </p>
              </div>
            </div>

            {/* ── Date selection / confirmation bar ── */}
            <div className="px-3 pb-3">
              {isSelected && selection ? (
                // Selected state: compact confirmation strip
                <div className="flex items-center justify-between gap-2 rounded-md bg-primary/5 border border-primary/10 pl-2.5 pr-1 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {format(selection.startDate, "MMM d")} &mdash;{" "}
                        {format(selection.endDate, "MMM d, yyyy")}
                      </p>
                      {selectionPrice && (
                        <p className="text-xs text-muted-foreground">
                          {selectionPrice.days} day
                          {selectionPrice.days > 1 ? "s" : ""} &middot;{" "}
                          <span className="font-medium text-primary">
                            {formatCents(selectionPrice.total)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-shrink-0">
                    <Popover
                      open={openPopoverId === storage.id}
                      onOpenChange={(open) => {
                        if (open) handleOpenPopover(storage.id);
                        else handleClosePopover();
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="p-0"
                        align="end"
                        sideOffset={8}
                      >
                        {renderCalendarContent(storage)}
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(storage.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                // Unselected state: date picker trigger button
                <Popover
                  open={openPopoverId === storage.id}
                  onOpenChange={(open) => {
                    if (open) handleOpenPopover(storage.id);
                    else handleClosePopover();
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-full justify-start text-xs h-8 font-normal",
                        "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <CalendarIcon className="h-3.5 w-3.5 mr-2" />
                      Select storage dates
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0"
                    align="start"
                    sideOffset={8}
                  >
                    {renderCalendarContent(storage)}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
