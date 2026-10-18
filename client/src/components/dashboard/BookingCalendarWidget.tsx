import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { mt } from "@/i18n/manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PILL, StatusPill } from "@/components/booking/BookingNowCard";
import { timeRange, type BookingPillTone } from "@/lib/booking-header-state";
import { formatTime } from "@/lib/formatters";
import { addDaysKey, weekStartKey } from "@/lib/manager-week-stats";
import { cn } from "@/lib/utils";

/**
 * The kitchen's calendar on the dashboard: everything that happens in the kitchen on a day — booked days (one per day of
 * a multi-day booking), tours, closures and special hours, storage move-ins and move-outs — coloured like the booking
 * pills, each opening its own page. Week by default (columns on desktop, stacked days on a phone), with Day and Month.
 * Display only; the events are built by the overview from data it already reads.
 */
export type CalendarEvent = {
  key: string;
  kind: "booking" | "tour" | "closed" | "hours" | "moveIn" | "moveOut";
  /** Kitchen operating day, YYYY-MM-DD. */
  date: string;
  start?: string;
  end?: string;
  /** Real start instant for ordering (an overnight slot sorts after the evening). */
  sortAt?: number;
  title: string;
  detail?: string;
  /** State in words ("Confirmed", "Tour requested", "Closed"). */
  label: string;
  tone: BookingPillTone;
  /** Finished or cancelled: drawn quietly. */
  muted?: boolean;
  /** The chef is in the kitchen now. */
  now?: boolean;
  href?: string;
  onOpen?: () => void;
};

type View = "day" | "week" | "month";

const asDate = (key: string) => new Date(`${key}T12:00:00Z`);
const dayFormat = (locale: string, options: Intl.DateTimeFormatOptions) => (key: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(asDate(key));
const allDay = (event: CalendarEvent) => !event.start;

export const eventTime = (event: CalendarEvent, locale: string) =>
  event.start && event.end ? timeRange(formatTime(event.start, locale), formatTime(event.end, locale)) : event.start ? formatTime(event.start, locale) : "";

export function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => Number(!allDay(a)) - Number(!allDay(b))
    || (a.sortAt ?? 0) - (b.sortAt ?? 0) || (a.start ?? "").localeCompare(b.start ?? ""));
}

function EventLink({ event, className, children, label }: { event: CalendarEvent; className: string; children: ReactNode; label?: string }) {
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";
  if (event.href) return <Link href={event.href} aria-label={label} className={cn(className, focus)}>{children}</Link>;
  if (event.onOpen) return <button type="button" aria-label={label} onClick={event.onOpen} className={cn("text-left", className, focus)}>{children}</button>;
  return <div className={className}>{children}</div>;
}

