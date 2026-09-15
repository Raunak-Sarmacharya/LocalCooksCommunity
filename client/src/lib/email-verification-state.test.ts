import { describe, expect, it } from "vitest";

import {
  canRequestVerificationLink,
  deriveEmailVerificationViewState,
  isAwaitingConfirmation,
  isBlockedState,
  resolveDisplayedEmail,
  type EmailVerificationViewState,
} from "./email-verification-state";

const base = {
  isLoading: false,
  isError: false,
  email: "maya@example.com" as string | null,
  pendingEmail: null as string | null,
  emailVerified: false,
};

describe("deriveEmailVerificationViewState", () => {
  it("shows loading before anything else, so the field never flashes blank", () => {
    expect(
      deriveEmailVerificationViewState({ ...base, isLoading: true, email: null })
    ).toBe("loading");
  });

  it("shows an error rather than implying the address is unverified", () => {
    // Rendering "unverified" from a failed read would be a lie that pushes the
    // user into a verification loop they do not need.
    expect(
      deriveEmailVerificationViewState({ ...base, isError: true, emailVerified: true })
    ).toBe("error");
  });

  it("reports a phone-first account with a carried-over address as unverified-idle", () => {
    expect(deriveEmailVerificationViewState(base)).toBe("unverified-idle");
  });

  it("reports an unverified account with a link outstanding as unverified-sent", () => {
    expect(
      deriveEmailVerificationViewState({ ...base, pendingEmail: "maya@example.com" })
    ).toBe("unverified-sent");
  });

  it("reports a confirmed account with nothing pending as verified", () => {
    expect(
      deriveEmailVerificationViewState({ ...base, emailVerified: true })
    ).toBe("verified");
  });

  it("treats a pending address on a confirmed account as a change, not a regression", () => {
    const state = deriveEmailVerificationViewState({
      ...base,
      emailVerified: true,
      pendingEmail: "maya@localkitchen.ca",
    });
    expect(state).toBe("verified-changing");
    // The guarantee: a change in flight never un-verifies the account.
    expect(isBlockedState(state)).toBe(false);
  });

  it("asks for an address when there is none on file at all", () => {
    expect(deriveEmailVerificationViewState({ ...base, email: null })).toBe("needs-address");
  });

  it("never reports a blocked state for a verified account", () => {
    const verified = deriveEmailVerificationViewState({ ...base, emailVerified: true });
    expect(isBlockedState(verified)).toBe(false);
  });
});

describe("isBlockedState", () => {
  it("blocks every unconfirmed state", () => {
    for (const state of ["needs-address", "unverified-idle", "unverified-sent"] as EmailVerificationViewState[]) {
      expect(isBlockedState(state)).toBe(true);
    }
  });

  it("does not block the confirmed states", () => {
    for (const state of ["verified", "verified-changing"] as EmailVerificationViewState[]) {
      expect(isBlockedState(state)).toBe(false);
    }
  });
});

describe("isAwaitingConfirmation", () => {
  it("is true exactly when a link is outstanding", () => {
    expect(isAwaitingConfirmation("unverified-sent")).toBe(true);
    expect(isAwaitingConfirmation("verified-changing")).toBe(true);
    expect(isAwaitingConfirmation("unverified-idle")).toBe(false);
    expect(isAwaitingConfirmation("verified")).toBe(false);
  });
});

describe("resolveDisplayedEmail", () => {
  it("prefers the pending address, because that is the one being asked about", () => {
    expect(
      resolveDisplayedEmail({ email: "old@example.com", pendingEmail: "new@example.com" })
    ).toBe("new@example.com");
  });

  it("falls back to the address on file", () => {
    expect(resolveDisplayedEmail({ email: "maya@example.com", pendingEmail: null })).toBe(
      "maya@example.com"
    );
  });

  it("falls back to the Firebase user so the field is never blank mid-load", () => {
    expect(resolveDisplayedEmail(undefined, "fallback@example.com")).toBe("fallback@example.com");
    expect(resolveDisplayedEmail({ email: null, pendingEmail: null }, "fallback@example.com")).toBe(
      "fallback@example.com"
    );
  });

  it("returns null when nothing is known", () => {
    expect(resolveDisplayedEmail(undefined)).toBeNull();
    expect(resolveDisplayedEmail({ email: null, pendingEmail: null })).toBeNull();
  });
});

describe("canRequestVerificationLink", () => {
  const ready = {
    state: "unverified-idle" as EmailVerificationViewState,
    cooldownSeconds: 0,
    displayedEmail: "maya@example.com" as string | null,
    isBusy: false,
  };

  it("allows a first send", () => {
    expect(canRequestVerificationLink(ready)).toBe(true);
  });

  it("allows a resend while a link is outstanding", () => {
    expect(canRequestVerificationLink({ ...ready, state: "unverified-sent" })).toBe(true);
  });

  it("blocks during the cooldown so the button never promises a rejected send", () => {
    expect(canRequestVerificationLink({ ...ready, cooldownSeconds: 42 })).toBe(false);
  });

  it("blocks while a request is already in flight", () => {
    expect(canRequestVerificationLink({ ...ready, isBusy: true })).toBe(false);
  });

  it("blocks when there is no address to send to", () => {
    expect(canRequestVerificationLink({ ...ready, displayedEmail: null })).toBe(false);
  });

  it("blocks once the address is confirmed", () => {
    expect(canRequestVerificationLink({ ...ready, state: "verified" })).toBe(false);
    expect(canRequestVerificationLink({ ...ready, state: "verified-changing" })).toBe(false);
  });
});
