import { bookingHeaderPhase, bookingPrimaryAction, timeRange, type BookingHeaderPhase, type BookingPillTone, type BookingPrimaryAction } from './booking-header-state';
import { bookingNowContent } from './booking-now';
import type { BookingCancelCause } from './booking-cancel-cause';
import { kitchenBookingBlocks } from './kitchen-booking-blocks';
import { formatTime } from './formatters';
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@/utils/timezone-utils';

/**
 * Booking lists (chef "My bookings", manager bookings, dashboard tiles) speak the booking page's language: the same
 * phase from `bookingHeaderPhase`, fed the same facts the page feeds it, the same pill words, the same clock format.
 * Display only; no booking, payment or policy decision is made here.
 */
export interface BookingListRow {
  status: string;
  checkinStatus?: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  selectedSlots?: Array<string | { startTime: string; endTime: string }> | null;
  locationTimezone?: string | null;
  /** The kitchen zone from the server's closeout projection (preferred over `locationTimezone`). */
  timezone?: string | null;
  /** The server's closeout projection, as on the booking page. */
  closeout?: { phase?: string | null; visits?: Array<{ inspection?: { canRespond?: boolean } | null }> | null } | null;
  /** Per-visit check-in states (multi-visit bookings). */
  visitStates?: Array<{ id?: number; checkinStatus: string; checkoutRequestedAt?: string | null }> | null;
  /** The kitchen's check-in window (minutes before start); the page's default is 15. */
  checkinWindowMinutesBefore?: number | null;
  checkoutRequestedAt?: string | null;
}

export const listTimezone = (row: Pick<BookingListRow, 'timezone' | 'locationTimezone'>) => row.timezone || row.locationTimezone || DEFAULT_TIMEZONE;

/** Start, end and check-in opening as real instants in the kitchen zone (the booking page's `visitBounds`). */
export function bookingListBounds(row: BookingListRow): { startAt: Date; endAt: Date; opensAt: Date } | null {
  try {
    const timezone = listTimezone(row);
    const day = row.bookingDate.split('T')[0];
    const startAt = createBookingDateTime(calendarDateForBookingTime(day, row.startTime, row.operatingWindowStartTime), row.startTime, timezone);
    const endAt = createBookingDateTime(calendarDateForBookingTime(day, row.endTime, row.operatingWindowStartTime, row.startTime), row.endTime, timezone);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
    return { startAt, endAt, opensAt: new Date(startAt.getTime() - (row.checkinWindowMinutesBefore ?? 15) * 60_000) };
  } catch { return null; }
}

export const listInspectionCanRespond = (row: BookingListRow) => !!row.closeout?.visits?.some(visit => !!visit.inspection?.canRespond);

/** The header phase for a list row, from `bookingHeaderPhase` with the booking page's inputs. */
export function bookingListPhase(row: BookingListRow, now = Date.now()): BookingHeaderPhase {
  const bounds = bookingListBounds(row);
  return bookingHeaderPhase({
    status: row.status, checkinStatus: row.checkinStatus,
    // Closed-out bookings with a stale check-in value are settled inside bookingHeaderPhase (shared with the booking page).
    visits: row.visitStates?.map(visit => ({ ...visit, checkinStatus: visit.checkinStatus || 'not_checked_in' })),
    closeoutPhase: row.closeout?.phase,
    inspectionCanRespond: listInspectionCanRespond(row), startAt: bounds?.startAt, endAt: bounds?.endAt, checkinOpensAt: bounds?.opensAt,
    timezone: listTimezone(row), now,
  });
}

/**
 * The pill for a phase (chef-namespace key + tone), taken from the booking page's own `bookingNowContent` so a list can
 * never drift from the header's words or colour.
 */
export function bookingListPill(phase: BookingHeaderPhase, manager: boolean, cause?: BookingCancelCause | null): { key: string; tone: BookingPillTone } {
  return bookingNowContent({ phase, role: manager ? 'manager' : 'chef', facts: { chef: '', kitchen: '', cancelCause: cause }, t: key => key }).pill;
}

