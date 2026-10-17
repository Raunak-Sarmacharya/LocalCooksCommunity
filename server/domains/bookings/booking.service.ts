
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
import { addHour, calendarDateForOperatingTime, getHourlySlotStarts, intervalsOverlapOnOperatingDay, isRangeWithinOperatingWindow, normalizeBookingSlots, occupiedIntervals, operatingSlotsOverlapAcrossDates } from "@shared/operating-hours";
import { assertConsecutiveBookingSlots } from '@shared/consecutive-booking-slots';
import { getActiveKitchenHolds } from "../../services/kitchen-checkout-holds";
import { isUnambiguousBookingSlot, matchingLocalInstants } from '@shared/booking-dst';

import { chefService } from "../users/chef.service";

import { kitchenBookingPolicies } from '../../services/booking-policy-settings';
import { bookingWindowLastDate } from '@shared/kitchen-booking-policies';
import { bookingIntervalsConflict, operatingSlotInstants } from '@shared/booking-occupancy';

type BookingInterval = { startTime: string; endTime: string };

export function hasBookingConflict(
    existingBookings: Array<BookingInterval & { selectedSlots?: unknown }>,
    requestedIntervals: BookingInterval[],
    fullDay = false,
    windowStartTime = "00:00",
): boolean {
    if (fullDay) return existingBookings.length > 0;
    return requestedIntervals.some((requested) =>
        existingBookings.some((existing) =>
            occupiedIntervals(existing).some(interval => intervalsOverlapOnOperatingDay(interval, requested, windowStartTime))
        )
    );
}

