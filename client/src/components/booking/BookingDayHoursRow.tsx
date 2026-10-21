/**
 * One booking day's hours: rate (by the hour / full day), a start and an end, and the day drawn as a strip so booked
 * hours in the middle of the day are visible (Google Calendar "find a time", Skedda). The dropdowns only offer valid
 * ranges: free hours, consecutive, within the kitchen's minimum and the chef's maximum.
 */
import { useTranslation } from "react-i18next";
import { addHour } from "@shared/operating-hours";
import { cn } from "@/lib/utils";
import { formatCurrency, formatTime as formatClockTime } from "@/lib/formatters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DatedSlot } from "./dated-booking-draft";

export type DayHoursValue = { pricingMode: "hourly" | "daily"; times: string[] };

export function BookingDayHoursRow({ title, slots, value, onChange, hourlyRate, dailyRate, fullDayAllowed, fullDayReason, minHours, maxHours, error, loading, footer }: {
  title: string;
  slots: DatedSlot[];
  value: DayHoursValue;
  onChange: (value: DayHoursValue) => void;
  /** Cents. */
  hourlyRate: number;
  dailyRate: number;
  fullDayAllowed: boolean;
  fullDayReason?: string;
  minHours: number;
  maxHours: number | null;
  /** A problem with the current choice on this day (e.g. the copied hours aren't free here). */
  error?: string | null;
  loading?: boolean;
  footer?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation("booking");
  const locale = i18n.language;
  const money = (cents: number) => formatCurrency(cents, "CAD", locale);
  const time = (value: string) => formatClockTime(value, locale);
  const minimum = Math.max(1, minHours);
  const offerHourly = hourlyRate > 0, offerDaily = dailyRate > 0;
  const daily = value.pricingMode === "daily";

  // How many consecutive free hours follow (and include) each start.
  const runFrom = (index: number) => {
    let run = 0;
    for (let i = index; i < slots.length && !slots[i].isFullyBooked && (i === index || slots[i].time === addHour(slots[i - 1].time)); i++) run++;
    return run;
  };
  const startIndex = value.times.length ? slots.findIndex(slot => slot.time === value.times[0]) : -1;
  const length = daily ? 0 : value.times.length;
  const maxLength = (index: number) => Math.min(runFrom(index), maxHours ?? Infinity);
  const startOptions = slots.map((slot, index) => ({ slot, index, ok: !slot.isFullyBooked && maxLength(index) >= minimum }));
  const endOptions = startIndex >= 0 ? Array.from({ length: maxLength(startIndex) }, (_, i) => i + 1)
    .filter(hours => hours >= minimum).map(hours => ({ hours, end: addHour(slots[startIndex + hours - 1].time) })) : [];
  const chosenEnd = endOptions.find(option => option.hours === length)?.end;

  const pickStart = (time: string) => {
    const index = slots.findIndex(slot => slot.time === time);
    if (index < 0) return;
    // Keep the length when it still fits; otherwise the shortest allowed.
    const keep = length >= minimum && length <= maxLength(index) ? length : minimum;
    onChange({ pricingMode: "hourly", times: slots.slice(index, index + keep).map(slot => slot.time) });
  };
  const pickEnd = (hours: string) => {
    if (startIndex < 0) return;
    onChange({ pricingMode: "hourly", times: slots.slice(startIndex, startIndex + Number(hours)).map(slot => slot.time) });
  };
  const setMode = (mode: "hourly" | "daily") => onChange(mode === "daily" ? { pricingMode: "daily", times: slots.map(slot => slot.time) }
    : { pricingMode: "hourly", times: [] });

  const selected = new Set(daily ? slots.map(slot => slot.time) : value.times);
  const cost = daily ? dailyRate : length * hourlyRate;
  // Price match: the chosen hours cost at least the day rate, and the full day is open.
  const suggestFullDay = !daily && offerDaily && fullDayAllowed && length > 0 && length * hourlyRate >= dailyRate;
  const openStart = slots[0]?.time, openEnd = slots.length ? addHour(slots[slots.length - 1].time) : undefined;

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        {offerHourly && offerDaily && (
          <div role="radiogroup" aria-label={t("bkRateChoice")} className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
            {(["hourly", "daily"] as const).map(mode => {
              const active = value.pricingMode === mode, disabled = mode === "daily" && !fullDayAllowed;
              return <button key={mode} type="button" role="radio" aria-checked={active} disabled={disabled}
                title={disabled ? fullDayReason : undefined} onClick={() => setMode(mode)}
                className={cn("min-h-9 rounded-md px-3 font-medium transition-colors", active ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900",
                  disabled && "cursor-not-allowed opacity-50 hover:text-gray-600")}>
                {mode === "hourly" ? t("bkByTheHour", { rate: money(hourlyRate) }) : t("bkFullDayRate", { rate: money(dailyRate) })}
              </button>;
            })}
          </div>
        )}
      </div>

      {loading ? <div className="h-16 animate-pulse rounded-xl bg-gray-100" role="status" aria-label={t("sheetLoadingSlotsText")} />
        : !slots.length ? <p className="text-sm text-muted-foreground">{t("sheetNoAvailableHours")}</p> : <>
          {/* The day at a glance: free, booked and chosen hours, opening to closing. */}
          <div aria-hidden="true">
            <div className="flex h-4 gap-px overflow-hidden rounded-md bg-white">
              {slots.map(slot => <span key={slot.time} title={`${time(slot.time)}${slot.isFullyBooked ? ` · ${t("wfbBooked")}` : ""}`}
                className={cn("flex-1", selected.has(slot.time) ? "bg-[#E10939]" : slot.isFullyBooked
                  ? "bg-[repeating-linear-gradient(135deg,#d1d5db_0,#d1d5db_3px,#f3f4f6_3px,#f3f4f6_6px)]" : "bg-emerald-100")} />)}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{openStart && time(openStart)}</span><span>{openEnd && time(openEnd)}</span></div>
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-emerald-100" />{t("bkFreeHours")}</span>
            {slots.some(slot => slot.isFullyBooked) && <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,#d1d5db_0,#d1d5db_3px,#f3f4f6_3px,#f3f4f6_6px)]" />{t("bkBookedHours")}</span>}
            {selected.size > 0 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[#E10939]" />{t("bkYourHours")}</span>}
          </p>

          {daily ? <p className="text-sm text-gray-700">{t("bkAllOpenHours", { start: openStart ? time(openStart) : "", end: openEnd ? time(openEnd) : "" })}</p> : (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-medium text-gray-600">{t("bkStart")}
                <Select value={startIndex >= 0 ? slots[startIndex].time : ""} onValueChange={pickStart}>
                  <SelectTrigger className="h-11 bg-white text-sm"><SelectValue placeholder={t("bkChooseStart")} /></SelectTrigger>
                  <SelectContent>{startOptions.map(({ slot, ok }) => <SelectItem key={slot.time} value={slot.time} disabled={!ok}>
                    {time(slot.time)}{slot.isFullyBooked ? ` · ${t("wfbBooked")}` : !ok ? ` · ${t("bkNotEnoughTime", { count: minimum })}` : slot.capacity > 1 ? ` · ${t("sheetSlotsLeft", { count: slot.available })}` : ""}
                  </SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs font-medium text-gray-600">{t("bkEnd")}
                <Select value={length >= minimum && startIndex >= 0 ? String(length) : ""} onValueChange={pickEnd} disabled={startIndex < 0}>
                  {/* Time only: the length and cost show under the pickers (the option text truncated on phones). */}
                  <SelectTrigger className="h-11 bg-white text-sm"><SelectValue placeholder={t("bkChooseEnd")}>{chosenEnd && time(chosenEnd)}</SelectValue></SelectTrigger>
                  <SelectContent>{endOptions.map(({ hours, end }) => <SelectItem key={hours} value={String(hours)}>
                    {time(end)} · {t("bkHours", { count: hours })}
                  </SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
          )}
          {!daily && minimum > 1 && <p className="text-xs text-muted-foreground">{t("bkMinimumHours", { count: minimum })}</p>}
          {offerDaily && !fullDayAllowed && fullDayReason && <p className="text-xs text-muted-foreground">{t("mdFullDayUnavailable", { reason: fullDayReason })}</p>}

          {(daily || length > 0) && <p className="text-sm font-medium text-gray-900" data-testid="day-cost">
            {daily ? t("bkFullDayCost", { amount: money(cost) }) : t("bkHoursCost", { count: length, amount: money(cost) })}
          </p>}
          {suggestFullDay && <button type="button" onClick={() => setMode("daily")}
            className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-900 hover:bg-emerald-100">
            {t("bkFullDayNudge", { amount: money(dailyRate) })}
          </button>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </>}
      {footer}
    </section>
  );
}
