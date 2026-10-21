import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { mt } from "@/i18n/manager";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { timeRange, type BookingPillTone } from "@/lib/booking-header-state";
import { formatTime } from "@/lib/formatters";
import { addDaysKey, spanMinutes, weekStartKey } from "@/lib/manager-week-stats";
import { cn } from "@/lib/utils";
import { badge, btnSecondary, card, cardHead, cardMeta, cardTitle, focusRing, linkTertiary, sub, type BadgeTone } from "./dashboard-ui";

/**
 * The kitchen's week on the dashboard: everything that happens in the kitchen on a day — booked days (one per day of
 * a multi-day booking), tours, closures and special hours, storage move-ins and move-outs — each opening its own page.
 * Week is a timeline (days down, hours across); under 900 px it opens on the Agenda, with Day, Week and Month a tap
 * away. Cancelled bookings are hidden until "Show cancelled". Display only; the overview builds the events.
 */
export type VisitState = "booked" | "requested" | "answer" | "noCheckin" | "finished" | "cancelled";
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
  /** State in words ("Answer needed", "Tour requested", "Closed"). */
  label: string;
  tone: BookingPillTone;
  /** A booking's state on the calendar; decides its colour, badge and legend entry. */
  state?: VisitState;
  /** Finished or cancelled: drawn quietly. */
  muted?: boolean;
  /** Cancelled: hidden from the calendar until "Show cancelled", and folded in the Today list. */
  cancelled?: boolean;
  /** The chef is in the kitchen now. */
  now?: boolean;
  href?: string;
  onOpen?: () => void;
};

/** One look per state, shared by the timeline bars, the agenda dots, the badges and the legend, so they can't disagree. */
type Look = { bar: string; dot: string; badge?: BadgeTone; legend: string };
const LOOK: Record<VisitState | "tour" | "storage" | "closed" | "hours", Look> = {
  booked: { bar: "bg-[#fbdae1] text-[#8f0a2b] ring-1 ring-inset ring-[#f5a9ba]", dot: "bg-primary", legend: "ovrLegendBooked" },
  requested: { bar: "bg-white text-[#8f0a2b] border border-dashed border-[#e87a93]", dot: "bg-[#f5a9ba]", badge: "brand", legend: "ovrLegendRequested" },
  answer: { bar: "bg-amber-200 text-amber-900 ring-1 ring-inset ring-amber-400", dot: "bg-amber-500", badge: "attention", legend: "ovrLegendAnswerNeeded" },
  noCheckin: { bar: "bg-stone-100 text-stone-600 border border-dashed border-stone-400", dot: "bg-stone-300", badge: "neutral", legend: "ovrLegendNoCheckin" },
  finished: { bar: "bg-stone-200 text-stone-700 ring-1 ring-inset ring-stone-300", dot: "bg-stone-400", badge: "neutral", legend: "ovrLegendFinished" },
  cancelled: { bar: "bg-white text-stone-400 line-through ring-1 ring-inset ring-stone-200", dot: "bg-stone-200", badge: "neutral", legend: "ovrLegendCancelled" },
  tour: { bar: "bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-300", dot: "bg-sky-500", badge: "neutral", legend: "ovrLegendTour" },
  storage: { bar: "bg-stone-100 text-stone-700", dot: "bg-stone-900", legend: "ovrLegendStorage" },
  closed: { bar: "bg-stone-100 text-stone-600", dot: "bg-stone-400", badge: "neutral", legend: "closed" },
  hours: { bar: "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200", dot: "bg-stone-400", badge: "neutral", legend: "ovrSpecialHours" },
};
export const eventLook = (event: CalendarEvent): Look => LOOK[event.kind === "booking" ? event.state ?? "booked" : event.kind === "tour" ? "tour"
  : event.kind === "moveIn" || event.kind === "moveOut" ? "storage" : event.kind];

type View = "agenda" | "day" | "week" | "month";
const VIEWS: Array<[View, string]> = [["agenda", "ovrAgendaView"], ["day", "ovrDayView"], ["week", "weekView"], ["month", "monthView"]];
/** Under 900 px a one-hour bar is too narrow for its time, so the card opens on the Agenda. */
export const defaultCalendarView = (): View => typeof window !== "undefined" && window.matchMedia?.("(max-width: 899px)")?.matches ? "agenda" : "week";
const AGENDA_DAYS = 7;

