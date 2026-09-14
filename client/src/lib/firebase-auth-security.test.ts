import { describe, expect, it } from "vitest";
import { hasRecentFirebaseAuth } from "./firebase-auth-security";

describe("sensitive Firebase account changes", () => {
  const now = 1_800_000_000_000;

  it("requires authentication within five minutes", () => {
    expect(hasRecentFirebaseAuth(now / 1000 - 299, now)).toBe(true);
    expect(hasRecentFirebaseAuth(now / 1000 - 301, now)).toBe(false);
    expect(hasRecentFirebaseAuth(undefined, now)).toBe(false);
  });
});
