
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
import { bookingStatusEnum, kitchenBookings, kitchens, users, locations, equipmentListings, storageListings, chefLocationAccess, chefKitchenApplications } from "@shared/schema";
import { logger } from "../../logger";
import { db } from "../../db";
import { eq, and, ne } from "drizzle-orm";
import { sendEmail, generateBookingConfirmationEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } from "../../email";
import { kitchenService } from "../kitchens/kitchen.service";

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
        // 1. Validate pricing
        const pricing = await calculateKitchenBookingPrice(
            data.kitchenId,
            data.startTime,
            data.endTime
        );

        // 1.1 Validate Chef Access (Tier 2 Requirement)
        const kitchen = await kitchenService.getKitchenById(data.kitchenId);
        if (!kitchen) throw new Error("Kitchen not found");

        if (!data.chefId) {
            throw new Error("Chef ID is required for booking");
        }

        const hasAccess = await db.query.chefLocationAccess.findFirst({
            where: and(
                eq(chefLocationAccess.chefId, data.chefId),
                eq(chefLocationAccess.locationId, kitchen.locationId)
            )
        });

        if (!hasAccess) {
            // Fallback: Check chef_kitchen_applications for approved Tier 2+ applications
            const [kitchenApplication] = await db
                .select()
                .from(chefKitchenApplications)
                .where(
                    and(
                        eq(chefKitchenApplications.chefId, data.chefId),
                        eq(chefKitchenApplications.locationId, kitchen.locationId)
                    )
                );

            const currentTier = (kitchenApplication as any)?.currentTier ?? (kitchenApplication as any)?.current_tier ?? 0;
            const isApprovedTier2Plus = kitchenApplication && 
                kitchenApplication.status === 'approved' && 
                currentTier >= 2;

            if (!isApprovedTier2Plus) {
                throw new Error("You do not have approved access to this kitchen location. Please complete all required application steps (Tier 2) to book.");
            }

            // Auto-create access record for future checks (self-healing)
            try {
                await db.insert(chefLocationAccess).values({
                    chefId: data.chefId,
                    locationId: kitchen.locationId,
                    grantedBy: kitchenApplication.reviewedBy || data.chefId,
                    grantedAt: new Date(),
                }).onConflictDoNothing();
                console.log(`✅ [BookingService] Auto-created chef_location_access for chef ${data.chefId} at location ${kitchen.locationId}`);
            } catch (err) {
                console.error('[BookingService] Error auto-creating chef_location_access:', err);
            }
        }

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
        // Generate selectedSlots from startTime/endTime if not provided
        let selectedSlots = data.selectedSlots;
        if (!selectedSlots || selectedSlots.length === 0) {
            // Generate contiguous slots from startTime to endTime for backward compatibility
            selectedSlots = [];
            const [startHours, startMins] = data.startTime.split(':').map(Number);
            const [endHours, endMins] = data.endTime.split(':').map(Number);
            const startMinutes = startHours * 60 + startMins;
            const endMinutes = endHours * 60 + endMins;
            for (let mins = startMinutes; mins < endMinutes; mins += 60) {
                const slotStartH = Math.floor(mins / 60);
                const slotStartM = mins % 60;
                const slotEndMins = mins + 60;
                const slotEndH = Math.floor(slotEndMins / 60);
                const slotEndM = slotEndMins % 60;
                selectedSlots.push({
                    startTime: `${slotStartH.toString().padStart(2, '0')}:${slotStartM.toString().padStart(2, '0')}`,
                    endTime: `${slotEndH.toString().padStart(2, '0')}:${slotEndM.toString().padStart(2, '0')}`
                });
            }
        }

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
            paymentStatus: data.paymentStatus || 'pending'
        });

        // 5. Create Storage Bookings
        let storageTotalCents = 0;
        const storageItemsForJson: Array<{id: number, storageListingId: number, name: string, storageType: string, totalPrice: number, startDate: string, endDate: string}> = [];
        
        // Use selectedStorage with explicit dates if available, otherwise fall back to selectedStorageIds
        if (data.selectedStorage && data.selectedStorage.length > 0) {
            try {
                const { inventoryService } = await import('../inventory/inventory.service');
                
                for (const storage of data.selectedStorage) {
                    const listing = await inventoryService.getStorageListingById(storage.storageListingId);
                    if (listing) {
                        // DB stores basePrice in cents
                        const listingBasePriceCents = Math.round(parseFloat(String(listing.basePrice || '0')));
                        const minDays = listing.minimumBookingDuration || 1;
                        
                        const storageStartDate = new Date(storage.startDate);
                        const storageEndDate = new Date(storage.endDate);
                        const days = Math.ceil((storageEndDate.getTime() - storageStartDate.getTime()) / (1000 * 60 * 60 * 24));
                        const effectiveDays = Math.max(days, minDays);
                        
                        let priceCents = listingBasePriceCents * effectiveDays;
                        if (listing.pricingModel === 'hourly') {
                            const durationHours = Math.max(1, Math.ceil((storageEndDate.getTime() - storageStartDate.getTime()) / (1000 * 60 * 60)));
                            priceCents = listingBasePriceCents * durationHours;
                        } else if (listing.pricingModel === 'monthly-flat') {
                            priceCents = listingBasePriceCents;
                        }

                        // Create Storage Booking Record with explicit dates
                        const storageBooking = await this.repo.createStorageBooking({
                            kitchenBookingId: booking.id,
                            storageListingId: listing.id,
                            chefId: data.chefId,
                            startDate: storageStartDate,
                            endDate: storageEndDate,
                            status: 'confirmed',
                            totalPrice: priceCents.toString(),
                            pricingModel: listing.pricingModel || 'daily',
                            serviceFee: '0',
                            currency: pricing.currency
                        });
                        
                        if (storageBooking) {
                            storageItemsForJson.push({
                                id: storageBooking.id,
                                storageListingId: listing.id,
                                name: listing.name || 'Storage',
                                storageType: listing.storageType || 'other',
                                totalPrice: priceCents,
                                startDate: storageStartDate.toISOString(),
                                endDate: storageEndDate.toISOString()
                            });
                        }
                        
                        storageTotalCents += priceCents;
                    }
                }
            } catch (err) {
                logger.error('Error creating storage bookings with explicit dates:', err);
            }
        } else if (data.selectedStorageIds && data.selectedStorageIds.length > 0) {
            // Fallback: use selectedStorageIds with booking date as both start and end
            try {
                const { inventoryService } = await import('../inventory/inventory.service');
                
                for (const storageId of data.selectedStorageIds) {
                    const listing = await inventoryService.getStorageListingById(storageId);
                    if (listing) {
                        let priceCents = 0;
                        // DB stores basePrice in cents
                        const listingBasePriceCents = Math.round(parseFloat(String(listing.basePrice || '0')));

                        if (listing.pricingModel === 'hourly') {
                            const duration = calculateDurationHours(data.startTime, data.endTime);
                            const effectiveDuration = Math.max(1, Math.ceil(duration));
                            priceCents = listingBasePriceCents * effectiveDuration;
                        } else {
                            // Flat rate (daily/monthly/per-use) - simplified for MVP
                             priceCents = listingBasePriceCents;
                        }

                        // Create Storage Booking Record
                        const storageBooking = await this.repo.createStorageBooking({
                            kitchenBookingId: booking.id,
                            storageListingId: listing.id,
                            chefId: data.chefId,
                            startDate: data.bookingDate,
                            endDate: data.bookingDate, // Single day for hourly
                            status: 'confirmed',
                            totalPrice: priceCents.toString(),
                            pricingModel: listing.pricingModel || 'daily',
                            serviceFee: '0', // No service fee for customer
                            currency: pricing.currency
                        });
                        
                        // Add to storage_items JSONB array for denormalized storage
                        if (storageBooking) {
                            storageItemsForJson.push({
                                id: storageBooking.id,
                                storageListingId: listing.id,
                                name: listing.name || 'Storage',
                                storageType: listing.storageType || 'other',
                                totalPrice: priceCents,
                                startDate: storageBooking.startDate?.toISOString?.() || data.bookingDate.toISOString(),
                                endDate: storageBooking.endDate?.toISOString?.() || data.bookingDate.toISOString()
                            });
                        }
                        
                        storageTotalCents += priceCents;
                    }
                }
            } catch (err) {
                logger.error('Error creating storage bookings:', err);
            }
        }

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
                    if (listing && listing.availabilityType !== 'included') {
                        // DB stores session_rate in CENTS (e.g., 3500 = $35.00)
                        const sessionRateCents = Math.round(parseFloat(String(listing.sessionRate || '0')));
                        logger.info(`[BookingService] Creating equipment booking: kitchenBookingId=${booking.id}, equipmentListingId=${listing.id}, sessionRateCents=${sessionRateCents}`);
                        
                        const eqBooking = await this.repo.createEquipmentBooking({
                            kitchenBookingId: booking.id,
                            equipmentListingId: listing.id,
                            chefId: data.chefId,
                            startDate: data.bookingDate,
                            endDate: data.bookingDate,
                            status: 'confirmed',
                            totalPrice: sessionRateCents.toString(),
                            damageDeposit: (listing.damageDeposit || '0').toString(), 
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
        const grandTotalCents = pricing.totalPriceCents + storageTotalCents + equipmentTotalCents;
        const newServiceFeeCents = await calculatePlatformFeeDynamic(grandTotalCents);

        // Update booking with total price, service fee, storage_items and equipment_items JSONB
        // Store total WITHOUT fee (Customer pays Base + Tax).
        // Store fee for reporting.
        await this.repo.updateKitchenBooking(booking.id, {
            totalPrice: grandTotalCents.toString(),
            serviceFee: newServiceFeeCents.toString(),
            storageItems: storageItemsForJson,
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
        // Map portal/external structure to DB schema (flatten externalContact)
        const dbData = {
            ...data,
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

    async validateBookingAvailability(kitchenId: number, bookingDate: Date, startTime: string, endTime: string): Promise<{ valid: boolean; error?: string }> {
        try {
            // Check if start time is before end time
            if (startTime >= endTime) {
                return { valid: false, error: "End time must be after start time" };
            }

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

            // Check if booking times are within availability window
            if (startTime < availabilityStartTime || endTime > availabilityEndTime) {
                return { valid: false, error: "Booking time must be within manager-set available hours" };
            }

            // Check that start time aligns with available slots (hourly slots)
            const startHour = parseInt(startTime.split(':')[0]);
            const availabilityStartHour = parseInt(availabilityStartTime.split(':')[0]);
            const availabilityEndHour = parseInt(availabilityEndTime.split(':')[0]);

            if (startHour < availabilityStartHour || startHour >= availabilityEndHour) {
                return { valid: false, error: "Start time must be within manager-set available slot times" };
            }

            return { valid: true };
        } catch (error) {
            logger.error('Error validating booking availability:', error);
            return { valid: false, error: "Error validating booking availability" };
        }
    }

    async getAvailableTimeSlots(kitchenId: number, date: Date): Promise<string[]> {
        try {
            // First check if there's a date-specific override
            const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date);

            let startHour: number;
            let endHour: number;

            if (dateOverride) {
                // If there's an override and it's closed, return empty slots
                if (!dateOverride.isAvailable) {
                    return [];
                }
                // If override is available with custom hours, use those
                if (dateOverride.startTime && dateOverride.endTime) {
                    startHour = parseInt(dateOverride.startTime.split(':')[0]);
                    endHour = parseInt(dateOverride.endTime.split(':')[0]);
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

                startHour = parseInt(dayAvailability.startTime.split(':')[0]);
                endHour = parseInt(dayAvailability.endTime.split(':')[0]);
            }

            const slots: string[] = [];
            for (let hour = startHour; hour < endHour; hour++) {
                slots.push(`${hour.toString().padStart(2, '0')}:00`);
            }

            // Filter out already booked slots
            const bookings = await this.getBookingsByKitchen(kitchenId);
            const dateStr = date.toISOString().split('T')[0];

            const dayBookings = bookings.filter(b => {
                const bookingDateStr = new Date(b.bookingDate).toISOString().split('T')[0];
                return bookingDateStr === dateStr && b.status !== 'cancelled';
            });

            const bookedSlots = new Set<string>();
            dayBookings.forEach(booking => {
                const [startHours, startMins] = booking.startTime.split(':').map(Number);
                const [endHours, endMins] = booking.endTime.split(':').map(Number);
                const startTotalMins = startHours * 60 + startMins;
                const endTotalMins = endHours * 60 + endMins;

                for (const slot of slots) {
                    const [slotHours, slotMins] = slot.split(':').map(Number);
                    const slotTotalMins = slotHours * 60 + slotMins;

                    if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
                        bookedSlots.add(slot);
                    }
                }
            });

            return slots.filter(slot => !bookedSlots.has(slot));
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

    async getAllTimeSlotsWithBookingInfo(kitchenId: number, date: Date): Promise<Array<{
        time: string;
        available: number;
        capacity: number;
        isFullyBooked: boolean;
    }>> {
        try {
            const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date);

            let startHour: number;
            let endHour: number;
            let capacity: number;

            if (dateOverride) {
                if (!dateOverride.isAvailable) {
                    return [];
                }
                if (dateOverride.startTime && dateOverride.endTime) {
                    startHour = parseInt(dateOverride.startTime.split(':')[0]);
                    endHour = parseInt(dateOverride.endTime.split(':')[0]);
                    capacity = (dateOverride as any).maxConcurrentBookings ?? 1;
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

                startHour = parseInt(dayAvailability.startTime.split(':')[0]);
                endHour = parseInt(dayAvailability.endTime.split(':')[0]);
                capacity = (dayAvailability as any).maxConcurrentBookings ?? 1;
            }

            const allSlots: string[] = [];
            for (let hour = startHour; hour < endHour; hour++) {
                allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
            }

            const bookings = await this.getBookingsByKitchen(kitchenId);
            const dateStr = date.toISOString().split('T')[0];

            const dayBookings = bookings.filter(b => {
                const bookingDateStr = new Date(b.bookingDate).toISOString().split('T')[0];
                return bookingDateStr === dateStr && b.status !== 'cancelled';
            });

            const slotBookingCounts = new Map<string, number>();
            allSlots.forEach(slot => slotBookingCounts.set(slot, 0));

            dayBookings.forEach(booking => {
                const [startHours, startMins] = booking.startTime.split(':').map(Number);
                const [endHours, endMins] = booking.endTime.split(':').map(Number);
                const startTotalMins = startHours * 60 + startMins;
                const endTotalMins = endHours * 60 + endMins;

                allSlots.forEach(slot => {
                    const [slotHours, slotMins] = slot.split(':').map(Number);
                    const slotTotalMins = slotHours * 60 + slotMins;
                    if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
                        slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
                    }
                });
            });

            return allSlots.map(slot => {
                const bookedCount = slotBookingCounts.get(slot) || 0;
                return {
                    time: slot,
                    available: Math.max(0, capacity - bookedCount),
                    capacity,
                    isFullyBooked: bookedCount >= capacity
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

    async extendStorageBooking(id: number, newEndDate: Date) {
        // Logic ported from storage-firebase.ts
        const booking = await this.repo.getStorageBookingById(id);
        if (!booking) throw new Error(`Storage booking with id ${id} not found`);

        const currentEndDate = new Date(booking.endDate);
        if (newEndDate <= currentEndDate) throw new Error('New end date must be after the current end date');

        const extensionDays = Math.ceil((newEndDate.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;

        if (extensionDays < minDays) throw new Error(`Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}`);

        // Service fee rate
        const { getServiceFeeRate } = await import('../../services/pricing-service');
        const serviceFeeRate = await getServiceFeeRate();

        // booking.basePrice is in dollars or cents? 
        // In BookingRepository.getStorageBookingById, we do NOT format basePrice.
        // Wait, let's look at BookingRepository again (Step 860).
        // I copied logic: returns booking (raw) with joins.
        // Ah, `storage-firebase` getStorageBookingById returns formatted object.
        // My `BookingRepository` returns raw object from `db.select`. it does NOT format anything unless I mapped it. 
        // I did NOT map it in `getStorageBookingById` in Step 860. I just returned `booking || null`.
        // BUT I DID map it in `getStorageBookingsByChefId`.
        // So `getStorageBookingById` returns basePrice as string (cents).

        const basePricePerDayDollars = booking.basePrice ? parseFloat(booking.basePrice.toString()) / 100 : 0;

        const extensionBasePrice = basePricePerDayDollars * extensionDays;
        const extensionServiceFee = extensionBasePrice * serviceFeeRate;
        const extensionTotalPrice = extensionBasePrice + extensionServiceFee;

        // Convert to cents
        const extensionTotalPriceCents = Math.round(extensionTotalPrice * 100);
        const extensionServiceFeeCents = Math.round(extensionServiceFee * 100);

        const existingTotalPriceCents = Math.round(parseFloat((booking.totalPrice || '0').toString()));
        const existingServiceFeeCents = Math.round(parseFloat((booking.serviceFee || '0').toString()));

        const newTotalPriceCents = existingTotalPriceCents + extensionTotalPriceCents;
        const newServiceFeeCents = existingServiceFeeCents + extensionServiceFeeCents;

        await this.repo.updateStorageBooking(id, {
            endDate: newEndDate,
            totalPrice: newTotalPriceCents.toString(),
            serviceFee: newServiceFeeCents.toString(),
        });

        const updatedBooking = await this.repo.getStorageBookingById(id);

        // Also update the storageItems JSONB in the associated kitchen booking
        // so that manager view shows the extended dates
        if (booking.kitchenBookingId) {
            try {
                const kitchenBooking = await this.repo.getKitchenBookingById(booking.kitchenBookingId);
                if (kitchenBooking && kitchenBooking.storageItems && Array.isArray(kitchenBooking.storageItems)) {
                    // Find and update the storage item with matching storageListingId
                    const updatedStorageItems = kitchenBooking.storageItems.map((item: any) => {
                        if (item.storageListingId === booking.storageListingId || item.id === id) {
                            return {
                                ...item,
                                endDate: newEndDate.toISOString(),
                                totalPrice: newTotalPriceCents, // Update price too
                            };
                        }
                        return item;
                    });
                    
                    await this.repo.updateKitchenBooking(booking.kitchenBookingId, {
                        storageItems: updatedStorageItems,
                    });
                    
                    logger.info(`[BookingService] Updated storageItems JSONB in kitchen booking ${booking.kitchenBookingId} for storage extension`, {
                        storageBookingId: id,
                        newEndDate: newEndDate.toISOString(),
                    });
                }
            } catch (error) {
                // Log but don't fail the extension - the storage_bookings table is the source of truth
                logger.warn(`[BookingService] Failed to update storageItems JSONB in kitchen booking: ${error}`);
            }
        }

        // Return structured response matching legacy format expected by frontend/logic
        return {
            ...updatedBooking,
            // We should format money fields if the caller expects dollars, but here we return mixed struct?
            // storage-firebase returned formatted dollars.
            // I should probably stick to returning what DB returns but add the extensionDetails.
            extensionDetails: {
                extensionDays,
                extensionBasePrice,
                extensionServiceFee,
                extensionTotalPrice,
                newEndDate: newEndDate.toISOString()
            }
        };
    }

    // ===== PENDING STORAGE EXTENSIONS =====

    async createPendingStorageExtension(data: {
        storageBookingId: number;
        newEndDate: Date;
        extensionDays: number;
        extensionBasePriceCents: number;
        extensionServiceFeeCents: number;
        extensionTotalPriceCents: number;
        stripeSessionId: string;
        stripePaymentIntentId?: string;
        status: string;
    }) {
        return this.repo.createPendingStorageExtension(data);
    }

    async getPendingStorageExtension(storageBookingId: number, stripeSessionId: string) {
        return this.repo.getPendingStorageExtension(storageBookingId, stripeSessionId);
    }

    async updatePendingStorageExtension(id: number, updates: { status: string; stripePaymentIntentId?: string; completedAt?: Date }) {
        return this.repo.updatePendingStorageExtension(id, updates);
    }

    /**
     * @deprecated Use overstayPenaltyService.detectOverstays() instead.
     * This method is kept for backward compatibility but no longer auto-charges.
     * The new system requires manager approval before any charges.
     */
    async processOverstayerPenalties(_maxDaysToCharge: number = 7) {
        logger.warn('[DEPRECATED] processOverstayerPenalties called - use overstayPenaltyService instead');
        // Redirect to new detection system
        const { overstayPenaltyService } = await import('../../services/overstay-penalty-service');
        return overstayPenaltyService.detectOverstays();
    }
}

// Singleton instance
export const bookingService = new BookingService();
