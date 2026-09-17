/**
 * Daily kitchen-license expiry sweep.
 *
 * Reminds managers that their commercial kitchen license is approaching expiry
 * (30 days), about to lapse (7 days), or has lapsed — and nothing else. The listing
 * gate itself is derived at read time in `shared/kitchen-license.ts` and does not
 * depend on this job running, so a missed or failed sweep can never leave an expired
 * license silently accepting bookings. That separation is deliberate: the cron only
 * sends email, and email is the part that is allowed to fail.
 *
 * Cadence mirrors Airbnb's published rule for service/experience hosts ("we ask that
 * hosts reverify 30 days prior to expiration … if your document(s) expire, we'll
 * pause the listing and cancel bookings 7 days out").
 *
 * Idempotency is per (stage, location, expiry) via `email_logs.tracking_id`. The stage
 * stays constant for the whole window, so the first day inside a window sends and the
 * remaining days are suppressed. A renewal changes the expiry, which produces a new
 * tracking id and re-arms the reminders for the new document.
 *
 * Registered as BOTH GET and POST on purpose — see the note at the bottom of the file.
 */

import { Router, Request, Response } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { locations, users } from "@shared/schema";
import { daysUntilExpiry, licenseReminderStage } from "@shared/kitchen-license";
import { hasSentTrackingId } from "../services/email-log-service";
import { logger } from "../logger";

const router = Router();

const handleSweep = async (req: Request, res: Response) => {
  // Reject ALL requests when CRON_SECRET is missing, matching /api/detect-overstays.
  // An unset secret must not mean "no auth required".
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    logger.warn("[Cron] Unauthorized license expiry sweep attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
        kitchenLicenseUrl: locations.kitchenLicenseUrl,
        kitchenLicenseStatus: locations.kitchenLicenseStatus,
        kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
        kitchenLicensePendingUrl: locations.kitchenLicensePendingUrl,
        kitchenLicensePendingExpiry: locations.kitchenLicensePendingExpiry,
      })
      .from(locations)
      .where(
        and(
          isNotNull(locations.kitchenLicenseUrl),
          isNotNull(locations.kitchenLicenseExpiry),
          inArray(locations.kitchenLicenseStatus, ["approved", "pending_update"]),
        ),
      );

    const sent: Array<{ trackingId: string; stage: string }> = [];
    let alreadySent = 0;

    for (const row of rows) {
      const stage = licenseReminderStage(row);
      if (!stage) continue;

      const trackingId = `kitchen_license_${stage}_${row.id}_${row.kitchenLicenseExpiry}`;
      if (await hasSentTrackingId(trackingId)) {
        alreadySent += 1;
        continue;
      }

      const [manager] = row.managerId
        ? await db
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, row.managerId))
            .limit(1)
        : [];

      // Same recipient resolution as the approval/rejection emails.
      const managerEmail = row.notificationEmail || manager?.username;
      if (!managerEmail) {
        logger.warn(`[Cron] Location ${row.id} has no manager email — skipping reminder`);
        continue;
      }

      const { generateKitchenLicenseExpiringEmail, sendEmail } = await import("../email");

      const content = generateKitchenLicenseExpiringEmail({
        managerEmail,
        managerName: manager?.username || "Manager",
        locationName: row.name || "Kitchen Location",
        locationId: row.id,
        stage,
        expiryDate: row.kitchenLicenseExpiry as string,
        daysLeft: daysUntilExpiry(row.kitchenLicenseExpiry) ?? 0,
      });

      await sendEmail(content, {
        trackingId,
        emailType: "kitchen_license_expiry",
      });

      sent.push({ trackingId, stage });
      logger.info(
        `[Cron] License ${stage} reminder sent for location ${row.id} (${row.name})`,
      );
    }

    logger.info(
      `[Cron] License expiry sweep complete: ${rows.length} licensed locations checked, ` +
        `${sent.length} reminders sent, ${alreadySent} already sent.`,
    );

    res.json({
      ok: true,
      checked: rows.length,
      sent: sent.length,
      alreadySent,
      details: sent,
    });
  } catch (error) {
    logger.error("[Cron] License expiry sweep failed:", error);
    res.status(500).json({ error: "License expiry sweep failed" });
  }
};

// Vercel Cron invokes the path with an HTTP GET ("To trigger a cron job, Vercel makes
// an HTTP GET request to your project's production deployment URL"). /api/detect-overstays
// is registered POST-only, so its schedule cannot be firing. This route answers both so
// the schedule works whichever way it is invoked, and so it can still be triggered
// manually with a POST.
router.get("/detect-license-expiry", handleSweep);
router.post("/detect-license-expiry", handleSweep);

export default router;
