/**
 * Kitchen Viewings / Viewing Scheduling API Routes
 * 
 * Enterprise-grade viewing scheduling system for kitchen facility viewings.
 * Supports self-service booking by chefs, manager availability configuration,
 * blackout management, and concurrency-safe slot booking with SELECT FOR UPDATE.
 * 
 * Uses existing platform infrastructure:
 * - America/St_Johns timezone via shared/timezone-utils.ts
 * - Unified notification service for in-app alerts
 * - SendGrid email system via server/email.ts
 */

import { Router, Request, Response } from "express";
import { eq, and, sql, desc, gte, lte, or, ne } from "drizzle-orm";
import { db } from "../db";
import { requireFirebaseAuthWithUser, requireManager, requireAdmin } from "../firebase-auth-middleware";
import { requireChef } from "./middleware";
import { logger } from "../logger";
import { errorResponse } from "../api-response";
import { notificationService } from "../services/notification.service";



import {
  generateTourRequestedChefEmail,
  generateTourRequestedLocalCooksEmail,
  generateTourRequestedManagerEmail,
  generateTourDeclinedByLocalCooksEmail,
  generateTourConfirmedEmail,
  generateTourRejectedChefEmail,
  sendEmail
} from "../email";
import {
  kitchenViewingSettings,
  kitchenViewingAvailability,
  kitchenViewingBlackouts,
  kitchenViewings,
  locations,
  kitchens,
  users,
  applications,
  insertKitchenViewingSchema,
  updateKitchenViewingStatusSchema,
  updateKitchenViewingSettingsSchema,
  insertKitchenViewingBlackoutSchema,
} from "@shared/schema";

import { getUserDisplayName } from "../utils/user-display";
import { TZDate } from "@date-fns/tz";
import { format, addMinutes, addDays, startOfDay, endOfDay, isBefore, isAfter, differenceInHours } from "date-fns";

const router = Router();

// ===================================
// HELPER: Slot Calculation Engine
// ===================================

interface TimeSlot {
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  scheduledAt: string; // ISO string (full datetime)
}

/**
 * Calculate available viewing time slots for a specific date.
 * 
 * Algorithm:
 * 1. Get the recurring weekly availability for that day of week
 * 2. Subtract any blackout periods that overlap
 * 3. Generate discrete slots based on duration + buffers
 * 4. Remove slots that overlap with existing booked viewings
 * 5. Remove slots that violate the advance notice rule
 */
async function calculateAvailableSlots(
  kitchenId: number,
  dateStr: string, // YYYY-MM-DD
  timezone: string = "America/St_Johns",
  prefetched?: {
    settings: any;
    availability: any[];
    blackouts: any[];
    existingViewings: any[];
  }
): Promise<TimeSlot[]> {
  // 1. Get viewing settings
  let settings = prefetched?.settings;
  if (!settings) {
    const [fetchedSettings] = await db
      .select()
      .from(kitchenViewingSettings)
      .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
      .limit(1);
    settings = fetchedSettings;
  }

  if (!settings || !settings.isActive) {
    return [];
  }

  // 2. Parse the target date and get day of week
  const [year, month, day] = dateStr.split("-").map(Number);
  const targetDate = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);
  const dayOfWeek = targetDate.getDay(); // 0-6, Sunday is 0

  // 3. Get recurring availability for this day of week
  let availabilityWindows;
  if (prefetched?.availability) {
    availabilityWindows = prefetched.availability.filter((a: any) => a.dayOfWeek === dayOfWeek && a.isAvailable);
  } else {
    availabilityWindows = await db
      .select()
      .from(kitchenViewingAvailability)
      .where(
        and(
          eq(kitchenViewingAvailability.kitchenId, kitchenId),
          eq(kitchenViewingAvailability.dayOfWeek, dayOfWeek),
          eq(kitchenViewingAvailability.isAvailable, true)
        )
      );
  }

  if (availabilityWindows.length === 0) {
    return [];
  }

  // 4. Check for blackouts on this date
  const dayStart = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);
  const dayEnd = new TZDate(year, month - 1, day, 23, 59, 59, 0, timezone);

  let blackouts = prefetched?.blackouts;
  if (!blackouts) {
    blackouts = await db
      .select()
      .from(kitchenViewingBlackouts)
      .where(
        and(
          eq(kitchenViewingBlackouts.kitchenId, kitchenId),
          lte(kitchenViewingBlackouts.startDate, dayEnd),
          gte(kitchenViewingBlackouts.endDate, dayStart)
        )
      );
  }

  // If any blackout fully covers this day, no slots available
  for (const blackout of blackouts) {
    if (
      isBefore(new Date(blackout.startDate), dayStart) &&
      isAfter(new Date(blackout.endDate), dayEnd)
    ) {
      return [];
    }
  }

  // 5. Get existing booked viewings for this date (exclude cancelled)
  let existingViewings;
  if (prefetched?.existingViewings) {
    existingViewings = prefetched.existingViewings.filter((v: any) => {
      const vStart = new Date(v.scheduledAt);
      return v.status !== 'cancelled' && vStart >= dayStart && vStart <= dayEnd;
    });
  } else {
    existingViewings = await db
      .select()
      .from(kitchenViewings)
      .where(
        and(
          eq(kitchenViewings.targetedKitchenId, kitchenId),
          gte(kitchenViewings.scheduledAt, dayStart),
          lte(kitchenViewings.scheduledAt, dayEnd),
          // Exclude cancelled viewings
          sql`${kitchenViewings.status} != 'cancelled'`
        )
      );
  }

  // 6. Generate all possible slots from availability windows
  const allSlots: TimeSlot[] = [];
  const duration = settings.defaultDurationMinutes;
  const bufferBefore = settings.bufferBeforeMinutes;
  const bufferAfter = settings.bufferAfterMinutes;
  const totalSlotSize = bufferBefore + duration + bufferAfter;

  const now = new TZDate(new Date(), timezone);

  for (const window of availabilityWindows) {
    const [startH, startM] = window.startTime.split(":").map(Number);
    const [endH, endM] = window.endTime.split(":").map(Number);

    let slotStart = new TZDate(year, month - 1, day, startH, startM, 0, 0, timezone);
    const windowEnd = new TZDate(year, month - 1, day, endH, endM, 0, 0, timezone);

    while (true) {
      const actualTourStart = addMinutes(slotStart, bufferBefore);
      const actualTourEnd = addMinutes(actualTourStart, duration);
      const slotEnd = addMinutes(actualTourEnd, bufferAfter);

      // Stop if slot extends past window end
      if (isAfter(slotEnd, windowEnd)) {
        break;
      }

      // Check advance notice
      const hoursUntil = differenceInHours(actualTourStart, now);
      if (hoursUntil < settings.advanceNoticeHours) {
        slotStart = slotEnd; // Move to next slot position
        continue;
      }

      // Check if slot conflicts with blackout periods
      let blackedOut = false;
      for (const blackout of blackouts) {
        const bStart = new Date(blackout.startDate);
        const bEnd = new Date(blackout.endDate);
        if (isBefore(actualTourStart, bEnd) && isAfter(actualTourEnd, bStart)) {
          blackedOut = true;
          break;
        }
      }

      if (blackedOut) {
        slotStart = slotEnd;
        continue;
      }

      // Check if slot conflicts with existing viewings
      let conflicted = false;
      for (const viewing of existingViewings) {
        const viewingStart = new Date(viewing.scheduledAt);
        const viewingEnd = addMinutes(viewingStart, viewing.durationMinutes);
        // Include buffers in conflict check
        const viewingBlockStart = addMinutes(viewingStart, -bufferBefore);
        const viewingBlockEnd = addMinutes(viewingEnd, bufferAfter);

        if (isBefore(actualTourStart, viewingBlockEnd) && isAfter(actualTourEnd, viewingBlockStart)) {
          conflicted = true;
          break;
        }
      }

      if (conflicted) {
        slotStart = slotEnd;
        continue;
      }

      // Slot is valid — add it
      allSlots.push({
        startTime: format(actualTourStart, "HH:mm"),
        endTime: format(actualTourEnd, "HH:mm"),
        scheduledAt: actualTourStart.toISOString(),
      });

      slotStart = slotEnd; // Move to next slot position
    }
  }

  return allSlots;
}

