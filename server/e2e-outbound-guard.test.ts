import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./dev-auth-bypass-gates", () => ({
  isDevAuthBypassEnabled: vi.fn(() => true),
  isLocalDevHost: vi.fn((host?: string) => !!host?.includes("localhost")),
  isValidDevAuthSecret: vi.fn((s?: string) => s === "test-secret"),
}));

describe("e2e-outbound-guard", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.E2E_SUPPRESS_OUTBOUND;
    process.env.NODE_ENV = "development";
  });

  it("is hard-off in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.E2E_SUPPRESS_OUTBOUND = "1";
    const { isE2eOutboundSuppressed } = await import("./e2e-outbound-guard");
    expect(isE2eOutboundSuppressed()).toBe(false);
  });

  it("env E2E_SUPPRESS_OUTBOUND=1 enables suppression in development", async () => {
    process.env.E2E_SUPPRESS_OUTBOUND = "1";
    const { isE2eOutboundSuppressed } = await import("./e2e-outbound-guard");
    expect(isE2eOutboundSuppressed()).toBe(true);
  });

  it("middleware enables suppression for valid header on localhost", async () => {
    const { e2eOutboundGuardMiddleware, isE2eOutboundSuppressed } = await import(
      "./e2e-outbound-guard"
    );
    const req = {
      headers: {
        host: "localhost:5001",
        "x-e2e-suppress-outbound": "test-secret",
      },
    } as any;
    await new Promise<void>((resolve) => {
      e2eOutboundGuardMiddleware(req, {} as any, () => {
        expect(isE2eOutboundSuppressed()).toBe(true);
        resolve();
      });
    });
  });
});
