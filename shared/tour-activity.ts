type TourActivityRecord = { status: string; disruptionReason?: string | null; updatedAt?: string; createdAt?: string; scheduledAt: string; outcomeHistory?: unknown };
export type TourActivity = { key: string; status: string; disruptionReason: string | null; corrected: boolean; recordedAt: string };

/** Only recorded changes are activity. Scheduled time alone is not an outcome timestamp. */
export function tourActivity(tour: TourActivityRecord): TourActivity[] {
  const history = Array.isArray(tour.outcomeHistory) ? tour.outcomeHistory : [];
  const events: TourActivity[] = history.flatMap((entry, index) => {
    if (!entry || typeof entry.to !== 'string' || typeof entry.recordedAt !== 'string' || !Number.isFinite(Date.parse(entry.recordedAt))) return [];
    return [{ key: `outcome-${index}`, status: entry.to, disruptionReason: entry.disruptionReason || null,
      corrected: ['completed', 'no_show', 'cancelled'].includes(entry.from), recordedAt: entry.recordedAt }];
  });
  const currentTime = tour.updatedAt || tour.createdAt;
  if (currentTime && Number.isFinite(Date.parse(currentTime)) && !events.some(event => Date.parse(event.recordedAt) === Date.parse(currentTime))) {
    events.push({ key: 'current', status: tour.status, disruptionReason: tour.disruptionReason || null, corrected: false, recordedAt: currentTime });
  }
  return events.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