/** Translation key (chef namespace) of the one pill for a phase. */
export const bookingPhasePillKey = (phase: BookingHeaderPhase, manager: boolean, cause?: BookingCancelCause | null) =>
  bookingListPill(phase, manager, cause).key;

/** The chef's arrival is worth a line only once it is on the record and the visit is not cancelled. */
export function showArrivalLine(phase: BookingHeaderPhase): boolean {
  return ['in_session', 'time_ended_in_session', 'checkout_review', 'completed', 'visit_ended', 'issue'].includes(phase);
}

// ── Dates and times ──────────────────────────────────────────────────────────────────────────────────────────────

const dayKey = (at: number | Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

export function sameKitchenDay(a: number | Date, b: number | Date, timeZone: string) {
  try { return dayKey(a, timeZone) === dayKey(b, timeZone); } catch { return false; }
}

/** "Today" / "Tomorrow" / "Thu, Oct 16" (the year only when it isn't this year), in the kitchen's zone. */
export function listDayLabel(at: Date, timeZone: string, locale: string, words: { today: string; tomorrow: string }, now = Date.now()) {
  try {
    if (sameKitchenDay(at, now, timeZone)) return words.today;
    if (sameKitchenDay(at, now + 86_400_000, timeZone)) return words.tomorrow;
    const year = (value: number | Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(value);
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric',
      ...(year(at) !== year(now) ? { year: 'numeric' as const } : {}) }).format(at);
  } catch { return ''; }
}

/** "2:00–4:00 p.m." per visit block, 12-hour, joined when a booking has separate blocks. */
export function listTimeRange(row: BookingListRow, locale: string) {
  return kitchenBookingBlocks(row).map(block => timeRange(formatTime(block.startTime, locale), formatTime(block.endTime, locale))).join(', ');
}

/** "Today · 2:00–4:00 p.m." */
export function listWhenLine(row: BookingListRow, locale: string, words: { today: string; tomorrow: string }, now = Date.now()) {
  const bounds = bookingListBounds(row);
  const day = bounds ? listDayLabel(bounds.startAt, listTimezone(row), locale, words, now) : '';
  return [day, listTimeRange(row, locale)].filter(Boolean).join(' · ');
}

// ── Ordering ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ListedBooking<T> = { row: T; phase: BookingHeaderPhase; startMs: number };

const startMs = (row: BookingListRow) => bookingListBounds(row)?.startAt.getTime() ?? Number.POSITIVE_INFINITY;
const byStart = <T,>(a: ListedBooking<T>, b: ListedBooking<T>) => a.startMs - b.startMs;
const byStartDesc = <T,>(a: ListedBooking<T>, b: ListedBooking<T>) => (Number.isFinite(b.startMs) ? b.startMs : 0) - (Number.isFinite(a.startMs) ? a.startMs : 0);

/** The visit is happening now: check-in open, in session, booked time over while still checked in. */
export const HAPPENING_NOW: BookingHeaderPhase[] = ['checkin_open', 'in_session', 'time_ended_in_session'];

export type ChefListTab = 'upcoming' | 'past' | 'cancelled';

/** A chef's checkout submitted today still belongs with "now"; an older one is past. */
function checkoutToday(row: BookingListRow, now: number) {
  const at = row.checkoutRequestedAt || row.visitStates?.find(visit => visit.checkoutRequestedAt)?.checkoutRequestedAt
    || bookingListBounds(row)?.endAt.toISOString();
  return !!at && sameKitchenDay(new Date(at), now, listTimezone(row));
}

/** Rank inside Upcoming: 0 happening now, 1 request pending, 2 confirmed. Null when the booking is not upcoming. */
export function chefUpcomingRank(row: BookingListRow, phase: BookingHeaderPhase, now = Date.now()): 0 | 1 | 2 | null {
  if (HAPPENING_NOW.includes(phase) || (phase === 'checkout_review' && checkoutToday(row, now))) return 0;
  if (phase === 'pending') return 1;
  if (['confirmed', 'today', 'cancellation_requested'].includes(phase)) return 2;
  return null;
}

