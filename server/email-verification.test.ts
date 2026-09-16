import { describe, expect, it } from "vitest";

import {
  buildEmailVerificationStatus,
  CLEARED_PENDING_EMAIL,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  hasRecentFirebaseAuth,
  RECENT_AUTH_WINDOW_SECONDS,
  generateVerificationToken,
  hashVerificationToken,
  isValidEmail,
  looksLikeEmail,
  normalizeEmail,
  resolveEmailLinkUserType,
  resolveTrustedLinkOrigin,
  resolveAuthEmailLink,
} from "./email-verification";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function statusUser(overrides: Record<string, unknown> = {}) {
  return {
    username: "maya.rodriguez@gmail.com",
    pendingEmail: null,
    pendingEmailSentAt: null,
    pendingEmailExpiresAt: null,
    emailVerifiedAt: null,
    ...overrides,
  } as never;
}

describe("normalizeEmail", () => {
  it("trims and lowercases so two spellings resolve to one address", () => {
    expect(normalizeEmail("  Maya.Rodriguez@Gmail.COM  ")).toBe("maya.rodriguez@gmail.com");
  });

  it("returns an empty string for non-string input", () => {
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(42)).toBe("");
    expect(normalizeEmail({ email: "a@b.com" })).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of [
      "maya@example.com",
      "maya.rodriguez+kitchen@sub.example.co.uk",
      "a@b.io",
    ]) {
      expect(isValidEmail(email)).toBe(true);
    }
  });

  it("rejects addresses that cannot be delivered to", () => {
    for (const email of ["", "maya", "maya@", "@example.com", "maya@example", "a b@example.com"]) {
      expect(isValidEmail(email)).toBe(false);
    }
  });

  it("rejects anything past the RFC length ceiling", () => {
    const local = "a".repeat(250);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it("distinguishes a real address from a legacy non-email username", () => {
    expect(looksLikeEmail("maya@example.com")).toBe(true);
    expect(looksLikeEmail("maya_the_manager")).toBe(false);
    expect(looksLikeEmail(null)).toBe(false);
    expect(looksLikeEmail(undefined)).toBe(false);
  });
});

describe("verification tokens", () => {
  it("issues a 64-character hex token", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateVerificationToken()));
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically but never stores the raw token", () => {
    const token = generateVerificationToken();
    const digest = hashVerificationToken(token);
    expect(digest).toBe(hashVerificationToken(token));
    expect(digest).not.toBe(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVerificationToken(generateVerificationToken())).not.toBe(digest);
  });
});

describe("buildEmailVerificationStatus", () => {
  it("carries the registration address for a phone-first account that never confirmed it", () => {
    const status = buildEmailVerificationStatus(statusUser(), false, NOW);
    expect(status.email).toBe("maya.rodriguez@gmail.com");
    expect(status.emailVerified).toBe(false);
    expect(status.emailVerifiedAt).toBeNull();
    expect(status.pendingEmail).toBeNull();
  });

  it("reports the confirmed address and its date once Firebase agrees", () => {
    const status = buildEmailVerificationStatus(
      statusUser({ emailVerifiedAt: new Date("2026-09-01T09:30:00.000Z") }),
      true,
      NOW
    );
    expect(status.emailVerified).toBe(true);
    expect(status.emailVerifiedAt).toBe("2026-09-01T09:30:00.000Z");
  });

  it("withholds the date while the address is unconfirmed, even if one is stored", () => {
    // A stale timestamp must not make an unverified account look verified.
    const status = buildEmailVerificationStatus(
      statusUser({ emailVerifiedAt: new Date("2026-09-01T09:30:00.000Z") }),
      false,
      NOW
    );
    expect(status.emailVerified).toBe(false);
    expect(status.emailVerifiedAt).toBeNull();
  });

  it("keeps the confirmed address visible while a change is in flight", () => {
    // The guarantee the whole loop rests on: the account always has a working
    // address, so the pending one is reported separately rather than replacing it.
    const status = buildEmailVerificationStatus(
      statusUser({
        username: "maya.rodriguez@gmail.com",
        pendingEmail: "maya@localkitchen.ca",
        pendingEmailSentAt: new Date(NOW),
      }),
      true,
      NOW
    );
    expect(status.email).toBe("maya.rodriguez@gmail.com");
    expect(status.pendingEmail).toBe("maya@localkitchen.ca");
    expect(status.emailVerified).toBe(true);
  });

  it("normalises the pending address it reports", () => {
    const status = buildEmailVerificationStatus(
      statusUser({ pendingEmail: "  Maya@LocalKitchen.CA " }),
      false,
      NOW
    );
    expect(status.pendingEmail).toBe("maya@localkitchen.ca");
  });

  it("counts the resend cooldown down from the moment a link was sent", () => {
    const sentAt = new Date(NOW - 20_000);
    const status = buildEmailVerificationStatus(
      statusUser({ pendingEmail: "maya@localkitchen.ca", pendingEmailSentAt: sentAt }),
      false,
      NOW
    );
    expect(status.resendAvailableInSeconds).toBe(40);
  });

  it("reports no wait once the cooldown has elapsed", () => {
    const sentAt = new Date(NOW - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - 1);
    const status = buildEmailVerificationStatus(
      statusUser({ pendingEmail: "maya@localkitchen.ca", pendingEmailSentAt: sentAt }),
      false,
      NOW
    );
    expect(status.resendAvailableInSeconds).toBe(0);
  });

  it("reports no wait when no link has been sent", () => {
    expect(buildEmailVerificationStatus(statusUser(), false, NOW).resendAvailableInSeconds).toBe(0);
  });

  it("returns null rather than a legacy username that is not an address", () => {
    const status = buildEmailVerificationStatus(statusUser({ username: "maya_the_manager" }), false, NOW);
    expect(status.email).toBeNull();
  });
});