/** One event as a full row: time, who/what, state. Shared by the Day view and the dashboard's Today card. */
export function CalendarEventRow({ event, locale }: { event: CalendarEvent; locale: string }) {
  const time = eventTime(event, locale);
  return (
    <EventLink event={event} className={cn("group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-200 motion-reduce:transition-none hover:bg-muted/60", event.muted && "opacity-70")}>
      <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", PILL[event.tone].dot)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium tabular-nums">{time || event.label}</span>
        <span className={cn("block truncate text-sm", event.muted && "line-through decoration-muted-foreground/60")}>{event.title}</span>
        {event.detail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{event.detail}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill tone={event.tone}>{event.label}</StatusPill>
        {event.now && <span className="text-xs font-medium text-success">{mt("ovrInKitchenNowBadge")}</span>}
      </span>
      {(event.href || event.onOpen) && <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </EventLink>
  );
}

function EventChip({ event, locale }: { event: CalendarEvent; locale: string }) {
  const time = eventTime(event, locale);
  return (
    <EventLink event={event} label={[time, event.title, event.label].filter(Boolean).join(" · ")}
      className={cn("block w-full rounded-md border px-2 py-1.5 text-xs leading-4 transition-[filter] hover:brightness-95", PILL[event.tone].surface, event.muted && "opacity-60")}>
      <span className="block font-semibold tabular-nums">{time || event.label}</span>
      <span className={cn("block truncate", event.muted && "line-through")}>{event.title}</span>
    </EventLink>
  );
}

const LEGEND: Array<[BookingPillTone, string]> = [["green", "ovrLegendBooked"], ["amber", "ovrLegendRequested"], ["blue", "ovrLegendTour"], ["purple", "ovrLegendStorage"], ["grey", "ovrLegendClosed"]];

interface BookingCalendarWidgetProps {
  events: CalendarEvent[];
  isLoading: boolean;
  /** The kitchen's today, YYYY-MM-DD. */
  today: string;
  onNavigateToBookings: () => void;
}

export default function BookingCalendarWidget({ events, isLoading, today, onNavigateToBookings }: BookingCalendarWidgetProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    map.forEach((list, key) => map.set(key, sortEvents(list)));
    return map;
  }, [events]);

  const weekStart = weekStartKey(anchor);
  const week = Array.from({ length: 7 }, (_, index) => addDaysKey(weekStart, index));
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = addDaysKey(`${addDaysKey(monthStart, 32).slice(0, 7)}-01`, -1);
  const monthDays: string[] = [];
  for (let key = weekStartKey(monthStart); key <= addDaysKey(weekStartKey(monthEnd), 6); key = addDaysKey(key, 1)) monthDays.push(key);

  const shift = (direction: 1 | -1) => setAnchor(view === "day" ? addDaysKey(anchor, direction)
    : view === "week" ? addDaysKey(anchor, 7 * direction) : `${(direction > 0 ? addDaysKey(monthEnd, 1) : addDaysKey(monthStart, -1)).slice(0, 7)}-01`);
  const openDay = (key: string) => { setAnchor(key); setView("day"); };

  const short = dayFormat(locale, { month: "short", day: "numeric" });
  const range = view === "day" ? dayFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })(anchor)
    : view === "week" ? `${short(week[0])} – ${dayFormat(locale, { month: "short", day: "numeric", year: "numeric" })(week[6])}`
    : dayFormat(locale, { month: "long", year: "numeric" })(monthStart);
  const weekday = dayFormat(locale, { weekday: "short" });
  const dayNumber = dayFormat(locale, { day: "numeric" });
  const weekEmpty = week.every(key => !byDay.get(key)?.length);

  return (
    <Card className="min-w-0 rounded-[20px] border border-border/70 bg-card shadow-[0_2px_12px_-6px_rgba(15,23,42,0.12)]" data-testid="overview-calendar">
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("ovrCalendar")}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight" aria-live="polite">{range}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={() => setAnchor(today)}>{mt("today")}</Button>
            <div className="flex items-center rounded-lg border border-border/70">
              <Button variant="ghost" size="icon" className="size-9" onClick={() => shift(-1)} aria-label={mt("previous")}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" className="size-9" onClick={() => shift(1)} aria-label={mt("next")}><ChevronRight className="size-4" aria-hidden="true" /></Button>
            </div>
            <ToggleGroup type="single" value={view} onValueChange={value => value && setView(value as View)} aria-label={mt("ovrCalendarView")}
              className="rounded-lg bg-muted p-0.5">
              {(["day", "week", "month"] as const).map(option => (
                <ToggleGroupItem key={option} value={option} size="sm" className="h-8 rounded-md px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  {mt(option === "day" ? "ovrDayView" : option === "week" ? "weekView" : "monthView")}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {isLoading ? <Skeleton className="mt-5 h-48 rounded-xl" /> : view === "week" ? (
          <div className="mt-5 grid gap-2 md:grid-cols-7">
            {week.map(key => {
              const list = byDay.get(key) ?? [];
              const isToday = key === today;
              return (
                <section key={key} aria-label={dayFormat(locale, { weekday: "long", month: "long", day: "numeric" })(key)}
                  className={cn("min-w-0 rounded-xl border border-border/60 p-2 md:min-h-40", isToday ? "border-primary/40 bg-primary/[0.03]" : "bg-muted/20", !list.length && !isToday && "hidden md:block")}>
                  <button type="button" onClick={() => openDay(key)} className="flex w-full items-baseline gap-1.5 rounded-md px-1 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className={cn("text-xs font-medium", isToday ? "text-primary" : "text-muted-foreground")}>{weekday(key)}</span>
                    <span className={cn("text-base font-semibold tabular-nums", isToday && "text-primary")}>{dayNumber(key)}</span>
                    {isToday && <span className="ml-auto text-xs font-medium text-primary md:hidden">{mt("today")}</span>}
                  </button>
                  <div className="mt-1 space-y-1.5">
                    {list.map(event => <EventChip key={event.key} event={event} locale={locale} />)}
                    {!list.length && !weekEmpty && <p className="px-1 py-1 text-xs text-muted-foreground md:hidden">{mt("ovrNothingScheduled")}</p>}
                  </div>
                </section>
              );
            })}
            {weekEmpty && <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground md:col-span-7">{mt("ovrNothingThisWeek")}</p>}
          </div>
        ) : view === "day" ? (
          <div className="mt-4 divide-y divide-border/50">
            {(byDay.get(anchor) ?? []).map(event => <CalendarEventRow key={event.key} event={event} locale={locale} />)}
            {!byDay.get(anchor)?.length && <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{mt("ovrNothingScheduled")}</p>}
          </div>
        ) : (
          <div className="mt-5">
            <div className="grid grid-cols-7 pb-1 text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
              {week.map(key => <span key={key}>{weekday(key)}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60">
              {monthDays.map(key => {
                const list = byDay.get(key) ?? [];
                const inMonth = key.slice(0, 7) === monthStart.slice(0, 7);
                return (
                  <button key={key} type="button" onClick={() => openDay(key)}
                    aria-label={`${dayFormat(locale, { weekday: "long", month: "long", day: "numeric" })(key)} · ${mt("ovrEventCount", { count: list.length })}`}
                    className={cn("flex min-h-14 flex-col items-stretch gap-1 bg-card p-1 text-left hover:bg-muted/50 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-24 md:p-1.5", !inMonth && "bg-muted/30 text-muted-foreground")}>
                    <span className={cn("inline-flex size-6 items-center justify-center self-start rounded-full text-xs font-medium tabular-nums", key === today && "bg-primary text-primary-foreground")}>{dayNumber(key)}</span>
                    <span className="flex flex-wrap gap-0.5 md:hidden" aria-hidden="true">{list.slice(0, 3).map(event => <span key={event.key} className={cn("size-1.5 rounded-full", PILL[event.tone].dot)} />)}</span>
                    <span className="hidden space-y-0.5 md:block" aria-hidden="true">
                      {list.slice(0, 2).map(event => <span key={event.key} className={cn("block truncate rounded px-1 py-0.5 text-[11px] leading-4", PILL[event.tone].surface, event.muted && "opacity-60 line-through")}>{eventTime(event, locale) ? `${eventTime(event, locale).split("–")[0]} ` : ""}{event.title}</span>)}
                      {list.length > 2 && <span className="block px-1 text-[11px] text-muted-foreground">{mt("plusMoreCount", { count: list.length - 2 })}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGEND.map(([tone, key]) => <li key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className={cn("size-2 rounded-full", PILL[tone].dot)} />{mt(key)}</li>)}
          </ul>
          <Button variant="ghost" size="sm" onClick={onNavigateToBookings}>{mt("viewAllBookings")}<ChevronRight className="size-4" aria-hidden="true" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
