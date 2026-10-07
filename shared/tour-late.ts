/** Coordination is useful near arrival; it never records attendance or sends a message. */
export function tourCanReportLate(tour: { status: string; scheduledAt: Date | string; durationMinutes: number | null; checkedInAt?: unknown; disruptionReason?: unknown }, now = Date.now()) {
  const start = new Date(tour.scheduledAt).getTime();
  return tour.status === 'confirmed' && !tour.checkedInAt && !tour.disruptionReason
    && tour.durationMinutes != null && Number.isFinite(tour.durationMinutes) && tour.durationMinutes > 0
    && now >= start - 60 * 60_000 && now < start + tour.durationMinutes * 60_000;
}
