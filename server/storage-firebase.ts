import type {
    Application,
    DeliveryPartnerApplication,
    InsertApplication,
    InsertDeliveryPartnerApplication,
    InsertUser,
    UpdateApplicationDocuments,
    UpdateApplicationStatus,
    UpdateDocumentVerification,
    User
} from "@shared/schema";
import { applications, deliveryPartnerApplications, users, locations, kitchens, kitchenAvailability, kitchenBookings } from "@shared/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { db, pool } from "./db";

/**
 * Firebase-only storage implementation without session management
 * This is for the pure Firebase Auth → Backend API → Neon Database architecture
 */
export class FirebaseStorage {
  
  // ===== USER MANAGEMENT =====
  
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    if (!pool) return undefined;
    
    try {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
      return result.rows[0] || undefined;
    } catch (error) {
      console.error('Error getting user by firebase_uid:', error);
      return undefined;
    }
  }

  async updateUserFirebaseUid(userId: number, firebaseUid: string): Promise<User | undefined> {
    if (!pool) return undefined;
    
    try {
      const result = await pool.query(
        'UPDATE users SET firebase_uid = $1 WHERE id = $2 RETURNING *',
        [firebaseUid, userId]
      );
      return result.rows[0] || undefined;
    } catch (error) {
      console.error('Error updating user firebase_uid:', error);
      return undefined;
    }
  }

  async createUser(insertUser: InsertUser & { firebaseUid?: string, isVerified?: boolean, has_seen_welcome?: boolean }): Promise<User> {
    if (!insertUser.username) {
      throw new Error("Username is required");
    }
    
    // Use raw query to include firebase_uid, is_verified, and has_seen_welcome
    if (pool && insertUser.firebaseUid) {
      try {
        const result = await pool.query(
          'INSERT INTO users (username, password, role, firebase_uid, is_verified, has_seen_welcome) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [
            insertUser.username,
            insertUser.password || '', // Empty password for Firebase users
            insertUser.role || 'applicant',
            insertUser.firebaseUid,
            insertUser.isVerified !== undefined ? insertUser.isVerified : false,
            insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false
          ]
        );
        return result.rows[0];
      } catch (error) {
        console.error('Error creating user with firebase_uid:', error);
        throw error;
      }
    }
    
    // Fallback to schema-based insert without firebase_uid
    const [user] = await db
      .insert(users)
      .values({
        username: insertUser.username,
        password: insertUser.password || '',
        role: insertUser.role || "applicant",
        isVerified: insertUser.isVerified !== undefined ? insertUser.isVerified : false,
        has_seen_welcome: insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false,
      })
      .returning();

    return user;
  }

  async setUserHasSeenWelcome(userId: number): Promise<void> {
    if (!pool) return;
    
    try {
      await pool.query(
        'UPDATE users SET has_seen_welcome = true WHERE id = $1',
        [userId]
      );
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      throw new Error('Failed to set has_seen_welcome');
    }
  }

  // ===== APPLICATION MANAGEMENT =====
  
  async getAllApplications(): Promise<Application[]> {
    return await db.select().from(applications);
  }

  async getApplicationById(id: number): Promise<Application | undefined> {
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    return application || undefined;
  }

  async getApplicationsByUserId(userId: number): Promise<Application[]> {
    return await db.select().from(applications).where(eq(applications.userId, userId));
  }

  async createApplication(insertApplication: InsertApplication): Promise<Application> {
    const now = new Date();

    const [application] = await db
      .insert(applications)
      .values({
        ...insertApplication,
        status: "inReview",
        createdAt: now,
      })
      .returning();

    return application;
  }

  async updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined> {
    const { id, status } = update;

    const [updatedApplication] = await db
      .update(applications)
      .set({ status })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateApplicationDocuments(update: UpdateApplicationDocuments): Promise<Application | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(applications)
      .set({
        ...updateData,
        // Reset document status to pending when new documents are uploaded
        ...(updateData.foodSafetyLicenseUrl && { foodSafetyLicenseStatus: "pending" }),
        ...(updateData.foodEstablishmentCertUrl && { foodEstablishmentCertStatus: "pending" }),
      })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateApplicationDocumentVerification(update: UpdateDocumentVerification): Promise<Application | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(applications)
      .set({
        ...updateData,
        documentsReviewedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  // ===== MICROLEARNING =====
  
  async getMicrolearningProgress(userId: number): Promise<any[]> {
    if (!pool) return [];
    
    try {
      const result = await pool.query(
        'SELECT * FROM video_progress WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting microlearning progress:', error);
      return [];
    }
  }

  async getMicrolearningCompletion(userId: number): Promise<any | undefined> {
    if (!pool) return undefined;
    
    try {
      const result = await pool.query(
        'SELECT * FROM microlearning_completions WHERE user_id = $1',
        [userId]
      );
      return result.rows[0] || undefined;
    } catch (error) {
      console.error('Error getting microlearning completion:', error);
      return undefined;
    }
  }

  async updateVideoProgress(progressData: any): Promise<void> {
    if (!pool) return;
    
    try {
      await pool.query(
        `INSERT INTO video_progress (user_id, video_id, progress, completed, watched_percentage, is_rewatching, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, video_id) 
         DO UPDATE SET 
           progress = EXCLUDED.progress,
           completed = EXCLUDED.completed,
           watched_percentage = EXCLUDED.watched_percentage,
           is_rewatching = EXCLUDED.is_rewatching,
           updated_at = NOW()`,
        [
          progressData.userId,
          progressData.videoId,
          progressData.progress || 0,
          progressData.completed || false,
          progressData.watchedPercentage || 0,
          progressData.isRewatching || false
        ]
      );
    } catch (error) {
      console.error('Error updating video progress:', error);
      throw error;
    }
  }

  async createMicrolearningCompletion(completionData: any): Promise<any> {
    if (!pool) return null;
    
    try {
      const result = await pool.query(
        `INSERT INTO microlearning_completions (user_id, confirmed, certificate_generated, video_progress, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [
          completionData.userId,
          completionData.confirmed || false,
          completionData.certificateGenerated || false,
          JSON.stringify(completionData.videoProgress || {})
        ]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating microlearning completion:', error);
      throw error;
    }
  }

  // ===== USER APPLICATION TYPE MANAGEMENT =====
  
  async updateUserApplicationType(userId: number, applicationType: 'chef' | 'delivery_partner'): Promise<void> {
    try {
      await db
        .update(users)
        .set({ applicationType })
        .where(eq(users.id, userId));
    } catch (error) {
      console.error('Error updating user application type:', error);
      throw error;
    }
  }

  // ===== USER ROLES MANAGEMENT =====
  
  async updateUserRoles(userId: number, roles: { isChef: boolean; isDeliveryPartner: boolean }): Promise<void> {
    try {
      // Determine the main role based on selected roles
      let mainRole = 'chef'; // default
      if (roles.isDeliveryPartner && !roles.isChef) {
        mainRole = 'delivery_partner';
      } else if (roles.isChef && roles.isDeliveryPartner) {
        mainRole = 'chef'; // For dual roles, default to chef
      } else if (roles.isChef) {
        mainRole = 'chef';
      }

      console.log(`🎯 Updating user ${userId} roles:`, {
        isChef: roles.isChef,
        isDeliveryPartner: roles.isDeliveryPartner,
        mainRole: mainRole
      });

      await db
        .update(users)
        .set({ 
          isChef: roles.isChef,
          isDeliveryPartner: roles.isDeliveryPartner,
          role: mainRole as any // Update main role field too
        })
        .where(eq(users.id, userId));
        
      console.log(`✅ Successfully updated user ${userId} roles in database`);
    } catch (error) {
      console.error('Error updating user roles:', error);
      throw error;
    }
  }

  // ===== DELIVERY PARTNER APPLICATION METHODS =====
  
  async createDeliveryPartnerApplication(applicationData: InsertDeliveryPartnerApplication): Promise<DeliveryPartnerApplication> {
    try {
      const [inserted] = await db
        .insert(deliveryPartnerApplications)
        .values(applicationData)
        .returning();
      
      return inserted;
    } catch (error) {
      console.error('Error creating delivery partner application:', error);
      throw error;
    }
  }

  async getDeliveryPartnerApplicationsByUserId(userId: number): Promise<DeliveryPartnerApplication[]> {
    try {
      return await db
        .select()
        .from(deliveryPartnerApplications)
        .where(eq(deliveryPartnerApplications.userId, userId));
    } catch (error) {
      console.error('Error getting delivery partner applications by user ID:', error);
      throw error;
    }
  }

  async getAllDeliveryPartnerApplications(): Promise<DeliveryPartnerApplication[]> {
    try {
      return await db.select().from(deliveryPartnerApplications);
    } catch (error) {
      console.error('Error getting all delivery partner applications:', error);
      throw error;
    }
  }

  async getDeliveryPartnerApplicationById(id: number): Promise<DeliveryPartnerApplication | undefined> {
    try {
      const [application] = await db.select().from(deliveryPartnerApplications).where(eq(deliveryPartnerApplications.id, id));
      return application || undefined;
    } catch (error) {
      console.error('Error getting delivery partner application by ID:', error);
      throw error;
    }
  }

  async updateDeliveryPartnerApplicationStatus(update: { id: number; status: string }): Promise<DeliveryPartnerApplication | undefined> {
    try {
      const { id, status } = update;

      const [updatedApplication] = await db
        .update(deliveryPartnerApplications)
        .set({ status: status as 'inReview' | 'approved' | 'rejected' | 'cancelled' })
        .where(eq(deliveryPartnerApplications.id, id))
        .returning();

      return updatedApplication || undefined;
    } catch (error) {
      console.error('Error updating delivery partner application status:', error);
      throw error;
    }
  }

  // ===== LOCATIONS MANAGEMENT =====
  
  async createLocation(locationData: { name: string; address: string; managerId?: number }): Promise<any> {
    try {
      const [location] = await db
        .insert(locations)
        .values(locationData)
        .returning();
      return location;
    } catch (error) {
      console.error('Error creating location:', error);
      throw error;
    }
  }

  async getLocationById(id: number): Promise<any | undefined> {
    try {
      const [location] = await db.select().from(locations).where(eq(locations.id, id));
      return location || undefined;
    } catch (error) {
      console.error('Error getting location by ID:', error);
      throw error;
    }
  }

  async getLocationsByManager(managerId: number): Promise<any[]> {
    try {
      return await db.select().from(locations).where(eq(locations.managerId, managerId));
    } catch (error) {
      console.error('Error getting locations by manager:', error);
      throw error;
    }
  }

  async getAllLocations(): Promise<any[]> {
    try {
      return await db.select().from(locations);
    } catch (error) {
      console.error('Error getting all locations:', error);
      throw error;
    }
  }

  async updateLocation(id: number, updates: { name?: string; address?: string; managerId?: number }): Promise<any> {
    try {
      const [updated] = await db
        .update(locations)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(locations.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating location:', error);
      throw error;
    }
  }

  // ===== KITCHENS MANAGEMENT =====
  
  async createKitchen(kitchenData: { locationId: number; name: string; description?: string; isActive?: boolean }): Promise<any> {
    try {
      const [kitchen] = await db
        .insert(kitchens)
        .values(kitchenData)
        .returning();
      return kitchen;
    } catch (error) {
      console.error('Error creating kitchen:', error);
      throw error;
    }
  }

  async getKitchenById(id: number): Promise<any | undefined> {
    try {
      const [kitchen] = await db.select().from(kitchens).where(eq(kitchens.id, id));
      return kitchen || undefined;
    } catch (error) {
      console.error('Error getting kitchen by ID:', error);
      throw error;
    }
  }

  async getKitchensByLocation(locationId: number): Promise<any[]> {
    try {
      return await db.select().from(kitchens).where(eq(kitchens.locationId, locationId));
    } catch (error) {
      console.error('Error getting kitchens by location:', error);
      throw error;
    }
  }

  async getAllKitchens(): Promise<any[]> {
    try {
      return await db.select().from(kitchens);
    } catch (error) {
      console.error('Error getting all kitchens:', error);
      throw error;
    }
  }

  async updateKitchen(id: number, updates: { name?: string; description?: string; isActive?: boolean }): Promise<any> {
    try {
      const [updated] = await db
        .update(kitchens)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(kitchens.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating kitchen:', error);
      throw error;
    }
  }

  // ===== KITCHEN AVAILABILITY MANAGEMENT =====
  
  async setKitchenAvailability(kitchenId: number, availability: { dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }): Promise<any> {
    try {
      // Check if availability exists for this kitchen and day
      const existing = await db
        .select()
        .from(kitchenAvailability)
        .where(and(
          eq(kitchenAvailability.kitchenId, kitchenId),
          eq(kitchenAvailability.dayOfWeek, availability.dayOfWeek)
        ));

      if (existing.length > 0) {
        // Update existing
        const [updated] = await db
          .update(kitchenAvailability)
          .set({
            startTime: availability.startTime,
            endTime: availability.endTime,
            isAvailable: availability.isAvailable
          })
          .where(and(
            eq(kitchenAvailability.kitchenId, kitchenId),
            eq(kitchenAvailability.dayOfWeek, availability.dayOfWeek)
          ))
          .returning();
        return updated;
      } else {
        // Create new
        const [created] = await db
          .insert(kitchenAvailability)
          .values({
            kitchenId,
            ...availability
          })
          .returning();
        return created;
      }
    } catch (error) {
      console.error('Error setting kitchen availability:', error);
      throw error;
    }
  }

  async getKitchenAvailability(kitchenId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(kitchenAvailability)
        .where(eq(kitchenAvailability.kitchenId, kitchenId));
    } catch (error) {
      console.error('Error getting kitchen availability:', error);
      throw error;
    }
  }

  // ===== KITCHEN BOOKINGS MANAGEMENT =====
  
  async createKitchenBooking(bookingData: { chefId: number; kitchenId: number; bookingDate: Date; startTime: string; endTime: string; specialNotes?: string }): Promise<any> {
    try {
      const [booking] = await db
        .insert(kitchenBookings)
        .values({
          ...bookingData,
          bookingDate: bookingData.bookingDate
        })
        .returning();
      return booking;
    } catch (error) {
      console.error('Error creating kitchen booking:', error);
      throw error;
    }
  }

  async getKitchenBookingById(id: number): Promise<any | undefined> {
    try {
      const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, id));
      return booking || undefined;
    } catch (error) {
      console.error('Error getting kitchen booking by ID:', error);
      throw error;
    }
  }

  async getBookingsByChef(chefId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(kitchenBookings)
        .where(eq(kitchenBookings.chefId, chefId))
        .orderBy(asc(kitchenBookings.bookingDate));
    } catch (error) {
      console.error('Error getting bookings by chef:', error);
      throw error;
    }
  }

  async getBookingsByKitchen(kitchenId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(kitchenBookings)
        .where(eq(kitchenBookings.kitchenId, kitchenId))
        .orderBy(asc(kitchenBookings.bookingDate));
    } catch (error) {
      console.error('Error getting bookings by kitchen:', error);
      throw error;
    }
  }

  async getBookingsByManager(managerId: number): Promise<any[]> {
    try {
      // Get all locations for this manager
      const managerLocations = await db
        .select()
        .from(locations)
        .where(eq(locations.managerId, managerId));
      
      const locationIds = managerLocations.map(loc => loc.id);
      
      if (locationIds.length === 0) {
        return [];
      }

      // Get all kitchens for these locations
      const managerKitchens = await db
        .select()
        .from(kitchens)
        .where(inArray(kitchens.locationId, locationIds));
      
      const kitchenIds = managerKitchens.map(k => k.id);
      
      if (kitchenIds.length === 0) {
        return [];
      }

      // Get all bookings for these kitchens
      return await db
        .select()
        .from(kitchenBookings)
        .where(inArray(kitchenBookings.kitchenId, kitchenIds))
        .orderBy(asc(kitchenBookings.bookingDate));
    } catch (error) {
      console.error('Error getting bookings by manager:', error);
      throw error;
    }
  }

  async updateKitchenBookingStatus(id: number, status: 'pending' | 'confirmed' | 'cancelled'): Promise<any> {
    try {
      const [updated] = await db
        .update(kitchenBookings)
        .set({ status: status as 'pending' | 'confirmed' | 'cancelled', updatedAt: new Date() })
        .where(eq(kitchenBookings.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating kitchen booking status:', error);
      throw error;
    }
  }

  async cancelKitchenBooking(id: number, chefId: number): Promise<any> {
    try {
      const [booking] = await db
        .select()
        .from(kitchenBookings)
        .where(and(
          eq(kitchenBookings.id, id),
          eq(kitchenBookings.chefId, chefId)
        ));

      if (!booking) {
        throw new Error('Booking not found or you do not have permission to cancel it');
      }

      const [updated] = await db
        .update(kitchenBookings)
        .set({ status: 'cancelled' as 'pending' | 'confirmed' | 'cancelled', updatedAt: new Date() })
        .where(eq(kitchenBookings.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error cancelling kitchen booking:', error);
      throw error;
    }
  }

  async getAvailableTimeSlots(kitchenId: number, date: Date): Promise<string[]> {
    try {
      const dayOfWeek = date.getDay();
      const availability = await this.getKitchenAvailability(kitchenId);
      
      const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);
      
      if (!dayAvailability || !dayAvailability.isAvailable) {
        return [];
      }

      const startHour = parseInt(dayAvailability.startTime.split(':')[0]);
      const endHour = parseInt(dayAvailability.endTime.split(':')[0]);
      
      const slots: string[] = [];
      for (let hour = startHour; hour < endHour; hour++) {
        slots.push(`${hour.toString().padStart(2, '0')}:00`);
      }
      
      return slots;
    } catch (error) {
      console.error('Error getting available time slots:', error);
      throw error;
    }
  }

  async checkBookingConflict(kitchenId: number, bookingDate: Date, startTime: string, endTime: string): Promise<boolean> {
    try {
      const bookings = await db
        .select()
        .from(kitchenBookings)
        .where(and(
          eq(kitchenBookings.kitchenId, kitchenId),
          eq(kitchenBookings.status, 'confirmed')
        ));

      for (const booking of bookings) {
        const bookingDateTime = new Date(booking.bookingDate);
        if (bookingDateTime.toDateString() === bookingDate.toDateString()) {
          // Check for time overlap
          if (startTime < booking.endTime && endTime > booking.startTime) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking booking conflict:', error);
      return true; // Return true on error to prevent double booking
    }
  }
}

// Create Firebase storage instance
export const firebaseStorage = new FirebaseStorage(); 