const asDate = (key: string) => new Date(`${key}T12:00:00Z`);
const dayFormat = (locale: string, options: Intl.DateTimeFormatOptions) => (key: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(asDate(key));
const allDay = (event: CalendarEvent) => !event.start;
const minutesOf = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + (minutes || 0); };

export const eventTime = (event: CalendarEvent, locale: string) =>
  event.start && event.end ? timeRange(formatTime(event.start, locale), formatTime(event.end, locale)) : event.start ? formatTime(event.start, locale) : "";

export function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => Number(!allDay(a)) - Number(!allDay(b))
    || (a.sortAt ?? 0) - (b.sortAt ?? 0) || (a.start ?? "").localeCompare(b.start ?? ""));
}

function EventLink({ event, className, children, label, title, style }: { event: CalendarEvent; className: string; children: ReactNode; label?: string; title?: string; style?: CSSProperties }) {
  if (event.href) return <Link href={event.href} aria-label={label} title={title} style={style} className={cn(className, focusRing)}>{children}</Link>;
  if (event.onOpen) return <button type="button" aria-label={label} title={title} style={style} onClick={event.onOpen} className={cn("text-left", className, focusRing)}>{children}</button>;
  return <div title={title} style={style} className={className}>{children}</div>;
}

/** The state badge a row carries, or nothing for a plain booked visit (its row is a link with a chevron). */
function StateBadge({ event }: { event: CalendarEvent }) {
  if (event.now) return <span className={badge.positive}><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />{mt("ovrInKitchenNowBadge")}</span>;
  const tone = eventLook(event).badge;
  return tone ? <span className={badge[tone]}>{event.label}</span> : null;
}

/**
 * One visit as a row: the time in bold (a state dot in front when asked), its badge on the right, "who · where" under it.
 * Shared by the Today card, the Agenda and the Day view, so a visit reads the same everywhere.
 */
