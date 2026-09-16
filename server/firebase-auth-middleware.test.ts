import { afterEach, describe, expect, it, vi } from "vitest";
import { hasVerifiedEmail, resolveNeonUser } from "./firebase-auth-middleware";
import { userService } from "./domains/users/user.service";

describe("Firebase account resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves application accounts only by Firebase UID", async () => {
    const findByUid = vi.spyOn(userService, "getUserByFirebaseUid").mockResolvedValue(null);

    await expect(resolveNeonUser({ uid: "unprovisioned-phone-uid" })).resolves.toBeNull();
    expect(findByUid).toHaveBeenCalledWith("unprovisioned-phone-uid");
  });
});

describe("hasVerifiedEmail", () => {
  it("accepts the token claim", () => {
    expect(hasVerifiedEmail({ firebaseUser: { uid: "uid", email_verified: true } } as any)).toBe(true);
  });

  it("accepts the application mirror when the claim is stale", () => {
    // The claim is a cache that lags an email change by up to an hour, and refreshing it is
    // not something we can force safely. The mirror is written only when Firebase has
    // confirmed the address, so it must be able to satisfy the gate on its own — otherwise
    // every request is refused until the token happens to refresh.
    expect(
      hasVerifiedEmail({
        firebaseUser: { uid: "uid", email_verified: false },
        neonUser: { isVerified: true },
      } as any)
    ).toBe(true);
  });

  it("refuses when neither signal says verified", () => {
    expect(
      hasVerifiedEmail({
        firebaseUser: { uid: "uid", email_verified: false },
        neonUser: { isVerified: false },
      } as any)
    ).toBe(false);
    expect(hasVerifiedEmail({ firebaseUser: { uid: "uid" } } as any)).toBe(false);
  });

  it("tolerates either side being absent", () => {
    expect(hasVerifiedEmail({ neonUser: { isVerified: true } } as any)).toBe(true);
    expect(hasVerifiedEmail({ firebaseUser: { uid: "uid", email_verified: true } } as any)).toBe(true);
    expect(hasVerifiedEmail({} as any)).toBe(false);
  });
});
