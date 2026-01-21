import type {
  Application,
  ChefKitchenApplication,
  InsertApplication,
  InsertChefKitchenApplication,
  InsertUser,
  UpdateApplicationDocuments,
  UpdateApplicationStatus,
  UpdateChefKitchenApplicationDocuments,
  UpdateChefKitchenApplicationStatus,
  UpdateDocumentVerification,
  User
} from "@shared/schema";
import { applications, chefKitchenApplications, users, locations, locationRequirements, kitchens, kitchenAvailability, kitchenDateOverrides, kitchenBookings, chefKitchenAccess, chefLocationAccess, chefKitchenProfiles, chefLocationProfiles, storageListings, equipmentListings, storageBookings, equipmentBookings, platformSettings, LocationRequirements, UpdateLocationRequirements } from "@shared/schema";
import { eq, and, inArray, asc, gte, lte, desc, isNull, or, not } from "drizzle-orm";
import { db, pool } from "./db";
import { DEFAULT_TIMEZONE } from "@shared/timezone-utils";

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
    try {
      // Use Drizzle ORM to ensure proper camelCase mapping (is_chef -> isChef)
      const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
      return user || undefined;
    } catch (error) {
      console.error('Error getting user by firebase_uid:', error);
      return undefined;
    }
  }

  async updateUserFirebaseUid(userId: number, firebaseUid: string): Promise<User | undefined> {
    try {
      // Use Drizzle ORM to ensure proper camelCase mapping (is_chef -> isChef)
      const [updated] = await db
        .update(users)
        .set({ firebaseUid })
        .where(eq(users.id, userId))
        .returning();
      return updated || undefined;
    } catch (error) {
      console.error('Error updating user firebase_uid:', error);
      return undefined;
    }
  }

  async updateUser(id: number, updates: { username?: string; role?: string; isManager?: boolean; isChef?: boolean }): Promise<User | undefined> {
    try {
      const [updated] = await db
        .update(users)
        .set(updates as any)
        .where(eq(users.id, id))
        .returning();
      return updated || undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(id: number): Promise<void> {
    try {
      // Use transaction to ensure atomicity when updating locations and deleting user
      await db.transaction(async (tx) => {
        // Check if user is a manager with assigned locations
        const managedLocations = await tx.select().from(locations).where(eq(locations.managerId, id));
        if (managedLocations.length > 0) {
          // Set manager_id to NULL for all locations managed by this user
          // This prevents foreign key constraint violations (NO ACTION means we must handle it)
          await tx.update(locations).set({ managerId: null }).where(eq(locations.managerId, id));
          console.log(`⚠️ Removed manager ${id} from ${managedLocations.length} location(s)`);
        }

        // Delete user (must be after updating locations to avoid foreign key constraint violation)
        await tx.delete(users).where(eq(users.id, id));
      });

      console.log(`✅ Deleted user ${id}`);
    } catch (error: any) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  async getAllManagers(): Promise<User[]> {
    try {
      return await db.select().from(users).where(eq(users.role, 'manager'));
    } catch (error) {
      console.error('Error getting all managers:', error);
      throw error;
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
          'INSERT INTO users (username, password, role, firebase_uid, is_verified, has_seen_welcome, is_chef, is_manager, is_portal_user) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
          [
            insertUser.username,
            insertUser.password || '', // Empty password for Firebase users
            insertUser.role || (() => {
              console.error(`❌ CRITICAL ERROR: No role provided to createUser in storage-firebase.ts!`);
              console.error(`   - This should not happen - role should always be provided for Firebase users`);
              throw new Error('Role is required when creating a Firebase user. This is a programming error.');
            })(),
            insertUser.firebaseUid,
            insertUser.isVerified !== undefined ? insertUser.isVerified : false,
            insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false,
            insertUser.isChef !== undefined ? insertUser.isChef : false,
            insertUser.isManager !== undefined ? insertUser.isManager : false,
            (insertUser as any).isPortalUser !== undefined ? (insertUser as any).isPortalUser : false
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
        role: insertUser.role || (() => {
          console.error(`❌ CRITICAL ERROR: No role provided to createUser (fallback) in storage-firebase.ts!`);
          throw new Error('Role is required when creating a Firebase user. This is a programming error.');
        })(),
        isVerified: insertUser.isVerified !== undefined ? insertUser.isVerified : false,
        has_seen_welcome: insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false,
        isChef: insertUser.isChef !== undefined ? insertUser.isChef : false,
        isManager: insertUser.isManager !== undefined ? insertUser.isManager : false,
        isPortalUser: (insertUser as any).isPortalUser !== undefined ? (insertUser as any).isPortalUser : false,
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
    console.log(`[STORAGE] getApplicationsByUserId called with userId: ${userId}`);
    console.log(`[STORAGE] Database connection check - pool exists: ${!!pool}, db exists: ${!!db}`);

    const results = await db.select().from(applications).where(eq(applications.userId, userId));
    console.log(`[STORAGE] Found ${results.length} applications for user ${userId}`);
    return results;
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

  // ===== USER ROLES MANAGEMENT =====

  async updateUserRoles(userId: number, roles: { isChef: boolean }): Promise<void> {
    try {
      // Determine the main role based on selected roles
      let mainRole = roles.isChef ? 'chef' : null;

      console.log(`🎯 Updating user ${userId} roles:`, {
        isChef: roles.isChef,
        mainRole: mainRole
      });

      await db
        .update(users)
        .set({
          isChef: roles.isChef,
          role: mainRole as any // Update main role field too
        })
        .where(eq(users.id, userId));

      console.log(`✅ Successfully updated user ${userId} roles in database`);
    } catch (error) {
      console.error('Error updating user roles:', error);
      throw error;
    }
  }

  // ===== LOCATIONS MANAGEMENT =====

  async createLocation(locationData: { name: string; address: string; managerId?: number; notificationEmail?: string; notificationPhone?: string }): Promise<any> {
    try {
      console.log('Inserting location into database:', locationData);

      // Import phone normalization utility
      const { normalizePhoneForStorage } = await import('./phone-utils');

      // Build the insert data, excluding managerId if it's undefined
      const insertData: any = {
        name: locationData.name,
        address: locationData.address,
      };

      // Only include managerId if it's provided and valid
      if (locationData.managerId !== undefined && locationData.managerId !== null) {
        insertData.managerId = locationData.managerId;
      }

      // Include notificationEmail if provided
      if (locationData.notificationEmail !== undefined && locationData.notificationEmail !== null && locationData.notificationEmail !== '') {
        insertData.notificationEmail = locationData.notificationEmail;
      }

      // Include notificationPhone if provided (already normalized by routes)
      if (locationData.notificationPhone !== undefined && locationData.notificationPhone !== null && locationData.notificationPhone !== '') {
        // Double-check normalization (should already be normalized, but ensure it)
        const normalized = normalizePhoneForStorage(locationData.notificationPhone);
        insertData.notificationPhone = normalized || locationData.notificationPhone;
      }

      console.log('Insert data:', insertData);

      const [location] = await db
        .insert(locations)
        .values(insertData)
        .returning();

      console.log('Location created successfully:', location);
      return location;
    } catch (error: any) {
      console.error('Error creating location:', error);
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      console.error('Error detail:', error.detail);

      // Provide a more user-friendly error message
      if (error.code === '23503') { // Foreign key constraint violation
        throw new Error('The selected manager does not exist or is invalid.');
      } else if (error.code === '23505') { // Unique constraint violation
        throw new Error('A location with this information already exists.');
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Failed to create location due to a database error.');
      }
    }
  }

  async getAllLocations(): Promise<any[]> {
    try {
      const allLocations = await db.select().from(locations);
      return allLocations.map((location: any) => ({
        ...location,
        managerId: location.managerId || location.manager_id || null,
        notificationEmail: location.notificationEmail || location.notification_email || null,
        cancellationPolicyHours: location.cancellationPolicyHours || location.cancellation_policy_hours,
        cancellationPolicyMessage: location.cancellationPolicyMessage || location.cancellation_policy_message,
        defaultDailyBookingLimit: location.defaultDailyBookingLimit || location.default_daily_booking_limit,
        minimumBookingWindowHours: location.minimumBookingWindowHours || location.minimum_booking_window_hours,
        logoUrl: location.logoUrl || location.logo_url || null,
        brandImageUrl: location.brandImageUrl || location.brand_image_url || null,
      }));
    } catch (error) {
      console.error('Error getting all locations:', error);
      return [];
    }
  }

  async getLocationById(id: number): Promise<any | undefined> {
    try {
      const [location] = await db.select().from(locations).where(eq(locations.id, id));
      if (!location) return undefined;

      // Map snake_case to camelCase for consistent API (same pattern as getAllLocations)
      return {
        ...location,
        managerId: (location as any).managerId || (location as any).manager_id || null,
        notificationEmail: (location as any).notificationEmail || (location as any).notification_email || null,
        cancellationPolicyHours: (location as any).cancellationPolicyHours || (location as any).cancellation_policy_hours || 24,
        timezone: (location as any).timezone || DEFAULT_TIMEZONE,
        cancellationPolicyMessage: (location as any).cancellationPolicyMessage || (location as any).cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
        defaultDailyBookingLimit: (location as any).defaultDailyBookingLimit || (location as any).default_daily_booking_limit || 2,
        createdAt: (location as any).createdAt || (location as any).created_at,
        updatedAt: (location as any).updatedAt || (location as any).updated_at,
      };
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

  // ===== LOCATION REQUIREMENTS MANAGEMENT =====

  async getLocationRequirements(locationId: number): Promise<LocationRequirements | null> {
    try {
      const [requirements] = await db
        .select()
        .from(locationRequirements)
        .where(eq(locationRequirements.locationId, locationId));
      return requirements || null;
    } catch (error) {
      console.error('Error getting location requirements:', error);
      return null;
    }
  }

  async getLocationRequirementsWithDefaults(locationId: number): Promise<LocationRequirements> {
    const requirements = await this.getLocationRequirements(locationId);
    if (requirements) {
      // Ensure customFields and tier custom fields are always arrays
      return {
        ...requirements,
        customFields: Array.isArray(requirements.customFields) ? requirements.customFields : [],
        tier1_custom_fields: Array.isArray((requirements as any).tier1_custom_fields) ? (requirements as any).tier1_custom_fields : [],
        tier2_custom_fields: Array.isArray((requirements as any).tier2_custom_fields) ? (requirements as any).tier2_custom_fields : [],
      } as LocationRequirements;
    }

    // Return default requirements if none configured
    return {
      id: 0,
      locationId,
      requireFirstName: true,
      requireLastName: true,
      requireEmail: true,
      requirePhone: true,
      requireBusinessName: true,
      requireBusinessType: true,
      requireExperience: true,
      requireBusinessDescription: false,
      requireFoodHandlerCert: true,
      requireFoodHandlerExpiry: true,
      requireUsageFrequency: true,
      requireSessionDuration: true,
      requireTermsAgree: true,
      requireAccuracyAgree: true,
      customFields: [],
      // Tier defaults
      tier1_years_experience_required: false,
      tier1_years_experience_minimum: 0,
      tier1_custom_fields: [],
      tier2_food_establishment_cert_required: false,
      tier2_food_establishment_expiry_required: false,
      tier2_insurance_document_required: false,
      tier2_insurance_minimum_amount: 0,
      tier2_kitchen_experience_required: false,
      tier2_allergen_plan_required: false,
      tier2_supplier_list_required: false,
      tier2_quality_control_required: false,
      tier2_traceability_system_required: false,
      tier2_custom_fields: [],
      // Facility Information
      floor_plans_url: '',
      ventilation_specs: '',
      ventilation_specs_url: '',
      equipment_list: [],
      materials_description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as LocationRequirements;
  }

  async upsertLocationRequirements(
    locationId: number,
    updates: UpdateLocationRequirements
  ): Promise<LocationRequirements> {
    try {
      const existing = await this.getLocationRequirements(locationId);

      // Ensure customFields is always an array if provided
      // Handle null/empty string values for optional text fields
      const processedUpdates: any = {
        ...updates,
        ...(updates.customFields !== undefined && {
          customFields: Array.isArray(updates.customFields) ? updates.customFields : []
        }),
        ...(updates.tier1_custom_fields !== undefined && {
          tier1_custom_fields: Array.isArray(updates.tier1_custom_fields) ? updates.tier1_custom_fields : []
        }),
        ...(updates.tier2_custom_fields !== undefined && {
          tier2_custom_fields: Array.isArray(updates.tier2_custom_fields) ? updates.tier2_custom_fields : []
        }),
        updatedAt: new Date()
      };

      // Convert null or empty string to null for database (PostgreSQL handles null fine)
      // Only include these fields if they're explicitly provided
      if ('floor_plans_url' in updates) {
        processedUpdates.floor_plans_url = updates.floor_plans_url === '' ? null : updates.floor_plans_url;
      }
      if ('ventilation_specs' in updates) {
        processedUpdates.ventilation_specs = updates.ventilation_specs === '' ? null : updates.ventilation_specs;
      }
      if ('ventilation_specs_url' in updates) {
        processedUpdates.ventilation_specs_url = updates.ventilation_specs_url === '' ? null : updates.ventilation_specs_url;
      }

      if (existing) {
        const [updated] = await db
          .update(locationRequirements)
          .set(processedUpdates)
          .where(eq(locationRequirements.locationId, locationId))
          .returning();
        return updated;
      } else {
        const [created] = await db
          .insert(locationRequirements)
          .values({
            locationId,
            ...processedUpdates,
            // Ensure custom fields default to empty array if not provided
            customFields: processedUpdates.customFields ?? [],
            tier1_custom_fields: processedUpdates.tier1_custom_fields ?? [],
            tier2_custom_fields: processedUpdates.tier2_custom_fields ?? []
          })
          .returning();
        return created;
      }
    } catch (error) {
      // Safe error logging - handle circular references
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('❌ Error upserting location requirements:', errorMessage);
      if (errorStack) {
        console.error('Stack trace:', errorStack);
      }
      throw error;
    }
  }

  async updateLocation(id: number, updates: {
    name?: string;
    address?: string;
    managerId?: number;
    notificationEmail?: string | null;
    notificationPhone?: string | null;
    kitchenLicenseUrl?: string | null;
    kitchenLicenseStatus?: string | null;
    kitchenLicenseExpiry?: string | null;
    kitchenLicenseUploadedAt?: Date | null;
  }): Promise<any> {
    try {
      // Import phone normalization utility
      const { normalizePhoneForStorage } = await import('./phone-utils');

      // Normalize notificationPhone if provided
      const normalizedUpdates = { ...updates };
      if (updates.notificationPhone !== undefined) {
        if (updates.notificationPhone && updates.notificationPhone.trim() !== '') {
          // Should already be normalized by routes, but ensure it
          normalizedUpdates.notificationPhone = normalizePhoneForStorage(updates.notificationPhone) || updates.notificationPhone;
        } else {
          normalizedUpdates.notificationPhone = null;
        }
      }

      const [updated] = await db
        .update(locations)
        .set({ ...normalizedUpdates, updatedAt: new Date() })
        .where(eq(locations.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating location:', error);
      throw error;
    }
  }

  async deleteLocation(id: number): Promise<void> {
    try {
      // Check if location has kitchens first (foreign key constraint requires this)
      const locationKitchens = await db.select().from(kitchens).where(eq(kitchens.locationId, id));
      if (locationKitchens.length > 0) {
        throw new Error(`Cannot delete location: It has ${locationKitchens.length} kitchen(s). Please delete or reassign kitchens first.`);
      }

      // Use transaction for atomicity (best practice per Drizzle ORM)
      await db.transaction(async (tx) => {
        await tx.delete(locations).where(eq(locations.id, id));
      });

      console.log(`✅ Deleted location ${id}`);
    } catch (error: any) {
      console.error('Error deleting location:', error);
      throw error;
    }
  }

  // ===== KITCHENS MANAGEMENT =====

  async createKitchen(kitchenData: { locationId: number; name: string; description?: string; isActive?: boolean; amenities?: string[] }): Promise<any> {
    try {
      console.log('Inserting kitchen into database:', kitchenData);

      // Build the insert data, excluding optional fields if undefined
      const insertData: any = {
        locationId: kitchenData.locationId,
        name: kitchenData.name,
      };

      // Only include description if provided
      if (kitchenData.description !== undefined && kitchenData.description !== null && kitchenData.description !== '') {
        insertData.description = kitchenData.description;
      }

      // Only include isActive if provided, default to true
      if (kitchenData.isActive !== undefined) {
        insertData.isActive = kitchenData.isActive;
      } else {
        insertData.isActive = true;
      }

      // Include amenities if provided
      if (kitchenData.amenities) {
        insertData.amenities = kitchenData.amenities;
      }

      console.log('Insert data:', insertData);

      const [kitchen] = await db
        .insert(kitchens)
        .values(insertData)
        .returning();

      console.log('Kitchen created successfully:', kitchen);
      return kitchen;
    } catch (error: any) {
      console.error('Error creating kitchen:', error);
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      console.error('Error detail:', error.detail);

      // Provide a more user-friendly error message
      if (error.code === '23503') { // Foreign key constraint violation
        throw new Error('The selected location does not exist or is invalid.');
      } else if (error.code === '23505') { // Unique constraint violation
        throw new Error('A kitchen with this name already exists in this location.');
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Failed to create kitchen due to a database error.');
      }
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
      const result = await db.select().from(kitchens);
      console.log('📦 getAllKitchens - Raw result from DB:', JSON.stringify(result, null, 2));
      console.log('📦 Total kitchens in DB:', result.length);

      // The drizzle ORM should handle snake_case to camelCase conversion automatically
      // But let's log to verify
      if (result.length > 0) {
        console.log('📦 First kitchen sample:', result[0]);
      }

      return result;
    } catch (error) {
      console.error('❌ Error getting all kitchens:', error);
      throw error;
    }
  }

  async getAllKitchensWithLocationAndManager(): Promise<any[]> {
    try {
      // Get all kitchens
      const allKitchens = await db.select().from(kitchens);

      // Get all locations
      const allLocations = await db.select().from(locations);

      // Get only the user columns we need (id, username) to avoid selecting columns
      // that might not exist in the database (like is_delivery_partner)
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
      }).from(users);

      // Combine the data
      const kitchensWithDetails = allKitchens.map(kitchen => {
        // Handle both camelCase and snake_case just in case
        const kitchenLocationId = (kitchen as any).locationId ?? (kitchen as any).location_id;
        const location = allLocations.find(loc => {
          const locId = (loc as any).id;
          return locId === kitchenLocationId;
        });

        const managerId = location ? ((location as any).managerId ?? (location as any).manager_id) : undefined;
        const manager = managerId ? allUsers.find(user => (user as any).id === managerId) : null;

        // Extract location fields with both camelCase and snake_case support
        const locName = location ? ((location as any).name ?? (location as any).location_name) : undefined;
        const locAddress = location ? ((location as any).address ?? (location as any).location_address) : undefined;

        // Extract image URLs - check all possible field name variations
        // Use || instead of ?? to handle empty strings as well
        // Drizzle maps image_url (DB) to imageUrl (TypeScript), but handle both just in case
        const kitchenImageUrl = (kitchen as any).imageUrl || (kitchen as any).image_url || null;
        const kitchenGalleryImages = (kitchen as any).galleryImages || (kitchen as any).gallery_images || [];
        const locationBrandImageUrl = location ? ((location as any).brandImageUrl || (location as any).brand_image_url || null) : null;
        const locationLogoUrl = location ? ((location as any).logoUrl || (location as any).logo_url || null) : null;

        // Extract and format pricing fields
        // hourlyRate is stored in cents, convert to dollars for frontend
        const hourlyRateCents = (kitchen as any).hourlyRate;
        const hourlyRate = hourlyRateCents !== null && hourlyRateCents !== undefined
          ? (typeof hourlyRateCents === 'string' ? parseFloat(hourlyRateCents) : hourlyRateCents) / 100
          : null;

        // Extract amenities (stored as JSONB, should be array)
        const amenities = (kitchen as any).amenities || [];
        // Ensure amenities is an array
        const amenitiesArray = Array.isArray(amenities) ? amenities : [];

        // Extract other kitchen fields
        const currency = (kitchen as any).currency || 'CAD';
        const minimumBookingHours = (kitchen as any).minimumBookingHours || (kitchen as any).minimum_booking_hours || 1;
        const pricingModel = (kitchen as any).pricingModel || (kitchen as any).pricing_model || 'hourly';
        const isActive = (kitchen as any).isActive !== undefined ? (kitchen as any).isActive : (kitchen as any).is_active;

        return {
          ...kitchen,
          // Helpful flattened fields for clients that don't handle nested objects reliably
          locationId: kitchenLocationId,
          locationName: locName,
          locationAddress: locAddress,
          // Ensure imageUrl and galleryImages are always set (even if null/empty) and not undefined
          imageUrl: kitchenImageUrl,
          galleryImages: kitchenGalleryImages,
          locationBrandImageUrl: locationBrandImageUrl,
          locationLogoUrl: locationLogoUrl,
          // Format pricing fields for frontend
          hourlyRate: hourlyRate, // Now in dollars, not cents
          currency: currency,
          minimumBookingHours: minimumBookingHours,
          pricingModel: pricingModel,
          amenities: amenitiesArray, // Ensure it's always an array
          isActive: isActive,
          location: location ? {
            id: (location as any).id,
            name: locName,
            address: locAddress,
            brandImageUrl: locationBrandImageUrl || null,
            logoUrl: locationLogoUrl || null,
          } : null,
          manager: manager ? {
            id: (manager as any).id,
            username: (manager as any).username,
            fullName: (manager as any).fullName || (manager as any).username,
          } : null,
        };
      });

      return kitchensWithDetails;
    } catch (error) {
      console.error('Error getting kitchens with location and manager:', error);
      throw error;
    }
  }

  // Get kitchens that a chef has access to (admin must grant access first)
  async getKitchensForChef(chefId: number): Promise<any[]> {
    try {
      // Get all locations chef has access to
      const locationAccessRecords = await db
        .select()
        .from(chefLocationAccess)
        .where(eq(chefLocationAccess.chefId, chefId));

      if (locationAccessRecords.length === 0) {
        return []; // Chef has no access to any locations
      }

      const locationIds = locationAccessRecords.map(access => access.locationId);

      // Get all kitchens with location and manager details
      const allKitchensWithDetails = await this.getAllKitchensWithLocationAndManager();

      // Filter to only kitchens in locations chef has access to and that are active
      return allKitchensWithDetails.filter(kitchen => {
        const isActive = kitchen.isActive !== undefined ? kitchen.isActive : (kitchen as any).is_active;
        const kitchenLocationId = (kitchen as any).locationId ?? (kitchen as any).location?.id;
        return locationIds.includes(kitchenLocationId) && isActive !== false && isActive !== null;
      });
    } catch (error) {
      console.error('Error getting kitchens for chef:', error);
      throw error;
    }
  }

  async updateKitchen(id: number, updates: { name?: string; description?: string; isActive?: boolean; locationId?: number; imageUrl?: string; galleryImages?: string[]; hourlyRate?: number | null; currency?: string; minimumBookingHours?: number; pricingModel?: string; amenities?: string[] }): Promise<any> {
    try {
      // Convert hourlyRate to string for numeric type if provided
      const dbUpdates: any = { ...updates, updatedAt: new Date() };
      if (updates.hourlyRate !== undefined) {
        // Drizzle numeric type expects string representation
        dbUpdates.hourlyRate = updates.hourlyRate === null ? null : updates.hourlyRate.toString();
      }

      if (updates.amenities !== undefined) {
        dbUpdates.amenities = updates.amenities;
      }

      const [updated] = await db
        .update(kitchens)
        .set(dbUpdates)
        .where(eq(kitchens.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating kitchen:', error);
      throw error;
    }
  }

  // Get kitchen pricing
  async getKitchenPricing(kitchenId: number): Promise<any | undefined> {
    try {
      // Query database directly to avoid Drizzle's numeric type issues
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            'SELECT hourly_rate::text as hourly_rate, currency, minimum_booking_hours, pricing_model FROM kitchens WHERE id = $1',
            [kitchenId]
          );
          if (directQuery.rows && directQuery.rows[0]) {
            const row = directQuery.rows[0];
            const dbValue = row.hourly_rate;
            const hourlyRateCents = dbValue ? parseFloat(String(dbValue)) : null;

            return {
              hourlyRate: hourlyRateCents !== null ? hourlyRateCents / 100 : null,
              currency: row.currency || 'CAD',
              minimumBookingHours: row.minimum_booking_hours || 1,
              pricingModel: row.pricing_model || 'hourly',
            };
          }
        } catch (error) {
          console.error('Error getting kitchen pricing:', error);
        }
      }

      // Fallback to Drizzle if direct query fails
      const kitchen = await this.getKitchenById(kitchenId);
      if (!kitchen) return undefined;

      const hourlyRateCents = kitchen.hourlyRate ? parseFloat(kitchen.hourlyRate.toString()) : null;
      const hourlyRateDollars = hourlyRateCents !== null ? hourlyRateCents / 100 : null;

      return {
        hourlyRate: hourlyRateDollars,
        currency: kitchen.currency || 'CAD',
        minimumBookingHours: kitchen.minimumBookingHours || 1,
        pricingModel: kitchen.pricingModel || 'hourly',
      };
    } catch (error) {
      console.error('Error getting kitchen pricing:', error);
      throw error;
    }
  }

  // Update kitchen pricing
  async updateKitchenPricing(kitchenId: number, pricing: { hourlyRate?: number | null; currency?: string; minimumBookingHours?: number; pricingModel?: string }): Promise<any> {
    try {
      // Convert hourlyRate from dollars to cents (cents) if provided
      const updates: any = {
        updatedAt: new Date(),
      };

      if (pricing.hourlyRate !== undefined) {
        // Store as numeric in cents (e.g., $50.00 = 5000 cents)
        // Input is in dollars, convert to cents for storage
        const hourlyRateCents = pricing.hourlyRate === null ? null : Math.round(pricing.hourlyRate * 100);
        updates.hourlyRate = hourlyRateCents === null ? null : hourlyRateCents.toString();
      }

      if (pricing.currency !== undefined) {
        updates.currency = pricing.currency;
      }

      if (pricing.minimumBookingHours !== undefined) {
        updates.minimumBookingHours = pricing.minimumBookingHours;
      }

      if (pricing.pricingModel !== undefined) {
        updates.pricingModel = pricing.pricingModel;
      }

      const [updated] = await db
        .update(kitchens)
        .set(updates)
        .where(eq(kitchens.id, kitchenId))
        .returning();

      // Query database directly to get the actual stored value (in cents)
      // Drizzle's numeric type may incorrectly interpret the value
      let hourlyRateCents: number | null = null;
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            'SELECT hourly_rate::text as hourly_rate FROM kitchens WHERE id = $1',
            [kitchenId]
          );
          if (directQuery.rows && directQuery.rows[0]) {
            const dbValue = directQuery.rows[0].hourly_rate;
            hourlyRateCents = dbValue ? parseFloat(String(dbValue)) : null;
          }
        } catch (error) {
          console.error('Error updating kitchen pricing:', error);
        }
      }

      // Convert cents to dollars for API response
      const hourlyRateDollars = hourlyRateCents !== null ? hourlyRateCents / 100 : null;

      // Return only pricing fields (not the entire kitchen object) for API consistency
      const result = {
        hourlyRate: hourlyRateDollars, // Return in dollars for API consistency
        currency: updated.currency || 'CAD',
        minimumBookingHours: updated.minimumBookingHours || 1,
        pricingModel: updated.pricingModel || 'hourly',
      };
      console.log('[updateKitchenPricing] Final result:', JSON.stringify(result));
      return result;
    } catch (error) {
      console.error('Error updating kitchen pricing:', error);
      throw error;
    }
  }

  // ===== STORAGE LISTINGS MANAGEMENT =====

  // Get storage listing by ID (using direct SQL for numeric fields)
  async getStorageListingById(id: number): Promise<any | undefined> {
    try {
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            `SELECT 
              id, kitchen_id, storage_type, name, description,
              dimensions_length::text as dimensions_length,
              dimensions_width::text as dimensions_width,
              dimensions_height::text as dimensions_height,
              total_volume::text as total_volume,
              shelf_count, shelf_material, access_type,
              features, security_features, climate_control,
              temperature_range, humidity_control, power_outlets,
              pricing_model,
              base_price::text as base_price,
              price_per_cubic_foot::text as price_per_cubic_foot,
              minimum_booking_duration, booking_duration_unit, currency,
              status, approved_by, approved_at, rejection_reason,
              is_active, availability_calendar,
              certifications, photos, documents,
              house_rules, prohibited_items, insurance_required,
              created_at, updated_at
            FROM storage_listings 
            WHERE id = $1`,
            [id]
          );
          if (directQuery.rows && directQuery.rows[0]) {
            const row = directQuery.rows[0];
            // Convert numeric fields from cents to dollars
            return {
              ...row,
              basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
              pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
              dimensionsLength: row.dimensions_length ? parseFloat(String(row.dimensions_length)) : null,
              dimensionsWidth: row.dimensions_width ? parseFloat(String(row.dimensions_width)) : null,
              dimensionsHeight: row.dimensions_height ? parseFloat(String(row.dimensions_height)) : null,
              totalVolume: row.total_volume ? parseFloat(String(row.total_volume)) : null,
              kitchenId: row.kitchen_id,
              storageType: row.storage_type,
              minimumBookingDuration: row.minimum_booking_duration || 1,
              bookingDurationUnit: row.booking_duration_unit || 'monthly',
              pricingModel: row.pricing_model,
              isActive: row.is_active,
              climateControl: row.climate_control,
              humidityControl: row.humidity_control,
              powerOutlets: row.power_outlets,
              insuranceRequired: row.insurance_required,
              approvedBy: row.approved_by,
              approvedAt: row.approved_at,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            };
          }
        } catch (error) {
          console.error('Error getting storage listing by ID (direct query):', error);
        }
      }

      // Fallback to Drizzle
      const [listing] = await db.select().from(storageListings).where(eq(storageListings.id, id));
      if (!listing) return undefined;

      // Convert numeric fields from cents to dollars
      const basePriceCents = listing.basePrice ? parseFloat(listing.basePrice.toString()) : null;
      const pricePerCubicFootCents = listing.pricePerCubicFoot ? parseFloat(listing.pricePerCubicFoot.toString()) : null;

      return {
        ...listing,
        basePrice: basePriceCents !== null ? basePriceCents / 100 : null,
        pricePerCubicFoot: pricePerCubicFootCents !== null ? pricePerCubicFootCents / 100 : null,
      };
    } catch (error) {
      console.error('Error getting storage listing by ID:', error);
      throw error;
    }
  }

  // Get storage listings by kitchen ID
  async getStorageListingsByKitchen(kitchenId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            `SELECT 
              id, kitchen_id, storage_type, name, description,
              base_price::text as base_price,
              price_per_cubic_foot::text as price_per_cubic_foot,
              pricing_model, 
              COALESCE(minimum_booking_duration, 1) as minimum_booking_duration,
              COALESCE(booking_duration_unit, 'monthly') as booking_duration_unit,
              currency,
              dimensions_length::text as dimensions_length,
              dimensions_width::text as dimensions_width,
              dimensions_height::text as dimensions_height,
              total_volume::text as total_volume,
              climate_control, temperature_range,
              status, is_active, created_at, updated_at
            FROM storage_listings 
            WHERE kitchen_id = $1
            ORDER BY created_at DESC`,
            [kitchenId]
          );

          return directQuery.rows.map(row => ({
            id: row.id,
            kitchenId: row.kitchen_id,
            storageType: row.storage_type,
            name: row.name,
            description: row.description,
            // Convert cents to dollars for frontend display
            basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
            pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
            pricingModel: row.pricing_model,
            minimumBookingDuration: row.minimum_booking_duration ?? 1,
            bookingDurationUnit: row.booking_duration_unit ?? 'monthly',
            currency: row.currency || 'CAD',
            dimensionsLength: row.dimensions_length ? parseFloat(row.dimensions_length) : null,
            dimensionsWidth: row.dimensions_width ? parseFloat(row.dimensions_width) : null,
            dimensionsHeight: row.dimensions_height ? parseFloat(row.dimensions_height) : null,
            totalVolume: row.total_volume ? parseFloat(row.total_volume) : null,
            climateControl: row.climate_control ?? false,
            temperatureRange: row.temperature_range,
            status: row.status,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
        } catch (error) {
          console.error('Error getting storage listings by kitchen (direct query):', error);
        }
      }

      // Fallback to Drizzle
      const listings = await db.select().from(storageListings).where(eq(storageListings.kitchenId, kitchenId));
      return listings.map(listing => {
        const basePriceCents = listing.basePrice ? parseFloat(listing.basePrice.toString()) : null;
        const pricePerCubicFootCents = listing.pricePerCubicFoot ? parseFloat(listing.pricePerCubicFoot.toString()) : null;
        return {
          ...listing,
          basePrice: basePriceCents !== null ? basePriceCents / 100 : null,
          pricePerCubicFoot: pricePerCubicFootCents !== null ? pricePerCubicFootCents / 100 : null,
          minimumBookingDuration: listing.minimumBookingDuration || 1,
          bookingDurationUnit: listing.bookingDurationUnit || 'monthly',
        };
      });
    } catch (error) {
      console.error('Error getting storage listings by kitchen:', error);
      throw error;
    }
  }

  // Create storage listing
  async createStorageListing(listing: {
    kitchenId: number;
    storageType: 'dry' | 'cold' | 'freezer';
    name: string;
    description?: string;
    basePrice: number; // in dollars
    pricePerCubicFoot?: number; // in dollars
    pricingModel: 'monthly-flat' | 'per-cubic-foot' | 'hourly' | 'daily';
    minimumBookingDuration?: number;
    bookingDurationUnit?: 'hourly' | 'daily' | 'monthly';
    dimensionsLength?: number;
    dimensionsWidth?: number;
    dimensionsHeight?: number;
    totalVolume?: number;
    shelfCount?: number;
    shelfMaterial?: string;
    accessType?: string;
    temperatureRange?: string;
    climateControl?: boolean;
    humidityControl?: boolean;
    powerOutlets?: number;
    features?: string[];
    securityFeatures?: string[];
    certifications?: string[];
    photos?: string[];
    documents?: string[];
    houseRules?: string[];
    prohibitedItems?: string[];
    insuranceRequired?: boolean;
    availabilityCalendar?: Record<string, any>;
  }): Promise<any> {
    try {
      // Convert prices from dollars to cents
      const basePriceCents = Math.round(listing.basePrice * 100);
      const pricePerCubicFootCents = listing.pricePerCubicFoot ? Math.round(listing.pricePerCubicFoot * 100) : null;

      const insertData: any = {
        kitchenId: listing.kitchenId,
        storageType: listing.storageType,
        name: listing.name,
        description: listing.description || null,
        basePrice: basePriceCents.toString(), // Store as string for numeric type
        pricePerCubicFoot: pricePerCubicFootCents ? pricePerCubicFootCents.toString() : null,
        pricingModel: listing.pricingModel,
        minimumBookingDuration: listing.minimumBookingDuration || 1,
        bookingDurationUnit: listing.bookingDurationUnit || 'monthly',
        currency: 'CAD', // Always CAD
        dimensionsLength: listing.dimensionsLength?.toString() || null,
        dimensionsWidth: listing.dimensionsWidth?.toString() || null,
        dimensionsHeight: listing.dimensionsHeight?.toString() || null,
        totalVolume: listing.totalVolume?.toString() || null,
        shelfCount: listing.shelfCount || null,
        shelfMaterial: listing.shelfMaterial || null,
        accessType: listing.accessType || null,
        temperatureRange: listing.temperatureRange || null,
        climateControl: listing.climateControl || false,
        humidityControl: listing.humidityControl || false,
        powerOutlets: listing.powerOutlets || 0,
        features: listing.features || [],
        securityFeatures: listing.securityFeatures || [],
        certifications: listing.certifications || [],
        photos: listing.photos || [],
        documents: listing.documents || [],
        houseRules: listing.houseRules || [],
        prohibitedItems: listing.prohibitedItems || [],
        insuranceRequired: listing.insuranceRequired || false,
        availabilityCalendar: listing.availabilityCalendar || {},
        status: 'active', // Skip admin moderation - immediately visible to chefs
        isActive: true,
        updatedAt: new Date(),
      };

      const [created] = await db
        .insert(storageListings)
        .values(insertData)
        .returning();

      // Query directly to get the created listing with proper numeric conversion
      return await this.getStorageListingById(created.id);
    } catch (error) {
      console.error('Error creating storage listing:', error);
      throw error;
    }
  }

  // Update storage listing
  async updateStorageListing(id: number, updates: {
    name?: string;
    description?: string;
    storageType?: 'dry' | 'cold' | 'freezer';
    basePrice?: number; // in dollars
    pricePerCubicFoot?: number; // in dollars
    pricingModel?: 'monthly-flat' | 'per-cubic-foot' | 'hourly' | 'daily';
    minimumBookingDuration?: number;
    bookingDurationUnit?: 'hourly' | 'daily' | 'monthly';
    dimensionsLength?: number;
    dimensionsWidth?: number;
    dimensionsHeight?: number;
    totalVolume?: number;
    shelfCount?: number;
    shelfMaterial?: string;
    accessType?: string;
    temperatureRange?: string;
    climateControl?: boolean;
    humidityControl?: boolean;
    powerOutlets?: number;
    isActive?: boolean;
    insuranceRequired?: boolean;
    features?: string[];
    securityFeatures?: string[];
    certifications?: string[];
    photos?: string[];
    documents?: string[];
    houseRules?: string[];
    prohibitedItems?: string[];
    availabilityCalendar?: Record<string, any>;
  }): Promise<any> {
    try {
      const dbUpdates: any = {
        updatedAt: new Date(),
      };

      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description || null;
      if (updates.storageType !== undefined) dbUpdates.storageType = updates.storageType;
      if (updates.pricingModel !== undefined) dbUpdates.pricingModel = updates.pricingModel;
      if (updates.minimumBookingDuration !== undefined) dbUpdates.minimumBookingDuration = updates.minimumBookingDuration;
      if (updates.bookingDurationUnit !== undefined) dbUpdates.bookingDurationUnit = updates.bookingDurationUnit;
      // Currency is always CAD, no need to update
      if (updates.shelfCount !== undefined) dbUpdates.shelfCount = updates.shelfCount;
      if (updates.shelfMaterial !== undefined) dbUpdates.shelfMaterial = updates.shelfMaterial || null;
      if (updates.accessType !== undefined) dbUpdates.accessType = updates.accessType || null;
      if (updates.temperatureRange !== undefined) dbUpdates.temperatureRange = updates.temperatureRange || null;
      if (updates.climateControl !== undefined) dbUpdates.climateControl = updates.climateControl;
      if (updates.humidityControl !== undefined) dbUpdates.humidityControl = updates.humidityControl;
      if (updates.powerOutlets !== undefined) dbUpdates.powerOutlets = updates.powerOutlets;
      if (updates.isActive !== undefined) dbUpdates.isActive = updates.isActive;
      if (updates.insuranceRequired !== undefined) dbUpdates.insuranceRequired = updates.insuranceRequired;
      if (updates.features !== undefined) dbUpdates.features = updates.features;
      if (updates.securityFeatures !== undefined) dbUpdates.securityFeatures = updates.securityFeatures;
      if (updates.certifications !== undefined) dbUpdates.certifications = updates.certifications;
      if (updates.photos !== undefined) dbUpdates.photos = updates.photos;
      if (updates.documents !== undefined) dbUpdates.documents = updates.documents;
      if (updates.houseRules !== undefined) dbUpdates.houseRules = updates.houseRules;
      if (updates.prohibitedItems !== undefined) dbUpdates.prohibitedItems = updates.prohibitedItems;
      if (updates.availabilityCalendar !== undefined) dbUpdates.availabilityCalendar = updates.availabilityCalendar;

      // Convert numeric dimensions
      if (updates.dimensionsLength !== undefined) {
        dbUpdates.dimensionsLength = updates.dimensionsLength?.toString() || null;
      }
      if (updates.dimensionsWidth !== undefined) {
        dbUpdates.dimensionsWidth = updates.dimensionsWidth?.toString() || null;
      }
      if (updates.dimensionsHeight !== undefined) {
        dbUpdates.dimensionsHeight = updates.dimensionsHeight?.toString() || null;
      }
      if (updates.totalVolume !== undefined) {
        dbUpdates.totalVolume = updates.totalVolume?.toString() || null;
      }

      // Convert prices from dollars to cents
      if (updates.basePrice !== undefined) {
        dbUpdates.basePrice = updates.basePrice === null ? null : Math.round(updates.basePrice * 100).toString();
      }
      if (updates.pricePerCubicFoot !== undefined) {
        dbUpdates.pricePerCubicFoot = updates.pricePerCubicFoot === null ? null : Math.round(updates.pricePerCubicFoot * 100).toString();
      }

      // Tiered pricing removed - no longer supported

      const [updated] = await db
        .update(storageListings)
        .set(dbUpdates)
        .where(eq(storageListings.id, id))
        .returning();

      // Query directly to get the updated listing with proper numeric conversion
      return await this.getStorageListingById(id);
    } catch (error) {
      console.error('Error updating storage listing:', error);
      throw error;
    }
  }

  // Delete storage listing
  async deleteStorageListing(id: number): Promise<void> {
    try {
      const result = await db.delete(storageListings)
        .where(eq(storageListings.id, id))
        .returning({ id: storageListings.id });

      if (result.length === 0) {
        throw new Error(`Storage listing with id ${id} not found`);
      }

      console.log(`✅ Storage listing ${id} deleted successfully`);
    } catch (error) {
      console.error('Error deleting storage listing:', error);
      throw error;
    }
  }

  // ===== EQUIPMENT LISTINGS MANAGEMENT =====

  // Get equipment listing by ID
  async getEquipmentListingById(id: number): Promise<any | undefined> {
    try {
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            `SELECT 
              id, kitchen_id, category, equipment_type, brand, model, description,
              condition, age, service_history,
              dimensions::text as dimensions,
              power_requirements,
              specifications::text as specifications,
              certifications, safety_features,
              pricing_model,
              hourly_rate::text as hourly_rate,
              daily_rate::text as daily_rate,
              weekly_rate::text as weekly_rate,
              monthly_rate::text as monthly_rate,
              availability_type,
              minimum_rental_hours, minimum_rental_days, currency,
              usage_restrictions, training_required, cleaning_responsibility,
              status, approved_by, approved_at, rejection_reason,
              is_active, availability_calendar, prep_time_hours,
              photos, manuals, maintenance_log,
              damage_deposit::text as damage_deposit,
              insurance_required,
              created_at, updated_at
            FROM equipment_listings 
            WHERE id = $1`,
            [id]
          );
          if (directQuery.rows && directQuery.rows[0]) {
            const row = directQuery.rows[0];
            // Convert numeric fields from cents to dollars
            return {
              ...row,
              kitchenId: row.kitchen_id,
              equipmentType: row.equipment_type,
              powerRequirements: row.power_requirements,
              serviceHistory: row.service_history,
              cleaningResponsibility: row.cleaning_responsibility,
              prepTimeHours: row.prep_time_hours,
              insuranceRequired: row.insurance_required,
              trainingRequired: row.training_required,
              isActive: row.is_active,
              approvedBy: row.approved_by,
              approvedAt: row.approved_at,
              rejectionReason: row.rejection_reason,
              minimumRentalHours: row.minimum_rental_hours,
              minimumRentalDays: row.minimum_rental_days,
              availabilityCalendar: row.availability_calendar,
              maintenanceLog: row.maintenance_log,
              availabilityType: row.availability_type || 'rental',
              // Convert prices from cents to dollars
              hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
              dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
              weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
              monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
              damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : null,
              // Parse JSONB fields
              dimensions: row.dimensions ? JSON.parse(row.dimensions) : {},
              specifications: row.specifications ? JSON.parse(row.specifications) : {},
            };
          }
        } catch (error) {
          console.error('Error getting equipment listing by ID (direct query):', error);
        }
      }

      // Fallback to Drizzle
      const [listing] = await db.select().from(equipmentListings).where(eq(equipmentListings.id, id));
      if (!listing) return undefined;

      const hourlyRateCents = listing.hourlyRate ? parseFloat(listing.hourlyRate.toString()) : null;
      const dailyRateCents = listing.dailyRate ? parseFloat(listing.dailyRate.toString()) : null;
      const weeklyRateCents = listing.weeklyRate ? parseFloat(listing.weeklyRate.toString()) : null;
      const monthlyRateCents = listing.monthlyRate ? parseFloat(listing.monthlyRate.toString()) : null;
      const damageDepositCents = listing.damageDeposit ? parseFloat(listing.damageDeposit.toString()) : null;

      return {
        ...listing,
        hourlyRate: hourlyRateCents !== null ? hourlyRateCents / 100 : null,
        dailyRate: dailyRateCents !== null ? dailyRateCents / 100 : null,
        weeklyRate: weeklyRateCents !== null ? weeklyRateCents / 100 : null,
        monthlyRate: monthlyRateCents !== null ? monthlyRateCents / 100 : null,
        damageDeposit: damageDepositCents !== null ? damageDepositCents / 100 : null,
      };
    } catch (error) {
      console.error('Error getting equipment listing by ID:', error);
      throw error;
    }
  }

  // Get equipment listings by kitchen ID
  async getEquipmentListingsByKitchen(kitchenId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        try {
          const directQuery = await pool.query(
            `SELECT 
              id, kitchen_id, category, equipment_type, brand, model, description,
              condition, availability_type, pricing_model,
              session_rate::text as session_rate,
              hourly_rate::text as hourly_rate,
              daily_rate::text as daily_rate,
              weekly_rate::text as weekly_rate,
              monthly_rate::text as monthly_rate,
              damage_deposit::text as damage_deposit,
              minimum_rental_hours, minimum_rental_days, currency,
              training_required, cleaning_responsibility,
              status, is_active, created_at, updated_at
            FROM equipment_listings 
            WHERE kitchen_id = $1
            ORDER BY created_at DESC`,
            [kitchenId]
          );

          return directQuery.rows.map(row => ({
            id: row.id,
            kitchenId: row.kitchen_id,
            category: row.category,
            equipmentType: row.equipment_type,
            brand: row.brand,
            model: row.model,
            description: row.description,
            condition: row.condition,
            availabilityType: row.availability_type || 'rental',
            pricingModel: row.pricing_model,
            // PRIMARY: Flat session rate (convert cents to dollars)
            sessionRate: row.session_rate ? parseFloat(String(row.session_rate)) / 100 : 0,
            // Legacy rates (kept for backwards compatibility)
            hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
            dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
            weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
            monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
            damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : 0,
            minimumRentalHours: row.minimum_rental_hours,
            minimumRentalDays: row.minimum_rental_days,
            trainingRequired: row.training_required ?? false,
            cleaningResponsibility: row.cleaning_responsibility,
            currency: row.currency || 'CAD',
            status: row.status,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
        } catch (error) {
          console.error('Error getting equipment listings by kitchen (direct query):', error);
        }
      }

      // Fallback to Drizzle
      const listings = await db.select().from(equipmentListings).where(eq(equipmentListings.kitchenId, kitchenId));
      return listings.map(listing => {
        const sessionRateCents = listing.sessionRate ? parseFloat(listing.sessionRate.toString()) : 0;
        const hourlyRateCents = listing.hourlyRate ? parseFloat(listing.hourlyRate.toString()) : null;
        const dailyRateCents = listing.dailyRate ? parseFloat(listing.dailyRate.toString()) : null;
        const weeklyRateCents = listing.weeklyRate ? parseFloat(listing.weeklyRate.toString()) : null;
        const monthlyRateCents = listing.monthlyRate ? parseFloat(listing.monthlyRate.toString()) : null;
        const damageDepositCents = listing.damageDeposit ? parseFloat(listing.damageDeposit.toString()) : 0;
        return {
          ...listing,
          sessionRate: sessionRateCents / 100,
          hourlyRate: hourlyRateCents !== null ? hourlyRateCents / 100 : null,
          dailyRate: dailyRateCents !== null ? dailyRateCents / 100 : null,
          weeklyRate: weeklyRateCents !== null ? weeklyRateCents / 100 : null,
          monthlyRate: monthlyRateCents !== null ? monthlyRateCents / 100 : null,
          damageDeposit: damageDepositCents / 100,
        };
      });
    } catch (error) {
      console.error('Error getting equipment listings by kitchen:', error);
      throw error;
    }
  }

  // Create equipment listing
  async createEquipmentListing(listing: {
    kitchenId: number;
    category: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';
    equipmentType: string;
    brand?: string;
    model?: string;
    description?: string;
    condition: 'excellent' | 'good' | 'fair' | 'needs-repair';
    age?: number;
    serviceHistory?: string;
    dimensions?: Record<string, any>;
    powerRequirements?: string;
    specifications?: Record<string, any>;
    certifications?: string[];
    safetyFeatures?: string[];
    availabilityType: 'included' | 'rental'; // included (free) or rental (paid)
    sessionRate?: number; // FLAT session rate in dollars - only for rental
    // Legacy fields kept for backwards compatibility
    pricingModel?: 'hourly' | 'daily' | 'weekly' | 'monthly';
    hourlyRate?: number;
    dailyRate?: number;
    weeklyRate?: number;
    monthlyRate?: number;
    minimumRentalHours?: number;
    minimumRentalDays?: number;
    usageRestrictions?: string[];
    trainingRequired?: boolean;
    cleaningResponsibility?: 'renter' | 'host' | 'shared';
    prepTimeHours?: number;
    photos?: string[];
    manuals?: string[];
    maintenanceLog?: any[];
    damageDeposit?: number; // in dollars - only for rental
    insuranceRequired?: boolean;
    availabilityCalendar?: Record<string, any>;
  }): Promise<any> {
    try {
      // Convert session rate from dollars to cents (only for rental equipment)
      const sessionRateCents = listing.sessionRate ? Math.round(listing.sessionRate * 100) : 0;
      const damageDepositCents = listing.damageDeposit ? Math.round(listing.damageDeposit * 100) : 0;

      // Legacy: Also convert old rate fields if provided (for backwards compatibility)
      const hourlyRateCents = listing.hourlyRate ? Math.round(listing.hourlyRate * 100) : null;
      const dailyRateCents = listing.dailyRate ? Math.round(listing.dailyRate * 100) : null;
      const weeklyRateCents = listing.weeklyRate ? Math.round(listing.weeklyRate * 100) : null;
      const monthlyRateCents = listing.monthlyRate ? Math.round(listing.monthlyRate * 100) : null;

      const insertData: any = {
        kitchenId: listing.kitchenId,
        category: listing.category,
        equipmentType: listing.equipmentType,
        brand: listing.brand || null,
        model: listing.model || null,
        description: listing.description || null,
        condition: listing.condition,
        age: listing.age || null,
        serviceHistory: listing.serviceHistory || null,
        dimensions: listing.dimensions || {},
        powerRequirements: listing.powerRequirements || null,
        specifications: listing.specifications || {},
        certifications: listing.certifications || [],
        safetyFeatures: listing.safetyFeatures || [],
        availabilityType: listing.availabilityType || 'rental',
        // NEW: Flat session rate - primary pricing field for rental equipment
        sessionRate: listing.availabilityType === 'rental' ? sessionRateCents.toString() : '0',
        // Legacy pricing fields - kept for backwards compatibility
        pricingModel: listing.availabilityType === 'rental' ? (listing.pricingModel || 'hourly') : null,
        hourlyRate: listing.availabilityType === 'rental' ? (hourlyRateCents ? hourlyRateCents.toString() : null) : null,
        dailyRate: listing.availabilityType === 'rental' ? (dailyRateCents ? dailyRateCents.toString() : null) : null,
        weeklyRate: listing.availabilityType === 'rental' ? (weeklyRateCents ? weeklyRateCents.toString() : null) : null,
        monthlyRate: listing.availabilityType === 'rental' ? (monthlyRateCents ? monthlyRateCents.toString() : null) : null,
        minimumRentalHours: listing.availabilityType === 'rental' ? (listing.minimumRentalHours || null) : null,
        minimumRentalDays: listing.availabilityType === 'rental' ? (listing.minimumRentalDays || null) : null,
        currency: 'CAD',
        usageRestrictions: listing.usageRestrictions || [],
        trainingRequired: listing.trainingRequired || false,
        cleaningResponsibility: listing.cleaningResponsibility || null,
        prepTimeHours: listing.prepTimeHours || 4,
        photos: listing.photos || [],
        manuals: listing.manuals || [],
        maintenanceLog: listing.maintenanceLog || [],
        damageDeposit: listing.availabilityType === 'rental' ? damageDepositCents.toString() : '0',
        insuranceRequired: listing.insuranceRequired || false,
        availabilityCalendar: listing.availabilityCalendar || {},
        status: 'active', // Skip admin moderation - immediately visible to chefs
        isActive: true,
        updatedAt: new Date(),
      };

      const [created] = await db
        .insert(equipmentListings)
        .values(insertData)
        .returning();

      // Query directly to get the created listing with proper numeric conversion
      return await this.getEquipmentListingById(created.id);
    } catch (error) {
      console.error('Error creating equipment listing:', error);
      throw error;
    }
  }

  // Update equipment listing
  async updateEquipmentListing(id: number, updates: {
    category?: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';
    equipmentType?: string;
    brand?: string;
    model?: string;
    description?: string;
    condition?: 'excellent' | 'good' | 'fair' | 'needs-repair';
    age?: number;
    serviceHistory?: string;
    dimensions?: Record<string, any>;
    powerRequirements?: string;
    specifications?: Record<string, any>;
    availabilityType?: 'included' | 'rental'; // NEW: included (free) or rental (paid)
    pricingModel?: 'hourly' | 'daily' | 'weekly' | 'monthly'; // Optional - only for rental
    hourlyRate?: number; // in dollars - only for rental
    dailyRate?: number; // in dollars - only for rental
    weeklyRate?: number; // in dollars - only for rental
    monthlyRate?: number; // in dollars - only for rental
    minimumRentalHours?: number; // only for rental
    minimumRentalDays?: number; // only for rental
    usageRestrictions?: string[];
    trainingRequired?: boolean;
    cleaningResponsibility?: 'renter' | 'host' | 'shared';
    isActive?: boolean;
    prepTimeHours?: number;
    damageDeposit?: number; // in dollars - only for rental
    insuranceRequired?: boolean;
    certifications?: string[];
    safetyFeatures?: string[];
    photos?: string[];
    manuals?: string[];
    maintenanceLog?: any[];
    availabilityCalendar?: Record<string, any>;
  }): Promise<any> {
    try {
      const dbUpdates: any = {
        updatedAt: new Date(),
      };

      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.equipmentType !== undefined) dbUpdates.equipmentType = updates.equipmentType;
      if (updates.brand !== undefined) dbUpdates.brand = updates.brand || null;
      if (updates.model !== undefined) dbUpdates.model = updates.model || null;
      if (updates.description !== undefined) dbUpdates.description = updates.description || null;
      if (updates.condition !== undefined) dbUpdates.condition = updates.condition;
      if (updates.age !== undefined) dbUpdates.age = updates.age || null;
      if (updates.serviceHistory !== undefined) dbUpdates.serviceHistory = updates.serviceHistory || null;
      if (updates.dimensions !== undefined) dbUpdates.dimensions = updates.dimensions || {};
      if (updates.powerRequirements !== undefined) dbUpdates.powerRequirements = updates.powerRequirements || null;
      if (updates.specifications !== undefined) dbUpdates.specifications = updates.specifications || {};
      if (updates.availabilityType !== undefined) {
        dbUpdates.availabilityType = updates.availabilityType;
        // If changing to included, clear pricing fields
        if (updates.availabilityType === 'included') {
          dbUpdates.pricingModel = null;
          dbUpdates.hourlyRate = null;
          dbUpdates.dailyRate = null;
          dbUpdates.weeklyRate = null;
          dbUpdates.monthlyRate = null;
          dbUpdates.minimumRentalHours = null;
          dbUpdates.minimumRentalDays = null;
          dbUpdates.damageDeposit = '0';
        }
      }
      if (updates.pricingModel !== undefined) {
        // Only set pricing model if it's rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.pricingModel = updates.pricingModel;
        }
      }
      if (updates.minimumRentalHours !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.minimumRentalHours = updates.minimumRentalHours;
        }
      }
      if (updates.minimumRentalDays !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.minimumRentalDays = updates.minimumRentalDays || null;
        }
      }
      if (updates.usageRestrictions !== undefined) dbUpdates.usageRestrictions = updates.usageRestrictions;
      if (updates.trainingRequired !== undefined) dbUpdates.trainingRequired = updates.trainingRequired;
      if (updates.cleaningResponsibility !== undefined) dbUpdates.cleaningResponsibility = updates.cleaningResponsibility || null;
      if (updates.isActive !== undefined) dbUpdates.isActive = updates.isActive;
      if (updates.prepTimeHours !== undefined) dbUpdates.prepTimeHours = updates.prepTimeHours;
      if (updates.insuranceRequired !== undefined) dbUpdates.insuranceRequired = updates.insuranceRequired;
      if (updates.certifications !== undefined) dbUpdates.certifications = updates.certifications;
      if (updates.safetyFeatures !== undefined) dbUpdates.safetyFeatures = updates.safetyFeatures;
      if (updates.photos !== undefined) dbUpdates.photos = updates.photos;
      if (updates.manuals !== undefined) dbUpdates.manuals = updates.manuals;
      if (updates.maintenanceLog !== undefined) dbUpdates.maintenanceLog = updates.maintenanceLog;
      if (updates.availabilityCalendar !== undefined) dbUpdates.availabilityCalendar = updates.availabilityCalendar;

      // Convert prices from dollars to cents (only for rental equipment)
      if (updates.hourlyRate !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.hourlyRate = updates.hourlyRate === null ? null : Math.round(updates.hourlyRate * 100).toString();
        } else {
          dbUpdates.hourlyRate = null;
        }
      }
      if (updates.dailyRate !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.dailyRate = updates.dailyRate === null ? null : Math.round(updates.dailyRate * 100).toString();
        } else {
          dbUpdates.dailyRate = null;
        }
      }
      if (updates.weeklyRate !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.weeklyRate = updates.weeklyRate === null ? null : Math.round(updates.weeklyRate * 100).toString();
        } else {
          dbUpdates.weeklyRate = null;
        }
      }
      if (updates.monthlyRate !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.monthlyRate = updates.monthlyRate === null ? null : Math.round(updates.monthlyRate * 100).toString();
        } else {
          dbUpdates.monthlyRate = null;
        }
      }
      if (updates.damageDeposit !== undefined) {
        // Only set if rental equipment
        if (updates.availabilityType === 'rental' || !updates.availabilityType) {
          dbUpdates.damageDeposit = updates.damageDeposit === null ? null : Math.round(updates.damageDeposit * 100).toString();
        } else {
          dbUpdates.damageDeposit = '0';
        }
      }

      const [updated] = await db
        .update(equipmentListings)
        .set(dbUpdates)
        .where(eq(equipmentListings.id, id))
        .returning();

      // Query directly to get the updated listing with proper numeric conversion
      return await this.getEquipmentListingById(id);
    } catch (error) {
      console.error('Error updating equipment listing:', error);
      throw error;
    }
  }

  // Delete equipment listing
  async deleteEquipmentListing(id: number): Promise<void> {
    try {
      const result = await db.delete(equipmentListings)
        .where(eq(equipmentListings.id, id))
        .returning({ id: equipmentListings.id });

      if (result.length === 0) {
        throw new Error(`Equipment listing with id ${id} not found`);
      }

      console.log(`✅ Equipment listing ${id} deleted successfully`);
    } catch (error) {
      console.error('Error deleting equipment listing:', error);
      throw error;
    }
  }

  // ==================== STORAGE BOOKING METHODS ====================

  /**
   * Create a storage booking
   * @param data - Storage booking data with prices in CENTS (internal use from booking flow)
   */
  async createStorageBooking(data: {
    storageListingId: number;
    kitchenBookingId: number;
    chefId: number | null;
    startDate: Date;
    endDate: Date;
    totalPriceCents: number;
    pricingModel: string;
    serviceFeeCents?: number;
    currency?: string;
  }): Promise<any> {
    try {
      const result = await db.insert(storageBookings).values({
        storageListingId: data.storageListingId,
        kitchenBookingId: data.kitchenBookingId,
        chefId: data.chefId,
        startDate: data.startDate,
        endDate: data.endDate,
        status: 'pending',
        totalPrice: data.totalPriceCents.toString(),
        pricingModel: data.pricingModel as any,
        paymentStatus: 'pending',
        serviceFee: (data.serviceFeeCents || 0).toString(),
        currency: data.currency || 'CAD',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      console.log(`✅ Storage booking created successfully with ID ${result[0].id}`);
      return result[0];
    } catch (error) {
      console.error('Error creating storage booking:', error);
      throw error;
    }
  }

  /**
   * Get storage bookings by kitchen booking ID
   * Returns prices in dollars for API response
   */
  async getStorageBookingsByKitchenBooking(kitchenBookingId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        const result = await pool.query(
          `SELECT 
            sb.id, sb.storage_listing_id, sb.kitchen_booking_id, sb.chef_id,
            sb.start_date, sb.end_date, sb.status,
            sb.total_price::text as total_price,
            sb.pricing_model, sb.payment_status, sb.payment_intent_id,
            sb.service_fee::text as service_fee,
            sb.currency, sb.created_at, sb.updated_at,
            sl.name as storage_name, sl.storage_type
          FROM storage_bookings sb
          JOIN storage_listings sl ON sb.storage_listing_id = sl.id
          WHERE sb.kitchen_booking_id = $1
          ORDER BY sb.created_at DESC`,
          [kitchenBookingId]
        );

        return result.rows.map(row => ({
          id: row.id,
          storageListingId: row.storage_listing_id,
          kitchenBookingId: row.kitchen_booking_id,
          chefId: row.chef_id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.status,
          totalPrice: row.total_price ? parseFloat(row.total_price) / 100 : 0, // Convert cents to dollars
          pricingModel: row.pricing_model,
          paymentStatus: row.payment_status,
          paymentIntentId: row.payment_intent_id,
          serviceFee: row.service_fee ? parseFloat(row.service_fee) / 100 : 0, // Convert cents to dollars
          currency: row.currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          storageName: row.storage_name,
          storageType: row.storage_type,
        }));
      }

      // Fallback to Drizzle ORM
      const result = await db.select()
        .from(storageBookings)
        .where(eq(storageBookings.kitchenBookingId, kitchenBookingId));

      return result.map(row => ({
        ...row,
        totalPrice: row.totalPrice ? parseFloat(row.totalPrice) / 100 : 0,
        serviceFee: row.serviceFee ? parseFloat(row.serviceFee) / 100 : 0,
      }));
    } catch (error) {
      console.error('Error getting storage bookings:', error);
      throw error;
    }
  }

  /**
   * Get storage bookings by chef ID
   * Returns prices in dollars for API response
   */
  async getStorageBookingsByChef(chefId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        const result = await pool.query(
          `SELECT 
            sb.id, sb.storage_listing_id, sb.kitchen_booking_id, sb.chef_id,
            sb.start_date, sb.end_date, sb.status,
            sb.total_price::text as total_price,
            sb.pricing_model, sb.payment_status, sb.payment_intent_id,
            sb.service_fee::text as service_fee,
            sb.currency, sb.created_at, sb.updated_at,
            sl.name as storage_name, sl.storage_type, sl.kitchen_id,
            k.name as kitchen_name
          FROM storage_bookings sb
          JOIN storage_listings sl ON sb.storage_listing_id = sl.id
          JOIN kitchens k ON sl.kitchen_id = k.id
          WHERE sb.chef_id = $1
          ORDER BY sb.start_date DESC`,
          [chefId]
        );

        return result.rows.map(row => ({
          id: row.id,
          storageListingId: row.storage_listing_id,
          kitchenBookingId: row.kitchen_booking_id,
          chefId: row.chef_id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.status,
          totalPrice: row.total_price ? parseFloat(row.total_price) / 100 : 0,
          pricingModel: row.pricing_model,
          paymentStatus: row.payment_status,
          paymentIntentId: row.payment_intent_id,
          serviceFee: row.service_fee ? parseFloat(row.service_fee) / 100 : 0,
          currency: row.currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          storageName: row.storage_name,
          storageType: row.storage_type,
          kitchenId: row.kitchen_id,
          kitchenName: row.kitchen_name,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting storage bookings by chef:', error);
      throw error;
    }
  }

  /**
   * Update storage booking status
   */
  async updateStorageBookingStatus(id: number, status: string, paymentStatus?: string): Promise<any> {
    try {
      const updateData: any = {
        status: status as any,
        updatedAt: new Date(),
      };

      if (paymentStatus) {
        updateData.paymentStatus = paymentStatus as any;
      }

      const result = await db.update(storageBookings)
        .set(updateData)
        .where(eq(storageBookings.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Storage booking with id ${id} not found`);
      }

      console.log(`✅ Storage booking ${id} status updated to ${status}`);
      return result[0];
    } catch (error) {
      console.error('Error updating storage booking status:', error);
      throw error;
    }
  }

  /**
   * Delete storage booking
   */
  async deleteStorageBooking(id: number): Promise<void> {
    try {
      const result = await db.delete(storageBookings)
        .where(eq(storageBookings.id, id))
        .returning({ id: storageBookings.id });

      if (result.length === 0) {
        throw new Error(`Storage booking with id ${id} not found`);
      }

      console.log(`✅ Storage booking ${id} deleted successfully`);
    } catch (error) {
      console.error('Error deleting storage booking:', error);
      throw error;
    }
  }

  /**
   * Get storage booking by ID
   * Returns price in dollars for API response
   */
  async getStorageBookingById(id: number): Promise<any | undefined> {
    try {
      if (pool && 'query' in pool) {
        const result = await pool.query(
          `SELECT 
            sb.id, sb.storage_listing_id, sb.kitchen_booking_id, sb.chef_id,
            sb.start_date, sb.end_date, sb.status,
            sb.total_price::text as total_price,
            sb.pricing_model, sb.payment_status, sb.payment_intent_id,
            sb.service_fee::text as service_fee,
            sb.currency, sb.created_at, sb.updated_at,
            sl.name as storage_name, sl.storage_type, sl.kitchen_id,
            sl.base_price::text as base_price,
            sl.minimum_booking_duration,
            k.name as kitchen_name
          FROM storage_bookings sb
          JOIN storage_listings sl ON sb.storage_listing_id = sl.id
          JOIN kitchens k ON sl.kitchen_id = k.id
          WHERE sb.id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return undefined;
        }

        const row = result.rows[0];
        return {
          id: row.id,
          storageListingId: row.storage_listing_id,
          kitchenBookingId: row.kitchen_booking_id,
          chefId: row.chef_id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.status,
          totalPrice: row.total_price ? parseFloat(row.total_price) / 100 : 0,
          pricingModel: row.pricing_model,
          paymentStatus: row.payment_status,
          paymentIntentId: row.payment_intent_id,
          serviceFee: row.service_fee ? parseFloat(row.service_fee) / 100 : 0,
          currency: row.currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          storageName: row.storage_name,
          storageType: row.storage_type,
          kitchenId: row.kitchen_id,
          kitchenName: row.kitchen_name,
          basePrice: row.base_price ? parseFloat(row.base_price) / 100 : 0,
          minimumBookingDuration: row.minimum_booking_duration,
        };
      }

      return undefined;
    } catch (error) {
      console.error('Error getting storage booking by ID:', error);
      throw error;
    }
  }

  /**
   * Get platform service fee rate from settings
   * @returns Service fee rate as decimal (e.g., 0.05 for 5%)
   */
  async getServiceFeeRate(): Promise<number> {
    try {
      const [setting] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'service_fee_rate'))
        .limit(1);

      if (setting) {
        const rate = parseFloat(setting.value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          return rate;
        }
      }

      // Default to 5% if not set or invalid
      return 0.05;
    } catch (error) {
      console.error('Error getting service fee rate:', error);
      // Default to 5% on error
      return 0.05;
    }
  }

  /**
   * Extend storage booking to a new end date
   * Calculates additional cost based on the extension period
   * @param id - Storage booking ID
   * @param newEndDate - New end date for the booking
   * @returns Updated storage booking with new pricing
   */
  async extendStorageBooking(id: number, newEndDate: Date): Promise<any> {
    try {
      // Get current storage booking
      const booking = await this.getStorageBookingById(id);
      if (!booking) {
        throw new Error(`Storage booking with id ${id} not found`);
      }

      // Validate new end date is after current end date
      const currentEndDate = new Date(booking.endDate);
      if (newEndDate <= currentEndDate) {
        throw new Error('New end date must be after the current end date');
      }

      // Get storage listing to get pricing info
      const storageListing = await this.getStorageListingById(booking.storageListingId);
      if (!storageListing) {
        throw new Error(`Storage listing ${booking.storageListingId} not found`);
      }

      // Calculate extension period in days
      const extensionDays = Math.ceil((newEndDate.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));

      // Ensure minimum booking duration is met
      const minDays = storageListing.minimumBookingDuration || 1;
      if (extensionDays < minDays) {
        throw new Error(`Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}`);
      }

      // Get configurable service fee rate
      const serviceFeeRate = await this.getServiceFeeRate();

      // Calculate additional cost (daily rate × extension days)
      const basePricePerDay = storageListing.basePrice || 0; // in dollars
      const extensionBasePrice = basePricePerDay * extensionDays;
      const extensionServiceFee = extensionBasePrice * serviceFeeRate; // Configurable service fee
      const extensionTotalPrice = extensionBasePrice + extensionServiceFee;

      // Convert to cents for database
      const extensionTotalPriceCents = Math.round(extensionTotalPrice * 100);
      const extensionServiceFeeCents = Math.round(extensionServiceFee * 100);

      // Calculate new total price (existing + extension)
      const existingTotalPriceCents = Math.round(booking.totalPrice * 100);
      const existingServiceFeeCents = Math.round(booking.serviceFee * 100);
      const newTotalPriceCents = existingTotalPriceCents + extensionTotalPriceCents;
      const newServiceFeeCents = existingServiceFeeCents + extensionServiceFeeCents;

      // Update storage booking
      const result = await db.update(storageBookings)
        .set({
          endDate: newEndDate,
          totalPrice: newTotalPriceCents.toString(),
          serviceFee: newServiceFeeCents.toString(),
          updatedAt: new Date(),
        })
        .where(eq(storageBookings.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Failed to update storage booking ${id}`);
      }

      console.log(`✅ Storage booking ${id} extended to ${newEndDate.toISOString()}`);

      // Return updated booking with extension details
      const updatedBooking = await this.getStorageBookingById(id);
      return {
        ...updatedBooking,
        extensionDetails: {
          extensionDays,
          extensionBasePrice,
          extensionServiceFee,
          extensionTotalPrice,
          newEndDate: newEndDate.toISOString(),
        },
      };
    } catch (error) {
      console.error('Error extending storage booking:', error);
      throw error;
    }
  }

  /**
   * Process overstayer penalties for expired storage bookings
   * Charges 2x daily rate for each day past expiry
   * @param maxDaysToCharge - Maximum days to charge (default: 7 days)
   * @returns Array of processed bookings with penalty charges
   */
  async processOverstayerPenalties(maxDaysToCharge: number = 7): Promise<any[]> {
    try {
      if (!pool || !('query' in pool)) {
        console.warn('Database pool not available for overstayer penalty processing');
        return [];
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find expired storage bookings that haven't been cancelled
      const result = await pool.query(
        `SELECT 
          sb.id, sb.storage_listing_id, sb.chef_id, sb.end_date, sb.total_price::text as total_price,
          sb.service_fee::text as service_fee, sb.payment_status, sb.payment_intent_id,
          sl.base_price::text as base_price, sl.minimum_booking_duration
        FROM storage_bookings sb
        JOIN storage_listings sl ON sb.storage_listing_id = sl.id
        WHERE sb.end_date < $1
          AND sb.status != 'cancelled'
          AND sb.payment_status != 'failed'
        ORDER BY sb.end_date ASC`,
        [today]
      );

      const processedBookings: any[] = [];

      for (const row of result.rows) {
        try {
          const bookingId = row.id;
          const endDate = new Date(row.end_date);
          const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));

          // Only charge up to maxDaysToCharge
          const daysToCharge = Math.min(daysOverdue, maxDaysToCharge);

          if (daysToCharge <= 0) continue;

          // Calculate penalty (2x daily rate)
          const basePricePerDay = parseFloat(row.base_price) / 100; // Convert from cents to dollars
          const penaltyRatePerDay = basePricePerDay * 2; // 2x penalty rate
          const penaltyBasePrice = penaltyRatePerDay * daysToCharge;
          // Get service fee rate dynamically
          const serviceFeeRate = await this.getServiceFeeRate();
          const penaltyServiceFee = penaltyBasePrice * serviceFeeRate;
          const penaltyTotalPrice = penaltyBasePrice + penaltyServiceFee;

          // Convert to cents
          const penaltyTotalPriceCents = Math.round(penaltyTotalPrice * 100);
          const penaltyServiceFeeCents = Math.round(penaltyServiceFee * 100);

          // Get current totals
          const currentTotalPriceCents = Math.round(parseFloat(row.total_price));
          const currentServiceFeeCents = Math.round(parseFloat(row.service_fee) || 0);

          // Calculate new totals
          const newTotalPriceCents = currentTotalPriceCents + penaltyTotalPriceCents;
          const newServiceFeeCents = currentServiceFeeCents + penaltyServiceFeeCents;
          const newEndDate = new Date(endDate);
          newEndDate.setDate(newEndDate.getDate() + daysToCharge);

          // Update storage booking
          await db.update(storageBookings)
            .set({
              endDate: newEndDate,
              totalPrice: newTotalPriceCents.toString(),
              serviceFee: newServiceFeeCents.toString(),
              updatedAt: new Date(),
            })
            .where(eq(storageBookings.id, bookingId));

          processedBookings.push({
            bookingId,
            chefId: row.chef_id,
            daysOverdue,
            daysCharged: daysToCharge,
            penaltyAmount: penaltyTotalPrice,
            newEndDate: newEndDate.toISOString(),
          });

          console.log(`✅ Overstayer penalty applied to storage booking ${bookingId}: ${daysToCharge} days @ 2x rate = $${penaltyTotalPrice.toFixed(2)}`);
        } catch (error) {
          console.error(`Error processing overstayer penalty for booking ${row.id}:`, error);
        }
      }

      return processedBookings;
    } catch (error) {
      console.error('Error processing overstayer penalties:', error);
      throw error;
    }
  }

  // ==================== EQUIPMENT BOOKING METHODS ====================

  /**
   * Create an equipment booking
   * @param data - Equipment booking data with prices in CENTS (internal use from booking flow)
   */
  async createEquipmentBooking(data: {
    equipmentListingId: number;
    kitchenBookingId: number;
    chefId: number | null;
    startDate: Date;
    endDate: Date;
    totalPriceCents: number;
    pricingModel: string | null;
    damageDepositCents?: number;
    serviceFeeCents?: number;
    currency?: string;
  }): Promise<any> {
    try {
      const result = await db.insert(equipmentBookings).values({
        equipmentListingId: data.equipmentListingId,
        kitchenBookingId: data.kitchenBookingId,
        chefId: data.chefId,
        startDate: data.startDate,
        endDate: data.endDate,
        status: 'pending',
        totalPrice: data.totalPriceCents.toString(),
        pricingModel: data.pricingModel as any,
        paymentStatus: data.totalPriceCents > 0 ? 'pending' : 'not_required',
        damageDeposit: (data.damageDepositCents || 0).toString(),
        serviceFee: (data.serviceFeeCents || 0).toString(),
        currency: data.currency || 'CAD',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any).returning();

      console.log(`✅ Equipment booking created successfully with ID ${result[0].id}`);
      return result[0];
    } catch (error) {
      console.error('Error creating equipment booking:', error);
      throw error;
    }
  }

  /**
   * Get equipment bookings by kitchen booking ID
   * Returns prices in dollars for API response
   */
  async getEquipmentBookingsByKitchenBooking(kitchenBookingId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        const result = await pool.query(
          `SELECT 
            eb.id, eb.equipment_listing_id, eb.kitchen_booking_id, eb.chef_id,
            eb.start_date, eb.end_date, eb.status,
            eb.total_price::text as total_price,
            eb.pricing_model, eb.payment_status, eb.payment_intent_id,
            eb.damage_deposit::text as damage_deposit,
            eb.service_fee::text as service_fee,
            eb.currency, eb.created_at, eb.updated_at,
            el.equipment_type, el.brand, el.model, el.availability_type
          FROM equipment_bookings eb
          JOIN equipment_listings el ON eb.equipment_listing_id = el.id
          WHERE eb.kitchen_booking_id = $1
          ORDER BY eb.created_at DESC`,
          [kitchenBookingId]
        );

        return result.rows.map(row => ({
          id: row.id,
          equipmentListingId: row.equipment_listing_id,
          kitchenBookingId: row.kitchen_booking_id,
          chefId: row.chef_id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.status,
          totalPrice: row.total_price ? parseFloat(row.total_price) / 100 : 0, // Convert cents to dollars
          pricingModel: row.pricing_model,
          paymentStatus: row.payment_status,
          paymentIntentId: row.payment_intent_id,
          damageDeposit: row.damage_deposit ? parseFloat(row.damage_deposit) / 100 : 0, // Convert cents to dollars
          serviceFee: row.service_fee ? parseFloat(row.service_fee) / 100 : 0, // Convert cents to dollars
          currency: row.currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          equipmentType: row.equipment_type,
          brand: row.brand,
          model: row.model,
          availabilityType: row.availability_type,
        }));
      }

      // Fallback to Drizzle ORM
      const result = await db.select()
        .from(equipmentBookings)
        .where(eq(equipmentBookings.kitchenBookingId, kitchenBookingId));

      return result.map(row => ({
        ...row,
        totalPrice: row.totalPrice ? parseFloat(row.totalPrice) / 100 : 0,
        damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) / 100 : 0,
        serviceFee: row.serviceFee ? parseFloat(row.serviceFee) / 100 : 0,
      }));
    } catch (error) {
      console.error('Error getting equipment bookings:', error);
      throw error;
    }
  }

  /**
   * Get equipment bookings by chef ID
   * Returns prices in dollars for API response
   */
  async getEquipmentBookingsByChef(chefId: number): Promise<any[]> {
    try {
      if (pool && 'query' in pool) {
        const result = await pool.query(
          `SELECT 
            eb.id, eb.equipment_listing_id, eb.kitchen_booking_id, eb.chef_id,
            eb.start_date, eb.end_date, eb.status,
            eb.total_price::text as total_price,
            eb.pricing_model, eb.payment_status, eb.payment_intent_id,
            eb.damage_deposit::text as damage_deposit,
            eb.service_fee::text as service_fee,
            eb.currency, eb.created_at, eb.updated_at,
            el.equipment_type, el.brand, el.model, el.availability_type, el.kitchen_id,
            k.name as kitchen_name
          FROM equipment_bookings eb
          JOIN equipment_listings el ON eb.equipment_listing_id = el.id
          JOIN kitchens k ON el.kitchen_id = k.id
          WHERE eb.chef_id = $1
          ORDER BY eb.start_date DESC`,
          [chefId]
        );

        return result.rows.map(row => ({
          id: row.id,
          equipmentListingId: row.equipment_listing_id,
          kitchenBookingId: row.kitchen_booking_id,
          chefId: row.chef_id,
          startDate: row.start_date,
          endDate: row.end_date,
          status: row.status,
          totalPrice: row.total_price ? parseFloat(row.total_price) / 100 : 0,
          pricingModel: row.pricing_model,
          paymentStatus: row.payment_status,
          paymentIntentId: row.payment_intent_id,
          damageDeposit: row.damage_deposit ? parseFloat(row.damage_deposit) / 100 : 0,
          serviceFee: row.service_fee ? parseFloat(row.service_fee) / 100 : 0,
          currency: row.currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          equipmentType: row.equipment_type,
          brand: row.brand,
          model: row.model,
          availabilityType: row.availability_type,
          kitchenId: row.kitchen_id,
          kitchenName: row.kitchen_name,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting equipment bookings by chef:', error);
      throw error;
    }
  }

  /**
   * Update equipment booking status
   */
  async updateEquipmentBookingStatus(id: number, status: string, paymentStatus?: string): Promise<any> {
    try {
      const updateData: any = {
        status: status as any,
        updatedAt: new Date(),
      };

      if (paymentStatus) {
        updateData.paymentStatus = paymentStatus as any;
      }

      const result = await db.update(equipmentBookings)
        .set(updateData)
        .where(eq(equipmentBookings.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Equipment booking with id ${id} not found`);
      }

      console.log(`✅ Equipment booking ${id} status updated to ${status}`);
      return result[0];
    } catch (error) {
      console.error('Error updating equipment booking status:', error);
      throw error;
    }
  }

  /**
   * Delete equipment booking
   */
  async deleteEquipmentBooking(id: number): Promise<void> {
    try {
      const result = await db.delete(equipmentBookings)
        .where(eq(equipmentBookings.id, id))
        .returning({ id: equipmentBookings.id });

      if (result.length === 0) {
        throw new Error(`Equipment booking with id ${id} not found`);
      }

      console.log(`✅ Equipment booking ${id} deleted successfully`);
    } catch (error) {
      console.error('Error deleting equipment booking:', error);
      throw error;
    }
  }

  async deleteKitchen(id: number): Promise<void> {
    try {
      // Check if kitchen has bookings first (foreign key constraint requires this)
      const existingBookings = await db.select().from(kitchenBookings).where(eq(kitchenBookings.kitchenId, id));
      if (existingBookings.length > 0) {
        throw new Error(`Cannot delete kitchen: It has ${existingBookings.length} booking(s). Please cancel or reassign bookings first.`);
      }

      // Use transaction to ensure atomicity - all related data deleted together (best practice per Drizzle ORM)
      await db.transaction(async (tx) => {
        // Delete availability records
        await tx.delete(kitchenAvailability).where(eq(kitchenAvailability.kitchenId, id));

        // Delete date overrides
        await tx.delete(kitchenDateOverrides).where(eq(kitchenDateOverrides.kitchenId, id));

        // Delete kitchen (must be last due to foreign key constraints)
        await tx.delete(kitchens).where(eq(kitchens.id, id));
      });

      console.log(`✅ Deleted kitchen ${id} and all related records`);
    } catch (error: any) {
      console.error('Error deleting kitchen:', error);
      throw error;
    }
  }

  // ===== KITCHEN AVAILABILITY MANAGEMENT =====

  async setKitchenAvailability(kitchenId: number, availability: { dayOfWeek: number; startTime: string; endTime: string; isAvailable?: boolean }): Promise<any> {
    try {
      console.log('🕒 Setting kitchen availability:', { kitchenId, ...availability });

      // Use default value for isAvailable if not provided
      const isAvailable = availability.isAvailable !== undefined ? availability.isAvailable : true;

      // Check if availability exists for this kitchen and day
      const existing = await db
        .select()
        .from(kitchenAvailability)
        .where(and(
          eq(kitchenAvailability.kitchenId, kitchenId),
          eq(kitchenAvailability.dayOfWeek, availability.dayOfWeek)
        ));

      console.log(`🔍 Found ${existing.length} existing availability records for kitchen ${kitchenId}, day ${availability.dayOfWeek}`);

      if (existing.length > 0) {
        console.log('🔄 Updating existing availability record:', existing[0].id);
        // Update existing
        const [updated] = await db
          .update(kitchenAvailability)
          .set({
            startTime: availability.startTime,
            endTime: availability.endTime,
            isAvailable: isAvailable
          })
          .where(and(
            eq(kitchenAvailability.kitchenId, kitchenId),
            eq(kitchenAvailability.dayOfWeek, availability.dayOfWeek)
          ))
          .returning();
        console.log('✅ Updated availability:', updated);
        return updated;
      } else {
        console.log('➕ Creating new availability record');
        // Create new
        const insertData = {
          kitchenId,
          dayOfWeek: availability.dayOfWeek,
          startTime: availability.startTime,
          endTime: availability.endTime,
          isAvailable: isAvailable
        };

        console.log('📝 Insert data:', insertData);

        const [created] = await db
          .insert(kitchenAvailability)
          .values(insertData)
          .returning();

        console.log('✅ Availability created successfully:', created);
        return created;
      }
    } catch (error: any) {
      console.error('Error setting kitchen availability:', error);
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
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

  // ===== KITCHEN DATE OVERRIDES MANAGEMENT =====

  async getKitchenDateOverrideById(id: number): Promise<any | undefined> {
    try {
      const [override] = await db
        .select()
        .from(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.id, id));
      return override || undefined;
    } catch (error) {
      console.error('Error getting kitchen date override by ID:', error);
      throw error;
    }
  }

  async createKitchenDateOverride(overrideData: {
    kitchenId: number;
    specificDate: Date;
    startTime?: string;
    endTime?: string;
    isAvailable: boolean;
    reason?: string
  }): Promise<any> {
    try {
      // Check for existing override on the same date for this kitchen
      // Extract just the date part (YYYY-MM-DD) for comparison
      const dateStr = overrideData.specificDate.toISOString().split('T')[0];

      const existingOverrides = await db
        .select()
        .from(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.kitchenId, overrideData.kitchenId));

      // Find if there's already an override for this specific date
      const existing = existingOverrides.find(o => {
        const existingDateStr = new Date(o.specificDate).toISOString().split('T')[0];
        return existingDateStr === dateStr;
      });

      if (existing) {
        // Update existing override instead of creating duplicate
        console.log(`📝 Updating existing override ID ${existing.id} for date ${dateStr}`);
        const [updated] = await db
          .update(kitchenDateOverrides)
          .set({
            startTime: overrideData.startTime,
            endTime: overrideData.endTime,
            isAvailable: overrideData.isAvailable,
            reason: overrideData.reason,
            updatedAt: new Date(),
          })
          .where(eq(kitchenDateOverrides.id, existing.id))
          .returning();
        return updated;
      }

      // No existing override, create new one
      console.log(`➕ Creating new override for date ${dateStr}`);
      const [override] = await db
        .insert(kitchenDateOverrides)
        .values(overrideData)
        .returning();
      return override;
    } catch (error) {
      console.error('Error creating kitchen date override:', error);
      throw error;
    }
  }

  async getKitchenDateOverrides(kitchenId: number, startDate?: Date, endDate?: Date): Promise<any[]> {
    try {
      let query = db
        .select()
        .from(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.kitchenId, kitchenId));

      // If date range is specified, filter by it
      if (startDate && endDate) {
        return await query.then(results =>
          results.filter(r => {
            const overrideDate = new Date(r.specificDate);
            return overrideDate >= startDate && overrideDate <= endDate;
          })
        );
      }

      return await query;
    } catch (error) {
      console.error('Error getting kitchen date overrides:', error);
      throw error;
    }
  }

  async getKitchenDateOverrideForDate(kitchenId: number, date: Date | string): Promise<any | undefined> {
    try {
      // Extract date string in YYYY-MM-DD format for timezone-safe comparison
      // Handle both Date objects and ISO strings
      let targetDateStr: string;
      if (typeof date === 'string') {
        // If it's a string like "2025-12-23" or "2025-12-23T00:00:00.000Z"
        targetDateStr = date.split('T')[0];
      } else if (date instanceof Date) {
        // If it's a Date object, extract the UTC date
        targetDateStr = date.toISOString().split('T')[0];
      } else {
        throw new Error('Invalid date type');
      }

      console.log(`🔍 Looking for date override - kitchen: ${kitchenId}, target date: ${targetDateStr}`);

      const allOverrides = await db
        .select()
        .from(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.kitchenId, kitchenId));

      console.log(`   Found ${allOverrides.length} total overrides for kitchen ${kitchenId}`);

      // Find all overrides for the specific date using string comparison (timezone-safe)
      const dateOverrides = allOverrides.filter(o => {
        // Convert override date to YYYY-MM-DD string
        const overrideDateStr = new Date(o.specificDate).toISOString().split('T')[0];
        const matches = overrideDateStr === targetDateStr;
        if (matches) {
          console.log(`   Found override ID ${o.id}: isAvailable=${o.isAvailable}, startTime=${o.startTime}, endTime=${o.endTime}`);
        }
        return matches;
      });

      if (dateOverrides.length === 0) {
        console.log(`   Result: NO MATCH`);
        return undefined;
      }

      // Prioritize available overrides (isAvailable=true) with hours
      // This handles the case where there might be both an "open" override and "closed" override
      const availableOverride = dateOverrides.find(o =>
        o.isAvailable === true && o.startTime && o.endTime
      );

      if (availableOverride) {
        console.log(`   Result: FOUND AVAILABLE override ID ${availableOverride.id}`);
        return availableOverride;
      }

      // If no available override, return the first override (could be closed or incomplete)
      const override = dateOverrides[0];
      console.log(`   Result: FOUND override ID ${override.id} (isAvailable=${override.isAvailable})`);
      return override;
    } catch (error) {
      console.error('Error getting kitchen date override for specific date:', error);
      throw error;
    }
  }

  async updateKitchenDateOverride(id: number, updateData: {
    startTime?: string;
    endTime?: string;
    isAvailable?: boolean;
    reason?: string
  }): Promise<any> {
    try {
      const [updated] = await db
        .update(kitchenDateOverrides)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(kitchenDateOverrides.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating kitchen date override:', error);
      throw error;
    }
  }

  async deleteKitchenDateOverride(id: number): Promise<void> {
    try {
      await db
        .delete(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.id, id));
    } catch (error) {
      console.error('Error deleting kitchen date override:', error);
      throw error;
    }
  }

  // ===== KITCHEN BOOKINGS MANAGEMENT =====

  async createKitchenBooking(bookingData: { chefId: number; kitchenId: number; bookingDate: Date; startTime: string; endTime: string; specialNotes?: string }): Promise<any> {
    try {
      console.log('Inserting kitchen booking into database:', bookingData);

      // Calculate pricing using pricing service
      const { calculateKitchenBookingPrice, calculatePlatformFeeDynamic, calculateTotalWithFees } = await import('./services/pricing-service');
      const pricing = await calculateKitchenBookingPrice(
        bookingData.kitchenId,
        bookingData.startTime,
        bookingData.endTime,
        pool
      );

      // Calculate service fee dynamically from platform_settings
      const serviceFeeCents = await calculatePlatformFeeDynamic(pricing.totalPriceCents, pool);

      // Calculate total with fees
      const totalWithFeesCents = calculateTotalWithFees(
        pricing.totalPriceCents,
        serviceFeeCents,
        0 // No damage deposit for kitchen bookings alone
      );

      // Build the insert data, excluding optional fields if undefined
      const insertData: any = {
        chefId: bookingData.chefId,
        kitchenId: bookingData.kitchenId,
        bookingDate: bookingData.bookingDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        // Pricing fields (stored as strings for numeric type)
        totalPrice: totalWithFeesCents.toString(),
        hourlyRate: pricing.hourlyRateCents.toString(),
        durationHours: pricing.durationHours.toString(),
        serviceFee: serviceFeeCents.toString(),
        currency: pricing.currency,
        paymentStatus: 'pending',
        storageItems: [],
        equipmentItems: [],
      };

      // Only include specialNotes if provided
      if (bookingData.specialNotes !== undefined && bookingData.specialNotes !== null && bookingData.specialNotes !== '') {
        insertData.specialNotes = bookingData.specialNotes;
      }

      console.log('Insert data:', insertData);

      const [booking] = await db
        .insert(kitchenBookings)
        .values(insertData)
        .returning();

      console.log('Kitchen booking created successfully:', booking);
      return booking;
    } catch (error: any) {
      console.error('Error creating kitchen booking:', error);
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      throw error;
    }
  }

  // Create booking with support for external/third-party bookings
  async createBooking(bookingData: {
    kitchenId: number;
    bookingDate: Date;
    startTime: string;
    endTime: string;
    specialNotes?: string;
    bookingType?: 'chef' | 'external' | 'manager_blocked';
    createdBy?: number | null;
    chefId?: number | null;
    paymentIntentId?: string;
    paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
    externalContact?: {
      name: string;
      email: string;
      phone?: string | null;
      company?: string | null;
    };
  }): Promise<any> {
    try {
      console.log('Creating booking (with external support):', bookingData);

      // Calculate pricing using pricing service
      const { calculateKitchenBookingPrice, calculatePlatformFeeDynamic, calculateTotalWithFees } = await import('./services/pricing-service');
      const pricing = await calculateKitchenBookingPrice(
        bookingData.kitchenId,
        bookingData.startTime,
        bookingData.endTime,
        pool
      );

      // Calculate service fee dynamically from platform_settings
      const serviceFeeCents = await calculatePlatformFeeDynamic(pricing.totalPriceCents, pool);

      // Calculate total with fees
      const totalWithFeesCents = calculateTotalWithFees(
        pricing.totalPriceCents,
        serviceFeeCents,
        0 // No damage deposit for kitchen bookings alone
      );

      const insertData: any = {
        kitchenId: bookingData.kitchenId,
        bookingDate: bookingData.bookingDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        bookingType: bookingData.bookingType || 'chef',
        chefId: bookingData.chefId || bookingData.createdBy || null,
        createdBy: bookingData.createdBy || null,
        // Pricing fields (stored as strings for numeric type)
        totalPrice: totalWithFeesCents.toString(),
        hourlyRate: pricing.hourlyRateCents.toString(),
        durationHours: pricing.durationHours.toString(),
        serviceFee: serviceFeeCents.toString(),
        currency: pricing.currency,
        paymentStatus: bookingData.paymentStatus || 'pending',
        paymentIntentId: bookingData.paymentIntentId || null,
        storageItems: [],
        equipmentItems: [],
      };

      if (bookingData.specialNotes) {
        insertData.specialNotes = bookingData.specialNotes;
      }

      if (bookingData.externalContact) {
        insertData.externalContactName = bookingData.externalContact.name;
        insertData.externalContactEmail = bookingData.externalContact.email;
        insertData.externalContactPhone = bookingData.externalContact.phone || null;
        insertData.externalContactCompany = bookingData.externalContact.company || null;
      }

      // Get kitchen name for response
      const kitchen = await this.getKitchenById(bookingData.kitchenId);
      const kitchenName = kitchen?.name || 'Kitchen';

      const [booking] = await db
        .insert(kitchenBookings)
        .values(insertData)
        .returning();

      console.log('Booking created successfully:', booking);

      return {
        ...booking,
        kitchenName,
      };
    } catch (error: any) {
      console.error('Error creating booking:', error);
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
      console.log(`[STORAGE] getBookingsByChef called with chefId: ${chefId}`);
      console.log(`[STORAGE] Database connection check - pool exists: ${!!pool}, db exists: ${!!db}`);

      // Join with kitchens and locations to get cancellation policy
      const results = await db
        .select({
          booking: kitchenBookings,
          kitchen: kitchens,
          location: locations,
        })
        .from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchenBookings.chefId, chefId))
        .orderBy(asc(kitchenBookings.bookingDate));

      console.log(`[STORAGE] Raw query returned ${results.length} results`);

      const mappedResults = results.map(r => ({
        ...r.booking,
        kitchen: r.kitchen,
        location: {
          id: r.location.id,
          name: r.location.name,
          cancellationPolicyHours: r.location.cancellationPolicyHours,
          cancellationPolicyMessage: r.location.cancellationPolicyMessage,
        },
      }));

      console.log(`[STORAGE] Mapped ${mappedResults.length} bookings for chef ${chefId}`);
      return mappedResults;
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
      if (!pool) {
        return [];
      }

      // Get all locations for this manager (using raw SQL like chef profiles)
      const locationsResult = await pool.query(
        'SELECT id FROM locations WHERE manager_id = $1',
        [managerId]
      );

      const locationIds = locationsResult.rows.map(row => row.id);

      if (locationIds.length === 0) {
        return [];
      }

      // Get all kitchens for these locations
      const kitchensResult = await pool.query(
        'SELECT id FROM kitchens WHERE location_id = ANY($1::int[])',
        [locationIds]
      );

      const kitchenIds = kitchensResult.rows.map(row => row.id);

      if (kitchenIds.length === 0) {
        return [];
      }

      // Get all bookings for these kitchens (fetch bookings first, then enrich like chef profiles)
      // Include payment fields so managers can see payment statistics
      const bookingsResult = await pool.query(
        `SELECT 
          id, chef_id, kitchen_id, booking_date, start_time, end_time, 
          status, special_notes, created_at, updated_at,
          total_price, payment_status, payment_intent_id, service_fee, currency
        FROM kitchen_bookings 
        WHERE kitchen_id = ANY($1::int[])
        ORDER BY booking_date DESC, start_time ASC`,
        [kitchenIds]
      );

      // Enrich each booking with chef, kitchen, and location details (exactly like chef profiles)
      const enrichedBookings = await Promise.all(
        bookingsResult.rows.map(async (booking) => {
          // Get chef details
          let chefName = null;
          if (booking.chef_id) {
            try {
              const chefResult = await pool.query(
                'SELECT id, username FROM users WHERE id = $1',
                [booking.chef_id]
              );
              const chef = chefResult.rows[0];

              if (chef) {
                chefName = chef.username;

                // Try to get chef's full name from their application
                const appResult = await pool.query(
                  'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                  [booking.chef_id]
                );
                if (appResult.rows.length > 0 && appResult.rows[0].full_name) {
                  chefName = appResult.rows[0].full_name;
                }
              }
            } catch (error) {
              // Silently handle errors
            }
          }

          // Get kitchen details
          let kitchenName = 'Kitchen';
          let locationId = null;
          if (booking.kitchen_id) {
            try {
              const kitchenResult = await pool.query(
                'SELECT id, name, location_id FROM kitchens WHERE id = $1',
                [booking.kitchen_id]
              );
              const kitchen = kitchenResult.rows[0];
              if (kitchen) {
                kitchenName = kitchen.name || 'Kitchen';
                locationId = kitchen.location_id;
              }
            } catch (error) {
              // Silently handle errors
            }
          }

          // Get location details including timezone
          let locationName = null;
          let locationTimezone = DEFAULT_TIMEZONE;
          if (locationId) {
            try {
              const locationResult = await pool.query(
                'SELECT id, name, timezone FROM locations WHERE id = $1',
                [locationId]
              );
              const location = locationResult.rows[0];
              if (location) {
                locationName = location.name;
                locationTimezone = location.timezone || DEFAULT_TIMEZONE;
              }
            } catch (error) {
              // Silently handle errors
            }
          }

          return {
            id: booking.id,
            chefId: booking.chef_id,
            kitchenId: booking.kitchen_id,
            bookingDate: booking.booking_date,
            startTime: booking.start_time,
            endTime: booking.end_time,
            status: booking.status,
            specialNotes: booking.special_notes,
            createdAt: booking.created_at,
            updatedAt: booking.updated_at,
            chefName: chefName,
            kitchenName: kitchenName,
            locationName: locationName,
            locationTimezone: locationTimezone,
            // Include payment fields for revenue dashboard
            totalPrice: booking.total_price ? parseInt(String(booking.total_price)) || 0 : null,
            paymentStatus: booking.payment_status || null,
            paymentIntentId: booking.payment_intent_id || null,
            serviceFee: booking.service_fee ? parseInt(String(booking.service_fee)) || 0 : null,
            currency: booking.currency || 'CAD',
          };
        })
      );

      return enrichedBookings;
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

  async getBookingById(id: number): Promise<any> {
    try {
      const [booking] = await db
        .select()
        .from(kitchenBookings)
        .where(eq(kitchenBookings.id, id));
      return booking;
    } catch (error) {
      console.error('Error getting booking by ID:', error);
      throw error;
    }
  }

  async deleteKitchenBooking(id: number): Promise<void> {
    try {
      await db
        .delete(kitchenBookings)
        .where(eq(kitchenBookings.id, id));
      console.log(`✅ Deleted booking ${id}`);
    } catch (error) {
      console.error('Error deleting kitchen booking:', error);
      throw error;
    }
  }

  // New method: Get ALL time slots with booking info (for chef view)
  async getAllTimeSlotsWithBookingInfo(kitchenId: number, date: Date): Promise<Array<{
    time: string;
    available: number;
    capacity: number;
    isFullyBooked: boolean;
  }>> {
    try {
      console.log(`🕐 Getting all slots with booking info for kitchen ${kitchenId}, date: ${date.toISOString()}`);

      // First check if there's a date-specific override
      const dateOverride = await this.getKitchenDateOverrideForDate(kitchenId, date);

      let startHour: number;
      let endHour: number;
      let capacity: number;

      if (dateOverride) {
        // If there's an override and it's closed, return empty array
        if (!dateOverride.isAvailable) {
          console.log(`❌ Kitchen closed on this date (override)`);
          return [];
        }
        // If override is available with custom hours, use those
        if (dateOverride.startTime && dateOverride.endTime) {
          startHour = parseInt(dateOverride.startTime.split(':')[0]);
          endHour = parseInt(dateOverride.endTime.split(':')[0]);
          capacity = (dateOverride as any).maxConcurrentBookings ?? (dateOverride as any).max_concurrent_bookings ?? 1;
          console.log(`✅ Using override hours: ${startHour}:00 - ${endHour}:00, capacity: ${capacity}`);
        } else {
          console.log(`⚠️ Override says available but no times specified`);
          return [];
        }
      } else {
        // No override, use regular weekly schedule
        const dayOfWeek = date.getDay();
        const availability = await this.getKitchenAvailability(kitchenId);

        const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);

        if (!dayAvailability || !dayAvailability.isAvailable) {
          console.log(`❌ Kitchen not available on day ${dayOfWeek} (weekly schedule)`);
          return [];
        }

        startHour = parseInt(dayAvailability.startTime.split(':')[0]);
        endHour = parseInt(dayAvailability.endTime.split(':')[0]);
        capacity = (dayAvailability as any).maxConcurrentBookings ?? (dayAvailability as any).max_concurrent_bookings ?? 1;
        console.log(`✅ Using weekly schedule hours: ${startHour}:00 - ${endHour}:00, capacity: ${capacity}`);
      }

      // Generate 1-hour slots (consistent with api/index.js for Vercel deployment)
      // Each slot represents a 1-hour booking block
      const allSlots: string[] = [];
      for (let hour = startHour; hour < endHour; hour++) {
        allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      }

      // Count bookings per slot
      const bookings = await this.getBookingsByKitchen(kitchenId);
      const dateStr = date.toISOString().split('T')[0];

      const dayBookings = bookings.filter(b => {
        const bookingDateStr = new Date(b.bookingDate).toISOString().split('T')[0];
        return bookingDateStr === dateStr && b.status !== 'cancelled';
      });

      // Count how many bookings overlap each slot
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

      // Build result with availability info
      const result = allSlots.map(slot => {
        const bookedCount = slotBookingCounts.get(slot) || 0;
        return {
          time: slot,
          available: Math.max(0, capacity - bookedCount),
          capacity,
          isFullyBooked: bookedCount >= capacity
        };
      });

      console.log(`📅 Generated ${result.length} total slots`);
      return result;
    } catch (error) {
      console.error('Error getting all time slots with booking info:', error);
      throw error;
    }
  }

  async getAvailableTimeSlots(kitchenId: number, date: Date): Promise<string[]> {
    try {
      console.log(`🕐 Getting slots for kitchen ${kitchenId}, date: ${date.toISOString()}`);

      // First check if there's a date-specific override
      const dateOverride = await this.getKitchenDateOverrideForDate(kitchenId, date);

      console.log(`📅 Date override found:`, dateOverride ? 'YES' : 'NO');
      if (dateOverride) {
        console.log(`   Override details:`, {
          isAvailable: dateOverride.isAvailable,
          startTime: dateOverride.startTime,
          endTime: dateOverride.endTime,
          reason: dateOverride.reason
        });
      }

      let startHour: number;
      let endHour: number;

      if (dateOverride) {
        // If there's an override and it's closed, return empty slots
        if (!dateOverride.isAvailable) {
          console.log(`❌ Kitchen closed on this date (override)`);
          return [];
        }
        // If override is available with custom hours, use those
        if (dateOverride.startTime && dateOverride.endTime) {
          startHour = parseInt(dateOverride.startTime.split(':')[0]);
          endHour = parseInt(dateOverride.endTime.split(':')[0]);
          console.log(`✅ Using override hours: ${startHour}:00 - ${endHour}:00`);
        } else {
          // Override says available but no times specified - shouldn't happen, return empty
          console.log(`⚠️ Override says available but no times specified`);
          return [];
        }
      } else {
        // No override, use regular weekly schedule
        const dayOfWeek = date.getDay();
        const availability = await this.getKitchenAvailability(kitchenId);

        console.log(`📆 No override, checking weekly schedule for day ${dayOfWeek}`);

        const dayAvailability = availability.find(a => a.dayOfWeek === dayOfWeek);

        if (!dayAvailability || !dayAvailability.isAvailable) {
          console.log(`❌ Kitchen not available on day ${dayOfWeek} (weekly schedule)`);
          return [];
        }

        startHour = parseInt(dayAvailability.startTime.split(':')[0]);
        endHour = parseInt(dayAvailability.endTime.split(':')[0]);
        console.log(`✅ Using weekly schedule hours: ${startHour}:00 - ${endHour}:00`);
      }

      // Generate 1-hour slots (consistent with api/index.js for Vercel deployment)
      // Each slot represents a 1-hour booking block
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

      // More granular time conflict checking
      const bookedSlots = new Set<string>();
      dayBookings.forEach(booking => {
        // Convert start and end times to minutes for accurate comparison
        const [startHours, startMins] = booking.startTime.split(':').map(Number);
        const [endHours, endMins] = booking.endTime.split(':').map(Number);
        const startTotalMins = startHours * 60 + startMins;
        const endTotalMins = endHours * 60 + endMins;

        // Mark all 30-min slots that conflict with this booking
        for (const slot of slots) {
          const [slotHours, slotMins] = slot.split(':').map(Number);
          const slotTotalMins = slotHours * 60 + slotMins;

          // A slot is unavailable if it starts before the booking ends and the next 30min would overlap
          if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
            bookedSlots.add(slot);
          }
        }
      });

      console.log(`📅 Generated ${slots.length} total slots, ${bookedSlots.size} booked, returning ${slots.length - bookedSlots.size} available`);

      return slots.filter(slot => !bookedSlots.has(slot));
    } catch (error) {
      console.error('Error getting available time slots:', error);
      throw error;
    }
  }

  // Get available slots in format expected by public API
  async getAvailableSlots(kitchenId: number, dateStr: string): Promise<{ time: string; available: boolean }[]> {
    try {
      const date = new Date(dateStr);
      const slots = await this.getAvailableTimeSlots(kitchenId, date);
      return slots.map(time => ({ time, available: true }));
    } catch (error) {
      console.error('Error getting available slots:', error);
      return [];
    }
  }

  // Get location manager
  async getLocationManager(locationId: number): Promise<any | undefined> {
    try {
      const location = await this.getLocationById(locationId);
      if (!location || !location.managerId) return undefined;
      return await this.getUser(location.managerId);
    } catch (error) {
      console.error('Error getting location manager:', error);
      return undefined;
    }
  }

  // Validate that booking time is within manager-set availability
  async validateBookingAvailability(kitchenId: number, bookingDate: Date, startTime: string, endTime: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check if start time is before end time
      if (startTime >= endTime) {
        return { valid: false, error: "End time must be after start time" };
      }

      // First check if there's a date-specific override
      const dateOverride = await this.getKitchenDateOverrideForDate(kitchenId, bookingDate);

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
        const dayOfWeek = bookingDate.getDay();
        const availability = await this.getKitchenAvailability(kitchenId);

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
      console.error('Error validating booking availability:', error);
      return { valid: false, error: "Error validating booking availability" };
    }
  }

  async checkBookingConflict(kitchenId: number, bookingDate: Date, startTime: string, endTime: string): Promise<boolean> {
    try {
      // Check for any overlapping bookings (both pending and confirmed, but not cancelled)
      const bookings = await db
        .select()
        .from(kitchenBookings)
        .where(and(
          eq(kitchenBookings.kitchenId, kitchenId),
          or(
            eq(kitchenBookings.status, 'confirmed'),
            eq(kitchenBookings.status, 'pending')
          )
        ));

      // Extract date string for comparison (YYYY-MM-DD format)
      const targetDateStr = bookingDate.toISOString().split('T')[0];

      for (const booking of bookings) {
        const bookingDateTime = new Date(booking.bookingDate);
        const bookingDateStr = bookingDateTime.toISOString().split('T')[0];

        // Check if same date
        if (bookingDateStr === targetDateStr) {
          // Check for time overlap: two time ranges overlap if:
          // startTime < booking.endTime AND endTime > booking.startTime
          if (startTime < booking.endTime && endTime > booking.startTime) {
            return true; // Conflict found
          }
        }
      }

      return false; // No conflict
    } catch (error) {
      console.error('Error checking booking conflict:', error);
      return true; // Return true on error to prevent double booking
    }
  }

  // ===== CHEF KITCHEN ACCESS MANAGEMENT (Admin grants access) =====

  // ===== CHEF LOCATION ACCESS MANAGEMENT (Admin grants access to locations) =====
  // When a chef has access to a location, they can book any kitchen within that location

  async grantChefLocationAccess(chefId: number, locationId: number, grantedBy: number): Promise<any> {
    try {
      const [access] = await db
        .insert(chefLocationAccess)
        .values({
          chefId,
          locationId,
          grantedBy,
        })
        .onConflictDoNothing()
        .returning();

      return access;
    } catch (error) {
      console.error('Error granting chef location access:', error);
      throw error;
    }
  }

  async revokeChefLocationAccess(chefId: number, locationId: number): Promise<void> {
    try {
      await db
        .delete(chefLocationAccess)
        .where(
          and(
            eq(chefLocationAccess.chefId, chefId),
            eq(chefLocationAccess.locationId, locationId)
          )
        );
    } catch (error) {
      console.error('Error revoking chef location access:', error);
      throw error;
    }
  }

  async getChefLocationAccess(chefId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(chefLocationAccess)
        .where(eq(chefLocationAccess.chefId, chefId));
    } catch (error) {
      console.error('Error getting chef location access:', error);
      throw error;
    }
  }

  // Helper: Check if chef has access to a location (used for booking validation)
  async chefHasLocationAccess(chefId: number, locationId: number): Promise<boolean> {
    try {
      const access = await db
        .select()
        .from(chefLocationAccess)
        .where(
          and(
            eq(chefLocationAccess.chefId, chefId),
            eq(chefLocationAccess.locationId, locationId)
          )
        )
        .limit(1);

      return access.length > 0;
    } catch (error) {
      console.error('Error checking chef location access:', error);
      return false;
    }
  }

  // Helper: Get location ID for a kitchen
  async getKitchenLocation(kitchenId: number): Promise<number | null> {
    try {
      const [kitchen] = await db
        .select({ locationId: kitchens.locationId })
        .from(kitchens)
        .where(eq(kitchens.id, kitchenId))
        .limit(1);

      return kitchen?.locationId ?? null;
    } catch (error) {
      console.error('Error getting kitchen location:', error);
      return null;
    }
  }

  // Legacy methods - kept for backward compatibility
  async grantChefKitchenAccess(chefId: number, kitchenId: number, grantedBy: number): Promise<any> {
    try {
      const [access] = await db
        .insert(chefKitchenAccess)
        .values({
          chefId,
          kitchenId,
          grantedBy,
        })
        .onConflictDoNothing()
        .returning();

      return access;
    } catch (error) {
      console.error('Error granting chef kitchen access:', error);
      throw error;
    }
  }

  async revokeChefKitchenAccess(chefId: number, kitchenId: number): Promise<void> {
    try {
      await db
        .delete(chefKitchenAccess)
        .where(
          and(
            eq(chefKitchenAccess.chefId, chefId),
            eq(chefKitchenAccess.kitchenId, kitchenId)
          )
        );
    } catch (error) {
      console.error('Error revoking chef kitchen access:', error);
      throw error;
    }
  }

  async getChefKitchenAccess(chefId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(chefKitchenAccess)
        .where(eq(chefKitchenAccess.chefId, chefId));
    } catch (error) {
      console.error('Error getting chef kitchen access:', error);
      throw error;
    }
  }

  // ===== CHEF KITCHEN PROFILE MANAGEMENT (Chef shares, Manager approves) =====

  async shareChefProfileWithKitchen(chefId: number, kitchenId: number): Promise<any> {
    try {
      // Check if profile already shared
      const existing = await db
        .select()
        .from(chefKitchenProfiles)
        .where(
          and(
            eq(chefKitchenProfiles.chefId, chefId),
            eq(chefKitchenProfiles.kitchenId, kitchenId)
          )
        );

      if (existing.length > 0) {
        // Update status back to pending if it was rejected
        if (existing[0].status === 'rejected') {
          const [updated] = await db
            .update(chefKitchenProfiles)
            .set({
              status: 'pending',
              sharedAt: new Date(),
              reviewedBy: null,
              reviewedAt: null,
              reviewFeedback: null,
            })
            .where(eq(chefKitchenProfiles.id, existing[0].id))
            .returning();
          return updated;
        }
        return existing[0]; // Already shared
      }

      // Create new profile sharing
      const [profile] = await db
        .insert(chefKitchenProfiles)
        .values({
          chefId,
          kitchenId,
          status: 'pending',
        })
        .returning();

      return profile;
    } catch (error) {
      console.error('Error sharing chef profile with kitchen:', error);
      throw error;
    }
  }

  async updateChefKitchenProfileStatus(
    profileId: number,
    status: 'approved' | 'rejected',
    reviewedBy: number,
    reviewFeedback?: string
  ): Promise<any> {
    try {
      const [updated] = await db
        .update(chefKitchenProfiles)
        .set({
          status,
          reviewedBy,
          reviewedAt: new Date(),
          reviewFeedback: reviewFeedback || null,
        })
        .where(eq(chefKitchenProfiles.id, profileId))
        .returning();

      return updated;
    } catch (error) {
      console.error('Error updating chef kitchen profile status:', error);
      throw error;
    }
  }

  async getChefKitchenProfile(chefId: number, kitchenId: number): Promise<any | undefined> {
    try {
      const [profile] = await db
        .select()
        .from(chefKitchenProfiles)
        .where(
          and(
            eq(chefKitchenProfiles.chefId, chefId),
            eq(chefKitchenProfiles.kitchenId, kitchenId)
          )
        );

      return profile || undefined;
    } catch (error) {
      console.error('Error getting chef kitchen profile:', error);
      throw error;
    }
  }

  async getChefProfilesForManager(managerId: number): Promise<any[]> {
    try {
      // Get all locations managed by this manager
      const managerLocations = await db
        .select()
        .from(locations)
        .where(eq(locations.managerId, managerId));

      if (managerLocations.length === 0) {
        return [];
      }

      const locationIds = managerLocations.map(loc => (loc as any).id);

      // Get all chef profiles for these locations (NEW - location-based)
      const profiles = await db
        .select()
        .from(chefLocationProfiles)
        .where(inArray(chefLocationProfiles.locationId, locationIds));

      // Enrich with chef, location, and application details
      const enrichedProfiles = await Promise.all(
        profiles.map(async (profile) => {
          const chef = await this.getUser(profile.chefId);
          const location = await db
            .select()
            .from(locations)
            .where(eq(locations.id, profile.locationId))
            .then(rows => rows[0]);

          // Get chef's latest approved application
          const chefApplications = await db
            .select()
            .from(applications)
            .where(
              and(
                eq(applications.userId, profile.chefId),
                eq(applications.status, 'approved')
              )
            )
            .orderBy(asc(applications.createdAt));

          const latestApp = chefApplications.length > 0 ? chefApplications[chefApplications.length - 1] : null;

          return {
            ...profile,
            chef: chef ? {
              id: chef.id,
              username: chef.username,
            } : null,
            location: location ? {
              id: (location as any).id,
              name: (location as any).name,
              address: (location as any).address,
            } : null,
            application: latestApp ? {
              id: (latestApp as any).id,
              fullName: (latestApp as any).fullName,
              email: (latestApp as any).email,
              phone: (latestApp as any).phone,
              foodSafetyLicenseUrl: (latestApp as any).foodSafetyLicenseUrl,
              foodEstablishmentCertUrl: (latestApp as any).foodEstablishmentCertUrl,
            } : null,
          };
        })
      );

      return enrichedProfiles;
    } catch (error) {
      console.error('Error getting chef profiles for manager:', error);
      throw error;
    }
  }

  // ===== CHEF LOCATION PROFILE MANAGEMENT (NEW - Location-based profile sharing) =====

  async shareChefProfileWithLocation(chefId: number, locationId: number): Promise<any> {
    try {
      // Check if profile already shared
      const existing = await db
        .select()
        .from(chefLocationProfiles)
        .where(
          and(
            eq(chefLocationProfiles.chefId, chefId),
            eq(chefLocationProfiles.locationId, locationId)
          )
        );

      if (existing.length > 0) {
        // Update status back to pending if it was rejected
        if (existing[0].status === 'rejected') {
          const [updated] = await db
            .update(chefLocationProfiles)
            .set({
              status: 'pending',
              sharedAt: new Date(),
              reviewedBy: null,
              reviewedAt: null,
              reviewFeedback: null,
            })
            .where(eq(chefLocationProfiles.id, existing[0].id))
            .returning();
          return updated;
        }
        return existing[0]; // Already shared
      }

      // Create new profile sharing
      const [profile] = await db
        .insert(chefLocationProfiles)
        .values({
          chefId,
          locationId,
          status: 'pending',
        })
        .returning();

      return profile;
    } catch (error) {
      console.error('Error sharing chef profile with location:', error);
      throw error;
    }
  }

  async getChefLocationProfile(chefId: number, locationId: number): Promise<any | undefined> {
    try {
      const [profile] = await db
        .select()
        .from(chefLocationProfiles)
        .where(
          and(
            eq(chefLocationProfiles.chefId, chefId),
            eq(chefLocationProfiles.locationId, locationId)
          )
        );

      return profile || undefined;
    } catch (error) {
      console.error('Error getting chef location profile:', error);
      throw error;
    }
  }

  async getChefLocationProfiles(chefId: number): Promise<any[]> {
    try {
      const profiles = await db
        .select()
        .from(chefLocationProfiles)
        .where(eq(chefLocationProfiles.chefId, chefId));

      return profiles;
    } catch (error) {
      console.error('Error getting chef location profiles:', error);
      throw error;
    }
  }

  async updateChefLocationProfileStatus(
    profileId: number,
    status: 'approved' | 'rejected',
    reviewedBy: number,
    reviewFeedback?: string
  ): Promise<any> {
    try {
      const [updated] = await db
        .update(chefLocationProfiles)
        .set({
          status,
          reviewedBy,
          reviewedAt: new Date(),
          reviewFeedback: reviewFeedback || null,
        })
        .where(eq(chefLocationProfiles.id, profileId))
        .returning();

      return updated;
    } catch (error) {
      console.error('Error updating chef location profile status:', error);
      throw error;
    }
  }

  // ===== CHEF KITCHEN APPLICATIONS (NEW - Direct Kitchen Applications) =====
  // This replaces the "Share Profile" workflow with full application per kitchen

  /**
   * Submit a new kitchen application or update an existing rejected one
   * Allows re-application after rejection with updated documents
   */
  async createChefKitchenApplication(data: InsertChefKitchenApplication): Promise<ChefKitchenApplication> {
    try {
      // Check if an application already exists for this chef + location
      const existing = await db
        .select()
        .from(chefKitchenApplications)
        .where(
          and(
            eq(chefKitchenApplications.chefId, data.chefId),
            eq(chefKitchenApplications.locationId, data.locationId)
          )
        )
        .limit(1);

      const now = new Date();

      if (existing.length > 0) {
        // If previously rejected or cancelled, allow re-application with new data
        if (existing[0].status === 'rejected' || existing[0].status === 'cancelled') {
          const updateData: any = {
            ...data,
            // Ensure customFieldsData defaults to empty object if not provided
            customFieldsData: data.customFieldsData ?? {},
            status: 'inReview', // Reset to pending review
            feedback: null, // Clear previous feedback
            reviewedBy: null,
            reviewedAt: null,
            updatedAt: now,
          };

          // Add tier fields if provided
          if ((data as any).current_tier !== undefined) {
            updateData.current_tier = (data as any).current_tier;
          }
          if ((data as any).tier_data !== undefined) {
            updateData.tier_data = (data as any).tier_data;
          }
          if ((data as any).government_license_number !== undefined) {
            updateData.government_license_number = (data as any).government_license_number;
          }
          if ((data as any).government_license_received_date !== undefined) {
            updateData.government_license_received_date = (data as any).government_license_received_date;
          }
          if ((data as any).government_license_expiry_date !== undefined) {
            updateData.government_license_expiry_date = (data as any).government_license_expiry_date;
          }

          const [updated] = await db
            .update(chefKitchenApplications)
            .set(updateData)
            .where(eq(chefKitchenApplications.id, existing[0].id))
            .returning();
          return updated;
        }

        // If approved and chef is submitting Tier 2+ documents, update the application
        if (existing[0].status === 'approved' && (data as any).current_tier && (data as any).current_tier >= 2) {
          const updateData: any = {
            updatedAt: now,
          };

          // Update custom fields data if provided
          if (data.customFieldsData && Object.keys(data.customFieldsData).length > 0) {
            updateData.customFieldsData = {
              ...(existing[0].customFieldsData || {}),
              ...data.customFieldsData,
            };
          }

          // Update tier data if provided
          if ((data as any).tier_data) {
            updateData.tier_data = {
              ...(existing[0].tier_data || {}),
              ...(data as any).tier_data,
            };
          }

          // Update food establishment cert fields if provided
          if ((data as any).foodEstablishmentCertUrl) {
            updateData.foodEstablishmentCertUrl = (data as any).foodEstablishmentCertUrl;
          }
          if ((data as any).foodEstablishmentCertExpiry) {
            updateData.foodEstablishmentCertExpiry = (data as any).foodEstablishmentCertExpiry;
          }

          // Mark tier2 as submitted when chef submits Tier 2 documents
          if ((data as any).current_tier === 2 && !existing[0].tier2_completed_at) {
            updateData.tier2_completed_at = now;
            console.log(`✅ Marking Tier 2 as submitted for application ${existing[0].id}`);
          }

          const [updated] = await db
            .update(chefKitchenApplications)
            .set(updateData)
            .where(eq(chefKitchenApplications.id, existing[0].id))
            .returning();
          return updated;
        }

        // If pending or approved (not updating tiers), return existing application
        return existing[0];
      }

      // Create new application
      const insertData: any = {
        ...data,
        // Ensure customFieldsData defaults to empty object if not provided
        customFieldsData: data.customFieldsData ?? {},
        status: 'inReview',
        createdAt: now,
        updatedAt: now,
      };

      // Add tier fields if provided
      if ((data as any).current_tier !== undefined) {
        insertData.current_tier = (data as any).current_tier;
      }
      if ((data as any).tier_data !== undefined) {
        insertData.tier_data = (data as any).tier_data;
      }
      if ((data as any).government_license_number !== undefined) {
        insertData.government_license_number = (data as any).government_license_number;
      }
      if ((data as any).government_license_received_date !== undefined) {
        insertData.government_license_received_date = (data as any).government_license_received_date;
      }
      if ((data as any).government_license_expiry_date !== undefined) {
        insertData.government_license_expiry_date = (data as any).government_license_expiry_date;
      }

      const [application] = await db
        .insert(chefKitchenApplications)
        .values(insertData)
        .returning();

      return application;
    } catch (error) {
      console.error('Error creating chef kitchen application:', error);
      throw error;
    }
  }

  /**
   * Get a specific kitchen application by ID
   */
  async getChefKitchenApplicationById(applicationId: number): Promise<ChefKitchenApplication | undefined> {
    try {
      const [application] = await db
        .select()
        .from(chefKitchenApplications)
        .where(eq(chefKitchenApplications.id, applicationId))
        .limit(1);

      return application || undefined;
    } catch (error) {
      console.error('Error getting chef kitchen application by id:', error);
      throw error;
    }
  }

  /**
   * Get a chef's application for a specific location
   */
  async getChefKitchenApplication(chefId: number, locationId: number): Promise<ChefKitchenApplication | undefined> {
    try {
      const [application] = await db
        .select()
        .from(chefKitchenApplications)
        .where(
          and(
            eq(chefKitchenApplications.chefId, chefId),
            eq(chefKitchenApplications.locationId, locationId)
          )
        )
        .limit(1);

      return application || undefined;
    } catch (error) {
      console.error('Error getting chef kitchen application:', error);
      throw error;
    }
  }

  /**
   * Get all kitchen applications for a chef
   */
  async getChefKitchenApplicationsByChefId(chefId: number): Promise<ChefKitchenApplication[]> {
    try {
      console.log(`[STORAGE] getChefKitchenApplicationsByChefId called with chefId: ${chefId}`);
      console.log(`[STORAGE] Database connection check - pool exists: ${!!pool}, db exists: ${!!db}`);

      const applications = await db
        .select()
        .from(chefKitchenApplications)
        .where(eq(chefKitchenApplications.chefId, chefId))
        .orderBy(desc(chefKitchenApplications.createdAt));

      console.log(`[STORAGE] Found ${applications.length} kitchen applications for chef ${chefId}`);
      if (applications.length > 0) {
        console.log(`[STORAGE] First kitchen application sample:`, {
          id: applications[0].id,
          chefId: applications[0].chefId,
          locationId: applications[0].locationId,
          status: applications[0].status
        });
      }

      return applications;
    } catch (error) {
      console.error('Error getting chef kitchen applications:', error);
      throw error;
    }
  }

  /**
   * Get all applications for a location with enriched chef details
   * Used by managers to review applications
   */
  async getChefKitchenApplicationsByLocationId(locationId: number): Promise<any[]> {
    try {
      const apps = await db
        .select()
        .from(chefKitchenApplications)
        .where(eq(chefKitchenApplications.locationId, locationId))
        .orderBy(desc(chefKitchenApplications.createdAt));

      // Enrich with chef details
      const enrichedApplications = await Promise.all(
        apps.map(async (app) => {
          const chef = await this.getUser(app.chefId);
          const location = await this.getLocationById(app.locationId);

          return {
            ...app,
            chef: chef ? {
              id: chef.id,
              username: chef.username,
              role: chef.role,
            } : null,
            location: location ? {
              id: (location as any).id,
              name: (location as any).name,
              address: (location as any).address,
            } : null,
          };
        })
      );

      return enrichedApplications;
    } catch (error) {
      console.error('Error getting applications for location:', error);
      throw error;
    }
  }

  /**
   * Get all applications for locations managed by a specific manager
   * Returns applications enriched with chef and location details
   */
  async getChefKitchenApplicationsForManager(managerId: number): Promise<any[]> {
    try {
      // First get all locations this manager manages
      const managedLocations = await db
        .select()
        .from(locations)
        .where(eq((locations as any).managerId, managerId));

      if (managedLocations.length === 0) {
        return [];
      }

      const locationIds = managedLocations.map(loc => (loc as any).id);

      // Get all applications for these locations
      const apps = await db
        .select()
        .from(chefKitchenApplications)
        .where(inArray(chefKitchenApplications.locationId, locationIds))
        .orderBy(desc(chefKitchenApplications.createdAt));

      // Enrich with chef and location details
      const enrichedApplications = await Promise.all(
        apps.map(async (app) => {
          const chef = await this.getUser(app.chefId);
          const location = managedLocations.find(l => (l as any).id === app.locationId);

          return {
            ...app,
            chef: chef ? {
              id: chef.id,
              username: chef.username,
              role: chef.role,
            } : null,
            location: location ? {
              id: (location as any).id,
              name: (location as any).name,
              address: (location as any).address,
            } : null,
          };
        })
      );

      return enrichedApplications;
    } catch (error) {
      console.error('Error getting chef kitchen applications for manager:', error);
      throw error;
    }
  }

  /**
   * Update application status (approve/reject) by manager
   * Handles tier transitions automatically
   */
  async updateChefKitchenApplicationStatus(
    update: UpdateChefKitchenApplicationStatus,
    reviewedBy: number
  ): Promise<ChefKitchenApplication | undefined> {
    try {
      // Get current application to check tier
      const [current] = await db
        .select()
        .from(chefKitchenApplications)
        .where(eq(chefKitchenApplications.id, update.id))
        .limit(1);

      if (!current) {
        throw new Error('Application not found');
      }

      const now = new Date();
      const setData: any = {
        status: update.status,
        feedback: update.feedback || null,
        reviewedBy,
        reviewedAt: now,
        updatedAt: now,
      };

      // Handle tier transitions
      if (update.status === 'approved') {
        const currentTier = update.current_tier ?? current.current_tier ?? 1;

        // If approving Tier 1, mark it as complete and advance to Tier 2
        if (currentTier === 1 && !current.tier1_completed_at) {
          setData.tier1_completed_at = now;
          setData.current_tier = 2;
        }
        // If approving Tier 2, mark it as complete and advance to Tier 3
        else if (currentTier === 2 && !current.tier2_completed_at) {
          setData.tier2_completed_at = now;
          setData.current_tier = 3;
        }
        // If approving Tier 4 (license entered), mark it as complete
        else if (currentTier === 4 && !current.tier4_completed_at) {
          setData.tier4_completed_at = now;
        }
      }

      // Update tier if explicitly provided
      if (update.current_tier !== undefined) {
        setData.current_tier = update.current_tier;
      }

      // Update tier_data if provided
      if (update.tier_data !== undefined) {
        setData.tier_data = update.tier_data;
      }

      const [updated] = await db
        .update(chefKitchenApplications)
        .set(setData)
        .where(eq(chefKitchenApplications.id, update.id))
        .returning();

      return updated || undefined;
    } catch (error) {
      console.error('Error updating chef kitchen application status:', error);
      throw error;
    }
  }

  /**
   * Update application tier (for tier progression)
   */
  async updateApplicationTier(
    applicationId: number,
    newTier: number,
    tierData?: Record<string, any>
  ): Promise<ChefKitchenApplication | undefined> {
    try {
      // Get current application first
      const current = await this.getChefKitchenApplicationById(applicationId);
      if (!current) {
        throw new Error('Application not found');
      }

      const now = new Date();
      const setData: any = {
        current_tier: newTier,
        updatedAt: now,
      };

      // Set tier completion timestamps
      if (newTier >= 2 && !current.tier1_completed_at) {
        setData.tier1_completed_at = now;
      }
      if (newTier >= 3 && !current.tier2_completed_at) {
        setData.tier2_completed_at = now;
      }
      if (newTier === 3 && !current.tier3_submitted_at) {
        setData.tier3_submitted_at = now;
      }
      if (newTier >= 4 && !current.tier4_completed_at) {
        setData.tier4_completed_at = now;
      }

      // Update tier_data if provided
      if (tierData !== undefined) {
        setData.tier_data = tierData;
      }

      const [updated] = await db
        .update(chefKitchenApplications)
        .set(setData)
        .where(eq(chefKitchenApplications.id, applicationId))
        .returning();

      return updated || undefined;
    } catch (error) {
      console.error('Error updating application tier:', error);
      throw error;
    }
  }

  /**
   * Update application documents (by chef re-uploading)
   */
  async updateChefKitchenApplicationDocuments(
    update: UpdateChefKitchenApplicationDocuments
  ): Promise<ChefKitchenApplication | undefined> {
    try {
      const setData: any = { updatedAt: new Date() };

      if (update.foodSafetyLicenseUrl !== undefined) {
        setData.foodSafetyLicenseUrl = update.foodSafetyLicenseUrl;
        setData.foodSafetyLicenseStatus = 'pending'; // Reset to pending on new upload
      }

      if (update.foodEstablishmentCertUrl !== undefined) {
        setData.foodEstablishmentCertUrl = update.foodEstablishmentCertUrl;
        setData.foodEstablishmentCertStatus = 'pending'; // Reset to pending on new upload
      }

      if (update.foodSafetyLicenseStatus !== undefined) {
        setData.foodSafetyLicenseStatus = update.foodSafetyLicenseStatus;
      }

      if (update.foodEstablishmentCertStatus !== undefined) {
        setData.foodEstablishmentCertStatus = update.foodEstablishmentCertStatus;
      }

      const [updated] = await db
        .update(chefKitchenApplications)
        .set(setData)
        .where(eq(chefKitchenApplications.id, update.id))
        .returning();

      return updated || undefined;
    } catch (error) {
      console.error('Error updating chef kitchen application documents:', error);
      throw error;
    }
  }

  /**
   * Check if chef has an approved application for a specific location
   * This is used for booking validation
   */
  async chefHasApprovedKitchenApplication(chefId: number, locationId: number): Promise<boolean> {
    try {
      const [application] = await db
        .select()
        .from(chefKitchenApplications)
        .where(
          and(
            eq(chefKitchenApplications.chefId, chefId),
            eq(chefKitchenApplications.locationId, locationId),
            eq(chefKitchenApplications.status, 'approved')
          )
        )
        .limit(1);

      return !!application;
    } catch (error) {
      console.error('Error checking chef kitchen application approval:', error);
      return false;
    }
  }

  /**
   * Get kitchen application status for booking check
   * Returns detailed status for better error messages
   */
  async getChefKitchenApplicationStatus(chefId: number, locationId: number): Promise<{
    hasApplication: boolean;
    status: string | null;
    canBook: boolean;
    message: string;
  }> {
    try {
      const application = await this.getChefKitchenApplication(chefId, locationId);

      if (!application) {
        return {
          hasApplication: false,
          status: null,
          canBook: false,
          message: 'You must apply to this kitchen before booking. Please submit an application first.',
        };
      }

      // Check if Tier 2 is completed (only Tier 1 and Tier 2 are in use)
      const tier2Completed = !!application.tier2_completed_at;

      switch (application.status) {
        case 'approved':
          return {
            hasApplication: true,
            status: tier2Completed ? 'approved' : 'inReview',
            canBook: tier2Completed, // Can book after completing Tier 2 (only Tier 1 and 2 are in use)
            message: tier2Completed
              ? 'Application completed. You can book kitchens at this location.'
              : 'Application approved but Tier 2 is not completed. Please complete Tier 2 to book.',
          };
        case 'inReview':
          return {
            hasApplication: true,
            status: 'inReview',
            canBook: false,
            message: 'Your application is pending manager review. Please wait for approval before booking.',
          };
        case 'rejected':
          return {
            hasApplication: true,
            status: 'rejected',
            canBook: false,
            message: 'Your application was rejected. You can re-apply with updated documents.',
          };
        case 'cancelled':
          return {
            hasApplication: true,
            status: 'cancelled',
            canBook: false,
            message: 'Your application was cancelled. You can submit a new application.',
          };
        default:
          return {
            hasApplication: true,
            status: application.status,
            canBook: false,
            message: 'Unknown application status. Please contact support.',
          };
      }
    } catch (error) {
      console.error('Error getting kitchen application status:', error);
      return {
        hasApplication: false,
        status: null,
        canBook: false,
        message: 'Error checking application status. Please try again.',
      };
    }
  }

  /**
   * Cancel/withdraw an application (by chef)
   */
  async cancelChefKitchenApplication(applicationId: number, chefId: number): Promise<ChefKitchenApplication | undefined> {
    try {
      // Verify the application belongs to this chef
      const [existing] = await db
        .select()
        .from(chefKitchenApplications)
        .where(
          and(
            eq(chefKitchenApplications.id, applicationId),
            eq(chefKitchenApplications.chefId, chefId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new Error('Application not found or access denied');
      }

      // Only allow cancellation if pending
      if (existing.status !== 'inReview') {
        throw new Error('Can only cancel pending applications');
      }

      const [updated] = await db
        .update(chefKitchenApplications)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(chefKitchenApplications.id, applicationId))
        .returning();

      return updated || undefined;
    } catch (error) {
      console.error('Error cancelling chef kitchen application:', error);
      throw error;
    }
  }

  /**
   * Get chef's kitchen access across all locations
   * Returns all approved applications with location details
   */
  async getChefApprovedKitchens(chefId: number): Promise<any[]> {
    try {
      console.log(`[getChefApprovedKitchens] Fetching approved kitchens for chef ${chefId}`);

      const approvedApps = await db
        .select()
        .from(chefKitchenApplications)
        .where(
          and(
            eq(chefKitchenApplications.chefId, chefId),
            eq(chefKitchenApplications.status, 'approved'),
            not(isNull(chefKitchenApplications.tier2_completed_at)) // Only include where Tier 2 is completed
          )
        );

      console.log(`[getChefApprovedKitchens] Found ${approvedApps.length} approved applications for chef ${chefId}`);

      // Enrich with location details - return flat structure for frontend
      const enrichedApps = await Promise.all(
        approvedApps.map(async (app) => {
          const location = await this.getLocationById(app.locationId);
          if (!location) {
            console.warn(`[getChefApprovedKitchens] Location ${app.locationId} not found for application ${app.id}`);
            return null;
          }

          // Return flat structure matching frontend expectations
          return {
            id: (location as any).id,
            name: (location as any).name,
            address: (location as any).address,
            logoUrl: (location as any).logoUrl || (location as any).logo_url || undefined,
            brandImageUrl: (location as any).brandImageUrl || (location as any).brand_image_url || undefined,
            applicationId: app.id,
            approvedAt: app.reviewedAt ? app.reviewedAt.toISOString() : null,
            // Keep locationId for backward compatibility
            locationId: app.locationId,
          };
        })
      );

      // Filter out any null entries (locations that weren't found)
      const validApps = enrichedApps.filter((app): app is NonNullable<typeof app> => app !== null);
      console.log(`[getChefApprovedKitchens] Returning ${validApps.length} valid approved locations`);

      return validApps;
    } catch (error) {
      console.error('Error getting chef approved kitchens:', error);
      return [];
    }
  }
}

// Create Firebase storage instance
export const firebaseStorage = new FirebaseStorage(); 