import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { signUpCodeHandlers, type SignUpCodeDeps } from "./sign-up-codes";
import { issueSignInCode } from "./sign-in-codes";

// The real code store (migration 0107 in PGlite) with a fake Firebase: what can and can't create an account.
function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}
let db: PGlite;
let sent: { email: string; code: string; locale: string | null }[];
let accounts: Set<string>, accountUids: Set<string>, takenPhones: Set<string>;
let logins: Map<string, { uid: string; emailVerified: boolean }>;
let created: { email: string; emailVerified: true; displayName?: string }[];
let handlers: ReturnType<typeof signUpCodeHandlers>;
const call = async (handler: "send" | "verify", body: unknown) => { const res = response(); await handlers[handler]({ body } as any, res); return res; };

beforeEach(async () => {
  db = new PGlite();
  const migration = readFileSync("migrations/0107_sign_in_codes.sql", "utf8");
  await db.exec(migration); await db.exec(migration);
  sent = []; accounts = new Set(); accountUids = new Set(); takenPhones = new Set(); logins = new Map(); created = [];
  const deps: SignUpCodeDeps = {
    query: (text, params) => db.query(text, params as any[]),
    accountByEmail: async email => accounts.has(email) ? { email } : null,
    accountByFirebaseUid: async uid => accountUids.has(uid) ? { uid } : null,
    checkProfile: async (fullName, phone) => !fullName.trim() ? { ok: false, status: 400, body: { code: "PROFILE_DETAILS_REQUIRED" } }
      : takenPhones.has(phone) ? { ok: false, status: 409, body: { code: "PHONE_EXISTS" } } : { ok: true },
    sendCode: async (email, code, locale) => { sent.push({ email, code, locale }); return true; },
    firebase: async () => ({
      getUserByEmail: async email => { const login = logins.get(email); if (!login) throw new Error("auth/user-not-found"); return login; },
      updateUser: async (uid, changes) => { for (const login of logins.values()) if (login.uid === uid) Object.assign(login, changes); },
      createUser: async user => { created.push(user); const login = { uid: `uid-${created.length}`, emailVerified: true }; logins.set(user.email, login); return login; },
      createCustomToken: async uid => `token-for-${uid}`,
    }),
    logError: vi.fn(),
  };
  handlers = signUpCodeHandlers(deps);
});

describe("sign-up by code", () => {
  it("creates nothing until the code is right, then one login already verified, and the code works once", async () => {
    const res = await call("send", { email: " Sam@Example.com ", locale: "fr-CA", fullName: "Sam Rivera", phone: "7095550142" });
    expect(res.statusCode).toBe(200);
    expect(sent).toEqual([{ email: "sam@example.com", code: expect.stringMatching(/^\d{6}$/), locale: "fr-CA" }]);
    expect(created).toHaveLength(0);
    const code = sent[0].code, wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

    expect((await call("verify", { email: "sam@example.com", code: wrong })).body).toEqual({ error: "code-wrong" });
    expect(created).toHaveLength(0);
    const ok = await call("verify", { email: "sam@example.com", code, displayName: " Sam Rivera " });
    expect(ok.body).toEqual({ customToken: "token-for-uid-1" });
    expect(created).toEqual([{ email: "sam@example.com", emailVerified: true, displayName: "Sam Rivera" }]);
    expect((await call("verify", { email: "sam@example.com", code })).body).toEqual({ error: "code-expired" });
  });

  it("an email that already has an account gets no code, and its sign-in code is never spent here", async () => {
    accounts.add("chef@example.com");
    expect((await call("send", { email: "chef@example.com", fullName: "Sam Rivera", phone: "7095550142" })).statusCode).toBe(409);
    expect(sent).toHaveLength(0);
    const signInCode = (await issueSignInCode((text, params) => db.query(text, params as any[]), "chef@example.com"))!;
    expect((await call("verify", { email: "chef@example.com", code: signInCode })).statusCode).toBe(409);
    const left = await db.query<{ attempts: number }>("SELECT attempts FROM sign_in_codes WHERE email = 'chef@example.com'");
    expect(left.rows[0].attempts).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("reuses a login left by an unfinished sign-up, but never one that already has an app account", async () => {
    logins.set("left@example.com", { uid: "left-1", emailVerified: false });
    await call("send", { email: "left@example.com", fullName: "Sam Rivera", phone: "7095550142" });
    expect((await call("verify", { email: "left@example.com", code: sent[0].code })).body).toEqual({ customToken: "token-for-left-1" });
    expect(logins.get("left@example.com")!.emailVerified).toBe(true);
    expect(created).toHaveLength(0);

    logins.set("taken@example.com", { uid: "taken-1", emailVerified: true });
    accountUids.add("taken-1");
    await call("send", { email: "taken@example.com", fullName: "Sam Rivera", phone: "7095550142" });
    expect((await call("verify", { email: "taken@example.com", code: sent[1].code })).statusCode).toBe(409);
  });

  it("a taken phone or a missing name is refused before any code is sent", async () => {
    takenPhones.add("7095550177");
    expect((await call("send", { email: "new@example.com", fullName: "Sam", phone: "7095550177" })).body).toEqual({ code: "PHONE_EXISTS" });
    expect((await call("send", { email: "new@example.com", fullName: " ", phone: "7095550100" })).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM sign_in_codes")).rows).toHaveLength(0);
  });

  it("caps codes at 5 an hour per address and rejects malformed input", async () => {
    for (let i = 0; i < 5; i++) expect((await call("send", { email: "a@b.ca", fullName: "Sam Rivera", phone: "7095550142" })).statusCode).toBe(200);
    expect((await call("send", { email: "a@b.ca", fullName: "Sam Rivera", phone: "7095550142" })).body).toEqual({ error: "too-many-requests" });
    expect((await call("send", { email: "not-an-email", fullName: "Sam Rivera", phone: "7095550142" })).statusCode).toBe(400);
    expect((await call("verify", { email: "a@b.ca", code: "" })).statusCode).toBe(400);
  });
});
