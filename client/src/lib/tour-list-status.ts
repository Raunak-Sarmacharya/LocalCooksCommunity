/**
 * The kitchen's tours list, grouped like the bookings list (owner, Oct 24): Upcoming opens on "Needs action" (requests to
 * answer, time changes to review, visits to record), then Today, then Upcoming; Past and Cancelled are their own tabs.
 */
import { timeRange, type BookingPillTone } from './booking-header-state';
import { formatTime } from './formatters';
import { listDayLabel, sameKitchenDay } from './booking-list-status';
import { tourRequestDecision } from '@shared/tour-request-decision';

export type TourListTour = {
  id: number; status: string; scheduledAt: string; durationMinutes: number; createdAt: string; updatedAt: string;
  disruptionReason: string | null; cancelledBy: string | null; adminReviewDecision: string | null; adminReviewedAt?: string | null;
  requestExpiredAt?: string | null; requestedRescheduleAt: string | null; rescheduleRequestedAt?: string | null;
  rescheduleProposedSlots?: string[]; rescheduleProposedAt?: string | null; visitEvidenceState?: string; checkedInAt?: string | null;
};
export type TourListGroup = 'needs_action' | 'today' | 'upcoming' | 'past' | 'cancelled';
/** What the row asks of the kitchen; the row opens the tour where the choice is made (no one-tap actions). */
export type TourRowAction = 'review_request' | 'review_change' | 'record_visit' | null;
export type TourListState = 'request' | 'change_requested' | 'times_offered' | 'confirmed' | 'in_progress' | 'record'
  | 'awaiting_close' | 'completed' | 'no_show' | 'closed_no_result' | 'disrupted' | 'declined' | 'cancelled' | 'expired';
export type ListedTour<T> = { row: T; group: TourListGroup; state: TourListState; action: TourRowAction; dueAt: string | null; startMs: number };

const RECORD_WINDOW_MS = 24 * 3_600_000;

export function tourListState(tour: TourListTour, now = Date.now()): Omit<ListedTour<TourListTour>, 'row' | 'group' | 'startMs'> {
  const start = Date.parse(tour.scheduledAt), end = start + (tour.durationMinutes || 30) * 60_000;
  const decision = tourRequestDecision(tour, now);
  if (tour.status === 'pending') {
    if (tour.requestExpiredAt || start <= now) return { state: 'expired', action: null, dueAt: null };
    if (tour.rescheduleProposedSlots?.length) return { state: 'times_offered', action: null, dueAt: null };
    return { state: 'request', action: 'review_request', dueAt: decision?.dueAt ?? null };
  }
  if (tour.status === 'confirmed' && !tour.disruptionReason) {
    if (tour.requestedRescheduleAt && start > now) return { state: 'change_requested', action: 'review_change', dueAt: decision?.dueAt ?? null };
    if (tour.rescheduleProposedSlots?.length && start > now) return { state: 'times_offered', action: null, dueAt: null };
    if (start > now) return { state: 'confirmed', action: null, dueAt: null };
    if (end > now) return { state: 'in_progress', action: null, dueAt: null };
    if (now < end + RECORD_WINDOW_MS && tour.visitEvidenceState !== 'review')
      return { state: 'record', action: 'record_visit', dueAt: new Date(end + RECORD_WINDOW_MS).toISOString() };
    return { state: 'awaiting_close', action: null, dueAt: null };
  }
  if (tour.status === 'completed') return { state: 'completed', action: null, dueAt: null };
  if (tour.status === 'no_show') return { state: 'no_show', action: null, dueAt: null };
  if (tour.disruptionReason === 'outcome_unknown') return { state: 'closed_no_result', action: null, dueAt: null };
  if (tour.disruptionReason) return { state: 'disrupted', action: null, dueAt: null };
  if (tour.cancelledBy === 'manager_declined' || tour.adminReviewDecision === 'denied')
    return { state: 'declined', action: null, dueAt: null };
  return { state: 'cancelled', action: null, dueAt: null };
}

const GROUP: Record<TourListState, TourListGroup | 'dated'> = {
  request: 'needs_action', change_requested: 'needs_action', record: 'needs_action',
  times_offered: 'dated', confirmed: 'dated', in_progress: 'today',
  awaiting_close: 'past', completed: 'past', no_show: 'past', closed_no_result: 'past',
  disrupted: 'cancelled', declined: 'cancelled', cancelled: 'cancelled', expired: 'cancelled',
};

/** Groups and orders tours: needs action by deadline, today and upcoming by start, past and cancelled newest first. */
export function managerTourGroups<T extends TourListTour>(rows: Array<{ viewing: T } & Record<string, unknown>>, timeZone: string, now = Date.now()) {
  const groups: Record<TourListGroup, Array<ListedTour<typeof rows[number]>>> = { needs_action: [], today: [], upcoming: [], past: [], cancelled: [] };
  for (const row of rows) {
    const listed = tourListState(row.viewing, now), startMs = Date.parse(row.viewing.scheduledAt);
    const target = GROUP[listed.state];
    const group: TourListGroup = target === 'dated' ? sameKitchenDay(startMs, now, timeZone) ? 'today' : 'upcoming' : target;
    groups[group].push({ row, group, startMs, ...listed });
  }
  const due = (item: ListedTour<unknown>) => item.dueAt ? Date.parse(item.dueAt) : item.startMs;
  groups.needs_action.sort((a, b) => due(a) - due(b));
  groups.today.sort((a, b) => a.startMs - b.startMs);
  groups.upcoming.sort((a, b) => a.startMs - b.startMs);
  groups.past.sort((a, b) => b.startMs - a.startMs);
  groups.cancelled.sort((a, b) => b.startMs - a.startMs);
  return groups;
}

/** Pill per state, in the bookings list's tones: amber waits on the kitchen, blue is upcoming, green went well, grey is closed. */
export const TOUR_PILL: Record<TourListState, { key: string; tone: BookingPillTone }> = {
  request: { key: 'tlRequest', tone: 'amber' }, change_requested: { key: 'tlChangeRequested', tone: 'amber' },
  record: { key: 'tlRecord', tone: 'amber' }, times_offered: { key: 'tlTimesOffered', tone: 'purple' },
  confirmed: { key: 'tlConfirmed', tone: 'blue' }, in_progress: { key: 'tlInProgress', tone: 'teal' },
  awaiting_close: { key: 'tlAwaitingClose', tone: 'neutral' }, completed: { key: 'tlCompleted', tone: 'green' },
  no_show: { key: 'tlNoShow', tone: 'red' }, closed_no_result: { key: 'tlClosedNoResult', tone: 'grey' },
  disrupted: { key: 'tlDisrupted', tone: 'grey' }, declined: { key: 'tlDeclined', tone: 'grey' },
  cancelled: { key: 'tlCancelled', tone: 'grey' }, expired: { key: 'tlExpired', tone: 'grey' },
};

const clock = (at: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/** "Today · 9:00–9:30 a.m.", like a booking row. */
export function tourWhenLine(tour: Pick<TourListTour, 'scheduledAt' | 'durationMinutes'>, timeZone: string, locale: string, words: { today: string; tomorrow: string }, now = Date.now()) {
  const start = new Date(tour.scheduledAt), end = new Date(start.getTime() + (tour.durationMinutes || 30) * 60_000);
  try {
    return [listDayLabel(start, timeZone, locale, words, now), timeRange(formatTime(clock(start, timeZone), locale), formatTime(clock(end, timeZone), locale))].filter(Boolean).join(' · ');
  } catch { return ''; }
}
