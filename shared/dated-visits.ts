import { calendarDateForBookingTime } from './operating-hours';
import { createBookingDateTime } from './timezone-utils';
/** Revision zero is the deployed legacy contract; never reinterpret its visit rows. */
export type VisitSchedule = { blockIndex?: number | null; visitDate?: Date | string | null;
  scheduleRevision?: number | null; scheduleState?: string | null; operatingWindowStartTime?: string | null };
export function isCurrentVisit(booking: { scheduleRevision?: number | null }, visit: VisitSchedule) {
  return !booking.scheduleRevision || visit.scheduleRevision === booking.scheduleRevision && visit.scheduleState === 'active' && !!visit.visitDate;
}
export function requireCurrentVisit(booking: { scheduleRevision?: number | null }, visit?: VisitSchedule | null) {
  if (booking.scheduleRevision && (!visit || !isCurrentVisit(booking, visit)))
    throw Error('Choose an active visit from the current booking schedule');
}
export const visitDateKey = (date: Date | string) => typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);

type DayVisit = VisitSchedule & { startTime: string; endTime: string };
/** A dated booking's current active days (cancelled/superseded excluded) with their real end instants in the kitchen's zone. */
export function activeDayEnds<V extends DayVisit>(booking: { scheduleRevision?: number | null }, visits: V[], timezone: string) {
  return visits.filter(visit => !!booking.scheduleRevision && isCurrentVisit(booking, visit)).map(visit => {
    const date = visitDateKey(visit.visitDate!);
    const endDate = calendarDateForBookingTime(date, visit.endTime, visit.operatingWindowStartTime, visit.startTime);
    return { visit, date, endAt: createBookingDateTime(endDate, visit.endTime, timezone) };
  });
}
/** Today board: a dated booking stays while any active day is still to come or in progress. */
export const hasUpcomingDay = (booking: { scheduleRevision?: number | null }, visits: DayVisit[], timezone: string, now: Date) =>
  activeDayEnds(booking, visits, timezone).some(day => day.endAt > now);
/** Claims: a dated booking is keyed on its latest active day that has ended. */
export const latestEndedDay = <V extends DayVisit>(booking: { scheduleRevision?: number | null }, visits: V[], timezone: string, now: Date) =>
  activeDayEnds(booking, visits, timezone).filter(day => day.endAt <= now).sort((a, b) => a.endAt.getTime() - b.endAt.getTime()).at(-1);
