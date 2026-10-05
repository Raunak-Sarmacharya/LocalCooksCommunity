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
import { initializeSharedConversation } from '../chat-service';
import { eq, and, sql, desc, gte, lte, or, ne, inArray } from "drizzle-orm";
import { db } from "../db";
import { requireFirebaseAuthWithUser, requireManager, requireAdmin } from "../firebase-auth-middleware";
import { requireChef } from "./middleware";
import { logger } from "../logger";
import { errorResponse } from "../api-response";
import { blackoutDateKeys, bookingClosuresForTours, copyableTourHours, tourBlackoutForDate, tourWindowsForDate } from "@shared/tour-schedule";
import { activeBookingIdsOnOperatingDate, hasOverlappingOperatingDays } from "@shared/operating-schedule";
import { DEFAULT_TIMEZONE } from "@shared/timezone-utils";
import { formatTourDate, formatTourClock, tourDateKey } from "@shared/tour-time";
import { tourBookingOverlaps } from "@shared/tour-booking-overlap";
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { DomainError } from '../shared/errors/domain-error';
import { buildTourConfirmationPdf, tourReference } from "../services/tour-confirmation-pdf";
import { queueTourEvent, attemptTourDelivery } from '../services/tour-delivery-service';
import { publicTour, hasTourConfirmation } from '@shared/tour-outcome';
import { tourAttendance, type TourAttendanceEntry } from '@shared/tour-attendance';
import { getCheckinSettings } from '../services/kitchen-checkout-service';
import { validateAttendanceAssistance } from '../services/visit-assistance';
import { affectedTours, queueScheduleProblems } from '../services/commitment-problems';

import {
  kitchenViewingSettings,
  kitchenViewingAvailability,
  kitchenAvailability,
  kitchenDateOverrides,
  kitchenViewingBlackouts,
  kitchenViewings,
  tourDeliveryEvents,
  kitchenBookings,
  chefKitchenApplications,
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
import { getChefPhone } from "../phone-utils";
import { TZDate } from "@date-fns/tz";
import { addMinutes, isBefore, isAfter, differenceInHours } from "date-fns";

const router = Router();

router.get('/delivery-worker', async (req, res) => {
  const secret = process.env.CRON_SECRET, supplied = req.headers.authorization;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : ''), received = Buffer.from(supplied || '');
  if (!secret || !supplied || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const started = performance.now();
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { runRecurringWorker } = await import('../services/recurring-worker');
    const { processExpiredCancellationRequests } = await import('../services/scheduled-cancellations');
    const result = await runRecurringWorker(processExpiredCancellationRequests, started);
    return res.status('taskFailures' in result && result.taskFailures.length ? 503 : 200).json(result);
  }
  catch { logger.error('[Tours] Scheduled delivery worker failed'); return res.status(503).json({ error: 'Tour delivery worker unavailable' }); }
});

router.get('/admin/delivery-status', requireFirebaseAuthWithUser, requireAdmin, async (_req, res) => {
  try {
    const pending = await db.select({ id: tourDeliveryEvents.id, viewingId: tourDeliveryEvents.viewingId,
      attempts: tourDeliveryEvents.attempts, lastError: tourDeliveryEvents.lastError,
      nextAttemptAt: tourDeliveryEvents.nextAttemptAt, createdAt: tourDeliveryEvents.createdAt })
      .from(tourDeliveryEvents).where(sql`${tourDeliveryEvents.completedAt} IS NULL`).orderBy(tourDeliveryEvents.id);
    res.json(pending);
  } catch (error) { return errorResponse(res, error); }
});

router.post('/admin/:id/retry-delivery', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid tour' });
    await db.update(tourDeliveryEvents).set({ nextAttemptAt: new Date() })
      .where(and(eq(tourDeliveryEvents.viewingId, id), sql`${tourDeliveryEvents.completedAt} IS NULL`));
    const delivery = await attemptTourDelivery(id);
    return res.json({ notificationDeliveryFailed: delivery.failed });
  } catch (error) { return errorResponse(res, error); }
});

type TourTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TourConnection = typeof db | TourTransaction;

async function lockTourKitchen(tx: TourTransaction, kitchenId: number) {
  // Same order as facility blackouts; also retain the existing tour reservation lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 0)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 7)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(0, ${kitchenId})`);
}

async function lockedTour(tx: TourTransaction, id: number) {
  const [snapshot] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1);
  if (!snapshot) throw new DomainError('TOUR_NOT_FOUND', 'Tour not found', 404);
  if (snapshot.targetedKitchenId) await lockTourKitchen(tx, snapshot.targetedKitchenId);
  const [tour] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1).for('update');
  if (!tour) throw new DomainError('TOUR_NOT_FOUND', 'Tour not found', 404);
  if (tour.targetedKitchenId !== snapshot.targetedKitchenId || tour.locationId !== snapshot.locationId) {
    throw new DomainError('TOUR_CHANGED', 'This tour has changed. Refresh and review it again', 409);
  }
  const [location] = await tx.select({ managerId: locations.managerId, name: locations.name }).from(locations)
    .where(eq(locations.id, tour.locationId)).limit(1).for('share');
  if (!location) throw new DomainError('TOUR_NOT_FOUND', 'Tour location not found', 404);
  return { tour, location };
}

function checkTourVersion(tour: typeof kitchenViewings.$inferSelect, expected: unknown, required = false) {
  // API dates have millisecond precision; guarded writes below truncate PostgreSQL microseconds too.
  if ((required || expected !== undefined) && expected !== tour.updatedAt.toISOString()) {
    throw new DomainError('TOUR_CHANGED', 'This tour has changed. Refresh and review it again', 409);
  }
}

async function tourBookingContext(connection: TourConnection, tour: typeof kitchenViewings.$inferSelect, scheduledAt: Date) {
  if (!tour.targetedKitchenId) throw new DomainError('TOUR_KITCHEN_MISSING', 'This tour no longer has an available kitchen', 409);
  const firstDay = Date.parse(`${tourDateKey(scheduledAt)}T00:00:00Z`) - 86400000;
  const lastDay = Date.parse(`${tourDateKey(new Date(scheduledAt.getTime() + tour.durationMinutes * 60_000))}T00:00:00Z`) + 86400000;
  const bookings = await connection.select({ id: kitchenBookings.id, kitchenId: kitchenBookings.kitchenId,
    referenceCode: kitchenBookings.referenceCode, status: kitchenBookings.status, bookingDate: kitchenBookings.bookingDate,
    startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, selectedSlots: kitchenBookings.selectedSlots,
    operatingWindowStartTime: kitchenBookings.operatingWindowStartTime }).from(kitchenBookings).where(and(
      eq(kitchenBookings.kitchenId, tour.targetedKitchenId), inArray(kitchenBookings.status, ['pending', 'confirmed', 'cancellation_requested']),
      gte(kitchenBookings.bookingDate, new Date(firstDay)), lte(kitchenBookings.bookingDate, new Date(lastDay))));
  let overlaps;
  try { overlaps = tourBookingOverlaps(bookings, tour.targetedKitchenId, scheduledAt, tour.durationMinutes); }
  catch (error) { throw new DomainError('BOOKING_TIME_INVALID', (error as Error).message, 409); }
  return { overlaps, overlapReviewKey: createHash('sha256').update(JSON.stringify(overlaps)).digest('hex') };
}

async function checkTourAcceptance(tx: TourTransaction, tour: typeof kitchenViewings.$inferSelect, scheduledAt: Date, body: any) {
  if (!tour.targetedKitchenId) throw new DomainError('TOUR_KITCHEN_MISSING', 'This tour no longer has an available kitchen', 409);
  const [kitchen] = await tx.select({ locationId: kitchens.locationId, isActive: kitchens.isActive, listingStatus: kitchens.listingStatus })
    .from(kitchens).where(eq(kitchens.id, tour.targetedKitchenId)).limit(1).for('share');
  if (!kitchen?.isActive || kitchen.listingStatus !== 'active' || kitchen.locationId !== tour.locationId) {
    throw new DomainError('TOUR_KITCHEN_UNAVAILABLE', 'This kitchen is no longer available for tours', 409);
  }
  const [settings] = await tx.select().from(kitchenViewingSettings).where(eq(kitchenViewingSettings.kitchenId, tour.targetedKitchenId)).limit(1);
  if (!settings?.isActive || settings.defaultDurationMinutes !== tour.durationMinutes) {
    throw new DomainError('TOUR_SETTINGS_CHANGED', 'Tour settings have changed. Review this request before accepting it', 409);
  }
  const slots = await calculateAvailableSlots(tour.targetedKitchenId, tourDateKey(scheduledAt), DEFAULT_TIMEZONE,
    undefined, { connection: tx, ignoreViewingId: tour.id, ignoreAdvanceNotice: true });
  if (scheduledAt.getTime() <= Date.now() || !slots.some(slot => new Date(slot.scheduledAt).getTime() === scheduledAt.getTime())) {
    throw new DomainError('SLOT_TAKEN', 'That tour time is no longer available', 409);
  }
  const context = await tourBookingContext(tx, tour, scheduledAt);
  if (body.overlapReviewKey !== context.overlapReviewKey || (context.overlaps.length && body.acceptBookingOverlap !== true)) {
    throw new DomainError('BOOKING_CONTEXT_CHANGED', 'Review the current overlapping bookings before accepting this tour', 409);
  }
}

