/** Pure helpers for chef kitchen-tour list / table. */
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { publicTour } from '@shared/tour-outcome';
import type { TourAttendance } from '@shared/tour-attendance';
import { formatTime } from './formatters';
import { timeRange } from './booking-header-state';

export type ViewingStatusBadge = {
  variant: "warning" | "success" | "destructive" | "outline" | "secondary" | "info";
  labelKey: 'tourStatusDisrupted' | 'tourStatusDeclined' | 'tourStatusPending' | 'tourStatusConfirmed'
    | 'tourStatusCompleted' | 'tourStatusCancelled' | 'tourStatusNoShow' | 'tourStatusUnknown' | 'tourStatusUnverified';
  defaultLabel: string;
};

export type ChefTourRow = {
  id: number;
  locationId: number | null;
  targetedKitchenId: number | null;
  locationName: string;
  locationAddress: string | null;
  locationContactEmail: string | null;
  locationContactPhone: string | null;
  arrivalNotes?: string | null;
  departureNotes?: string | null;
  kitchenName: string | null;
  status: string;
  adminReviewDecision: string | null;
  cancelledBy: string | null;
  scheduledAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  confirmationVerified?: boolean;
  chefFeedbackSubmitted?: boolean;
  visitEvidenceState?: string;
  requestExpiredAt?: string | null;
  reconfirmation?: { revision: string; askAt: string | null; escalateAt: string | null; reply: 'still_coming' | 'reschedule' | 'cant_make_it' | null; repliedAt: string | null; canReply: boolean; needsStaffAttention: boolean };
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  attendance?: TourAttendance;
  requestedRescheduleAt: string | null;
  rescheduleProposedSlots: string[];
  rescheduleProposedAt: string | null;
  durationMinutes: number | null;
  chefNotes: string | null;
  sharedManagerNotes: string | null;
  cancellationReason: string | null;
  adminReviewReason: string | null;
  noShowReason: string | null;
  disruptionReason: string | null;
  outcomeHistory: Array<{ from: string; to: string; actorRole: string; recordedAt: string; sharedNotes?: string | null }>;
  adminReviewedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  managerName: string | null;
  managerEmail?: string | null;
  chefName: string | null;
  chefEmail: string | null;
  submittedAt: string;
  timezone: string;
  intakeEntries: [string, unknown][];
};

/** Use the server's effective action window for every visitor entry point. */
export function chefTourVisitAction(tour: Pick<ChefTourRow, 'status' | 'checkedInAt' | 'checkedOutAt' | 'attendance'> & { disruptionReason?: string | null }, now = Date.now()): 'arrival' | 'departure' | null {
  const visit = tour.attendance;
  if (tour.checkedInAt && !tour.checkedOutAt && visit?.canCheckOut) return 'departure';
  if (tour.status === 'confirmed' && !tour.disruptionReason && !tour.checkedInAt && visit?.canCheckIn
    && now >= Date.parse(visit.checkInOpensAt) && now <= Date.parse(visit.checkInClosesAt)) return 'arrival';
  return null;
}

/** Keep future tours quiet; server eligibility supplies the configured arrival window. */
export function showTourVisitPanel(tour: { checkedInAt?: string | null; visitEvidenceState?: string; attendance?: Pick<TourAttendance, 'checkInOpensAt'> }, now = Date.now()) {
  return !!tour.checkedInAt || tour.visitEvidenceState === 'review' || !!tour.attendance && now >= Date.parse(tour.attendance.checkInOpensAt);
}

