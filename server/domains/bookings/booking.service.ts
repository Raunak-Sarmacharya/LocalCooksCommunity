
import {
    BookingRepository
} from "./booking.repository";
import {
    CreateKitchenBookingDTO,
    KitchenBooking,
    StorageBooking,
    EquipmentBooking,
    BookingPricingResult
} from "./booking.types";
import {
    calculateKitchenBookingPrice,
    calculatePlatformFeeDynamic,
    calculateTotalWithFees,
    calculateDurationHours
} from "../../services/pricing-service";
import { bookingStatusEnum, kitchenBookings, kitchenCheckoutHolds, kitchens, users, locations, equipmentListings, storageListings } from "@shared/schema";
import { logger } from "../../logger";
import { db } from "../../db";
import { eq, and, ne, gt } from "drizzle-orm";
import { sendEmail, generateBookingConfirmationEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } from "../../email";
import { kitchenService } from "../kitchens/kitchen.service";
import { addHour, calendarDateForOperatingTime, getHourlySlotStarts, isRangeWithinOperatingWindow, normalizeBookingSlots } from "@shared/operating-hours";
import { assertConsecutiveBookingSlots } from '@shared/consecutive-booking-slots';
import { getActiveKitchenHolds } from "../../services/kitchen-checkout-holds";
import { isUnambiguousBookingSlot, matchingLocalInstants } from '@shared/booking-dst';

import { chefService } from "../users/chef.service";

import { kitchenBookingPolicies } from '../../services/booking-policy-settings';
import { bookingWindowLastDate, policyBufferMinutes } from '@shared/kitchen-booking-policies';
import { datedOccupiedSlots, occupiedOperatingDates, pairBufferMinutes, slotBlock, type DatedSlot, type SlotBlock } from '@shared/booking-occupancy';
import { weekStartDate, weeklyQuotaMessage } from '@shared/kitchen-booking-quota';
import { waivesBuffer, type BookingRuleOverride } from '../../services/booking-rule-overrides';
import { chefWeeklyMinutes, holdExcluded, weeklyQuotaShortfallsFor, WeeklyChefHoursLimitError } from '../../services/kitchen-booking-quota';

type BookingInterval = { startTime: string; endTime: string };

/** Why a date, day or slot cannot be booked; the picker shows these (spec decision #3). */
export type BookingDayReason = 'closed' | 'booked' | 'held' | 'buffer' | 'notice' | 'beyond_advance_window' | 'clock_change'
    | 'not_open_to_you' | 'weekly_limit' | 'invalid_hours' | 'length' | 'equipment_unavailable' | 'unavailable';

export type BookingDateStatus = {
    /** Some hourly slot can still be requested (open, free, outside the notice period, unambiguous clock). */
    hourly: boolean;
    /** The whole operating day is free for a full-day booking. */
    fullDay: boolean;
    reason: BookingDayReason | null;
    fullDayReason: BookingDayReason | null;
};

type OccupancyEntry = { slot: DatedSlot; buffer: number | null; kind: 'booked' | 'held' };
type BufferContext = { current: number; candidate: number; ignoreBuffer: boolean; timezone: string };

const blockMessages = {
    booked: "One or more selected time slots are no longer available",
    held: 'One or more selected time slots are temporarily reserved',
};

/**
 * Bookings first, then holds (today's order and messages): a slot conflicts with a source when it overlaps it or sits
 * inside the pair buffer (the larger of the two saved buffers). `buffer` marks a conflict that is spacing only.
 */
export function slotConflict(entries: OccupancyEntry[], candidate: DatedSlot, context: BufferContext): { source: 'booked' | 'held'; buffer: boolean } | null {
    for (const source of ['booked', 'held'] as const) {
        let buffered = false;
        for (const entry of entries) {
            if (entry.kind !== source) continue;
            const gap = context.ignoreBuffer ? 0 : pairBufferMinutes(entry.buffer, context.candidate, context.current);
            const block = slotBlock(entry.slot, candidate, gap, context.timezone);
            if (block === 'overlap') return { source, buffer: false };
            if (block === 'buffer') buffered = true;
        }
        if (buffered) return { source, buffer: true };
    }
    return null;
}

