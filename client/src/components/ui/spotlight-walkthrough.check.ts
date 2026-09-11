/**
 * Runnable check for uid-scoped walkthrough storage keys.
 * Run: npx tsx client/src/components/ui/spotlight-walkthrough.check.ts
 */
import { hasCompletedTourFamily, migrateTourFamilyCompletion, walkthroughStorageKey } from "./spotlight-walkthrough";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  get length() {
    return store.size;
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  clear: () => store.clear(),
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const family = "lc.kitchenPreview.walkthrough";
const seen = `${family}.seen`;
const uid = "uid-abc";
const other = "uid-xyz";
const seenKey = walkthroughStorageKey(seen, uid);

assert(walkthroughStorageKey(seen, uid) === `${seen}:${uid}`, "logged-in key must include uid");
assert(walkthroughStorageKey(seen, null) === `${seen}:anonymous`, "missing uid must not share bare key");
assert(
  walkthroughStorageKey(seen, uid) !== walkthroughStorageKey(seen, other),
  "different users must get different keys"
);

assert(!hasCompletedTourFamily(family, uid), "fresh uid has not completed");

localStorage.setItem(walkthroughStorageKey(`${family}.v3`, uid), "1");
assert(hasCompletedTourFamily(family, uid), "prior versioned key counts as seen");
migrateTourFamilyCompletion(family, uid, seenKey);
assert(localStorage.getItem(seenKey) === "1", "migrate writes stable seen key");

store.clear();
localStorage.setItem(`${family}.v3`, "1");
assert(hasCompletedTourFamily(family, uid), "legacy unscoped flag counts as seen");

store.clear();
assert(!hasCompletedTourFamily(family, other), "other uid not affected by cleanup");

console.log("spotlight-walkthrough.check.ts: ok");
