import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { phoneNumberSchema, optionalPhoneNumberSchema } from './phone-validation';

// Define an enum for kitchen preference
export const kitchenPreferenceEnum = pgEnum('kitchen_preference', ['commercial', 'home', 'notSure']);

// Define an enum for yes/no/not sure options
export const certificationStatusEnum = pgEnum('certification_status', ['yes', 'no', 'notSure']);

// Define an enum for application status
export const applicationStatusEnum = pgEnum('application_status', ['inReview', 'approved', 'rejected', 'cancelled']);

// Define an enum for user roles
export const userRoleEnum = pgEnum('user_role', ['admin', 'chef', 'manager']);

// Define an enum for document verification status
export const documentVerificationStatusEnum = pgEnum('document_verification_status', ['pending', 'approved', 'rejected', 'expired']);

// Define an enum for application types
export const applicationTypeEnum = pgEnum('application_type', ['chef']);


// Define an enum for booking status
export const bookingStatusEnum = pgEnum('booking_status', ['pending', 'confirmed', 'cancelled']);

// Define enums for storage listings
export const storageTypeEnum = pgEnum('storage_type', ['dry', 'cold', 'freezer']);
export const storagePricingModelEnum = pgEnum('storage_pricing_model', ['monthly-flat', 'per-cubic-foot', 'hourly', 'daily']);
export const bookingDurationUnitEnum = pgEnum('booking_duration_unit', ['hourly', 'daily', 'monthly']);
export const listingStatusEnum = pgEnum('listing_status', ['draft', 'pending', 'approved', 'rejected', 'active', 'inactive']);

// Define enums for equipment listings
export const equipmentCategoryEnum = pgEnum('equipment_category', ['food-prep', 'cooking', 'refrigeration', 'cleaning', 'specialty']);
export const equipmentConditionEnum = pgEnum('equipment_condition', ['excellent', 'good', 'fair', 'needs-repair']);
export const equipmentPricingModelEnum = pgEnum('equipment_pricing_model', ['hourly', 'daily', 'weekly', 'monthly']);
export const equipmentAvailabilityTypeEnum = pgEnum('equipment_availability_type', ['included', 'rental']);

// Define enum for payment status
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'refunded', 'failed', 'partially_refunded']);

// Define enum for transaction status (more comprehensive than payment_status)
export const transactionStatusEnum = pgEnum('transaction_status', ['pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded']);

// Define enum for booking type in payment transactions
export const bookingTypeEnum = pgEnum('booking_type_enum', ['kitchen', 'storage', 'equipment', 'bundle']);

// Define users table (for both admins and users)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role"), // Allow null initially - user will choose role
  googleId: text("google_id").unique(),
  facebookId: text("facebook_id").unique(),
  firebaseUid: text("firebase_uid").unique(),
  isVerified: boolean("is_verified").default(false).notNull(),
  has_seen_welcome: boolean("has_seen_welcome").default(false).notNull(),
  // Support dual roles - users can be both chef and manager
  isChef: boolean("is_chef").default(false).notNull(),
  isManager: boolean("is_manager").default(false).notNull(),
  isPortalUser: boolean("is_portal_user").default(false).notNull(),
  applicationType: applicationTypeEnum("application_type"), // DEPRECATED: kept for backward compatibility
  // Manager onboarding fields
  managerOnboardingCompleted: boolean("manager_onboarding_completed").default(false).notNull(), // Whether manager completed onboarding
  managerOnboardingSkipped: boolean("manager_onboarding_skipped").default(false).notNull(), // Whether manager skipped onboarding
  managerOnboardingStepsCompleted: jsonb("manager_onboarding_steps_completed").default({}).notNull(), // JSON object tracking completed onboarding steps
  // Manager profile data (bespoke fields)
  managerProfileData: jsonb("manager_profile_data").default({}).notNull(),
  // Stripe Connect fields for manager payments
  stripeConnectAccountId: text("stripe_connect_account_id").unique(), // Stripe Connect Express account ID
  stripeConnectOnboardingStatus: text("stripe_connect_onboarding_status").default("not_started").notNull(), // Status: 'not_started', 'in_progress', 'complete', 'failed'
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define the applications table (for chefs)
export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  foodSafetyLicense: certificationStatusEnum("food_safety_license").notNull(),
  foodEstablishmentCert: certificationStatusEnum("food_establishment_cert").notNull(),
  kitchenPreference: kitchenPreferenceEnum("kitchen_preference").notNull(),
  feedback: text("feedback"),
  status: applicationStatusEnum("status").default("inReview").notNull(),

  // Document verification fields
  foodSafetyLicenseUrl: text("food_safety_license_url"),
  foodEstablishmentCertUrl: text("food_establishment_cert_url"),
  foodSafetyLicenseStatus: documentVerificationStatusEnum("food_safety_license_status").default("pending"),
  foodEstablishmentCertStatus: documentVerificationStatusEnum("food_establishment_cert_status").default("pending"),
  documentsAdminFeedback: text("documents_admin_feedback"),
  documentsReviewedBy: integer("documents_reviewed_by").references(() => users.id),
  documentsReviewedAt: timestamp("documents_reviewed_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});


// Define the Zod schema for inserting an application
export const insertApplicationSchema = createInsertSchema(applications, {
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema, // Uses shared phone validation
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  feedback: z.string().optional(),
  userId: z.number().optional(),
  // Document fields are optional during initial application submission
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCertUrl: z.string().optional(),
  // Allow setting document status during creation
  foodSafetyLicenseStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  foodEstablishmentCertStatus: z.enum(["pending", "approved", "rejected"]).optional(),
}).omit({
  id: true,
  status: true,
  createdAt: true,
  documentsAdminFeedback: true,
  documentsReviewedBy: true,
  documentsReviewedAt: true,
});

// Define the Zod schema for updating the status of an application
export const updateApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["inReview", "approved", "rejected", "cancelled"]),
});

// Schema for updating application documents
export const updateApplicationDocumentsSchema = z.object({
  id: z.number(),
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCertUrl: z.string().optional(),
});

// Schema for admin document verification updates
export const updateDocumentVerificationSchema = z.object({
  id: z.number(),
  foodSafetyLicenseStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  foodEstablishmentCertStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  documentsAdminFeedback: z.string().optional(),
  documentsReviewedBy: z.number().optional(),
});

// Define the types
export type Application = typeof applications.$inferSelect;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type UpdateApplicationStatus = z.infer<typeof updateApplicationStatusSchema>;
export type UpdateApplicationDocuments = z.infer<typeof updateApplicationDocumentsSchema>;
export type UpdateDocumentVerification = z.infer<typeof updateDocumentVerificationSchema>;