/** The picker's reason for one slot. */
export function slotBlockReason(entries: OccupancyEntry[], candidate: DatedSlot, context: BufferContext): SlotBlock | null {
    const conflict = slotConflict(entries, candidate, context);
    return conflict ? conflict.buffer ? 'buffer' : conflict.source : null;
}

const firstReason = (reasons: Array<BookingDayReason | null>) =>
    (['booked', 'held', 'buffer', 'clock_change', 'notice'] as const).find(reason => reasons.includes(reason)) ?? null;

export class BookingService {
    private repo: BookingRepository;

    constructor(repo?: BookingRepository) {
        this.repo = repo || new BookingRepository();
    }

    /**
     * Create a new kitchen booking
     */
    async createKitchenBooking(
        data: CreateKitchenBookingDTO
    ): Promise<KitchenBooking> {
        // Final approval and current access are required for every new booking.
        const kitchen = await kitchenService.getKitchenById(data.kitchenId);
        if (!kitchen) throw new Error("Kitchen not found");
        const pricingMode = data.pricingMode ?? 'hourly';
        if (pricingMode !== 'hourly' && pricingMode !== 'daily') throw new Error('Invalid pricing mode');
        const availability = await this.validateBookingAvailability(data.kitchenId, data.bookingDate, data.startTime, data.endTime, {
            selectedSlots: data.selectedSlots,
            fullDay: pricingMode === 'daily',
        });
        if (!availability.valid || !availability.slots) throw new Error(availability.error || 'Booking unavailable');
        const selectedSlots = availability.slots;
        // Callers hold the kitchen day lock, so this weekly-hours check and the insert cannot interleave with another request.
        const policy = await kitchenBookingPolicies(data.kitchenId);
        const operatingDate = data.bookingDate.toISOString().split('T')[0];
        const weeks = await weeklyQuotaShortfallsFor({ kitchenId: data.kitchenId, chefId: data.chefId, limitHours: policy.weeklyChefHoursLimit,
            proposed: selectedSlots.map(slot => ({ date: operatingDate, windowStartTime: availability.windowStartTime!, ...slot })) });
        if (weeks.length) throw new WeeklyChefHoursLimitError(weeklyQuotaMessage(weeks[0]), weeks, policy.timezone);
        const hourlyRateCents = Number(kitchen.hourlyRate || 0);
        const dailyRateCents = Number(kitchen.dailyRate || 0);
        const minimumHours = Number(kitchen.minimumBookingHours || 0);
        if (pricingMode === 'hourly' && selectedSlots.length < minimumHours) throw new Error(`At least ${minimumHours} hours are required`);
        const appliedRateCents = pricingMode === 'daily' ? dailyRateCents : hourlyRateCents;
        if (!Number.isSafeInteger(appliedRateCents) || appliedRateCents < 0 ||
            (appliedRateCents === 0 && (hourlyRateCents > 0 || dailyRateCents > 0))) {
            throw new Error(`This kitchen does not offer ${pricingMode} booking`);
        }
        const pricing = {
            totalPriceCents: pricingMode === 'daily' ? dailyRateCents : hourlyRateCents * selectedSlots.length,
            hourlyRateCents: appliedRateCents,
            durationHours: selectedSlots.length,
            currency: kitchen.currency || 'CAD',
        };

        if (!data.chefId) {
            throw new Error("Chef ID is required for booking");
        }

        const eligibility = await chefService.getApplicationStatusForBooking(data.chefId, kitchen.locationId, kitchen.id);
        if (!eligibility.canBook) throw new Error(eligibility.message);

        // 2. Calculate service fee
        const serviceFeeCents = await calculatePlatformFeeDynamic(pricing.totalPriceCents);

        // 3. Calculate total
        // We defer total calculation to step 7 (after addons)
        // We actually want to start with 0 for logic consistency if we are recalculating everything including addons.
        // But for step 4, we pass a placeholder.

        // Refactored logic: The original `createKitchenBooking` in `storage-firebase.ts` handles addons pricing somewhat loosely or relies on `createBookingKey`
        // We will assume `data.totalPrice` is passed OR we respect the calculation here.
        // For security, re-calculation is better, but preserving legacy behavior of accepting passed values for now if needed.
        // HOWEVER, the `storage-firebase` implementation re-calculates it:
        // const pricing = await calculateKitchenBookingPrice(...)
        // So we stick to re-calculation.

        // 4. Create Booking
        const booking = await this.repo.createKitchenBooking({
            ...data,
            totalPrice: '0', // Will be updated after calculating addons
            hourlyRate: pricing.hourlyRateCents.toString(),
            durationHours: pricing.durationHours.toString(),
            serviceFee: serviceFeeCents.toString(),
            currency: pricing.currency,
            storageItems: [], 
            equipmentItems: [], 
            selectedSlots: selectedSlots,
            operatingWindowStartTime: availability.windowStartTime,
            pricingMode,
            paymentStatus: data.paymentStatus || 'pending'
        });

        // 6. Create Equipment Bookings
        let equipmentTotalCents = 0;
        const equipmentItemsForJson: Array<{id: number, equipmentListingId: number, name: string, totalPrice: number}> = [];
        logger.info(`[BookingService] Equipment IDs received: ${JSON.stringify(data.selectedEquipmentIds)}`);
        if (data.selectedEquipmentIds && data.selectedEquipmentIds.length > 0) {
            try {
                const { inventoryService } = await import('../inventory/inventory.service');
                for (const eqId of data.selectedEquipmentIds) {
                    logger.info(`[BookingService] Processing equipment ID: ${eqId}`);
                    const listing = await inventoryService.getEquipmentListingById(eqId);
                    logger.info(`[BookingService] Equipment listing found: ${JSON.stringify(listing)}`);
                    if (listing && !listing.archivedAt && listing.availabilityType !== 'included') {
                        // DB stores session_rate in CENTS (e.g., 3500 = $35.00)
                        const sessionRateCents = Math.round(parseFloat(String(listing.sessionRate || '0')));
                        logger.info(`[BookingService] Creating equipment booking: kitchenBookingId=${booking.id}, equipmentListingId=${listing.id}, sessionRateCents=${sessionRateCents}`);
                        
                        // Status must be 'pending' — manager approval required before confirmation
                        const eqBooking = await this.repo.createEquipmentBooking({
                            kitchenBookingId: booking.id,
                            equipmentListingId: listing.id,
                            chefId: data.chefId,
                            startDate: data.bookingDate,
                            endDate: data.bookingDate,
                            status: 'pending',
                            totalPrice: sessionRateCents.toString(),
                            damageDeposit: '0', // Damage deposits are not collected
                            serviceFee: '0',
                            currency: pricing.currency,
                            pricingModel: 'daily' // Equipment uses flat session rate
                        });
                        
                        // Add to equipment_items JSONB array for denormalized storage
                        if (eqBooking) {
                            equipmentItemsForJson.push({
                                id: eqBooking.id,
                                equipmentListingId: listing.id,
                                name: listing.equipmentType || 'Equipment',
                                totalPrice: sessionRateCents
                            });
                        }
                        
                        logger.info(`[BookingService] Equipment booking created successfully for listing ${listing.id}`);
                        equipmentTotalCents += sessionRateCents;
                    }
                }
            } catch (err: any) {
                 logger.error('[BookingService] Error creating equipment bookings:', {
                     error: err?.message || err,
                     stack: err?.stack,
                     selectedEquipmentIds: data.selectedEquipmentIds
                 });
            }
        } else {
            logger.info(`[BookingService] No equipment IDs provided in booking data`);
        }

        // 7. Update Total Price
        // Base Kitchen Price = pricing.totalPriceCents
        // Addons = storageTotalCents + equipmentTotalCents
        // ServiceFee = serviceFeeCents (Wait, strictly kitchen fee? or should it be total fee? 
        // Manager expects 5% of TOTAL volume? Usually yes.
        // So recalculated Service Fee = (Kitchen + Storage + Equipment) * 5%.
        const grandTotalCents = pricing.totalPriceCents + equipmentTotalCents;
        const newServiceFeeCents = await calculatePlatformFeeDynamic(grandTotalCents);

        // Update booking with total price, service fee, storage_items and equipment_items JSONB
        // Store total WITHOUT fee (Customer pays Base + Tax).
        // Store fee for reporting.
        await this.repo.updateKitchenBooking(booking.id, {
            totalPrice: grandTotalCents.toString(),
            serviceFee: newServiceFeeCents.toString(),
            equipmentItems: equipmentItemsForJson
        });

        // Refetch to return complete object
        const updatedBooking = await this.repo.getKitchenBookingById(booking.id);
        return updatedBooking || booking;
    }

