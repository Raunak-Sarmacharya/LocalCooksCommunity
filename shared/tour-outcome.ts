/** Public tour responses must never leak legacy/internal note text. */
/** Older clients saved the cancelling role as a reason; it is not a shared explanation. */
export function publicTourCancellationReason(value?: string | null): string | null {
  return value && !/^cancelled by (chef|manager|admin|local cooks)\.?$/i.test(value.trim()) ? value : null;
}
export function publicTour<T extends { managerNotes?: unknown; outcomeHistory?: unknown }>(tour: T) {
  const { managerNotes: _internal, outcomeHistory: _history, ...fields } = tour;
  const { attendanceHistory: _attendance, attendanceEvidence: _evidence, outcomeRecordedBy: _actor,
    visitEvidenceIssue: _issue, visitEvidenceMigratedAt: _migration, ...publicFields } = fields as typeof fields & {
      attendanceHistory?: unknown; attendanceEvidence?: unknown; outcomeRecordedBy?: unknown;
      visitEvidenceIssue?: unknown; visitEvidenceMigratedAt?: unknown };
  return { ...publicFields, ...('cancellationReason' in tour ? { cancellationReason: publicTourCancellationReason(typeof tour.cancellationReason === 'string' ? tour.cancellationReason : null) } : {}),
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