// ===================================
// PUBLIC ROUTES: Availability Info
// ===================================

/**
 * GET /api/viewings/calendar-availability/:kitchenId
 * Get calendar metadata (availability by day of week & blackouts) for a kitchen.
 * Used by chefs to visually disable unavailable dates on the calendar picker.
 */
router.get(
  "/calendar-availability/:kitchenId",
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);

      const [kitchenContext] = await db
        .select({ timezone: locations.timezone })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchens.id, kitchenId))
        .limit(1);

      if (!kitchenContext) {
        return res.status(404).json({ error: "Kitchen not found" });
      }

      // Check if location has viewings enabled
      const [settings] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      if (!settings || !settings.isActive) {
        return res.json({ settings: null, availability: [], blackouts: [] });
      }

      const availability = await db
        .select()
        .from(kitchenViewingAvailability)
        .where(eq(kitchenViewingAvailability.kitchenId, kitchenId));

      const blackouts = await db
        .select()
        .from(kitchenViewingBlackouts)
        .where(
          and(
            eq(kitchenViewingBlackouts.kitchenId, kitchenId),
            gte(kitchenViewingBlackouts.endDate, new Date()) // only fetch future/ongoing
          )
        );

      // Also get existing viewings for the next maxAdvanceBookingDays to compute fullyBookedDates
      const maxDays = settings.maxAdvanceBookingDays || 30;
      const today = new Date();
      const endWindow = new Date(today);
      endWindow.setDate(endWindow.getDate() + maxDays);
      
      const existingViewings = await db
        .select()
        .from(kitchenViewings)
        .where(
          and(
            eq(kitchenViewings.targetedKitchenId, kitchenId),
            gte(kitchenViewings.scheduledAt, today),
            lte(kitchenViewings.scheduledAt, endWindow),
            sql`${kitchenViewings.status} != 'cancelled'`
          )
        );

      // Compute fullyBookedDates
      const fullyBookedDates: string[] = [];
      const { format } = await import('date-fns');
      const prefetched = { settings, availability, blackouts, existingViewings };
      
      const timezone = kitchenContext.timezone || "America/St_Johns";
      for (let i = 0; i <= maxDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = format(d, "yyyy-MM-dd");
        const slots = await calculateAvailableSlots(kitchenId, dateStr, timezone, prefetched);
        if (slots.length === 0) {
          fullyBookedDates.push(dateStr);
        }
      }

      res.json({
        settings: {
          maxAdvanceBookingDays: settings.maxAdvanceBookingDays,
        },
        availability,
        blackouts,
        fullyBookedDates,
      });
    } catch (error) {
      logger.error("Error fetching calendar availability:", error);
      return errorResponse(res, error);
    }
  }
);

// ===================================
// MANAGER ROUTES: Viewing Settings
// ===================================

