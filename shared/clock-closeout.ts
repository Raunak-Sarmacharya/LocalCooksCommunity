import { isCurrentVisit, visitDateKey, type VisitSchedule } from './dated-visits';
import { matchingLocalInstants } from './booking-dst';
import { bookingVisitBlocks } from './booking-visit-blocks';
import { addHour, occupiedIntervals, sortTimesInOperatingWindow, calendarDateForBookingTime } from './operating-hours';

export type ServicePhase = 'upcoming' | 'arrival_window' | 'in_booked_time' | 'booked_time_ended' | 'ended';
export type InspectionOutcome = 'not_due' | 'due' | 'manager_cleared' | 'auto_closed_uninspected' | 'issue_filed' | 'legacy_closed';
export type CloseoutTiming = { serviceEndGraceMinutes: number; inspectionAutoCloseHours: number; checkinWindowMinutesBefore: number };
/** `key` is deterministic (local date + hours + block index) so identical hours on different dates never collide. */
export type SavedVisitClock = { key: string; blockIndex?: number; localDate?: string; operatingDate?: string; startTime: string; endTime: string;
  scheduledStartAt: string; scheduledEndAt: string };
export type CloseoutSnapshot = CloseoutTiming & { version: 1; timezone: string; visits: SavedVisitClock[];
  phase?: ServicePhase; visitPhases?: Record<string, ServicePhase>;
  serviceEndedAt?: string; inspections?: Record<string, { outcome: 'auto_closed_uninspected'; closedAt: string }>;
  nextDueAt?: string | null };
export type ClockEvidence = VisitSchedule & { id?: number; blockIndex?: number | null; visitDate?: Date | string | null;
  startTime: string; endTime: string; checkinStatus?: string | null;
  checkedInAt?: Date | string | null; checkoutRequestedAt?: Date | string | null; checkedOutAt?: Date | string | null;
  checkoutApprovedAt?: Date | string | null; checkoutApprovedBy?: number | null };
export type ClockBooking = ClockEvidence & { bookingDate: Date | string; status: string; visitDuties?: unknown;
  operatingWindowStartTime?: string | null; selectedSlots?: unknown; scheduleRevision?: number | null };
/** A selected slot may carry its own operating date (multi-day); legacy slots inherit the booking's. */
type DatedSlot = { startTime: string; endTime: string; date?: string; windowStartTime?: string };
/** `key` is the visit row id when a row exists, else the deterministic `clockKey`. */
export type VisitCloseout = SavedVisitClock & { visitId?: number; clockKey: string; blockIndex: number; localDate: string; phase: ServicePhase; arrivalRecorded: boolean; attendance: 'unknown' | 'recorded' | 'no_show';
  inspection: { outcome: InspectionOutcome; dueAt: string; deadline: string; closedAt: string | null; canRespond: boolean } };
export type BookingCloseout = { phase: ServicePhase; serviceEndedAt: string; timezone: string; visits: VisitCloseout[];
  status: string; serverNow: string; nextDueAt: string | null;
  /** No closeout was ever saved (the booking predates the clock): history only, never re-labelled as "No check-in recorded". */
  legacy?: boolean };

const instant = (value: Date | string) => {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw Error('Invalid saved closeout instant');
  return time;
};
const iso = (value: number) => new Date(value).toISOString();
const dateOnly = (value: Date | string) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
export const visitClockKey = (localDate: string, startTime: string, endTime: string, blockIndex: number) =>
  `${localDate}|${startTime}-${endTime}|${blockIndex}`;

