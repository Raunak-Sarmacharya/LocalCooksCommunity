import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLastAccountClearCookies,
  buildLastAccountCookie,
  clearLastAccount,
  getLastAccount,
  lastAccountCookieDomain,
  maskEmail,
  rememberLastAccount,
  LAST_ACCOUNT_COOKIE,
  LAST_ACCOUNT_KEY,
} from "./last-account";

function clearAllCookies() {
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

describe("last account record", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAllCookies();
  });

  it("scopes the cookie to the registrable domain so it survives a subdomain hop", () => {
    // The bug this exists for: /manager/* hard-redirects www -> kitchen.
    expect(lastAccountCookieDomain("kitchen.localcooks.ca")).toBe(".localcooks.ca");
    expect(lastAccountCookieDomain("www.localcooks.ca")).toBe(".localcooks.ca");
    expect(lastAccountCookieDomain("localcooks.ca")).toBe(".localcooks.ca");
    expect(lastAccountCookieDomain("dev-kitchen.localcooks.ca")).toBe(".localcooks.ca");
    expect(lastAccountCookieDomain("kitchen.localhost")).toBe(".localhost");
  });

  it("refuses to guess a parent it must not write to", () => {
    expect(lastAccountCookieDomain("localhost")).toBeNull();
    expect(lastAccountCookieDomain("127.0.0.1")).toBeNull();
    // Public suffix: a Domain attribute here is rejected by browsers.
    expect(lastAccountCookieDomain("local-cooks.vercel.app")).toBeNull();
    // Suffix spoofing must not be treated as our domain.
    expect(lastAccountCookieDomain("evil-localcooks.ca")).toBeNull();
    expect(lastAccountCookieDomain("localcooks.ca.evil.com")).toBeNull();
    expect(lastAccountCookieDomain("")).toBeNull();
  });

  it("emits the Domain attribute only where a shared parent exists", () => {
    const onSubdomain = buildLastAccountCookie("{}", {
      hostname: "www.localcooks.ca",
      secure: true,
    });
    expect(onSubdomain).toContain("Domain=.localcooks.ca");
    expect(onSubdomain).toContain("Path=/");
    expect(onSubdomain).toContain("SameSite=Lax");
    expect(onSubdomain).toContain("Secure");

    const onPreview = buildLastAccountCookie("{}", {
      hostname: "local-cooks.vercel.app",
      secure: true,
    });
    expect(onPreview).not.toContain("Domain=");

    const onHttp = buildLastAccountCookie("{}", {
      hostname: "localhost",
      secure: false,
    });
    expect(onHttp).not.toContain("Domain=");
    expect(onHttp).not.toContain("Secure");
  });

  it("expires every scope it could have been written with", () => {
    const expiries = buildLastAccountClearCookies();
    expect(expiries).toHaveLength(3);
    expect(expiries.some((c) => c.includes("Domain=.localcooks.ca"))).toBe(true);
    expect(expiries.some((c) => !c.includes("Domain="))).toBe(true);
    for (const c of expiries) expect(c).toContain("Max-Age=0");
  });

  it("masks the address the way the reference card shows it", () => {
    expect(maskEmail("raunaksarmacharya@gmail.com")).toBe("r****a@gmail.com");
    expect(maskEmail("manager@example.com")).toBe("m****r@example.com");
    // Too short to keep a trailing character without revealing it.
    expect(maskEmail("ab@example.com")).toBe("a****@example.com");
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("round-trips through the cookie and keeps the raw address out of the display field", async () => {
    await rememberLastAccount({
      email: "RaunakSarmacharya@Gmail.com",
      displayName: "Raunak Sarmacharya",
      method: "google",
    });

    const record = getLastAccount();
    expect(record?.email).toBe("raunaksarmacharya@gmail.com");
    expect(record?.maskedEmail).toBe("r****a@gmail.com");
    expect(record?.firstName).toBe("Raunak");
    expect(record?.method).toBe("google");
  });

  it("serves from the cookie when localStorage has been wiped", async () => {
    await rememberLastAccount({ email: "a@example.com", method: "google" });
    // Simulates arriving on the kitchen origin after the www -> kitchen hop.
    window.localStorage.clear();

    expect(getLastAccount()?.email).toBe("a@example.com");
  });

  it("forgets the account on request", async () => {
    await rememberLastAccount({ email: "a@example.com", method: "password" });
    expect(getLastAccount()).not.toBeNull();

    clearLastAccount();
    expect(getLastAccount()).toBeNull();
    expect(document.cookie).not.toContain(LAST_ACCOUNT_COOKIE);
    expect(window.localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull();
  });

  it("ignores an expired or malformed record rather than throwing", async () => {
    document.cookie = `${LAST_ACCOUNT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        email: "a@example.com",
        maskedEmail: "a****@example.com",
        firstName: null,
        method: "google",
        savedAt: Date.now() - 181 * 24 * 60 * 60 * 1000,
      }),
    )}; Path=/`;
    expect(getLastAccount()).toBeNull();

    document.cookie = `${LAST_ACCOUNT_COOKIE}=not-json; Path=/`;
    expect(getLastAccount()).toBeNull();

    document.cookie = `${LAST_ACCOUNT_COOKIE}=${encodeURIComponent(
      JSON.stringify({ email: "a@example.com", method: "carrier-pigeon", savedAt: Date.now() }),
    )}; Path=/`;
    expect(getLastAccount()).toBeNull();
  });
});
