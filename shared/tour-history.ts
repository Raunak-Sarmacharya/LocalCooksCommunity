import { attendanceEntries } from './tour-attendance';

const kinds = ['requested', 'request_updated', 'reschedule_requested', 'reschedule_accepted', 'reschedule_declined', 'reschedule_proposed', 'reschedule_proposal_accepted', 'reschedule_proposal_declined', 'reschedule_proposal_withdrawn', 'status', 'expired', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted'] as const;
export type TourHistoryEvent = {
  key: string; kind: typeof kinds[number]; recordedAt: string; actor: 'chef' | 'manager' | 'team' | 'system';
  status?: string; previousStatus?: string; scheduledAt?: string; previousScheduledAt?: string;
  proposedSlots?: string[]; actualAt?: string; action?: 'check_in' | 'check_out';
  outcome?: 'disrupted' | 'declined' | 'cancelled'; disruptionReason?: 'manager_absent' | 'access_unavailable' | 'weather' | 'other';
};
export type TourHistory = { events: TourHistoryEvent[]; complete: boolean };
export type TourHistoryResponse = TourHistory;
const instant = (value: unknown): string | undefined => {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};
const publicStatus = (value: unknown) => value === 'pending_local_cooks' ? 'pending'
  : typeof value === 'string' && ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'].includes(value) ? value : undefined;
const actor = (role: unknown): TourHistoryEvent['actor'] => role === 'chef' || role === 'manager' ? role : role === 'admin' ? 'team' : 'system';
function cancellationFacts(value: Record<string, any>, status?: string): Pick<TourHistoryEvent, 'outcome' | 'disruptionReason'> {
  if (status !== 'cancelled') return {};
  const reason = ['manager_absent', 'access_unavailable', 'weather', 'other'].includes(value.disruptionReason) ? value.disruptionReason as TourHistoryEvent['disruptionReason'] : undefined;
  return { outcome: reason ? 'disrupted' : value.cancelledBy === 'manager_declined' ? 'declined' : 'cancelled', ...(reason ? { disruptionReason: reason } : {}) };
}

/** Project recorded facts only. Delivery payloads contain private recipient and note data. */
export function tourHistory(tour: { createdAt?: unknown; outcomeHistory?: unknown; attendanceHistory?: unknown }, ledger: { id: number; createdAt: unknown; payload: unknown }[]): TourHistory {
  const events: TourHistoryEvent[] = [];
  const recordedOutcomes = new Set<string>();
  for (const row of ledger) {
    const payload = row.payload as Record<string, any> | null;
    const recordedAt = instant(row.createdAt);
    if (!payload || !kinds.includes(payload.kind) || !recordedAt) continue;
    const before = payload.before || {}, after = payload.after || {};
    if (payload.kind === 'status' && Array.isArray(after.outcomeHistory)) {
      const prior = Array.isArray(before.outcomeHistory) ? before.outcomeHistory.length : 0;
      for (const entry of after.outcomeHistory.slice(prior)) {
        const time = instant(entry?.recordedAt), status = publicStatus(entry?.to);
        if (time && status) recordedOutcomes.add(`${time}:${status}`);
      }
    }
    const event: TourHistoryEvent = { key: `event-${row.id}`, kind: payload.kind, recordedAt: payload.kind === 'expired' ? instant(after.requestExpiredAt) || recordedAt : recordedAt, actor: actor(payload.actorRole) };
    const status = publicStatus(after.status), previousStatus = publicStatus(before.status);
    if (status && payload.kind !== 'expired') event.status = status;
    if (payload.kind !== 'expired') Object.assign(event, cancellationFacts(after, status));
    if (previousStatus && previousStatus !== status) event.previousStatus = previousStatus;
    const scheduledAt = instant(after.scheduledAt), previousScheduledAt = instant(before.scheduledAt);
    if (scheduledAt) event.scheduledAt = scheduledAt;
    if (previousScheduledAt && previousScheduledAt !== scheduledAt) event.previousScheduledAt = previousScheduledAt;
    if (payload.kind === 'reschedule_requested' && instant(after.requestedRescheduleAt)) {
      event.previousScheduledAt = scheduledAt;
      event.scheduledAt = instant(after.requestedRescheduleAt);
    }
    if (payload.kind === 'reschedule_proposed') event.proposedSlots = Array.isArray(after.rescheduleProposedSlots) ? after.rescheduleProposedSlots.flatMap((value: unknown) => instant(value) ? [instant(value)!] : []) : [];
    const actualAt = instant(payload.kind === 'visitor_checkin' ? after.checkedInAt : payload.kind === 'visitor_checkout' ? after.checkedOutAt
      : payload.kind === 'attendance_assisted' ? (instant(after.checkedOutAt) !== instant(before.checkedOutAt) ? after.checkedOutAt : after.checkedInAt) : undefined);
    if (actualAt) {
      event.actualAt = actualAt;
      event.action = payload.kind === 'visitor_checkin' || payload.kind === 'attendance_assisted' && instant(after.checkedOutAt) === instant(before.checkedOutAt) ? 'check_in' : 'check_out';
    }
    events.push(event);
  }
  const complete = events.some(event => event.kind === 'requested');
  const createdAt = instant(tour.createdAt);
  if (!complete && createdAt) events.push({ key: 'request', kind: 'requested', recordedAt: createdAt, actor: 'chef' });
  if (Array.isArray(tour.outcomeHistory)) for (let index = 0; index < tour.outcomeHistory.length; index++) {
    const entry = tour.outcomeHistory[index];
    const recordedAt = instant(entry?.recordedAt), status = publicStatus(entry?.to);
    if (!recordedAt || !status || !['cancelled', 'completed', 'no_show'].includes(status) || recordedOutcomes.has(`${recordedAt}:${status}`) || events.some(event => event.kind === 'status' && event.status === status && event.recordedAt === recordedAt)) continue;
    events.push({ key: `outcome-${index}`, kind: 'status', recordedAt, actor: actor(entry.actorRole), status, ...cancellationFacts(entry, status), ...(publicStatus(entry.from) ? { previousStatus: publicStatus(entry.from) } : {}) });
  }
  const attendance = attendanceEntries(tour.attendanceHistory);
  for (let index = 0; index < attendance.length; index++) {
    const entry = attendance[index];
    const kind = entry.source === 'manager_assisted' ? 'attendance_assisted' : entry.action === 'check_in' ? 'visitor_checkin' : 'visitor_checkout';
    if (events.some(event => event.kind === kind && event.actualAt === entry.actualAt && event.action === entry.action)) continue;
    events.push({ key: `attendance-${index}`, kind, action: entry.action, recordedAt: entry.recordedAt, actualAt: entry.actualAt, scheduledAt: entry.scheduledAt, actor: entry.source === 'manager_assisted' ? 'manager' : 'chef' });
  }
  return { events: events.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)), complete };
}
