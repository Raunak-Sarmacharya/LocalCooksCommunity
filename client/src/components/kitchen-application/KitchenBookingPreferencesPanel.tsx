import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHourSlotRange } from "@/lib/formatters";
import { notifyBookingPrefsChanged } from "@/lib/persisted-booking-prefs";
import { Badge } from "@/components/ui/badge";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { kt } from "@/i18n/kitchen-ns";

export interface EquipmentListingOption {
  id: number;
  equipmentType: string;
  brand?: string | null;
  sessionRate?: number | null;
  availabilityType?: string | null;
}

export interface StorageListingOption {
  id: number;
  name?: string | null;
  storageType?: string | null;
  basePrice?: number | null;
}

export interface KitchenBookingPreferencesPanelProps {
  kitchenId: string;
  kitchenName?: string;
  /** Kept for callers; add-ons are only chosen at book time. */
  equipmentListings?: { included?: EquipmentListingOption[]; rental?: EquipmentListingOption[] } | null;
  storageListings?: StorageListingOption[] | null;
  readOnly?: boolean;
  stage?: "date" | "slots" | "schedule" | "all";
  onValidityChange?: (valid: boolean) => void;
  onRequestDateStep?: () => void;
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseStoredDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const from = parsed.from ? new Date(parsed.from) : undefined;
    if (!from || Number.isNaN(from.getTime())) return undefined;
    from.setHours(0, 0, 0, 0);
    return from;
  } catch {
    return undefined;
  }
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type BookingEstimateMeta = {
  minimumBookingHours: number;
  maxSlotsPerChef: number;
};

