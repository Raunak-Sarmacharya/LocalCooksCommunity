const KEY_PREFIX = "localcooks.registration-name:";

function keyFor(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

/** Keep the name explicitly entered during registration ahead of provider defaults. */
export function saveRegistrationName(email: string, fullName: string): void {
  const normalizedName = fullName.trim();
  if (!email.trim() || normalizedName.length < 2) return;
  try {
    window.localStorage.setItem(keyFor(email), normalizedName);
  } catch {
    // Storage may be unavailable; Firebase displayName remains the fallback.
  }
}

export function getRegistrationName(email: string): string {
  if (!email.trim()) return "";
  try {
    return window.localStorage.getItem(keyFor(email))?.trim() || "";
  } catch {
    return "";
  }
}

export function clearRegistrationName(email: string): void {
  if (!email.trim()) return;
  try {
    window.localStorage.removeItem(keyFor(email));
  } catch {
    // Ignore unavailable storage.
  }
}