class TourSetupError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class TourBlackoutAffectsBookingsError extends Error {
  constructor(readonly bookingIds: number[]) { super("Review existing bookings before closing these dates"); }
}

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
  },
  options: { connection?: TourConnection; ignoreViewingId?: number; ignoreAdvanceNotice?: boolean } = {},
): Promise<TimeSlot[]> {
  const connection = options.connection ?? db;
  // 1. Get viewing settings
  let settings = prefetched?.settings;
  if (!settings) {
    const [fetchedSettings] = await connection
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
  const nowLocal = new TZDate(new Date(), timezone);
  const today = new TZDate(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), 0, 0, 0, 0, timezone);
  const lastDate = new TZDate(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate() + settings.maxAdvanceBookingDays, 0, 0, 0, 0, timezone);
  if (isBefore(targetDate, today) || isAfter(targetDate, lastDate)) return [];
  const dayOfWeek = targetDate.getDay(); // 0-6, Sunday is 0

  // 3. Get recurring availability for this day of week
  let availabilityWindows;
  if (prefetched?.availability) {
    availabilityWindows = prefetched.availability;
  } else {
    availabilityWindows = await connection
      .select()
      .from(kitchenViewingAvailability)
      .where(
        and(
          eq(kitchenViewingAvailability.kitchenId, kitchenId),
          inArray(kitchenViewingAvailability.dayOfWeek, [dayOfWeek, (dayOfWeek + 6) % 7]),
          eq(kitchenViewingAvailability.isAvailable, true)
        )
      );
  }

  if (availabilityWindows.length === 0) {
    return [];
  }

  // 4. Check for blackouts on this date
  const dayStart = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);
  const dayEnd = new TZDate(year, month - 1, day + 1, 0, 0, 0, 0, timezone);
  // A tour beginning before midnight can end, or require clearance, on the next date.
  const occupiedEnd = addMinutes(dayEnd, settings.defaultDurationMinutes + settings.bufferAfterMinutes);

  let blackouts = prefetched?.blackouts;
  if (!blackouts) {
    blackouts = await connection
      .select()
      .from(kitchenViewingBlackouts)
      .where(
        and(
          eq(kitchenViewingBlackouts.kitchenId, kitchenId),
          lte(kitchenViewingBlackouts.startDate, occupiedEnd),
          gte(kitchenViewingBlackouts.endDate, dayStart)
        )
      );
  }

  // If any blackout fully covers this day, no slots available
  for (const blackout of blackouts) {
    if (
      new Date(blackout.startDate).getTime() <= dayStart.getTime() &&
      new Date(blackout.endDate).getTime() >= dayEnd.getTime()
    ) {
      return [];
    }
  }

  // 5. Get existing booked viewings for this date (exclude cancelled)
  let existingViewings;
  if (prefetched?.existingViewings) {
    existingViewings = prefetched.existingViewings.filter((v: any) => {
      const vStart = new Date(v.scheduledAt);
      return v.id !== options.ignoreViewingId && !['cancelled', 'completed', 'no_show'].includes(v.status)
        && vStart <= occupiedEnd && addMinutes(vStart, v.durationMinutes + settings.bufferAfterMinutes) > addMinutes(dayStart, -settings.bufferBeforeMinutes);
    });
  } else {
    existingViewings = await connection
      .select()
      .from(kitchenViewings)
      .where(
        and(
          eq(kitchenViewings.targetedKitchenId, kitchenId),
          lte(kitchenViewings.scheduledAt, occupiedEnd),
          sql`${kitchenViewings.scheduledAt} + (${kitchenViewings.durationMinutes} + ${settings.bufferAfterMinutes}) * interval '1 minute' > ${addMinutes(dayStart, -settings.bufferBeforeMinutes).toISOString()}::timestamp`,
          inArray(kitchenViewings.status, ['pending_local_cooks', 'pending', 'confirmed']),
          options.ignoreViewingId ? ne(kitchenViewings.id, options.ignoreViewingId) : undefined,
        )
      );
  }

  // 6. Generate all possible slots from availability windows
  const allSlots: TimeSlot[] = [];
  const duration = settings.defaultDurationMinutes;
  const bufferBefore = settings.bufferBeforeMinutes;
  const bufferAfter = settings.bufferAfterMinutes;
  const totalSlotSize = bufferBefore + duration + bufferAfter;
  if (!Number.isFinite(totalSlotSize) || duration <= 0 || totalSlotSize <= 0) return [];

  const now = new TZDate(new Date(), timezone);

  for (const window of tourWindowsForDate(availabilityWindows, dateStr, timezone)) {
    let slotStart: Date = window.start;
    const windowEnd = window.end;

    while (true) {
      const actualTourStart = addMinutes(slotStart, bufferBefore);
      const actualTourEnd = addMinutes(actualTourStart, duration);
      const slotEnd = addMinutes(actualTourEnd, bufferAfter);

      // Stop if slot extends past window end
      if (isAfter(slotEnd, windowEnd)) {
        break;
      }

      if (actualTourStart < dayStart || actualTourStart >= dayEnd) {
        slotStart = slotEnd;
        continue;
      }

      // Check advance notice
      const hoursUntil = differenceInHours(actualTourStart, now);
      if (!options.ignoreAdvanceNotice && hoursUntil < settings.advanceNoticeHours) {
        slotStart = slotEnd; // Move to next slot position
        continue;
      }

      // Check if slot conflicts with blackout periods
      let blackedOut = false;
      for (const blackout of blackouts) {
        const bStart = new Date(blackout.startDate);
        const bEnd = new Date(blackout.endDate);
        if (isBefore(slotStart, bEnd) && isAfter(slotEnd, bStart)) {
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

        if (isBefore(slotStart, viewingBlockEnd) && isAfter(slotEnd, viewingBlockStart)) {
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
        startTime: formatTourClock(actualTourStart, false),
        endTime: formatTourClock(actualTourEnd, false),
        scheduledAt: new Date(actualTourStart.getTime()).toISOString(),
      });

      slotStart = slotEnd; // Move to next slot position
    }
  }

  return Array.from(new Map(allSlots.map(slot => [slot.scheduledAt, slot])).values())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

// ===================================
// PUBLIC ROUTES: Availability Info
// ===================================

// Public initial search remains public. Self-exclusion always authenticates and
// checks the actual customer/kitchen before either calendar or slot calculation.
const authenticateSelfExclusion = (req: Request, res: Response, next: any) =>
  req.query.viewingId === undefined ? next() : requireFirebaseAuthWithUser(req, res, next);
async function authorizedSelfExclusion(req: Request, kitchenId: number) {
  if (req.query.viewingId === undefined) return undefined;
  const id = Number(req.query.viewingId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new DomainError('FORBIDDEN', 'Choose your confirmed tour', 403);
  const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1);
  if (!tour || tour.chefId !== req.neonUser?.id || tour.targetedKitchenId !== kitchenId || tour.status !== 'confirmed' || tour.scheduledAt.getTime() <= Date.now())
    throw new DomainError('FORBIDDEN', 'Only your upcoming confirmed tour may be excluded', 403);
  const [settings] = await db.select().from(kitchenViewingSettings).where(eq(kitchenViewingSettings.kitchenId, kitchenId)).limit(1);
  if (!settings?.isActive || settings.defaultDurationMinutes !== tour.durationMinutes)
    throw new DomainError('TOUR_SETTINGS_CHANGED', 'Tour settings changed; contact Local Cooks before requesting another time', 409);
  return id;
}

async function publicTourAttendance(tour: typeof kitchenViewings.$inferSelect,
  settingsByLocation: Map<number, ReturnType<typeof getCheckinSettings>>) {
  if (!settingsByLocation.has(tour.locationId)) settingsByLocation.set(tour.locationId, getCheckinSettings(tour.locationId));
  const settings = await settingsByLocation.get(tour.locationId)!;
  return { ...publicTour(tour), attendance: tourAttendance(tour, settings.checkinWindowMinutesBefore) };
}

/**
 * GET /api/viewings/calendar-availability/:kitchenId
 * Get calendar metadata (availability by day of week & blackouts) for a kitchen.
 * Used by chefs to visually disable unavailable dates on the calendar picker.
 */
router.get(
  "/calendar-availability/:kitchenId",
  authenticateSelfExclusion,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);

      const ignoreViewingId = await authorizedSelfExclusion(req, kitchenId);
      if (ignoreViewingId) res.setHeader('Cache-Control', 'private, no-store');

      const [kitchenContext] = await db
        .select({ timezone: locations.timezone })
        .from(kitchens)
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(and(eq(kitchens.id, kitchenId), eq(kitchens.isActive, true), eq(kitchens.listingStatus, "active")))
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
      const currentDay = new TZDate(new Date(), DEFAULT_TIMEZONE);
      const today = new TZDate(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 0, 0, 0, 0, DEFAULT_TIMEZONE);
      const endWindow = new TZDate(today, DEFAULT_TIMEZONE);
      endWindow.setDate(endWindow.getDate() + maxDays);
      
      const existingViewings = await db
        .select()
        .from(kitchenViewings)
        .where(
          and(
            eq(kitchenViewings.targetedKitchenId, kitchenId),
            gte(kitchenViewings.scheduledAt, addMinutes(today, -120 - settings.bufferAfterMinutes - settings.bufferBeforeMinutes)),
            lte(kitchenViewings.scheduledAt, addMinutes(new TZDate(endWindow.getFullYear(), endWindow.getMonth(), endWindow.getDate() + 1, 0, 0, 0, 0, DEFAULT_TIMEZONE), settings.defaultDurationMinutes + settings.bufferAfterMinutes)),
            sql`${kitchenViewings.status} != 'cancelled'`
          )
        );

      // Compute fullyBookedDates
      const fullyBookedDates: string[] = [];
      const prefetched = { settings, availability, blackouts, existingViewings };
      
      const timezone = DEFAULT_TIMEZONE;
      for (let i = 0; i <= maxDays; i++) {
        const d = new TZDate(today, DEFAULT_TIMEZONE);
        d.setDate(d.getDate() + i);
        const dateStr = tourDateKey(d);
        const slots = await calculateAvailableSlots(kitchenId, dateStr, timezone, prefetched, { ignoreViewingId });
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
        .select({ id: kitchens.id, timezone: locations.timezone })
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
        timezone: DEFAULT_TIMEZONE,
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

      const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 7)`);
      // Check if settings exist
      const [existing] = await tx
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1);

      let result;
      if (existing) {
        // Update existing
        [result] = await tx
          .update(kitchenViewingSettings)
          .set({
            ...parsed.data,
            updatedAt: new Date(),
          })
          .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
          .returning();
      } else {
        // Create new
        [result] = await tx
          .insert(kitchenViewingSettings)
          .values({
            kitchenId,
            ...parsed.data,
          })
          .returning();
      }

      if (existing && ['isActive', 'defaultDurationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes'].some(key =>
        (existing as any)[key] !== (result as any)[key]))
        await queueScheduleProblems(tx, { kitchenId, actorId: managerId, tourIds: await affectedTours(tx, kitchenId),
          change: { active: result.isActive, duration: result.defaultDurationMinutes, before: result.bufferBeforeMinutes, after: result.bufferAfterMinutes, occurrence: randomUUID() },
          description: 'Tour settings changed. Your confirmed tour is still recorded at its original time. Please review this request to confirm your visit arrangements.' });
      return { result, existing };
      });
      logger.info(`[Viewings] Settings ${result.existing ? "updated" : "created"} for kitchen ${kitchenId} by manager ${managerId}`);
      res.json(result.result);
    } catch (error) {
      logger.error("Error updating viewing settings:", error);
      return errorResponse(res, error);
    }
  }
);

/** One-time tour setup. Booking hours can seed tours only while every tour day is closed. */
router.put("/setup/:kitchenId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  const kitchenId = Number(req.params.kitchenId);
  const { scheduleSource } = req.body ?? {};
  if (!Number.isSafeInteger(kitchenId) || kitchenId <= 0 || !["booking", "separate"].includes(scheduleSource)) {
    return res.status(400).json({ error: "Choose a valid tour schedule source" });
  }
  try {
    const [owned] = await db.select({ id: kitchens.id, timezone: locations.timezone }).from(kitchens)
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, req.neonUser!.id))).limit(1);
    if (!owned) return res.status(403).json({ error: "Access denied" });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 7)`);
      const [existing] = await tx.select().from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId)).limit(1);
      if (scheduleSource === "booking") {
        const bookingHours = await tx.select().from(kitchenAvailability)
          .where(eq(kitchenAvailability.kitchenId, kitchenId));
        const copied = copyableTourHours(bookingHours, existing?.defaultDurationMinutes ?? 30,
          existing?.bufferBeforeMinutes ?? 0, existing?.bufferAfterMinutes ?? 15);
        if (!copied.length) throw new TourSetupError("No saved booking hours are long enough for a tour and its buffers", 400);
        const [openDay] = await tx.select({ id: kitchenViewingAvailability.id }).from(kitchenViewingAvailability)
          .where(and(eq(kitchenViewingAvailability.kitchenId, kitchenId), eq(kitchenViewingAvailability.isAvailable, true))).limit(1);
        if (openDay) {
          throw new TourSetupError("Tour hours are already set for this kitchen", 409);
        }
        await tx.delete(kitchenViewingAvailability).where(eq(kitchenViewingAvailability.kitchenId, kitchenId));
        await tx.insert(kitchenViewingAvailability).values(copied.map((hour) => ({ kitchenId, ...hour })));
        const closures = await tx.select().from(kitchenDateOverrides)
          .where(and(eq(kitchenDateOverrides.kitchenId, kitchenId), eq(kitchenDateOverrides.isAvailable, false)));
        const existingBlackouts = await tx.select().from(kitchenViewingBlackouts)
          .where(eq(kitchenViewingBlackouts.kitchenId, kitchenId));
        const timezone = DEFAULT_TIMEZONE;
        const copiedBlackouts = bookingClosuresForTours(closures, timezone).map((closure) => ({ kitchenId, ...closure }))
          .filter((closure) => !existingBlackouts.some((existing) =>
          existing.startDate.getTime() <= closure.startDate.getTime() && existing.endDate.getTime() >= closure.endDate.getTime()));
        if (copiedBlackouts.length) await tx.insert(kitchenViewingBlackouts).values(copiedBlackouts);
      }
      const [settings] = existing
        ? await tx.update(kitchenViewingSettings).set({ isActive: true, updatedAt: new Date() })
          .where(eq(kitchenViewingSettings.kitchenId, kitchenId)).returning()
        : await tx.insert(kitchenViewingSettings).values({ kitchenId, isActive: true }).returning();
      const availability = await tx.select().from(kitchenViewingAvailability)
        .where(eq(kitchenViewingAvailability.kitchenId, kitchenId));
      const blackouts = await tx.select().from(kitchenViewingBlackouts)
        .where(eq(kitchenViewingBlackouts.kitchenId, kitchenId));
      return { settings, availability, blackouts, timezone: DEFAULT_TIMEZONE };
    });
    res.json(result);
  } catch (error) {
    if (error instanceof TourSetupError) return res.status(error.status).json({ error: error.message });
    return errorResponse(res, error);
  }
});

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
      const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (slots.some(slot => !slot || !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6
        || !clock.test(slot.startTime) || !clock.test(slot.endTime)
        || (slot.isAvailable !== undefined && typeof slot.isAvailable !== 'boolean')
        || (slot.isAvailable !== false && slot.endTime === slot.startTime))) {
        return res.status(400).json({ error: "Choose valid weekdays and different start/end times. An earlier end is on the next day." });
      }

      // Delete existing and insert new in a transaction
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 7)`);
        const previous = await tx.select().from(kitchenViewingAvailability).where(eq(kitchenViewingAvailability.kitchenId, kitchenId));
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
        const canonical = (rows: any[]) => rows.map(row => ({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, isAvailable: row.isAvailable ?? true }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        if (JSON.stringify(canonical(previous)) !== JSON.stringify(canonical(slots)))
          await queueScheduleProblems(tx, { kitchenId, actorId: managerId, tourIds: await affectedTours(tx, kitchenId),
            change: { slots: canonical(slots), occurrence: randomUUID() }, description: 'Tour availability changed. Your confirmed tour is still recorded at its original time. Please review this request for updated arrangements.' });
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
        .select({ id: kitchens.id, locationId: kitchens.locationId, timezone: locations.timezone })
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
      const scope = req.body.scope ?? "tour-kitchen";
      if (typeof scope !== "string" || !["tour-kitchen", "kitchen", "facility"].includes(scope)) {
        return res.status(400).json({ error: "Invalid exception scope" });
      }
      const startKey = String(parsed.data.startDate).slice(0, 10);
      const endKey = String(parsed.data.endDate).slice(0, 10);
      const dates = blackoutDateKeys(startKey, endKey);
      if (!dates.length) return res.status(400).json({ error: "Choose a valid date range of at most one year" });
      const timezone = DEFAULT_TIMEZONE;
      const window = { startDate: tourBlackoutForDate(startKey, timezone, null).startDate,
        endDate: tourBlackoutForDate(endKey, timezone, null).endDate };
      const targetIds = scope === "facility"
        ? (await db.select({ id: kitchens.id }).from(kitchens).where(eq(kitchens.locationId, kitchen.locationId))).map(row => row.id).sort((a, b) => a - b)
        : [kitchenId];
      const result = await db.transaction(async tx => {
        for (const id of targetIds) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${id}, 0)`);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${id}, 7)`);
        }
        const pendingBookings: Array<{ kitchenId: number; date: string }> = [];
        const pendingTours: number[] = [];
        const affectedIds: number[] = [];
        for (const id of targetIds) {
          const blackouts = await tx.select().from(kitchenViewingBlackouts)
            .where(eq(kitchenViewingBlackouts.kitchenId, id));
          if (!blackouts.some(item => item.startDate <= window.startDate && item.endDate >= window.endDate)) {
            pendingTours.push(id);
          }
          if (scope === "tour-kitchen") continue;
          const [weekly, overrides, bookings] = await Promise.all([
            tx.select().from(kitchenAvailability).where(eq(kitchenAvailability.kitchenId, id)),
            tx.select().from(kitchenDateOverrides).where(eq(kitchenDateOverrides.kitchenId, id)),
            tx.select({ id: kitchenBookings.id, bookingDate: kitchenBookings.bookingDate, status: kitchenBookings.status })
              .from(kitchenBookings).where(eq(kitchenBookings.kitchenId, id)),
          ]);
          for (const date of dates) {
            if (overrides.some(item => item.specificDate.toISOString().slice(0, 10) === date)) continue;
            const specificDate = new Date(`${date}T12:00:00Z`);
            const proposed = { kitchenId: id, specificDate, isAvailable: false,
              startTime: "00:00", endTime: "00:00" };
            if (hasOverlappingOperatingDays(weekly, [...overrides.map(item => ({ ...item,
              startTime: item.startTime || "00:00", endTime: item.endTime || "00:00",
            })), proposed])) throw new TourSetupError("A closure conflicts with neighboring operating hours", 400);
            overrides.push({ id: -pendingBookings.length - 1, kitchenId: id, specificDate, isAvailable: false,
              startTime: null, endTime: null, reason: parsed.data.reason ?? null, createdAt: new Date(), updatedAt: new Date() });
            affectedIds.push(...activeBookingIdsOnOperatingDate(bookings, date));
            pendingBookings.push({ kitchenId: id, date });
          }
        }
        const acknowledged = Array.isArray(req.body.acknowledgedBookingIds) && req.body.acknowledgedBookingIds.every(Number.isSafeInteger)
          ? [...req.body.acknowledgedBookingIds].sort((a: number, b: number) => a - b) : [];
        affectedIds.sort((a, b) => a - b);
        if (JSON.stringify(affectedIds) !== JSON.stringify(acknowledged)) {
          throw new TourBlackoutAffectsBookingsError(affectedIds);
        }
        for (const item of pendingBookings) {
          await tx.insert(kitchenDateOverrides).values({ kitchenId: item.kitchenId,
            specificDate: new Date(`${item.date}T12:00:00Z`), isAvailable: false,
            startTime: null, endTime: null, reason: parsed.data.reason ?? null });
        }
        let sourceBlackout;
        for (const id of pendingTours) {
          const [created] = await tx.insert(kitchenViewingBlackouts).values({ kitchenId: id,
            ...window, reason: parsed.data.reason ?? null }).returning();
          if (id === kitchenId) sourceBlackout = created;
        }
        for (const id of targetIds) {
          if (!pendingTours.includes(id) && !pendingBookings.some(item => item.kitchenId === id)) continue;
          await queueScheduleProblems(tx, { kitchenId: id, actorId: managerId, bookingIds: affectedIds,
            tourIds: await affectedTours(tx, id, dates), change: { dates, scope, reason: parsed.data.reason ?? null, occurrence: sourceBlackout?.id || randomUUID() },
            description: `Kitchen/tour closure ${startKey}–${endKey}. ${parsed.data.reason || ''} Please review this request for help with your affected visit.` });
        }
        return { blackout: sourceBlackout, appliedKitchenIds: targetIds,
          skippedBookingDates: scope === "tour-kitchen" ? 0 : targetIds.length * dates.length - pendingBookings.length };
      });

      res.json(result);
    } catch (error) {
      if (error instanceof TourBlackoutAffectsBookingsError) return res.status(409).json({
        code: "BOOKINGS_AFFECTED", error: error.message, bookingIds: error.bookingIds,
      });
      if (error instanceof TourSetupError) return res.status(error.status).json({ error: error.message });
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
      const scope = req.query.scope ?? "tour-kitchen";
      if (typeof scope !== "string" || !["tour-kitchen", "kitchen", "facility"].includes(scope)) {
        return res.status(400).json({ error: "Invalid exception scope" });
      }
      const [source] = await db.select({ blackout: kitchenViewingBlackouts, locationId: kitchens.locationId,
        timezone: locations.timezone, managerId: locations.managerId })
        .from(kitchenViewingBlackouts).innerJoin(kitchens, eq(kitchenViewingBlackouts.kitchenId, kitchens.id))
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchenViewingBlackouts.id, blackoutId)).limit(1);
      if (!source || source.managerId !== managerId) {
        return res.status(404).json({ error: "Blackout not found or access denied" });
      }
      const timezone = DEFAULT_TIMEZONE;
      const startKey = tourDateKey(source.blackout.startDate);
      const endKey = tourDateKey(source.blackout.endDate);
      const dates = blackoutDateKeys(startKey, endKey);
      if (scope !== "tour-kitchen" && !dates.length) {
        return res.status(400).json({ error: "This blackout date range cannot be copied to bookings" });
      }
      const targetIds = scope === "facility"
        ? (await db.select({ id: kitchens.id }).from(kitchens).where(eq(kitchens.locationId, source.locationId))).map(row => row.id).sort((a, b) => a - b)
        : [source.blackout.kitchenId];
      const result = await db.transaction(async tx => {
        for (const id of targetIds) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${id}, 0)`);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${id}, 7)`);
        }
        const matching = [] as typeof source.blackout[];
        const bookingRows = [] as Array<{ id: number; kitchenId: number }>;
        for (const id of targetIds) {
          const blackouts = await tx.select().from(kitchenViewingBlackouts)
            .where(eq(kitchenViewingBlackouts.kitchenId, id));
          const match = blackouts.find(item => item.id === blackoutId ||
            (item.startDate.getTime() === source.blackout.startDate.getTime()
              && item.endDate.getTime() === source.blackout.endDate.getTime()
              && item.reason === source.blackout.reason));
          if (id === source.blackout.kitchenId && !match) throw new TourSetupError("This exception changed. Refresh and try again.", 409);
          if (match) matching.push(match);
          if (scope === "tour-kitchen") continue;
          const [weekly, overrides] = await Promise.all([
            tx.select().from(kitchenAvailability).where(eq(kitchenAvailability.kitchenId, id)),
            tx.select().from(kitchenDateOverrides).where(eq(kitchenDateOverrides.kitchenId, id)),
          ]);
          const removed = overrides.filter(row => dates.includes(row.specificDate.toISOString().slice(0, 10))
            && !row.isAvailable && row.startTime === null && row.endTime === null
            && row.reason === source.blackout.reason);
          if (hasOverlappingOperatingDays(weekly, overrides.filter(row => !removed.some(item => item.id === row.id))
            .map(row => ({ ...row, startTime: row.startTime || "00:00", endTime: row.endTime || "00:00" })))) {
            throw new TourSetupError("Removing these closures conflicts with neighboring operating hours", 400);
          }
          bookingRows.push(...removed.map(row => ({ id: row.id, kitchenId: id })));
        }
        for (const row of bookingRows) await tx.delete(kitchenDateOverrides).where(eq(kitchenDateOverrides.id, row.id));
        for (const row of matching) await tx.delete(kitchenViewingBlackouts).where(eq(kitchenViewingBlackouts.id, row.id));
        for (const id of targetIds) {
          if (!matching.some(row => row.kitchenId === id) && !bookingRows.some(row => row.kitchenId === id)) continue;
          const bookings = scope === 'tour-kitchen' ? [] : await tx.select({ id: kitchenBookings.id, bookingDate: kitchenBookings.bookingDate, status: kitchenBookings.status })
            .from(kitchenBookings).where(eq(kitchenBookings.kitchenId, id));
          await queueScheduleProblems(tx, { kitchenId: id, actorId: managerId,
            bookingIds: dates.flatMap(date => activeBookingIdsOnOperatingDate(bookings, date)), tourIds: await affectedTours(tx, id, dates),
            change: { removedBlackoutId: blackoutId, scope },
            description: 'Kitchen/tour availability was restored. Please review this request to confirm your visit arrangements.' });
        }
        return { deleted: true, appliedKitchenIds: matching.map(row => row.kitchenId), removedBookingDates: bookingRows.length };
      });
      res.json(result);
    } catch (error) {
      if (error instanceof TourSetupError) return res.status(error.status).json({ error: error.message });
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
  authenticateSelfExclusion,
  async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const dateStr = req.query.date as string; // YYYY-MM-DD
      const ignoreViewingId = await authorizedSelfExclusion(req, kitchenId);
      if (ignoreViewingId) res.setHeader('Cache-Control', 'private, no-store');

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
        .where(and(eq(kitchens.id, kitchenId), eq(kitchens.isActive, true), eq(kitchens.listingStatus, "active")))
        .limit(1);

      if (!kitchen) {
        return res.status(404).json({ error: "Kitchen not found" });
      }

      const timezone = DEFAULT_TIMEZONE;
      const slots = await calculateAvailableSlots(kitchenId, dateStr, timezone, undefined, { ignoreViewingId });

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
        .where(and(eq(kitchens.id, targetedKitchenId), eq(kitchens.locationId, locationId), eq(kitchens.isActive, true), eq(kitchens.listingStatus, "active")))
        .limit(1);

      if (!kitchen) {
        return res.status(400).json({ error: "Kitchen does not belong to this location" });
      }

      if (!kitchen.managerId) {
        return res.status(409).json({ error: "Tours are unavailable until a kitchen manager is assigned" });
      }

      const [application] = await db.select({ id: chefKitchenApplications.id }).from(chefKitchenApplications)
        .where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1);
      if (application) return res.status(409).json({ error: "You have already applied to this kitchen location. Continue through My Applications." });

      const timezone = DEFAULT_TIMEZONE;

      // Get settings
      const [settings] = await db
        .select()
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, targetedKitchenId))
        .limit(1);

      if (!settings || !settings.isActive) {
        return res.status(400).json({ error: "Tours are not currently available for this kitchen" });
      }

      const tourDuration = settings.defaultDurationMinutes;
      if (durationMinutes != null && durationMinutes !== tourDuration) {
        return res.status(400).json({ error: "Tour duration must match this kitchen's tour settings" });
      }
      const scheduledDate = new Date(scheduledAt as string);
      if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ error: "Invalid tour date" });

      const [existingActiveTour] = await db
        .select({ id: kitchenViewings.id })
        .from(kitchenViewings)
        .where(
          and(
            eq(kitchenViewings.chefId, chefId),
            eq(kitchenViewings.targetedKitchenId, targetedKitchenId),
            sql`${kitchenViewings.status} IN ('pending_local_cooks', 'pending', 'confirmed')`,
            sql`${kitchenViewings.scheduledAt} + (${kitchenViewings.durationMinutes} || ' minutes')::interval > NOW()`
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
          error: `Tours must be booked at least ${settings.advanceNoticeHours} hours in advance`,
        });
      }

      const date = tourDateKey(scheduledDate);
      const availableSlots = await calculateAvailableSlots(targetedKitchenId, date, timezone);
      if (!availableSlots.some(slot => new Date(slot.scheduledAt).getTime() === scheduledDate.getTime())) {
        return res.status(409).json({ error: "That tour time is no longer available" });
      }

      // CONCURRENCY-SAFE BOOKING: Use a transaction with conflict detection
      // We check for overlapping viewings within the transaction to prevent double-booking
      let newViewing: any;

      await db.transaction(async (tx) => {
        await lockTourKitchen(tx, targetedKitchenId);
        const [currentKitchen] = await tx.select({ isActive: kitchens.isActive, listingStatus: kitchens.listingStatus, locationId: kitchens.locationId })
          .from(kitchens).where(eq(kitchens.id, targetedKitchenId)).limit(1).for('share');
        const [currentSettings] = await tx.select().from(kitchenViewingSettings).where(eq(kitchenViewingSettings.kitchenId, targetedKitchenId)).limit(1);
        if (!currentKitchen?.isActive || currentKitchen.listingStatus !== 'active' || currentKitchen.locationId !== locationId
          || !currentSettings?.isActive || currentSettings.defaultDurationMinutes !== tourDuration) {
          throw new DomainError('TOUR_SETTINGS_CHANGED', 'Tour setup has changed. Choose an available tour time again', 409);
        }
        const currentSlots = await calculateAvailableSlots(targetedKitchenId, date, timezone, undefined, { connection: tx });
        if (!currentSlots.some(slot => new Date(slot.scheduledAt).getTime() === scheduledDate.getTime())) throw new DomainError('SLOT_TAKEN', 'That tour time is no longer available', 409);
        const [active] = await tx.select({ id: kitchenViewings.id }).from(kitchenViewings).where(and(
          eq(kitchenViewings.chefId, chefId), eq(kitchenViewings.targetedKitchenId, targetedKitchenId),
          sql`${kitchenViewings.status} IN ('pending_local_cooks', 'pending', 'confirmed')`,
          sql`${kitchenViewings.scheduledAt} + (${kitchenViewings.durationMinutes} || ' minutes')::interval > NOW()`
        )).limit(1);
        if (active) throw new Error("ACTIVE_TOUR_EXISTS");
        // Check for conflicting viewings within the transaction
        const tourStart = scheduledDate;
        const tourEnd = addMinutes(scheduledDate, tourDuration);
        const bufferStart = addMinutes(tourStart, -currentSettings.bufferBeforeMinutes);
        const bufferEnd = addMinutes(tourEnd, currentSettings.bufferAfterMinutes);

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
        await queueTourEvent(tx, { kind: 'requested', before: newViewing, after: newViewing, actorId: chefId, actorRole: 'chef' });
      });

      const delivery = await attemptTourDelivery(newViewing.id);
      logger.info(`[Viewings] Chef ${chefId} booked viewing ${newViewing.id} for kitchen ${targetedKitchenId} at ${scheduledDate.toISOString()}`);
      res.status(201).json({ ...publicTour(newViewing), notificationDeliveryFailed: delivery.failed });
    } catch (error: any) {
      if (error.message === "ACTIVE_TOUR_EXISTS") return res.status(409).json({ error: "You already have an active tour request for this kitchen.", code: "ACTIVE_TOUR_EXISTS" });
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
          locationContactEmail: locations.contactEmail,
          locationContactPhone: locations.contactPhone,
          timezone: locations.timezone,
          kitchenName: kitchens.name,
          managerId: locations.managerId,
          chefEmail: users.username,
          arrivalNotes: kitchenViewingSettings.arrivalNotes,
          departureNotes: kitchenViewingSettings.departureNotes,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .leftJoin(kitchenViewingSettings, eq(kitchenViewings.targetedKitchenId, kitchenViewingSettings.kitchenId))
        .where(eq(kitchenViewings.chefId, chefId))
        .orderBy(desc(kitchenViewings.updatedAt), desc(kitchenViewings.id));

      const results = await query;

      // Filter by status if provided
      const filtered = status
        ? results.filter((r) => r.viewing.status === status)
        : results;

      const chefName = await getUserDisplayName(chefId, "chef");
      const managerIds = Array.from(new Set(filtered.map((r) => r.managerId).filter((id): id is number => id != null)));
      const managerNames = new Map(await Promise.all(managerIds.map(async (id) => [id, await getUserDisplayName(id, "manager")] as const)));
      const managerContacts = new Map(await Promise.all(managerIds.map(async (id) => [id, (await db.select({ email: users.username, phone: users.phoneNumber }).from(users).where(eq(users.id, id)).limit(1))[0]] as const)));
      const attendanceSettings = new Map<number, ReturnType<typeof getCheckinSettings>>();
      const withNames = await Promise.all(
        filtered.map(async (r) => ({
          ...r,
          viewing: await publicTourAttendance(r.viewing, attendanceSettings),
          arrivalNotes: r.viewing.status === "confirmed" ? r.arrivalNotes : null,
          departureNotes: r.viewing.status === "confirmed" || (r.viewing.checkedInAt && !r.viewing.checkedOutAt) ? r.departureNotes : null,
          locationContactEmail: r.viewing.status === "confirmed" ? r.locationContactEmail || (r.managerId && managerContacts.get(r.managerId)?.email) || null : null,
          locationContactPhone: r.viewing.status === "confirmed" ? r.locationContactPhone || (r.managerId && managerContacts.get(r.managerId)?.phone) || null : null,
          managerName: r.managerId ? managerNames.get(r.managerId) : null,
          chefName,
        }))
      );

      res.json(withNames);
    } catch (error) {
      logger.error("Error fetching chef viewings:", error);
      return errorResponse(res, error);
    }
  }
);

/** A live, owner-only confirmation document for a manager-confirmed tour. */
router.get(
  "/chef/:id/confirmation",
  requireFirebaseAuthWithUser,
  requireChef,
  async (req: Request, res: Response) => {
    try {
      const viewingId = Number(req.params.id);
      if (!Number.isSafeInteger(viewingId) || viewingId < 1) return res.status(400).json({ error: "Invalid tour reference" });
      const [record] = await db.select({
        viewing: kitchenViewings,
        locationName: locations.name,
        locationAddress: locations.address,
        locationContactEmail: locations.contactEmail,
        locationContactPhone: locations.contactPhone,
        timezone: locations.timezone,
        kitchenName: kitchens.name,
        chefEmail: users.username,
      })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(and(eq(kitchenViewings.id, viewingId), eq(kitchenViewings.chefId, req.neonUser!.id)))
        .limit(1);
      if (!record) return res.status(404).json({ error: "Tour not found" });
      if (record.viewing.status !== "confirmed" || record.viewing.scheduledAt.getTime() + record.viewing.durationMinutes * 60_000 < Date.now()) return res.status(409).json({ error: "A confirmation document is available only for upcoming confirmed tours" });
      const [manager] = record.viewing.managerId ? await db.select({ email: users.username, phone: users.phoneNumber }).from(users).where(eq(users.id, record.viewing.managerId)).limit(1) : [null];

      const pdf = await buildTourConfirmationPdf({
        id: record.viewing.id,
        chefName: await getUserDisplayName(req.neonUser!.id, "chef"),
        chefEmail: record.chefEmail || "",
        locationName: record.locationName || "Kitchen location",
        kitchenName: record.kitchenName,
        locationAddress: record.locationAddress,
        managerName: record.viewing.managerId ? await getUserDisplayName(record.viewing.managerId, "manager") : null,
        managerEmail: record.locationContactEmail || manager?.email || null,
        managerPhone: record.locationContactPhone || manager?.phone || null,
        scheduledAt: record.viewing.scheduledAt,
        durationMinutes: record.viewing.durationMinutes,
        submittedAt: record.viewing.createdAt,
        timezone: DEFAULT_TIMEZONE,
        chefNotes: record.viewing.chefNotes,
        intakeData: record.viewing.intakeData as Record<string, unknown> | null,
        managerNotes: record.viewing.sharedManagerNotes,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${tourReference(viewingId)}-confirmation.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(pdf);
    } catch (error) {
      logger.error("Error generating tour confirmation:", error);
      return errorResponse(res, error);
    }
  }
);

/** Keep the confirmed slot until the manager accepts a chef's change request. */
router.get('/chef/:id/attendance', requireFirebaseAuthWithUser, requireChef, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid tour' });
    const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1);
    if (!tour || tour.chefId !== req.neonUser!.id) return res.status(404).json({ error: 'Tour not found' });
    const settings = await getCheckinSettings(tour.locationId);
    return res.json(tourAttendance(tour, settings.checkinWindowMinutesBefore));
  } catch (error) { return errorResponse(res, error); }
});

router.post('/chef/:id/check-in', requireFirebaseAuthWithUser, requireChef, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid tour' });
    const result = await db.transaction(async tx => {
      const { tour } = await lockedTour(tx, id);
      if (tour.chefId !== req.neonUser!.id) throw new DomainError('FORBIDDEN', 'Tour not found', 404);
      const settings = await getCheckinSettings(tour.locationId);
      const now = new Date(), attendance = tourAttendance(tour, settings.checkinWindowMinutesBefore, now);
      if (attendance.safetyReason) throw new DomainError('TOUR_CHANGED', attendance.safetyReason, 409);
      // A lost response can be retried with the prior version, without creating another event.
      if (tour.checkedInAt) return { attendance, changed: false };
      checkTourVersion(tour, req.body?.expectedUpdatedAt, true);
      if (!attendance.canCheckIn) throw new DomainError('TOUR_ARRIVAL_UNAVAILABLE', attendance.reason!, 409);
      const entry: TourAttendanceEntry = { action: 'check_in', actorId: req.neonUser!.id, source: 'visitor',
        actualAt: now.toISOString(), recordedAt: now.toISOString(), scheduledAt: tour.scheduledAt.toISOString() };
      const [updated] = await tx.update(kitchenViewings).set({ checkedInAt: now,
        attendanceHistory: [...(Array.isArray(tour.attendanceHistory) ? tour.attendanceHistory : []), entry],
        updatedAt: new Date(Math.max(now.getTime(), tour.updatedAt.getTime() + 1)),
      }).where(and(eq(kitchenViewings.id, id), eq(kitchenViewings.status, 'confirmed'),
        eq(kitchenViewings.scheduledAt, tour.scheduledAt), sql`${kitchenViewings.checkedInAt} IS NULL`,
        sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${tour.updatedAt.toISOString()}::timestamp`)).returning();
      if (!updated) throw new DomainError('TOUR_CHANGED', 'This tour has changed. Refresh and try again', 409);
      await queueTourEvent(tx, { kind: 'visitor_checkin', before: tour, after: updated, actorId: req.neonUser!.id, actorRole: 'chef' });
      return { attendance: tourAttendance(updated, settings.checkinWindowMinutesBefore, now), changed: true };
    });
    const delivery = result.changed ? await attemptTourDelivery(id) : { failed: false };
    return res.json({ ...result.attendance, notificationDeliveryFailed: delivery.failed });
  } catch (error) { return errorResponse(res, error); }
});