export function viewingStatusBadge(status: string, adminReviewDecision?: string | null, cancelledBy?: string | null, disruptionReason?: string | null): ViewingStatusBadge {
  if (disruptionReason === 'outcome_unknown') return { variant: 'outline', labelKey: 'tourStatusUnverified', defaultLabel: 'Tour ended' };
  if (disruptionReason) return { variant: "destructive", labelKey: "tourStatusDisrupted", defaultLabel: "Couldn’t take place" };
  if (status === "cancelled" && (adminReviewDecision === "denied" || cancelledBy === "manager_declined")) {
    return { variant: "destructive", labelKey: "tourStatusDeclined", defaultLabel: "Declined" };
  }
  switch (status) {
    case "pending_local_cooks":
      return { variant: "warning", labelKey: "tourStatusPending", defaultLabel: "Request sent" };
    case "pending":
      return { variant: "warning", labelKey: "tourStatusPending", defaultLabel: "Request sent" };
    case "confirmed":
      return { variant: "success", labelKey: "tourStatusConfirmed", defaultLabel: "Confirmed" };
    case "completed":
      return { variant: "info", labelKey: "tourStatusCompleted", defaultLabel: "Completed" };
    case "cancelled":
      return { variant: "destructive", labelKey: "tourStatusCancelled", defaultLabel: "Cancelled" };
    case "no_show":
      return { variant: "destructive", labelKey: "tourStatusNoShow", defaultLabel: "No show" };
    default:
      return { variant: "outline", labelKey: "tourStatusUnknown", defaultLabel: status || "Unknown" };
  }
}

export function formatTourWhen(
  scheduledAt: string,
  durationMinutes: number | null | undefined,
  _timeZone: string
): string {
  const start = new Date(scheduledAt);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: DEFAULT_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const startLabel = start.toLocaleString("en-US", opts);
  if (!durationMinutes || durationMinutes <= 0) return startLabel;
  return `${formatTourDate(start)}, ${formatTourSlotRange(start, durationMinutes)}`;
}

const nlClock = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
const nlYear = (at: number | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE, year: 'numeric' }).format(at);

/** "11:15–11:45 a.m." (or one clock without a duration), 12-hour in the chef's locale, Newfoundland time. */
export function chefTourTimes(at: string | Date, durationMinutes: number | null | undefined, locale: string) {
  const start = new Date(at), clock = (d: Date) => formatTime(nlClock(d), locale);
  return durationMinutes && durationMinutes > 0 ? timeRange(clock(start), clock(new Date(start.getTime() + durationMinutes * 60_000))) : clock(start);
}

/** "Thu, Oct 29 · 11:15–11:45 a.m." for chef tour pages; the year shows only when it isn't this year. */
export function chefTourWhen(at: string, durationMinutes: number | null | undefined, locale: string, now = Date.now()) {
  const start = new Date(at);
  if (Number.isNaN(start.getTime())) return '';
  try {
    const date = new Intl.DateTimeFormat(locale, { timeZone: DEFAULT_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
      ...(nlYear(start) !== nlYear(now) ? { year: 'numeric' as const } : {}) }).format(start);
    return `${date} · ${chefTourTimes(start, durationMinutes, locale)}`;
  } catch { return formatTourWhen(at, durationMinutes, DEFAULT_TIMEZONE); }
}

type Copy = readonly [key: string, english: string];
/** One tour card in the chef's list: where it sits, the status dot, one plain line, and the single action. */
export type ChefTourCard = { past: boolean; tone: 'green' | 'amber' | 'grey'; status: Copy; line: Copy; action: 'review' | 'apply' | 'open' };