// Schema for inserting users
export const insertUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "chef", "manager"]).default("chef"),
  googleId: z.string().optional(),
  facebookId: z.string().optional(),
  firebaseUid: z.string().optional(),
  isChef: z.boolean().default(false),
  isManager: z.boolean().default(false),
  isPortalUser: z.boolean().default(false),
  managerProfileData: z.record(z.any()).default({}),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export interface UserWithFlags extends User {
  uid?: string;
  displayName?: string | null;
  fullName?: string | null;
  emailVerified?: boolean;
}

// Define email verification tokens table
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;

// Remove old document verification schemas and types since they're now part of applications
// The document verification functionality is now integrated into the applications table

// Define microlearning_completions table
export const microlearningCompletions = pgTable("microlearning_completions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  confirmed: boolean("confirmed").default(false).notNull(),
  certificateGenerated: boolean("certificate_generated").default(false).notNull(),
  videoProgress: jsonb("video_progress"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define video_progress table
export const videoProgress = pgTable("video_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  videoId: text("video_id").notNull(),
  progress: numeric("progress", { precision: 5, scale: 2 }).default("0").notNull(),
  completed: boolean("completed").default(false).notNull(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  watchedPercentage: numeric("watched_percentage", { precision: 5, scale: 2 }).default("0").notNull(),
  isRewatching: boolean("is_rewatching").default(false).notNull(),
});

// Define schemas for microlearning operations
export const insertMicrolearningCompletionSchema = createInsertSchema(microlearningCompletions, {
  userId: z.number(),
  confirmed: z.boolean().optional(),
  certificateGenerated: z.boolean().optional(),
  videoProgress: z.any().optional(),
}).omit({
  id: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVideoProgressSchema = createInsertSchema(videoProgress, {
  userId: z.number(),
  videoId: z.string().min(1, "Video ID is required"),
  progress: z.number().min(0).max(100).optional(),
  completed: z.boolean().optional(),
  watchedPercentage: z.number().min(0).max(100).optional(),
  isRewatching: z.boolean().optional(),
}).omit({
  id: true,
  completedAt: true,
  updatedAt: true,
});

// Define types
export type MicrolearningCompletion = typeof microlearningCompletions.$inferSelect;
export type InsertMicrolearningCompletion = z.infer<typeof insertMicrolearningCompletionSchema>;
export type VideoProgress = typeof videoProgress.$inferSelect;
export type InsertVideoProgress = z.infer<typeof insertVideoProgressSchema>;


// ===== KITCHEN BOOKING SYSTEM TABLES =====

// Define locations table
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  managerId: integer("manager_id").references(() => users.id),
  notificationEmail: text("notification_email"), // Email where notifications will be sent
  notificationPhone: text("notification_phone"), // Phone number where SMS notifications will be sent
  cancellationPolicyHours: integer("cancellation_policy_hours").default(24).notNull(),
  cancellationPolicyMessage: text("cancellation_policy_message").default("Bookings cannot be cancelled within {hours} hours of the scheduled time.").notNull(),
  defaultDailyBookingLimit: integer("default_daily_booking_limit").default(2).notNull(),
  minimumBookingWindowHours: integer("minimum_booking_window_hours").default(1).notNull(),
  logoUrl: text("logo_url"), // Logo URL for the location (for manager header)
  brandImageUrl: text("brand_image_url"), // Brand image URL for the location (displayed on public kitchen listings)
  timezone: text("timezone").default("America/St_Johns").notNull(), // Timezone for this location (default: Newfoundland)
  // Kitchen license fields for manager onboarding
  kitchenLicenseUrl: text("kitchen_license_url"), // URL to uploaded kitchen license document
  kitchenLicenseStatus: text("kitchen_license_status").default("pending"), // pending, approved, rejected
  kitchenLicenseApprovedBy: integer("kitchen_license_approved_by").references(() => users.id), // Admin who approved/rejected
  kitchenLicenseApprovedAt: timestamp("kitchen_license_approved_at"), // When license was approved/rejected
  kitchenLicenseFeedback: text("kitchen_license_feedback"), // Admin feedback on license
  kitchenLicenseExpiry: date("kitchen_license_expiry"), // Expiration date of the kitchen license
  description: text("description"), // Description of the location
  customOnboardingLink: text("custom_onboarding_link"), // Custom link for onboarding
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define location_requirements table (custom application requirements per location)
export const locationRequirements = pgTable("location_requirements", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull().unique(),

  // Personal Information
  requireFirstName: boolean("require_first_name").default(true).notNull(),
  requireLastName: boolean("require_last_name").default(true).notNull(),
  requireEmail: boolean("require_email").default(true).notNull(),
  requirePhone: boolean("require_phone").default(true).notNull(),

  // Business Information
  requireBusinessName: boolean("require_business_name").default(true).notNull(),
  requireBusinessType: boolean("require_business_type").default(true).notNull(),
  requireExperience: boolean("require_experience").default(true).notNull(),
  requireBusinessDescription: boolean("require_business_description").default(false).notNull(),

  // Certifications
  requireFoodHandlerCert: boolean("require_food_handler_cert").default(true).notNull(),
  requireFoodHandlerExpiry: boolean("require_food_handler_expiry").default(true).notNull(),

  // Kitchen Usage
  requireUsageFrequency: boolean("require_usage_frequency").default(true).notNull(),
  requireSessionDuration: boolean("require_session_duration").default(true).notNull(),

  // Agreements
  requireTermsAgree: boolean("require_terms_agree").default(true).notNull(),
  requireAccuracyAgree: boolean("require_accuracy_agree").default(true).notNull(),

  // Tier 1 Requirements (Submit Application)
  tier1_years_experience_required: boolean("tier1_years_experience_required").default(false).notNull(),
  tier1_years_experience_minimum: integer("tier1_years_experience_minimum").default(0).notNull(),
  tier1_custom_fields: jsonb("tier1_custom_fields").default([]),

  // Tier 2 Requirements (Kitchen Coordination)
  tier2_food_establishment_cert_required: boolean("tier2_food_establishment_cert_required").default(false).notNull(),
  tier2_food_establishment_expiry_required: boolean("tier2_food_establishment_expiry_required").default(false).notNull(),
  tier2_insurance_document_required: boolean("tier2_insurance_document_required").default(false).notNull(),
  tier2_insurance_minimum_amount: integer("tier2_insurance_minimum_amount").default(0).notNull(),
  tier2_kitchen_experience_required: boolean("tier2_kitchen_experience_required").default(false).notNull(),
  tier2_allergen_plan_required: boolean("tier2_allergen_plan_required").default(false).notNull(),
  tier2_supplier_list_required: boolean("tier2_supplier_list_required").default(false).notNull(),
  tier2_quality_control_required: boolean("tier2_quality_control_required").default(false).notNull(),
  tier2_traceability_system_required: boolean("tier2_traceability_system_required").default(false).notNull(),
  tier2_custom_fields: jsonb("tier2_custom_fields").default([]),

  // Facility Information (auto-shared with chefs)
  floor_plans_url: text("floor_plans_url"),
  ventilation_specs: text("ventilation_specs"),
  ventilation_specs_url: text("ventilation_specs_url"),
  equipment_list: jsonb("equipment_list").default([]), // Array of equipment names
  materials_description: text("materials_description"),

  // Custom Fields (JSONB array of field definitions)
  customFields: jsonb("custom_fields").default([]), // Array of { id, label, type, required, options?, placeholder? }

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define kitchens table
export const kitchens = pgTable("kitchens", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"), // Image URL for the kitchen (displayed on public kitchen listings)
  galleryImages: jsonb("gallery_images").default([]), // Array of image URLs for kitchen gallery carousel
  amenities: jsonb("amenities").default([]), // Array of amenities/features for the kitchen
  isActive: boolean("is_active").default(true).notNull(),
  // Pricing fields (all prices stored as integers in cents to avoid floating-point precision issues)
  hourlyRate: numeric("hourly_rate"), // Base hourly rate in cents (e.g., 5000 = $50.00/hour)
  currency: text("currency").default("CAD").notNull(), // Currency code (ISO 4217)
  minimumBookingHours: integer("minimum_booking_hours").default(1).notNull(), // Minimum booking duration
  pricingModel: text("pricing_model").default("hourly").notNull(), // Pricing structure ('hourly', 'daily', 'weekly')
  taxRatePercent: numeric("tax_rate_percent"), // Optional tax percentage (e.g., 13 for 13%)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define kitchen availability table
export const kitchenAvailability = pgTable("kitchen_availability", {
  id: serial("id").primaryKey(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0-6, Sunday is 0
  startTime: text("start_time").notNull(), // HH:MM format
  endTime: text("end_time").notNull(), // HH:MM format
  isAvailable: boolean("is_available").default(true).notNull(),
});

// Define kitchen date-specific overrides table for holidays, closures, etc.
export const kitchenDateOverrides = pgTable("kitchen_date_overrides", {
  id: serial("id").primaryKey(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
  specificDate: timestamp("specific_date").notNull(), // Specific date for override
  startTime: text("start_time"), // HH:MM format, null if closed all day
  endTime: text("end_time"), // HH:MM format, null if closed all day
  isAvailable: boolean("is_available").default(false).notNull(), // false = closed, true = custom hours
  reason: text("reason"), // Optional reason (e.g., "Holiday", "Maintenance")
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define kitchen bookings table
export const kitchenBookings = pgTable("kitchen_bookings", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id), // Nullable for external/third-party bookings
  kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
  bookingDate: timestamp("booking_date").notNull(),
  startTime: text("start_time").notNull(), // HH:MM format
  endTime: text("end_time").notNull(), // HH:MM format
  status: bookingStatusEnum("status").default("pending").notNull(),
  specialNotes: text("special_notes"),
  bookingType: text("booking_type").default("chef").notNull(), // 'chef', 'external', 'manager_blocked'
  createdBy: integer("created_by").references(() => users.id), // Manager who created the booking (for external/manual bookings)
  externalContactName: text("external_contact_name"), // For third-party bookings
  externalContactEmail: text("external_contact_email"), // For third-party bookings
  externalContactPhone: text("external_contact_phone"), // For third-party bookings
  externalContactCompany: text("external_contact_company"), // For third-party bookings
  // Pricing fields (all prices stored as integers in cents)
  totalPrice: numeric("total_price"), // Total booking price in cents
  hourlyRate: numeric("hourly_rate"), // Rate used for this booking (in cents)
  durationHours: numeric("duration_hours"), // Calculated duration (decimal for partial hours)
  storageItems: jsonb("storage_items").default([]), // Array of storage booking IDs: [{storageBookingId: 1, storageListingId: 5}]
  equipmentItems: jsonb("equipment_items").default([]), // Array of equipment booking IDs: [{equipmentBookingId: 2, equipmentListingId: 8}]
  paymentStatus: paymentStatusEnum("payment_status").default("pending"), // Payment status
  paymentIntentId: text("payment_intent_id"), // Stripe PaymentIntent ID (nullable, unique)
  damageDeposit: numeric("damage_deposit").default("0"), // Damage deposit amount (in cents)
  serviceFee: numeric("service_fee").default("0"), // Platform commission (in cents)
  currency: text("currency").default("CAD").notNull(), // Currency code
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define chef_location_access table (admin grants chef access to specific locations)
// When a chef has access to a location, they can book any kitchen within that location
export const chefLocationAccess = pgTable("chef_location_access", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(), // admin who granted access
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});

// Legacy table - kept for backward compatibility during migration
export const chefKitchenAccess = pgTable("chef_kitchen_access", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
  grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});

// Define chef_kitchen_profiles table (chef shares profile, manager approves)
export const chefKitchenProfiles = pgTable("chef_kitchen_profiles", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("pending").notNull(), // 'pending', 'approved', 'rejected'
  sharedAt: timestamp("shared_at").defaultNow().notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }), // manager who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewFeedback: text("review_feedback"), // optional feedback from manager
});

// Define chef_location_profiles table (NEW - location-based profile sharing)
export const chefLocationProfiles = pgTable("chef_location_profiles", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("pending").notNull(), // 'pending', 'approved', 'rejected'
  sharedAt: timestamp("shared_at").defaultNow().notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }), // manager who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewFeedback: text("review_feedback"), // optional feedback from manager
});

// Define portal_user_applications table (portal users apply for location access)
export const portalUserApplications = pgTable("portal_user_applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  company: text("company"), // Optional company name
  status: applicationStatusEnum("status").default("inReview").notNull(), // 'inReview', 'approved', 'rejected', 'cancelled'
  feedback: text("feedback"), // Manager feedback
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }), // manager who reviewed
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Define portal_user_location_access table (manager grants portal user access after approval)
// Portal users can book kitchens at their assigned location
export const portalUserLocationAccess = pgTable("portal_user_location_access", {
  id: serial("id").primaryKey(),
  portalUserId: integer("portal_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(), // manager who granted access
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  applicationId: integer("application_id").references(() => portalUserApplications.id, { onDelete: "set null" }), // Link to original application
});

// Zod schemas for kitchen booking system

export const insertLocationSchema = createInsertSchema(locations, {
  name: z.string().min(2, "Location name must be at least 2 characters"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  managerId: z.number().optional(),
  notificationEmail: z.string().email("Please enter a valid email address").optional(),
  notificationPhone: optionalPhoneNumberSchema, // Optional phone for SMS notifications
  description: z.string().optional(),
  customOnboardingLink: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateLocationSchema = z.object({
  id: z.number(),
  name: z.string().min(2).optional(),
  address: z.string().min(5).optional(),
  managerId: z.number().optional(),
  notificationEmail: z.string().email("Please enter a valid email address").optional(),
  notificationPhone: optionalPhoneNumberSchema, // Optional phone for SMS notifications
  description: z.string().optional(),
  customOnboardingLink: z.string().optional(),
});

// Zod schemas for location requirements
export const insertLocationRequirementsSchema = createInsertSchema(locationRequirements, {
  locationId: z.number(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Custom field definition schema
export const customFieldSchema = z.object({
  id: z.string(), // Unique identifier for the field
  label: z.string().min(1, "Label is required"),
  type: z.enum(["text", "textarea", "number", "select", "checkbox", "date", "file", "cloudflare_upload"]),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(), // For select fields
  tier: z.number().min(1).max(3), // Tier assignment for the field
});

export const updateLocationRequirementsSchema = z.object({
  requireFirstName: z.boolean().optional(),
  requireLastName: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
  requirePhone: z.boolean().optional(),
  requireBusinessName: z.boolean().optional(),
  requireBusinessType: z.boolean().optional(),
  requireExperience: z.boolean().optional(),
  requireBusinessDescription: z.boolean().optional(),
  requireFoodHandlerCert: z.boolean().optional(),
  requireFoodHandlerExpiry: z.boolean().optional(),
  requireUsageFrequency: z.boolean().optional(),
  requireSessionDuration: z.boolean().optional(),
  requireTermsAgree: z.boolean().optional(),
  requireAccuracyAgree: z.boolean().optional(),
  customFields: z.array(customFieldSchema).optional(),
  // Tier 1 Requirements
  tier1_years_experience_required: z.boolean().optional(),
  tier1_years_experience_minimum: z.number().int().min(0).optional(),
  tier1_custom_fields: z.array(customFieldSchema).optional().default([]),
  // Tier 2 Requirements
  tier2_food_establishment_cert_required: z.boolean().optional(),
  tier2_food_establishment_expiry_required: z.boolean().optional(),
  tier2_insurance_document_required: z.boolean().optional(),
  tier2_insurance_minimum_amount: z.number().int().min(0).optional(),
  tier2_kitchen_experience_required: z.boolean().optional(),
  tier2_allergen_plan_required: z.boolean().optional(),
  tier2_supplier_list_required: z.boolean().optional(),
  tier2_quality_control_required: z.boolean().optional(),
  tier2_traceability_system_required: z.boolean().optional(),
  tier2_custom_fields: z.array(customFieldSchema).optional().default([]),
  // Facility Information
  floor_plans_url: z.union([
    z.null(),
    z.literal(''),
    z.string().url(),
    z.string()
  ]).optional(),
  ventilation_specs: z.union([
    z.string(),
    z.literal(''),
    z.null()
  ]).optional(),
  ventilation_specs_url: z.union([
    z.null(),
    z.literal(''),
    z.string().url(),
    z.string()
  ]).optional(),
  equipment_list: z.array(z.string()).optional(),
  materials_description: z.string().optional(),
});

export const insertKitchenSchema = createInsertSchema(kitchens, {
  locationId: z.number(),
  name: z.string().min(1, "Kitchen name is required"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  hourlyRate: z.number().int().positive("Hourly rate must be positive").optional(),
  currency: z.string().min(3).max(3).optional(),
  minimumBookingHours: z.number().int().positive("Minimum booking hours must be positive").optional(),
  pricingModel: z.enum(["hourly", "daily", "weekly"]).optional(),
  taxRatePercent: z.number().min(0).max(100).nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateKitchenSchema = z.object({
  id: z.number(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  hourlyRate: z.number().int().positive("Hourly rate must be positive").optional(),
  currency: z.string().min(3).max(3).optional(),
  minimumBookingHours: z.number().int().positive("Minimum booking hours must be positive").optional(),
  pricingModel: z.enum(["hourly", "daily", "weekly"]).optional(),
  taxRatePercent: z.number().min(0).max(100).nullable().optional(),
});

export const insertKitchenAvailabilitySchema = createInsertSchema(kitchenAvailability, {
  kitchenId: z.number(),
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  isAvailable: z.boolean().optional(),
}).omit({
  id: true,
});

export const insertKitchenDateOverrideSchema = createInsertSchema(kitchenDateOverrides, {
  kitchenId: z.number(),
  specificDate: z.string().or(z.date()),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
  isAvailable: z.boolean().optional(),
  reason: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateKitchenDateOverrideSchema = z.object({
  id: z.number(),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
  isAvailable: z.boolean().optional(),
  reason: z.string().optional(),
});

export const insertKitchenBookingSchema = createInsertSchema(kitchenBookings, {
  chefId: z.number(), // REQUIRED - matches actual DB
  kitchenId: z.number(),
  bookingDate: z.string().or(z.date()),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  specialNotes: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateKitchenBookingSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  specialNotes: z.string().optional(),
});

// Type exports
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;

export type LocationRequirements = typeof locationRequirements.$inferSelect;
export type InsertLocationRequirements = z.infer<typeof insertLocationRequirementsSchema>;
export type UpdateLocationRequirements = z.infer<typeof updateLocationRequirementsSchema>;

export type Kitchen = typeof kitchens.$inferSelect;
export type InsertKitchen = z.infer<typeof insertKitchenSchema>;
export type UpdateKitchen = z.infer<typeof updateKitchenSchema>;

export type KitchenAvailability = typeof kitchenAvailability.$inferSelect;
export type InsertKitchenAvailability = z.infer<typeof insertKitchenAvailabilitySchema>;

export type KitchenDateOverride = typeof kitchenDateOverrides.$inferSelect;
export type InsertKitchenDateOverride = z.infer<typeof insertKitchenDateOverrideSchema>;
export type UpdateKitchenDateOverride = z.infer<typeof updateKitchenDateOverrideSchema>;

export type KitchenBooking = typeof kitchenBookings.$inferSelect;
export type InsertKitchenBooking = z.infer<typeof insertKitchenBookingSchema>;
export type UpdateKitchenBooking = z.infer<typeof updateKitchenBookingSchema>;

// Zod schemas for chef location access
export const insertChefLocationAccessSchema = createInsertSchema(chefLocationAccess, {
  chefId: z.number(),
  locationId: z.number(),
  grantedBy: z.number(),
}).omit({
  id: true,
  grantedAt: true,
});

// Zod schemas for chef kitchen access (legacy - for backward compatibility)
export const insertChefKitchenAccessSchema = createInsertSchema(chefKitchenAccess, {
  chefId: z.number(),
  kitchenId: z.number(),
  grantedBy: z.number(),
}).omit({
  id: true,
  grantedAt: true,
});

// Zod schemas for chef kitchen profiles
export const insertChefKitchenProfileSchema = createInsertSchema(chefKitchenProfiles, {
  chefId: z.number(),
  kitchenId: z.number(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
}).omit({
  id: true,
  sharedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewFeedback: true,
});

export const updateChefKitchenProfileSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewFeedback: z.string().optional(),
});

// Type exports for chef location access
export type ChefLocationAccess = typeof chefLocationAccess.$inferSelect;
export type InsertChefLocationAccess = z.infer<typeof insertChefLocationAccessSchema>;

// Type exports for chef kitchen access (legacy)
export type ChefKitchenAccess = typeof chefKitchenAccess.$inferSelect;
export type InsertChefKitchenAccess = z.infer<typeof insertChefKitchenAccessSchema>;

export type ChefKitchenProfile = typeof chefKitchenProfiles.$inferSelect;
export type InsertChefKitchenProfile = z.infer<typeof insertChefKitchenProfileSchema>;
export type UpdateChefKitchenProfile = z.infer<typeof updateChefKitchenProfileSchema>;

// Zod schemas for location-based profiles (NEW)
export const insertChefLocationProfileSchema = createInsertSchema(chefLocationProfiles, {
  chefId: z.number(),
  locationId: z.number(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
}).omit({
  id: true,
  sharedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewFeedback: true,
});

export const updateChefLocationProfileSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewFeedback: z.string().optional(),
});

// Type exports for location-based profiles
export type ChefLocationProfile = typeof chefLocationProfiles.$inferSelect;
export type InsertChefLocationProfile = z.infer<typeof insertChefLocationProfileSchema>;
export type UpdateChefLocationProfile = z.infer<typeof updateChefLocationProfileSchema>;

// Zod schemas for portal user applications
export const insertPortalUserApplicationSchema = createInsertSchema(portalUserApplications, {
  userId: z.number(),
  locationId: z.number(),
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema, // Uses shared phone validation
  company: z.string().optional(),
}).omit({
  id: true,
  status: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  feedback: true,
});

export const updatePortalUserApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["inReview", "approved", "rejected", "cancelled"]),
  feedback: z.string().optional(),
});

// Zod schemas for portal user location access
export const insertPortalUserLocationAccessSchema = createInsertSchema(portalUserLocationAccess, {
  portalUserId: z.number(),
  locationId: z.number(),
  grantedBy: z.number(),
  applicationId: z.number().optional(),
}).omit({
  id: true,
  grantedAt: true,
});

// Type exports for portal user applications
export type PortalUserApplication = typeof portalUserApplications.$inferSelect;
export type InsertPortalUserApplication = z.infer<typeof insertPortalUserApplicationSchema>;
export type UpdatePortalUserApplicationStatus = z.infer<typeof updatePortalUserApplicationStatusSchema>;

// Type exports for portal user location access
export type PortalUserLocationAccess = typeof portalUserLocationAccess.$inferSelect;
export type InsertPortalUserLocationAccess = z.infer<typeof insertPortalUserLocationAccessSchema>;

// Define storage_listings table
export const storageListings = pgTable("storage_listings", {
  id: serial("id").primaryKey(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
  storageType: storageTypeEnum("storage_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),

  // Physical specifications
  dimensionsLength: numeric("dimensions_length"), // feet/meters
  dimensionsWidth: numeric("dimensions_width"),
  dimensionsHeight: numeric("dimensions_height"),
  totalVolume: numeric("total_volume"), // cubic feet/meters (auto-calculated)
  shelfCount: integer("shelf_count"),
  shelfMaterial: text("shelf_material"),
  accessType: text("access_type"), // 'walk-in', 'shelving-unit', 'rack-system'

  // Features & amenities (JSONB for flexibility - following existing pattern)
  features: jsonb("features").default([]),
  securityFeatures: jsonb("security_features").default([]),
  climateControl: boolean("climate_control").default(false),
  temperatureRange: text("temperature_range"), // "35-40°F"
  humidityControl: boolean("humidity_control").default(false),
  powerOutlets: integer("power_outlets").default(0),

  // Pricing (all in cents)
  pricingModel: storagePricingModelEnum("pricing_model").notNull(),
  basePrice: numeric("base_price").notNull(), // Base price in cents (integer)
  pricePerCubicFoot: numeric("price_per_cubic_foot"), // For per-cubic-foot model (in cents)
  // Booking duration (flexible: hourly, daily, or monthly)
  minimumBookingDuration: integer("minimum_booking_duration").default(1).notNull(), // Minimum booking duration (number)
  bookingDurationUnit: bookingDurationUnitEnum("booking_duration_unit").default("monthly").notNull(), // Unit: hourly, daily, or monthly
  currency: text("currency").default("CAD").notNull(), // Locked to CAD

  // Status & moderation (admin approval workflow)
  status: listingStatusEnum("status").default("draft").notNull(),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }), // Admin who approved
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"), // If rejected by admin

  // Availability
  isActive: boolean("is_active").default(true).notNull(),
  availabilityCalendar: jsonb("availability_calendar").default({}), // Blocked dates, maintenance windows

  // Compliance & documentation
  certifications: jsonb("certifications").default([]),
  photos: jsonb("photos").default([]), // Array of image URLs
  documents: jsonb("documents").default([]), // Array of document URLs

  // Rules & restrictions
  houseRules: jsonb("house_rules").default([]),
  prohibitedItems: jsonb("prohibited_items").default([]),
  insuranceRequired: boolean("insurance_required").default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas for storage listings
export const insertStorageListingSchema = createInsertSchema(storageListings, {
  kitchenId: z.number(),
  name: z.string().min(3, "Name must be at least 3 characters"),
  storageType: z.enum(["dry", "cold", "freezer"]),
  pricingModel: z.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]),
  basePrice: z.number().int().positive("Base price must be positive"),
  pricePerCubicFoot: z.number().int().positive("Price per cubic foot must be positive").optional(),
  minimumBookingDuration: z.number().int().positive("Minimum booking duration must be positive").optional(),
  bookingDurationUnit: z.enum(["hourly", "daily", "monthly"]).optional(),
  dimensionsLength: z.number().positive().optional(),
  dimensionsWidth: z.number().positive().optional(),
  dimensionsHeight: z.number().positive().optional(),
  totalVolume: z.number().positive().optional(),
  shelfCount: z.number().int().min(0).optional(),
  temperatureRange: z.string().optional(),
  features: z.array(z.string()).optional(),
  securityFeatures: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(),
  documents: z.array(z.string()).optional(),
  houseRules: z.array(z.string()).optional(),
  prohibitedItems: z.array(z.string()).optional(),
  availabilityCalendar: z.record(z.any()).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  approvedBy: true,
  approvedAt: true,
  rejectionReason: true,
  currency: true, // Always CAD, not user-selectable
});

export const updateStorageListingSchema = z.object({
  id: z.number(),
  name: z.string().min(3).optional(),
  description: z.string().optional(),
  storageType: z.enum(["dry", "cold", "freezer"]).optional(),
  pricingModel: z.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]).optional(),
  basePrice: z.number().int().positive().optional(),
  pricePerCubicFoot: z.number().int().positive().optional(),
  minimumBookingDuration: z.number().int().positive().optional(),
  bookingDurationUnit: z.enum(["hourly", "daily", "monthly"]).optional(),
  dimensionsLength: z.number().positive().optional(),
  dimensionsWidth: z.number().positive().optional(),
  dimensionsHeight: z.number().positive().optional(),
  totalVolume: z.number().positive().optional(),
  shelfCount: z.number().int().min(0).optional(),
  shelfMaterial: z.string().optional(),
  accessType: z.string().optional(),
  temperatureRange: z.string().optional(),
  climateControl: z.boolean().optional(),
  humidityControl: z.boolean().optional(),
  powerOutlets: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  insuranceRequired: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  securityFeatures: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(),
  documents: z.array(z.string()).optional(),
  houseRules: z.array(z.string()).optional(),
  prohibitedItems: z.array(z.string()).optional(),
  availabilityCalendar: z.record(z.any()).optional(),
});

export const updateStorageListingStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["draft", "pending", "approved", "rejected", "active", "inactive"]),
  rejectionReason: z.string().optional(),
});

// Type exports for storage listings
export type StorageListing = typeof storageListings.$inferSelect;
export type InsertStorageListing = z.infer<typeof insertStorageListingSchema>;
export type UpdateStorageListing = z.infer<typeof updateStorageListingSchema>;
export type UpdateStorageListingStatus = z.infer<typeof updateStorageListingStatusSchema>;

// Define equipment_listings table
export const equipmentListings = pgTable("equipment_listings", {
  id: serial("id").primaryKey(),
  kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),

  // Category & type
  category: equipmentCategoryEnum("category").notNull(),
  equipmentType: text("equipment_type").notNull(), // 'mixer', 'oven', 'fryer', etc.
  brand: text("brand"),
  description: text("description"),
  condition: equipmentConditionEnum("condition").notNull(),

  // Availability type: included (free with kitchen) or rental (paid addon)
  availabilityType: equipmentAvailabilityTypeEnum("availability_type").default("rental").notNull(),

  // Pricing - flat session rate (in cents)
  sessionRate: numeric("session_rate").default("0"), // Flat session rate in cents (e.g., 2500 = $25.00/session)
  currency: text("currency").default("CAD").notNull(),

  // Damage deposit (in cents)
  damageDeposit: numeric("damage_deposit").default("0"), // Refundable deposit (in cents)

  // Status
  status: listingStatusEnum("status").default("draft").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas for equipment listings
export const insertEquipmentListingSchema = createInsertSchema(equipmentListings, {
  kitchenId: z.number(),
  category: z.enum(["food-prep", "cooking", "refrigeration", "cleaning", "specialty"]),
  equipmentType: z.string().min(1, "Equipment type is required"),
  condition: z.enum(["excellent", "good", "fair", "needs-repair"]),
  availabilityType: z.enum(["included", "rental"]),
  damageDeposit: z.number().int().min(0).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  currency: true, // Always CAD, not user-selectable
});

export const updateEquipmentListingSchema = z.object({
  id: z.number(),
  category: z.enum(["food-prep", "cooking", "refrigeration", "cleaning", "specialty"]).optional(),
  equipmentType: z.string().min(1).optional(),
  brand: z.string().optional(),
  description: z.string().optional(),
  condition: z.enum(["excellent", "good", "fair", "needs-repair"]).optional(),
  availabilityType: z.enum(["included", "rental"]).optional(),
  sessionRate: z.number().int().min(0).optional(),
  damageDeposit: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const updateEquipmentListingStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["draft", "pending", "approved", "rejected", "active", "inactive"]),
});

// Type exports for equipment listings
export type EquipmentListing = typeof equipmentListings.$inferSelect;
export type InsertEquipmentListing = z.infer<typeof insertEquipmentListingSchema>;
export type UpdateEquipmentListing = z.infer<typeof updateEquipmentListingSchema>;
export type UpdateEquipmentListingStatus = z.infer<typeof updateEquipmentListingStatusSchema>;

// ===== STORAGE BOOKINGS TABLE =====
// CRITICAL: Storage can ONLY be booked as part of a kitchen booking (not standalone)
// Must include kitchen_booking_id foreign key - no standalone storage booking endpoints

export const storageBookings = pgTable("storage_bookings", {
  id: serial("id").primaryKey(),
  storageListingId: integer("storage_listing_id").references(() => storageListings.id, { onDelete: "cascade" }).notNull(),
  kitchenBookingId: integer("kitchen_booking_id").references(() => kitchenBookings.id, { onDelete: "cascade" }), // NULLABLE - storage can be booked independently
  chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }), // Chef making the booking
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: bookingStatusEnum("status").default("pending").notNull(),
  totalPrice: numeric("total_price").notNull(), // In cents (daily_rate × number_of_days)
  pricingModel: storagePricingModelEnum("pricing_model").notNull(), // Always 'daily' now
  paymentStatus: paymentStatusEnum("payment_status").default("pending"),
  paymentIntentId: text("payment_intent_id"), // Stripe PaymentIntent ID
  serviceFee: numeric("service_fee").default("0"), // Platform commission in cents
  currency: text("currency").default("CAD").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas for storage bookings
export const insertStorageBookingSchema = createInsertSchema(storageBookings, {
  storageListingId: z.number(),
  kitchenBookingId: z.number().optional().nullable(), // Optional - for standalone storage bookings
  chefId: z.number().optional(),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  totalPrice: z.number().int().positive("Total price must be positive"),
  pricingModel: z.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]),
  paymentStatus: z.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
  paymentIntentId: z.string().optional(),
  serviceFee: z.number().int().min(0).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  currency: true, // Always CAD, not user-selectable
});

export const updateStorageBookingSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  paymentStatus: z.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
  paymentIntentId: z.string().optional(),
  serviceFee: z.number().int().min(0).optional(),
});