/**
 * GET /api/viewings/settings/:kitchenId
 * Get viewing settings for a kitchen
 */
router.get(
  "/settings/:kitchenId",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const managerId = req.neonUser!.id;

      // Verify the kitchen belongs to a location owned by this manager.
      const [kitchen] = await db
        .select({ id: kitchens.id })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, managerId)))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found or access denied" });
      }

      const [settings] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      const availability = await db
        .select()
        .from(kitchenViewingAvailability)
        .where(eq(kitchenViewingAvailability.kitchenId, kitchenId));

      const blackoutsList = await db
        .select()
        .from(kitchenViewingBlackouts)
        .where(
          and(
            eq(kitchenViewingBlackouts.kitchenId, kitchenId),
            gte(kitchenViewingBlackouts.endDate, new Date()) // Only future blackouts
          )
        );

      res.json({
        settings: settings || null,
        availability,
        blackouts: blackoutsList,
      });
    } catch (error) {
      logger.error("Error fetching viewing settings:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * PUT /api/viewings/settings/:kitchenId
 * Create or update viewing settings for a kitchen
 */
router.put(
  "/settings/:kitchenId",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const managerId = req.neonUser!.id;

      const [kitchen] = await db
        .select({ id: kitchens.id })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, managerId)))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found or access denied" });
      }

      const parsed = updateKitchenViewingSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }

      // Check if settings exist
      const [existing] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      let result;
      if (existing) {
        // Update existing
        [result] = await db
          .update(kitchenViewingSettings)
          .set({
            ...parsed.data,
            updatedAt: new Date(),
          })
          .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
          .returning();
      } else {
        // Create new
        [result] = await db
          .insert(kitchenViewingSettings)
          .values({
            kitchenId,
            ...parsed.data,
          })
          .returning();
      }

      logger.info(`[Viewings] Settings ${existing ? "updated" : "created"} for kitchen ${kitchenId} by manager ${managerId}`);
      res.json(result);
    } catch (error) {
      logger.error("Error updating viewing settings:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * PUT /api/viewings/availability/:kitchenId
 * Replace all weekly availability for a kitchen (batch update)
 */
router.put(
  "/availability/:kitchenId",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const managerId = req.neonUser!.id;

      const [kitchen] = await db
        .select({ id: kitchens.id })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, managerId)))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found or access denied" });
      }

      const { slots } = req.body;
      if (!Array.isArray(slots)) {
        return res.status(400).json({ error: "slots must be an array" });
      }

      // Delete existing and insert new in a transaction
      await db.transaction(async (tx) => {
        await tx
          .delete(kitchenViewingAvailability)
          .where(eq(kitchenViewingAvailability.kitchenId, kitchenId));

        if (slots.length > 0) {
          await tx.insert(kitchenViewingAvailability).values(
            slots.map((slot: any) => ({
              kitchenId,
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isAvailable: slot.isAvailable ?? true,
            }))
          );
        }
      });

      // Fetch the updated list
      const updated = await db
        .select()
        .from(kitchenViewingAvailability)
        .where(eq(kitchenViewingAvailability.kitchenId, kitchenId));

      logger.info(`[Viewings] Availability updated for kitchen ${kitchenId} by manager ${managerId}: ${slots.length} slots`);
      res.json(updated);
    } catch (error) {
      logger.error("Error updating viewing availability:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * POST /api/viewings/blackouts/:kitchenId
 * Add a blackout period for a kitchen
 */
router.post(
  "/blackouts/:kitchenId",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const managerId = req.neonUser!.id;

      const [kitchen] = await db
        .select({ id: kitchens.id, name: kitchens.name, locationId: kitchens.locationId })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, managerId)))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found or access denied" });
      }

      const parsed = insertKitchenViewingBlackoutSchema.safeParse({
        ...req.body,
        kitchenId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }

      const [result] = await db
        .insert(kitchenViewingBlackouts)
        .values({
          kitchenId,
          startDate: new Date(parsed.data.startDate as string),
          endDate: new Date(parsed.data.endDate as string),
          reason: parsed.data.reason,
        })
        .returning();

      // Auto-cancel any existing viewings in the blackout period
      const conflicting = await db
        .select()
        .from(kitchenViewings)
        .where(
          and(
            eq(kitchenViewings.targetedKitchenId, kitchenId),
            gte(kitchenViewings.scheduledAt, new Date(parsed.data.startDate as string)),
            lte(kitchenViewings.scheduledAt, new Date(parsed.data.endDate as string)),
            sql`${kitchenViewings.status} NOT IN ('cancelled', 'completed', 'no_show')`
          )
        );

      if (conflicting.length > 0) {
        for (const viewing of conflicting) {
          await db
            .update(kitchenViewings)
            .set({
              status: "cancelled",
              cancelledBy: "manager",
              cancellationReason: `Blackout: ${parsed.data.reason || "Manager unavailable"}`,
              cancelledAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(kitchenViewings.id, viewing.id));

          // Notify chef about cancellation
          try {
            await notificationService.createForChef({
              chefId: viewing.chefId,
              type: "booking_cancelled",
              priority: "high",
              title: "Kitchen Viewing Cancelled",
              message: `Your scheduled viewing of ${kitchen.name} has been cancelled by the manager. Reason: ${parsed.data.reason || "Schedule change"}. Please book a new time.`,
              metadata: { viewingId: viewing.id, locationId: kitchen.locationId, kitchenId },
              actionUrl: `/dashboard?view=viewings`,
              actionLabel: "Reschedule",
            });
          } catch (e) {
            logger.error("[Viewings] Failed to notify chef of blackout cancellation:", e);
          }
        }
        logger.info(`[Viewings] Auto-cancelled ${conflicting.length} viewings due to blackout for kitchen ${kitchenId}`);
      }

      res.json(result);
    } catch (error) {
      logger.error("Error creating viewing blackout:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * DELETE /api/viewings/blackouts/:blackoutId
 * Remove a blackout period
 */
router.delete(
  "/blackouts/:blackoutId",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const blackoutId = parseInt(req.params.blackoutId);
      const managerId = req.neonUser!.id;

      // Verify blackout belongs to a kitchen at a location this manager owns.
      const result = await db.execute(sql`
        DELETE FROM kitchen_viewing_blackouts
        WHERE id = ${blackoutId}
          AND kitchen_id IN (
            SELECT k.id
            FROM kitchens k
            JOIN locations l ON l.id = k.location_id
            WHERE l.manager_id = ${managerId}
          )
      `);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Blackout not found or access denied" });
      }

      res.json({ deleted: true });
    } catch (error) {
      logger.error("Error deleting viewing blackout:", error);
      return errorResponse(res, error);
    }
  }
);