export function chefTourCard(tour: ChefTourRow, now = Date.now()): ChefTourCard {
  const start = Date.parse(tour.scheduledAt), end = start + (tour.durationMinutes ?? 30) * 60_000;
  const requested = ['pending_local_cooks', 'pending'].includes(tour.status);
  const card = (past: boolean, tone: ChefTourCard['tone'], status: Copy, line: Copy, action: ChefTourCard['action'] = 'open'): ChefTourCard => ({ past, tone, status, line, action });
  const apply = tour.locationId ? 'apply' : 'open';
  if (tour.disruptionReason === 'outcome_unknown') return card(true, 'grey', ['tourStatusEnded', 'Tour ended'], ['tourLineUnverified', 'Request to apply when you’re ready to cook here.']);
  if (tour.disruptionReason) return card(true, 'grey', ['tourStatusDisrupted', 'Couldn’t take place'], ['tourLineDisrupted', 'The tour couldn’t take place.']);
  if (tour.status === 'completed') return card(true, 'green', ['tourStatusToured', 'Toured'], ['tourLineToured', 'You toured this kitchen. Request to apply when you’re ready.'], apply);
  if (tour.status === 'no_show') return card(true, 'grey', ['tourStatusNoShow', 'No-show'], ['tourLineNoShow', 'The kitchen recorded that you didn’t come.']);
  if (tour.requestExpiredAt || tour.cancelledBy === 'request_expired' || requested && start <= now) return card(true, 'grey', ['tourExpired', 'Request expired'], ['tourLineExpired', 'The time passed before the kitchen confirmed.']);
  if (tour.status === 'cancelled') {
    if (tour.cancelledBy === 'manager_declined' || tour.adminReviewDecision === 'denied') return card(true, 'grey', ['tourStatusDeclined', 'Declined'], ['tourLineDeclined', 'The kitchen declined this request.']);
    return card(true, 'grey', ['tourStatusCancelled', 'Cancelled'], tour.cancelledBy === 'chef' ? ['tourLineYouCancelled', 'You cancelled this tour.']
      : tour.cancelledBy === 'manager' ? ['tourLineKitchenCancelled', 'The kitchen cancelled this tour.'] : ['tourLineLcClosed', 'Local Cooks closed this tour.']);
  }
  const offered = tour.rescheduleProposedSlots.length > 0 && start > now && !tour.checkedInAt;
  if (requested) return offered ? card(false, 'amber', ['tourStatusAnswerNeeded', 'Answer needed'], ['tourLineOffered', 'The kitchen offered other times. Choose one or keep yours.'], 'review')
    : card(false, 'grey', ['tourStatusRequested', 'Requested'], ['tourLineWaiting', 'Waiting for the kitchen to confirm.']);
  if (tour.status === 'confirmed') {
    if (end <= now) return card(true, 'grey', ['common:tourAwaitingVisitResult', 'Tour ended'], ['tourLineEnded', 'Your tour time has passed. Request to apply when you’re ready.'], apply);
    if (offered) return card(false, 'amber', ['tourStatusAnswerNeeded', 'Answer needed'], ['tourLineOffered', 'The kitchen offered other times. Choose one or keep yours.'], 'review');
    if (tour.reconfirmation?.canReply && tour.reconfirmation.reply !== 'still_coming' && start > now) return card(false, 'amber', ['tourStatusAnswerNeeded', 'Answer needed'], ['tourLineReconfirm', 'The kitchen asks you to confirm you’re still coming.'], 'review');
    const status: Copy = ['tourStatusConfirmed', 'Confirmed'];
    if (start <= now) return card(false, 'green', status, ['tourLineNow', 'Your tour is happening now.']);
    if (tour.requestedRescheduleAt) return card(false, 'green', status, ['tourLineChangeAsked', 'You asked for a new time. Your current time stays until the kitchen answers.']);
    return card(false, 'green', status, ['tourLineConfirmed', 'You’re confirmed. Arrival notes are in the tour.']);
  }
  return card(true, 'grey', ['tourStatusUnknown', tour.status || 'Unknown'], ['tourLineClosed', 'This tour is closed.']);
}