describe("policy constants", () => {
  it("keeps links short-lived", () => {
    expect(EMAIL_VERIFICATION_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("clears every field of a pending request at once", () => {
    expect(Object.keys(CLEARED_PENDING_EMAIL).sort()).toEqual([
      "pendingEmail",
      "pendingEmailExpiresAt",
      "pendingEmailSentAt",
      "pendingEmailTokenHash",
    ]);
    expect(Object.values(CLEARED_PENDING_EMAIL).every((value) => value === null)).toBe(true);
  });

  it("routes the confirmation link to the right portal per role", () => {
    expect(resolveEmailLinkUserType("manager")).toBe("kitchen");
    expect(resolveEmailLinkUserType("admin")).toBe("admin");
    expect(resolveEmailLinkUserType("chef")).toBe("chef");
    expect(resolveEmailLinkUserType(null)).toBe("chef");
    expect(resolveEmailLinkUserType(undefined)).toBe("chef");
  });
});

describe("resolveTrustedLinkOrigin", () => {
  it("honours local development hosts, keeping the port", () => {
    // Without this, a locally generated link points at the staging deployment —
    // whose bundle may predate the token handling and answer "invalid link".
    expect(resolveTrustedLinkOrigin("http://chef.localhost:5001", "chef")).toBe(
      "http://chef.localhost:5001"
    );
    expect(resolveTrustedLinkOrigin("http://kitchen.localhost:5001", "manager")).toBe(
      "http://kitchen.localhost:5001"
    );
    expect(resolveTrustedLinkOrigin("http://localhost:5001", "chef")).toBe(
      "http://localhost:5001"
    );
    expect(resolveTrustedLinkOrigin("http://127.0.0.1:5001", "chef")).toBe(
      "http://127.0.0.1:5001"
    );
  });

  it("honours the production host for the matching role", () => {
    expect(resolveTrustedLinkOrigin("https://chef.localcooks.ca", "chef")).toBe(
      "https://chef.localcooks.ca"
    );
    expect(resolveTrustedLinkOrigin("https://kitchen.localcooks.ca", "manager")).toBe(
      "https://kitchen.localcooks.ca"
    );
    expect(resolveTrustedLinkOrigin("https://admin.localcooks.ca", "admin")).toBe(
      "https://admin.localcooks.ca"
    );
  });

  it("honours the staging host for the matching role", () => {
    expect(resolveTrustedLinkOrigin("https://dev-chef.localcooks.ca", "chef")).toBe(
      "https://dev-chef.localcooks.ca"
    );
    expect(resolveTrustedLinkOrigin("https://dev-kitchen.localcooks.ca", "manager")).toBe(
      "https://dev-kitchen.localcooks.ca"
    );
  });

  it("refuses a host belonging to a different role", () => {
    // A manager must never be handed a chef-hosted confirmation link.
    expect(resolveTrustedLinkOrigin("https://chef.localcooks.ca", "manager")).toBeNull();
    expect(resolveTrustedLinkOrigin("https://dev-kitchen.localcooks.ca", "chef")).toBeNull();
  });

  it("refuses the bare domain, which is not role-specific", () => {
    expect(resolveTrustedLinkOrigin("https://localcooks.ca", "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin("https://dev.localcooks.ca", "chef")).toBeNull();
  });

  it("refuses untrusted and lookalike hosts", () => {
    expect(resolveTrustedLinkOrigin("https://evil.com", "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin("https://chef.localcooks.ca.evil.com", "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin("https://notchef.localcooks.ca", "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin("https://chef.localcooks.ca.attacker.net", "chef")).toBeNull();
  });

  it("refuses a non-default port on a public host", () => {
    expect(resolveTrustedLinkOrigin("https://chef.localcooks.ca:8443", "chef")).toBeNull();
  });

  it("refuses non-http protocols", () => {
    for (const raw of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"]) {
      expect(resolveTrustedLinkOrigin(raw, "chef")).toBeNull();
    }
  });

  it("refuses non-string, malformed and oversized input", () => {
    expect(resolveTrustedLinkOrigin(undefined, "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin(null, "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin(42, "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin({ origin: "https://chef.localcooks.ca" }, "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin("not a url", "chef")).toBeNull();
    expect(resolveTrustedLinkOrigin(`https://chef.localcooks.ca/${"a".repeat(300)}`, "chef")).toBeNull();
  });
});

describe("resolveAuthEmailLink", () => {
  const PUBLIC_FALLBACK = "https://dev-chef.localcooks.ca";

  it("keeps a local-dev request on the caller's own origin, both URLs alike", () => {
    // The regression: the action URL resolved to the public host while the continue URL
    // resolved to BASE_URL, so one email carried two origins. That also put the link on a
    // different origin than the `emailForSignIn` the client had just stored, which is why
    // the user was asked to retype an address we had masked.
    const { linkOrigin, continueUrl } = resolveAuthEmailLink({
      callerOrigin: "http://chef.localhost:5001",
      role: "chef",
      redirectPath: "/dashboard",
      fallbackOrigin: PUBLIC_FALLBACK,
    });

    expect(linkOrigin).toBe("http://chef.localhost:5001");
    expect(continueUrl).toBe("http://chef.localhost:5001/dashboard");
    expect(new URL(continueUrl).origin).toBe(linkOrigin);
  });

  it("keeps a staging request on staging", () => {
    const { linkOrigin, continueUrl } = resolveAuthEmailLink({
      callerOrigin: "https://dev-chef.localcooks.ca",
      role: "chef",
      redirectPath: "/dashboard",
      fallbackOrigin: PUBLIC_FALLBACK,
    });

    expect(linkOrigin).toBe("https://dev-chef.localcooks.ca");
    expect(continueUrl).toBe("https://dev-chef.localcooks.ca/dashboard");
  });

  it("keeps a production request on production, for a manager's role host", () => {
    const { linkOrigin, continueUrl } = resolveAuthEmailLink({
      callerOrigin: "https://kitchen.localcooks.ca",
      role: "manager",
      redirectPath: "/manager/dashboard",
      fallbackOrigin: "https://dev-kitchen.localcooks.ca",
    });

    expect(linkOrigin).toBe("https://kitchen.localcooks.ca");
    expect(continueUrl).toBe("https://kitchen.localcooks.ca/manager/dashboard");
  });

  it("falls back to the public host but still agrees with itself", () => {
    // An untrusted or absent origin must not produce a half-local email.
    for (const callerOrigin of [undefined, "https://evil.com", "not a url", 42]) {
      const { linkOrigin, continueUrl } = resolveAuthEmailLink({
        callerOrigin,
        role: "chef",
        redirectPath: "/dashboard",
        fallbackOrigin: PUBLIC_FALLBACK,
      });

      expect(linkOrigin).toBe(PUBLIC_FALLBACK);
      expect(new URL(continueUrl).origin).toBe(linkOrigin);
    }
  });

  it("never lets the continue URL escape the link origin", () => {
    // A protocol-relative path would otherwise point at another host entirely.
    const { linkOrigin, continueUrl } = resolveAuthEmailLink({
      callerOrigin: "http://chef.localhost:5001",
      role: "chef",
      redirectPath: "/dashboard",
      fallbackOrigin: PUBLIC_FALLBACK,
    });

    expect(continueUrl.startsWith(linkOrigin)).toBe(true);
    expect(continueUrl).not.toContain("//evil.com");
  });

  it("refuses a caller origin belonging to a different role", () => {
    const { linkOrigin } = resolveAuthEmailLink({
      callerOrigin: "https://chef.localcooks.ca",
      role: "manager",
      redirectPath: "/manager/dashboard",
      fallbackOrigin: "https://dev-kitchen.localcooks.ca",
    });

    expect(linkOrigin).toBe("https://dev-kitchen.localcooks.ca");
  });
});

describe("hasRecentFirebaseAuth", () => {
  const now = 1_800_000_000_000;
  const nowSeconds = now / 1000;

  it("accepts a sign-in inside the window", () => {
    expect(hasRecentFirebaseAuth(nowSeconds - 299, now)).toBe(true);
    expect(hasRecentFirebaseAuth(nowSeconds, now)).toBe(true);
  });

  it("rejects a sign-in older than the window", () => {
    expect(hasRecentFirebaseAuth(nowSeconds - 301, now)).toBe(false);
    expect(hasRecentFirebaseAuth(nowSeconds - 60 * 60, now)).toBe(false);
  });

  it("tolerates mild clock skew, as the client helper does", () => {
    // Firebase mints auth_time; `now` comes from this process.
    expect(hasRecentFirebaseAuth(nowSeconds + 10, now)).toBe(true);
    expect(hasRecentFirebaseAuth(nowSeconds + 61, now)).toBe(false);
  });

  it("refuses anything that is not a usable timestamp", () => {
    for (const value of [undefined, null, "", "abc", {}, []]) {
      expect(hasRecentFirebaseAuth(value, now)).toBe(false);
    }
  });

  it("uses a five minute window, so a stale session must re-authenticate", () => {
    expect(RECENT_AUTH_WINDOW_SECONDS).toBe(300);
  });
});