// ===================================
// PUBLIC / CHEF ROUTES: Slot Discovery & Booking
// ===================================

/**
 * GET /api/viewings/available-slots/:kitchenId
 * Get available viewing time slots for a specific date
 * Accessible by authenticated chefs
 */
router.get(
  "/available-slots/:kitchenId",
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const dateStr = req.query.date as string; // YYYY-MM-DD

      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: "date query parameter is required in YYYY-MM-DD format" });
      }

      const [kitchen] = await db
        .select({
          name: kitchens.name,
          locationName: locations.name,
          timezone: locations.timezone,
        })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchens.id, kitchenId))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found" });
      }

      const timezone = kitchen.timezone || "America/St_Johns";
      const slots = await calculateAvailableSlots(kitchenId, dateStr, timezone);

      // Also get settings for the frontend (duration, max booking days, etc.)
      const [settings] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      res.json({
        kitchenName: kitchen.name,
        locationName: kitchen.locationName,
        date: dateStr,
        timezone,
        slots,
        settings: settings
          ? {
              defaultDurationMinutes: settings.defaultDurationMinutes,
              maxAdvanceBookingDays: settings.maxAdvanceBookingDays,
              advanceNoticeHours: settings.advanceNoticeHours,
              isActive: settings.isActive,
            }
          : null,
      });
    } catch (error) {
      logger.error("Error calculating available slots:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * POST /api/viewings/book
 * Book a kitchen viewing (concurrency-safe with SELECT FOR UPDATE)
 * Chef-only endpoint
 */
router.post(
  "/book",
  requireFirebaseAuthWithUser,
  requireChef,
  async (req: Request, res: Response) => {
    try {
      const chefId = req.neonUser!.id;

      if (req.firebaseUser?.email_verified !== true) {
        return res.status(403).json({
          error: "Please verify your email before requesting a kitchen tour.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

      const parsed = insertKitchenViewingSchema.safeParse({
        ...req.body,
        chefId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid booking data", details: parsed.error.flatten() });
      }

      const { locationId, targetedKitchenId, scheduledAt, durationMinutes, chefNotes, intakeData } = parsed.data;

      // The kitchen is authoritative; location remains on the viewing for ownership/reporting.
      const [kitchen] = await db
        .select({
          id: kitchens.id,
          name: kitchens.name,
          locationId: kitchens.locationId,
          locationName: locations.name,
          timezone: locations.timezone,
          managerId: locations.managerId,
        })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, targetedKitchenId), eq(kitchens.locationId, locationId)))
        .limit(1);

      if (!kitchen) {
        return res.status(400).json({ error: "Kitchen does not belong to this location" });
      }

      if (!kitchen.managerId) {
        return res.status(409).json({ error: "Tours are unavailable until a kitchen manager is assigned" });
      }

      const timezone = kitchen.timezone || "America/St_Johns";

      // Get settings
      const [settings] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, targetedKitchenId))
        .limit(1);

      if (!settings || !settings.isActive) {
        return res.status(400).json({ error: "Tours are not currently available for this kitchen" });
      }

      const tourDuration = durationMinutes || settings.defaultDurationMinutes;
      const scheduledDate = new Date(scheduledAt as string);

      const [existingActiveTour] = await db
        .select({ id: kitchenViewings.id })
        .from(kitchenViewings)
        .where(
          and(
            eq(kitchenViewings.chefId, chefId),
            eq(kitchenViewings.targetedKitchenId, targetedKitchenId),
            sql`${kitchenViewings.status} IN ('pending_local_cooks', 'pending', 'confirmed')`
          )
        )
        .limit(1);

      if (existingActiveTour) {
        return res.status(409).json({
          error:
            "You already have an active tour request for this kitchen. Check My Tours for status.",
          code: "ACTIVE_TOUR_EXISTS",
        });
      }

      // Server-side advance notice validation
      const now = new TZDate(new Date(), timezone);
      const hoursUntil = differenceInHours(scheduledDate, now);
      if (hoursUntil < settings.advanceNoticeHours) {
        return res.status(400).json({
          error: `Viewings must be booked at least ${settings.advanceNoticeHours} hours in advance`,
        });
      }

      // CONCURRENCY-SAFE BOOKING: Use a transaction with conflict detection
      // We check for overlapping viewings within the transaction to prevent double-booking
      let newViewing: any;

      await db.transaction(async (tx) => {
        // Check for conflicting viewings within the transaction
        const tourStart = scheduledDate;
        const tourEnd = addMinutes(scheduledDate, tourDuration);
        const bufferStart = addMinutes(tourStart, -settings.bufferBeforeMinutes);
        const bufferEnd = addMinutes(tourEnd, settings.bufferAfterMinutes);

        const conflicts = await tx
          .select()
          .from(kitchenViewings)
          .where(
            and(
              eq(kitchenViewings.targetedKitchenId, targetedKitchenId),
              sql`${kitchenViewings.status} NOT IN ('cancelled', 'no_show')`,
              // Overlap check: new slot [bufferStart, bufferEnd] overlaps with existing [scheduledAt, scheduledAt+duration]
              sql`${kitchenViewings.scheduledAt} < ${bufferEnd.toISOString()}::timestamp`,
              sql`(${kitchenViewings.scheduledAt} + (${kitchenViewings.durationMinutes} || ' minutes')::interval) > ${bufferStart.toISOString()}::timestamp`
            )
          );

        if (conflicts.length > 0) {
          throw new Error("SLOT_TAKEN");
        }

        // No conflicts — insert the viewing
        [newViewing] = await tx
          .insert(kitchenViewings)
          .values({
            locationId,
            targetedKitchenId,
            chefId,
            managerId: kitchen.managerId,
            status: "pending_local_cooks",
            scheduledAt: scheduledDate,
            durationMinutes: tourDuration,
            chefNotes: chefNotes || null,
            intakeData: intakeData || {},
          })
          .returning();
      });

      // Get chef name for notifications
      const chefName = await getUserDisplayName(chefId, 'chef');

      // Local Cooks screens every request before the manager can see or act on it.
      try {
        const admins = await db.select({ id: users.id, username: users.username })
          .from(users)
          .where(eq(users.role, "admin"));
        for (const admin of admins) {
          await notificationService.createForManager({
            managerId: admin.id,
            locationId,
            type: "booking_new",
            priority: "high",
            title: "Tour request awaiting Local Cooks review",
            message: `${chefName} requested a tour of ${kitchen.name} at ${kitchen.locationName}.`,
            metadata: { viewingId: newViewing.id, kitchenId: targetedKitchenId, chefId },
            actionUrl: "/admin?section=tour-requests",
            actionLabel: "Review tour request",
          });
          if (admin.username) {
            await sendEmail(generateTourRequestedLocalCooksEmail({
              recipientEmail: admin.username,
              chefName,
              kitchenName: kitchen.name,
              tourDate: scheduledDate,
              startTime: format(scheduledDate, "h:mm a"),
              timezone,
            })).catch(err => logger.error("Failed to send Local Cooks tour review email", err));
          }
        }
      } catch (e) {
        logger.error("[Viewings] Failed to notify Local Cooks:", e);
      }

      // Notify chef (pending)
      try {
        await notificationService.createForChef({
          chefId,
          type: "booking_confirmed", // Reusing this type, but logically it's a request receipt
          priority: "normal",
          title: "Kitchen Viewing Request Received",
          message: `Your viewing request for ${kitchen.name} at ${kitchen.locationName} on ${format(scheduledDate, "MMM d, yyyy")} at ${format(scheduledDate, "h:mm a")} has been sent to Local Cooks for review.`,
          metadata: {
            viewingId: newViewing.id,
            locationId,
            kitchenId: targetedKitchenId,
            locationName: kitchen.locationName,
            scheduledAt: scheduledDate.toISOString(),
          },
          actionUrl: `/dashboard?view=viewings`,
          actionLabel: "View Details",
        });
        
        const [chef] = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, chefId))
          .limit(1);
        const chefEmail = chef?.username;
        if (chefEmail) {
          const emailContent = generateTourRequestedChefEmail({
            chefEmail,
            chefName,
            kitchenName: kitchen.name,
            tourDate: scheduledDate,
            startTime: format(scheduledDate, "h:mm a"),
            timezone
          });
          await sendEmail(emailContent).catch(err => logger.error("Failed to send viewing requested chef email", err));
        }
      } catch (e) {
        logger.error("[Viewings] Failed to notify chef:", e);
      }

      logger.info(`[Viewings] Chef ${chefId} booked viewing ${newViewing.id} for kitchen ${targetedKitchenId} at ${scheduledDate.toISOString()}`);
      res.status(201).json(newViewing);
    } catch (error: any) {
      if (error.message === "SLOT_TAKEN") {
        return res.status(409).json({
          error: "This time slot was just taken by another chef. Please select a different time.",
          code: "SLOT_TAKEN",
        });
      }
      logger.error("Error booking viewing:", error);
      return errorResponse(res, error);
    }
  }
);

