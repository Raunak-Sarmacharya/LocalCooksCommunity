import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./firebase-setup", () => ({
  initializeFirebaseAdmin: vi.fn(() => ({ name: "mock-app" })),
}));

vi.mock("./email", () => ({
  getEmailLinkOrigin: vi.fn(() => "http://chef.localhost:5001"),
  getFirebaseContinueUrl: vi.fn((_type: string, path: string) => `http://localhost:5001${path}`),
}));

const generateSignInWithEmailLink = vi.fn(
  async () => "https://firebase.example/__/auth/action?mode=signIn&oobCode=abc"
);
const generateEmailVerificationLink = vi.fn(
  async () => "https://firebase.example/__/auth/action?mode=verifyEmail&oobCode=xyz"
);
const getUserByEmail = vi.fn();
const createUser = vi.fn(async () => ({ uid: "uid-new", emailVerified: false }));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    generateSignInWithEmailLink,
    generateEmailVerificationLink,
    getUserByEmail,
    createUser,
  }),
}));

vi.mock("./domains/users/user.service", () => ({
  userService: {
    getUserByUsername: vi.fn(async () => null),
  },
}));

describe("generateDevTestAuthLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByEmail.mockRejectedValue({ code: "auth/user-not-found" });
  });

  it("rewrites sign-in links to /email-action on chef subdomain", async () => {
    const { generateDevTestAuthLink } = await import("./dev-test-auth-link");
    const result = await generateDevTestAuthLink({
      email: "chef-e2e@localcooks.test",
      kind: "signIn",
      returnPath: "/kitchen-preview/my-new-busi",
    });
    expect(result.kind).toBe("signIn");
    expect(result.actionUrl).toMatch(/^http:\/\/chef\.localhost:5001\/email-action\?/);
    expect(result.actionUrl).toContain("mode=signIn");
    expect(generateSignInWithEmailLink).toHaveBeenCalled();
  });

  it("creates user and returns verify link for verifyEmail kind", async () => {
    const { generateDevTestAuthLink } = await import("./dev-test-auth-link");
    const result = await generateDevTestAuthLink({
      email: "new-chef@localcooks.test",
      kind: "verifyEmail",
    });
    expect(createUser).toHaveBeenCalled();
    expect(result.kind).toBe("verifyEmail");
    expect(result.actionUrl).toContain("/email-action");
  });
});
