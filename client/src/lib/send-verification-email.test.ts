import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmailVerification, auth } = vi.hoisted(() => ({
  sendEmailVerification: vi.fn(),
  auth: {
    currentUser: {
      email: "chef@example.com",
    },
  },
}));

vi.mock("firebase/auth", () => ({ sendEmailVerification }));
vi.mock("@/lib/firebase", () => ({ auth }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/auth-intent", () => ({
  getAuthIntent: vi.fn(() => null),
  resolveVerificationReturnPath: vi.fn(() => null),
}));
vi.mock("@shared/subdomain-utils", () => ({
  getSubdomainOriginForEnvironment: vi.fn(() => "https://chef.localcooks.ca"),
}));

import { sendVerificationEmailWithFallback } from "./send-verification-email";

describe("sendVerificationEmailWithFallback", () => {
  beforeEach(() => {
    sendEmailVerification.mockReset();
    vi.unstubAllGlobals();
    auth.currentUser = { email: "chef@example.com" };
  });

  it("uses branded server SMTP first", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendVerificationEmailWithFallback({ email: "chef@example.com" })
    ).resolves.toEqual({ channel: "server" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  it("uses Firebase only after an immediate SMTP failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        error: "Email could not be delivered",
        code: "smtp_failed",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendVerificationEmailWithFallback({ email: "chef@example.com" })
    ).resolves.toEqual({ channel: "firebase" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sendEmailVerification).toHaveBeenCalledOnce();
  });
});