// ===================================
// SHARED: Viewing CRUD
// ===================================

/**
 * GET /api/viewings/chef
 * Get all viewings for the authenticated chef
 */
router.get(
  "/chef",
  requireFirebaseAuthWithUser,
  requireChef,
  async (req: Request, res: Response) => {
    try {
      const chefId = req.neonUser!.id;
      const status = req.query.status as string;

      let query = db
        .select({
          viewing: kitchenViewings,
          locationName: locations.name,
          locationAddress: locations.address,
          kitchenName: kitchens.name,
          managerId: locations.managerId,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .where(eq(kitchenViewings.chefId, chefId))
        .orderBy(desc(kitchenViewings.scheduledAt));

      const results = await query;

      // Filter by status if provided
      const filtered = status
        ? results.filter((r) => r.viewing.status === status)
        : results;

      const withNames = await Promise.all(
        filtered.map(async (r) => ({
          ...r,
          managerName: r.managerId ? await getUserDisplayName(r.managerId, 'manager') : 'Manager'
        }))
      );

      res.json(withNames);
    } catch (error) {
      logger.error("Error fetching chef viewings:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * GET /api/viewings/manager
 * Get all viewings for locations managed by the authenticated manager
 */
router.get(
  "/manager",
  requireFirebaseAuthWithUser,
  requireManager,
  async (req: Request, res: Response) => {
    try {
      const managerId = req.neonUser!.id;
      const status = req.query.status as string;
      const locationId = req.query.locationId
        ? parseInt(req.query.locationId as string)
        : undefined;

      const results = await db
        .select({
          viewing: kitchenViewings,
          locationName: locations.name,
          locationAddress: locations.address,
          kitchenName: kitchens.name,
          chefUsername: users.username,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(
          and(
            eq(kitchenViewings.managerId, managerId),
            ne(kitchenViewings.status, "pending_local_cooks"),
            locationId ? eq(kitchenViewings.locationId, locationId) : undefined
          )
        )
        .orderBy(desc(kitchenViewings.scheduledAt));

      // Filter by status if provided
      const filtered = status
        ? results.filter((r) => r.viewing.status === status)
        : results;

      const withNames = await Promise.all(
        filtered.map(async (r) => ({
          ...r,
          chefName: r.viewing.chefId ? await getUserDisplayName(r.viewing.chefId, 'chef') : 'A chef'
        }))
      );

      res.json(withNames);
    } catch (error) {
      logger.error("Error fetching manager viewings:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * GET /api/viewings/admin
 * Local Cooks review queue. These requests are never exposed by the manager route.
 */
router.get(
  "/admin",
  requireFirebaseAuthWithUser,
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const results = await db
        .select({
          viewing: kitchenViewings,
          locationName: locations.name,
          locationAddress: locations.address,
          kitchenName: kitchens.name,
          chefUsername: users.username,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(or(
          eq(kitchenViewings.status, "pending_local_cooks"),
          sql`${kitchenViewings.adminReviewedAt} IS NOT NULL`
        ))
        .orderBy(desc(kitchenViewings.createdAt));

      res.json(await Promise.all(results.map(async (result) => ({
        ...result,
        chefName: await getUserDisplayName(result.viewing.chefId, "chef"),
      }))));
    } catch (error) {
      logger.error("Error fetching Local Cooks tour review queue:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * PATCH /api/viewings/admin/:id/review
 * Local Cooks either releases a request to the manager or declines it.
 */
router.patch(
  "/admin/:id/review",
  requireFirebaseAuthWithUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const viewingId = Number(req.params.id);
      const decision = req.body?.decision;
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!Number.isInteger(viewingId) || !["approved", "denied"].includes(decision)) {
        return res.status(400).json({ error: "A valid viewing and decision are required" });
      }
      if (decision === "denied" && !reason) {
        return res.status(400).json({ error: "A reason is required when declining a tour request" });
      }

      const [record] = await db
        .select({
          viewing: kitchenViewings,
          locationName: locations.name,
          kitchenName: kitchens.name,
          timezone: locations.timezone,
          chefEmail: users.username,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(eq(kitchenViewings.id, viewingId))
        .limit(1);

      if (!record) return res.status(404).json({ error: "Tour request not found" });
      if (record.viewing.status !== "pending_local_cooks") {
        return res.status(409).json({ error: "This tour request has already been reviewed" });
      }
      if (decision === "approved" && record.viewing.scheduledAt.getTime() <= Date.now()) {
        return res.status(409).json({ error: "The requested tour time has already passed" });
      }

      const nextStatus = decision === "approved" ? "pending" : "cancelled";
      const [updated] = await db.update(kitchenViewings).set({
        status: nextStatus,
        adminReviewDecision: decision,
        adminReviewReason: reason || null,
        adminReviewerId: req.neonUser!.id,
        adminReviewedAt: new Date(),
        ...(decision === "denied" ? {
          cancelledBy: "local_cooks",
          cancellationReason: reason,
          cancelledAt: new Date(),
        } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(kitchenViewings.id, viewingId),
        eq(kitchenViewings.status, "pending_local_cooks")
      )).returning();

      if (!updated) return res.status(409).json({ error: "This tour request has already been reviewed" });

      const chefName = await getUserDisplayName(record.viewing.chefId, "chef");
      const locationName = record.locationName || "the kitchen";
      const kitchenName = record.kitchenName || locationName;
      const scheduledDate = record.viewing.scheduledAt;
      const timezone = record.timezone || "America/St_Johns";

      if (decision === "approved") {
        if (record.viewing.managerId) {
          const [manager] = await db.select({ username: users.username })
            .from(users).where(eq(users.id, record.viewing.managerId)).limit(1);
          const managerName = await getUserDisplayName(record.viewing.managerId, "manager");
          await notificationService.createForManager({
            managerId: record.viewing.managerId,
            locationId: record.viewing.locationId,
            type: "booking_new",
            priority: "high",
            title: "New Kitchen Viewing Request",
            message: `${chefName} requested a viewing of ${kitchenName} at ${locationName} on ${format(scheduledDate, "MMM d, yyyy")} at ${format(scheduledDate, "h:mm a")}.`,
            metadata: { viewingId, kitchenId: record.viewing.targetedKitchenId, chefId: record.viewing.chefId },
            actionUrl: "/manager/dashboard?view=viewings",
            actionLabel: "Review Request",
          });
          if (manager?.username) {
            await sendEmail(generateTourRequestedManagerEmail({
              managerEmail: manager.username,
              managerName,
              chefName,
              kitchenName,
              tourDate: scheduledDate,
              startTime: format(scheduledDate, "h:mm a"),
              chefNotes: record.viewing.chefNotes || undefined,
              timezone,
            })).catch(err => logger.error("Failed to send manager tour request email", err));
          }
        }
        await notificationService.createForChef({
          chefId: record.viewing.chefId,
          type: "booking_confirmed",
          priority: "normal",
          title: "Tour request sent to the kitchen manager",
          message: `Local Cooks approved your request for ${kitchenName}. The kitchen manager will make the final decision.`,
          metadata: { viewingId, locationId: record.viewing.locationId },
          actionUrl: "/dashboard?view=viewings",
          actionLabel: "View Details",
        });
      } else {
        await notificationService.createForChef({
          chefId: record.viewing.chefId,
          type: "booking_cancelled",
          priority: "high",
          title: "Tour request update",
          message: `Local Cooks could not approve your request for ${kitchenName}. Reason: ${reason}`,
          metadata: { viewingId, locationId: record.viewing.locationId },
          actionUrl: "/dashboard?view=viewings",
          actionLabel: "View Details",
        });
        if (record.chefEmail) {
          await sendEmail(generateTourDeclinedByLocalCooksEmail({
            chefEmail: record.chefEmail,
            chefName,
            kitchenName,
            reason,
          })).catch(err => logger.error("Failed to send Local Cooks tour decline email", err));
        }
      }

      res.json(updated);
    } catch (error) {
      logger.error("Error reviewing tour request for Local Cooks:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * PATCH /api/viewings/:id/status
 * Update viewing status (confirm, cancel, complete, no-show)
 */
router.patch(
  "/:id/status",
  requireFirebaseAuthWithUser,
  async (req: Request, res: Response) => {
    try {
      const viewingId = parseInt(req.params.id);
      const userId = req.neonUser!.id;

      const parsed = updateKitchenViewingStatusSchema.safeParse({
        ...req.body,
        id: viewingId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }

      // Get the existing viewing
      const [viewing] = await db
        .select()
        .from(kitchenViewings)
        .where(eq(kitchenViewings.id, viewingId))
        .limit(1);

      if (!viewing) {
        return res.status(404).json({ error: "Viewing not found" });
      }

      // Authorization: chef can only cancel their own, manager can update their location's viewings
      const isChef = viewing.chefId === userId;
      const isManager = viewing.managerId === userId;
      const isAdmin = req.neonUser!.role === "admin";

      if (!isChef && !isManager && !isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Chefs can only cancel
      if (isChef && parsed.data.status !== "cancelled") {
        return res.status(403).json({ error: "Chefs can only cancel viewings" });
      }
      if (isChef && !["pending_local_cooks", "pending", "confirmed"].includes(viewing.status)) {
        return res.status(409).json({ error: "This viewing can no longer be cancelled" });
      }

      if (isManager && viewing.status === "pending_local_cooks") {
        return res.status(403).json({ error: "This request is still under Local Cooks review" });
      }

      if (isAdmin && viewing.status === "pending_local_cooks") {
        return res.status(403).json({ error: "Use the Local Cooks review action for this request" });
      }

      if (!isChef) {
        const allowedTransitions: Record<string, string[]> = {
          pending: ["confirmed", "cancelled"],
          confirmed: ["cancelled", "completed", "no_show"],
        };
        if (!allowedTransitions[viewing.status]?.includes(parsed.data.status)) {
          return res.status(409).json({ error: `Cannot change a ${viewing.status} viewing to ${parsed.data.status}` });
        }
      }

      // Build update data
      const updateData: any = {
        status: parsed.data.status,
        updatedAt: new Date(),
      };

      if (parsed.data.managerNotes) {
        updateData.managerNotes = parsed.data.managerNotes;
      }

      if (parsed.data.status === "cancelled") {
        updateData.cancelledBy = isChef ? "chef" : "manager";
        updateData.cancellationReason = parsed.data.cancellationReason;
        updateData.cancelledAt = new Date();
      }

      if (parsed.data.status === "no_show") {
        updateData.noShowReason = parsed.data.noShowReason || "chef_no_response";
      }

      if (parsed.data.status === "completed") {
        updateData.completedAt = new Date();
      }

      const [updated] = await db
        .update(kitchenViewings)
        .set(updateData)
        .where(eq(kitchenViewings.id, viewingId))
        .returning();

      // Get location name for notifications
      const [location] = await db
        .select({ name: locations.name, address: locations.address, timezone: locations.timezone })
        .from(locations)
        .where(eq(locations.id, viewing.locationId))
        .limit(1);

      const locationName = location?.name || "the kitchen";
      const locationAddress = location?.address || "";
      const timezone = location?.timezone || "America/St_Johns";
      const scheduledDate = viewing.scheduledAt;
      const startTime = format(scheduledDate, "h:mm a");
      const endTime = format(addMinutes(scheduledDate, viewing.durationMinutes), "h:mm a");

      // Send notifications based on status change
      if (parsed.data.status === "cancelled") {
        if (isChef && viewing.managerId && viewing.status !== "pending_local_cooks") {
          // Notify manager that chef cancelled
          const [chef] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
          await notificationService.createForManager({
            managerId: viewing.managerId,
            locationId: viewing.locationId,
            type: "booking_cancelled",
            priority: "normal",
            title: "Viewing Cancelled by Chef",
            message: `${await getUserDisplayName(viewing.chefId, 'chef')} cancelled their viewing at ${locationName}.`,
            metadata: { viewingId },
            actionUrl: `/manager/dashboard?view=viewings`,
            actionLabel: "View Details",
          });
        } else if (isManager) {
          // Notify chef that manager cancelled
          const [chef] = await db.select({ username: users.username }).from(users).where(eq(users.id, viewing.chefId)).limit(1);
          const chefEmail = chef?.username;
          const chefName = chefEmail?.split("@")[0] || "Chef";

          await notificationService.createForChef({
            chefId: viewing.chefId,
            type: "booking_cancelled",
            priority: "high",
            title: "Kitchen Viewing Cancelled",
            message: `Your viewing at ${locationName} has been cancelled by the manager.${parsed.data.cancellationReason ? ` Reason: ${parsed.data.cancellationReason}` : ""} Please book a new time.`,
            metadata: { viewingId },
            actionUrl: `/dashboard?view=viewings`,
            actionLabel: "Reschedule",
          });
          
          if (chefEmail) {
            const emailContent = generateTourRejectedChefEmail({
              chefEmail,
              chefName,
              kitchenName: locationName,
              tourDate: scheduledDate,
              startTime,
              cancellationReason: parsed.data.cancellationReason,
              managerNotes: parsed.data.managerNotes,
              timezone
            });
            await sendEmail(emailContent).catch(err => logger.error("Failed to send viewing rejected chef email", err));
          }
        }
      } else if (parsed.data.status === "completed") {
        // Post-viewing nurture notification to chef
        await notificationService.createForChef({
          chefId: viewing.chefId,
          type: "application_new",
          priority: "normal",
          title: "How was your viewing?",
          message: `Thanks for visiting ${locationName}! Ready to apply? Start your kitchen application now.`,
          metadata: { viewingId, locationId: viewing.locationId },
          actionUrl: `/kitchen-requirements/${viewing.locationId}`,
          actionLabel: "Apply Now",
        });
      } else if (parsed.data.status === "confirmed" && isManager) {
        const [chef] = await db.select({ username: users.username }).from(users).where(eq(users.id, viewing.chefId)).limit(1);
        const chefEmail = chef?.username;
        const chefName = await getUserDisplayName(viewing.chefId, 'chef');

        const [manager] = await db.select({ username: users.username }).from(users).where(eq(users.id, viewing.managerId!)).limit(1);
        const managerEmail = manager?.username;
        const managerName = await getUserDisplayName(viewing.managerId!, 'manager');

        // Notify chef that manager approved the viewing
        await notificationService.createForChef({
          chefId: viewing.chefId,
          type: "booking_confirmed",
          priority: "high",
          title: "Kitchen Viewing Confirmed!",
          message: `Your viewing request at ${locationName} has been approved by the manager. See you then!`,
          metadata: { viewingId, locationId: viewing.locationId },
          actionUrl: `/dashboard?view=viewings`,
          actionLabel: "View Details",
        });

        // Send ICS to Chef
        if (chefEmail) {
          const chefEmailContent = generateTourConfirmedEmail({
            isManager: false,
            email: chefEmail,
            recipientName: chefName,
            otherPartyName: managerName,
            kitchenName: locationName,
            locationAddress,
            tourDate: scheduledDate,
            startTime,
            endTime,
            timezone,
            notes: parsed.data.managerNotes,
            organizerEmail: managerEmail,
            attendeeEmails: [chefEmail, managerEmail].filter(Boolean) as string[],
          });
          await sendEmail(chefEmailContent).catch(err => logger.error("Failed to send viewing confirmed chef email", err));
        }

        // Send ICS to Manager
        if (managerEmail) {
          const managerEmailContent = generateTourConfirmedEmail({
            isManager: true,
            email: managerEmail,
            recipientName: managerName,
            otherPartyName: chefName,
            kitchenName: locationName,
            locationAddress,
            tourDate: scheduledDate,
            startTime,
            endTime,
            timezone,
            notes: viewing.chefNotes || undefined,
            organizerEmail: managerEmail,
            attendeeEmails: [chefEmail, managerEmail].filter(Boolean) as string[],
          });
          await sendEmail(managerEmailContent).catch(err => logger.error("Failed to send viewing confirmed manager email", err));
        }
      }

      logger.info(`[Viewings] Viewing ${viewingId} status updated to ${parsed.data.status} by user ${userId}`);
      res.json(updated);
    } catch (error) {
      logger.error("Error updating viewing status:", error);
      return errorResponse(res, error);
    }
  }
);

/**
 * GET /api/viewings/kitchen/:kitchenId/is-active
 * Quick check if tours can be scheduled for a kitchen.
 */
router.get(
  "/kitchen/:kitchenId/is-active",
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      if (isNaN(kitchenId)) {
        return res.status(400).json({ error: "Invalid kitchen ID" });
      }

      const [settings] = await db
        .select({ isActive: kitchenViewingSettings.isActive })
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      const [openTourDay] = await db
        .select({ id: kitchenViewingAvailability.id })
        .from(kitchenViewingAvailability)
        .where(
          and(
            eq(kitchenViewingAvailability.kitchenId, kitchenId),
            eq(kitchenViewingAvailability.isAvailable, true)
          )
        )
        .limit(1);

      const isActive = settings?.isActive ?? false;
      const hasSchedule = Boolean(openTourDay);
      const toursAvailable = isActive && hasSchedule;

      res.json({ isActive, hasSchedule, toursAvailable });
    } catch (error) {
      logger.error("Error checking viewing status:", error);
      return errorResponse(res, error);
    }
  }
);

export default router;
