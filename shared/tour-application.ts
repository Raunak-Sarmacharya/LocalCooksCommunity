export type TourApplicationReference = {
  intendedUse: string;
  estimatedWeeklyHours: string;
  hasLicense: boolean | null;
  targetStartDate: string;
  chefNotes: string;
  sharedManagerNotes: string;
  additionalInfo: string;
};

export type TourApplicationNextStep = {
  action: 'apply' | 'continue' | 'view' | 'unavailable';
  href: string;
  applicationId: number | null;
  sourceTourId: number;
  locationId: number;
  kitchenId: number | null;
  outcomeVerified?: boolean;
  prefill?: TourApplicationReference;
};

/** Intended use is a description, never a frequency, duration or verified certificate. */
export function tourApplicationDefaults<T extends { businessDescription?: string }>(
  defaults: T, reference?: TourApplicationReference, hasSavedApplication = false,
): T {
  return !hasSavedApplication && !defaults.businessDescription?.trim() && reference?.intendedUse
    ? { ...defaults, businessDescription: reference.intendedUse } : defaults;
}
