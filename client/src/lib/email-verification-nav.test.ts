import { describe, expect, it } from "vitest";

import {
  EMAIL_FOCUS_PARAM,
  EMAIL_FOCUS_VALUE,
  emailVerificationHref,
  isEmailSectionFocused,
  withVerifiedMarker,
} from "./email-verification-nav";

describe("emailVerificationHref", () => {
  it("deep-links a chef to the email card on the chef dashboard", () => {
    expect(emailVerificationHref("chef")).toBe("/dashboard?view=profile&focus=email");
  });

  it("adds the account tab for a manager, whose profile is tabbed", () => {
    const href = emailVerificationHref("manager");
    expect(href.startsWith("/manager/dashboard?")).toBe(true);
    expect(href).toContain("tab=account");
    expect(href).toContain(`${EMAIL_FOCUS_PARAM}=${EMAIL_FOCUS_VALUE}`);
  });

  it("treats an unknown or absent role as a chef rather than inventing a route", () => {
    expect(emailVerificationHref(null)).toBe(emailVerificationHref("chef"));
    expect(emailVerificationHref(undefined)).toBe(emailVerificationHref("chef"));
  });
});

describe("isEmailSectionFocused", () => {
  it("detects the focus marker", () => {
    expect(isEmailSectionFocused(`?view=profile&${EMAIL_FOCUS_PARAM}=email`)).toBe(true);
    expect(isEmailSectionFocused("?view=profile")).toBe(false);
    expect(isEmailSectionFocused("")).toBe(false);
  });

  it("does not match a different focus target", () => {
    expect(isEmailSectionFocused("?focus=payments")).toBe(false);
  });
});

describe("withVerifiedMarker", () => {
  it("adds the marker the auth listener needs to run its post-verification sync", () => {
    // Without this, the signed-in dashboard redirect carries no `verified` param and
    // the post-verification sync silently stops happening.
    expect(withVerifiedMarker("/dashboard")).toBe("/dashboard?verified=true");
    expect(withVerifiedMarker("https://chef.localcooks.ca/dashboard")).toBe(
      "https://chef.localcooks.ca/dashboard?verified=true"
    );
  });

  it("appends with & when the URL already has a query", () => {
    expect(withVerifiedMarker("/dashboard?view=profile")).toBe(
      "/dashboard?view=profile&verified=true"
    );
  });

  it("is idempotent, so a URL that already carries the marker is untouched", () => {
    expect(withVerifiedMarker("/auth?verified=true")).toBe("/auth?verified=true");
    expect(withVerifiedMarker("/dashboard?view=profile&verified=true")).toBe(
      "/dashboard?view=profile&verified=true"
    );
  });

  it("does not mistake a lookalike param for the marker", () => {
    // `?unverified=true` must not be read as already-marked.
    expect(withVerifiedMarker("/dashboard?unverified=true")).toBe(
      "/dashboard?unverified=true&verified=true"
    );
  });
});