router.get('/manager/:id/attendance', requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid tour' });
    // Use current location ownership, never the historical tour.managerId.
    const attendance = await db.transaction(async tx => {
      const { tour, location } = await lockedTour(tx, id);
      if (location.managerId !== req.neonUser!.id) throw new DomainError('FORBIDDEN', 'Tour not found', 404);
      const settings = await getCheckinSettings(tour.locationId);
      return tourAttendance(tour, settings.checkinWindowMinutesBefore);
    });
    return res.json(attendance);
  } catch (error) { return errorResponse(res, error); }
});

async function recordTourAction(req: Request, res: Response, assisted: boolean) {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a valid tour' });
    const result = await db.transaction(async tx => {
      const { tour, location } = await lockedTour(tx, id);
      const actorId = req.neonUser!.id;
      if (assisted ? location.managerId !== actorId : tour.chefId !== actorId)
        throw new DomainError('FORBIDDEN', 'Tour not found', 404);
      const settings = await getCheckinSettings(tour.locationId);
      const now = new Date(), attendance = tourAttendance(tour, settings.checkinWindowMinutesBefore, now);
      let actual = now, reason: string | undefined;
      if (assisted) {
        try { ({ actual, reason } = validateAttendanceAssistance(req.body || {}, now)); }
        catch (error) { throw new DomainError('TOUR_ASSISTANCE_INVALID', (error as Error).message, 400); }
        if (req.body.scheduledAt !== attendance.scheduledAt)
          throw new DomainError('TOUR_CHANGED', 'The reported action must belong to the saved tour schedule; refresh and review', 409);
      }
      const arrival = assisted && req.body.action === 'arrival';
      const field = arrival ? 'checkedInAt' : 'checkedOutAt';
      const safety = arrival ? (attendance.assistArrivalReason === 'Arrival already recorded' ? null : attendance.assistArrivalReason)
        : attendance.departureSafetyReason;
      if (safety) throw new DomainError('TOUR_ATTENDANCE_INVALID', safety, 409);
      if (tour[field]) {
        // Lost responses return original evidence; assistance cannot overwrite a visitor action.
        if (assisted) {
          const entry = attendance.attendanceHistory.find(entry => entry.action === (arrival ? 'check_in' : 'check_out'));
          if (!entry || entry.source !== 'manager_assisted' || entry.actorId !== actorId
            || entry.actualAt !== actual.toISOString() || entry.reason !== reason)
            throw new DomainError('TOUR_ALREADY_RECORDED', 'This action is already recorded; existing evidence is preserved', 409);
        }
        return { attendance, changed: false };
      }
      checkTourVersion(tour, req.body?.expectedUpdatedAt, true);
      if (arrival && (actual < new Date(attendance.checkInOpensAt) || actual > new Date(attendance.checkInClosesAt)))
        throw new DomainError('TOUR_ASSISTANCE_INVALID', 'Reported arrival must be within the effective tour arrival window', 400);
      if (!arrival && actual < new Date(attendance.checkedInAt!))
        throw new DomainError('TOUR_ASSISTANCE_INVALID', 'Departure cannot precede the recorded arrival', 400);
      const entry: TourAttendanceEntry = { action: arrival ? 'check_in' : 'check_out', actorId,
        source: assisted ? 'manager_assisted' : 'visitor', actualAt: actual.toISOString(), recordedAt: now.toISOString(),
        scheduledAt: attendance.scheduledAt, ...(reason ? { reason } : {}) };
      const [updated] = await tx.update(kitchenViewings).set({ [field]: actual,
        attendanceHistory: [...(Array.isArray(tour.attendanceHistory) ? tour.attendanceHistory : []), entry],
        updatedAt: new Date(Math.max(now.getTime(), tour.updatedAt.getTime() + 1)),
      }).where(and(eq(kitchenViewings.id, id), eq(kitchenViewings.scheduledAt, tour.scheduledAt),
        sql`${kitchenViewings[field]} IS NULL`,
        ...(!arrival ? [eq(kitchenViewings.checkedInAt, tour.checkedInAt!)] : []),
        sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${tour.updatedAt.toISOString()}::timestamp`)).returning();
      if (!updated) throw new DomainError('TOUR_CHANGED', 'This tour has changed. Refresh and try again', 409);
      await queueTourEvent(tx, { kind: assisted ? 'attendance_assisted' : 'visitor_checkout', before: tour, after: updated,
        actorId, actorRole: assisted ? 'manager' : 'chef' });
      return { attendance: tourAttendance(updated, settings.checkinWindowMinutesBefore, now), changed: true };
    });
    const delivery = result.changed ? await attemptTourDelivery(id) : { failed: false };
    return res.json({ ...result.attendance, notificationDeliveryFailed: delivery.failed });
  } catch (error) { return errorResponse(res, error); }
}

router.post('/chef/:id/check-out', requireFirebaseAuthWithUser, requireChef, (req, res) => recordTourAction(req, res, false));
router.post('/manager/:id/attendance-assistance', requireFirebaseAuthWithUser, requireManager, (req, res) => recordTourAction(req, res, true));

router.post("/chef/:id/reschedule", requireFirebaseAuthWithUser, requireChef, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id), requestedAt = new Date(req.body?.scheduledAt);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(requestedAt.getTime())) return res.status(400).json({ error: "Choose a valid tour time" });
    const { tour, location, updated } = await db.transaction(async tx => {
      const { tour, location } = await lockedTour(tx, id);
      if (tour.chefId !== req.neonUser!.id) throw new DomainError('FORBIDDEN', 'Tour not found', 404);
      checkTourVersion(tour, req.body?.expectedUpdatedAt);
      if (tour.checkedInAt) throw new DomainError('TOUR_ARRIVED', 'Tour time cannot change after arrival', 409);
      if (tour.status !== "confirmed" || tour.scheduledAt.getTime() <= Date.now()) throw new DomainError('TOUR_CHANGED', 'Only upcoming confirmed tours can be changed', 409);
      if (tour.requestedRescheduleAt) throw new DomainError('TOUR_CHANGED', 'A date change request is already awaiting review', 409);
      if (!tour.targetedKitchenId || requestedAt.getTime() === tour.scheduledAt.getTime()) throw new DomainError('TOUR_TIME_INVALID', 'Choose a different available time', 400);
      const slots = await calculateAvailableSlots(tour.targetedKitchenId, tourDateKey(requestedAt), DEFAULT_TIMEZONE,
        undefined, { connection: tx, ignoreViewingId: tour.id });
      if (!slots.some(slot => new Date(slot.scheduledAt).getTime() === requestedAt.getTime())) throw new DomainError('SLOT_TAKEN', 'That time is no longer available', 409);
      const [updated] = await tx.update(kitchenViewings).set({ requestedRescheduleAt: requestedAt, rescheduleRequestedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(kitchenViewings.id, id), eq(kitchenViewings.status, "confirmed"), eq(kitchenViewings.scheduledAt, tour.scheduledAt),
          sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${tour.updatedAt.toISOString()}::timestamp`, sql`${kitchenViewings.scheduledAt} > clock_timestamp()`, sql`${kitchenViewings.requestedRescheduleAt} IS NULL`)).returning();
      if (!updated) throw new DomainError('TOUR_CHANGED', 'This tour has changed. Refresh and try again', 409);
      await queueTourEvent(tx, { kind: 'reschedule_requested', before: tour, after: updated, actorId: req.neonUser!.id, actorRole: 'chef' });
      return { tour, location, updated };
    });
    const delivery = await attemptTourDelivery(updated.id);
    return res.json({ ...publicTour(updated), notificationDeliveryFailed: delivery.failed });
  } catch (error) { logger.error("Error requesting tour date change:", error); return errorResponse(res, error); }
});

