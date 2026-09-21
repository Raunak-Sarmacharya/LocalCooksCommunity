/**
 * Whether the onboarding auto-resume may decide where to open the wizard yet.
 *
 * Extracted from the effect because it is the thing that was wrong, and it was wrong in a way no
 * test could see while it lived inline: the effect bailed for a manager with NO location, which is
 * exactly the first-time case the decision exists for.
 *
 * WHY A REASON AND NOT A BOOLEAN
 *
 * The effect logs which wait it is sitting in, and those logs are how this flow gets diagnosed
 * (`[Onboarding] Waiting for ...`). Returning the reason keeps that, and makes it assertable.
 */
export interface ResumeGateInput {
  isLoadingLocations: boolean;
  isAddingLocation: boolean;
  /** How many locations the manager has. Zero is a real answer, not a missing one. */
  locationCount: number;
  selectedLocationId: number | null;
  kitchensLoaded: boolean;
  requirementsLoaded: boolean;
  availabilityLoaded: boolean;
  /** Availability is only checkable once a kitchen exists. */
  kitchenCount: number;
}

/**
 * @returns the reason to wait, or `null` when the effect may decide.
 */
export function resumeBlockedBy(input: ResumeGateInput): string | null {
  if (input.isLoadingLocations) return 'locations are still loading';
  if (input.isAddingLocation) return 'adding a new location';

  /*
   * NO LOCATION YET MEANS THERE IS NOTHING TO WAIT FOR.
   *
   * `location` is the first required step and every later step is incomplete by definition, so the
   * decision is already knowable. Blocking here — which is what this did — meant the effect never ran
   * for a first-time manager at all, which is the one case it exists for.
   *
   * Every wait below reads something that only exists once a location does, so they stay.
   */
  if (input.locationCount === 0) return null;

  if (!input.selectedLocationId) return 'the location is not selected yet';
  if (!input.kitchensLoaded) return 'kitchens are still loading';
  if (!input.requirementsLoaded) return 'requirements are still loading';
  if (input.kitchenCount > 0 && !input.availabilityLoaded) return 'availability is still loading';

  return null;
}
