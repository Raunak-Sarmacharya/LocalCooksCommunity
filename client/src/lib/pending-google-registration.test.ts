import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingGoogleRegistration,
  isAbandonedGoogleRegistration,
  markPendingGoogleRegistration,
  pendingGoogleRegistration,
  setGoogleRegistrationActive,
} from "./pending-google-registration";

const mark = (overrides: Partial<{ uid: string; email: string; createdIdentity: boolean }> = {}) =>
  markPendingGoogleRegistration({
    uid: "uid-1",
    email: "brand.new@example.com",
    createdIdentity: true,
    ...overrides,
  });

afterEach(() => {
  window.localStorage.clear();
  // Module-level state: must be reset or it leaks between tests.
  setGoogleRegistrationActive(null);
});

describe("pending Google registration", () => {
  it("treats an unmarked session as not abandoned", () => {
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(false);
    expect(pendingGoogleRegistration()).toBeNull();
  });

  it("reports an attempt that was never confirmed as abandoned", () => {
    mark();
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(true);
  });

  it("records whether this attempt created the Firebase identity", () => {
    mark({ createdIdentity: true });
    expect(pendingGoogleRegistration()?.createdIdentity).toBe(true);

    mark({ createdIdentity: false });
    expect(pendingGoogleRegistration()?.createdIdentity).toBe(false);
  });

  // Only the SAME uid counts. A different account signing in on this device must not
  // inherit the marker, or it would be signed straight back out.
  it("does not apply to a different account", () => {
    mark();
    expect(isAbandonedGoogleRegistration("uid-2")).toBe(false);
    expect(isAbandonedGoogleRegistration(null)).toBe(false);
    expect(isAbandonedGoogleRegistration(undefined)).toBe(false);
    expect(isAbandonedGoogleRegistration("")).toBe(false);
  });

  it("stops reporting abandoned once provisioning succeeded", () => {
    mark();
    clearPendingGoogleRegistration();
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(false);
  });

  // The register form claims the uid while it is on screen. Without that claim the
  // marker would read as "abandoned" the instant the popup returned — the auth-state
  // handler runs right afterwards — and sign the visitor out mid-registration.
  it("is not abandoned while the form is still on screen", () => {
    mark();
    setGoogleRegistrationActive("uid-1");
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(false);

    // Releasing the claim (unmount) is what lets a leftover marker mean "walked away".
    setGoogleRegistrationActive(null);
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(true);
  });

  // A corrupt or partial marker must never be read as a match — that would sign out a
  // perfectly good session on every page load.
  it("ignores a malformed marker", () => {
    window.localStorage.setItem("localcooks-pending-google-registration", "not json");
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(false);

    window.localStorage.setItem("localcooks-pending-google-registration", JSON.stringify({ uid: "uid-1" }));
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(false);
  });

  // An older marker has no `createdIdentity`. Reading it as true would DELETE a
  // pre-existing identity, which is unrecoverable; signing out is recoverable.
  it("treats a missing createdIdentity flag as not ours to delete", () => {
    window.localStorage.setItem(
      "localcooks-pending-google-registration",
      JSON.stringify({ uid: "uid-1", startedAt: Date.now() }),
    );
    expect(isAbandonedGoogleRegistration("uid-1")).toBe(true);
    expect(pendingGoogleRegistration()?.createdIdentity).toBe(false);
  });

  it("survives a blocked storage backend without throwing", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("storage blocked");
    };
    try {
      expect(() => mark()).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
