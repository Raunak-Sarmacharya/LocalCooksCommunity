import { pgTable, text, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define an enum for kitchen preference
export const kitchenPreferenceEnum = pgEnum('kitchen_preference', ['commercial', 'home', 'notSure']);

// Define an enum for yes/no/not sure options
export const certificationStatusEnum = pgEnum('certification_status', ['yes', 'no', 'notSure']);

// Define an enum for application status
export const applicationStatusEnum = pgEnum('application_status', ['new', 'inReview', 'approved', 'rejected', 'cancelled']);

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
  status: applicationStatusEnum("status").default("new").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Define the document verification table
export const documentVerifications = pgTable("document_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  foodSafetyLicenseUrl: text("food_safety_license_url"),
  foodEstablishmentCertUrl: text("food_establishment_cert_url"),
  foodSafetyLicenseStatus: documentVerificationStatusEnum("food_safety_license_status").default("pending"),
  foodEstablishmentCertStatus: documentVerificationStatusEnum("food_establishment_cert_status").default("pending"),
  adminFeedback: text("admin_feedback"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
}).omit({ id: true, status: true, createdAt: true });

// Define the Zod schema for updating the status of an application
export const updateApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["new", "inReview", "approved", "rejected", "cancelled"]),
});

// Define the Zod schema for document verification
export const insertDocumentVerificationSchema = createInsertSchema(documentVerifications, {
  userId: z.number(),
  foodSafetyLicenseUrl: z.string().url().optional(),
  foodEstablishmentCertUrl: z.string().url().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, foodSafetyLicenseStatus: true, foodEstablishmentCertStatus: true, reviewedBy: true, reviewedAt: true });

// Define the Zod schema for updating document verification status
export const updateDocumentVerificationSchema = z.object({
  id: z.number(),
  foodSafetyLicenseStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  foodEstablishmentCertStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  adminFeedback: z.string().optional(),
  reviewedBy: z.number(),
});

// Define the types
export type Application = typeof applications.$inferSelect;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type UpdateApplicationStatus = z.infer<typeof updateApplicationStatusSchema>;

export type DocumentVerification = typeof documentVerifications.$inferSelect;
export type InsertDocumentVerification = z.infer<typeof insertDocumentVerificationSchema>;
export type UpdateDocumentVerification = z.infer<typeof updateDocumentVerificationSchema>;

// Schema for inserting users
export const insertUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "applicant"]).default("applicant"),
  googleId: z.string().optional(),
  facebookId: z.string().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
