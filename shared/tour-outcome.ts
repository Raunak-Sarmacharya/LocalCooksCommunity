/** Public tour responses must never leak legacy/internal note text. */
import { attendanceEntries } from './tour-attendance';
/** Older clients saved the cancelling role as a reason; it is not a shared explanation. */
export function publicTourCancellationReason(value?: string | null): string | null {
  return value && !/^cancelled by (chef|manager|admin|local cooks)\.?$/i.test(value.trim()) ? value : null;
}
export function publicTour<T extends { managerNotes?: unknown; outcomeHistory?: unknown }>(tour: T) {
  const { managerNotes: _internal, outcomeHistory, ...publicFields } = tour;
  return { ...publicFields, ...('cancellationReason' in tour ? { cancellationReason: publicTourCancellationReason(typeof tour.cancellationReason === 'string' ? tour.cancellationReason : null) } : {}),
    ...('attendanceHistory' in tour ? { attendanceHistory: attendanceEntries(tour.attendanceHistory) } : {}), outcomeHistory: Array.isArray(outcomeHistory)
    ? outcomeHistory.filter(entry => entry && typeof entry === 'object').map(({ notes: _notes, ...entry }) => entry) : [] };
}

export const tourDisruptionReasons = {
  manager_absent: 'Manager did not attend',
  access_unavailable: 'Kitchen access was unavailable',
  weather: 'Weather prevented the tour',
  other: 'Another problem',
} as const;

/** Do not treat a terminal label itself as proof of a historical confirmation. */
export function hasTourConfirmation(tour: { status: string; confirmedAt?: unknown; requestExpiredAt?: unknown; outcomeHistory?: unknown }) {
  if (tour.requestExpiredAt) return false;
  const confirmed = (typeof tour.confirmedAt === 'string' || tour.confirmedAt instanceof Date) && Number.isFinite(new Date(tour.confirmedAt).getTime());
  return tour.status === 'confirmed' || confirmed || (Array.isArray(tour.outcomeHistory)
    && tour.outcomeHistory.some(entry => entry?.from === 'confirmed' || entry?.to === 'confirmed'));
}
