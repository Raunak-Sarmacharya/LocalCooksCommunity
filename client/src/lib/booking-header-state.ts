import { collapseDoublePeriods } from '@shared/i18n/sentence';
/**
 * Booking details header: one status, one next step and at most one primary action per role.
 * Pure so the page and its tests share the same rules. Display only: no booking, payment or
 * policy decision is made here.
 */
export type BookingHeaderPhase =
  | 'pending' | 'confirmed' | 'today' | 'checkin_open' | 'in_session' | 'time_ended_in_session'
  | 'checkout_review' | 'visit_ended' | 'completed' | 'no_show' | 'no_checkin' | 'issue'
  | 'cancellation_requested' | 'cancelled';

export type BookingPillTone = 'amber' | 'blue' | 'green' | 'purple' | 'neutral' | 'grey' | 'red' | 'teal';

export type BookingPrimaryAction = 'review_request' | 'review_cancellation' | 'review_checkout' | 'inspect_visit' | 'open_visit' | 'answer_attendance' | null;

export interface BookingHeaderInput {
  status: string;
  checkinStatus?: string | null;
  visits?: Array<{ checkinStatus: string }> | null;
  /** Closeout phase of the (first) visit: upcoming | in_progress | booked_time_ended | ended. */
  closeoutPhase?: string | null;
  /** True while the manager can still inspect/respond for the visit. */
  inspectionCanRespond?: boolean;
  /** Per-visit attendance from the server's closeout projection (`unknown` | `recorded` | `no_show`). */
  visitAttendance?: Array<string | null | undefined> | null;
  startAt?: Date | null;
  endAt?: Date | null;
  checkinOpensAt?: Date | null;
  timezone?: string | null;
  now?: number;
}

export function bookingHeaderPhase(input: BookingHeaderInput): BookingHeaderPhase {
  const { status } = input;
  if (status === 'cancelled' || status === 'rejected' || status === 'expired' || status === 'declined') return 'cancelled';
  if (status === 'pending') return 'pending';
  if (status === 'cancellation_requested') return 'cancellation_requested';
  // Clock closeout marks the booking completed at the end of the booked time but keeps the raw check-in value. While the
  // kitchen can still inspect, that value is real (an overstay to record, a checkout to review). Once the inspection
  // window has closed, a leftover "still checked in" / "checkout waiting" is settled history: it reads as checked out.
  const settled = (value?: string | null) => status === 'completed' && !input.inspectionCanRespond
    && (value === 'checked_in' || value === 'checkout_requested') ? 'checked_out' : value;
  const visitStates = input.visits && input.visits.length > 1
    ? input.visits.map(visit => settled(visit.checkinStatus) || 'not_checked_in')
    : [settled(input.checkinStatus) || 'not_checked_in'];
  const ended = ['booked_time_ended', 'ended'].includes(input.closeoutPhase || '');
  if (visitStates.includes('checkout_requested')) return 'checkout_review';
  if (visitStates.includes('checked_in')) return ended ? 'time_ended_in_session' : 'in_session';
  if (visitStates.includes('checkout_claim_filed')) return 'issue';
  if (visitStates.includes('no_show')) return 'no_show';
  // WP-N: the booked time is over and nobody recorded an arrival for any visit (the kitchen hasn't said "They came"
  // either). Not "Completed": the kitchen is asked whether the chef came; the chef is told plainly.
  const attendance = input.visitAttendance || [];
  if (attendance.length > 0 && attendance.every(value => value === 'unknown') && visitStates.every(value => value === 'not_checked_in')
    && (status === 'completed' || input.closeoutPhase === 'ended')) return 'no_checkin';
  const checkedOut = visitStates.length > 0 && visitStates.every(value => value === 'checked_out');
  // Checked out but the kitchen can still inspect: the review is the open step.
  if (checkedOut && status !== 'completed' && input.inspectionCanRespond) return 'checkout_review';
  if (status === 'completed' || checkedOut) return 'completed';
  if (ended) return 'visit_ended';
  const now = input.now ?? Date.now();
  if (input.endAt && now >= input.endAt.getTime()) return 'visit_ended';
  if (input.checkinOpensAt && now >= input.checkinOpensAt.getTime()) return 'checkin_open';
  if (input.startAt && input.timezone && sameKitchenDay(now, input.startAt.getTime(), input.timezone)) return 'today';
  return 'confirmed';
}

function sameKitchenDay(a: number, b: number, timezone: string) {
  try {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return day.format(a) === day.format(b);
  } catch { return false; }
}

export function bookingPillTone(phase: BookingHeaderPhase): BookingPillTone {
  switch (phase) {
    case 'pending': case 'cancellation_requested': case 'issue': case 'no_checkin': return 'amber';
    case 'confirmed': case 'today': case 'checkin_open': return 'blue';
    case 'in_session': return 'green';
    case 'time_ended_in_session': return 'amber';
    case 'checkout_review': return 'purple';
    case 'no_show': return 'red';
    case 'cancelled': return 'grey';
    default: return 'neutral';
  }
}