export function CalendarEventRow({ event, locale, dot = false }: { event: CalendarEvent; locale: string; dot?: boolean }) {
  const time = eventTime(event, locale);
  const look = eventLook(event);
  return (
    <EventLink event={event} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md py-2.5 transition-colors hover:bg-stone-50 motion-reduce:transition-none">
      <span className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold tabular-nums text-stone-900", event.cancelled && "text-stone-500 line-through")}>
        {dot && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-sm", look.dot)} />}
        <span className="min-w-0 break-words">{time || event.label}</span>
      </span>
      <span className="justify-self-end">{event.now || look.badge ? <StateBadge event={event} />
        : (event.href || event.onOpen) ? <ChevronRight className="size-4 text-stone-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" /> : null}</span>
      <span className={cn("col-span-2 mt-0.5 min-w-0 break-words", sub, dot && "pl-4")}>{[event.title, event.detail].filter(Boolean).join(" · ")}</span>
    </EventLink>
  );
}

/** Week timeline geometry: hours shown, rounded out to 3 h gridlines around what is booked (6 a.m.–midnight when empty). */
function axisFor(events: CalendarEvent[]) {
  const timed = events.filter(event => event.start && event.end);
  if (!timed.length) return { from: 6 * 60, to: 24 * 60 };
  const starts = timed.map(event => minutesOf(event.start!));
  const ends = timed.map(event => minutesOf(event.start!) + spanMinutes(event.start!, event.end!));
  const from = Math.max(0, Math.floor(Math.min(...starts) / 180) * 180);
  return { from, to: Math.max(from + 540, Math.min(24 * 60, Math.ceil(Math.max(...ends) / 180) * 180)) };
}
// shortcut: label width is estimated per character (12 px Figtree ≈ 6.6 px, bare digits ≈ 6 px); measure with a probe if labels ever clip.
const textWidth = (text: string) => text.length * (/^[\d–:]+$/.test(text) ? 6 : 6.6);

function WeekTimeline({ week, byDay, today, nowMinutes, locale, onOpenDay }: { week: string[]; byDay: Map<string, CalendarEvent[]>; today: string; nowMinutes: number; locale: string; onOpenDay: (key: string) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const node = trackRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => setTrackWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const all = week.flatMap(key => byDay.get(key) ?? []);
  const { from, to } = axisFor(all);
  const pct = (minutes: number) => `${((Math.min(Math.max(minutes, from), to) - from) / (to - from)) * 100}%`;
  const ticks = Array.from({ length: (to - from) / 180 + 1 }, (_, index) => from + index * 180);
  const hourLabel = (minutes: number) => formatTime(`${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:00`, locale).replace(/:00(?=\D|$)/, "");
  const weekday = dayFormat(locale, { weekday: "short" });
  const dayNumber = dayFormat(locale, { day: "numeric" });
  const longDay = dayFormat(locale, { weekday: "long", month: "long", day: "numeric" });
  const pxPerMinute = trackWidth / (to - from);
  const grid = ticks.slice(1, -1).map(minutes => <i key={minutes} aria-hidden="true" className="absolute inset-y-0 w-px bg-stone-100" style={{ left: pct(minutes) }} />);
  return (
    <div className="overflow-x-auto" data-testid="week-timeline">
      <div className="min-w-[640px]">
        <div aria-hidden="true" className="grid h-7 grid-cols-[88px_minmax(0,1fr)_52px] items-center text-[11px] leading-4 text-stone-500 sm:grid-cols-[112px_minmax(0,1fr)_52px]">
          <span />
          <div ref={trackRef} className="relative h-full">{ticks.map((minutes, index) => <span key={minutes} className={cn("absolute top-1.5 whitespace-nowrap", index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(minutes) }}>{hourLabel(minutes)}</span>)}</div>
          <span />
        </div>
        {week.map(key => {
          const list = byDay.get(key) ?? [];
          const isToday = key === today;
          // Cancelled first, so a live booking in the same hours is drawn on top of it.
          const timed = list.filter(event => event.start && event.end).sort((a, b) => Number(!a.cancelled) - Number(!b.cancelled));
          const notes = list.filter(allDay);
          const bookedMinutes = timed.filter(event => event.kind === "booking" && !event.cancelled).reduce((sum, event) => sum + spanMinutes(event.start!, event.end!), 0);
          const nextStart = Math.min(to, ...timed.map(event => minutesOf(event.start!)).filter(start => start > nowMinutes));
          return (
            <section key={key} aria-label={longDay(key)} className={cn("grid h-11 grid-cols-[88px_minmax(0,1fr)_52px] items-center rounded-lg sm:grid-cols-[112px_minmax(0,1fr)_52px]", isToday ? "bg-[#fef3f5]" : "[&+&]:shadow-[inset_0_1px_0_#f0eeec]")}>
              <div className={cn("min-w-0 pl-2.5 text-sm leading-4", isToday ? "text-[#8f0a2b]" : "text-stone-900")}>
                <button type="button" onClick={() => onOpenDay(key)} className={cn("rounded text-left", focusRing)}><span className="font-semibold">{weekday(key)}</span><span className={cn("ml-1", isToday ? "" : "text-stone-500")}>{dayNumber(key)}</span></button>
                {notes.map(event => <EventLink key={event.key} event={event} label={[event.label, event.title].join(" · ")} className="block truncate text-[11px] leading-[14px] text-stone-500 hover:text-stone-900">{event.label}</EventLink>)}
              </div>
              <div className="relative h-11">
                {grid}
                {timed.map(event => {
                  const start = minutesOf(event.start!), end = start + spanMinutes(event.start!, event.end!);
                  const range = eventTime(event, locale);
                  const short = range.replace(/:00(?=\D|$)/g, "");
                  const digits = short.replace(/\s?[ap]\.\s?m\./gi, "");
                  const width = (Math.min(end, to) - Math.max(start, from)) * pxPerMinute;
                  // The longest form that fits inside the bar; the full text is always in the tooltip and label.
                  const roomy = !trackWidth ? short : [`${event.title} · ${range}`, range, short].find(text => textWidth(text) + 16 <= width - 2);
                  const text = roomy ?? (textWidth(digits) + 8 <= width - 2 ? digits : "");
                  const full = [longDay(key), range, event.title, event.label].filter(Boolean).join(", ");
                  return <EventLink key={event.key} event={event} label={full} title={[event.title, range, event.label].join(" · ")}
                    style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)} - 1px)` }}
                    className={cn("absolute top-2.5 h-6 overflow-hidden whitespace-nowrap rounded-md text-xs font-medium leading-6 [font-variant-numeric:proportional-nums] hover:shadow-[inset_0_0_0_1px_currentColor]",
                      roomy ? "px-2" : "px-1 text-center", eventLook(event).bar, eventLook(event).bar.includes("border") && "leading-[22px]")}>{text}</EventLink>;
                })}
                {isToday && nowMinutes >= from && nowMinutes <= to && <>
                  <span aria-hidden="true" className="absolute inset-y-1 -ml-px w-0.5 rounded-sm bg-primary before:absolute before:-left-[3px] before:-top-[3px] before:size-2 before:rounded-full before:bg-primary" style={{ left: pct(nowMinutes) }} />
                  {(nextStart - nowMinutes) * pxPerMinute > 86 && <span className="absolute top-3.5 whitespace-nowrap pl-2 text-[11px] font-semibold leading-4 text-[#8f0a2b]" style={{ left: pct(nowMinutes) }}>{mt("ovrNowAt", { time: hourMinute(nowMinutes, locale) })}</span>}
                </>}
              </div>
              <div className="pr-2.5 text-right text-sm font-medium tabular-nums text-stone-900">{bookedMinutes ? mt("ovrHoursValue", { hours: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bookedMinutes / 60) }) : ""}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const hourMinute = (minutes: number, locale: string) => formatTime(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, locale);
/** Minutes since midnight in the kitchen's zone. */
export const kitchenNowMinutes = (timeZone: string, at = Date.now()) => {
  const [hours, minutes] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  return hours * 60 + minutes;
};

interface BookingCalendarWidgetProps {
  events: CalendarEvent[];
  isLoading: boolean;
  /** The kitchen's today, YYYY-MM-DD. */
  today: string;
  /** The kitchen's zone, for the now-line. */
  timezone?: string;
  /** The week's numbers, shown between the header and the calendar. */
  stats?: ReactNode;
  onNavigateToBookings: () => void;
}

export default function BookingCalendarWidget({ events, isLoading, today, timezone = "America/St_Johns", stats, onNavigateToBookings }: BookingCalendarWidgetProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const [view, setView] = useState<View>(defaultCalendarView);
  const [anchor, setAnchor] = useState(today);
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelledId = useId();
  const hasCancelled = events.some(event => event.cancelled);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) if (showCancelled || !event.cancelled) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    map.forEach((list, key) => map.set(key, sortEvents(list)));
    return map;
  }, [events, showCancelled]);

  const weekStart = weekStartKey(anchor);
  const week = Array.from({ length: 7 }, (_, index) => addDaysKey(weekStart, index));
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = addDaysKey(`${addDaysKey(monthStart, 32).slice(0, 7)}-01`, -1);
  const monthDays: string[] = [];
  for (let key = weekStartKey(monthStart); key <= addDaysKey(weekStartKey(monthEnd), 6); key = addDaysKey(key, 1)) monthDays.push(key);

  // Agenda: the anchor day (always shown) and the next six days that have something on.
  const agenda = Array.from({ length: AGENDA_DAYS }, (_, index) => addDaysKey(anchor, index)).filter((key, index) => !index || byDay.get(key)?.length);
  const shift = (direction: 1 | -1) => setAnchor(view === "day" ? addDaysKey(anchor, direction)
    : view === "week" || view === "agenda" ? addDaysKey(anchor, 7 * direction) : `${(direction > 0 ? addDaysKey(monthEnd, 1) : addDaysKey(monthStart, -1)).slice(0, 7)}-01`);
  const openDay = (key: string) => { setAnchor(key); setView("day"); };

  const span = (first: string, last: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", day: "numeric" }).formatRange(asDate(first), asDate(last));
  const range = view === "day" ? dayFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })(anchor)
    : view === "week" ? span(week[0], week[6]) : view === "agenda" ? span(anchor, addDaysKey(anchor, AGENDA_DAYS - 1))
    : dayFormat(locale, { month: "long", year: "numeric" })(monthStart);
  const weekday = dayFormat(locale, { weekday: "short" });
  const dayNumber = dayFormat(locale, { day: "numeric" });
  // The week's numbers belong to this week only: shown while the card shows it.
  const thisWeek = (view === "week" && week.includes(today)) || (view === "agenda" && anchor === today);
  const short = dayFormat(locale, { month: "short", day: "numeric" });
  const weekEmpty = week.every(key => !byDay.get(key)?.length);
  const hours = (key: string) => { const minutes = (byDay.get(key) ?? []).filter(event => event.kind === "booking" && !event.cancelled && event.start && event.end).reduce((sum, event) => sum + spanMinutes(event.start!, event.end!), 0);
    return minutes ? mt("ovrHoursValue", { hours: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60) }) : ""; };
  const nowMinutes = kitchenNowMinutes(timezone);
  // The legend names only what the timeline draws this week, plus the now-line when today is in it.
  const drawn = week.flatMap(key => (byDay.get(key) ?? []).filter(event => event.start && event.end));
  const legend = Array.from(new Set(drawn.map(event => eventLook(event).legend)));
  const legendLook = (key: string) => Object.values(LOOK).find(look => look.legend === key)!;

  return (
    <section className={card} data-testid="overview-calendar" aria-labelledby="overview-week-title">
      <div className={cn(cardHead, "flex-wrap")}>
        <h2 id="overview-week-title" className={cardTitle} aria-live="polite">{thisWeek ? <>{mt("ovrThisWeek")}<span className={cardMeta} data-testid="calendar-range">{range}</span></> : <span data-testid="calendar-range">{range}</span>}</h2>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button type="button" className={cn(btnSecondary, "hidden flex-none sm:inline-flex")} onClick={() => setAnchor(today)}>{mt("today")}</button>
          <button type="button" className={cn(btnSecondary, "w-10 flex-none px-0 sm:w-8")} onClick={() => shift(-1)} aria-label={mt("previous")}><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <button type="button" className={cn(btnSecondary, "w-10 flex-none px-0 sm:w-8")} onClick={() => shift(1)} aria-label={mt("next")}><ChevronRight className="size-4" aria-hidden="true" /></button>
          {/* Plain buttons, not Radix ToggleGroup: its items are role="radio", and index.css sizes every
              [data-radix-collection-item][role="radio"] to 16x16 with !important, which squeezed the labels into
              "Day WeekMonth" (the same reason EquipmentListingManagement's AvailabilityToggle is hand-rolled). */}
          <div role="group" aria-label={mt("ovrCalendarView")} className="ml-auto inline-flex rounded-lg bg-stone-100 p-0.5 ring-1 ring-inset ring-stone-200 sm:ml-0">
            {VIEWS.map(([option, key]) => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}
                className={cn("h-9 rounded-md px-2.5 text-[13px] transition-colors sm:h-7", focusRing,
                  view === option ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.08),0_0_0_1px_rgba(28,25,23,.06)]" : "text-stone-600 hover:text-stone-900")}>
                {mt(key)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        {thisWeek && stats}
        {isLoading ? <Skeleton className="mt-4 h-48 rounded-lg" /> : view === "week" ? (
          <div className="mt-4">
            <WeekTimeline week={week} byDay={byDay} today={today} nowMinutes={nowMinutes} locale={locale} onOpenDay={openDay} />
            {weekEmpty && <p className={cn("mt-2 rounded-lg bg-stone-50 p-4", sub)}>{mt("ovrNothingThisWeek")}</p>}
          </div>
        ) : view === "agenda" ? (
          <div className="mt-2">
            {agenda.map(key => {
              const list = byDay.get(key) ?? [];
              const isToday = key === today;
              return (
                <section key={key} aria-label={dayFormat(locale, { weekday: "long", month: "long", day: "numeric" })(key)} className="pt-3">
                  <button type="button" onClick={() => openDay(key)} className={cn("flex w-full items-baseline justify-between gap-2 rounded border-b border-stone-100 pb-2 text-left text-[13px]", focusRing)}>
                    <span className={cn("font-semibold", isToday ? "text-[#8f0a2b]" : "text-stone-900")}>{isToday ? mt("today") : weekday(key)}</span>
                    <span className="text-stone-500 tabular-nums">{[short(key), hours(key)].filter(Boolean).join(" · ")}</span>
                  </button>
                  <div className="divide-y divide-stone-100">
                    {list.map(event => <CalendarEventRow key={event.key} event={event} locale={locale} dot />)}
                    {!list.length && <p className={cn("py-2.5", sub)}>{mt("ovrNothingScheduled")}</p>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : view === "day" ? (
          <div className="mt-2 divide-y divide-stone-100">
            {(byDay.get(anchor) ?? []).map(event => <CalendarEventRow key={event.key} event={event} locale={locale} dot />)}
            {!byDay.get(anchor)?.length && <p className={cn("rounded-lg bg-stone-50 p-4", sub)}>{mt("ovrNothingScheduled")}</p>}
          </div>
        ) : (
          <div className="mt-4">
            <div className="grid grid-cols-7 pb-1 text-center text-xs font-medium text-stone-500" aria-hidden="true">
              {week.map(key => <span key={key}>{weekday(key)}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200">
              {monthDays.map(key => {
                const list = byDay.get(key) ?? [];
                const inMonth = key.slice(0, 7) === monthStart.slice(0, 7);
                return (
                  <button key={key} type="button" onClick={() => openDay(key)}
                    aria-label={`${dayFormat(locale, { weekday: "long", month: "long", day: "numeric" })(key)} · ${mt("ovrEventCount", { count: list.length })}`}
                    className={cn("flex min-h-14 flex-col items-stretch gap-1 bg-white p-1 text-left hover:bg-stone-50 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-24 md:p-1.5", !inMonth && "bg-stone-50 text-stone-400")}>
                    <span className={cn("inline-flex size-6 items-center justify-center self-start rounded-full text-xs font-medium tabular-nums", key === today && "bg-primary text-white")}>{dayNumber(key)}</span>
                    <span className="flex flex-wrap gap-0.5 md:hidden" aria-hidden="true">{list.slice(0, 3).map(event => <span key={event.key} className={cn("size-1.5 rounded-sm", eventLook(event).dot)} />)}</span>
                    <span className="hidden space-y-0.5 md:block" aria-hidden="true">
                      {list.slice(0, 2).map(event => <span key={event.key} className={cn("block truncate rounded px-1 text-[11px] leading-4", eventLook(event).bar)}>{eventTime(event, locale) ? `${eventTime(event, locale).split("–")[0]} ` : ""}{event.title}</span>)}
                      {list.length > 2 && <span className="block px-1 text-[11px] text-stone-500">{mt("plusMoreCount", { count: list.length - 2 })}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-stone-100 pt-3.5">
          {view === "week" && (legend.length > 0 || week.includes(today)) && <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600" aria-label={mt("ovrLegend")} data-testid="calendar-legend">
            {legend.map(key => <li key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden="true" className={cn("h-2.5 w-3.5 rounded-[3px]", legendLook(key).bar)} />{mt(key)}</li>)}
            {week.includes(today) && <li className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden="true" className="h-3 w-0.5 rounded-sm bg-primary" />{mt("ovrLegendNow")}</li>}
          </ul>}
          <div className="flex flex-1 flex-wrap items-center justify-between gap-x-5 gap-y-2 sm:justify-end">
            {hasCancelled && <div className="flex items-center gap-2">
              <Switch id={cancelledId} checked={showCancelled} onCheckedChange={setShowCancelled} />
              <Label htmlFor={cancelledId} className="text-[13px] font-normal text-stone-600">{mt("ovrShowCancelled")}</Label>
            </div>}
            <button type="button" className={linkTertiary} onClick={onNavigateToBookings}>{mt("viewAllBookings")}<ChevronRight className="size-3.5" aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
