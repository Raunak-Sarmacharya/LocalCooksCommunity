/** Admin-only notes live with their outcome, never in the manager's shared message. */
export function adminTourOutcomeNotes(tour: { status?: unknown; outcomeHistory?: unknown }): string | null {
  if (!Array.isArray(tour.outcomeHistory)) return null;
  const latest = tour.outcomeHistory.at(-1);
  if (!latest || latest.actorRole !== 'admin' || latest.to !== tour.status
    || !(['completed', 'no_show'].includes(latest.to) || latest.to === 'cancelled' && latest.disruptionReason)) return null;
  const notes = latest.outcomeNotes ?? latest.sharedNotes;
  return typeof notes === 'string' && notes.trim() ? notes : null;
}

/** Withhold legacy outcome notes that the old admin form put in the shared field. */
export function publicTourManagerNotes(tour: { sharedManagerNotes?: unknown; outcomeHistory?: unknown }): string | null {
  if (typeof tour.sharedManagerNotes !== 'string') return null;
  if (Array.isArray(tour.outcomeHistory) && tour.outcomeHistory.some(entry => entry?.actorRole === 'admin'
    && (['completed', 'no_show'].includes(entry.to) || entry.to === 'cancelled' && entry.disruptionReason)
    && entry.sharedNotes === tour.sharedManagerNotes)) return null;
  return tour.sharedManagerNotes;
}

/** Older clients saved the cancelling role as a reason; it is not a shared explanation. */
export function publicTourCancellationReason(value?: string | null): string | null {
  return value && !/^cancelled by (chef|manager|admin|local cooks)\.?$/i.test(value.trim()) ? value : null;
}

/** The existing chef confirmation modal saves a generic label, not a reason field. */
export function chefTourCancellationReason(value?: string | null): string {
  const reason = value?.trim();
  return !reason || /^tour cancelled\.?$/i.test(reason) ? 'The visitor says they can’t make it.' : reason;
}
/** Public tour responses must never leak legacy/internal note text. */
export function publicTour<T extends { managerNotes?: unknown; outcomeNotes?: unknown; outcomeHistory?: unknown; sharedManagerNotes?: unknown }>(tour: T) {
  const { managerNotes: _internal, outcomeNotes: _outcome, outcomeHistory: _history, ...fields } = tour;
  const { attendanceHistory: _attendance, attendanceEvidence: _evidence, outcomeRecordedBy: _actor,
    visitEvidenceIssue: _issue, visitEvidenceMigratedAt: _migration, ...publicFields } = fields as typeof fields & {
      attendanceHistory?: unknown; attendanceEvidence?: unknown; outcomeRecordedBy?: unknown;
      visitEvidenceIssue?: unknown; visitEvidenceMigratedAt?: unknown };
  return { ...publicFields, ...('sharedManagerNotes' in tour ? { sharedManagerNotes: publicTourManagerNotes(tour) } : {}), ...('cancellationReason' in tour ? { cancellationReason: publicTourCancellationReason(typeof tour.cancellationReason === 'string' ? tour.cancellationReason : null) } : {}),
    ...('checkedInAt' in tour ? { checkedInAt: null } : {}),
    ...('checkedOutAt' in tour ? { checkedOutAt: null } : {}),
    ...('attendanceHistory' in tour ? { attendanceHistory: [] } : {}), outcomeHistory: [] };
}

export const tourDisruptionReasons = {
  manager_absent: 'Manager did not attend',
  access_unavailable: 'Kitchen access was unavailable',
  weather: 'Weather prevented the tour',
  other: 'Another problem',
  outcome_unknown: 'Tour outcome could not be verified',
} as const;

/** Do not treat a terminal label itself as proof of a historical confirmation. */
export function hasTourConfirmation(tour: { status: string; confirmedAt?: unknown; requestExpiredAt?: unknown; outcomeHistory?: unknown; confirmationVerified?: boolean }) {
  if (tour.requestExpiredAt) return false;
  if (tour.confirmationVerified !== undefined) return tour.confirmationVerified;
  const confirmed = (typeof tour.confirmedAt === 'string' || tour.confirmedAt instanceof Date) && Number.isFinite(new Date(tour.confirmedAt).getTime());
  return tour.status === 'confirmed' || confirmed || (Array.isArray(tour.outcomeHistory)
    && tour.outcomeHistory.some(entry => entry?.from === 'confirmed' || entry?.to === 'confirmed'));
}
