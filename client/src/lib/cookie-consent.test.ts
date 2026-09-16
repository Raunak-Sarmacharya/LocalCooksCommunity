import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_CONSENT_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  consentCookieDomainAttr,
  getCookieConsent,
  hasOptionalCookieConsent,
  setCookieConsent,
} from "./cookie-consent";

function clearConsentCookie(): void {
  document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
}

function readConsentCookie(): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_CONSENT_STORAGE_KEY}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

describe("cookie consent", () => {
  beforeEach(() => {
    clearConsentCookie();
    window.localStorage.clear();
  });

  it("returns null before a visitor makes a choice", () => {
    expect(getCookieConsent()).toBeNull();
    expect(hasOptionalCookieConsent()).toBe(false);
  });

  it("persists acceptance to cookie and localStorage and announces the change", () => {
    const listener = vi.fn();
    window.addEventListener(COOKIE_CONSENT_EVENT, listener);

    setCookieConsent("accepted");

    expect(readConsentCookie()).toBe("accepted");
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("accepted");
    expect(hasOptionalCookieConsent()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(COOKIE_CONSENT_EVENT, listener);
  });

  it("persists rejection without enabling optional cookies", () => {
    setCookieConsent("rejected");

    expect(getCookieConsent()).toBe("rejected");
    expect(readConsentCookie()).toBe("rejected");
    expect(hasOptionalCookieConsent()).toBe(false);
  });

  it("reads a localStorage-only choice when the cookie is missing", () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");

    expect(getCookieConsent()).toBe("accepted");
    expect(hasOptionalCookieConsent()).toBe(true);
  });

  it("still returns the choice when the browser drops the cookie", () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")
      ?? Object.getOwnPropertyDescriptor(document, "cookie");

    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => {
        // Simulate public-suffix rejection (Domain=.localhost).
      },
    });

    try {
      setCookieConsent("accepted");
      expect(getCookieConsent()).toBe("accepted");
      expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("accepted");
    } finally {
      if (original) Object.defineProperty(document, "cookie", original);
    }
  });

  it("omits Domain on localhost hosts so browsers do not reject the cookie", () => {
    expect(consentCookieDomainAttr("localhost")).toBe("");
    expect(consentCookieDomainAttr("chef.localhost")).toBe("");
    expect(consentCookieDomainAttr("127.0.0.1")).toBe("");
    expect(consentCookieDomainAttr("preview.vercel.app")).toBe("");
  });

  it("scopes production cookies to .localcooks.ca across role subdomains", () => {
    expect(consentCookieDomainAttr("chef.localcooks.ca")).toBe("; Domain=.localcooks.ca");
    expect(consentCookieDomainAttr("dev-kitchen.localcooks.ca")).toBe("; Domain=.localcooks.ca");
    expect(consentCookieDomainAttr("admin.localcooks.ca")).toBe("; Domain=.localcooks.ca");
  });
});
