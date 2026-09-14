import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNeonUser } from "./firebase-auth-middleware";
import { userService } from "./domains/users/user.service";

describe("Firebase account resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves application accounts only by Firebase UID", async () => {
    const findByUid = vi.spyOn(userService, "getUserByFirebaseUid").mockResolvedValue(null);

    await expect(resolveNeonUser({ uid: "unprovisioned-phone-uid" })).resolves.toBeNull();
    expect(findByUid).toHaveBeenCalledWith("unprovisioned-phone-uid");
  });
});
