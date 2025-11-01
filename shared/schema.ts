import { boolean, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define an enum for kitchen preference
export const kitchenPreferenceEnum = pgEnum('kitchen_preference', ['commercial', 'home', 'notSure']);

// Define an enum for yes/no/not sure options
export const certificationStatusEnum = pgEnum('certification_status', ['yes', 'no', 'notSure']);

// Define an enum for application status
export const applicationStatusEnum = pgEnum('application_status', ['inReview', 'approved', 'rejected', 'cancelled']);

// Define an enum for user roles
export const userRoleEnum = pgEnum('user_role', ['admin', 'chef', 'delivery_partner', 'manager']);

// Define an enum for document verification status
export const documentVerificationStatusEnum = pgEnum('document_verification_status', ['pending', 'approved', 'rejected']);

// Define an enum for application types
export const applicationTypeEnum = pgEnum('application_type', ['chef', 'delivery_partner']);

// Define an enum for vehicle types (4-wheeled vehicles only)
export const vehicleTypeEnum = pgEnum('vehicle_type', ['car', 'suv', 'truck', 'van']);

// Define an enum for booking status
export const bookingStatusEnum = pgEnum('booking_status', ['pending', 'confirmed', 'cancelled']);

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
  // Support dual roles - users can be both chef and delivery partner
  isChef: boolean("is_chef").default(false).notNull(),
  isDeliveryPartner: boolean("is_delivery_partner").default(false).notNull(),
  isManager: boolean("is_manager").default(false).notNull(),
  applicationType: applicationTypeEnum("application_type"), // DEPRECATED: kept for backward compatibility
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

// Define the delivery partner applications table (NEW)
export const deliveryPartnerApplications = pgTable("delivery_partner_applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  province: text("province").notNull(),
  postalCode: text("postal_code").notNull(),
  
  // Vehicle details
  vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
  vehicleMake: text("vehicle_make").notNull(),
  vehicleModel: text("vehicle_model").notNull(),
  vehicleYear: integer("vehicle_year").notNull(),
  licensePlate: text("license_plate").notNull(),
  
  // Document uploads
  driversLicenseUrl: text("drivers_license_url"),
  vehicleRegistrationUrl: text("vehicle_registration_url"),
  insuranceUrl: text("insurance_url"),
  
  // Document verification status
  driversLicenseStatus: documentVerificationStatusEnum("drivers_license_status").default("pending"),
  vehicleRegistrationStatus: documentVerificationStatusEnum("vehicle_registration_status").default("pending"),
  insuranceStatus: documentVerificationStatusEnum("insurance_status").default("pending"),
  
  // Admin fields
  documentsAdminFeedback: text("documents_admin_feedback"),
  documentsReviewedBy: integer("documents_reviewed_by").references(() => users.id),
  documentsReviewedAt: timestamp("documents_reviewed_at"),
  
  feedback: text("feedback"),
  status: applicationStatusEnum("status").default("inReview").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Define the Zod schema for inserting an application
export const insertApplicationSchema = createInsertSchema(applications, {
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().regex(/^\+?[0-9\s\(\)-]{10,15}$/, "Please enter a valid phone number"),
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
  role: z.enum(["admin", "chef", "delivery_partner", "manager"]).default("chef"),
  googleId: z.string().optional(),
  facebookId: z.string().optional(),
  firebaseUid: z.string().optional(),
  isChef: z.boolean().default(false),
  isDeliveryPartner: z.boolean().default(false),
  isManager: z.boolean().default(false),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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

// Delivery Partner Application Schemas and Types
export const insertDeliveryPartnerApplicationSchema = createInsertSchema(deliveryPartnerApplications, {
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string()
    .min(13, "Phone numbers must be 10 digits")
    .regex(/^\+1\s[0-9\s\(\)\-\.]+$/, "Phone numbers must be 10 digits")
    .refine((val) => {
      const digitsOnly = val.replace(/\D/g, '');
      return digitsOnly.length === 11 && digitsOnly.startsWith('1');
    }, "Phone numbers must be 10 digits"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  city: z.string().min(2, "City must be at least 2 characters"),
  province: z.string().min(2, "Province must be at least 2 characters"),
  postalCode: z.string().regex(/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, "Please enter a valid Canadian postal code"),
  vehicleType: z.enum(["car", "suv", "truck", "van"]),
  vehicleMake: z.string().min(1, "Vehicle make is required"),
  vehicleModel: z.string().min(1, "Vehicle model is required"),
  vehicleYear: z.number().min(1900).max(new Date().getFullYear() + 1, "Please enter a valid vehicle year"),
  licensePlate: z.string().min(1, "License plate is required"),
  userId: z.number().optional(),
  // Document fields - insurance is required, others are optional during initial submission
  driversLicenseUrl: z.string().optional(),
  vehicleRegistrationUrl: z.string().optional(),
  insuranceUrl: z.string().min(1, "Vehicle insurance is required"),
}).omit({ 
  id: true, 
  status: true, 
  createdAt: true,
  documentsAdminFeedback: true,
  documentsReviewedBy: true,
  documentsReviewedAt: true,
  // Document status fields are managed by admin
  driversLicenseStatus: true,
  vehicleRegistrationStatus: true,
  insuranceStatus: true,
});

export const updateDeliveryPartnerApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["inReview", "approved", "rejected", "cancelled"]),
});

export const updateDeliveryPartnerDocumentsSchema = z.object({
  id: z.number(),
  driversLicenseUrl: z.string().optional(),
  vehicleRegistrationUrl: z.string().optional(),
  insuranceUrl: z.string().optional(),
  backgroundCheckUrl: z.string().optional(),
});

export const updateDeliveryPartnerDocumentVerificationSchema = z.object({
  id: z.number(),
  driversLicenseStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  vehicleRegistrationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  insuranceStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  backgroundCheckStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  documentsAdminFeedback: z.string().optional(),
  documentsReviewedBy: z.number().optional(),
});

// Update user schema to include application type
export const updateUserApplicationTypeSchema = z.object({
  userId: z.number(),
  applicationType: z.enum(["chef", "delivery_partner"]),
});

// Define delivery partner types
export type DeliveryPartnerApplication = typeof deliveryPartnerApplications.$inferSelect;
export type InsertDeliveryPartnerApplication = z.infer<typeof insertDeliveryPartnerApplicationSchema>;
export type UpdateDeliveryPartnerApplicationStatus = z.infer<typeof updateDeliveryPartnerApplicationStatusSchema>;
export type UpdateDeliveryPartnerDocuments = z.infer<typeof updateDeliveryPartnerDocumentsSchema>;
export type UpdateDeliveryPartnerDocumentVerification = z.infer<typeof updateDeliveryPartnerDocumentVerificationSchema>;
export type UpdateUserApplicationType = z.infer<typeof updateUserApplicationTypeSchema>;

// ===== KITCHEN BOOKING SYSTEM TABLES =====

// Define locations table
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  managerId: integer("manager_id").references(() => users.id),
  notificationEmail: text("notification_email"), // Email where notifications will be sent
  cancellationPolicyHours: integer("cancellation_policy_hours").default(24).notNull(),
  cancellationPolicyMessage: text("cancellation_policy_message").default("Bookings cannot be cancelled within {hours} hours of the scheduled time.").notNull(),
  defaultDailyBookingLimit: integer("default_daily_booking_limit").default(2).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define kitchens table
export const kitchens = pgTable("kitchens", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
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
  chefId: integer("chef_id").references(() => users.id).notNull(), // MUST match actual DB - NOT NULL
  kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
  bookingDate: timestamp("booking_date").notNull(),
  startTime: text("start_time").notNull(), // HH:MM format
  endTime: text("end_time").notNull(), // HH:MM format
  status: bookingStatusEnum("status").default("pending").notNull(),
  specialNotes: text("special_notes"),
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

// Zod schemas for kitchen booking system

export const insertLocationSchema = createInsertSchema(locations, {
  name: z.string().min(2, "Location name must be at least 2 characters"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  managerId: z.number().optional(),
  notificationEmail: z.string().email("Please enter a valid email address").optional(),
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
});

export const insertKitchenSchema = createInsertSchema(kitchens, {
  locationId: z.number(),
  name: z.string().min(1, "Kitchen name is required"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
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