export function normalizeChefTourRow(item: unknown): ChefTourRow | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, any>;
  const viewing = row.viewing || row;
  if (!viewing?.id || !viewing?.scheduledAt) return null;
  const intakeData =
    viewing.intakeData && typeof viewing.intakeData === "object"
      ? (viewing.intakeData as Record<string, unknown>)
      : null;
  const intakeEntries = intakeData
    ? Object.entries(intakeData).filter(([, v]) => v != null && String(v).trim() !== "")
    : [];

  return {
    id: viewing.id,
    locationId: viewing.locationId ?? null,
    targetedKitchenId: viewing.targetedKitchenId ?? null,
    locationName: row.locationName || viewing.location?.name || "Kitchen location",
    locationAddress: row.locationAddress || viewing.location?.address || null,
    locationContactEmail: row.locationContactEmail || null,
    locationContactPhone: row.locationContactPhone || null,
    arrivalNotes: row.arrivalNotes || null,
    departureNotes: row.departureNotes || null,
    kitchenName: row.kitchenName || viewing.kitchen?.name || null,
    status: viewing.status || "pending",
    confirmedAt: viewing.confirmedAt || null,
    chefFeedbackSubmitted: viewing.chefFeedbackSubmitted === true,
    confirmationVerified: viewing.confirmationVerified, visitEvidenceState: viewing.visitEvidenceState,
    requestExpiredAt: viewing.requestExpiredAt || null,
    reconfirmation: row.reconfirmation,
    adminReviewDecision: viewing.adminReviewDecision ?? null,
    cancelledBy: viewing.cancelledBy ?? null,
    scheduledAt: viewing.scheduledAt,
    updatedAt: viewing.updatedAt || viewing.createdAt || viewing.scheduledAt,
    checkedInAt: viewing.checkedInAt ?? null,
    checkedOutAt: viewing.checkedOutAt ?? null,
    attendance: viewing.attendance,
    requestedRescheduleAt: viewing.requestedRescheduleAt ?? null,
    rescheduleProposedSlots: Array.isArray(viewing.rescheduleProposedSlots) ? viewing.rescheduleProposedSlots : [],
    rescheduleProposedAt: viewing.rescheduleProposedAt ?? null,
    durationMinutes: viewing.durationMinutes ?? null,
    chefNotes: viewing.chefNotes ?? null,
    sharedManagerNotes: viewing.sharedManagerNotes ?? null,
    cancellationReason: viewing.cancellationReason ?? null,
    adminReviewReason: viewing.adminReviewReason ?? null,
    noShowReason: viewing.noShowReason ?? null,
    disruptionReason: viewing.disruptionReason ?? null,
    outcomeHistory: publicTour(viewing).outcomeHistory,
    adminReviewedAt: viewing.adminReviewedAt ?? null,
    cancelledAt: viewing.cancelledAt ?? null,
    completedAt: viewing.completedAt ?? null,
    managerName: row.managerName || null,
    managerEmail: row.managerEmail || null,
    chefName: row.chefName || null,
    chefEmail: row.chefEmail || null,
    submittedAt: viewing.createdAt || viewing.submittedAt || "",
    timezone: row.timezone || "America/St_Johns",
    intakeEntries,
  };
}

export function chefTourRowHasDetails(row: ChefTourRow): boolean {
  return Boolean(
    row.checkedInAt || row.checkedOutAt ||
    row.submittedAt ||
    row.chefNotes?.trim() ||
      row.sharedManagerNotes?.trim() ||
      row.cancellationReason?.trim() ||
      row.adminReviewReason?.trim() ||
      row.noShowReason?.trim() ||
      row.intakeEntries.length > 0 ||
      row.status === "pending_local_cooks" ||
      row.status === "pending" ||
      row.status === "confirmed"
  );
}

/** Pending confirmation, or confirmed and not yet finished. */
export function isPendingOrUpcomingTour(
  row: Pick<ChefTourRow, "status" | "scheduledAt" | "durationMinutes">,
  nowMs: number = Date.now()
): boolean {
  if (row.status === "pending_local_cooks" || row.status === "pending") return new Date(row.scheduledAt).getTime() > nowMs;
  if (row.status !== "confirmed") return false;
  const start = new Date(row.scheduledAt).getTime();
  if (Number.isNaN(start)) return false;
  const durationMs = Math.max(row.durationMinutes ?? 30, 0) * 60_000;
  return start + durationMs > nowMs;
}

export function countPendingOrUpcomingTours(
  rows: Array<Pick<ChefTourRow, "status" | "scheduledAt" | "durationMinutes">>,
  nowMs: number = Date.now()
): number {
  return rows.filter((row) => isPendingOrUpcomingTour(row, nowMs)).length;
}
