/**
 * The manager's bookings list (Skedda / Nexudus agenda): dense rows, not chef cards. Upcoming opens on "Needs action"
 * (requests, checkouts to review, visits whose time ended with the chef still in, cancellation requests, visits to
 * inspect), then Today, then Upcoming by start; Past and Cancelled are their own tabs. Each row: when (12-hour, friendly
 * date), chef and kitchen, the booking page's pill, the payment, and ONE action only when something waits on the manager.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Search, X } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "@/components/booking/BookingNowCard";
import type { BookingHeaderPhase } from "@/lib/booking-header-state";
import { bookingCancelCause } from "@/lib/booking-cancel-cause";
import {
  bookingListPill, listDaySpan, listTimezone, listWhenLine, managerBookingGroups, managerRowAction, showArrivalLine, waitingForChef, managerDatedListDay,
  type ListedBooking, type ManagerListGroup, type ManagerRowAction,
} from "@/lib/booking-list-status";
import { friendlyTimezoneName } from "@shared/timezone-utils";
import { ct } from "@/i18n/chef-ns";
import { mt } from "@/i18n/manager";
import { cn } from "@/lib/utils";
import { ManagerPaymentSummary, bookingReceiveCents, type Booking } from "./ManagerBookingPayment";

import { ListFilters } from "../ListFilters";
import { downloadCSV } from "@/lib/formatters";

type Tab = "upcoming" | "past" | "cancelled";
type Row = Booking & { paymentDecision?: { target?: string; actorId?: number | null } | null };

const ACTION_LABEL: Record<NonNullable<ManagerRowAction>, string> = {
  review_request: "bdTakeAction", review_cancellation: "bdhReviewCancellation", review_checkout: "bdhReviewCheckout",
  inspect_visit: "fixInspection", open_visit: "bdhOpenVisit", record_left: "bdhOverstayRecordLeft", answer_attendance: "bnDidTheyCome",
};

/** The booking page's inspection link: the one visit, or the visit whose checkout is waiting. */
export function inspectionHref(row: Row) {
  const visits = row.visitStates || [];
  const visitId = visits.length === 1 ? visits[0].id : visits.find(visit => visit.checkinStatus === "checkout_requested")?.id;
  return `/manager/booking/${row.id}/inspection${visitId ? `?visitId=${visitId}` : ""}`;
}