/**
 * Chef tabs. Upcoming: anything happening now, then requests waiting for the kitchen, then confirmed visits soonest
 * first. Past and Cancelled: most recent first.
 */
export function chefBookingTabs<T extends BookingListRow>(rows: T[], now = Date.now()): Record<ChefListTab, ListedBooking<T>[]> {
  const tabs: Record<ChefListTab, ListedBooking<T>[]> = { upcoming: [], past: [], cancelled: [] };
  const rank = new Map<ListedBooking<T>, number>();
  for (const row of rows) {
    if (!row?.bookingDate || !row.startTime || !row.endTime) continue;
    const listed = { row, phase: bookingListPhase(row, now), startMs: startMs(row) };
    if (listed.phase === 'cancelled') { tabs.cancelled.push(listed); continue; }
    const upcoming = chefUpcomingRank(row, listed.phase, now);
    if (upcoming === null) tabs.past.push(listed);
    else { rank.set(listed, upcoming); tabs.upcoming.push(listed); }
  }
  tabs.upcoming.sort((a, b) => (rank.get(a)! - rank.get(b)!) || byStart(a, b));
  tabs.past.sort(byStartDesc);
  tabs.cancelled.sort(byStartDesc);
  return tabs;
}

/** The chef's next visit: happening now or confirmed, soonest first (requests are counted separately). */
export function chefNextVisit<T extends BookingListRow>(rows: T[], now = Date.now()) {
  const { upcoming } = chefBookingTabs(rows, now);
  // A visit whose time already ended (still to check out, or checkout submitted) is not "next"; My bookings pins it instead.
  const visit = (phase: BookingHeaderPhase) => ['checkin_open', 'in_session', 'confirmed', 'today', 'cancellation_requested'].includes(phase);
  return { next: upcoming.find(item => visit(item.phase)) ?? null, pending: upcoming.filter(item => item.phase === 'pending').length,
    upcoming: upcoming.length };
}

export type ManagerListGroup = 'needs_action' | 'today' | 'upcoming' | 'past' | 'cancelled';

/** The single row action a manager needs, worded like the booking page's primary (null when nothing is waiting). */
export type ManagerRowAction = BookingPrimaryAction | 'record_left';

/**
 * Every "Needs action" row carries one action: the booking page's primary, or — for a visit whose booked time ended
 * with the chef still checked in — its "Record when they left" (the page has no primary there, only that link).
 */
export function managerRowAction(row: BookingListRow, phase: BookingHeaderPhase): ManagerRowAction {
  if (phase === 'time_ended_in_session') return 'record_left';
  return bookingPrimaryAction(phase, true, listInspectionCanRespond(row));
}

/**
 * Manager agenda. Needs action first (requests, checkouts to review, visits whose time ended with the chef still in,
 * cancellation requests, visits to inspect), then today, then upcoming by start. Past and cancelled: most recent first.
 */
export function managerBookingGroups<T extends BookingListRow>(rows: T[], now = Date.now()): Record<ManagerListGroup, ListedBooking<T>[]> {
  const groups: Record<ManagerListGroup, ListedBooking<T>[]> = { needs_action: [], today: [], upcoming: [], past: [], cancelled: [] };
  for (const row of rows) {
    if (!row?.bookingDate || !row.startTime || !row.endTime) continue;
    const listed = { row, phase: bookingListPhase(row, now), startMs: startMs(row) };
    const { phase } = listed;
    if (phase === 'cancelled') groups.cancelled.push(listed);
    else if (managerRowAction(row, phase)) groups.needs_action.push(listed);
    else if (['today', 'checkin_open', 'in_session'].includes(phase)) groups.today.push(listed);
    else if (phase === 'confirmed') groups.upcoming.push(listed);
    else groups.past.push(listed);
  }
  groups.needs_action.sort(byStart);
  groups.today.sort(byStart);
  groups.upcoming.sort(byStart);
  groups.past.sort(byStartDesc);
  groups.cancelled.sort(byStartDesc);
  return groups;
}
