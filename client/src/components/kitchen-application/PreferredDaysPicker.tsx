/**
 * "When would you like to cook?" on the request to apply: the booking calendar (days with "not every hour is free" dots,
 * the same reasons, one or more days) and the booking hours strip, with an estimated price. Nothing is reserved; the
 * choice is saved for the request (Local Cooks and the kitchen see it) and to pre-fill booking after approval.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency } from "@/lib/formatters";
import { estimateKitchenBookingPrice } from "@/lib/booking-price-estimate";
import { notifyBookingPrefsChanged } from "@/lib/persisted-booking-prefs";
import { DatedCalendarContext, DatedCalendarDay } from "@/components/booking/DatedCalendarDay";
import { BOOKING_CALENDAR_CLASS_NAMES, BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES } from "@/components/booking/booking-calendar";
import { BookingDayHoursRow, type DayHoursValue } from "@/components/booking/BookingDayHoursRow";
import { dateBlockReasonKey, localDateKey, partlyFree, type DateStatus, type DatedSlot } from "@/components/booking/dated-booking-draft";
import { readPreferredSchedule, writePreferredSchedule } from "@/lib/preferred-schedule";

type Rules = { hourlyRate?: number | null; dailyRate?: number | null; taxRatePercent?: number; platformCommissionRate?: number; minimumBookingHours?: number;
  maxSlotsPerChef?: number | null; allowMultiDayBookings?: boolean; multidayCreationEnabled?: boolean; maxBookingDays?: number };

export type PreferredDaysSummary = { days: string[]; pricingMode: "hourly" | "daily"; times: string[]; totalCents: number | null };

export function PreferredDaysPicker({ kitchenId, onSummary }: { kitchenId: string; onSummary?: (summary: PreferredDaysSummary) => void }) {
  const { t, i18n } = useTranslation("booking");
  const locale = i18n.language;
  const isMobile = useIsMobile();
  const saved = useMemo(() => readPreferredSchedule(kitchenId), [kitchenId]);
  const [days, setDays] = useState<string[]>(saved.days);
  const [hours, setHours] = useState<DayHoursValue>({ pricingMode: saved.pricingMode, times: saved.times });
  const [month, setMonth] = useState(() => saved.days[0] ? new Date(`${saved.days[0]}T12:00:00`) : new Date());
  const [note, setNote] = useState("");

  const { data: rules } = useQuery<Rules>({ queryKey: ["/api/public/kitchens", kitchenId, "booking-estimate"],
    queryFn: async () => { const res = await fetch(`/api/public/kitchens/${kitchenId}/booking-estimate`); if (!res.ok) throw Error("rules"); return res.json(); } });
  const multi = rules?.allowMultiDayBookings === true && rules?.multidayCreationEnabled === true;
  const maxDays = multi ? Math.min(rules?.maxBookingDays ?? 7, 14) : 1;
  const monthCount = isMobile ? 1 : 2;
  const months = Array.from({ length: monthCount }, (_, offset) => new Date(month.getFullYear(), month.getMonth() + offset, 1));
  const { data: statuses = {}, isLoading: statusLoading } = useQuery<Record<string, DateStatus>>({
    queryKey: ["/api/public/kitchens", kitchenId, "date-status", months.map(m => `${m.getFullYear()}-${m.getMonth()}`).join(",")],
    queryFn: async () => Object.assign({}, ...await Promise.all(months.map(async m => {
      const res = await fetch(`/api/public/kitchens/${kitchenId}/date-status?year=${m.getFullYear()}&month=${m.getMonth()}`);
      if (!res.ok) throw Error("date-status"); return res.json();
    }))) });
  const firstDay = days[0];
  const { data: slots = [], isLoading: slotsLoading } = useQuery<DatedSlot[]>({ queryKey: ["/api/public/kitchens", kitchenId, "slots", firstDay],
    enabled: !!firstDay, queryFn: async () => {
      const res = await fetch(`/api/public/kitchens/${kitchenId}/slots?date=${firstDay}`); if (!res.ok) throw Error("slots");
      return (await res.json() as Array<{ time: string; isFullyBooked?: boolean }>).map(slot => ({ time: slot.time, isFullyBooked: !!slot.isFullyBooked, available: slot.isFullyBooked ? 0 : 1, capacity: 1 }));
    } });

  useEffect(() => { writePreferredSchedule(kitchenId, { days, pricingMode: hours.pricingMode, times: hours.times }); notifyBookingPrefsChanged(kitchenId); },
    [kitchenId, days.join(","), hours.pricingMode, hours.times.join(",")]);

  const today = localDateKey(new Date());
  const reason = (date: Date) => {
    const key = dateBlockReasonKey(localDateKey(date), days, statuses[localDateKey(date)], maxDays, today);
    return key && t(key, { count: maxDays });
  };
  const pick = (next: Date[] | Date | undefined) => {
    const list = (Array.isArray(next) ? next : next ? [next] : []).map(localDateKey).sort().slice(-maxDays);
    setDays(multi ? list : list.slice(-1));
    if (list[0] !== firstDay) setHours({ pricingMode: "hourly", times: [] });
  };

  const hourly = Number(rules?.hourlyRate) || 0, daily = Number(rules?.dailyRate) || 0;
  const perDay = hours.pricingMode === "daily" ? estimateKitchenBookingPrice({ hourlyRateCents: daily, hours: 1, taxRatePercent: rules?.taxRatePercent, platformCommissionRate: rules?.platformCommissionRate })
    : hours.times.length ? estimateKitchenBookingPrice({ hourlyRateCents: hourly, hours: hours.times.length, minimumBookingHours: rules?.minimumBookingHours, taxRatePercent: rules?.taxRatePercent, platformCommissionRate: rules?.platformCommissionRate }) : null;
  const status = firstDay ? statuses[firstDay] : undefined;
  const totalCents = perDay ? perDay.totalCents * Math.max(1, days.length) : null;
  useEffect(() => { onSummary?.({ days, pricingMode: hours.pricingMode, times: hours.times, totalCents }); },
    [days.join(","), hours.pricingMode, hours.times.join(","), totalCents]);
  const calendarProps = { month, onMonthChange: setMonth, numberOfMonths: monthCount, pagedNavigation: monthCount === 2, showOutsideDays: false, fromMonth: new Date(),
    disabled: (date: Date) => !!reason(date), components: { Day: DatedCalendarDay }, className: "w-full bg-transparent p-1",
    classNames: monthCount === 2 ? { ...BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES, cell: "relative h-10 p-0 text-center text-sm" } : { ...BOOKING_CALENDAR_CLASS_NAMES, cell: "relative h-10 p-0 text-center text-sm" } };

  return <div className="space-y-5" data-testid="preferred-days">
    <div className="relative rounded-xl border bg-gray-50/40 p-2">
      {statusLoading && <div className="absolute inset-0 z-10 rounded-xl bg-white/90 p-4" role="status" aria-label={t("pdLoading")}><Skeleton className="h-7 w-1/2" /></div>}
      <DatedCalendarContext.Provider value={{ reason, announce: setNote, locale, partial: date => partlyFree(statuses[localDateKey(date)]), partialLabel: t("bkDayLimited") }}>
        <p className="px-2 pt-1 text-xs text-muted-foreground">{t(multi ? "pdPickDays" : "pdPickDay", { count: maxDays })}</p>
        {multi
          ? <UICalendar mode="multiple" selected={days.map(day => new Date(`${day}T12:00:00`))} onSelect={pick} {...calendarProps} />
          : <UICalendar mode="single" selected={firstDay ? new Date(`${firstDay}T12:00:00`) : undefined} onSelect={pick} {...calendarProps} />}
        <p className="flex items-center gap-1.5 px-2 pb-1 text-xs text-muted-foreground"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t("bkDayLimited")}</p>
        <p role="status" aria-live="polite" className={note ? "px-2 pb-1 text-xs text-gray-700" : "sr-only"}>{note}</p>
      </DatedCalendarContext.Provider>
    </div>
    {firstDay && <BookingDayHoursRow title={days.length > 1 ? t("pdHoursAllDays") : new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${firstDay}T12:00:00`))}
      slots={slots} value={hours} onChange={setHours} hourlyRate={hourly} dailyRate={daily} fullDayAllowed={!!status?.fullDay} fullDayReason={status?.fullDayReason ?? undefined}
      minHours={Math.max(1, Number(rules?.minimumBookingHours) || 1)} maxHours={rules?.maxSlotsPerChef ?? null} loading={slotsLoading} />}
    {perDay && <p className="rounded-xl bg-muted/40 p-3 text-sm" data-testid="preferred-days-estimate">
      <span className="font-medium">{t("pdEstimate", { amount: formatCurrency(totalCents!, "CAD", locale), count: Math.max(1, days.length) })}</span>
      <span className="block text-xs text-muted-foreground">{t("pdEstimateNote")}</span></p>}
  </div>;
}