/** Only the current location owner (or admin) can inspect acceptance context. */
router.get('/manager/:id/decision-context', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id), kind = req.query.kind;
    if (!Number.isSafeInteger(id) || id <= 0 || !['confirm', 'reschedule'].includes(String(kind))) return res.status(400).json({ error: 'Choose a valid tour decision' });
    const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).limit(1);
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    const [location] = await db.select({ managerId: locations.managerId }).from(locations).where(eq(locations.id, tour.locationId)).limit(1);
    if (req.neonUser!.role !== 'admin' && !(req.neonUser!.role === 'manager' && location?.managerId === req.neonUser!.id)) return res.status(403).json({ error: 'Access denied' });
    const scheduledAt = kind === 'reschedule' ? tour.requestedRescheduleAt : tour.scheduledAt;
    if (!scheduledAt || (kind === 'reschedule' ? tour.status !== 'confirmed' : tour.status !== 'pending') || tour.scheduledAt.getTime() <= Date.now()) {
      return res.status(409).json({ error: 'This tour no longer has that pending decision. Refresh the tour list' });
    }
    const context = await tourBookingContext(db, tour, scheduledAt);
    return res.json({ ...context, updatedAt: tour.updatedAt.toISOString(), scheduledAt: scheduledAt.toISOString() });
  } catch (error) { return errorResponse(res, error); }
});

