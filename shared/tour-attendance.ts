export type TourAttendanceEntry = {
  action: 'check_in' | 'check_out';
  actorId: number;
  source: 'visitor' | 'manager_assisted';
  actualAt: string;
  recordedAt: string;
  scheduledAt: string;
  reason?: string;
};

type Instant = Date | string;
type AttendanceTour = {
  id: number; status: string; scheduledAt: Instant; durationMinutes: number; updatedAt: Instant;
  disruptionReason?: string | null; targetedKitchenId?: number | null;
  checkedInAt?: Instant | null; checkedOutAt?: Instant | null; attendanceHistory?: unknown;
  outcomeHistory?: unknown;
};
const serialize = (value: Instant) => new Date(value).toISOString();

/** Attendance is recorded evidence; outcome labels never substitute for it. */
export function tourAttendance(tour: AttendanceTour, earlyMinutes: number, now = new Date()) {
  const start = new Date(tour.scheduledAt).getTime();
  const opens = start - earlyMinutes * 60_000, closes = start + tour.durationMinutes * 60_000;
  const rawHistory = Array.isArray(tour.attendanceHistory) ? tour.attendanceHistory : [];
  const history = attendanceEntries(rawHistory);
  const scheduledAt = serialize(tour.scheduledAt);
  const arrival = tour.checkedInAt ? new Date(tour.checkedInAt).getTime() : null;
  const departure = tour.checkedOutAt ? new Date(tour.checkedOutAt).getTime() : null;
  const evidenceMatches = (action: TourAttendanceEntry['action'], actual: number | null) => {
    const entries = history.filter(entry => entry.action === action);
    return actual === null ? entries.length === 0 : Number.isFinite(actual) && actual <= now.getTime()
      && entries.length === 1 && Date.parse(entries[0].actualAt) === actual;
  };
  const historyReason = history.length !== rawHistory.length || (tour.attendanceHistory != null && !Array.isArray(tour.attendanceHistory))
    || history.some(entry => entry.scheduledAt !== scheduledAt || Date.parse(entry.recordedAt) > now.getTime())
    || !evidenceMatches('check_in', arrival) || !evidenceMatches('check_out', departure)
    || (departure !== null && (arrival === null || departure < arrival))
    ? 'Recorded attendance belongs to a different or unknown schedule, or has invalid evidence; contact the manager for review' : null;
  const safetyReason = historyReason || (tour.status !== 'confirmed' ? 'Only confirmed tours allow arrival'
    : tour.disruptionReason ? 'This tour has been disrupted'
    : !tour.targetedKitchenId ? 'This tour no longer has an available kitchen'
    : null);
  const reason = safetyReason || (tour.checkedInAt ? 'Arrival already recorded'
    : now.getTime() < opens ? 'The arrival window has not opened'
    : now.getTime() > closes ? 'The arrival window has closed' : null);
  const departureSafetyReason = historyReason || (arrival === null ? 'Record arrival before departure' : null);
  const checkOutReason = departureSafetyReason || (departure !== null ? 'Departure already recorded' : null);
  const confirmed = tour.status === 'confirmed' || (Array.isArray(tour.outcomeHistory)
    && tour.outcomeHistory.some(entry => entry?.from === 'confirmed' || entry?.to === 'confirmed'));
  const assistArrivalReason = historyReason || (arrival !== null ? 'Arrival already recorded'
    : !confirmed ? 'Historical confirmation evidence is required'
    : !tour.targetedKitchenId ? 'This tour no longer has an available kitchen' : null);
  return { viewingId: tour.id, scheduledAt, checkedInAt: arrival !== null && Number.isFinite(arrival) ? new Date(arrival).toISOString() : null,
    checkedOutAt: departure !== null && Number.isFinite(departure) ? new Date(departure).toISOString() : null,
    attendanceHistory: history,
    checkInOpensAt: new Date(opens).toISOString(), checkInClosesAt: new Date(closes).toISOString(),
    checkOutOpensAt: arrival !== null && Number.isFinite(arrival) ? new Date(arrival).toISOString() : null,
    checkOutDueAt: new Date(closes).toISOString(),
    updatedAt: serialize(tour.updatedAt), canCheckIn: reason === null, reason, safetyReason,
    canCheckOut: checkOutReason === null, checkOutReason, departureSafetyReason,
    canAssistArrival: assistArrivalReason === null, assistArrivalReason,
    canAssistDeparture: checkOutReason === null };
}

/** Whitelist public audit fields; malformed evidence is never action eligibility. */
export function attendanceEntries(value: unknown): TourAttendanceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => entry && ['check_in', 'check_out'].includes(entry.action)
    && Number.isSafeInteger(entry.actorId) && entry.actorId > 0 && ['visitor', 'manager_assisted'].includes(entry.source)
    && [entry.actualAt, entry.recordedAt, entry.scheduledAt].every(instant => typeof instant === 'string'
      && /(?:Z|[+-]\d{2}:\d{2})$/.test(instant) && Number.isFinite(Date.parse(instant)))
    && Date.parse(entry.actualAt) <= Date.parse(entry.recordedAt)
    && (entry.source !== 'manager_assisted' || (typeof entry.reason === 'string'
      && entry.reason.trim().length >= 10 && entry.reason.length <= 2000)))
    .map(({ action, actorId, source, actualAt, recordedAt, scheduledAt, reason }) =>
      ({ action, actorId, source, actualAt, recordedAt, scheduledAt, ...(source === 'manager_assisted' ? { reason } : {}) }));
}

export type TourAttendance = ReturnType<typeof tourAttendance>;
