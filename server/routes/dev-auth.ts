import { Router, Request, Response } from "express";
import {
  isDevAuthBypassEnabled,
  isLocalDevHost,
  isValidDevAuthSecret,
  issueDevAuthCustomToken,
  type DevAuthRole,
} from "../dev-auth-bypass";
import {
  canMutateDevFixtures,
  DEV_FIXTURE_ALLOWED_LOCATION_IDS,
  DEV_FIXTURE_MANAGER_EMAIL,
} from "../dev-auth-bypass-gates";
import {
  grantFixtureManagerLocation,
  revokeFixtureManagerLocation,
} from "../dev-fixture-manager-location";
import {
  generateDevTestAuthLink,
  type DevTestAuthLinkKind,
} from "../dev-test-auth-link";
import {
  prepareJourneyDReady,
  prepareJourneyFullReady,
  prepareJourneyFullChunkAReady,
  prepareJourneyFullChunkBReady,
  prepareJourneyFullChunkCReady,
  prepareJourneyFullChunkDReady,
} from "../dev-journey-d-ready";
import { logger } from "../logger";

const router = Router();

function extractSecret(req: Request): string | undefined {
  return (
    (typeof req.body?.secret === "string" && req.body.secret) ||
    (typeof req.query?.secret === "string" && req.query.secret) ||
    (typeof req.headers["x-dev-auth-secret"] === "string" &&
      req.headers["x-dev-auth-secret"]) ||
    undefined
  );
}

/**
 * POST /api/dev/auth-bypass
 * Body: { secret: string, email?: string, fresh?: boolean, role?: 'chef'|'admin'|'manager' }
 * Returns: { customToken, email, uid }
 */