    async getBookingById(id: number) {
        return this.repo.getKitchenBookingById(id);
    }

    async updateBookingStatus(id: number, status: 'pending' | 'confirmed' | 'cancelled') {
        return this.repo.updateKitchenBooking(id, { status });
    }

    async cancelBooking(bookingId: number, cancelledByUserId: number, isChef: boolean) {
        const booking = await this.repo.getKitchenBookingById(bookingId);
        if (!booking) throw new Error("Booking not found");

        await this.repo.updateKitchenBooking(bookingId, { status: 'cancelled' });

        // Logic for email notifications would go here
        // We can reuse the extensive logic from storage-firebase or refactor it.
    }

    async getBookingsByKitchenId(kitchenId: number) {
        return this.repo.getKitchenBookingsByKitchenId(kitchenId);
    }
    // For the MVP of this refactor, I will focus on the DB Operation.
    // Notification logic is typically in the ROUTE in the current codebase (bookings.ts lines 426+)
    // We should eventually move that here.
    // We should eventually move that here.

    async createPortalBooking(data: any) {
        const operatingDate = new Date(data.bookingDate).toISOString().slice(0, 10);
        const { withKitchenDayLock } = await import('../../services/kitchen-checkout-holds');
        return withKitchenDayLock(data.kitchenId, operatingDate, async () => {
        const availability = await this.validateBookingAvailability(data.kitchenId, new Date(data.bookingDate), data.startTime, data.endTime, { selectedSlots: data.selectedSlots });
        if (!availability.valid) throw new Error(availability.error || 'Booking unavailable');
        // Map portal/external structure to DB schema (flatten externalContact)
        const dbData = {
            ...data,
            operatingWindowStartTime: availability.windowStartTime,
            selectedSlots: availability.slots,
            // If externalContact object is passed, flatten it
            externalContactName: data.externalContact?.name,
            externalContactEmail: data.externalContact?.email,
            externalContactPhone: data.externalContact?.phone,
            externalContactCompany: data.externalContact?.company,
            // Ensure bookingType is set
            bookingType: data.bookingType || 'portal',
        };

        // Remove nested object if present to avoid schema error? 
        // Drizzle insert might ignore extra fields or throw. Safer to pick fields.
        // But for now, repo.createKitchenBooking takes "CreateKitchenBookingDTO" which is inferred from schema.
        // So I should construct that DTO.

        // Use repo method
        return this.repo.createKitchenBooking(dbData);
        });
    }

