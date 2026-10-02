/** A dismissed setup tip stays quiet for one manager and one unchanged kitchen setup. */
export const TRACKING_PROMPT_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

/** Detect edits without storing checklist text or photo metadata in localStorage. */
export function trackingSetupSignature(settings: unknown[]): string {
  const input = JSON.stringify(settings);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return `${input.length}:${hash >>> 0}`;
}

export function trackingPromptKey(uid: string, kitchenId: number): string {
  return `kitchen-tracking-setup:v1:${uid}:${kitchenId}`;
}

export function isTrackingPromptDismissed(
  storage: Pick<Storage, "getItem">,
  key: string,
  signature: string,
  now = Date.now(),
): boolean {
  try {
    const record = JSON.parse(storage.getItem(key) ?? "null");
    return record?.signature === signature
      && Number.isFinite(record.dismissedAt)
      && record.dismissedAt <= now
      && now - record.dismissedAt < TRACKING_PROMPT_DISMISS_MS;
  } catch {
    return false;
  }
}

export function saveTrackingPromptDismissal(
  storage: Pick<Storage, "setItem">,
  key: string,
  signature: string,
  now = Date.now(),
): void {
  storage.setItem(key, JSON.stringify({ signature, dismissedAt: now }));
}
