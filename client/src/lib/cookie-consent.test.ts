import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_CONSENT_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  getCookieConsent,
  hasOptionalCookieConsent,
  setCookieConsent,
} from "./cookie-consent";

describe("cookie consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null before a visitor makes a choice", () => {
    expect(getCookieConsent()).toBeNull();
    expect(hasOptionalCookieConsent()).toBe(false);
  });

  it("persists acceptance and announces the change", () => {
    const listener = vi.fn();
    window.addEventListener(COOKIE_CONSENT_EVENT, listener);

    setCookieConsent("accepted");

    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("accepted");
    expect(hasOptionalCookieConsent()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(COOKIE_CONSENT_EVENT, listener);
  });

  it("persists rejection without enabling optional cookies", () => {
    setCookieConsent("rejected");

    expect(getCookieConsent()).toBe("rejected");
    expect(hasOptionalCookieConsent()).toBe(false);
  });
});
