/**
 * Which store owns which half of the chef application.
 *
 * The request-to-apply questions (tier 1) are platform-wide and owned by Local
 * Cooks admins; they live in `platform_settings` under `step1_requirements`.
 * The kitchen-document requirements (tier 2) are per-kitchen and live on
 * `location_requirements`.
 *
 * The chef-facing requirements endpoint serves BOTH halves, so the two stores
 * have to be merged in exactly one place. This module is that place — the
 * admin's settings were previously written and never read, which is why the
 * request-phase toggles appeared to do nothing.
 */

/** `platform_settings` key holding the admin-owned request-to-apply settings. */
export const STEP1_REQUIREMENTS_SETTING_KEY = 'step1_requirements';

/**
 * The request-to-apply flags the admin owns.
 *
 * Listed explicitly rather than spread wholesale, so a stray or stale key in the
 * stored JSON can never leak into — or overwrite — a per-kitchen value.
 *
 * `requireFoodHandlerExpiry` is deliberately absent: the expiry is required
 * whenever a certificate is on file, so a separate switch for it could only ever
 * contradict that rule.
 */
export const TIER1_REQUIREMENT_KEYS = [
  'requireFirstName',
  'requireLastName',
  'requireEmail',
  'requirePhone',
  'requireBusinessName',
  'requireBusinessType',
  'requireBusinessDescription',
  'requireExperience',
  'requireUsageFrequency',
  'requireSessionDuration',
  'requireTermsAgree',
  'requireAccuracyAgree',
  'requireFoodHandlerCert',
  'tier1_years_experience_required',
  'tier1_years_experience_minimum',
  'tier1_custom_fields',
] as const;

export type Tier1RequirementKey = (typeof TIER1_REQUIREMENT_KEYS)[number];

/**
 * Overlay the admin's request-to-apply settings onto a kitchen's requirement row
 * so the chef-facing payload answers both halves of the application.
 *
 * Keys the admin has never saved are left untouched: the per-kitchen value (or
 * the code default) still stands. That is what keeps this backwards compatible
 * for every kitchen whose admin has not opened the page yet.
 */
export function applyTier1Requirements<T extends Record<string, unknown>>(
  locationRequirements: T,
  adminSettings: unknown,
): T {
  if (!adminSettings || typeof adminSettings !== 'object' || Array.isArray(adminSettings)) {
    return locationRequirements;
  }
  const source = adminSettings as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...locationRequirements };
  for (const key of TIER1_REQUIREMENT_KEYS) {
    if (source[key] !== undefined) merged[key] = source[key];
  }
  return merged as T;
}
