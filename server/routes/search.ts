import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { resolveLocale } from "../i18n";
import { logger } from "../logger";
import { searchGlobally } from "../services/global-search-service";
import type { SearchPortal } from "@shared/search";

const router = Router();
const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  portal: z.enum(["chef", "manager", "admin"]),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

function canSearchPortal(req: Request, portal: SearchPortal): boolean {
  const user = req.neonUser!;
  if (portal === "admin") return user.role === "admin";
  if (portal === "manager") return user.role === "admin" || user.role === "manager" || user.isManager === true;
  return user.role === "admin" || user.role === "chef" || user.isChef === true;
}

router.get("/", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Search requires a query of 2–100 characters and a valid portal." });
  }
  if (!canSearchPortal(req, parsed.data.portal)) {
    return res.status(403).json({ error: "You do not have access to search this portal." });
  }

  try {
    const results = await searchGlobally({
      query: parsed.data.q,
      portal: parsed.data.portal,
      userId: req.neonUser!.id,
      locale: resolveLocale(req.neonUser!.preferredLocale ?? req.locale),
      limit: parsed.data.limit,
    });
    res.json({ query: parsed.data.q, results });
  } catch (error) {
    logger.error("[Global search] Query failed", error);
    res.status(500).json({ error: "Search is temporarily unavailable." });
  }
});

export default router;
