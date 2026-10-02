import { describe, expect, it } from "vitest";
import { TRACKING_PROMPT_DISMISS_MS, isTrackingPromptDismissed, saveTrackingPromptDismissal, trackingPromptKey, trackingSetupSignature } from "./kitchen-tracking-prompt";

describe("check-in setup dismissal", () => {
  it("expires after 30 days and is scoped to account, kitchen, and setup state", () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };
    const key = trackingPromptKey("manager-a", 40);
    const original = trackingSetupSignature([false, false, [], null]);
    const changed = trackingSetupSignature([true, false, [], null]);
    const now = Date.now();
    saveTrackingPromptDismissal(store, key, original, now);

    expect(isTrackingPromptDismissed(store, key, original, now + TRACKING_PROMPT_DISMISS_MS - 1)).toBe(true);
    expect(isTrackingPromptDismissed(store, key, original, now + TRACKING_PROMPT_DISMISS_MS)).toBe(false);
    expect(isTrackingPromptDismissed(store, key, changed, now + 1)).toBe(false);
    expect(isTrackingPromptDismissed(store, trackingPromptKey("manager-a", 41), original, now + 1)).toBe(false);
    expect(isTrackingPromptDismissed(store, trackingPromptKey("manager-b", 40), original, now + 1)).toBe(false);
  });

  it("treats missing, corrupt, and future records as not dismissed", () => {
    const storage = { getItem: () => "not json" };
    expect(isTrackingPromptDismissed(storage, "key", "state")).toBe(false);
    expect(isTrackingPromptDismissed({ getItem: () => null }, "key", "state")).toBe(false);
    expect(isTrackingPromptDismissed({ getItem: () => JSON.stringify({ signature: "state", dismissedAt: 200 }) }, "key", "state", 100)).toBe(false);
  });
});