export const updateStorageBookingStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "confirmed", "cancelled"]),
});

// Type exports for storage bookings
export type StorageBooking = typeof storageBookings.$inferSelect;
export type InsertStorageBooking = z.infer<typeof insertStorageBookingSchema>;
export type UpdateStorageBooking = z.infer<typeof updateStorageBookingSchema>;
export type UpdateStorageBookingStatus = z.infer<typeof updateStorageBookingStatusSchema>;

// ===== EQUIPMENT BOOKINGS TABLE =====
// CRITICAL: Equipment can ONLY be booked as part of a kitchen booking (not standalone)
// Only rental equipment (availability_type='rental') can be booked - included equipment is automatically available
// No delivery/pickup fields - equipment stays in kitchen

export const equipmentBookings = pgTable("equipment_bookings", {
  id: serial("id").primaryKey(),
  equipmentListingId: integer("equipment_listing_id").references(() => equipmentListings.id, { onDelete: "cascade" }).notNull(),
  kitchenBookingId: integer("kitchen_booking_id").references(() => kitchenBookings.id, { onDelete: "cascade" }).notNull(), // REQUIRED - no standalone bookings
  chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }), // Nullable for external bookings
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: bookingStatusEnum("status").default("pending").notNull(), // Reuse existing enum
  totalPrice: numeric("total_price").notNull(), // In cents
  pricingModel: equipmentPricingModelEnum("pricing_model").notNull(), // Reuse enum
  damageDeposit: numeric("damage_deposit").default("0"), // In cents (only for rental)
  paymentStatus: paymentStatusEnum("payment_status").default("pending"), // Reuse enum
  paymentIntentId: text("payment_intent_id"), // Stripe PaymentIntent ID (nullable, unique)
  serviceFee: numeric("service_fee").default("0"), // Platform commission in cents
  currency: text("currency").default("CAD").notNull(),
  // NOTE: No delivery/pickup fields - equipment stays in kitchen
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas for equipment bookings
export const insertEquipmentBookingSchema = createInsertSchema(equipmentBookings, {
  equipmentListingId: z.number(),
  kitchenBookingId: z.number(),
  chefId: z.number().optional(),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  totalPrice: z.number().int().positive("Total price must be positive"),
  pricingModel: z.enum(["hourly", "daily", "weekly", "monthly"]),
  damageDeposit: z.number().int().min(0).optional(),
  paymentStatus: z.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
  paymentIntentId: z.string().optional(),
  serviceFee: z.number().int().min(0).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  currency: true, // Always CAD, not user-selectable
});

