/**
 * Dev-only auth bypass for TestSprite / local automated UI tests.
 * Creates (or reuses) a Firebase + Neon chef user and returns a Firebase custom token.
 *
 * Gates (all must pass) — see dev-auth-bypass-gates.ts:
 * 1. NODE_ENV !== 'production'
 * 2. DEV_AUTH_BYPASS_SECRET is set and matches
 * 3. Request Host is localhost / *.localhost / 127.0.0.1
 */
import { getAuth } from "firebase-admin/auth";
import { CURRENT_POLICY_VERSION } from "@shared/policy-config";
import { initializeFirebaseAdmin } from "./firebase-setup";
import { userService } from "./domains/users/user.service";
import { logger } from "./logger";
export {
  isDevAuthBypassEnabled,
  isLocalDevHost,
  isValidDevAuthSecret,
} from "./dev-auth-bypass-gates";

export type DevAuthRole = "chef" | "admin" | "manager";

function randomPassword(): string {
  return `DevBypass_${Date.now()}_${Math.random().toString(36).slice(2, 12)}!`;
}

export async function issueDevAuthCustomToken(opts: {
  email?: string;
  fresh?: boolean;
  role?: DevAuthRole;
}): Promise<{ customToken: string; email: string; uid: string; neonUserId: number }> {
  const app = initializeFirebaseAdmin();
  if (!app) {
    throw new Error("Firebase Admin not initialized — cannot issue custom token");
  }

  const role: DevAuthRole = opts.role ?? "chef";
  const email =
    opts.email?.trim().toLowerCase() ||
    (opts.fresh
      ? `testsprite-${role}-${Date.now()}@localcooks.test`
      : `testsprite-${role}@localcooks.test`);

  const auth = getAuth(app);
  let uid: string;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    if (!existing.emailVerified) {
      await auth.updateUser(uid, { emailVerified: true });
    }
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw err;
    const created = await auth.createUser({
      email,
      emailVerified: true,
      password: randomPassword(),
      displayName: `TestSprite ${role}`,
    });
    uid = created.uid;
    logger.info(`[dev-auth-bypass] created Firebase user ${email}`);
  }

  let neonUser = await userService.getUserByFirebaseUid(uid);
  if (!neonUser) {
    neonUser = await userService.getUserByUsername(email);
  }

  const termsPatch = {
    isVerified: true,
    termsAccepted: true,
    termsAcceptedAt: new Date(),
    termsVersion: CURRENT_POLICY_VERSION,
    has_seen_welcome: true,
    chefOnboardingCompleted: true,
    isChef: role === "chef",
    isManager: role === "manager",
    role,
    firebaseUid: uid,
  } as const;

  if (!neonUser) {
    neonUser = await userService.createUser({
      username: email,
      email,
      firebaseUid: uid,
      role,
      isVerified: true,
      has_seen_welcome: true,
    });
    await userService.updateUser(neonUser.id, { ...termsPatch });
    neonUser = (await userService.getUser(neonUser.id))!;
    logger.info(`[dev-auth-bypass] created Neon user id=${neonUser.id} email=${email}`);
  } else {
    await userService.updateUser(neonUser.id, { ...termsPatch });
    neonUser = (await userService.getUser(neonUser.id))!;
  }

  const customToken = await auth.createCustomToken(uid, {
    role,
    neonUserId: neonUser.id,
    devAuthBypass: true,
  });

  return { customToken, email, uid, neonUserId: neonUser.id };
}
