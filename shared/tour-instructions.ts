type Instructions = { arrivalNotes?: string | null; departureNotes?: string | null };
export type TourInstructionChanges = { arrival: boolean; departure: boolean };

export function changedTourInstructions(before: Instructions | undefined, after: Instructions): TourInstructionChanges {
  return {
    arrival: (before?.arrivalNotes?.trim() || '') !== (after.arrivalNotes?.trim() || ''),
    departure: (before?.departureNotes?.trim() || '') !== (after.departureNotes?.trim() || ''),
  };
}

/** Once a chef has arrived, only departure changes are useful. Closed visits receive neither. */
export function tourInstructionChangesForVisit(tour: {
  status: string; scheduledAt: Date | string; checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null; disruptionReason?: string | null; visitResult?: unknown;
}, changes: TourInstructionChanges, now = Date.now()): TourInstructionChanges {
  if (tour.status !== 'confirmed' || tour.checkedOutAt || tour.disruptionReason || tour.visitResult)
    return { arrival: false, departure: false };
  if (tour.checkedInAt) return { arrival: false, departure: changes.departure };
  return new Date(tour.scheduledAt).getTime() > now ? changes : { arrival: false, departure: false };
}