export const updateEquipmentBookingSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  paymentStatus: z.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
  paymentIntentId: z.string().optional(),
  damageDeposit: z.number().int().min(0).optional(),
  serviceFee: z.number().int().min(0).optional(),
});

export const updateEquipmentBookingStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "confirmed", "cancelled"]),
});

// Type exports for equipment bookings
export type EquipmentBooking = typeof equipmentBookings.$inferSelect;
export type InsertEquipmentBooking = z.infer<typeof insertEquipmentBookingSchema>;
export type UpdateEquipmentBooking = z.infer<typeof updateEquipmentBookingSchema>;
export type UpdateEquipmentBookingStatus = z.infer<typeof updateEquipmentBookingStatusSchema>;

// ===== PLATFORM SETTINGS TABLE =====

export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod validation schemas for platform settings
export const insertPlatformSettingSchema = createInsertSchema(platformSettings);
export const updatePlatformSettingSchema = z.object({
  value: z.string().optional(),
  description: z.string().optional(),
});

// Type exports for platform settings
export type PlatformSetting = typeof platformSettings.$inferSelect;
export type InsertPlatformSetting = z.infer<typeof insertPlatformSettingSchema>;
export type UpdatePlatformSetting = z.infer<typeof updatePlatformSettingSchema>;