/** Chef or manager; the single red action. Everything else is secondary or in the overflow menu. */
export function bookingPrimaryAction(phase: BookingHeaderPhase, manager: boolean, inspectionCanRespond = false): BookingPrimaryAction {
  if (manager) {
    if (phase === 'pending') return 'review_request';
    if (phase === 'cancellation_requested') return 'review_cancellation';
    if (phase === 'checkout_review') return 'review_checkout';
    if (phase === 'visit_ended' && inspectionCanRespond) return 'inspect_visit';
    // "Did they come?" stays open for the inspection window; afterwards the visit simply reads "No check-in recorded".
    if (phase === 'no_checkin' && inspectionCanRespond) return 'answer_attendance';
    return null;
  }
  // From the morning of the day (Turo/Airbnb): one obvious way in; the visit page says when check-in opens.
  return ['today', 'checkin_open', 'in_session', 'time_ended_in_session'].includes(phase) ? 'open_visit' : null;
}

const BEFORE_ARRIVAL_PHASES: BookingHeaderPhase[] = ['pending', 'confirmed', 'today', 'checkin_open'];

/** An arrival (check-in, check-out, no-show, claim) is already on the record for any visit. */
export function arrivalRecorded(input: { checkinStatus?: string | null; visits?: Array<{ checkinStatus: string }> | null }): boolean {
  const recorded = (value?: string | null) => !!value && value !== 'not_checked_in';
  return recorded(input.checkinStatus) || !!input.visits?.some(visit => recorded(visit.checkinStatus));
}

/**
 * Whether "Cancel or change" is offered. Never once an arrival is recorded or the visit is past
 * the pre-arrival phases (in session, checkout to review, completed, visit ended...). A manager's
 * pending cancellation request stays reviewable. Display gate only; the server still decides.
 */
export function canCancelOrChange(input: { status: string; phase: BookingHeaderPhase; arrivalRecorded: boolean; manager?: boolean }): boolean {
  if (input.manager && input.status === 'cancellation_requested') return true;
  if (!['pending', 'confirmed'].includes(input.status)) return false;
  if (input.arrivalRecorded) return false;
  return BEFORE_ARRIVAL_PHASES.includes(input.phase);
}

/** The booking conversation endpoint only opens for these statuses (server rule; see checkpoint gaps). */
export const MESSAGING_STATUSES = ['pending', 'confirmed', 'cancellation_requested', 'completed'] as const;
export const canMessage = (status: string) => (MESSAGING_STATUSES as readonly string[]).includes(status);

/** Contact details (phone) are shown only once the booking is confirmed. */
export const contactVisible = (status: string) => ['confirmed', 'cancellation_requested', 'completed'].includes(status);

/** Avoids "a.m.." when a localized time that already ends in a period closes a sentence. */
export const sentence = (text: string) => collapseDoublePeriods(text);

/** "2:00 p.m." + "3:00 p.m." → "2:00–3:00 p.m."; other formats are joined unchanged. */
export function timeRange(start: string, end: string) {
  const suffix = /\s([ap]\.?\s?m\.?)$/i;
  const a = start.match(suffix), b = end.match(suffix);
  if (a && b && a[1].toLowerCase() === b[1].toLowerCase()) return `${start.replace(suffix, '')}–${end}`;
  return `${start}–${end}`;
}

export const initials = (name?: string | null) => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map(part => part[0]!.toUpperCase()).join('') || '?';

const clockMinutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + (m || 0); };
/**
 * Hours shown in the header: the real start–end span of every visit (saved clocks first, then the visit rows, then the
 * booking's own start/end), so extensions and early starts always show. `durationHours` is only a last resort.
 */
type BookedSpanInput = { closeoutVisits?: Array<{ scheduledStartAt: string; scheduledEndAt: string }> | null;
  visits?: Array<{ startTime: string; endTime: string }> | null; startTime?: string | null; endTime?: string | null; durationHours?: number | string | null };
/** Exact booked minutes (same sources and order as `bookedHours`); feeds `formatBookedDuration`. */
export function bookedMinutes(input: BookedSpanInput): number {
  const saved = (input.closeoutVisits || []).map(visit => Date.parse(visit.scheduledEndAt) - Date.parse(visit.scheduledStartAt));
  if (saved.length && saved.every(span => Number.isFinite(span) && span > 0)) return Math.round(saved.reduce((a, b) => a + b, 0) / 60_000);
  const span = (start: string, end: string) => { const diff = clockMinutes(end) - clockMinutes(start); return diff > 0 ? diff : diff + 1440; };
  const rows = (input.visits || []).filter(visit => visit.startTime && visit.endTime);
  if (rows.length) return rows.reduce((sum, visit) => sum + span(visit.startTime, visit.endTime), 0);
  if (input.startTime && input.endTime) return span(input.startTime, input.endTime);
  return Math.round((Number(input.durationHours) || 0) * 60);
}
export function bookedHours(input: BookedSpanInput) {
  return Math.round(bookedMinutes(input) / 60 * 100) / 100;
}
