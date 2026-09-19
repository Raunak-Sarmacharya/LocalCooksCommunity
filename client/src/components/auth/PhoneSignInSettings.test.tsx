import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/auth", () => ({
  RecaptchaVerifier: class {
    clear() {}
  },
  linkWithPhoneNumber: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: null }) }));

import { checkPhoneAvailable, resolvePhoneRowState } from "./PhoneSignInSettings";

afterEach(() => vi.unstubAllGlobals());

describe("resolvePhoneRowState", () => {
  it("calls a Firebase credential verified", () => {
    expect(
      resolvePhoneRowState({ linkedPhone: "+17096555123", hasPendingCode: false, storedPhone: "" }),
    ).toBe("verified");
  });

  it("shows the code form while an OTP is outstanding, even over a stored number", () => {
    expect(
      resolvePhoneRowState({ linkedPhone: "", hasPendingCode: true, storedPhone: "+17096555123" }),
    ).toBe("code-sent");
  });

  // The reported bug: a number sitting on the account but never proved resolved to
  // "empty", so the holder was told "No phone number added", could not see which
  // number needed verifying, and was invited to retype one they had already given.
  it("surfaces a stored but unproved number instead of hiding it", () => {
    expect(
      resolvePhoneRowState({ linkedPhone: "", hasPendingCode: false, storedPhone: "+17096318480" }),
    ).toBe("unverified");
  });

  // A proved number wins over the stored copy: once it is a credential, that is the
  // stronger fact, and showing "not verified" next to a working sign-in number
  // would be a lie.
  it("prefers the verified credential over the stored copy", () => {
    expect(
      resolvePhoneRowState({ linkedPhone: "+17096318480", hasPendingCode: false, storedPhone: "+17096318480" }),
    ).toBe("verified");
  });

  it("reports empty only when nothing is on file", () => {
    expect(resolvePhoneRowState({ linkedPhone: "", hasPendingCode: false, storedPhone: "" })).toBe("empty");
  });
});

describe("checkPhoneAvailable", () => {
  const respondWith = (body: unknown, ok = true) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));

  it("reports a free number as available", async () => {
    respondWith({ available: true });
    await expect(checkPhoneAvailable("+17096555123", "t")).resolves.toBe("available");
  });

  it("reports a number another account holds as taken", async () => {
    respondWith({ available: false });
    await expect(checkPhoneAvailable("+17096555123", "t")).resolves.toBe("taken");
  });

  // "we could not tell" must never be reported as "somebody else owns it": the copy
  // differs, and a user told their own number is taken would go hunting for an
  // account that does not exist. Both still BLOCK the send.
  it("distinguishes an unreadable answer from a taken number", async () => {
    respondWith({});
    await expect(checkPhoneAvailable("+17096555123", "t")).resolves.toBe("unknown");

    respondWith({ available: true }, false);
    await expect(checkPhoneAvailable("+17096555123", "t")).resolves.toBe("unknown");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(checkPhoneAvailable("+17096555123", "t")).resolves.toBe("unknown");
  });

  it("sends the number and the bearer token the server needs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await checkPhoneAvailable("+17096555123", "id-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/user/phone-availability",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer id-token" }),
        body: JSON.stringify({ phone: "+17096555123" }),
      }),
    );
  });
});
