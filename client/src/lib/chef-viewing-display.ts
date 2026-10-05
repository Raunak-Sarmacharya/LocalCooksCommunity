/** Pure helpers for chef kitchen-tour list / table. */
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { publicTour } from '@shared/tour-outcome';
import type { TourAttendance } from '@shared/tour-attendance';

export type ViewingStatusBadge = {
  variant: "warning" | "success" | "destructive" | "outline" | "secondary" | "info";
  labelKey: 'tourStatusDisrupted' | 'tourStatusRejected' | 'tourStatusPending' | 'tourStatusConfirmed'
    | 'tourStatusCompleted' | 'tourStatusCancelled' | 'tourStatusNoShow' | 'tourStatusUnknown';
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
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  attendance?: TourAttendance;
  requestedRescheduleAt: string | null;
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

export function viewingStatusBadge(status: string, adminReviewDecision?: string | null, cancelledBy?: string | null, disruptionReason?: string | null): ViewingStatusBadge {
  if (disruptionReason) return { variant: "destructive", labelKey: "tourStatusDisrupted", defaultLabel: "Couldn’t take place" };
  if (status === "cancelled" && (adminReviewDecision === "denied" || cancelledBy === "manager_declined")) {
    return { variant: "destructive", labelKey: "tourStatusRejected", defaultLabel: "Rejected" };
  }
  switch (status) {
    case "pending_local_cooks":
      return { variant: "warning", labelKey: "tourStatusPending", defaultLabel: "Request sent" };
    case "pending":
      return { variant: "warning", labelKey: "tourStatusPending", defaultLabel: "Request sent" };
    case "confirmed":
      return { variant: "success", labelKey: "tourStatusConfirmed", defaultLabel: "Approved" };
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
    adminReviewDecision: viewing.adminReviewDecision ?? null,
    cancelledBy: viewing.cancelledBy ?? null,
    scheduledAt: viewing.scheduledAt,
    updatedAt: viewing.updatedAt || viewing.createdAt || viewing.scheduledAt,
    checkedInAt: viewing.checkedInAt ?? null,
    checkedOutAt: viewing.checkedOutAt ?? null,
    attendance: viewing.attendance,
    requestedRescheduleAt: viewing.requestedRescheduleAt ?? null,
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
  if (row.status === "pending_local_cooks" || row.status === "pending") return new Date(row.scheduledAt).getTime() >= nowMs;
  if (row.status !== "confirmed") return false;
  const start = new Date(row.scheduledAt).getTime();
  if (Number.isNaN(start)) return false;
  const durationMs = Math.max(row.durationMinutes ?? 30, 0) * 60_000;
  return start + durationMs >= nowMs;
}

export function countPendingOrUpcomingTours(
  rows: Array<Pick<ChefTourRow, "status" | "scheduledAt" | "durationMinutes">>,
  nowMs: number = Date.now()
): number {
  return rows.filter((row) => isPendingOrUpcomingTour(row, nowMs)).length;
}