    // Proxy methods for repository
    async getBookingsByKitchen(kitchenId: number) {
        return this.repo.getBookingsByKitchen(kitchenId);
    }

    async getKitchenBookingsByChef(chefId: number) {
        return this.repo.getKitchenBookingsByChefId(chefId);
    }

    async getBookingsByManager(managerId: number) {
        return this.repo.getBookingsByManagerId(managerId);
    }


    // ===== STORAGE BOOKINGS =====

    async getStorageBookingsByChef(chefId: number) {
        return this.repo.getStorageBookingsByChefId(chefId);
    }

    async getEquipmentBookingsByChef(chefId: number) {
        return this.repo.getEquipmentBookingsByChefId(chefId);
    }

    async getStorageBookingsByKitchenBooking(kitchenBookingId: number) {
        return this.repo.getStorageBookingsByKitchenBookingId(kitchenBookingId);
    }

    async getEquipmentBookingsByKitchenBooking(kitchenBookingId: number) {
        return this.repo.getEquipmentBookingsByKitchenBookingId(kitchenBookingId);
    }

    async updateStorageBooking(id: number, updates: Partial<StorageBooking>) {
        return this.repo.updateStorageBooking(id, updates);
    }

    async updateEquipmentBooking(id: number, updates: Partial<EquipmentBooking>) {
        return this.repo.updateEquipmentBooking(id, updates);
    }