// ===== CHEF KITCHEN APPLICATIONS TABLE (NEW) =====
// Direct application to kitchens - replaces "Share Profile" workflow
// Chefs can apply directly to kitchens without requiring platform application first

export const chefKitchenApplications = pgTable("chef_kitchen_applications", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),

  // Personal Info (collected per application)
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),

  // Business Info
  kitchenPreference: kitchenPreferenceEnum("kitchen_preference").notNull(),
  businessDescription: text("business_description"),
  cookingExperience: text("cooking_experience"),

  // Food Safety License
  foodSafetyLicense: certificationStatusEnum("food_safety_license").notNull(),
  foodSafetyLicenseUrl: text("food_safety_license_url"),
  foodSafetyLicenseStatus: documentVerificationStatusEnum("food_safety_license_status").default("pending"),
  foodSafetyLicenseExpiry: date("food_safety_license_expiry"),

  // Food Establishment Certificate (optional)
  foodEstablishmentCert: certificationStatusEnum("food_establishment_cert").notNull(),
  foodEstablishmentCertUrl: text("food_establishment_cert_url"),
  foodEstablishmentCertStatus: documentVerificationStatusEnum("food_establishment_cert_status").default("pending"),
  foodEstablishmentCertExpiry: date("food_establishment_cert_expiry"),

  // Application Status
  status: applicationStatusEnum("status").default("inReview").notNull(),
  feedback: text("feedback"),

  // Manager Review
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),

  // Tier Tracking
  current_tier: integer("current_tier").default(1).notNull(),
  tier1_completed_at: timestamp("tier1_completed_at"),
  tier2_completed_at: timestamp("tier2_completed_at"),
  tier3_submitted_at: timestamp("tier3_submitted_at"),
  tier4_completed_at: timestamp("tier4_completed_at"),
  government_license_number: text("government_license_number"),
  government_license_received_date: date("government_license_received_date"),
  government_license_expiry_date: date("government_license_expiry_date"),
  tier_data: jsonb("tier_data").default({}),
  chat_conversation_id: text("chat_conversation_id"),

  // Custom Fields Data (JSONB object storing values for custom fields)
  customFieldsData: jsonb("custom_fields_data").default({}), // { [fieldId]: value }

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas for chef kitchen applications
// Base schema - field requirements are validated in API based on location requirements
// This schema accepts the data structure, but individual field requirements are checked in the API endpoint
export const insertChefKitchenApplicationSchema = createInsertSchema(chefKitchenApplications, {
  chefId: z.number(),
  locationId: z.number(),
  fullName: z.string().min(1, "Name is required"), // Minimum validation, but requirement checked in API
  email: z.string().email("Please enter a valid email address"), // Email format validation, but requirement checked in API
  phone: z.string(), // Accept any string (including empty) - requirement and format validation happens in API
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  businessDescription: z.string().optional(),
  cookingExperience: z.string().optional(),
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]), // Requirement checked in API
  foodSafetyLicenseUrl: z.string().optional(),
  foodSafetyLicenseExpiry: z.string().optional(), // Requirement checked in API
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]).optional(), // Optional - defaults to "no" if not required
  foodEstablishmentCertUrl: z.string().optional(),
  foodEstablishmentCertExpiry: z.string().optional(), // Requirement checked in API
  customFieldsData: z.record(z.any()).optional(), // Custom fields data as JSON object
}).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  feedback: true,
  foodSafetyLicenseStatus: true,
  foodEstablishmentCertStatus: true,
});