/** One short line under the pill: why a time-ended visit waits, or when the chef arrived. */
function statusLine(row: Row, phase: BookingHeaderPhase, locale: string) {
  if (phase === "time_ended_in_session") return mt("mblTimeEnded");
  if (!showArrivalLine(phase) || !row.checkedInAt) return "";
  try {
    const time = new Intl.DateTimeFormat(locale, { timeZone: listTimezone(row), hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(row.checkedInAt));
    return ct("fixArrivalStatus", { time });
  } catch { return ""; }
}

export function ManagerBookingsAgenda({ bookings, onReviewRequest }: {
  bookings: Row[];
  /** "Review request" opens the request dialog in place (it checks the kitchen licence first). */
  onReviewRequest: (booking: Row) => void;
}) {
  const { i18n } = useTranslation("manager");
  const locale = i18n.language || "en-CA";
  const [tab, setTab] = useState<Tab>("upcoming");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const words = { today: mt("mblToday"), tomorrow: ct("ovTomorrow") };
  const groups = useMemo(() => managerBookingGroups(bookings.map(row => managerDatedListDay(row))), [bookings]);
  const upcomingCount = groups.needs_action.length + groups.today.length + groups.upcoming.length;
  const activeTab: Tab = tab === "cancelled" && !groups.cancelled.length ? "upcoming" : tab;
  const sections: Array<{ key: ManagerListGroup; title?: string }> = activeTab === "upcoming"
    ? [{ key: "needs_action", title: mt("mblNeedsAction") }, { key: "today", title: mt("mblToday") }, { key: "upcoming", title: mt("mblUpcoming") }]
    : [{ key: activeTab }];
  const zones = useMemo(() => Array.from(new Set(bookings.map(row => listTimezone(row)))), [bookings]);

  const matches = (item: ListedBooking<Row>) => {
    const q = query.trim().toLowerCase();
    const row = item.row;
    const date = row.bookingDate.slice(0, 10);
    if ((from && date < from) || (to && date > to) || (status !== "all" && item.phase !== status)) return false;
    if (!q) return true;
    return [row.referenceCode, String(row.id), row.chefName, row.kitchenName, row.locationName, listWhenLine(row, locale, words)]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  };
  const shown = sections.map(section => ({ ...section, items: groups[section.key].filter(matches) })).filter(section => section.items.length);

  const statuses = Array.from(new Set(Object.values(groups).flat().map(item => item.phase)))
    .map(phase => ({ value: phase, label: ct(bookingListPill(phase, true).key) }));
  const dayLabel = (row: Row) => bookingDayLabel(row, bookings);

  const tabTrigger = (key: Tab, label: string, count: number) => (
    <TabsTrigger value={key} className="min-h-11 gap-1.5 px-4 sm:min-h-9">{label}{count > 0 && <span className="tabular-nums font-normal">{count}</span>}</TabsTrigger>
  );
  const grid = "md:grid md:grid-cols-[220px_minmax(0,1fr)_190px_100px_150px] md:items-center md:gap-4";

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ListFilters status={status} onStatus={setStatus} statuses={statuses} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <Button variant="outline" disabled={!shown.length} onClick={() => downloadCSV(managerBookingsCSV(shown.flatMap(section => section.items), bookings), "bookings")}>{mt("r2ExportCsv")}</Button>
      </div>
      {zones.length === 1 && <p className="text-[13px] text-muted-foreground">{mt("mblTimesIn", { zone: friendlyTimezoneName(zones[0], locale) })}</p>}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-[15px]">
          {query.trim() ? mt("mblNoMatch", { query: query.trim() }) : from || to || status !== "all" ? mt("r2NoBookingsMatch") : mt(activeTab === "past" ? "mblEmptyPast" : "mblEmptyUpcoming")}
        </div>
      ) : (
        <div className="space-y-6">
          <div className={cn("hidden px-4 text-xs font-medium text-muted-foreground", grid)} aria-hidden>
            <span>{mt("mblColWhen")}</span><span>{mt("mblColWho")}</span><span>{mt("mblColStatus")}</span>
            <span className="text-right">{mt("mblColPayment")}</span><span />
          </div>
          {shown.map(section => (
            <section key={section.key} aria-label={section.title || undefined} data-testid={`manager-group-${section.key}`}>
              {section.title && <h3 className="mb-2 text-sm font-semibold">{section.title} <span className="font-normal tabular-nums text-muted-foreground">{section.items.length}</span></h3>}
              <ul className="divide-y overflow-hidden rounded-2xl border border-border/70 bg-card">
                {section.items.map(item => {
                  const { row, phase } = item;
                  const action = managerRowAction(row, phase);
                  const cause = bookingCancelCause({ status: row.status, chefId: row.chefId, paymentDecision: row.paymentDecision });
                  const pill = waitingForChef(row) ? { key: "paPillKitchen", tone: bookingListPill(phase, true, cause).tone } : bookingListPill(phase, true, cause);
                  const line = statusLine(row, phase, locale);
                  const actionLabel = action ? ct(ACTION_LABEL[action]) : "";
                  return (
                    <li key={row.id} className={cn("relative px-4 py-3 transition-colors hover:bg-muted/40", grid)} data-testid="manager-booking-row" data-phase={phase}>
                      <p className="text-sm font-medium tabular-nums">
                        {/* The whole row opens the booking; the action and the payment breakdown sit above the link. */}
                        <Link href={`/manager/booking/${row.id}`} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring">
                          {row.listDay ? <>
                            <span data-testid="booking-span">{listDaySpan(row.listDay, locale)} · {mt("blDaysCount", { count: row.listDay.total })}</span>
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">{dayLabel(row)} · {listWhenLine(row, locale, words)}</span>
                          </> : listWhenLine(row, locale, words)}
                        </Link>
                      </p>
                      <div className="mt-0.5 min-w-0 md:mt-0">
                        <p className="truncate text-sm">{row.chefName || mt("chefNumber", { id: row.chefId })}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{row.kitchenName || mt("unknownKitchen")}</p>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:mt-0 md:block">
                        <StatusPill tone={pill.tone}>{ct(pill.key)}</StatusPill>
                        {line && <p className="text-[13px] text-muted-foreground md:mt-1">{line}</p>}
                      </div>
                      <div className="relative z-10 mt-2 w-fit text-left md:mt-0 md:w-auto md:text-right [&_.text-right]:text-left md:[&_.text-right]:text-right">
                        <ManagerPaymentSummary booking={row} />
                      </div>
                      <div className={cn("mt-3 md:mt-0 md:text-right", !action && "hidden md:block")}>
                        {action && (action === "review_request"
                          ? <Button size="sm" variant="outline" className="relative z-10 min-h-11 w-full md:min-h-9 md:w-auto" onClick={() => onReviewRequest(row)}>{actionLabel}</Button>
                          : <Button asChild size="sm" variant="outline" className="relative z-10 min-h-11 w-full md:min-h-9 md:w-auto">
                            {/* Cancellation review and "Record when they left" happen on the booking page; checkouts on the inspection page. */}
                            <Link href={action === "review_cancellation" || action === "record_left" || action === "answer_attendance" ? `/manager/booking/${row.id}` : inspectionHref(row)}>{actionLabel}</Link>
                          </Button>)}
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

function bookingDayLabel(row: Row, bookings: Row[]) {
  if (!row.scheduleRevision) return "";
  const days = bookings.find(booking => booking.id === row.id)?.visitStates || [];
  return mt("mdDayOf", { number: days.findIndex(day => day.id === row.visitStates?.[0]?.id) + 1, total: days.length });
}

export function managerBookingsCSV(items: ListedBooking<Row>[], bookings: Row[]): string {
  const headers = ["r2Date", "r2Day", "r2Chef", "r2Kitchen", "r2Status", "r2Total", "r2RefundedColumn", "r2YouReceiveColumn"].map(key => mt(key));
  const rows = items.map(({ row, phase }) => [row.bookingDate.slice(0, 10), bookingDayLabel(row, bookings),
    row.chefName || mt("chefNumber", { id: row.chefId }), row.kitchenName || mt("unknownKitchen"), ct(bookingListPill(phase, true).key),
    ((row.transactionAmount ?? ((row.totalPrice ?? 0) + (row.taxAmount ?? 0) + (row.serviceFee ?? 0))) / 100).toFixed(2),
    ((row.refundAmount ?? 0) / 100).toFixed(2), (bookingReceiveCents(row) / 100).toFixed(2)]);
  // Quote every cell and neutralize spreadsheet formulas in chef/kitchen names.
  return [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`).join(",")).join("\n");
}
