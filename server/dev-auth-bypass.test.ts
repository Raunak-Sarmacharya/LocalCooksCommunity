import { describe, it, expect } from "vitest";
import {
  isDevAuthBypassEnabled,
  isLocalDevHost,
  isValidDevAuthSecret,
  canMutateDevFixtures,
  isAllowedFixtureLocationId,
  isAllowedFixtureManagerEmail,
  DEV_FIXTURE_MANAGER_EMAIL,
} from "./dev-auth-bypass-gates";

describe("dev-auth-bypass gates", () => {
  describe("isDevAuthBypassEnabled", () => {
    it("is hard-off in production even when secret is set", () => {
      const env = {
        ...process.env,
        NODE_ENV: "production",
        DEV_AUTH_BYPASS_SECRET: "test-secret",
      } as NodeJS.ProcessEnv;
      expect(isDevAuthBypassEnabled(env)).toBe(false);
    });

    it("is off in development without DEV_AUTH_BYPASS_SECRET", () => {
      const env = { ...process.env, NODE_ENV: "development" } as NodeJS.ProcessEnv;
      delete env.DEV_AUTH_BYPASS_SECRET;
      expect(isDevAuthBypassEnabled(env)).toBe(false);
    });

    it("is on in development when secret is set", () => {
      const env = {
        ...process.env,
        NODE_ENV: "development",
        DEV_AUTH_BYPASS_SECRET: "test-secret",
      } as NodeJS.ProcessEnv;
      expect(isDevAuthBypassEnabled(env)).toBe(true);
    });
  });

  describe("isValidDevAuthSecret", () => {
    const env = {
      ...process.env,
      DEV_AUTH_BYPASS_SECRET: "test-secret",
    } as NodeJS.ProcessEnv;

    it("accepts the configured secret", () => {
      expect(isValidDevAuthSecret("test-secret", env)).toBe(true);
    });

    it("rejects a wrong secret", () => {
      expect(isValidDevAuthSecret("wrong", env)).toBe(false);
    });

    it("rejects undefined secret", () => {
      expect(isValidDevAuthSecret(undefined, env)).toBe(false);
    });
  });

  describe("isLocalDevHost", () => {
    it("accepts chef.localhost, localhost, and 127.0.0.1", () => {
      expect(isLocalDevHost("chef.localhost:5001")).toBe(true);
      expect(isLocalDevHost("localhost:5001")).toBe(true);
      expect(isLocalDevHost("127.0.0.1:5001")).toBe(true);
    });

    it("rejects production-like hosts and missing Host", () => {
      expect(isLocalDevHost("chef.localcooks.ca")).toBe(false);
      expect(isLocalDevHost(undefined)).toBe(false);
    });
  });
});

describe("dev fixture manager-location gates", () => {
  it("production hard-off blocks fixture mutations even with secret", () => {
    const env = {
      ...process.env,
      NODE_ENV: "production",
      DEV_AUTH_BYPASS_SECRET: "tsb1",
    } as NodeJS.ProcessEnv;
    expect(canMutateDevFixtures("chef.localhost:5001", env)).toBe(false);
  });

  it("allows fixture mutations only on local host in development", () => {
    const env = {
      ...process.env,
      NODE_ENV: "development",
      DEV_AUTH_BYPASS_SECRET: "tsb1",
    } as NodeJS.ProcessEnv;
    expect(canMutateDevFixtures("kitchen.localhost:5001", env)).toBe(true);
    expect(canMutateDevFixtures("chef.localcooks.ca", env)).toBe(false);
  });

  it("allowlists only location 9", () => {
    expect(isAllowedFixtureLocationId(9)).toBe(true);
    expect(isAllowedFixtureLocationId(1)).toBe(false);
    expect(isAllowedFixtureLocationId(99)).toBe(false);
  });

  it("allowlists only the Journey C TestSprite manager emails", () => {
    expect(isAllowedFixtureManagerEmail(DEV_FIXTURE_MANAGER_EMAIL)).toBe(true);
    expect(isAllowedFixtureManagerEmail("tsmgr@localcooks.test")).toBe(true);
    expect(isAllowedFixtureManagerEmail("testsprite-journey-b-manager@localcooks.test")).toBe(
      false
    );
    expect(isAllowedFixtureManagerEmail("wrong@example.com")).toBe(false);
    expect(isAllowedFixtureManagerEmail(undefined)).toBe(false);
  });
});