export const updateChefKitchenApplicationSchema = z.object({
  id: z.number(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: phoneNumberSchema.optional(),
  kitchenPreference: z.enum(["commercial", "home", "notSure"]).optional(),
  businessDescription: z.string().optional(),
  cookingExperience: z.string().optional(),
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCertUrl: z.string().optional(),
});

export const updateChefKitchenApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["inReview", "approved", "rejected", "cancelled"]),
  feedback: z.string().optional(),
  current_tier: z.number().min(1).max(4).optional(),
  tier_data: z.record(z.any()).optional(),
});

export const updateApplicationTierSchema = z.object({
  id: z.number(),
  current_tier: z.number().min(1).max(4),
  tier_data: z.record(z.any()).optional(),
});

export const updateChefKitchenApplicationDocumentsSchema = z.object({
  id: z.number(),
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCertUrl: z.string().optional(),
  foodSafetyLicenseStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  foodEstablishmentCertStatus: z.enum(["pending", "approved", "rejected"]).optional(),
});

// Type exports for chef kitchen applications
export type ChefKitchenApplication = typeof chefKitchenApplications.$inferSelect;
export type InsertChefKitchenApplication = z.infer<typeof insertChefKitchenApplicationSchema>;
export type UpdateChefKitchenApplication = z.infer<typeof updateChefKitchenApplicationSchema>;
export type UpdateChefKitchenApplicationStatus = z.infer<typeof updateChefKitchenApplicationStatusSchema>;
export type UpdateChefKitchenApplicationDocuments = z.infer<typeof updateChefKitchenApplicationDocumentsSchema>;
export type UpdateApplicationTier = z.infer<typeof updateApplicationTierSchema>;

