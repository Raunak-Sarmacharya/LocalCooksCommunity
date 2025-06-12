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
export const userRoleEnum = pgEnum('user_role', ['admin', 'applicant']);

// Define an enum for document verification status
export const documentVerificationStatusEnum = pgEnum('document_verification_status', ['pending', 'approved', 'rejected']);

// Define users table (for both admins and applicants)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").default("applicant").notNull(),
  googleId: text("google_id").unique(),
  facebookId: text("facebook_id").unique(),
  firebaseUid: text("firebase_uid").unique(),
  isVerified: boolean("is_verified").default(false).notNull(),
});

// Define the applications table
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
  role: z.enum(["admin", "applicant"]).default("applicant"),
  googleId: z.string().optional(),
  facebookId: z.string().optional(),
  firebaseUid: z.string().optional(),
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