export function KitchenBookingPreferencesPanel({
  kitchenId,
  kitchenName,
  readOnly = false,
  stage = "all",
  onValidityChange,
  onRequestDateStep,
}: KitchenBookingPreferencesPanelProps) {
  const { t } = useTranslation("kitchen");
  const { t: tBooking } = useTranslation("booking");
  const { toast } = useToast();
  const datesKey = `kitchen_dates_${kitchenId}`;
  const prefsKey = `kitchen_booking_prefs_${kitchenId}`;

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    try {
      return parseStoredDate(sessionStorage.getItem(datesKey));
    } catch {
      return undefined;
    }
  });
  // Collapse calendar after a date is chosen; expand to change it.
  const [calendarOpen, setCalendarOpen] = useState(() => {
    try {
      return !parseStoredDate(sessionStorage.getItem(datesKey));
    } catch {
      return true;
    }
  });
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => selectedDate || new Date());
  const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [availableSlots, setAvailableSlots] = useState<Array<{ time: string; isFullyBooked?: boolean }>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsLoadError, setSlotsLoadError] = useState(false);
  const [estimateMeta, setEstimateMeta] = useState<BookingEstimateMeta>({
    minimumBookingHours: 1,
    maxSlotsPerChef: 2,
  });

  const primaryDate = selectedDate;
  const dateLabel = useMemo(
    () => (selectedDate ? formatDayLabel(selectedDate) : null),
    [selectedDate]
  );

  const clearDates = useCallback(() => {
    sessionStorage.removeItem(datesKey);
    setSelectedDate(undefined);
    setSelectedSlots([]);
    setCalendarOpen(true);
    notifyBookingPrefsChanged(kitchenId);
  }, [datesKey, kitchenId]);

  useEffect(() => {
    if (readOnly) return;
    if (selectedDate) {
      sessionStorage.setItem(datesKey, JSON.stringify({ from: selectedDate }));
    } else {
      sessionStorage.removeItem(datesKey);
    }
    notifyBookingPrefsChanged(kitchenId);
  }, [selectedDate, datesKey, readOnly, kitchenId]);

  useEffect(() => {
    if (!kitchenId) return;
    let cancelled = false;
    const loadEstimate = async () => {
      try {
        const response = await fetch(`/api/public/kitchens/${kitchenId}/booking-estimate`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(kt("failedToLoadEstimate"));
        const data = await response.json();
        if (cancelled) return;
        setEstimateMeta({
          minimumBookingHours: Math.max(1, Number(data.minimumBookingHours) || 1),
          maxSlotsPerChef: Math.max(1, Number(data.maxSlotsPerChef) || 2),
        });
      } catch {
        /* keep defaults */
      }
    };
    void loadEstimate();
    return () => {
      cancelled = true;
    };
  }, [kitchenId]);

  useEffect(() => {
    if (!kitchenId || readOnly) return;
    let cancelled = false;
    const loadMonth = async () => {
      setAvailabilityLoading(true);
      try {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const response = await fetch(
          `/api/public/kitchens/${kitchenId}/month-availability?year=${year}&month=${month}`,
          { credentials: "include", cache: "no-store" }
        );
        if (!response.ok) throw new Error(kt("failedToLoadAvailability"));
        const serverAvailability: Record<string, boolean> = await response.json();
        if (cancelled) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const merged: Record<string, boolean> = {};
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month, day);
          merged[toLocalDateString(date)] =
            date >= today && serverAvailability[toLocalDateString(date)] === true;
        }
        setDateAvailability(merged);
      } catch {
        if (!cancelled) setDateAvailability({});
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    };
    void loadMonth();
    return () => {
      cancelled = true;
    };
  }, [kitchenId, calendarMonth, readOnly]);

  const isDayAvailable = useCallback(
    (date: Date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) return false;
      if (Object.keys(dateAvailability).length === 0) return false;
      return dateAvailability[toLocalDateString(date)] === true;
    },
    [dateAvailability]
  );

  const handleSelect = (day: Date | undefined) => {
    if (readOnly) return;
    if (!day) {
      clearDates();
      return;
    }
    const next = new Date(day);
    next.setHours(0, 0, 0, 0);
    if (!isDayAvailable(next)) return;
    if (selectedDate && sameCalendarDay(selectedDate, next)) {
      clearDates();
      return;
    }
    setSelectedDate(next);
    setSelectedSlots([]);
    setCalendarOpen(false);
  };

  const toggleSlot = useCallback(
    (time: string) => {
      const minHours = estimateMeta.minimumBookingHours;
      const maxSlots = estimateMeta.maxSlotsPerChef;

      setSelectedSlots((prev) => {
        let next: string[];
        if (prev.includes(time)) {
          next = minHours > 1 ? [] : prev.filter((x) => x !== time);
        } else if (minHours > 1 && prev.length === 0) {
          const clickedIndex = availableSlots.findIndex((s) => s.time === time);
          if (clickedIndex === -1) return prev;
          const slotsToSelect: string[] = [];
          for (let i = clickedIndex; i < availableSlots.length && slotsToSelect.length < minHours; i++) {
            if (!availableSlots[i].isFullyBooked) slotsToSelect.push(availableSlots[i].time);
            else break;
          }
          if (slotsToSelect.length > maxSlots) {
            toast({
              title: tBooking("toastCannotMeetMinTitle", "Cannot meet minimum"),
              description: tBooking("toastCannotMeetMinDesc", {
                minHours,
                maxSlots,
                defaultValue: `This kitchen requires ${minHours} consecutive hours, but the daily limit is ${maxSlots} hours.`,
              }),
              variant: "destructive",
            });
            return prev;
          }
          if (slotsToSelect.length < minHours) {
            toast({
              title: tBooking("toastNotEnoughSlotsTitle", "Not enough available slots"),
              description: tBooking("toastNotEnoughSlotsDesc", {
                minHours,
                available: slotsToSelect.length,
                defaultValue: `This kitchen requires a minimum of ${minHours} consecutive hours. Only ${slotsToSelect.length} available from this time.`,
              }),
              variant: "destructive",
            });
            return prev;
          }
          next = slotsToSelect.sort();
        } else if (prev.length >= maxSlots) {
          toast({
            title: tBooking("toastLimitReachedTitle", "Limit reached"),
            description: tBooking("toastLimitReachedDesc", {
              count: maxSlots,
              defaultValue: `You can select up to ${maxSlots} hour slot${maxSlots > 1 ? "s" : ""} for this day.`,
            }),
            variant: "destructive",
          });
          return prev;
        } else {
          next = [...prev, time].sort();
        }
        return next;
      });
    },
    [availableSlots, estimateMeta.maxSlotsPerChef, estimateMeta.minimumBookingHours, tBooking, toast]
  );

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(prefsKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.slots) && parsed.slots.length > 0) {
        setSelectedSlots(parsed.slots);
      }
    } catch {
      /* ignore */
    }
  }, [prefsKey]);

  useEffect(() => {
    if (readOnly) return;
    sessionStorage.setItem(
      prefsKey,
      JSON.stringify({
        slots: selectedSlots,
        activeSlotDate: primaryDate?.toISOString(),
      })
    );
    notifyBookingPrefsChanged(kitchenId);
  }, [prefsKey, selectedSlots, primaryDate, readOnly, kitchenId]);

  const loadSlotsForDate = useCallback(
    async (date: Date) => {
      setSlotsLoading(true);
      setSlotsLoadError(false);
      try {
        const dateStr = toLocalDateString(date);
        const response = await fetch(`/api/public/kitchens/${kitchenId}/slots?date=${dateStr}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(kt("failedToLoadSlots"));
        const slots = await response.json();
        const now = new Date();
        const filtered = (slots as Array<{ time: string; isFullyBooked?: boolean }>).filter((slot) => {
          if (slot.isFullyBooked) return false;
          const [h, m] = slot.time.split(":").map(Number);
          const slotTime = new Date(date);
          slotTime.setHours(h, m, 0, 0);
          return slotTime > now;
        });
        setAvailableSlots(filtered);
      } catch {
        setSlotsLoadError(true);
        setAvailableSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    },
    [kitchenId]
  );

  useEffect(() => {
    if (!primaryDate) {
      setAvailableSlots([]);
      return;
    }
    void loadSlotsForDate(primaryDate);
  }, [primaryDate, loadSlotsForDate]);

  const isValid =
    stage === "date"
      ? !!primaryDate
      : !!primaryDate &&
        !slotsLoading &&
        !slotsLoadError &&
        availableSlots.length > 0 &&
        selectedSlots.length > 0;

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  // Natural size + fixed 32px day cells → selection ring is a true circle (not a stretched pill).
  const calendarClassNames = {
    months: "flex w-full flex-col space-y-0",
    month: "w-full space-y-2",
    caption: "relative flex w-full items-center justify-center pt-0.5",
    caption_label: "text-xs font-medium",
    nav_button:
      "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100",
    nav_button_previous: "absolute left-0",
    nav_button_next: "absolute right-0",
    table: "w-full table-fixed border-collapse",
    head_cell:
      "w-[14.28%] pb-0.5 text-center text-[0.65rem] font-normal text-muted-foreground",
    row: "mt-0.5",
    cell: cn(
      "relative z-0 h-8 p-0 text-center text-xs",
      "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-[#F51042]"
    ),
    day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full p-0 text-xs font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100",
    day_disabled:
      "pointer-events-none text-gray-300 opacity-40 line-through decoration-gray-300/80",
  };

  const datePickerBody = (
    <div className="relative mx-auto w-full max-w-[300px] rounded-xl border border-gray-100 bg-gray-50/40 p-1">
      {availabilityLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" />
        </div>
      )}
      <UICalendar
        mode="single"
        selected={selectedDate}
        onSelect={handleSelect}
        month={calendarMonth}
        onMonthChange={setCalendarMonth}
        disabled={(date) => {
          const d = new Date(date);
          d.setHours(0, 0, 0, 0);
          return !isDayAvailable(d);
        }}
        className="w-full bg-transparent p-1"
        classNames={calendarClassNames}
      />
    </div>
  );

  const datePicker = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#F51042]" />
            {t("selectYourDate", "Select your date")}
          </p>
          {kitchenName && <p className="text-xs text-muted-foreground mt-1">{kitchenName}</p>}
        </div>
        {!readOnly && selectedDate && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-gray-500 hover:text-[#F51042]"
            onClick={clearDates}
          >
            {t("clearDate", "Clear date")}
          </button>
        )}
      </div>
      {datePickerBody}
    </div>
  );

  const slotsPickerBody = !primaryDate ? null : slotsLoading ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t("loadingTimeSlots", "Loading available times...")}
    </div>
  ) : slotsLoadError ? (
    <p className="text-xs text-red-600">
      {t("slotsLoadError", "Could not load time slots. Please close and try again.")}
    </p>
  ) : availableSlots.length === 0 ? (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
      {t(
        "noSlotsForDatePickAnother",
        "No bookable time slots remain for this date. Change date and try another day."
      )}
    </p>
  ) : readOnly ? (
    <div className="flex flex-wrap gap-1.5">
      {selectedSlots.map((time) => (
        <Badge key={time} variant="secondary" className="text-xs">
          {formatHourSlotRange(time)}
        </Badge>
      ))}
      {selectedSlots.length === 0 && (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  ) : (
    <>
      <p className="text-[11px] text-muted-foreground">
        {tBooking("sheetMaxHoursBadge", {
          maxHours: estimateMeta.maxSlotsPerChef,
          defaultValue: `Max ${estimateMeta.maxSlotsPerChef} hours`,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {availableSlots.map((slot) => {
          const selected = selectedSlots.includes(slot.time);
          return (
            <button
              key={slot.time}
              type="button"
              onClick={() => toggleSlot(slot.time)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                selected
                  ? "bg-[#F51042] text-white border-[#F51042]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-[#F51042]/40"
              )}
            >
              {formatHourSlotRange(slot.time)}
            </button>
          );
        })}
      </div>
    </>
  );

  if (stage === "date") {
    if (readOnly && !primaryDate) {
      return (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
          {t("noDatesSelected", "No dates selected.")}
        </p>
      );
    }
    return datePicker;
  }

  if (stage === "slots") {
    if (!primaryDate) {
      return (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
          {t("pickDateFirst", "Pick a date first.")}
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#F51042]" />
            {t("preferredTimeSlots", "Preferred time slots")}
          </p>
          {!readOnly && (
            <button
              type="button"
              className="text-xs font-medium text-[#F51042]"
              onClick={() => {
                if (onRequestDateStep) onRequestDateStep();
                else clearDates();
              }}
            >
              {t("changeDate", "Change date")}
            </button>
          )}
        </div>
        {slotsPickerBody}
      </div>
    );
  }

  // schedule | all — collapse calendar after date pick; price on modal left rail.
  return (
    <div className="space-y-4">
      {kitchenName && (
        <p className="text-xs text-muted-foreground">{kitchenName}</p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#F51042]" />
            {t("selectYourDate", "Select your date")}
          </p>
          {!readOnly && selectedDate && (
            <button
              type="button"
              className="text-xs font-medium text-[#F51042] hover:underline"
              onClick={() => (calendarOpen ? clearDates() : setCalendarOpen(true))}
            >
              {calendarOpen
                ? t("clearDate", "Clear date")
                : t("changeDate", "Change date")}
            </button>
          )}
        </div>
        {calendarOpen || !selectedDate ? (
          datePickerBody
        ) : (
          <p className="text-sm font-medium text-gray-900">{dateLabel}</p>
        )}
      </div>

      {primaryDate && (
        <div className="space-y-2">
          <p className="font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#F51042]" />
            {t("preferredTimeSlots", "Preferred time slots")}
          </p>
          {slotsPickerBody}
          {selectedSlots.length > 0 && (
            <p className="text-xs text-gray-500">
              {t("hoursSelected", {
                count: selectedSlots.length,
                defaultValue: `${selectedSlots.length} hour${selectedSlots.length > 1 ? "s" : ""} selected`,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