router.post("/auth-bypass", async (req: Request, res: Response) => {
  if (!isDevAuthBypassEnabled() || !isLocalDevHost(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const roleRaw = req.body?.role;
  const role: DevAuthRole =
    roleRaw === "admin" || roleRaw === "manager" || roleRaw === "chef"
      ? roleRaw
      : "chef";

  try {
    const result = await issueDevAuthCustomToken({
      email: typeof req.body?.email === "string" ? req.body.email : undefined,
      fresh: !!req.body?.fresh,
      role,
    });
    logger.info(`[dev-auth-bypass] issued token for ${result.email} role=${role}`);
    return res.json({
      customToken: result.customToken,
      email: result.email,
      uid: result.uid,
      neonUserId: result.neonUserId,
    });
  } catch (error: any) {
    logger.error("[dev-auth-bypass] failed:", error);
    return res.status(500).json({ error: error?.message || "Auth bypass failed" });
  }
});

/**
 * POST /api/dev/fixture-manager-location
 * Body: { secret, action: 'grant'|'revoke', locationId?: number, managerEmail?: string }
 * Least-privilege: only allowlisted location + TestSprite manager email.
 */
router.post("/fixture-manager-location", async (req: Request, res: Response) => {
  if (!canMutateDevFixtures(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const action = req.body?.action;
  if (action !== "grant" && action !== "revoke") {
    return res.status(400).json({ error: "action must be grant|revoke" });
  }

  const locationId = Number(
    req.body?.locationId ?? DEV_FIXTURE_ALLOWED_LOCATION_IDS[0]
  );
  if (!Number.isFinite(locationId)) {
    return res.status(400).json({ error: "Invalid locationId" });
  }

  try {
    if (action === "grant") {
      const result = await grantFixtureManagerLocation({
        locationId,
        managerEmail:
          typeof req.body?.managerEmail === "string"
            ? req.body.managerEmail
            : DEV_FIXTURE_MANAGER_EMAIL,
      });
      return res.json({ ok: true, action: "grant", ...result });
    }

    const result = await revokeFixtureManagerLocation({ locationId });
    return res.json({ ok: true, action: "revoke", ...result });
  } catch (error: any) {
    const status = error?.status || 500;
    logger.error("[dev-fixture-manager-location] failed:", error);
    return res.status(status).json({ error: error?.message || "Fixture failed" });
  }
});

/**
 * POST /api/dev/generate-test-auth-link
 * Body: { secret, email, kind: 'signIn'|'verifyEmail', returnPath?, role? }
 * Dev E2E only — returns Firebase action URL without sending email.
 */
router.post("/generate-test-auth-link", async (req: Request, res: Response) => {
  if (!isDevAuthBypassEnabled() || !isLocalDevHost(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const kindRaw = req.body?.kind as DevTestAuthLinkKind | undefined;
  const kind: DevTestAuthLinkKind =
    kindRaw === "verifyEmail" ? "verifyEmail" : "signIn";
  const returnPath =
    typeof req.body?.returnPath === "string" ? req.body.returnPath : undefined;
  const roleRaw = req.body?.role;
  const role =
    roleRaw === "admin" || roleRaw === "manager" || roleRaw === "chef"
      ? roleRaw
      : undefined;

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const result = await generateDevTestAuthLink({ email, kind, returnPath, role });
    logger.info(
      `[dev-test-auth-link] generated ${result.kind} link for ${result.email}`
    );
    return res.json({
      ok: true,
      email: result.email,
      kind: result.kind,
      actionUrl: result.actionUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Link generation failed";
    logger.error("[dev-test-auth-link] failed:", error);
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/dev/journey-d-ready
 * Query: secret=tsb1
 * Idempotent Journey D prep (browser-navigable). Fail-closed outside local+secret.
 */
router.get("/journey-d-ready", async (req: Request, res: Response) => {
  if (!canMutateDevFixtures(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await prepareJourneyDReady();
    return res.json(result);
  } catch (error: unknown) {
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const message =
      error instanceof Error ? error.message : "Journey D prep failed";
    logger.error("[journey-d-ready] failed:", error);
    return res.status(status).json({ ok: false, error: message });
  }
});

/**
 * GET /api/dev/journey-full-ready
 * Query: secret=tsb1
 * Prep apply→admin→Step2→manager→book (no tier-3 grant). Local+secret gated.
 * Alias of journey-full-chunk-a-ready (without chunk field).
 */
router.get("/journey-full-ready", async (req: Request, res: Response) => {
  if (!canMutateDevFixtures(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await prepareJourneyFullReady();
    return res.json(result);
  } catch (error: unknown) {
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const message =
      error instanceof Error ? error.message : "Journey Full prep failed";
    logger.error("[journey-full-ready] failed:", error);
    return res.status(status).json({ ok: false, error: message });
  }
});

async function handleFullChunkPrep(
  req: Request,
  res: Response,
  label: string,
  run: () => Promise<unknown>
) {
  if (!canMutateDevFixtures(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }
  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    return res.json(await run());
  } catch (error: unknown) {
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const message =
      error instanceof Error ? error.message : `${label} prep failed`;
    logger.error(`[${label}] failed:`, error);
    return res.status(status).json({ ok: false, error: message });
  }
}

/** GET /api/dev/journey-full-chunk-a-ready — reset for request-to-apply UI (TS-DF-FULL01-A). */
router.get("/journey-full-chunk-a-ready", (req, res) =>
  handleFullChunkPrep(req, res, "journey-full-chunk-a-ready", prepareJourneyFullChunkAReady)
);

/** GET /api/dev/journey-full-chunk-b-ready — admin Step1 approve → Step2 unlocked (before TS-DF-FULL01-B). */
router.get("/journey-full-chunk-b-ready", (req, res) =>
  handleFullChunkPrep(req, res, "journey-full-chunk-b-ready", prepareJourneyFullChunkBReady)
);

/** GET /api/dev/journey-full-chunk-c-ready — tier3 bookable + kitchen ready + revoke (before TS-DF-FULL01-C). */
router.get("/journey-full-chunk-c-ready", (req, res) =>
  handleFullChunkPrep(req, res, "journey-full-chunk-c-ready", prepareJourneyFullChunkCReady)
);

/** GET /api/dev/journey-full-chunk-d-ready — ensure confirmed+paid booking (before TS-DF-FULL01-D). */
router.get("/journey-full-chunk-d-ready", (req, res) =>
  handleFullChunkPrep(req, res, "journey-full-chunk-d-ready", prepareJourneyFullChunkDReady)
);

/**
 * GET /api/dev/e2e-auth-link
 * Query: secret, email, kind=signIn|verifyEmail, returnPath?, role?
 * Dev/TestSprite only — 302 redirect to Firebase action URL (no SMTP).
 * ponytail: browser-navigable wrapper for POST generate-test-auth-link.
 */
router.get("/e2e-auth-link", async (req: Request, res: Response) => {
  if (!isDevAuthBypassEnabled() || !isLocalDevHost(req.headers.host)) {
    return res.status(404).json({ error: "Not found" });
  }

  const secret = extractSecret(req);
  if (!isValidDevAuthSecret(secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  const kindRaw = req.query.kind as DevTestAuthLinkKind | undefined;
  const kind: DevTestAuthLinkKind =
    kindRaw === "verifyEmail" ? "verifyEmail" : "signIn";
  const returnPath =
    typeof req.query.returnPath === "string" ? req.query.returnPath : undefined;
  const roleRaw = req.query.role;
  const role =
    roleRaw === "admin" || roleRaw === "manager" || roleRaw === "chef"
      ? roleRaw
      : undefined;

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const result = await generateDevTestAuthLink({ email, kind, returnPath, role });
    logger.info(`[dev-test-auth-link] GET redirect ${result.kind} for ${result.email}`);
    return res.redirect(302, result.actionUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Link generation failed";
    logger.error("[dev-test-auth-link] GET failed:", error);
    return res.status(500).json({ error: message });
  }
});

export default router;
