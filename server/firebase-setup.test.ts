import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => {
  const adminApp = { name: "[DEFAULT]" };
  const tokenVerifierApp = { name: "firebase-token-verifier" };

  return {
    adminApp,
    tokenVerifierApp,
    cert: vi.fn(),
    getApps: vi.fn(),
    getAuth: vi.fn(),
    initializeApp: vi.fn(),
    verifyIdToken: vi.fn(),
  };
});

vi.mock("firebase-admin/app", () => ({
  cert: firebaseMocks.cert,
  getApps: firebaseMocks.getApps,
  initializeApp: firebaseMocks.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: firebaseMocks.getAuth,
}));

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const firebaseEnvKeys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "VITE_FIREBASE_PROJECT_ID",
] as const;

const originalFirebaseEnv = Object.fromEntries(
  firebaseEnvKeys.map((key) => [key, process.env[key]]),
);

describe("verifyFirebaseToken", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.FIREBASE_PROJECT_ID = "production-project";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-admin@example.test";
    process.env.FIREBASE_PRIVATE_KEY = "private\\nkey";
    process.env.VITE_FIREBASE_PROJECT_ID = "production-project";

    firebaseMocks.cert.mockReturnValue({ kind: "service-account" });
    firebaseMocks.getApps.mockReturnValue([]);
    firebaseMocks.initializeApp.mockImplementation((_options, name) => (
      name === "firebase-token-verifier"
        ? firebaseMocks.tokenVerifierApp
        : firebaseMocks.adminApp
    ));
    firebaseMocks.verifyIdToken.mockResolvedValue({ uid: "firebase-user" });
    firebaseMocks.getAuth.mockReturnValue({
      verifyIdToken: firebaseMocks.verifyIdToken,
    });
  });

  afterEach(() => {
    for (const key of firebaseEnvKeys) {
      const originalValue = originalFirebaseEnv[key];
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  });

  it("uses the credentialed Admin app when checking token revocation", async () => {
    const { verifyFirebaseToken } = await import("./firebase-setup");

    await expect(verifyFirebaseToken("fresh-token", true)).resolves.toMatchObject({
      uid: "firebase-user",
    });

    expect(firebaseMocks.cert).toHaveBeenCalledWith({
      projectId: "production-project",
      clientEmail: "firebase-admin@example.test",
      privateKey: "private\nkey",
    });
    expect(firebaseMocks.getAuth).toHaveBeenCalledWith(firebaseMocks.adminApp);
    expect(firebaseMocks.verifyIdToken).toHaveBeenCalledWith("fresh-token", true);
  });

  it("keeps signature-only checks on the lightweight verifier", async () => {
    const { verifyFirebaseToken } = await import("./firebase-setup");

    await expect(verifyFirebaseToken("fresh-token")).resolves.toMatchObject({
      uid: "firebase-user",
    });

    expect(firebaseMocks.cert).not.toHaveBeenCalled();
    expect(firebaseMocks.initializeApp).toHaveBeenCalledWith(
      { projectId: "production-project" },
      "firebase-token-verifier",
    );
    expect(firebaseMocks.getAuth).toHaveBeenCalledWith(firebaseMocks.tokenVerifierApp);
    expect(firebaseMocks.verifyIdToken).toHaveBeenCalledWith("fresh-token", false);
  });
});
