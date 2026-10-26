import type { Request, Response } from "express";
import { checkSignInCode, issueSignInCode } from "./sign-in-codes";

/**
 * Sign-up by code (owner, Oct 26): nothing is created until the emailed code proves the inbox, so a mistyped email never
 * holds someone's name and phone. Verify returns a session for a login created already verified; the client then
 * registers the app account (POST /api/firebase-register-user), which keeps its own checks on role, name and phone.
 * Mounted under /api/auth/email-code, so the auth rate limiter applies on top of the 5-codes-an-hour cap.
 */
type Query = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;
type FirebaseLogin = { uid: string; emailVerified: boolean };
export type SignUpCodeDeps = {
  query: Query;
  /** The app account for this email (username), if any. */
  accountByEmail: (email: string) => Promise<unknown | null>;
  accountByFirebaseUid: (uid: string) => Promise<unknown | null>;
  /** The same name and phone rules registration applies, checked before any code is sent (a taken phone shows at once). */
  checkProfile: (fullName: string, phone: string) => Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }>;
  sendCode: (email: string, code: string, locale: string | null) => Promise<boolean>;
  firebase: () => Promise<{
    getUserByEmail: (email: string) => Promise<FirebaseLogin>;
    updateUser: (uid: string, changes: { emailVerified: true }) => Promise<unknown>;
    createUser: (user: { email: string; emailVerified: true; displayName?: string }) => Promise<FirebaseLogin>;
    createCustomToken: (uid: string) => Promise<string>;
  }>;
  logError: (message: string, error: unknown) => void;
};

const emailFrom = (body: any) => {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  return /^\S+@\S+\.\S+$/.test(email) && email.length <= 254 ? email : null;
};

export function signUpCodeHandlers(deps: SignUpCodeDeps) {
  const send = async (req: Request, res: Response) => {
    const email = emailFrom(req.body);
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
      // The request page's email check already says whether an account exists, so this reveals nothing new.
      if (await deps.accountByEmail(email)) return res.status(409).json({ error: "account-exists" });
      const profile = await deps.checkProfile(
        typeof req.body?.fullName === "string" ? req.body.fullName : "", typeof req.body?.phone === "string" ? req.body.phone : "");
      if (!profile.ok) return res.status(profile.status).json(profile.body);
      const code = await issueSignInCode(deps.query, email);
      if (!code) return res.status(429).json({ error: "too-many-requests" });
      const locale = ["en-CA", "fr-CA", "uk"].includes(req.body?.locale) ? req.body.locale : null;
      if (!await deps.sendCode(email, code, locale)) throw new Error("Failed to send sign-up code email");
      return res.json({ success: true });
    } catch (error) {
      deps.logError("Error sending sign-up code:", error);
      return res.status(500).json({ error: "Failed to send code" });
    }
  };

  const verify = async (req: Request, res: Response) => {
    const email = emailFrom(req.body);
    const code = typeof req.body?.code === "string" ? req.body.code.replace(/\D/g, "") : "";
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 120) : "";
    if (!email || !code) return res.status(400).json({ error: "Enter the 6-digit code" });
    try {
      // Checked before the code, so an existing account's sign-in code is never spent here.
      if (await deps.accountByEmail(email)) return res.status(409).json({ error: "account-exists" });
      const result = await checkSignInCode(deps.query, email, code);
      if (result !== "ok") return res.status(401).json({ error: result === "expired" ? "code-expired" : "code-wrong" });
      const auth = await deps.firebase();
      // A login left by an attempt that never registered its app account (tab closed after the code) belongs to the
      // same inbox: reuse it. One that already has an app account must sign in instead.
      let login = await auth.getUserByEmail(email).catch(() => null);
      if (login) {
        if (await deps.accountByFirebaseUid(login.uid)) return res.status(409).json({ error: "account-exists" });
        if (!login.emailVerified) await auth.updateUser(login.uid, { emailVerified: true });
      } else {
        login = await auth.createUser({ email, emailVerified: true, ...(displayName ? { displayName } : {}) });
      }
      return res.json({ customToken: await auth.createCustomToken(login.uid) });
    } catch (error) {
      deps.logError("Error completing sign-up code:", error);
      return res.status(500).json({ error: "Couldn't create your account" });
    }
  };

  return { send, verify };
}