    // ===== AVAILABILITY LOGIC =====

    /** The kitchen's hours on one operating date: a date override wins over the weekly schedule. */
    async operatingWindow(kitchenId: number, date: Date): Promise<{ startTime: string; endTime: string } | { error: string }> {
        const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date);
        if (dateOverride) {
            if (!dateOverride.isAvailable) return { error: "Kitchen is closed on this date" };
            if (dateOverride.startTime && dateOverride.endTime) return { startTime: dateOverride.startTime, endTime: dateOverride.endTime };
            return { error: "Kitchen availability not properly configured for this date" };
        }
        // Use getUTCDay() since dates are passed as UTC noon to avoid timezone shifts
        const dayAvailability = (await kitchenService.getKitchenAvailability(kitchenId)).find(a => a.dayOfWeek === date.getUTCDay());
        if (!dayAvailability || !dayAvailability.isAvailable) return { error: "Kitchen is not available on this day" };
        return { startTime: dayAvailability.startTime, endTime: dayAvailability.endTime };
    }

    /** Every noncancelled booking and active hold, one dated entry per occupied slot (later days included), with its saved buffer. */
    private async occupancy(kitchenId: number, options: { excludeBookingId?: number; excludeHoldId?: string } = {}) {
        const [bookings, holds] = await Promise.all([this.getBookingsByKitchen(kitchenId), getActiveKitchenHolds(kitchenId)]);
        const live = bookings.filter(booking => booking.status !== 'cancelled'
            && (options.excludeBookingId === undefined || booking.id !== options.excludeBookingId));
        const entries: OccupancyEntry[] = [
            ...live.flatMap(booking => datedOccupiedSlots(booking)
                .map(slot => ({ slot, buffer: booking.bufferMinutesSnapshot ?? null, kind: 'booked' as const }))),
            ...holds.filter(hold => !holdExcluded(hold, options.excludeHoldId)).flatMap(hold => datedOccupiedSlots({
                bookingDate: hold.operatingDate, startTime: '', endTime: '', selectedSlots: hold.selectedSlots, operatingWindowStartTime: hold.windowStartTime,
            }).map(slot => ({ slot, buffer: hold.bufferMinutesSnapshot ?? null, kind: 'held' as const }))),
        ];
        // A full day needs the whole date free: any booking with a slot on it blocks, not only one whose first date it is.
        const occupiedDates = new Set(live.flatMap(booking => Array.from(occupiedOperatingDates(booking))));
        return { entries, occupiedDates };
    }

    private bufferContext(policy: { bookingBufferMinutes?: number; turnoverBufferEnabled?: boolean; timezone: string },
        options: { bufferMinutes?: number | null; override?: unknown } = {}): BufferContext {
        const current = policyBufferMinutes(policy);
        const ignoreBuffer = waivesBuffer(options.override);
        return { current, candidate: ignoreBuffer ? 0 : options.bufferMinutes ?? current, ignoreBuffer, timezone: policy.timezone };
    }

    async validateBookingAvailability(
        kitchenId: number,
        bookingDate: Date,
        startTime: string,
        endTime: string,
        options: {
            selectedSlots?: Array<{ startTime: string; endTime: string }>;
            fullDay?: boolean;
            // Server-owned post-confirmation change context; never forwarded from client input.
            excludeBookingId?: number;
            /** A hold id, or a hold group's id (the head), whose own rows do not block. */
            excludeHoldId?: string;
            // With excludeBookingId: still enforce the kitchen's advance-booking window (a chef replacing their own request).
            keepAdvanceWindow?: boolean;
            /** The saved buffer of the booking/hold/invitation being validated; defaults to the kitchen's current buffer. */
            bufferMinutes?: number | null;
            /** Trusted kitchen override (server-built only): may waive spacing, never actual overlap. */
            override?: BookingRuleOverride;
        } = {}
    ): Promise<{ valid: boolean; error?: string; code?: BookingDayReason; slots?: BookingInterval[]; windowStartTime?: string; windowEndTime?: string }> {
        try {
            const policy = await kitchenBookingPolicies(kitchenId);
            const window = await this.operatingWindow(kitchenId, bookingDate);
            if ('error' in window) return { valid: false, error: window.error, code: 'closed' };

            if (!isRangeWithinOperatingWindow(startTime, endTime, window.startTime, window.endTime)) {
                return { valid: false, error: "Booking time must be within manager-set available hours", code: 'invalid_hours' };
            }

            let requestedIntervals: BookingInterval[];
            try {
                requestedIntervals = normalizeBookingSlots(
                    options.selectedSlots === undefined ? [] : options.selectedSlots, startTime, endTime,
                    window.startTime, window.endTime, !!options.fullDay,
                );
                assertConsecutiveBookingSlots(requestedIntervals, window.startTime);
            } catch (error) {
                return { valid: false, error: error instanceof Error ? error.message : 'Invalid selected slots', code: 'invalid_hours' };
            }

            const dateStr = bookingDate.toISOString().split('T')[0];
            // Kitchen-initiated confirmed changes use excludeBookingId and bypass only the advance window.
            if ((!options.excludeBookingId || options.keepAdvanceWindow) && dateStr > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) {
                return { valid: false, error: `This kitchen takes bookings up to ${policy.maxAdvanceBookingDays} days ahead.`, code: 'beyond_advance_window' };
            }
            if (requestedIntervals.some(slot => !isUnambiguousBookingSlot(dateStr, slot, window.startTime, policy.timezone))) {
                return { valid: false, error: 'This hour is affected by a daylight saving clock change and is unavailable for self-service booking', code: 'clock_change' };
            }
            const { entries, occupiedDates } = await this.occupancy(kitchenId, options);

            // A full-day booking requires the entire day to be free. Hourly bookings only
            // conflict with the discrete slots submitted by the client.
            if (options.fullDay && occupiedDates.has(dateStr)) {
                return { valid: false, error: "Full-day booking is unavailable because this date already has a booking", code: 'booked' };
            }
            const context = this.bufferContext(policy, options);
            const conflicts = requestedIntervals.map(slot => slotConflict(entries, { date: dateStr, windowStartTime: window.startTime, ...slot }, context));
            for (const source of ['booked', 'held'] as const) {
                const conflict = conflicts.find(item => item?.source === source);
                if (conflict) return { valid: false, error: blockMessages[source], code: conflict.buffer ? 'buffer' : source };
            }

            return { valid: true, slots: requestedIntervals, windowStartTime: window.startTime, windowEndTime: window.endTime };
        } catch (error) {
            logger.error('Error validating booking availability:', error);
            return { valid: false, error: "Error validating booking availability", code: 'unavailable' };
        }
    }

    async getAvailableTimeSlots(kitchenId: number, date: Date): Promise<string[]> {
        try {
            return (await this.getAllTimeSlotsWithBookingInfo(kitchenId, date)).filter(slot => !slot.isFullyBooked).map(slot => slot.time);
        } catch (error) {
            logger.error('Error getting available time slots:', error);
            throw error;
        }
    }

    async getAvailableSlots(kitchenId: number, dateStr: string): Promise<{ time: string; available: boolean }[]> {
        try {
            const date = new Date(dateStr);
            const slots = await this.getAvailableTimeSlots(kitchenId, date);
            return slots.map(time => ({ time, available: true }));
        } catch (error) {
            logger.error('Error getting available slots:', error);
            return [];
        }
    }

    /** `excludeBookingId`: the chef's own pending request being changed; its slots show as free to them. */
    async getAllTimeSlotsWithBookingInfo(kitchenId: number, date: Date, excludeBookingId?: number): Promise<Array<{
        time: string;
        available: number;
        capacity: number;
        isFullyBooked: boolean;
        /** Why a fully booked slot is unavailable; 'buffer' marks time kept free between bookings. */
        reason?: SlotBlock | 'clock_change';
    }>> {
        try {
            const policy = await kitchenBookingPolicies(kitchenId);
            if (date.toISOString().slice(0, 10) > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) return [];
            const window = await this.operatingWindow(kitchenId, date);
            if ('error' in window) return [];
            const capacity = 1;
            const dateStr = date.toISOString().split('T')[0];
            const { entries } = await this.occupancy(kitchenId, { excludeBookingId });
            const context = this.bufferContext(policy);

            return getHourlySlotStarts(window.startTime, window.endTime).map(slot => {
                const interval = { startTime: slot, endTime: addHour(slot) };
                const block = slotBlockReason(entries, { date: dateStr, windowStartTime: window.startTime, ...interval }, context);
                const clockSafe = isUnambiguousBookingSlot(dateStr, interval, window.startTime, policy.timezone);
                const reason = block ?? (clockSafe ? undefined : 'clock_change' as const);
                return {
                    time: slot,
                    available: reason ? 0 : capacity,
                    capacity,
                    isFullyBooked: !!reason,
                    ...(reason ? { reason } : {}),
                };
            });
        } catch (error) {
            logger.error('Error getting all time slots with booking info:', error);
            throw error;
        }
    }

    async getStorageBookingById(id: number) {
        return this.repo.getStorageBookingById(id);
    }

    /**
     * Per date of a month. `legacyBookable` keeps the original boolean map exactly (a free, unambiguous, future slot);
     * `status` adds the notice period, full-day eligibility and the reason a date can't be booked.
     * ponytail: a fixed number of DB round-trips regardless of month length (schedule + occupancy reused per day).
     */
    private async monthDates(kitchenId: number, year: number, month: number, options: { excludeBookingId?: number; chefId?: number } = {}) {
        const policy = await kitchenBookingPolicies(kitchenId);
        const scheduleMap = await kitchenService.getMonthAvailability(kitchenId, year, month);
        const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

        const [weeklyAvailability, overrides, { entries, occupiedDates }] = await Promise.all([
            kitchenService.getKitchenAvailability(kitchenId),
            kitchenService.getKitchenDateOverrides(kitchenId, monthStart, monthEnd),
            this.occupancy(kitchenId, { excludeBookingId: options.excludeBookingId }),
        ]);
        const chef = options.chefId ? await this.chefDateLimits(kitchenId, options.chefId, policy.weeklyChefHoursLimit, options.excludeBookingId) : null;
        const timezone = policy.timezone;
        const context = this.bufferContext(policy);
        const lastDate = bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone);
        const noticeMs = Math.max(0, Number(policy.minimumBookingWindowHours ?? 1)) * 3_600_000;

        const weeklyMap = new Map<number, { isAvailable: boolean; startTime: string; endTime: string }>();
        weeklyAvailability.forEach((a: any) => {
            weeklyMap.set(a.dayOfWeek, { isAvailable: !!a.isAvailable, startTime: a.startTime, endTime: a.endTime });
        });
        const overrideMap = new Map<string, typeof overrides[number]>();
        overrides.forEach((o) => overrideMap.set(new Date(o.specificDate).toISOString().split('T')[0], o));

        const now = Date.now();
        const closed = (reason: BookingDayReason): { legacyBookable: boolean; status: BookingDateStatus } =>
            ({ legacyBookable: false, status: { hourly: false, fullDay: false, reason, fullDayReason: reason } });
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const result: Array<{ date: string; legacyBookable: boolean; status: BookingDateStatus }> = [];

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
            const dateStr = date.toISOString().split('T')[0];
            if (dateStr > lastDate) { result.push({ date: dateStr, ...closed('beyond_advance_window') }); continue; }
            const override = overrideMap.get(dateStr);
            const weekly = weeklyMap.get(date.getUTCDay());
            const window = override
                ? (override.isAvailable && override.startTime && override.endTime ? { startTime: override.startTime, endTime: override.endTime } : null)
                : (weekly?.isAvailable && weekly.startTime && weekly.endTime ? { startTime: weekly.startTime, endTime: weekly.endTime } : null);
            if (!scheduleMap[dateStr] || !window) { result.push({ date: dateStr, ...closed('closed') }); continue; }

            const slots = getHourlySlotStarts(window.startTime, window.endTime).map(slot => {
                const interval = { startTime: slot, endTime: addHour(slot) };
                const block = slotBlockReason(entries, { date: dateStr, windowStartTime: window.startTime, ...interval }, context);
                if (!isUnambiguousBookingSlot(dateStr, interval, window.startTime, timezone)) return { reason: block ?? 'clock_change' as const, past: true };
                const start = matchingLocalInstants(calendarDateForOperatingTime(dateStr, slot, window.startTime), slot, timezone)[0];
                return { reason: block ?? (start < now + noticeMs ? 'notice' as const : null), past: !(start > now) };
            });
            let hourly = slots.some(slot => !slot.reason);
            let fullDay = slots.length > 0 && !occupiedDates.has(dateStr) && slots.every(slot => !slot.reason);
            let reason: BookingDayReason | null = hourly ? null : firstReason(slots.map(slot => slot.reason));
            let fullDayReason: BookingDayReason | null = fullDay ? null : occupiedDates.has(dateStr) ? 'booked' : firstReason(slots.map(slot => slot.reason));
            if (chef && !chef.canBook) {
                hourly = fullDay = false;
                reason = fullDayReason = 'not_open_to_you';
            } else if (chef?.remainingMinutes) {
                const remaining = chef.remainingMinutes(dateStr);
                if (hourly && remaining < 60) { hourly = fullDay = false; reason = fullDayReason = 'weekly_limit'; }
                else if (fullDay && remaining < slots.length * 60) { fullDay = false; fullDayReason = 'weekly_limit'; }
            }
            result.push({ date: dateStr, legacyBookable: slots.some(slot => !slot.past && (!slot.reason || slot.reason === 'notice')),
                status: { hourly, fullDay, reason, fullDayReason } });
        }
        return result;
    }

    /** Chef-only facts for the picker: never served by public month maps (a chef's remaining hours stay private). */
    private async chefDateLimits(kitchenId: number, chefId: number, weeklyLimitHours: number | null, excludeBookingId?: number) {
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        const access = await chefService.getApplicationStatusForBooking(chefId, kitchen.locationId, kitchenId);
        if (weeklyLimitHours == null) return { canBook: access.canBook, remainingMinutes: null };
        const counted = await chefWeeklyMinutes({ kitchenId, chefId, excludeBookingId });
        return { canBook: access.canBook,
            remainingMinutes: (date: string) => weeklyLimitHours * 60 - (counted.get(weekStartDate(date)) ?? 0) };
    }

    /** Month availability where a day is true only if at least one bookable slot remains (kept for current clients). */
    async getMonthBookableAvailability(kitchenId: number, year: number, month: number, excludeBookingId?: number): Promise<Record<string, boolean>> {
        const dates = await this.monthDates(kitchenId, year, month, { excludeBookingId });
        return Object.fromEntries(dates.map(day => [day.date, day.legacyBookable]));
    }

    /** Per-date picker status with reasons; `chefId` adds that chef's access and weekly limit (chef routes only). */
    async getMonthDateStatus(kitchenId: number, year: number, month: number, options: { excludeBookingId?: number; chefId?: number } = {}): Promise<Record<string, BookingDateStatus>> {
        const dates = await this.monthDates(kitchenId, year, month, options);
        return Object.fromEntries(dates.map(day => [day.date, day.status]));
    }
}

// Singleton instance
export const bookingService = new BookingService();