router.patch("/manager/:id/reschedule", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id), accepted = req.body?.decision === 'accept';
    if (!Number.isSafeInteger(id) || id <= 0 || !["accept", "decline"].includes(req.body?.decision)) return res.status(400).json({ error: "Invalid date change decision" });
    const { tour, location, updated } = await db.transaction(async tx => {
      const { tour, location } = await lockedTour(tx, id);
      if (location.managerId !== req.neonUser!.id) throw new DomainError('FORBIDDEN', 'Access denied', 403);
      checkTourVersion(tour, req.body?.expectedUpdatedAt, true);
      if (tour.status !== "confirmed" || !tour.requestedRescheduleAt || (tour.scheduledAt.getTime() <= Date.now() && (accepted || !tour.checkedInAt))) throw new DomainError('TOUR_CHANGED', 'No active date change request', 409);
      if (accepted && tour.checkedInAt) throw new DomainError('TOUR_ARRIVED', 'Tour time cannot change after arrival', 409);
      if (accepted) await checkTourAcceptance(tx, tour, tour.requestedRescheduleAt, req.body);
      const [updated] = await tx.update(kitchenViewings).set({
        ...(accepted ? { scheduledAt: tour.requestedRescheduleAt } : {}), managerId: location.managerId,
        requestedRescheduleAt: null, rescheduleRequestedAt: null, updatedAt: new Date(),
      }).where(and(eq(kitchenViewings.id, id), eq(kitchenViewings.status, "confirmed"), sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${tour.updatedAt.toISOString()}::timestamp`,
        eq(kitchenViewings.scheduledAt, tour.scheduledAt), eq(kitchenViewings.requestedRescheduleAt, tour.requestedRescheduleAt),
        accepted || !tour.checkedInAt ? sql`${kitchenViewings.scheduledAt} > clock_timestamp()` : undefined)).returning();
      if (!updated) throw new DomainError('TOUR_CHANGED', 'This request was already handled. Refresh the tour list', 409);
      await queueTourEvent(tx, { kind: accepted ? 'reschedule_accepted' : 'reschedule_declined', before: tour, after: updated, actorId: req.neonUser!.id, actorRole: 'manager' });
      return { tour, location, updated };
    });
    const delivery = await attemptTourDelivery(updated.id);
    return res.json({ ...publicTour(updated), notificationDeliveryFailed: delivery.failed });
  } catch (error) { logger.error("Error reviewing tour date change:", error); return errorResponse(res, error); }
});

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
          locationTimezone: locations.timezone,
          kitchenName: kitchens.name,
          chefUsername: users.username,
          chefEmail: users.username,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(
          and(
            eq(locations.managerId, managerId),
            ne(kitchenViewings.status, "pending_local_cooks"),
            locationId ? eq(kitchenViewings.locationId, locationId) : undefined
          )
        )
        .orderBy(desc(kitchenViewings.scheduledAt));

      // Filter by status if provided
      const filtered = status
        ? results.filter((r) => r.viewing.status === status)
        : results;

      const attendanceSettings = new Map<number, ReturnType<typeof getCheckinSettings>>();
      const withNames = await Promise.all(
        filtered.map(async (r) => ({
          ...r,
          viewing: await publicTourAttendance(r.viewing, attendanceSettings),
          chefName: r.viewing.chefId ? await getUserDisplayName(r.viewing.chefId, 'chef') : 'A chef',
          chefPhone: r.viewing.chefId ? await getChefPhone(r.viewing.chefId) : null,
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
          locationTimezone: locations.timezone,
          kitchenName: kitchens.name,
          chefUsername: users.username,
          chefEmail: users.username,
        })
        .from(kitchenViewings)
        .leftJoin(locations, eq(kitchenViewings.locationId, locations.id))
        .leftJoin(kitchens, eq(kitchenViewings.targetedKitchenId, kitchens.id))
        .leftJoin(users, eq(kitchenViewings.chefId, users.id))
        .where(or(
          eq(kitchenViewings.status, "pending_local_cooks"),
          sql`${kitchenViewings.adminReviewedAt} IS NOT NULL`,
          inArray(kitchenViewings.status, ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'])
        ))
        .orderBy(desc(kitchenViewings.updatedAt));

      res.json(await Promise.all(results.map(async (result) => ({
        ...result,
        chefName: await getUserDisplayName(result.viewing.chefId, "chef"),
        chefPhone: await getChefPhone(result.viewing.chefId),
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
        return res.status(400).json({ error: "A valid tour and decision are required" });
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
      const updated = await db.transaction(async tx => {
        const { tour, location } = await lockedTour(tx, viewingId);
        if (tour.status !== 'pending_local_cooks') throw new DomainError('TOUR_CHANGED', 'This tour request has already been reviewed', 409);
        checkTourVersion(tour, req.body?.expectedUpdatedAt);
        if (decision === 'approved' && tour.scheduledAt.getTime() <= Date.now()) throw new DomainError('TOUR_CHANGED', 'The requested tour time has already passed', 409);
        record.viewing = tour;
        record.viewing.managerId = location.managerId;
        const [updated] = await tx.update(kitchenViewings).set({
          status: nextStatus, managerId: location.managerId, adminReviewDecision: decision,
          adminReviewReason: reason || null, adminReviewerId: req.neonUser!.id, adminReviewedAt: new Date(),
          ...(decision === 'denied' ? { cancelledBy: 'local_cooks', cancellationReason: reason, cancelledAt: new Date() } : {}),
          updatedAt: new Date(),
        }).where(and(eq(kitchenViewings.id, viewingId), eq(kitchenViewings.status, 'pending_local_cooks'),
          sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${tour.updatedAt.toISOString()}::timestamp`, eq(kitchenViewings.scheduledAt, tour.scheduledAt),
          decision === 'approved' ? sql`${kitchenViewings.scheduledAt} > clock_timestamp()` : undefined)).returning();
        if (!updated) throw new DomainError('TOUR_CHANGED', 'This tour request has already changed. Refresh and try again', 409);
        await queueTourEvent(tx, { kind: decision === 'approved' ? 'review_approved' : 'review_denied', before: tour, after: updated, actorId: req.neonUser!.id, actorRole: 'admin' });
        return updated;
      });
      let chatProvisioningFailed = false;
      if (decision === 'approved') {
        try { chatProvisioningFailed = !(await initializeSharedConversation(updated.chefId, updated.locationId)); }
        catch (error) { chatProvisioningFailed = true; logger.error('Tour approved; chat provision needs retry', error); }
      }
      const delivery = await attemptTourDelivery(updated.id);
      res.json({ ...updated, notificationDeliveryFailed: delivery.failed, chatProvisioningFailed,
        ...(chatProvisioningFailed ? { chatProvisioningMessage: 'Tour approved. Messaging could not be prepared; open Messages to retry.' } : {}) });
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
      const viewingId = Number(req.params.id);
      if (!Number.isSafeInteger(viewingId) || viewingId <= 0) return res.status(400).json({ error: "Choose a valid tour" });
      const userId = req.neonUser!.id;

      const parsed = updateKitchenViewingStatusSchema.safeParse({
        ...req.body,
        id: viewingId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      if (req.body?.managerNotes !== undefined && req.neonUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Internal tour notes are admin-only. Use Message to chef for a shared message.' });
      }

      const decision = await db.transaction(async tx => {
      const { tour: viewing, location: tourLocation } = await lockedTour(tx, viewingId);

      // Authorization: chef can only cancel their own, manager can update their location's viewings
      const isChef = viewing.chefId === userId;
      const isManager = req.neonUser!.role === 'manager' && tourLocation?.managerId === userId;
      const isAdmin = req.neonUser!.role === "admin";
      viewing.managerId = tourLocation?.managerId ?? null;
      if (isChef && (parsed.data.sharedManagerNotes !== undefined || parsed.data.disruptionReason)) {
        throw new DomainError('TOUR_DECISION_INVALID', 'Only the manager or Local Cooks can record tour outcomes or send a manager message', 403);
      }

      if (!isChef && !isManager && !isAdmin) {
        throw new DomainError('TOUR_DECISION_INVALID', "Access denied", 403);
      }

      // Chefs can only cancel
      if (isChef && parsed.data.status !== "cancelled") {
        throw new DomainError('TOUR_DECISION_INVALID', "Chefs can only cancel tours", 403);
      }
      if (isChef && !["pending_local_cooks", "pending", "confirmed"].includes(viewing.status)) {
        throw new DomainError('TOUR_DECISION_INVALID', "This tour can no longer be cancelled", 409);
      }
      if (isChef && viewing.scheduledAt.getTime() <= Date.now()) {
        throw new DomainError('TOUR_DECISION_INVALID', "The tour has already started", 409);
      }

      if (isManager && viewing.status === "pending_local_cooks") {
        throw new DomainError('TOUR_DECISION_INVALID', "This request is still under Local Cooks review", 403);
      }

      if (isAdmin && viewing.status === "pending_local_cooks") {
        throw new DomainError('TOUR_DECISION_INVALID', "Use the Local Cooks review action for this request", 403);
      }

      // Detect a stale concurrent decision before validating it against the newly changed outcome.
      checkTourVersion(viewing, req.body?.expectedUpdatedAt, parsed.data.status === 'confirmed' || ['completed', 'no_show'].includes(parsed.data.status) || !!parsed.data.disruptionReason);

      if (!isChef) {
        const allowedTransitions: Record<string, string[]> = {
          pending: ["confirmed", "cancelled"],
          confirmed: ["cancelled", "completed", "no_show"],
          completed: ['no_show', 'cancelled'], no_show: ['completed', 'cancelled'],
          ...(viewing.disruptionReason ? { cancelled: ['completed', 'no_show'] } : {}),
        };
        if (!allowedTransitions[viewing.status]?.includes(parsed.data.status)) {
          throw new DomainError('TOUR_DECISION_INVALID', `Cannot change a ${viewing.status} tour to ${parsed.data.status}`, 409);
        }
        if (["completed", "no_show"].includes(parsed.data.status) && viewing.scheduledAt.getTime() + viewing.durationMinutes * 60_000 > Date.now()) {
          throw new DomainError('TOUR_DECISION_INVALID', "The tour has not ended yet", 409);
        }
        if ((['completed', 'no_show'].includes(parsed.data.status) || parsed.data.disruptionReason) && !hasTourConfirmation(viewing)) {
          throw new DomainError('TOUR_DECISION_INVALID', 'This tour was not confirmed. Close the request instead of recording a visit result.', 409);
        }
        if (parsed.data.disruptionReason && parsed.data.status !== 'cancelled') {
          throw new DomainError('TOUR_DECISION_INVALID', 'Record a disruption separately from attendance', 400);
        }
        if (parsed.data.disruptionReason && viewing.scheduledAt.getTime() + viewing.durationMinutes * 60_000 > Date.now()) {
          throw new DomainError('TOUR_DECISION_INVALID', 'The tour has not ended yet. Use cancellation before the start, or record the disruption after the end.', 409);
        }
        if (parsed.data.status === "confirmed" && viewing.scheduledAt.getTime() <= Date.now()) {
          throw new DomainError('TOUR_DECISION_INVALID', "The requested tour time has already passed", 409);
        }
        if (parsed.data.status === "cancelled" && viewing.status === 'confirmed' && viewing.scheduledAt.getTime() <= Date.now() && !parsed.data.disruptionReason) {
          throw new DomainError('TOUR_DECISION_INVALID', "The tour has already started. Record the outcome instead", 409);
        }
        if ((['completed', 'no_show'].includes(viewing.status) || viewing.disruptionReason) && !parsed.data.sharedManagerNotes?.trim()) {
          throw new DomainError('TOUR_DECISION_INVALID', 'Explain the outcome correction in Message to chef. This explanation is shared with the chef.', 400);
        }
        if (['completed', 'no_show'].includes(viewing.status) && parsed.data.status === 'cancelled' && !parsed.data.disruptionReason) {
          throw new DomainError('TOUR_DECISION_INVALID', 'Choose a disruption reason to correct attendance to a disrupted tour', 400);
        }
        if (parsed.data.disruptionReason === 'other' && !parsed.data.sharedManagerNotes?.trim()) {
          throw new DomainError('TOUR_DECISION_INVALID', 'Explain the other disruption in Message to chef', 400);
        }
      }

      if (parsed.data.status === 'confirmed') await checkTourAcceptance(tx, viewing, viewing.scheduledAt, req.body);

      // Build update data
      const updateData: any = {
        status: parsed.data.status,
        updatedAt: new Date(),
        ...(parsed.data.status === 'confirmed' ? { managerId: tourLocation.managerId } : {}),
      };
      if (["cancelled", "completed", "no_show"].includes(parsed.data.status)) {
        updateData.requestedRescheduleAt = null;
        updateData.rescheduleRequestedAt = null;
      }

      if (parsed.data.managerNotes) {
        updateData.managerNotes = parsed.data.managerNotes;
      }
      if (parsed.data.sharedManagerNotes !== undefined) updateData.sharedManagerNotes = parsed.data.sharedManagerNotes || null;
      if (parsed.data.status === 'completed' || parsed.data.status === 'no_show') updateData.disruptionReason = null;

      if (parsed.data.status === "cancelled") {
        updateData.cancelledBy = isChef ? "chef" : isAdmin ? "local_cooks" : viewing.status === "pending" ? "manager_declined" : "manager";
        updateData.cancellationReason = parsed.data.cancellationReason;
        updateData.cancelledAt = new Date();
        updateData.disruptionReason = parsed.data.disruptionReason || null;
        updateData.completedAt = null;
        updateData.noShowAt = null;
        updateData.noShowReason = null;
      }

      if (parsed.data.status === "no_show") {
        if (!parsed.data.noShowReason) throw new DomainError('TOUR_DECISION_INVALID', 'Select a no-show reason', 400);
        updateData.noShowReason = parsed.data.noShowReason;
        updateData.noShowAt = new Date();
        updateData.completedAt = null;
      }

      if (parsed.data.status === "completed") {
        updateData.completedAt = new Date();
        updateData.noShowAt = null;
        updateData.noShowReason = null;
      }
      if (['cancelled', 'completed', 'no_show'].includes(parsed.data.status)) {
        updateData.outcomeRecordedBy = userId;
        updateData.outcomeHistory = [...(Array.isArray(viewing.outcomeHistory) ? viewing.outcomeHistory : []), {
          from: viewing.status, to: parsed.data.status, actorId: userId, actorRole: req.neonUser!.role,
          recordedAt: new Date().toISOString(), reason: parsed.data.noShowReason || parsed.data.cancellationReason || null,
          notes: parsed.data.managerNotes || null, sharedNotes: parsed.data.sharedManagerNotes || null,
          disruptionReason: parsed.data.disruptionReason || null,
        }];
      }

      updateData.outcomeNotificationPending = false; // New events use the transactional delivery ledger.
      const [updated] = await tx
        .update(kitchenViewings)
        .set(updateData)
        .where(and(eq(kitchenViewings.id, viewingId), eq(kitchenViewings.status, viewing.status),
          eq(kitchenViewings.scheduledAt, viewing.scheduledAt), sql`date_trunc('milliseconds', ${kitchenViewings.updatedAt}) = ${viewing.updatedAt.toISOString()}::timestamp`,
          parsed.data.status === 'confirmed' || (parsed.data.status === 'cancelled' && !parsed.data.disruptionReason && (isChef || viewing.status === 'confirmed'))
            ? sql`${kitchenViewings.scheduledAt} > clock_timestamp()` : undefined,
          ['completed', 'no_show'].includes(parsed.data.status) || parsed.data.disruptionReason
            ? sql`${kitchenViewings.scheduledAt} + ${viewing.durationMinutes} * interval '1 minute' <= clock_timestamp()` : undefined,
        ))
        .returning();
      if (!updated) throw new DomainError('TOUR_DECISION_INVALID', "This tour was updated by someone else. Refresh and try again", 409);

      await queueTourEvent(tx, { kind: 'status', before: viewing, after: updated, actorId: userId, actorRole: req.neonUser!.role });
      return { viewing, updated, isChef, isManager, isAdmin };
      });
      const { viewing, updated, isChef, isManager, isAdmin } = decision;
      const delivery = await attemptTourDelivery(updated.id);
      logger.info(`[Viewings] Viewing ${viewingId} status updated to ${parsed.data.status} by user ${userId}`);
      res.json({ ...(isAdmin ? updated : publicTour(updated)), notificationDeliveryFailed: delivery.failed });
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
        .innerJoin(kitchens, eq(kitchenViewingSettings.kitchenId, kitchens.id))
        .where(and(eq(kitchenViewingSettings.kitchenId, kitchenId), eq(kitchens.isActive, true), eq(kitchens.listingStatus, "active")))
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
