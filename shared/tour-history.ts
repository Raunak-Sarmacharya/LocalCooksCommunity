import { attendanceEntries } from './tour-attendance';
import type { VisitEvent } from './tour-visit-evidence';

const kinds = ['requested', 'review_approved', 'review_denied', 'request_updated', 'reschedule_requested', 'reschedule_accepted', 'reschedule_declined', 'reschedule_proposed', 'reschedule_proposal_accepted', 'reschedule_proposal_declined', 'reschedule_proposal_withdrawn', 'reconfirmation_requested', 'reconfirmation_replied', 'reconfirmation_escalated', 'reconfirmation_reminder', 'status', 'expired', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted', 'attendance_corrected', 'evidence_repaired'] as const;
export type TourHistoryEvent = {
  key: string; kind: typeof kinds[number]; recordedAt: string; actor: 'chef' | 'manager' | 'team' | 'system';
  status?: string; previousStatus?: string; scheduledAt?: string; previousScheduledAt?: string;
  proposedSlots?: string[]; actualAt?: string; action?: 'check_in' | 'check_out';
  reply?: 'still_coming' | 'reschedule' | 'cant_make_it';
  outcome?: 'disrupted' | 'declined' | 'cancelled' | 'unverified'; disruptionReason?: 'manager_absent' | 'access_unavailable' | 'weather' | 'other' | 'outcome_unknown';
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
  if (value.disruptionReason === 'outcome_unknown') return { outcome: 'unverified', disruptionReason: 'outcome_unknown' };
  const reason = ['manager_absent', 'access_unavailable', 'weather', 'other'].includes(value.disruptionReason) ? value.disruptionReason as TourHistoryEvent['disruptionReason'] : undefined;
  return { outcome: reason ? 'disrupted' : value.cancelledBy === 'manager_declined' ? 'declined' : 'cancelled', ...(reason ? { disruptionReason: reason } : {}) };
}

/** Project recorded facts only. Delivery payloads contain private recipient and note data. */
export function tourHistory(tour: { createdAt?: unknown; confirmedAt?: unknown; outcomeHistory?: unknown; attendanceHistory?: unknown }, ledger: { id: number; createdAt: unknown; payload: unknown }[], visitEvidence?: VisitEvent[]): TourHistory {
  const events: TourHistoryEvent[] = [];
  const recordedOutcomes = new Set<string>();
  for (const row of ledger) {
    const payload = row.payload as Record<string, any> | null;
    const recordedAt = instant(row.createdAt);
    if (!payload || !kinds.includes(payload.kind) || !recordedAt) continue;
    const before = payload.before || {}, after = payload.after || {};
    if (visitEvidence && (['visitor_checkin', 'visitor_checkout', 'attendance_assisted', 'attendance_corrected', 'evidence_repaired'].includes(payload.kind)
      || payload.kind === 'status' && (['completed', 'no_show'].includes(after.status) || after.disruptionReason))) continue;
    if (payload.kind === 'status' && Array.isArray(after.outcomeHistory)) {
      const prior = Array.isArray(before.outcomeHistory) ? before.outcomeHistory.length : 0;
      for (const entry of after.outcomeHistory.slice(prior)) {
        const time = instant(entry?.recordedAt), status = publicStatus(entry?.to);
        if (time && status) recordedOutcomes.add(`${time}:${status}`);
      }
    }
    const event: TourHistoryEvent = { key: `event-${row.id}`, kind: payload.kind, recordedAt: payload.kind === 'expired' ? instant(after.requestExpiredAt) || recordedAt : recordedAt, actor: actor(payload.actorRole) };
    if (payload.kind === 'reconfirmation_replied' && ['still_coming', 'reschedule', 'cant_make_it'].includes(after.reconfirmationReply)) event.reply = after.reconfirmationReply;
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
  const confirmedAt = instant(tour.confirmedAt);
  if (confirmedAt && !events.some(event => event.status === 'confirmed' && event.previousStatus && event.previousStatus !== 'confirmed'))
    events.push({ key: 'confirmation', kind: 'status', status: 'confirmed', recordedAt: confirmedAt, actor: 'system' });
  if (!visitEvidence && Array.isArray(tour.outcomeHistory)) for (let index = 0; index < tour.outcomeHistory.length; index++) {
    const entry = tour.outcomeHistory[index];
    const recordedAt = instant(entry?.recordedAt), status = publicStatus(entry?.to);
    if (!recordedAt || !status || !['cancelled', 'completed', 'no_show'].includes(status) || recordedOutcomes.has(`${recordedAt}:${status}`) || events.some(event => event.kind === 'status' && event.status === status && event.recordedAt === recordedAt)) continue;
    events.push({ key: `outcome-${index}`, kind: 'status', recordedAt, actor: actor(entry.actorRole), status, ...cancellationFacts(entry, status), ...(publicStatus(entry.from) ? { previousStatus: publicStatus(entry.from) } : {}) });
  }
  const attendance = visitEvidence ? [] : attendanceEntries(tour.attendanceHistory);
  for (let index = 0; index < attendance.length; index++) {
    const entry = attendance[index];
    const kind = entry.source === 'manager_assisted' ? 'attendance_assisted' : entry.action === 'check_in' ? 'visitor_checkin' : 'visitor_checkout';
    if (events.some(event => event.kind === kind && event.actualAt === entry.actualAt && event.action === entry.action)) continue;
    events.push({ key: `attendance-${index}`, kind, action: entry.action, recordedAt: entry.recordedAt, actualAt: entry.actualAt, scheduledAt: entry.scheduledAt, actor: entry.source === 'manager_assisted' ? 'manager' : 'chef' });
  }
  for (const event of visitEvidence || []) {
    const data = event.data as { timestampUnknown?: boolean; resultPreserved?: boolean; disruptionReason?: unknown } | null;
    if (data?.timestampUnknown || data?.resultPreserved || event.kind === 'legacy_evidence') continue;
    const recordedAt = instant(event.recordedAt);
    if (!recordedAt) continue;
    const fact: TourHistoryEvent = { key: `visit-${event.id}`, recordedAt, actor: actor(event.actorRole),
      kind: event.kind === 'repair' ? 'evidence_repaired' : event.kind === 'result' ? 'status' : event.source === 'correction' ? 'attendance_corrected'
        : event.source !== 'visitor' ? 'attendance_assisted' : event.kind === 'arrival' ? 'visitor_checkin' : 'visitor_checkout' };
    if (event.kind === 'result') {
      fact.status = event.result === 'completed' ? 'completed' : event.result === 'visitor_absent' ? 'no_show' : 'cancelled';
      if (event.result === 'disrupted') fact.outcome = 'disrupted';
      if (event.result === 'unrecorded') fact.outcome = 'unverified';
    } else if (['arrival', 'departure'].includes(event.kind)) {
      fact.actualAt = instant(event.actualAt); fact.action = event.kind === 'arrival' ? 'check_in' : 'check_out';
      fact.scheduledAt = instant(event.scheduledAt);
    }
    events.push(fact);
  }
  return { events: events.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)), complete };
}
