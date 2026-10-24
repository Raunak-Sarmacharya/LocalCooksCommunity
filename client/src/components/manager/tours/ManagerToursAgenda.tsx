/**
 * The kitchen's tours list, built like the bookings list (ManagerBookingsAgenda): Upcoming opens on "Needs action"
 * (requests to answer, time changes to review, visits to record), then Today, then Upcoming; Past and Cancelled are their
 * own tabs. Each row: when, customer and kitchen, a pill with one short line, and ONE action only when the kitchen owes one.
 * Every row opens the tour, where the choice is made (no one-tap actions).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "@/components/booking/BookingNowCard";
import { managerTourGroups, TOUR_PILL, tourWhenLine, type ListedTour, type TourListGroup, type TourListTour, type TourRowAction } from "@/lib/tour-list-status";
import { friendlyTimezoneName } from "@shared/timezone-utils";
import { formatResponseDeadline } from "@/lib/booking-response-deadline";
import { ct } from "@/i18n/chef-ns";
import { mt } from "@/i18n/manager";
import { cn } from "@/lib/utils";
import { ListFilters } from "../ListFilters";

type Tab = "upcoming" | "past" | "cancelled";
export type TourAgendaRecord = { viewing: TourListTour; chefName?: string | null; chefUsername?: string | null; kitchenName: string | null; locationName: string | null; locationTimezone: string | null };

const ACTION_LABEL: Record<NonNullable<TourRowAction>, () => string> = {
  review_request: () => ct("bdTakeAction"), review_change: () => mt("tlReviewChange"), record_visit: () => ct("bnDidTheyCome"),
};

export function customerName(record: TourAgendaRecord) {
  return record.chefName?.trim() || record.chefUsername?.split("@")[0] || mt("tlCustomer");
}

export function ManagerToursAgenda({ records, onOpen }: { records: TourAgendaRecord[]; onOpen: (record: TourAgendaRecord) => void }) {
  const { i18n } = useTranslation("manager");
  const locale = i18n.language || "en-CA";
  const [tab, setTab] = useState<Tab>("upcoming");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const zones = useMemo(() => Array.from(new Set(records.map(record => record.locationTimezone || "America/St_Johns"))), [records]);
  const timeZone = zones[0] || "America/St_Johns";
  const words = { today: mt("mblToday"), tomorrow: ct("ovTomorrow") };
  const groups = useMemo(() => managerTourGroups(records, timeZone), [records, timeZone]);
  const upcomingCount = groups.needs_action.length + groups.today.length + groups.upcoming.length;
  const activeTab: Tab = tab === "cancelled" && !groups.cancelled.length ? "upcoming" : tab;
  const sections: Array<{ key: TourListGroup; title?: string }> = activeTab === "upcoming"
    ? [{ key: "needs_action", title: mt("mblNeedsAction") }, { key: "today", title: mt("mblToday") }, { key: "upcoming", title: mt("mblUpcoming") }]
    : [{ key: activeTab }];

  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const matches = (item: ListedTour<TourAgendaRecord>) => {
    const record = item.row, date = day(record.viewing.scheduledAt);
    if ((from && date < from) || (to && date > to) || (status !== "all" && item.state !== status)) return false;
    const q = query.trim().toLowerCase();
    return !q || [`TOUR-${record.viewing.id}`, String(record.viewing.id), customerName(record), record.chefUsername, record.kitchenName, record.locationName,
      tourWhenLine(record.viewing, timeZone, locale, words)].filter(Boolean).join(" ").toLowerCase().includes(q);
  };
  const shown = sections.map(section => ({ ...section, items: (groups[section.key] as Array<ListedTour<TourAgendaRecord>>).filter(matches) })).filter(section => section.items.length);
  const statuses = Array.from(new Set(Object.values(groups).flat().map(item => item.state))).map(state => ({ value: state, label: mt(TOUR_PILL[state].key) }));
  const line = (item: ListedTour<TourAgendaRecord>) => item.state === "request" || item.state === "change_requested"
    ? item.dueAt ? mt("tlRespondBy", { time: formatResponseDeadline(new Date(item.dueAt), locale, timeZone, false) }) : ""
    : item.state === "record" && item.dueAt ? mt("tlRecordBy", { time: formatResponseDeadline(new Date(item.dueAt), locale, timeZone, false) })
    : item.state === "times_offered" ? mt("tlWaitingOnCustomer") : "";

  const tabTrigger = (key: Tab, label: string, count: number) => (
    <TabsTrigger value={key} className="min-h-11 gap-1.5 px-4 sm:min-h-9">{label}{count > 0 && <span className="tabular-nums font-normal">{count}</span>}</TabsTrigger>
  );
  const grid = "md:grid md:grid-cols-[220px_minmax(0,1fr)_240px_150px] md:items-center md:gap-4";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={activeTab} onValueChange={value => setTab(value as Tab)}>
          <TabsList className="h-auto">
            {tabTrigger("upcoming", mt("mblUpcoming"), upcomingCount)}
            {tabTrigger("past", mt("mblPast"), groups.past.length)}
            {groups.cancelled.length > 0 && tabTrigger("cancelled", mt("mblCancelled"), groups.cancelled.length)}
          </TabsList>
        </Tabs>
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={mt("mblSearch")} aria-label={mt("mblSearch")} className="min-h-11 pl-9 pr-10 md:min-h-9" />
          {query && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setQuery("")} aria-label={ct("bkClearSearch")}><X className="h-4 w-4" /></Button>}
        </div>
      </div>
      <ListFilters status={status} onStatus={setStatus} statuses={statuses} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {zones.length === 1 && <p className="text-[13px] text-muted-foreground">{mt("mblTimesIn", { zone: friendlyTimezoneName(timeZone, locale) })}</p>}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-[15px]">
          {query.trim() ? mt("tlNoMatch", { query: query.trim() }) : from || to || status !== "all" ? mt("tlNoFilterMatch") : mt(activeTab === "past" ? "tlEmptyPast" : activeTab === "cancelled" ? "tlEmptyCancelled" : "tlEmptyUpcoming")}
        </div>
      ) : (
        <div className="space-y-6">
          <div className={cn("hidden px-4 text-xs font-medium text-muted-foreground", grid)} aria-hidden>
            <span>{mt("mblColWhen")}</span><span>{mt("mblColWho")}</span><span>{mt("mblColStatus")}</span><span />
          </div>
          {shown.map(section => (
            <section key={section.key} aria-label={section.title || undefined} data-testid={`tour-group-${section.key}`}>
              {section.title && <h3 className="mb-2 text-sm font-semibold">{section.title} <span className="font-normal tabular-nums text-muted-foreground">{section.items.length}</span></h3>}
              <ul className="divide-y overflow-hidden rounded-2xl border border-border/70 bg-card">
                {section.items.map(item => {
                  const record = item.row, pill = TOUR_PILL[item.state], note = line(item);
                  return (
                    <li key={record.viewing.id} className={cn("relative px-4 py-3 transition-colors hover:bg-muted/40", grid)} data-testid="manager-tour-row" data-state={item.state}>
                      <p className="text-sm font-medium tabular-nums">
                        {/* The whole row opens the tour; the action button sits above the overlay. */}
                        <button type="button" onClick={() => onOpen(record)} className="text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring">
                          {tourWhenLine(record.viewing, timeZone, locale, words)}
                          <span className="sr-only"> · TOUR-{record.viewing.id}</span>
                        </button>
                      </p>
                      <div className="mt-0.5 min-w-0 md:mt-0">
                        <p className="truncate text-sm">{customerName(record)}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{record.kitchenName || record.locationName || mt("unknownKitchen")}</p>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:mt-0 md:block">
                        <StatusPill tone={pill.tone}>{mt(pill.key)}</StatusPill>
                        {note && <p className="text-[13px] text-muted-foreground md:mt-1">{note}</p>}
                      </div>
                      <div className={cn("mt-3 md:mt-0 md:text-right", !item.action && "hidden md:block")}>
                        {item.action && <Button size="sm" variant="outline" className="relative z-10 min-h-11 w-full md:min-h-9 md:w-auto" onClick={() => onOpen(record)}
                          aria-label={`${ACTION_LABEL[item.action]()}: ${customerName(record)}, ${tourWhenLine(record.viewing, timeZone, locale, words)}`}>{ACTION_LABEL[item.action]()}</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
