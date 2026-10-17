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
