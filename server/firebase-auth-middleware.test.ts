import { afterEach, describe, expect, it, vi } from "vitest";
import { hasCompleteFirebaseContactVerification, resolveNeonUser } from "./firebase-auth-middleware";
import { userService } from "./domains/users/user.service";

describe("Firebase account resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves application accounts only by Firebase UID", async () => {
    const findByUid = vi.spyOn(userService, "getUserByFirebaseUid").mockResolvedValue(null);

    await expect(resolveNeonUser({ uid: "unprovisioned-phone-uid" })).resolves.toBeNull();
    expect(findByUid).toHaveBeenCalledWith("unprovisioned-phone-uid");
  });
});

describe("operational contact verification", () => {
  it("requires Firebase proof for both email and phone", () => {
    expect(hasCompleteFirebaseContactVerification({
      firebaseUser: { uid: "uid", email_verified: true, phone_number: "+14165550123" },
    } as any)).toBe(true);
    expect(hasCompleteFirebaseContactVerification({
      firebaseUser: { uid: "uid", email_verified: true },
    } as any)).toBe(false);
    expect(hasCompleteFirebaseContactVerification({
      firebaseUser: { uid: "uid", phone_number: "+14165550123" },
    } as any)).toBe(false);
  });
});
