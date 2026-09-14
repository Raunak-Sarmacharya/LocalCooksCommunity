const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

export function hasRecentFirebaseAuth(authTime: unknown, nowMs = Date.now()): boolean {
  const authTimeSeconds = Number(authTime);
  const ageSeconds = nowMs / 1000 - authTimeSeconds;
  return Number.isFinite(authTimeSeconds) && ageSeconds >= -60 && ageSeconds <= RECENT_AUTH_WINDOW_SECONDS;
}
