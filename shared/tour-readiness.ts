import { copyableTourHours, type WeeklyTourSource } from './tour-schedule';

type TourSetup = {
  isActive?: boolean;
  arrivalNotes?: string | null;
  departureNotes?: string | null;
  defaultDurationMinutes?: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
};

export function hasTourInstructions(settings: TourSetup | null | undefined): boolean {
  return Boolean(settings?.arrivalNotes?.trim() && settings.departureNotes?.trim());
}

/** Saved configuration and drafts use the same requirements; activation is a separate action. */
export function tourReadiness(settings: TourSetup | null | undefined, hours: WeeklyTourSource[]) {
  const arrival = Boolean(settings?.arrivalNotes?.trim());
  const departure = Boolean(settings?.departureNotes?.trim());
  const schedule = copyableTourHours(hours, settings?.defaultDurationMinutes ?? 30,
    settings?.bufferBeforeMinutes ?? 0, settings?.bufferAfterMinutes ?? 15).length > 0;
  return { arrival, departure, schedule, ready: arrival && departure && schedule,
    completed: Number(arrival) + Number(departure) + Number(schedule) };
}