// ===== PAYMENT TRANSACTIONS TABLE =====
// Centralized table for tracking all payment transactions across booking types
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(), // References kitchen_bookings.id, storage_bookings.id, or equipment_bookings.id
  bookingType: bookingTypeEnum("booking_type").notNull(), // Which booking table this transaction belongs to
  chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }), // Chef who made the payment
  managerId: integer("manager_id").references(() => users.id, { onDelete: "set null" }), // Manager who receives the payment
  // Payment amounts (all in cents)
  amount: numeric("amount").notNull(), // Total transaction amount (includes service fee)
  baseAmount: numeric("base_amount").notNull(), // Base amount before service fee
  serviceFee: numeric("service_fee").notNull().default("0"), // Platform service fee
  managerRevenue: numeric("manager_revenue").notNull(), // Manager earnings (base_amount - service_fee)
  refundAmount: numeric("refund_amount").default("0"), // Total refunded amount
  netAmount: numeric("net_amount").notNull(), // Final amount after refunds (amount - refund_amount)
  currency: text("currency").notNull().default("CAD"),
  // Stripe integration
  paymentIntentId: text("payment_intent_id"), // Stripe PaymentIntent ID (nullable, unique when set)
  chargeId: text("charge_id"), // Stripe Charge ID
  refundId: text("refund_id"), // Stripe Refund ID
  paymentMethodId: text("payment_method_id"), // Stripe PaymentMethod ID
  // Status tracking
  status: transactionStatusEnum("status").notNull().default("pending"),
  stripeStatus: text("stripe_status"), // Raw Stripe status for comparison
  // Metadata and tracking
  metadata: jsonb("metadata").default({}), // Additional metadata
  refundReason: text("refund_reason"), // Reason for refund
  failureReason: text("failure_reason"), // Reason for payment failure
  webhookEventId: text("webhook_event_id"), // Stripe webhook event ID
  lastSyncedAt: timestamp("last_synced_at"), // Last time synced with Stripe
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"), // When payment was successfully captured
  refundedAt: timestamp("refunded_at"), // When refund was issued
});

