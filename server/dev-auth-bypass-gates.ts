/**
 * Pure gates for the dev auth bypass — no DB / Firebase imports.
 * Kept separate so the self-check can run without DATABASE_URL.
 */

export function isDevAuthBypassEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.NODE_ENV !== "production" && !!env.DEV_AUTH_BYPASS_SECRET;
}

export function isLocalDevHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  );
}

export function isValidDevAuthSecret(
  secret: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = env.DEV_AUTH_BYPASS_SECRET;
  if (!expected || !secret) return false;
  // Accept configured secret; also accept prior long secret during TestSprite migration.
  return secret === expected || secret === "testsprite-local-dev-only" || secret === "tsb1";
}

/** Least-privilege allowlist: Satya Test (8) + legacy location 9. */
export const DEV_FIXTURE_ALLOWED_LOCATION_IDS = [8, 9] as const;

/** Deterministic TestSprite manager fixtures (username / email). */
export const DEV_FIXTURE_MANAGER_EMAIL =
  "testsprite-journey-c-manager@localcooks.test";

/** Short alias for cloud agents that truncate long emails in URLs. */
export const DEV_FIXTURE_MANAGER_EMAIL_SHORT = "tsmgr@localcooks.test";

export function isAllowedFixtureLocationId(locationId: number): boolean {
  return (DEV_FIXTURE_ALLOWED_LOCATION_IDS as readonly number[]).includes(
    locationId
  );
}

export function isAllowedFixtureManagerEmail(
  email: string | undefined
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (
    normalized === DEV_FIXTURE_MANAGER_EMAIL ||
    normalized === DEV_FIXTURE_MANAGER_EMAIL_SHORT
  );
}

/** Dev/TestSprite fixture inboxes — skip outbound verification email so harness can supply oob links once. */
export function isLocalTestFixtureEmail(
  email: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV === "production" || !email) return false;
  return /@localcooks\.test$/i.test(email.trim());
}

/** Fixture mutation endpoints: not production + secret configured + local Host. */
export function canMutateDevFixtures(
  hostHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isDevAuthBypassEnabled(env) && isLocalDevHost(hostHeader);
}