function occupiesOperatingSlot(
    existing: BookingInterval & { selectedSlots?: unknown }, existingDate: string, existingWindowStart: string,
    requested: BookingInterval, requestedDate: string, requestedWindowStart: string,
    bufferMinutes = 0, timezone = "America/St_Johns",
): boolean {
    return occupiedIntervals(existing).some(slot => bufferMinutes ? bookingIntervalsConflict(
        operatingSlotInstants((slot as { date?: string }).date || existingDate, slot, existingWindowStart, timezone),
        operatingSlotInstants(requestedDate, requested, requestedWindowStart, timezone), bufferMinutes,
    ) : operatingSlotsOverlapAcrossDates(
        (slot as { date?: string }).date || existingDate, slot, existingWindowStart, requestedDate, requested, requestedWindowStart,
    ));
}

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
            excludeHoldId?: string;
            // With excludeBookingId: still enforce the kitchen's advance-booking window (a chef replacing their own request).
            keepAdvanceWindow?: boolean;
        } = {}
    ): Promise<{ valid: boolean; error?: string; slots?: BookingInterval[]; windowStartTime?: string }> {
        try {
            const policy = await kitchenBookingPolicies(kitchenId);
            // First check if there's a date-specific override
            const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, bookingDate);

            let availabilityStartTime: string;
            let availabilityEndTime: string;

            if (dateOverride) {
                // If there's an override and it's closed, can't book
                if (!dateOverride.isAvailable) {
                    return { valid: false, error: "Kitchen is closed on this date" };
                }
                // If override has custom hours, use those
                if (dateOverride.startTime && dateOverride.endTime) {
                    availabilityStartTime = dateOverride.startTime;
                    availabilityEndTime = dateOverride.endTime;
                } else {
                    return { valid: false, error: "Kitchen availability not properly configured for this date" };
                }
            } else {
                // No override, use regular weekly schedule
                // Use getUTCDay() since dates are passed as UTC noon to avoid timezone shifts
                const dayOfWeek = bookingDate.getUTCDay();
                const availability = await kitchenService.getKitchenAvailability(kitchenId);

                const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);

                // Check if day is available
                if (!dayAvailability || !dayAvailability.isAvailable) {
                    return { valid: false, error: "Kitchen is not available on this day" };
                }

                availabilityStartTime = dayAvailability.startTime;
                availabilityEndTime = dayAvailability.endTime;
            }

            if (!isRangeWithinOperatingWindow(startTime, endTime, availabilityStartTime, availabilityEndTime)) {
                return { valid: false, error: "Booking time must be within manager-set available hours" };
            }

            let requestedIntervals: BookingInterval[];
            try {
                requestedIntervals = normalizeBookingSlots(
                    options.selectedSlots === undefined ? [] : options.selectedSlots, startTime, endTime,
                    availabilityStartTime, availabilityEndTime, !!options.fullDay,
                );
                assertConsecutiveBookingSlots(requestedIntervals, availabilityStartTime);
            } catch (error) {
                return { valid: false, error: error instanceof Error ? error.message : 'Invalid selected slots' };
            }

            const dateStr = bookingDate.toISOString().split('T')[0];
            // Kitchen-initiated confirmed changes use excludeBookingId and bypass only the advance window.
            if ((!options.excludeBookingId || options.keepAdvanceWindow) && dateStr > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) {
                return { valid: false, error: `This kitchen takes bookings up to ${policy.maxAdvanceBookingDays} days ahead.` };
            }
            const timezone = policy.timezone;
            if (requestedIntervals.some(slot => !isUnambiguousBookingSlot(dateStr, slot, availabilityStartTime, timezone))) {
                return { valid: false, error: 'This hour is affected by a daylight saving clock change and is unavailable for self-service booking' };
            }
            const bookings = (await this.getBookingsByKitchen(kitchenId)).filter(booking => booking.status !== 'cancelled' && (options.excludeBookingId === undefined || booking.id !== options.excludeBookingId));

            // A full-day booking requires the entire day to be free. Hourly bookings only
            // conflict with the discrete slots submitted by the client.
            if (options.fullDay && bookings.some(booking => new Date(booking.bookingDate).toISOString().slice(0, 10) === dateStr)) {
                return { valid: false, error: "Full-day booking is unavailable because this date already has a booking" };
            }

            if (bookings.some(booking => requestedIntervals.some(slot => occupiesOperatingSlot(
                booking, new Date(booking.bookingDate).toISOString().slice(0, 10),
                booking.operatingWindowStartTime || booking.startTime, slot, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone,
            )))) {
                return { valid: false, error: "One or more selected time slots are no longer available" };
            }
            const holds = await getActiveKitchenHolds(kitchenId);
            if (holds.filter(hold => (options.excludeHoldId === undefined || hold.id !== options.excludeHoldId)).some(hold => requestedIntervals.some(slot => occupiesOperatingSlot(
                { startTime: '', endTime: '', selectedSlots: hold.selectedSlots },
                hold.operatingDate, hold.windowStartTime, slot, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone,
            )))) {
                return { valid: false, error: 'One or more selected time slots are temporarily reserved' };
            }

            return { valid: true, slots: requestedIntervals, windowStartTime: availabilityStartTime };
        } catch (error) {
            logger.error('Error validating booking availability:', error);
            return { valid: false, error: "Error validating booking availability" };
        }
    }

    async getAvailableTimeSlots(kitchenId: number, date: Date): Promise<string[]> {
        try {
            const policy = await kitchenBookingPolicies(kitchenId);
            if (date.toISOString().slice(0, 10) > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) return [];
            // First check if there's a date-specific override
            const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date);

            let availabilityStartTime: string;
            let availabilityEndTime: string;

            if (dateOverride) {
                // If there's an override and it's closed, return empty slots
                if (!dateOverride.isAvailable) {
                    return [];
                }
                // If override is available with custom hours, use those
                if (dateOverride.startTime && dateOverride.endTime) {
                    availabilityStartTime = dateOverride.startTime;
                    availabilityEndTime = dateOverride.endTime;
                } else {
                    return [];
                }
            } else {
                // No override, use regular weekly schedule
                // Use getUTCDay() since dates are passed as UTC noon to avoid timezone shifts
                const dayOfWeek = date.getUTCDay();
                const availability = await kitchenService.getKitchenAvailability(kitchenId);

                const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);

                if (!dayAvailability || !dayAvailability.isAvailable) {
                    return [];
                }

                availabilityStartTime = dayAvailability.startTime;
                availabilityEndTime = dayAvailability.endTime;
            }

            const slots = getHourlySlotStarts(availabilityStartTime, availabilityEndTime);

            // Filter out already booked slots
            const bookings = await this.getBookingsByKitchen(kitchenId);
            const dateStr = date.toISOString().split('T')[0];

            const bookedSlots = new Set<string>();
            bookings.filter(booking => booking.status !== 'cancelled').forEach(booking => {
                for (const slot of slots) {
                    if (occupiesOperatingSlot(booking, new Date(booking.bookingDate).toISOString().slice(0, 10),
                        booking.operatingWindowStartTime || booking.startTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        bookedSlots.add(slot);
                    }
                }
            });
            const holds = await getActiveKitchenHolds(kitchenId);
            holds.forEach(hold => {
                slots.forEach(slot => {
                    if (occupiesOperatingSlot({ startTime: '', endTime: '', selectedSlots: hold.selectedSlots },
                        hold.operatingDate, hold.windowStartTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        bookedSlots.add(slot);
                    }
                });
            });

            return slots.filter(slot => !bookedSlots.has(slot) && isUnambiguousBookingSlot(
                dateStr, { startTime: slot, endTime: addHour(slot) }, availabilityStartTime,
                policy.timezone));
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
    }>> {
        try {
            const policy = await kitchenBookingPolicies(kitchenId);
            if (date.toISOString().slice(0, 10) > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) return [];
            const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date);

            let availabilityStartTime: string;
            let availabilityEndTime: string;
            let capacity: number;

            if (dateOverride) {
                if (!dateOverride.isAvailable) {
                    return [];
                }
                if (dateOverride.startTime && dateOverride.endTime) {
                    availabilityStartTime = dateOverride.startTime;
                    availabilityEndTime = dateOverride.endTime;
                    capacity = 1;
                } else {
                    return [];
                }
            } else {
                // Use getUTCDay() since dates are passed as UTC noon to avoid timezone shifts
                const dayOfWeek = date.getUTCDay();
                const availability = await kitchenService.getKitchenAvailability(kitchenId);
                const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);

                if (!dayAvailability || !dayAvailability.isAvailable) {
                    return [];
                }

                availabilityStartTime = dayAvailability.startTime;
                availabilityEndTime = dayAvailability.endTime;
                capacity = 1;
            }

            const allSlots = getHourlySlotStarts(availabilityStartTime, availabilityEndTime);

            const bookings = (await this.getBookingsByKitchen(kitchenId)).filter(booking => booking.id !== excludeBookingId);
            const dateStr = date.toISOString().split('T')[0];

            const slotBookingCounts = new Map<string, number>();
            allSlots.forEach(slot => slotBookingCounts.set(slot, 0));

            bookings.filter(booking => booking.status !== 'cancelled').forEach(booking => {
                allSlots.forEach(slot => {
                    if (occupiesOperatingSlot(booking, new Date(booking.bookingDate).toISOString().slice(0, 10),
                        booking.operatingWindowStartTime || booking.startTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
                    }
                });
            });
            const holds = await getActiveKitchenHolds(kitchenId);
            holds.forEach(hold => {
                allSlots.forEach(slot => {
                    if (occupiesOperatingSlot({ startTime: '', endTime: '', selectedSlots: hold.selectedSlots },
                        hold.operatingDate, hold.windowStartTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
                    }
                });
            });

            return allSlots.map(slot => {
                const bookedCount = slotBookingCounts.get(slot) || 0;
                const clockSafe = isUnambiguousBookingSlot(dateStr,
                    { startTime: slot, endTime: addHour(slot) }, availabilityStartTime,
                    policy.timezone);
                return {
                    time: slot,
                    available: clockSafe ? Math.max(0, capacity - bookedCount) : 0,
                    capacity,
                    isFullyBooked: !clockSafe || bookedCount >= capacity
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
     * Month availability where a day is true only if at least one bookable slot remains
     * (not fully booked, and not in the past for today).
     * ponytail: 3 DB round-trips total regardless of month length (schedule + bookings reused per day).
     */
    async getMonthBookableAvailability(
        kitchenId: number,
        year: number,
        month: number,
        excludeBookingId?: number
    ): Promise<Record<string, boolean>> {
        const policy = await kitchenBookingPolicies(kitchenId);
        const scheduleMap = await kitchenService.getMonthAvailability(kitchenId, year, month);
        const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

        const [weeklyAvailability, overrides, bookings, holds] = await Promise.all([
            kitchenService.getKitchenAvailability(kitchenId),
            kitchenService.getKitchenDateOverrides(kitchenId, monthStart, monthEnd),
            this.getBookingsByKitchen(kitchenId).then(rows => rows.filter(booking => booking.id !== excludeBookingId)),
            db.select().from(kitchenCheckoutHolds).where(and(
                eq(kitchenCheckoutHolds.kitchenId, kitchenId), gt(kitchenCheckoutHolds.expiresAt, new Date()),
            )),
        ]);
        const timezone = policy.timezone;

        const weeklyMap = new Map<number, { isAvailable: boolean; startTime: string; endTime: string }>();
        weeklyAvailability.forEach((a: any) => {
            weeklyMap.set(a.dayOfWeek, {
                isAvailable: !!a.isAvailable,
                startTime: a.startTime,
                endTime: a.endTime,
            });
        });

        const overrideMap = new Map<string, typeof overrides[number]>();
        overrides.forEach((o) => {
            const dateStr = new Date(o.specificDate).toISOString().split('T')[0];
            overrideMap.set(dateStr, o);
        });

        const now = new Date();
        const result: Record<string, boolean> = {};
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
            const dateStr = date.toISOString().split('T')[0];

            if (!scheduleMap[dateStr] || dateStr > bookingWindowLastDate(policy.maxAdvanceBookingDays, policy.timezone)) {
                result[dateStr] = false;
                continue;
            }

            const override = overrideMap.get(dateStr);
            let availabilityStartTime: string;
            let availabilityEndTime: string;
            let capacity: number;

            if (override) {
                if (!override.isAvailable || !override.startTime || !override.endTime) {
                    result[dateStr] = false;
                    continue;
                }
                availabilityStartTime = override.startTime;
                availabilityEndTime = override.endTime;
                capacity = 1;
            } else {
                const dayOfWeek = date.getUTCDay();
                const dayAvail = weeklyMap.get(dayOfWeek);
                if (!dayAvail?.isAvailable || !dayAvail.startTime || !dayAvail.endTime) {
                    result[dateStr] = false;
                    continue;
                }
                availabilityStartTime = dayAvail.startTime;
                availabilityEndTime = dayAvail.endTime;
                capacity = 1;
            }

            const allSlots = getHourlySlotStarts(availabilityStartTime, availabilityEndTime);

            const slotBookingCounts = new Map<string, number>();
            allSlots.forEach((slot) => slotBookingCounts.set(slot, 0));

            bookings.filter(booking => booking.status !== 'cancelled').forEach((booking) => {
                allSlots.forEach((slot) => {
                    if (occupiesOperatingSlot(booking, new Date(booking.bookingDate).toISOString().slice(0, 10),
                        booking.operatingWindowStartTime || booking.startTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
                    }
                });
            });
            holds.forEach(hold => {
                allSlots.forEach(slot => {
                    if (occupiesOperatingSlot({ startTime: '', endTime: '', selectedSlots: hold.selectedSlots },
                        hold.operatingDate, hold.windowStartTime,
                        { startTime: slot, endTime: addHour(slot) }, dateStr, availabilityStartTime, policy.turnoverBufferEnabled ? 60 : 0, policy.timezone)) {
                        slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
                    }
                });
            });

            result[dateStr] = allSlots.some((slot) => {
                if ((slotBookingCounts.get(slot) || 0) >= capacity) return false;
                const interval = { startTime: slot, endTime: addHour(slot) };
                if (!isUnambiguousBookingSlot(dateStr, interval, availabilityStartTime, timezone)) return false;
                const calendarDate = calendarDateForOperatingTime(dateStr, slot, availabilityStartTime);
                return matchingLocalInstants(calendarDate, slot, timezone)[0] > now.getTime();
            });
        }

        return result;
    }
}

// Singleton instance
export const bookingService = new BookingService();