// ===== PAYMENT HISTORY TABLE =====
// Audit trail for payment transaction status changes and events
export const paymentHistory = pgTable("payment_history", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => paymentTransactions.id, { onDelete: "cascade" }).notNull(),
  previousStatus: transactionStatusEnum("previous_status"),
  newStatus: transactionStatusEnum("new_status").notNull(),
  eventType: text("event_type").notNull(), // 'status_change', 'refund', 'webhook', 'manual_update', etc.
  eventSource: text("event_source"), // 'stripe_webhook', 'admin', 'system', 'sync', etc.
  stripeEventId: text("stripe_event_id"), // Stripe event ID if from webhook
  description: text("description"), // Human-readable description
  metadata: jsonb("metadata").default({}), // Additional event data
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }), // User who triggered the change
});

// Zod validation schemas for payment transactions
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions);
export const updatePaymentTransactionSchema = z.object({
  status: z.enum(['pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded']).optional(),
  stripeStatus: z.string().optional(),
  refundAmount: z.number().optional(),
  refundReason: z.string().optional(),
  failureReason: z.string().optional(),
  chargeId: z.string().optional(),
  refundId: z.string().optional(),
  paidAt: z.date().optional(),
  refundedAt: z.date().optional(),
  lastSyncedAt: z.date().optional(),
  metadata: z.record(z.any()).optional(),
});

// Type exports for payment transactions
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type UpdatePaymentTransaction = z.infer<typeof updatePaymentTransactionSchema>;
export type PaymentHistory = typeof paymentHistory.$inferSelect;