/** Local calendar date of a saved instant; used only when a legacy snapshot lacks `localDate`. */
export function localDateOfInstant(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

/** Position-independent identity for one saved visit. Hours alone never identify a visit. */
export function savedVisitIdentity(clock: SavedVisitClock, position: number, timezone: string) {
  const blockIndex = clock.blockIndex ?? position;
  const localDate = clock.localDate ?? localDateOfInstant(clock.scheduledStartAt, timezone);
  return { blockIndex, localDate, clockKey: clock.localDate ? clock.key : visitClockKey(localDate, clock.startTime, clock.endTime, blockIndex) };
}

/** Evidence rows belong to a saved visit by block index (and visit date once rows carry one), never by hours. */
export function matchVisitEvidence<T extends { blockIndex?: number | null; visitDate?: Date | string | null }>(
  evidence: T[], blockIndex: number, localDate: string, operatingDate?: string): T | undefined {
  return evidence.find((row, position) => (row.blockIndex ?? position) === blockIndex
    && (!row.visitDate || dateOnly(row.visitDate) === (operatingDate || localDate)));
}

/** The saved clock for a stored visit row; a single-visit snapshot needs no index. */
export function savedClockForVisit(saved: CloseoutSnapshot, visit: { blockIndex?: number | null }) {
  if (visit.blockIndex != null) return saved.visits.find((clock, position) => (clock.blockIndex ?? position) === visit.blockIndex);
  if (saved.visits.length === 1) return saved.visits[0];
  throw Error('A visit index is required to read a multi-visit closeout');
}
export function savedCloseout(value: unknown): CloseoutSnapshot | undefined {
  const saved = (value as { clockCloseout?: CloseoutSnapshot } | null)?.clockCloseout;
  if (!saved) return undefined;
  if (saved.version !== 1 || !saved.visits?.length || !saved.timezone) throw Error('Closeout snapshot needs Local Cooks review');
  return saved;
}

/** Legacy wall times use the booking engine's first-fold convention; gaps require review, never normalization. */
export function makeCloseoutSnapshot(booking: ClockBooking, timezone: string, timing: CloseoutTiming, evidence: ClockEvidence[] = []): CloseoutSnapshot {
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  for (const value of Object.values(timing)) if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid closeout timing');
  if (booking.scheduleRevision) {
    if (!evidence.some(visit => visit.scheduleRevision === booking.scheduleRevision)) throw Error('Dated booking visit schedule is missing');
    const visits = evidence.filter(visit => visit.scheduleRevision === booking.scheduleRevision).sort((a, b) => visitDateKey(a.visitDate!).localeCompare(visitDateKey(b.visitDate!))).map(visit => {
      const day = visitDateKey(visit.visitDate!);
      const anchor = visit.operatingWindowStartTime;
      const boundary = (time: string, start = false) => {
        const calendar = calendarDateForBookingTime(day, time, anchor, start ? undefined : visit.startTime);
        const matches = matchingLocalInstants(calendar, time, timezone);
        if (!matches.length) throw Error(`Scheduled time ${calendar} ${time} does not exist in ${timezone}`);
        return { calendar, at: iso(matches[0]) };
      };
      if (visit.blockIndex == null) throw Error('Dated visits require a stable block index');
      const first = boundary(visit.startTime, true), end = boundary(visit.endTime);
      return { blockIndex: visit.blockIndex, operatingDate: day, localDate: first.calendar, startTime: visit.startTime, endTime: visit.endTime,
        key: visitClockKey(first.calendar, visit.startTime, visit.endTime, visit.blockIndex), scheduledStartAt: first.at, scheduledEndAt: end.at };
    });
    return { version: 1, timezone, ...timing, visits };
  }
  // Slots without their own date (every legacy booking) share the reservation's operating date.
  const defaultDate = dateOnly(booking.bookingDate);
  const slots: DatedSlot[] = Array.isArray(booking.selectedSlots) ? booking.selectedSlots.map(slot => typeof slot === 'string'
    ? { startTime: slot, endTime: addHour(slot) } : slot) : [];
  const intervals = occupiedIntervals({ ...booking, selectedSlots: slots }) as DatedSlot[];
  const window = booking.operatingWindowStartTime || booking.startTime;
  const byDate = new Map<string, DatedSlot[]>();
  for (const slot of intervals) {
    const day = typeof slot.date === 'string' ? slot.date.slice(0, 10) : defaultDate;
    byDate.set(day, [...(byDate.get(day) || []), slot]);
  }
  const visits: SavedVisitClock[] = [];
  for (const day of Array.from(byDate.keys()).sort()) {
    const group = byDate.get(day)!;
    const dayWindow = group[0].windowStartTime || booking.operatingWindowStartTime;
    const ordered = sortTimesInOperatingWindow(group.map(slot => slot.startTime), dayWindow || window)
      .map(start => group.find(slot => slot.startTime === start)!);
    const dayStart = day === defaultDate ? booking.startTime : ordered[0].startTime;
    const boundary = (time: string, start = false) => {
      const calendar = calendarDateForBookingTime(day, time, dayWindow, start && time === dayStart ? undefined : dayStart);
      const matches = matchingLocalInstants(calendar, time, timezone);
      if (!matches.length) throw Error(`Scheduled time ${calendar} ${time} does not exist in ${timezone}; contact Local Cooks`);
      return { calendar, at: iso(matches[0]) };
    };
    for (const block of bookingVisitBlocks(ordered)) {
      const blockIndex = visits.length, first = boundary(block.startTime, true);
      visits.push({ ...block, blockIndex, localDate: first.calendar,
        key: visitClockKey(first.calendar, block.startTime, block.endTime, blockIndex),
        scheduledStartAt: first.at, scheduledEndAt: boundary(block.endTime).at });
    }
  }
  return { version: 1, timezone, ...timing, visits };
}

/** Saved instants remain immutable; cancelled and superseded rows no longer drive lifecycle readers. */
export function currentVisitSnapshot(booking: Pick<ClockBooking, 'scheduleRevision'>, evidence: ClockEvidence[], saved: CloseoutSnapshot): CloseoutSnapshot {
  if (!booking.scheduleRevision) return saved;
  return { ...saved, visits: saved.visits.filter((clock, index) => evidence.some(row => isCurrentVisit(booking, row) && row.blockIndex === (clock.blockIndex ?? index))) };
}

/** Pure projection: silence changes service time, never attendance or manager approval. */
export function reduceClockCloseout(booking: ClockBooking, evidence: ClockEvidence[], saved: CloseoutSnapshot, now: Date): BookingCloseout {
  const historicalEnd = saved.serviceEndedAt || saved.visits[saved.visits.length - 1]?.scheduledEndAt || new Date(booking.bookingDate).toISOString();
  saved = currentVisitSnapshot(booking, evidence, saved);
  if (!saved.visits.length) return { phase: 'ended', serviceEndedAt: historicalEnd, timezone: saved.timezone, visits: [],
    status: booking.status, serverNow: now.toISOString(), nextDueAt: null };
  const time = instant(now), grace = saved.serviceEndGraceMinutes * 60_000;
  const serviceEnd = Math.max(...saved.visits.map(visit => instant(visit.scheduledEndAt))) + grace;
  const active = ['confirmed', 'completed', 'cancellation_requested'].includes(booking.status);
  const pending: number[] = [];
  if (active && !saved.serviceEndedAt && time < serviceEnd) pending.push(serviceEnd);
  const visits = saved.visits.map((clock, position): VisitCloseout => {
    const identity = savedVisitIdentity(clock, position, saved.timezone);
    const visit = { ...clock, ...identity };
    const start = instant(visit.scheduledStartAt), end = instant(visit.scheduledEndAt);
    if (end <= start) throw Error('Saved visit end must follow its start');
    if (active) pending.push(...[start - saved.checkinWindowMinutesBefore * 60_000, start, end, end + grace].filter(boundary => boundary > time));
    const stored = matchVisitEvidence(evidence, identity.blockIndex, identity.localDate, clock.operatingDate);
    // Only a stored visit row has a visit id; a legacy booking-level row is read as the single visit.
    const row: ClockEvidence = stored || (saved.visits.length === 1 && !evidence.length ? booking : { startTime: visit.startTime, endTime: visit.endTime });
    const key = stored?.id != null ? String(stored.id) : identity.clockKey;
    const departure = row.checkoutRequestedAt ? instant(row.checkoutRequestedAt) : null;
    const due = Math.min(end, departure ?? end);
    const deadline = Math.max(end, departure ?? end) + saved.inspectionAutoCloseHours * 3_600_000;
    const closed = saved.inspections?.[key] ?? saved.inspections?.[identity.clockKey];
    const outcome: InspectionOutcome = row.checkinStatus === 'checkout_claim_filed' ? 'issue_filed'
      : closed ? closed.outcome
      : row.checkinStatus === 'checked_out' ? row.checkoutApprovedBy ? 'manager_cleared' : 'legacy_closed'
      : time >= deadline ? 'auto_closed_uninspected' : time >= due ? 'due' : 'not_due';
    if (active && ['not_due', 'due'].includes(outcome)) pending.push(time < due ? due : deadline);
    return { ...visit, key, ...(stored?.id != null ? { visitId: stored.id } : {}), phase: time >= end + grace ? 'ended' : time >= end ? 'booked_time_ended'
      : time >= start ? 'in_booked_time' : time >= start - saved.checkinWindowMinutesBefore * 60_000 ? 'arrival_window' : 'upcoming',
      arrivalRecorded: !!row.checkedInAt, attendance: row.checkinStatus === 'no_show' ? 'no_show'
        : row.checkedInAt || departure ? 'recorded' : 'unknown',
      inspection: { outcome, dueAt: iso(due), deadline: iso(deadline), closedAt: closed?.closedAt
        || (outcome === 'auto_closed_uninspected' ? iso(deadline) : row.checkoutApprovedAt ? iso(instant(row.checkoutApprovedAt)) : null),
        canRespond: active && outcome === 'due' } };
  });
  const current = visits.find(visit => ['arrival_window', 'in_booked_time', 'booked_time_ended'].includes(visit.phase))
    || visits.find(visit => visit.phase === 'upcoming') || visits[visits.length - 1];
  return { phase: time >= serviceEnd ? 'ended' : current.phase, serviceEndedAt: saved.serviceEndedAt || iso(serviceEnd),
    timezone: saved.timezone, visits, status: active && time >= serviceEnd && booking.status === 'confirmed' ? 'completed' : booking.status,
    serverNow: now.toISOString(), nextDueAt: pending.length ? iso(Math.min(...pending)) : null };
}

/** Persist deterministic deadlines, rather than the worker's receipt time. */
export function closeoutTransition(saved: CloseoutSnapshot, projection: BookingCloseout): CloseoutSnapshot {
  const inspections = { ...saved.inspections };
  // A close already saved under the deterministic key stays there once a visit row appears.
  for (const visit of projection.visits) if (visit.inspection.outcome === 'auto_closed_uninspected' && !inspections[visit.clockKey])
    inspections[visit.key] = { outcome: 'auto_closed_uninspected', closedAt: visit.inspection.deadline };
  return { ...saved, ...(projection.phase === 'ended' ? { serviceEndedAt: projection.serviceEndedAt } : {}),
    phase: projection.phase, visitPhases: Object.fromEntries(projection.visits.map(visit => [visit.key, visit.phase])),
    inspections, nextDueAt: projection.nextDueAt };
}

/**
 * A chef still checked in after the booked end can always check out late (and the kitchen can record when they left)
 * until the visit's inspection window closes. Callers check that the visit is still `checked_in`.
 */
export function lateCheckoutOpen(visit: Pick<VisitCloseout, 'phase' | 'inspection'> | null | undefined) {
  return !!visit && ['booked_time_ended', 'ended'].includes(visit.phase) && ['not_due', 'due'].includes(visit.inspection.outcome);
}

/**
 * When the chef actually left: the kitchen's recorded departure time ("left without checking out") when one exists,
 * else the chef's own checkout time. The recorded-at time of a manager entry is never the departure.
 */
export function recordedDepartureAt(row: { checkoutRequestedAt?: Date | string | null; checkedOutAt?: Date | string | null; assistanceHistory?: unknown } | null | undefined): Date | null {
  if (!row) return null;
  const history = Array.isArray(row.assistanceHistory) ? row.assistanceHistory as Array<{ action?: string; actualAt?: string }> : [];
  const assisted = [...history].reverse().find(entry => entry?.action === 'departure' && typeof entry.actualAt === 'string');
  const value = assisted?.actualAt ?? row.checkoutRequestedAt ?? row.checkedOutAt;
  if (!value) return null;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** Booked hours from the saved visit clocks (start–end of every visit), so extensions and early starts always count. */
export function snapshotBookedHours(snapshot: Pick<CloseoutSnapshot, 'visits'>) {
  const minutes = snapshot.visits.reduce((sum, visit) => sum + (instant(visit.scheduledEndAt) - instant(visit.scheduledStartAt)) / 60_000, 0);
  return Math.round(minutes / 60 * 100) / 100;
}
