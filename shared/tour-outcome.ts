/** Public tour responses must never leak legacy/internal note text. */
import { attendanceEntries } from './tour-attendance';
export function publicTour<T extends { managerNotes?: unknown; outcomeHistory?: unknown }>(tour: T) {
  const { managerNotes: _internal, outcomeHistory, ...publicFields } = tour;
  return { ...publicFields, ...('attendanceHistory' in tour ? { attendanceHistory: attendanceEntries(tour.attendanceHistory) } : {}), outcomeHistory: Array.isArray(outcomeHistory)
    ? outcomeHistory.filter(entry => entry && typeof entry === 'object').map(({ notes: _notes, ...entry }) => entry) : [] };
}

export const tourDisruptionReasons = {
  manager_absent: 'Manager did not attend',
  access_unavailable: 'Kitchen access was unavailable',
  weather: 'Weather prevented the tour',
  other: 'Another problem',
} as const;

/** Do not treat a terminal label itself as proof of a historical confirmation. */
export function hasTourConfirmation(tour: { status: string; outcomeHistory?: unknown }) {
  return tour.status === 'confirmed' || (Array.isArray(tour.outcomeHistory)
    && tour.outcomeHistory.some(entry => entry?.from === 'confirmed' || entry?.to === 'confirmed'));
}
