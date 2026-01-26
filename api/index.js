var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/firebase-setup.ts
var firebase_setup_exports = {};
__export(firebase_setup_exports, {
  firebaseAdmin: () => firebaseAdmin,
  initializeFirebaseAdmin: () => initializeFirebaseAdmin,
  isFirebaseAdminConfigured: () => isFirebaseAdminConfigured,
  verifyFirebaseToken: () => verifyFirebaseToken
});
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }
  try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log("\u{1F525} Initializing Firebase Admin with service account credentials...");
      try {
        firebaseAdmin = initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
          }),
          projectId: process.env.FIREBASE_PROJECT_ID
        });
        console.log("\u2705 Firebase Admin initialized with service account for project:", process.env.FIREBASE_PROJECT_ID);
        return firebaseAdmin;
      } catch (error) {
        console.error("\u274C Failed to initialize Firebase Admin with service account:", error.message);
      }
    }
    if (!process.env.VITE_FIREBASE_PROJECT_ID) {
      console.warn("Firebase Admin not configured - Firebase auth verification will be disabled (missing both service account and VITE_FIREBASE_PROJECT_ID)");
      return null;
    }
    try {
      firebaseAdmin = initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID
      });
      console.log("\u{1F525} Firebase Admin initialized with default credentials for project:", process.env.VITE_FIREBASE_PROJECT_ID);
    } catch (error) {
      console.log("\u{1F525} Firebase Admin initialization failed, will rely on client-side checks:", error.message || "Unknown error");
      return null;
    }
    return firebaseAdmin;
  } catch (error) {
    console.error("\u274C Failed to initialize Firebase Admin:", error);
    return null;
  }
}
async function verifyFirebaseToken(token) {
  try {
    const app2 = initializeFirebaseAdmin();
    if (!app2) {
      console.warn("Firebase Admin not initialized - cannot verify token");
      return null;
    }
    const decodedToken = await getAuth(app2).verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return null;
  }
}
function isFirebaseAdminConfigured() {
  return !!(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID);
}
var firebaseAdmin;
var init_firebase_setup = __esm({
  "server/firebase-setup.ts"() {
    "use strict";
    firebaseAdmin = null;
  }
});

// shared/phone-validation.ts
var phone_validation_exports = {};
__export(phone_validation_exports, {
  formatPhoneForDisplay: () => formatPhoneForDisplay,
  isValidNorthAmericanPhone: () => isValidNorthAmericanPhone,
  normalizePhoneNumber: () => normalizePhoneNumber,
  optionalPhoneNumberSchema: () => optionalPhoneNumberSchema,
  phoneNumberSchema: () => phoneNumberSchema,
  validateAndNormalizePhone: () => validateAndNormalizePhone
});
import { z } from "zod";
var normalizePhoneNumber, isValidNorthAmericanPhone, formatPhoneForDisplay, phoneNumberSchema, optionalPhoneNumberSchema, validateAndNormalizePhone;
var init_phone_validation = __esm({
  "shared/phone-validation.ts"() {
    "use strict";
    normalizePhoneNumber = (phone) => {
      if (!phone) return null;
      const trimmed = phone.trim();
      if (!trimmed) return null;
      const cleaned = trimmed.replace(/[^\d+]/g, "");
      if (cleaned.startsWith("+")) {
        const digitsAfterPlus = cleaned.substring(1);
        if (digitsAfterPlus.length >= 1 && digitsAfterPlus.length <= 15 && /^\d+$/.test(digitsAfterPlus)) {
          if (digitsAfterPlus.startsWith("1") && digitsAfterPlus.length === 11) {
            return cleaned;
          }
          if (digitsAfterPlus.length === 10) {
            return `+1${digitsAfterPlus}`;
          }
          return null;
        }
        return null;
      }
      const digitsOnly = cleaned.replace(/\D/g, "");
      if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
        return `+${digitsOnly}`;
      }
      if (digitsOnly.length === 10) {
        return `+1${digitsOnly}`;
      }
      return null;
    };
    isValidNorthAmericanPhone = (phone) => {
      if (!phone) return false;
      let normalized;
      if (phone.startsWith("+1") && phone.length === 12) {
        normalized = phone;
      } else {
        normalized = normalizePhoneNumber(phone);
      }
      if (!normalized) return false;
      if (!normalized.startsWith("+1") || normalized.length !== 12) {
        return false;
      }
      const digits = normalized.substring(2);
      if (digits.length !== 10 || !/^\d{10}$/.test(digits)) {
        return false;
      }
      const areaCodeFirstDigit = parseInt(digits[0]);
      if (areaCodeFirstDigit < 2 || areaCodeFirstDigit > 9) return false;
      const exchangeCodeFirstDigit = parseInt(digits[3]);
      if (exchangeCodeFirstDigit < 2 || exchangeCodeFirstDigit > 9) return false;
      return true;
    };
    formatPhoneForDisplay = (phone) => {
      const normalized = normalizePhoneNumber(phone);
      if (!normalized) return phone || "";
      if (normalized.startsWith("+1") && normalized.length === 12) {
        const digits = normalized.substring(2);
        return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
      }
      return normalized;
    };
    phoneNumberSchema = z.string().min(1, "Phone number is required").refine(
      (val) => {
        const normalized = normalizePhoneNumber(val);
        return normalized !== null && isValidNorthAmericanPhone(normalized);
      },
      {
        message: "Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
      }
    ).transform((val) => {
      const normalized = normalizePhoneNumber(val);
      return normalized || val;
    });
    optionalPhoneNumberSchema = z.string().optional().refine(
      (val) => {
        if (!val || val.trim() === "") return true;
        const normalized = normalizePhoneNumber(val);
        return normalized !== null && isValidNorthAmericanPhone(normalized);
      },
      {
        message: "Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
      }
    ).transform((val) => {
      if (!val || val.trim() === "") return null;
      const normalized = normalizePhoneNumber(val);
      return normalized || val;
    });
    validateAndNormalizePhone = (phone) => {
      if (!phone) return null;
      return normalizePhoneNumber(phone);
    };
  }
});

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  applicationStatusEnum: () => applicationStatusEnum,
  applicationTypeEnum: () => applicationTypeEnum,
  applications: () => applications,
  bookingDurationUnitEnum: () => bookingDurationUnitEnum,
  bookingStatusEnum: () => bookingStatusEnum,
  bookingTypeEnum: () => bookingTypeEnum,
  certificationStatusEnum: () => certificationStatusEnum,
  chefKitchenAccess: () => chefKitchenAccess,
  chefKitchenApplications: () => chefKitchenApplications,
  chefKitchenProfiles: () => chefKitchenProfiles,
  chefLocationAccess: () => chefLocationAccess,
  chefLocationProfiles: () => chefLocationProfiles,
  customFieldSchema: () => customFieldSchema,
  documentVerificationStatusEnum: () => documentVerificationStatusEnum,
  emailVerificationTokens: () => emailVerificationTokens,
  equipmentAvailabilityTypeEnum: () => equipmentAvailabilityTypeEnum,
  equipmentBookings: () => equipmentBookings,
  equipmentCategoryEnum: () => equipmentCategoryEnum,
  equipmentConditionEnum: () => equipmentConditionEnum,
  equipmentListings: () => equipmentListings,
  equipmentPricingModelEnum: () => equipmentPricingModelEnum,
  insertApplicationSchema: () => insertApplicationSchema,
  insertChefKitchenAccessSchema: () => insertChefKitchenAccessSchema,
  insertChefKitchenApplicationSchema: () => insertChefKitchenApplicationSchema,
  insertChefKitchenProfileSchema: () => insertChefKitchenProfileSchema,
  insertChefLocationAccessSchema: () => insertChefLocationAccessSchema,
  insertChefLocationProfileSchema: () => insertChefLocationProfileSchema,
  insertEquipmentBookingSchema: () => insertEquipmentBookingSchema,
  insertEquipmentListingSchema: () => insertEquipmentListingSchema,
  insertKitchenAvailabilitySchema: () => insertKitchenAvailabilitySchema,
  insertKitchenBookingSchema: () => insertKitchenBookingSchema,
  insertKitchenDateOverrideSchema: () => insertKitchenDateOverrideSchema,
  insertKitchenSchema: () => insertKitchenSchema,
  insertLocationRequirementsSchema: () => insertLocationRequirementsSchema,
  insertLocationSchema: () => insertLocationSchema,
  insertMicrolearningCompletionSchema: () => insertMicrolearningCompletionSchema,
  insertPaymentTransactionSchema: () => insertPaymentTransactionSchema,
  insertPlatformSettingSchema: () => insertPlatformSettingSchema,
  insertPortalUserApplicationSchema: () => insertPortalUserApplicationSchema,
  insertPortalUserLocationAccessSchema: () => insertPortalUserLocationAccessSchema,
  insertStorageBookingSchema: () => insertStorageBookingSchema,
  insertStorageListingSchema: () => insertStorageListingSchema,
  insertUserSchema: () => insertUserSchema,
  insertVideoProgressSchema: () => insertVideoProgressSchema,
  kitchenAvailability: () => kitchenAvailability,
  kitchenBookings: () => kitchenBookings,
  kitchenDateOverrides: () => kitchenDateOverrides,
  kitchenPreferenceEnum: () => kitchenPreferenceEnum,
  kitchens: () => kitchens,
  listingStatusEnum: () => listingStatusEnum,
  locationRequirements: () => locationRequirements,
  locations: () => locations,
  microlearningCompletions: () => microlearningCompletions,
  paymentHistory: () => paymentHistory,
  paymentStatusEnum: () => paymentStatusEnum,
  paymentTransactions: () => paymentTransactions,
  platformSettings: () => platformSettings,
  portalUserApplications: () => portalUserApplications,
  portalUserLocationAccess: () => portalUserLocationAccess,
  storageBookings: () => storageBookings,
  storageListings: () => storageListings,
  storagePricingModelEnum: () => storagePricingModelEnum,
  storageTypeEnum: () => storageTypeEnum,
  transactionStatusEnum: () => transactionStatusEnum,
  updateApplicationDocumentsSchema: () => updateApplicationDocumentsSchema,
  updateApplicationStatusSchema: () => updateApplicationStatusSchema,
  updateApplicationTierSchema: () => updateApplicationTierSchema,
  updateChefKitchenApplicationDocumentsSchema: () => updateChefKitchenApplicationDocumentsSchema,
  updateChefKitchenApplicationSchema: () => updateChefKitchenApplicationSchema,
  updateChefKitchenApplicationStatusSchema: () => updateChefKitchenApplicationStatusSchema,
  updateChefKitchenProfileSchema: () => updateChefKitchenProfileSchema,
  updateChefLocationProfileSchema: () => updateChefLocationProfileSchema,
  updateDocumentVerificationSchema: () => updateDocumentVerificationSchema,
  updateEquipmentBookingSchema: () => updateEquipmentBookingSchema,
  updateEquipmentBookingStatusSchema: () => updateEquipmentBookingStatusSchema,
  updateEquipmentListingSchema: () => updateEquipmentListingSchema,
  updateEquipmentListingStatusSchema: () => updateEquipmentListingStatusSchema,
  updateKitchenBookingSchema: () => updateKitchenBookingSchema,
  updateKitchenDateOverrideSchema: () => updateKitchenDateOverrideSchema,
  updateKitchenSchema: () => updateKitchenSchema,
  updateLocationRequirementsSchema: () => updateLocationRequirementsSchema,
  updateLocationSchema: () => updateLocationSchema,
  updatePaymentTransactionSchema: () => updatePaymentTransactionSchema,
  updatePlatformSettingSchema: () => updatePlatformSettingSchema,
  updatePortalUserApplicationStatusSchema: () => updatePortalUserApplicationStatusSchema,
  updateStorageBookingSchema: () => updateStorageBookingSchema,
  updateStorageBookingStatusSchema: () => updateStorageBookingStatusSchema,
  updateStorageListingSchema: () => updateStorageListingSchema,
  updateStorageListingStatusSchema: () => updateStorageListingStatusSchema,
  userRoleEnum: () => userRoleEnum,
  users: () => users,
  videoProgress: () => videoProgress
});
import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z as z2 } from "zod";
var kitchenPreferenceEnum, certificationStatusEnum, applicationStatusEnum, userRoleEnum, documentVerificationStatusEnum, applicationTypeEnum, bookingStatusEnum, storageTypeEnum, storagePricingModelEnum, bookingDurationUnitEnum, listingStatusEnum, equipmentCategoryEnum, equipmentConditionEnum, equipmentPricingModelEnum, equipmentAvailabilityTypeEnum, paymentStatusEnum, transactionStatusEnum, bookingTypeEnum, users, applications, insertApplicationSchema, updateApplicationStatusSchema, updateApplicationDocumentsSchema, updateDocumentVerificationSchema, insertUserSchema, emailVerificationTokens, microlearningCompletions, videoProgress, insertMicrolearningCompletionSchema, insertVideoProgressSchema, locations, locationRequirements, kitchens, kitchenAvailability, kitchenDateOverrides, kitchenBookings, chefLocationAccess, chefKitchenAccess, chefKitchenProfiles, chefLocationProfiles, portalUserApplications, portalUserLocationAccess, insertLocationSchema, updateLocationSchema, insertLocationRequirementsSchema, customFieldSchema, updateLocationRequirementsSchema, insertKitchenSchema, updateKitchenSchema, insertKitchenAvailabilitySchema, insertKitchenDateOverrideSchema, updateKitchenDateOverrideSchema, insertKitchenBookingSchema, updateKitchenBookingSchema, insertChefLocationAccessSchema, insertChefKitchenAccessSchema, insertChefKitchenProfileSchema, updateChefKitchenProfileSchema, insertChefLocationProfileSchema, updateChefLocationProfileSchema, insertPortalUserApplicationSchema, updatePortalUserApplicationStatusSchema, insertPortalUserLocationAccessSchema, storageListings, insertStorageListingSchema, updateStorageListingSchema, updateStorageListingStatusSchema, equipmentListings, insertEquipmentListingSchema, updateEquipmentListingSchema, updateEquipmentListingStatusSchema, storageBookings, insertStorageBookingSchema, updateStorageBookingSchema, updateStorageBookingStatusSchema, equipmentBookings, insertEquipmentBookingSchema, updateEquipmentBookingSchema, updateEquipmentBookingStatusSchema, platformSettings, insertPlatformSettingSchema, updatePlatformSettingSchema, chefKitchenApplications, insertChefKitchenApplicationSchema, updateChefKitchenApplicationSchema, updateChefKitchenApplicationStatusSchema, updateApplicationTierSchema, updateChefKitchenApplicationDocumentsSchema, paymentTransactions, paymentHistory, insertPaymentTransactionSchema, updatePaymentTransactionSchema;
var init_schema = __esm({
  "shared/schema.ts"() {
    "use strict";
    init_phone_validation();
    kitchenPreferenceEnum = pgEnum("kitchen_preference", ["commercial", "home", "notSure"]);
    certificationStatusEnum = pgEnum("certification_status", ["yes", "no", "notSure"]);
    applicationStatusEnum = pgEnum("application_status", ["inReview", "approved", "rejected", "cancelled"]);
    userRoleEnum = pgEnum("user_role", ["admin", "chef", "manager"]);
    documentVerificationStatusEnum = pgEnum("document_verification_status", ["pending", "approved", "rejected", "expired"]);
    applicationTypeEnum = pgEnum("application_type", ["chef"]);
    bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "cancelled"]);
    storageTypeEnum = pgEnum("storage_type", ["dry", "cold", "freezer"]);
    storagePricingModelEnum = pgEnum("storage_pricing_model", ["monthly-flat", "per-cubic-foot", "hourly", "daily"]);
    bookingDurationUnitEnum = pgEnum("booking_duration_unit", ["hourly", "daily", "monthly"]);
    listingStatusEnum = pgEnum("listing_status", ["draft", "pending", "approved", "rejected", "active", "inactive"]);
    equipmentCategoryEnum = pgEnum("equipment_category", ["food-prep", "cooking", "refrigeration", "cleaning", "specialty"]);
    equipmentConditionEnum = pgEnum("equipment_condition", ["excellent", "good", "fair", "needs-repair"]);
    equipmentPricingModelEnum = pgEnum("equipment_pricing_model", ["hourly", "daily", "weekly", "monthly"]);
    equipmentAvailabilityTypeEnum = pgEnum("equipment_availability_type", ["included", "rental"]);
    paymentStatusEnum = pgEnum("payment_status", ["pending", "paid", "refunded", "failed", "partially_refunded"]);
    transactionStatusEnum = pgEnum("transaction_status", ["pending", "processing", "succeeded", "failed", "canceled", "refunded", "partially_refunded"]);
    bookingTypeEnum = pgEnum("booking_type_enum", ["kitchen", "storage", "equipment", "bundle"]);
    users = pgTable("users", {
      id: serial("id").primaryKey(),
      username: text("username").notNull().unique(),
      password: text("password").notNull(),
      role: userRoleEnum("role"),
      // Allow null initially - user will choose role
      googleId: text("google_id").unique(),
      facebookId: text("facebook_id").unique(),
      firebaseUid: text("firebase_uid").unique(),
      isVerified: boolean("is_verified").default(false).notNull(),
      has_seen_welcome: boolean("has_seen_welcome").default(false).notNull(),
      // Support dual roles - users can be both chef and manager
      isChef: boolean("is_chef").default(false).notNull(),
      isManager: boolean("is_manager").default(false).notNull(),
      isPortalUser: boolean("is_portal_user").default(false).notNull(),
      applicationType: applicationTypeEnum("application_type"),
      // DEPRECATED: kept for backward compatibility
      // Manager onboarding fields
      managerOnboardingCompleted: boolean("manager_onboarding_completed").default(false).notNull(),
      // Whether manager completed onboarding
      managerOnboardingSkipped: boolean("manager_onboarding_skipped").default(false).notNull(),
      // Whether manager skipped onboarding
      managerOnboardingStepsCompleted: jsonb("manager_onboarding_steps_completed").default({}).notNull(),
      // JSON object tracking completed onboarding steps
      // Manager profile data (bespoke fields)
      managerProfileData: jsonb("manager_profile_data").default({}).notNull(),
      // Stripe Connect fields for manager payments
      stripeConnectAccountId: text("stripe_connect_account_id").unique(),
      // Stripe Connect Express account ID
      stripeConnectOnboardingStatus: text("stripe_connect_onboarding_status").default("not_started").notNull(),
      // Status: 'not_started', 'in_progress', 'complete', 'failed'
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    applications = pgTable("applications", {
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
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    insertApplicationSchema = createInsertSchema(applications, {
      fullName: z2.string().min(2, "Name must be at least 2 characters"),
      email: z2.string().email("Please enter a valid email address"),
      phone: phoneNumberSchema,
      // Uses shared phone validation
      foodSafetyLicense: z2.enum(["yes", "no", "notSure"]),
      foodEstablishmentCert: z2.enum(["yes", "no", "notSure"]),
      kitchenPreference: z2.enum(["commercial", "home", "notSure"]),
      feedback: z2.string().optional(),
      userId: z2.number().optional(),
      // Document fields are optional during initial application submission
      foodSafetyLicenseUrl: z2.string().optional(),
      foodEstablishmentCertUrl: z2.string().optional(),
      // Allow setting document status during creation
      foodSafetyLicenseStatus: z2.enum(["pending", "approved", "rejected"]).optional(),
      foodEstablishmentCertStatus: z2.enum(["pending", "approved", "rejected"]).optional()
    }).omit({
      id: true,
      status: true,
      createdAt: true,
      documentsAdminFeedback: true,
      documentsReviewedBy: true,
      documentsReviewedAt: true
    });
    updateApplicationStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["inReview", "approved", "rejected", "cancelled"])
    });
    updateApplicationDocumentsSchema = z2.object({
      id: z2.number(),
      foodSafetyLicenseUrl: z2.string().optional(),
      foodEstablishmentCertUrl: z2.string().optional()
    });
    updateDocumentVerificationSchema = z2.object({
      id: z2.number(),
      foodSafetyLicenseStatus: z2.enum(["pending", "approved", "rejected"]).optional(),
      foodEstablishmentCertStatus: z2.enum(["pending", "approved", "rejected"]).optional(),
      documentsAdminFeedback: z2.string().optional(),
      documentsReviewedBy: z2.number().optional()
    });
    insertUserSchema = z2.object({
      username: z2.string().min(3, "Username must be at least 3 characters"),
      password: z2.string().min(6, "Password must be at least 6 characters"),
      role: z2.enum(["admin", "chef", "manager"]).default("chef"),
      googleId: z2.string().optional(),
      facebookId: z2.string().optional(),
      firebaseUid: z2.string().optional(),
      isChef: z2.boolean().default(false),
      isManager: z2.boolean().default(false),
      isPortalUser: z2.boolean().default(false),
      managerProfileData: z2.record(z2.any()).default({})
    });
    emailVerificationTokens = pgTable("email_verification_tokens", {
      id: serial("id").primaryKey(),
      email: text("email").notNull().unique(),
      token: text("token").notNull(),
      expiresAt: timestamp("expires_at").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    microlearningCompletions = pgTable("microlearning_completions", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").references(() => users.id).notNull(),
      completedAt: timestamp("completed_at").defaultNow().notNull(),
      confirmed: boolean("confirmed").default(false).notNull(),
      certificateGenerated: boolean("certificate_generated").default(false).notNull(),
      videoProgress: jsonb("video_progress"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    videoProgress = pgTable("video_progress", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").references(() => users.id).notNull(),
      videoId: text("video_id").notNull(),
      progress: numeric("progress", { precision: 5, scale: 2 }).default("0").notNull(),
      completed: boolean("completed").default(false).notNull(),
      completedAt: timestamp("completed_at"),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      watchedPercentage: numeric("watched_percentage", { precision: 5, scale: 2 }).default("0").notNull(),
      isRewatching: boolean("is_rewatching").default(false).notNull()
    });
    insertMicrolearningCompletionSchema = createInsertSchema(microlearningCompletions, {
      userId: z2.number(),
      confirmed: z2.boolean().optional(),
      certificateGenerated: z2.boolean().optional(),
      videoProgress: z2.any().optional()
    }).omit({
      id: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true
    });
    insertVideoProgressSchema = createInsertSchema(videoProgress, {
      userId: z2.number(),
      videoId: z2.string().min(1, "Video ID is required"),
      progress: z2.number().min(0).max(100).optional(),
      completed: z2.boolean().optional(),
      watchedPercentage: z2.number().min(0).max(100).optional(),
      isRewatching: z2.boolean().optional()
    }).omit({
      id: true,
      completedAt: true,
      updatedAt: true
    });
    locations = pgTable("locations", {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      address: text("address").notNull(),
      managerId: integer("manager_id").references(() => users.id),
      notificationEmail: text("notification_email"),
      // Email where notifications will be sent
      notificationPhone: text("notification_phone"),
      // Phone number where SMS notifications will be sent
      cancellationPolicyHours: integer("cancellation_policy_hours").default(24).notNull(),
      cancellationPolicyMessage: text("cancellation_policy_message").default("Bookings cannot be cancelled within {hours} hours of the scheduled time.").notNull(),
      defaultDailyBookingLimit: integer("default_daily_booking_limit").default(2).notNull(),
      minimumBookingWindowHours: integer("minimum_booking_window_hours").default(1).notNull(),
      logoUrl: text("logo_url"),
      // Logo URL for the location (for manager header)
      brandImageUrl: text("brand_image_url"),
      // Brand image URL for the location (displayed on public kitchen listings)
      timezone: text("timezone").default("America/St_Johns").notNull(),
      // Timezone for this location (default: Newfoundland)
      // Kitchen license fields for manager onboarding
      kitchenLicenseUrl: text("kitchen_license_url"),
      // URL to uploaded kitchen license document
      kitchenLicenseStatus: text("kitchen_license_status").default("pending"),
      // pending, approved, rejected
      kitchenLicenseApprovedBy: integer("kitchen_license_approved_by").references(() => users.id),
      // Admin who approved/rejected
      kitchenLicenseApprovedAt: timestamp("kitchen_license_approved_at"),
      // When license was approved/rejected
      kitchenLicenseFeedback: text("kitchen_license_feedback"),
      // Admin feedback on license
      kitchenLicenseExpiry: date("kitchen_license_expiry"),
      // Expiration date of the kitchen license
      description: text("description"),
      // Description of the location
      customOnboardingLink: text("custom_onboarding_link"),
      // Custom link for onboarding
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    locationRequirements = pgTable("location_requirements", {
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
      equipment_list: jsonb("equipment_list").default([]),
      // Array of equipment names
      materials_description: text("materials_description"),
      // Custom Fields (JSONB array of field definitions)
      customFields: jsonb("custom_fields").default([]),
      // Array of { id, label, type, required, options?, placeholder? }
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    kitchens = pgTable("kitchens", {
      id: serial("id").primaryKey(),
      locationId: integer("location_id").references(() => locations.id).notNull(),
      name: text("name").notNull(),
      description: text("description"),
      imageUrl: text("image_url"),
      // Image URL for the kitchen (displayed on public kitchen listings)
      galleryImages: jsonb("gallery_images").default([]),
      // Array of image URLs for kitchen gallery carousel
      amenities: jsonb("amenities").default([]),
      // Array of amenities/features for the kitchen
      isActive: boolean("is_active").default(true).notNull(),
      // Pricing fields (all prices stored as integers in cents to avoid floating-point precision issues)
      hourlyRate: numeric("hourly_rate"),
      // Base hourly rate in cents (e.g., 5000 = $50.00/hour)
      currency: text("currency").default("CAD").notNull(),
      // Currency code (ISO 4217)
      minimumBookingHours: integer("minimum_booking_hours").default(1).notNull(),
      // Minimum booking duration
      pricingModel: text("pricing_model").default("hourly").notNull(),
      // Pricing structure ('hourly', 'daily', 'weekly')
      taxRatePercent: numeric("tax_rate_percent"),
      // Optional tax percentage (e.g., 13 for 13%)
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    kitchenAvailability = pgTable("kitchen_availability", {
      id: serial("id").primaryKey(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
      dayOfWeek: integer("day_of_week").notNull(),
      // 0-6, Sunday is 0
      startTime: text("start_time").notNull(),
      // HH:MM format
      endTime: text("end_time").notNull(),
      // HH:MM format
      isAvailable: boolean("is_available").default(true).notNull()
    });
    kitchenDateOverrides = pgTable("kitchen_date_overrides", {
      id: serial("id").primaryKey(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
      specificDate: timestamp("specific_date").notNull(),
      // Specific date for override
      startTime: text("start_time"),
      // HH:MM format, null if closed all day
      endTime: text("end_time"),
      // HH:MM format, null if closed all day
      isAvailable: boolean("is_available").default(false).notNull(),
      // false = closed, true = custom hours
      reason: text("reason"),
      // Optional reason (e.g., "Holiday", "Maintenance")
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    kitchenBookings = pgTable("kitchen_bookings", {
      id: serial("id").primaryKey(),
      chefId: integer("chef_id").references(() => users.id),
      // Nullable for external/third-party bookings
      kitchenId: integer("kitchen_id").references(() => kitchens.id).notNull(),
      bookingDate: timestamp("booking_date").notNull(),
      startTime: text("start_time").notNull(),
      // HH:MM format
      endTime: text("end_time").notNull(),
      // HH:MM format
      status: bookingStatusEnum("status").default("pending").notNull(),
      specialNotes: text("special_notes"),
      bookingType: text("booking_type").default("chef").notNull(),
      // 'chef', 'external', 'manager_blocked'
      createdBy: integer("created_by").references(() => users.id),
      // Manager who created the booking (for external/manual bookings)
      externalContactName: text("external_contact_name"),
      // For third-party bookings
      externalContactEmail: text("external_contact_email"),
      // For third-party bookings
      externalContactPhone: text("external_contact_phone"),
      // For third-party bookings
      externalContactCompany: text("external_contact_company"),
      // For third-party bookings
      // Pricing fields (all prices stored as integers in cents)
      totalPrice: numeric("total_price"),
      // Total booking price in cents
      hourlyRate: numeric("hourly_rate"),
      // Rate used for this booking (in cents)
      durationHours: numeric("duration_hours"),
      // Calculated duration (decimal for partial hours)
      storageItems: jsonb("storage_items").default([]),
      // Array of storage booking IDs: [{storageBookingId: 1, storageListingId: 5}]
      equipmentItems: jsonb("equipment_items").default([]),
      // Array of equipment booking IDs: [{equipmentBookingId: 2, equipmentListingId: 8}]
      paymentStatus: paymentStatusEnum("payment_status").default("pending"),
      // Payment status
      paymentIntentId: text("payment_intent_id"),
      // Stripe PaymentIntent ID (nullable, unique)
      damageDeposit: numeric("damage_deposit").default("0"),
      // Damage deposit amount (in cents)
      serviceFee: numeric("service_fee").default("0"),
      // Platform commission (in cents)
      currency: text("currency").default("CAD").notNull(),
      // Currency code
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    chefLocationAccess = pgTable("chef_location_access", {
      id: serial("id").primaryKey(),
      chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
      grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
      // admin who granted access
      grantedAt: timestamp("granted_at").defaultNow().notNull()
    });
    chefKitchenAccess = pgTable("chef_kitchen_access", {
      id: serial("id").primaryKey(),
      chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
      grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
      grantedAt: timestamp("granted_at").defaultNow().notNull()
    });
    chefKitchenProfiles = pgTable("chef_kitchen_profiles", {
      id: serial("id").primaryKey(),
      chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
      status: text("status").default("pending").notNull(),
      // 'pending', 'approved', 'rejected'
      sharedAt: timestamp("shared_at").defaultNow().notNull(),
      reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
      // manager who reviewed
      reviewedAt: timestamp("reviewed_at"),
      reviewFeedback: text("review_feedback")
      // optional feedback from manager
    });
    chefLocationProfiles = pgTable("chef_location_profiles", {
      id: serial("id").primaryKey(),
      chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
      status: text("status").default("pending").notNull(),
      // 'pending', 'approved', 'rejected'
      sharedAt: timestamp("shared_at").defaultNow().notNull(),
      reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
      // manager who reviewed
      reviewedAt: timestamp("reviewed_at"),
      reviewFeedback: text("review_feedback")
      // optional feedback from manager
    });
    portalUserApplications = pgTable("portal_user_applications", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
      fullName: text("full_name").notNull(),
      email: text("email").notNull(),
      phone: text("phone").notNull(),
      company: text("company"),
      // Optional company name
      status: applicationStatusEnum("status").default("inReview").notNull(),
      // 'inReview', 'approved', 'rejected', 'cancelled'
      feedback: text("feedback"),
      // Manager feedback
      reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
      // manager who reviewed
      reviewedAt: timestamp("reviewed_at"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    portalUserLocationAccess = pgTable("portal_user_location_access", {
      id: serial("id").primaryKey(),
      portalUserId: integer("portal_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
      locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
      grantedBy: integer("granted_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
      // manager who granted access
      grantedAt: timestamp("granted_at").defaultNow().notNull(),
      applicationId: integer("application_id").references(() => portalUserApplications.id, { onDelete: "set null" })
      // Link to original application
    });
    insertLocationSchema = createInsertSchema(locations, {
      name: z2.string().min(2, "Location name must be at least 2 characters"),
      address: z2.string().min(5, "Address must be at least 5 characters"),
      managerId: z2.number().optional(),
      notificationEmail: z2.string().email("Please enter a valid email address").optional(),
      notificationPhone: optionalPhoneNumberSchema,
      // Optional phone for SMS notifications
      description: z2.string().optional(),
      customOnboardingLink: z2.string().optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    updateLocationSchema = z2.object({
      id: z2.number(),
      name: z2.string().min(2).optional(),
      address: z2.string().min(5).optional(),
      managerId: z2.number().optional(),
      notificationEmail: z2.string().email("Please enter a valid email address").optional(),
      notificationPhone: optionalPhoneNumberSchema,
      // Optional phone for SMS notifications
      description: z2.string().optional(),
      customOnboardingLink: z2.string().optional()
    });
    insertLocationRequirementsSchema = createInsertSchema(locationRequirements, {
      locationId: z2.number()
    }).omit({ id: true, createdAt: true, updatedAt: true });
    customFieldSchema = z2.object({
      id: z2.string(),
      // Unique identifier for the field
      label: z2.string().min(1, "Label is required"),
      type: z2.enum(["text", "textarea", "number", "select", "checkbox", "date", "file", "cloudflare_upload"]),
      required: z2.boolean().default(false),
      placeholder: z2.string().optional(),
      options: z2.array(z2.string()).optional(),
      // For select fields
      tier: z2.number().min(1).max(3)
      // Tier assignment for the field
    });
    updateLocationRequirementsSchema = z2.object({
      requireFirstName: z2.boolean().optional(),
      requireLastName: z2.boolean().optional(),
      requireEmail: z2.boolean().optional(),
      requirePhone: z2.boolean().optional(),
      requireBusinessName: z2.boolean().optional(),
      requireBusinessType: z2.boolean().optional(),
      requireExperience: z2.boolean().optional(),
      requireBusinessDescription: z2.boolean().optional(),
      requireFoodHandlerCert: z2.boolean().optional(),
      requireFoodHandlerExpiry: z2.boolean().optional(),
      requireUsageFrequency: z2.boolean().optional(),
      requireSessionDuration: z2.boolean().optional(),
      requireTermsAgree: z2.boolean().optional(),
      requireAccuracyAgree: z2.boolean().optional(),
      customFields: z2.array(customFieldSchema).optional(),
      // Tier 1 Requirements
      tier1_years_experience_required: z2.boolean().optional(),
      tier1_years_experience_minimum: z2.number().int().min(0).optional(),
      tier1_custom_fields: z2.array(customFieldSchema).optional().default([]),
      // Tier 2 Requirements
      tier2_food_establishment_cert_required: z2.boolean().optional(),
      tier2_food_establishment_expiry_required: z2.boolean().optional(),
      tier2_insurance_document_required: z2.boolean().optional(),
      tier2_insurance_minimum_amount: z2.number().int().min(0).optional(),
      tier2_kitchen_experience_required: z2.boolean().optional(),
      tier2_allergen_plan_required: z2.boolean().optional(),
      tier2_supplier_list_required: z2.boolean().optional(),
      tier2_quality_control_required: z2.boolean().optional(),
      tier2_traceability_system_required: z2.boolean().optional(),
      tier2_custom_fields: z2.array(customFieldSchema).optional().default([]),
      // Facility Information
      floor_plans_url: z2.union([
        z2.null(),
        z2.literal(""),
        z2.string().url(),
        z2.string()
      ]).optional(),
      ventilation_specs: z2.union([
        z2.string(),
        z2.literal(""),
        z2.null()
      ]).optional(),
      ventilation_specs_url: z2.union([
        z2.null(),
        z2.literal(""),
        z2.string().url(),
        z2.string()
      ]).optional(),
      equipment_list: z2.array(z2.string()).optional(),
      materials_description: z2.string().optional()
    });
    insertKitchenSchema = createInsertSchema(kitchens, {
      locationId: z2.number(),
      name: z2.string().min(1, "Kitchen name is required"),
      description: z2.string().optional(),
      isActive: z2.boolean().optional(),
      hourlyRate: z2.number().int().positive("Hourly rate must be positive").optional(),
      currency: z2.string().min(3).max(3).optional(),
      minimumBookingHours: z2.number().int().positive("Minimum booking hours must be positive").optional(),
      pricingModel: z2.enum(["hourly", "daily", "weekly"]).optional(),
      taxRatePercent: z2.number().min(0).max(100).nullable().optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    updateKitchenSchema = z2.object({
      id: z2.number(),
      name: z2.string().min(1).optional(),
      description: z2.string().optional(),
      isActive: z2.boolean().optional(),
      hourlyRate: z2.number().int().positive("Hourly rate must be positive").optional(),
      currency: z2.string().min(3).max(3).optional(),
      minimumBookingHours: z2.number().int().positive("Minimum booking hours must be positive").optional(),
      pricingModel: z2.enum(["hourly", "daily", "weekly"]).optional(),
      taxRatePercent: z2.number().min(0).max(100).nullable().optional()
    });
    insertKitchenAvailabilitySchema = createInsertSchema(kitchenAvailability, {
      kitchenId: z2.number(),
      dayOfWeek: z2.number().min(0).max(6),
      startTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      endTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      isAvailable: z2.boolean().optional()
    }).omit({
      id: true
    });
    insertKitchenDateOverrideSchema = createInsertSchema(kitchenDateOverrides, {
      kitchenId: z2.number(),
      specificDate: z2.string().or(z2.date()),
      startTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
      endTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
      isAvailable: z2.boolean().optional(),
      reason: z2.string().optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    updateKitchenDateOverrideSchema = z2.object({
      id: z2.number(),
      startTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
      endTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").optional(),
      isAvailable: z2.boolean().optional(),
      reason: z2.string().optional()
    });
    insertKitchenBookingSchema = createInsertSchema(kitchenBookings, {
      chefId: z2.number(),
      // REQUIRED - matches actual DB
      kitchenId: z2.number(),
      bookingDate: z2.string().or(z2.date()),
      startTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      endTime: z2.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      specialNotes: z2.string().optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    updateKitchenBookingSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      specialNotes: z2.string().optional()
    });
    insertChefLocationAccessSchema = createInsertSchema(chefLocationAccess, {
      chefId: z2.number(),
      locationId: z2.number(),
      grantedBy: z2.number()
    }).omit({
      id: true,
      grantedAt: true
    });
    insertChefKitchenAccessSchema = createInsertSchema(chefKitchenAccess, {
      chefId: z2.number(),
      kitchenId: z2.number(),
      grantedBy: z2.number()
    }).omit({
      id: true,
      grantedAt: true
    });
    insertChefKitchenProfileSchema = createInsertSchema(chefKitchenProfiles, {
      chefId: z2.number(),
      kitchenId: z2.number(),
      status: z2.enum(["pending", "approved", "rejected"]).optional()
    }).omit({
      id: true,
      sharedAt: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewFeedback: true
    });
    updateChefKitchenProfileSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "approved", "rejected"]),
      reviewFeedback: z2.string().optional()
    });
    insertChefLocationProfileSchema = createInsertSchema(chefLocationProfiles, {
      chefId: z2.number(),
      locationId: z2.number(),
      status: z2.enum(["pending", "approved", "rejected"]).optional()
    }).omit({
      id: true,
      sharedAt: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewFeedback: true
    });
    updateChefLocationProfileSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "approved", "rejected"]),
      reviewFeedback: z2.string().optional()
    });
    insertPortalUserApplicationSchema = createInsertSchema(portalUserApplications, {
      userId: z2.number(),
      locationId: z2.number(),
      fullName: z2.string().min(2, "Name must be at least 2 characters"),
      email: z2.string().email("Please enter a valid email address"),
      phone: phoneNumberSchema,
      // Uses shared phone validation
      company: z2.string().optional()
    }).omit({
      id: true,
      status: true,
      createdAt: true,
      reviewedBy: true,
      reviewedAt: true,
      feedback: true
    });
    updatePortalUserApplicationStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["inReview", "approved", "rejected", "cancelled"]),
      feedback: z2.string().optional()
    });
    insertPortalUserLocationAccessSchema = createInsertSchema(portalUserLocationAccess, {
      portalUserId: z2.number(),
      locationId: z2.number(),
      grantedBy: z2.number(),
      applicationId: z2.number().optional()
    }).omit({
      id: true,
      grantedAt: true
    });
    storageListings = pgTable("storage_listings", {
      id: serial("id").primaryKey(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
      storageType: storageTypeEnum("storage_type").notNull(),
      name: text("name").notNull(),
      description: text("description"),
      // Physical specifications
      dimensionsLength: numeric("dimensions_length"),
      // feet/meters
      dimensionsWidth: numeric("dimensions_width"),
      dimensionsHeight: numeric("dimensions_height"),
      totalVolume: numeric("total_volume"),
      // cubic feet/meters (auto-calculated)
      shelfCount: integer("shelf_count"),
      shelfMaterial: text("shelf_material"),
      accessType: text("access_type"),
      // 'walk-in', 'shelving-unit', 'rack-system'
      // Features & amenities (JSONB for flexibility - following existing pattern)
      features: jsonb("features").default([]),
      securityFeatures: jsonb("security_features").default([]),
      climateControl: boolean("climate_control").default(false),
      temperatureRange: text("temperature_range"),
      // "35-40°F"
      humidityControl: boolean("humidity_control").default(false),
      powerOutlets: integer("power_outlets").default(0),
      // Pricing (all in cents)
      pricingModel: storagePricingModelEnum("pricing_model").notNull(),
      basePrice: numeric("base_price").notNull(),
      // Base price in cents (integer)
      pricePerCubicFoot: numeric("price_per_cubic_foot"),
      // For per-cubic-foot model (in cents)
      // Booking duration (flexible: hourly, daily, or monthly)
      minimumBookingDuration: integer("minimum_booking_duration").default(1).notNull(),
      // Minimum booking duration (number)
      bookingDurationUnit: bookingDurationUnitEnum("booking_duration_unit").default("monthly").notNull(),
      // Unit: hourly, daily, or monthly
      currency: text("currency").default("CAD").notNull(),
      // Locked to CAD
      // Status & moderation (admin approval workflow)
      status: listingStatusEnum("status").default("draft").notNull(),
      approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
      // Admin who approved
      approvedAt: timestamp("approved_at"),
      rejectionReason: text("rejection_reason"),
      // If rejected by admin
      // Availability
      isActive: boolean("is_active").default(true).notNull(),
      availabilityCalendar: jsonb("availability_calendar").default({}),
      // Blocked dates, maintenance windows
      // Compliance & documentation
      certifications: jsonb("certifications").default([]),
      photos: jsonb("photos").default([]),
      // Array of image URLs
      documents: jsonb("documents").default([]),
      // Array of document URLs
      // Rules & restrictions
      houseRules: jsonb("house_rules").default([]),
      prohibitedItems: jsonb("prohibited_items").default([]),
      insuranceRequired: boolean("insurance_required").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    insertStorageListingSchema = createInsertSchema(storageListings, {
      kitchenId: z2.number(),
      name: z2.string().min(3, "Name must be at least 3 characters"),
      storageType: z2.enum(["dry", "cold", "freezer"]),
      pricingModel: z2.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]),
      basePrice: z2.number().int().positive("Base price must be positive"),
      pricePerCubicFoot: z2.number().int().positive("Price per cubic foot must be positive").optional(),
      minimumBookingDuration: z2.number().int().positive("Minimum booking duration must be positive").optional(),
      bookingDurationUnit: z2.enum(["hourly", "daily", "monthly"]).optional(),
      dimensionsLength: z2.number().positive().optional(),
      dimensionsWidth: z2.number().positive().optional(),
      dimensionsHeight: z2.number().positive().optional(),
      totalVolume: z2.number().positive().optional(),
      shelfCount: z2.number().int().min(0).optional(),
      temperatureRange: z2.string().optional(),
      features: z2.array(z2.string()).optional(),
      securityFeatures: z2.array(z2.string()).optional(),
      certifications: z2.array(z2.string()).optional(),
      photos: z2.array(z2.string()).optional(),
      documents: z2.array(z2.string()).optional(),
      houseRules: z2.array(z2.string()).optional(),
      prohibitedItems: z2.array(z2.string()).optional(),
      availabilityCalendar: z2.record(z2.any()).optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      approvedBy: true,
      approvedAt: true,
      rejectionReason: true,
      currency: true
      // Always CAD, not user-selectable
    });
    updateStorageListingSchema = z2.object({
      id: z2.number(),
      name: z2.string().min(3).optional(),
      description: z2.string().optional(),
      storageType: z2.enum(["dry", "cold", "freezer"]).optional(),
      pricingModel: z2.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]).optional(),
      basePrice: z2.number().int().positive().optional(),
      pricePerCubicFoot: z2.number().int().positive().optional(),
      minimumBookingDuration: z2.number().int().positive().optional(),
      bookingDurationUnit: z2.enum(["hourly", "daily", "monthly"]).optional(),
      dimensionsLength: z2.number().positive().optional(),
      dimensionsWidth: z2.number().positive().optional(),
      dimensionsHeight: z2.number().positive().optional(),
      totalVolume: z2.number().positive().optional(),
      shelfCount: z2.number().int().min(0).optional(),
      shelfMaterial: z2.string().optional(),
      accessType: z2.string().optional(),
      temperatureRange: z2.string().optional(),
      climateControl: z2.boolean().optional(),
      humidityControl: z2.boolean().optional(),
      powerOutlets: z2.number().int().min(0).optional(),
      isActive: z2.boolean().optional(),
      insuranceRequired: z2.boolean().optional(),
      features: z2.array(z2.string()).optional(),
      securityFeatures: z2.array(z2.string()).optional(),
      certifications: z2.array(z2.string()).optional(),
      photos: z2.array(z2.string()).optional(),
      documents: z2.array(z2.string()).optional(),
      houseRules: z2.array(z2.string()).optional(),
      prohibitedItems: z2.array(z2.string()).optional(),
      availabilityCalendar: z2.record(z2.any()).optional()
    });
    updateStorageListingStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["draft", "pending", "approved", "rejected", "active", "inactive"]),
      rejectionReason: z2.string().optional()
    });
    equipmentListings = pgTable("equipment_listings", {
      id: serial("id").primaryKey(),
      kitchenId: integer("kitchen_id").references(() => kitchens.id, { onDelete: "cascade" }).notNull(),
      // Category & type
      category: equipmentCategoryEnum("category").notNull(),
      equipmentType: text("equipment_type").notNull(),
      // 'mixer', 'oven', 'fryer', etc.
      brand: text("brand"),
      model: text("model"),
      // Specifications
      description: text("description"),
      condition: equipmentConditionEnum("condition").notNull(),
      age: integer("age"),
      // years
      serviceHistory: text("service_history"),
      dimensions: jsonb("dimensions").default({}),
      // {width, depth, height, weight}
      powerRequirements: text("power_requirements"),
      // '110V', '208V', '240V', '3-phase'
      // Equipment-specific fields (JSONB for flexibility)
      specifications: jsonb("specifications").default({}),
      certifications: jsonb("certifications").default([]),
      safetyFeatures: jsonb("safety_features").default([]),
      // Availability type: included (free with kitchen) or rental (paid addon)
      availabilityType: equipmentAvailabilityTypeEnum("availability_type").default("rental").notNull(),
      // Pricing - SIMPLIFIED to flat session rate (in cents)
      // For rental equipment: charged once per kitchen booking session, regardless of duration
      sessionRate: numeric("session_rate").default("0"),
      // Flat session rate in cents (e.g., 2500 = $25.00/session)
      pricingModel: equipmentPricingModelEnum("pricing_model"),
      // Nullable for included equipment
      // Legacy rate fields - kept for backwards compatibility but session_rate is primary
      hourlyRate: numeric("hourly_rate"),
      // @deprecated - use sessionRate
      dailyRate: numeric("daily_rate"),
      // @deprecated - use sessionRate
      weeklyRate: numeric("weekly_rate"),
      // @deprecated - use sessionRate
      monthlyRate: numeric("monthly_rate"),
      // @deprecated - use sessionRate
      minimumRentalHours: integer("minimum_rental_hours"),
      // @deprecated
      minimumRentalDays: integer("minimum_rental_days"),
      // @deprecated
      currency: text("currency").default("CAD").notNull(),
      // Usage terms
      usageRestrictions: jsonb("usage_restrictions").default([]),
      trainingRequired: boolean("training_required").default(false),
      cleaningResponsibility: text("cleaning_responsibility"),
      // 'renter', 'host', 'shared'
      // Status & moderation (admin approval workflow)
      status: listingStatusEnum("status").default("draft").notNull(),
      // Reuse same enum
      approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
      approvedAt: timestamp("approved_at"),
      rejectionReason: text("rejection_reason"),
      // Availability
      isActive: boolean("is_active").default(true).notNull(),
      availabilityCalendar: jsonb("availability_calendar").default({}),
      prepTimeHours: integer("prep_time_hours").default(4),
      // Cleaning time between rentals
      // Visuals & documentation
      photos: jsonb("photos").default([]),
      manuals: jsonb("manuals").default([]),
      // PDF URLs
      maintenanceLog: jsonb("maintenance_log").default([]),
      // Damage & liability (deposits in cents)
      damageDeposit: numeric("damage_deposit").default("0"),
      // Refundable deposit (in cents)
      insuranceRequired: boolean("insurance_required").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    insertEquipmentListingSchema = createInsertSchema(equipmentListings, {
      kitchenId: z2.number(),
      category: z2.enum(["food-prep", "cooking", "refrigeration", "cleaning", "specialty"]),
      equipmentType: z2.string().min(1, "Equipment type is required"),
      condition: z2.enum(["excellent", "good", "fair", "needs-repair"]),
      availabilityType: z2.enum(["included", "rental"]),
      pricingModel: z2.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
      // Optional for included equipment
      hourlyRate: z2.number().int().positive("Hourly rate must be positive").optional(),
      dailyRate: z2.number().int().positive("Daily rate must be positive").optional(),
      weeklyRate: z2.number().int().positive("Weekly rate must be positive").optional(),
      monthlyRate: z2.number().int().positive("Monthly rate must be positive").optional(),
      minimumRentalHours: z2.number().int().min(1).optional(),
      minimumRentalDays: z2.number().int().min(1).optional(),
      damageDeposit: z2.number().int().min(0).optional(),
      age: z2.number().int().min(0).optional(),
      prepTimeHours: z2.number().int().min(0).optional(),
      dimensions: z2.record(z2.any()).optional(),
      specifications: z2.record(z2.any()).optional(),
      certifications: z2.array(z2.string()).optional(),
      safetyFeatures: z2.array(z2.string()).optional(),
      usageRestrictions: z2.array(z2.string()).optional(),
      photos: z2.array(z2.string()).optional(),
      manuals: z2.array(z2.string()).optional(),
      maintenanceLog: z2.array(z2.any()).optional(),
      availabilityCalendar: z2.record(z2.any()).optional(),
      cleaningResponsibility: z2.enum(["renter", "host", "shared"]).optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      approvedBy: true,
      approvedAt: true,
      rejectionReason: true,
      currency: true
      // Always CAD, not user-selectable
    });
    updateEquipmentListingSchema = z2.object({
      id: z2.number(),
      category: z2.enum(["food-prep", "cooking", "refrigeration", "cleaning", "specialty"]).optional(),
      equipmentType: z2.string().min(1).optional(),
      brand: z2.string().optional(),
      model: z2.string().optional(),
      description: z2.string().optional(),
      condition: z2.enum(["excellent", "good", "fair", "needs-repair"]).optional(),
      age: z2.number().int().min(0).optional(),
      serviceHistory: z2.string().optional(),
      dimensions: z2.record(z2.any()).optional(),
      powerRequirements: z2.string().optional(),
      specifications: z2.record(z2.any()).optional(),
      availabilityType: z2.enum(["included", "rental"]).optional(),
      pricingModel: z2.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
      hourlyRate: z2.number().int().positive().optional(),
      dailyRate: z2.number().int().positive().optional(),
      weeklyRate: z2.number().int().positive().optional(),
      monthlyRate: z2.number().int().positive().optional(),
      minimumRentalHours: z2.number().int().min(1).optional(),
      minimumRentalDays: z2.number().int().min(1).optional(),
      usageRestrictions: z2.array(z2.string()).optional(),
      trainingRequired: z2.boolean().optional(),
      cleaningResponsibility: z2.enum(["renter", "host", "shared"]).optional(),
      isActive: z2.boolean().optional(),
      prepTimeHours: z2.number().int().min(0).optional(),
      damageDeposit: z2.number().int().min(0).optional(),
      insuranceRequired: z2.boolean().optional(),
      certifications: z2.array(z2.string()).optional(),
      safetyFeatures: z2.array(z2.string()).optional(),
      photos: z2.array(z2.string()).optional(),
      manuals: z2.array(z2.string()).optional(),
      maintenanceLog: z2.array(z2.any()).optional(),
      availabilityCalendar: z2.record(z2.any()).optional()
    });
    updateEquipmentListingStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["draft", "pending", "approved", "rejected", "active", "inactive"]),
      rejectionReason: z2.string().optional()
    });
    storageBookings = pgTable("storage_bookings", {
      id: serial("id").primaryKey(),
      storageListingId: integer("storage_listing_id").references(() => storageListings.id, { onDelete: "cascade" }).notNull(),
      kitchenBookingId: integer("kitchen_booking_id").references(() => kitchenBookings.id, { onDelete: "cascade" }),
      // NULLABLE - storage can be booked independently
      chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }),
      // Chef making the booking
      startDate: timestamp("start_date").notNull(),
      endDate: timestamp("end_date").notNull(),
      status: bookingStatusEnum("status").default("pending").notNull(),
      totalPrice: numeric("total_price").notNull(),
      // In cents (daily_rate × number_of_days)
      pricingModel: storagePricingModelEnum("pricing_model").notNull(),
      // Always 'daily' now
      paymentStatus: paymentStatusEnum("payment_status").default("pending"),
      paymentIntentId: text("payment_intent_id"),
      // Stripe PaymentIntent ID
      serviceFee: numeric("service_fee").default("0"),
      // Platform commission in cents
      currency: text("currency").default("CAD").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    insertStorageBookingSchema = createInsertSchema(storageBookings, {
      storageListingId: z2.number(),
      kitchenBookingId: z2.number().optional().nullable(),
      // Optional - for standalone storage bookings
      chefId: z2.number().optional(),
      startDate: z2.string().or(z2.date()),
      endDate: z2.string().or(z2.date()),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      totalPrice: z2.number().int().positive("Total price must be positive"),
      pricingModel: z2.enum(["monthly-flat", "per-cubic-foot", "hourly", "daily"]),
      paymentStatus: z2.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
      paymentIntentId: z2.string().optional(),
      serviceFee: z2.number().int().min(0).optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      currency: true
      // Always CAD, not user-selectable
    });
    updateStorageBookingSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      paymentStatus: z2.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
      paymentIntentId: z2.string().optional(),
      serviceFee: z2.number().int().min(0).optional()
    });
    updateStorageBookingStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "cancelled"])
    });
    equipmentBookings = pgTable("equipment_bookings", {
      id: serial("id").primaryKey(),
      equipmentListingId: integer("equipment_listing_id").references(() => equipmentListings.id, { onDelete: "cascade" }).notNull(),
      kitchenBookingId: integer("kitchen_booking_id").references(() => kitchenBookings.id, { onDelete: "cascade" }).notNull(),
      // REQUIRED - no standalone bookings
      chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }),
      // Nullable for external bookings
      startDate: timestamp("start_date").notNull(),
      endDate: timestamp("end_date").notNull(),
      status: bookingStatusEnum("status").default("pending").notNull(),
      // Reuse existing enum
      totalPrice: numeric("total_price").notNull(),
      // In cents
      pricingModel: equipmentPricingModelEnum("pricing_model").notNull(),
      // Reuse enum
      damageDeposit: numeric("damage_deposit").default("0"),
      // In cents (only for rental)
      paymentStatus: paymentStatusEnum("payment_status").default("pending"),
      // Reuse enum
      paymentIntentId: text("payment_intent_id"),
      // Stripe PaymentIntent ID (nullable, unique)
      serviceFee: numeric("service_fee").default("0"),
      // Platform commission in cents
      currency: text("currency").default("CAD").notNull(),
      // NOTE: No delivery/pickup fields - equipment stays in kitchen
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    insertEquipmentBookingSchema = createInsertSchema(equipmentBookings, {
      equipmentListingId: z2.number(),
      kitchenBookingId: z2.number(),
      chefId: z2.number().optional(),
      startDate: z2.string().or(z2.date()),
      endDate: z2.string().or(z2.date()),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      totalPrice: z2.number().int().positive("Total price must be positive"),
      pricingModel: z2.enum(["hourly", "daily", "weekly", "monthly"]),
      damageDeposit: z2.number().int().min(0).optional(),
      paymentStatus: z2.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
      paymentIntentId: z2.string().optional(),
      serviceFee: z2.number().int().min(0).optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      currency: true
      // Always CAD, not user-selectable
    });
    updateEquipmentBookingSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "cancelled"]).optional(),
      paymentStatus: z2.enum(["pending", "paid", "refunded", "failed", "partially_refunded"]).optional(),
      paymentIntentId: z2.string().optional(),
      damageDeposit: z2.number().int().min(0).optional(),
      serviceFee: z2.number().int().min(0).optional()
    });
    updateEquipmentBookingStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "cancelled"])
    });
    platformSettings = pgTable("platform_settings", {
      id: serial("id").primaryKey(),
      key: text("key").notNull().unique(),
      value: text("value").notNull(),
      description: text("description"),
      updatedBy: integer("updated_by").references(() => users.id),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    insertPlatformSettingSchema = createInsertSchema(platformSettings);
    updatePlatformSettingSchema = z2.object({
      value: z2.string().optional(),
      description: z2.string().optional()
    });
    chefKitchenApplications = pgTable("chef_kitchen_applications", {
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
      customFieldsData: jsonb("custom_fields_data").default({}),
      // { [fieldId]: value }
      // Timestamps
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    insertChefKitchenApplicationSchema = createInsertSchema(chefKitchenApplications, {
      chefId: z2.number(),
      locationId: z2.number(),
      fullName: z2.string().min(1, "Name is required"),
      // Minimum validation, but requirement checked in API
      email: z2.string().email("Please enter a valid email address"),
      // Email format validation, but requirement checked in API
      phone: z2.string(),
      // Accept any string (including empty) - requirement and format validation happens in API
      kitchenPreference: z2.enum(["commercial", "home", "notSure"]),
      businessDescription: z2.string().optional(),
      cookingExperience: z2.string().optional(),
      foodSafetyLicense: z2.enum(["yes", "no", "notSure"]),
      // Requirement checked in API
      foodSafetyLicenseUrl: z2.string().optional(),
      foodSafetyLicenseExpiry: z2.string().optional(),
      // Requirement checked in API
      foodEstablishmentCert: z2.enum(["yes", "no", "notSure"]).optional(),
      // Optional - defaults to "no" if not required
      foodEstablishmentCertUrl: z2.string().optional(),
      foodEstablishmentCertExpiry: z2.string().optional(),
      // Requirement checked in API
      customFieldsData: z2.record(z2.any()).optional()
      // Custom fields data as JSON object
    }).omit({
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      reviewedBy: true,
      reviewedAt: true,
      feedback: true,
      foodSafetyLicenseStatus: true,
      foodEstablishmentCertStatus: true
    });
    updateChefKitchenApplicationSchema = z2.object({
      id: z2.number(),
      fullName: z2.string().min(2).optional(),
      email: z2.string().email().optional(),
      phone: phoneNumberSchema.optional(),
      kitchenPreference: z2.enum(["commercial", "home", "notSure"]).optional(),
      businessDescription: z2.string().optional(),
      cookingExperience: z2.string().optional(),
      foodSafetyLicenseUrl: z2.string().optional(),
      foodEstablishmentCertUrl: z2.string().optional()
    });
    updateChefKitchenApplicationStatusSchema = z2.object({
      id: z2.number(),
      status: z2.enum(["inReview", "approved", "rejected", "cancelled"]),
      feedback: z2.string().optional(),
      current_tier: z2.number().min(1).max(4).optional(),
      tier_data: z2.record(z2.any()).optional()
    });
    updateApplicationTierSchema = z2.object({
      id: z2.number(),
      current_tier: z2.number().min(1).max(4),
      tier_data: z2.record(z2.any()).optional()
    });
    updateChefKitchenApplicationDocumentsSchema = z2.object({
      id: z2.number(),
      foodSafetyLicenseUrl: z2.string().optional(),
      foodEstablishmentCertUrl: z2.string().optional(),
      foodSafetyLicenseStatus: z2.enum(["pending", "approved", "rejected"]).optional(),
      foodEstablishmentCertStatus: z2.enum(["pending", "approved", "rejected"]).optional()
    });
    paymentTransactions = pgTable("payment_transactions", {
      id: serial("id").primaryKey(),
      bookingId: integer("booking_id").notNull(),
      // References kitchen_bookings.id, storage_bookings.id, or equipment_bookings.id
      bookingType: bookingTypeEnum("booking_type").notNull(),
      // Which booking table this transaction belongs to
      chefId: integer("chef_id").references(() => users.id, { onDelete: "set null" }),
      // Chef who made the payment
      managerId: integer("manager_id").references(() => users.id, { onDelete: "set null" }),
      // Manager who receives the payment
      // Payment amounts (all in cents)
      amount: numeric("amount").notNull(),
      // Total transaction amount (includes service fee)
      baseAmount: numeric("base_amount").notNull(),
      // Base amount before service fee
      serviceFee: numeric("service_fee").notNull().default("0"),
      // Platform service fee
      managerRevenue: numeric("manager_revenue").notNull(),
      // Manager earnings (base_amount - service_fee)
      refundAmount: numeric("refund_amount").default("0"),
      // Total refunded amount
      netAmount: numeric("net_amount").notNull(),
      // Final amount after refunds (amount - refund_amount)
      currency: text("currency").notNull().default("CAD"),
      // Stripe integration
      paymentIntentId: text("payment_intent_id"),
      // Stripe PaymentIntent ID (nullable, unique when set)
      chargeId: text("charge_id"),
      // Stripe Charge ID
      refundId: text("refund_id"),
      // Stripe Refund ID
      paymentMethodId: text("payment_method_id"),
      // Stripe PaymentMethod ID
      // Status tracking
      status: transactionStatusEnum("status").notNull().default("pending"),
      stripeStatus: text("stripe_status"),
      // Raw Stripe status for comparison
      // Metadata and tracking
      metadata: jsonb("metadata").default({}),
      // Additional metadata
      refundReason: text("refund_reason"),
      // Reason for refund
      failureReason: text("failure_reason"),
      // Reason for payment failure
      webhookEventId: text("webhook_event_id"),
      // Stripe webhook event ID
      lastSyncedAt: timestamp("last_synced_at"),
      // Last time synced with Stripe
      // Timestamps
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
      paidAt: timestamp("paid_at"),
      // When payment was successfully captured
      refundedAt: timestamp("refunded_at")
      // When refund was issued
    });
    paymentHistory = pgTable("payment_history", {
      id: serial("id").primaryKey(),
      transactionId: integer("transaction_id").references(() => paymentTransactions.id, { onDelete: "cascade" }).notNull(),
      previousStatus: transactionStatusEnum("previous_status"),
      newStatus: transactionStatusEnum("new_status").notNull(),
      eventType: text("event_type").notNull(),
      // 'status_change', 'refund', 'webhook', 'manual_update', etc.
      eventSource: text("event_source"),
      // 'stripe_webhook', 'admin', 'system', 'sync', etc.
      stripeEventId: text("stripe_event_id"),
      // Stripe event ID if from webhook
      description: text("description"),
      // Human-readable description
      metadata: jsonb("metadata").default({}),
      // Additional event data
      createdAt: timestamp("created_at").notNull().defaultNow(),
      createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" })
      // User who triggered the change
    });
    insertPaymentTransactionSchema = createInsertSchema(paymentTransactions);
    updatePaymentTransactionSchema = z2.object({
      status: z2.enum(["pending", "processing", "succeeded", "failed", "canceled", "refunded", "partially_refunded"]).optional(),
      stripeStatus: z2.string().optional(),
      refundAmount: z2.number().optional(),
      refundReason: z2.string().optional(),
      failureReason: z2.string().optional(),
      chargeId: z2.string().optional(),
      refundId: z2.string().optional(),
      paidAt: z2.date().optional(),
      refundedAt: z2.date().optional(),
      lastSyncedAt: z2.date().optional(),
      metadata: z2.record(z2.any()).optional()
    });
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  db: () => db,
  pool: () => pool
});
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
var pool, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    neonConfig.webSocketConstructor = ws;
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?"
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema: schema_exports });
  }
});

// server/domains/users/user.repository.ts
import { eq } from "drizzle-orm";
var UserRepository;
var init_user_repository = __esm({
  "server/domains/users/user.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    UserRepository = class {
      async findById(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user || null;
      }
      async findByUsername(username) {
        const [user] = await db.select().from(users).where(eq(users.username, username));
        return user || null;
      }
      async findByFirebaseUid(firebaseUid) {
        const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
        return user || null;
      }
      async usernameExists(username) {
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
        return !!user;
      }
      async create(data) {
        const [user] = await db.insert(users).values(data).returning();
        return user;
      }
      async update(id, data) {
        const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
        return updated || null;
      }
      async delete(id) {
        await db.delete(users).where(eq(users.id, id));
      }
    };
  }
});

// server/passwordUtils.ts
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import bcrypt from "bcryptjs";
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString("hex")}.${salt}`;
}
async function comparePasswords(password, hash) {
  const isBcrypt = hash && (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$") || hash.startsWith("$2$"));
  if (isBcrypt) {
    return await bcrypt.compare(password, hash);
  } else {
    const [hashedPassword, salt] = hash.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = await scryptAsync(password, salt, 64);
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  }
}
var scryptAsync;
var init_passwordUtils = __esm({
  "server/passwordUtils.ts"() {
    "use strict";
    scryptAsync = promisify(scrypt);
  }
});

// server/shared/errors/domain-error.ts
var DomainError, UserErrorCodes, ApplicationErrorCodes, LocationErrorCodes, KitchenErrorCodes;
var init_domain_error = __esm({
  "server/shared/errors/domain-error.ts"() {
    "use strict";
    DomainError = class extends Error {
      constructor(code, message, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = "DomainError";
      }
    };
    UserErrorCodes = {
      USER_NOT_FOUND: "USER_NOT_FOUND",
      USERNAME_TAKEN: "USERNAME_TAKEN",
      USERNAME_TOO_SHORT: "USERNAME_TOO_SHORT",
      USERNAME_TOO_LONG: "USERNAME_TOO_LONG",
      EMAIL_INVALID: "EMAIL_INVALID",
      PASSWORD_INVALID: "PASSWORD_INVALID",
      INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
      UNAUTHORIZED: "UNAUTHORIZED",
      FORBIDDEN: "FORBIDDEN",
      VALIDATION_ERROR: "VALIDATION_ERROR"
    };
    ApplicationErrorCodes = {
      APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
      INVALID_STATUS: "INVALID_STATUS",
      ALREADY_APPROVED: "ALREADY_APPROVED",
      ALREADY_REJECTED: "ALREADY_REJECTED",
      VALIDATION_ERROR: "VALIDATION_ERROR"
    };
    LocationErrorCodes = {
      LOCATION_NOT_FOUND: "LOCATION_NOT_FOUND",
      INVALID_ADDRESS: "INVALID_ADDRESS",
      NO_MANAGER_ASSIGNED: "NO_MANAGER_ASSIGNED"
    };
    KitchenErrorCodes = {
      KITCHEN_NOT_FOUND: "KITCHEN_NOT_FOUND",
      LOCATION_NOT_FOUND: "LOCATION_NOT_FOUND",
      INVALID_PRICING: "INVALID_PRICING"
    };
  }
});

// server/domains/users/user.service.ts
import { eq as eq2 } from "drizzle-orm";
var UserService, userService;
var init_user_service = __esm({
  "server/domains/users/user.service.ts"() {
    "use strict";
    init_user_repository();
    init_schema();
    init_db();
    init_passwordUtils();
    init_domain_error();
    UserService = class {
      repo;
      constructor(repo) {
        this.repo = repo || new UserRepository();
      }
      async checkUsernameExists(username) {
        const user = await this.repo.findByUsername(username);
        return !!user;
      }
      async getUser(id) {
        return this.repo.findById(id);
      }
      async getUserByUsername(username) {
        return this.repo.findByUsername(username);
      }
      async getUserByFirebaseUid(uid) {
        return this.repo.findByFirebaseUid(uid);
      }
      async createUser(data) {
        if (!data.username) {
          throw new Error("Username is required");
        }
        const exists = await this.repo.usernameExists(data.username);
        if (exists) {
          throw new DomainError(
            UserErrorCodes.USERNAME_TAKEN,
            `Username ${data.username} is already taken`,
            409
          );
        }
        const userToCreate = {
          ...data,
          password: data.password || "",
          isVerified: data.isVerified ?? false,
          has_seen_welcome: data.has_seen_welcome ?? false,
          isChef: data.isChef ?? false,
          isManager: data.isManager ?? false,
          isPortalUser: data.isPortalUser ?? false
        };
        return this.repo.create(userToCreate);
      }
      async updateUser(id, data) {
        return this.repo.update(id, data);
      }
      async updateUserFirebaseUid(id, firebaseUid) {
        const user = await this.repo.findById(id);
        if (user && user.firebaseUid) {
          throw new DomainError(
            UserErrorCodes.VALIDATION_ERROR,
            "User already has a linked Firebase account",
            400
          );
        }
        return this.repo.update(id, { firebaseUid });
      }
      async setHasSeenWelcome(id) {
        await this.repo.update(id, { has_seen_welcome: true });
      }
      async updateUserRoles(id, roles) {
        const mainRole = roles.isChef ? "chef" : void 0;
        const updateData = {
          isChef: roles.isChef
        };
        if (mainRole) {
          updateData.role = mainRole;
        } else {
          updateData.role = roles.isChef ? "chef" : null;
        }
        await this.repo.update(id, updateData);
      }
      async getCompleteProfile(id) {
        const user = await this.repo.findById(id);
        if (!user) {
          throw new DomainError(
            UserErrorCodes.USER_NOT_FOUND,
            `User not found: ${id}`,
            404
          );
        }
        return {
          ...user,
          firebaseUser: {
            uid: user.firebaseUid,
            email: user.username,
            // Assuming username is email
            emailVerified: user.isVerified
          }
        };
      }
      async resetPassword(firebaseUid, newPassword) {
        const user = await this.repo.findByFirebaseUid(firebaseUid);
        if (!user) {
          throw new Error(`User not found for firebaseUid: ${firebaseUid}`);
        }
        const hashedPassword = await hashPassword(newPassword);
        await this.repo.update(user.id, { password: hashedPassword });
      }
      async verifyUser(id, isVerified) {
        return this.repo.update(id, { isVerified });
      }
      async markWelcomeSeen(id) {
        await this.repo.update(id, { has_seen_welcome: true });
      }
      async deleteUser(id) {
        await db.transaction(async (tx) => {
          const managedLocations = await tx.select().from(locations).where(eq2(locations.managerId, id));
          if (managedLocations.length > 0) {
            await tx.update(locations).set({ managerId: null }).where(eq2(locations.managerId, id));
            console.log(`Removed manager ${id} from ${managedLocations.length} locations`);
          }
          await tx.delete(users).where(eq2(users.id, id));
          console.log(`Deleted user ${id}`);
        });
      }
    };
    userService = new UserService();
  }
});

// server/firebase-auth-middleware.ts
async function requireFirebaseAuthWithUser(req, res, next) {
  try {
    if (res.headersSent) {
      return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "No auth token provided"
      });
    }
    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);
    if (!decodedToken) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid auth token"
      });
    }
    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified
    };
    const neonUser = await userService.getUserByFirebaseUid(req.firebaseUser.uid);
    if (!neonUser) {
      return res.status(404).json({
        error: "User not found",
        message: "This account is not registered with Local Cooks. Please create an account first."
      });
    }
    req.neonUser = {
      ...neonUser,
      uid: neonUser.firebaseUid || void 0
      // Support legacy code that uses .uid
    };
    console.log(`\u{1F504} Auth translation: Firebase UID ${req.firebaseUser.uid} \u2192 Neon User ID ${neonUser.id}`, {
      role: neonUser.role,
      isChef: neonUser.isChef,
      isManager: neonUser.isManager
    });
    next();
  } catch (error) {
    if (res.headersSent) {
      console.error("Firebase auth with user verification error (response already sent):", error);
      return;
    }
    console.error("Firebase auth with user verification error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Authentication verification failed"
    });
  }
}
async function optionalFirebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }
    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);
    if (decodedToken) {
      req.firebaseUser = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified
      };
      const neonUser = await userService.getUserByFirebaseUid(decodedToken.uid);
      if (neonUser) {
        req.neonUser = {
          ...neonUser,
          uid: neonUser.firebaseUid || void 0
        };
      }
    }
    next();
  } catch (error) {
    console.error("Optional Firebase auth error:", error);
    next();
  }
}
function requireAdmin(req, res, next) {
  if (res.headersSent) {
    return;
  }
  if (!req.neonUser) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }
  if (req.neonUser.role !== "admin") {
    return res.status(403).json({
      error: "Forbidden",
      message: "Admin access required"
    });
  }
  next();
}
function requireManager(req, res, next) {
  if (res.headersSent) {
    return;
  }
  if (!req.neonUser) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required"
    });
  }
  if (req.neonUser.role !== "manager") {
    return res.status(403).json({
      error: "Forbidden",
      message: "Manager access required"
    });
  }
  next();
}
var init_firebase_auth_middleware = __esm({
  "server/firebase-auth-middleware.ts"() {
    "use strict";
    init_firebase_setup();
    init_user_service();
  }
});

// server/email.ts
var email_exports = {};
__export(email_exports, {
  generateApplicationWithDocumentsEmail: () => generateApplicationWithDocumentsEmail,
  generateApplicationWithoutDocumentsEmail: () => generateApplicationWithoutDocumentsEmail,
  generateBookingCancellationEmail: () => generateBookingCancellationEmail,
  generateBookingCancellationNotificationEmail: () => generateBookingCancellationNotificationEmail,
  generateBookingConfirmationEmail: () => generateBookingConfirmationEmail,
  generateBookingNotificationEmail: () => generateBookingNotificationEmail,
  generateBookingRequestEmail: () => generateBookingRequestEmail,
  generateBookingStatusChangeNotificationEmail: () => generateBookingStatusChangeNotificationEmail,
  generateChefAllDocumentsApprovedEmail: () => generateChefAllDocumentsApprovedEmail,
  generateChefKitchenAccessApprovedEmail: () => generateChefKitchenAccessApprovedEmail,
  generateChefLocationAccessApprovedEmail: () => generateChefLocationAccessApprovedEmail,
  generateChefProfileRequestEmail: () => generateChefProfileRequestEmail,
  generateDocumentStatusChangeEmail: () => generateDocumentStatusChangeEmail,
  generateDocumentUpdateEmail: () => generateDocumentUpdateEmail,
  generateEmailVerificationEmail: () => generateEmailVerificationEmail,
  generateFullVerificationEmail: () => generateFullVerificationEmail,
  generateKitchenAvailabilityChangeEmail: () => generateKitchenAvailabilityChangeEmail,
  generateKitchenSettingsChangeEmail: () => generateKitchenSettingsChangeEmail,
  generateLocationEmailChangedEmail: () => generateLocationEmailChangedEmail,
  generateManagerCredentialsEmail: () => generateManagerCredentialsEmail,
  generateManagerMagicLinkEmail: () => generateManagerMagicLinkEmail,
  generatePasswordResetEmail: () => generatePasswordResetEmail,
  generatePromoCodeEmail: () => generatePromoCodeEmail,
  generateStatusChangeEmail: () => generateStatusChangeEmail,
  generateWelcomeEmail: () => generateWelcomeEmail,
  sendApplicationReceivedEmail: () => sendApplicationReceivedEmail,
  sendApplicationRejectedEmail: () => sendApplicationRejectedEmail,
  sendEmail: () => sendEmail
});
import nodemailer from "nodemailer";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
function createBookingDateTimeFallback(dateStr, timeStr, timezone = "America/St_Johns") {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}
function createBookingDateTime(dateStr, timeStr, timezone = "America/St_Johns") {
  return createBookingDateTimeImpl(dateStr, timeStr, timezone);
}
async function sendApplicationReceivedEmail(applicationData) {
  const supportEmail = getSupportEmail();
  const organizationName = getOrganizationName();
  const subject = `Application Received - ${organizationName}`;
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to join ${organizationName}. 
        We've received your application and our team will review it shortly.
      </p>
      <div class="status-badge">Status: Under Review</div>
      <div class="info-box">
        <strong>What happens next?</strong><br>
        Our team typically reviews applications within 2-3 business days. 
        You'll receive an email notification once we've made a decision.
      </div>
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Track Application Status</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in ${organizationName}!</p>
      <div class="footer-links">
        <a href="mailto:${supportEmail}">Support</a> \u2022 
        <a href="mailto:${supportEmail}?subject=Unsubscribe">Unsubscribe</a> \u2022 
        <a href="${getPrivacyUrl()}">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>`;
  const textContent = `
Application Received - ${organizationName}

Hello ${applicationData.fullName},

Thank you for submitting your application to join ${organizationName}. We've received your application and our team will review it shortly.

Status: Under Review

What happens next?
Our team typically reviews applications within 2-3 business days. You'll receive an email notification once we've made a decision.

Track your application status: ${getDashboardUrl()}

Thank you for your interest in ${organizationName}!

If you have any questions, contact us at ${supportEmail}

\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${organizationName}
`;
  return sendEmail({
    to: applicationData.email,
    subject,
    html: htmlContent,
    text: textContent
  });
}
async function sendApplicationRejectedEmail(applicationData, reason) {
  const supportEmail = getSupportEmail();
  const organizationName = getOrganizationName();
  const subject = `Application Update - ${organizationName}`;
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for your interest in joining ${organizationName}. After careful review, we're unable to approve your application at this time.
      </p>
      <div class="status-badge">Status: Not Approved</div>
      
      ${reason ? `
      <div class="info-box">
        <strong>Feedback:</strong> ${reason}
      </div>
      ` : ""}
      
      <div class="info-box">
        <strong>\u{1F4DA} Next Steps:</strong><br>
        We encourage you to gain more experience and reapply in the future. 
        We'd be happy to reconsider your application when you're ready.
      </div>
      
      <a href="https://local-cooks-community.vercel.app/apply" class="cta-button" style="color: white !important; text-decoration: none !important;">Learn About Requirements</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in ${organizationName}!</p>
      <div class="footer-links">
        <a href="mailto:${supportEmail}">Support</a> \u2022 
        <a href="mailto:${supportEmail}?subject=Unsubscribe">Unsubscribe</a> \u2022 
        <a href="https://local-cooks-community.vercel.app/privacy">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>`;
  const textContent = `
Application Update - ${organizationName}

Hello ${applicationData.fullName},

Thank you for your interest in joining ${organizationName}. After careful review, we're unable to approve your application at this time.

Status: Not Approved

${reason ? `Feedback: ${reason}

` : ""}Next Steps:
We encourage you to gain more experience and reapply in the future. We'd be happy to reconsider your application when you're ready.

Learn more about requirements: https://local-cooks-community.vercel.app/apply

Thank you for your interest in ${organizationName}!

If you have any questions, contact us at ${supportEmail}

\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${organizationName}
`;
  return sendEmail({
    to: applicationData.email,
    subject,
    html: htmlContent,
    text: textContent
  });
}
var createBookingDateTimeImpl, loadAttempted, recentEmails, DUPLICATE_PREVENTION_WINDOW, createTransporter, getEmailConfig, sendEmail, getDomainFromEmail, getOrganizationName, getUnsubscribeEmail, getSupportEmail, detectEmailProvider, formatDateForCalendar, escapeIcalText, generateEventUid, generateIcsFile, generateCalendarUrl, getUniformEmailStyles, generateStatusChangeEmail, generateVendorCredentials, generateFullVerificationEmail, generateApplicationWithDocumentsEmail, generateApplicationWithoutDocumentsEmail, generateDocumentStatusChangeEmail, generatePasswordResetEmail, generateEmailVerificationEmail, generateWelcomeEmail, getSubdomainUrl, getWebsiteUrl, getDashboardUrl, getPrivacyUrl, getVendorDashboardUrl, getPromoUrl, generateDocumentUpdateEmail, generatePromoCodeEmail, generateChefAllDocumentsApprovedEmail, generateManagerMagicLinkEmail, generateManagerCredentialsEmail, generateBookingNotificationEmail, generateBookingCancellationNotificationEmail, generateBookingStatusChangeNotificationEmail, generateBookingRequestEmail, generateBookingConfirmationEmail, generateBookingCancellationEmail, generateKitchenAvailabilityChangeEmail, generateKitchenSettingsChangeEmail, generateChefProfileRequestEmail, generateChefLocationAccessApprovedEmail, generateChefKitchenAccessApprovedEmail, generateLocationEmailChangedEmail;
var init_email = __esm({
  "server/email.ts"() {
    "use strict";
    createBookingDateTimeImpl = createBookingDateTimeFallback;
    loadAttempted = false;
    (async () => {
      if (loadAttempted) return;
      loadAttempted = true;
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const possiblePaths = [
          join(__dirname, "../shared/timezone-utils.js"),
          // From server/email.js to shared/timezone-utils.js (CORRECT PATH for dist)
          join(__dirname, "../shared/timezone-utils"),
          // Without .js extension
          join(__dirname, "../../shared/timezone-utils.js"),
          // Alternative path
          "/var/task/shared/timezone-utils.js",
          // Absolute path for Vercel dist structure
          "/var/task/api/shared/timezone-utils.js"
          // Absolute path for Vercel api structure
        ];
        for (const filePath of possiblePaths) {
          try {
            const timezoneUtilsUrl = pathToFileURL(filePath).href;
            const timezoneUtils = await import(timezoneUtilsUrl);
            if (timezoneUtils && timezoneUtils.createBookingDateTime) {
              createBookingDateTimeImpl = timezoneUtils.createBookingDateTime;
              console.log(`Successfully loaded timezone-utils from: ${timezoneUtilsUrl}`);
              return;
            }
          } catch {
            continue;
          }
        }
        console.warn("Failed to load timezone-utils from any path, using fallback implementation");
      } catch (error) {
        console.error("Error during timezone-utils initialization:", error);
      }
    })();
    recentEmails = /* @__PURE__ */ new Map();
    DUPLICATE_PREVENTION_WINDOW = 3e4;
    createTransporter = (config) => {
      const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
      return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.auth.user,
          pass: config.auth.pass
        },
        // Enhanced configuration for Vercel serverless functions
        tls: {
          rejectUnauthorized: false,
          // Allow self-signed certificates
          ciphers: "SSLv3"
        },
        // Reduced timeouts for serverless functions (max 10s execution time)
        connectionTimeout: isProduction2 ? 15e3 : 6e4,
        // 15s production, 60s development
        greetingTimeout: isProduction2 ? 1e4 : 3e4,
        // 10s production, 30s development
        socketTimeout: isProduction2 ? 15e3 : 6e4,
        // 15s production, 60s development
        // Add authentication method
        authMethod: "PLAIN",
        // Enable debug for troubleshooting in development only
        debug: process.env.NODE_ENV === "development",
        logger: process.env.NODE_ENV === "development",
        // Pool configuration for better performance
        pool: isProduction2 ? true : false,
        maxConnections: 1,
        // Single connection for serverless
        maxMessages: 1
        // Single message per connection for serverless
      });
    };
    getEmailConfig = () => {
      const forceDirectSMTP = process.env.FORCE_DIRECT_SMTP === "true";
      const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
      if (forceDirectSMTP && isProduction2) {
        console.log("\u{1F504} Forcing direct SMTP connection (bypassing MailChannels)");
      }
      return {
        host: process.env.EMAIL_HOST || "smtp.hostinger.com",
        port: parseInt(process.env.EMAIL_PORT || "587"),
        secure: process.env.EMAIL_SECURE === "true",
        auth: {
          user: process.env.EMAIL_USER || "",
          pass: process.env.EMAIL_PASS || ""
        }
      };
    };
    sendEmail = async (content, options) => {
      const startTime = Date.now();
      let transporter = null;
      try {
        if (options?.trackingId) {
          const lastSent = recentEmails.get(options.trackingId);
          const now = Date.now();
          if (lastSent && now - lastSent < DUPLICATE_PREVENTION_WINDOW) {
            console.log(`Preventing duplicate email for tracking ID: ${options.trackingId} (sent ${now - lastSent}ms ago)`);
            return true;
          }
          recentEmails.set(options.trackingId, now);
          if (recentEmails.size > 100) {
            const cutoffTime = now - DUPLICATE_PREVENTION_WINDOW;
            recentEmails.forEach((timestamp2, id) => {
              if (timestamp2 < cutoffTime) recentEmails.delete(id);
            });
          }
        }
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
          console.error("Email configuration is missing. Please set EMAIL_USER and EMAIL_PASS environment variables.");
          return false;
        }
        const config = getEmailConfig();
        const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
        console.log("\u{1F4E7} COMPREHENSIVE EMAIL SEND INITIATED:", {
          to: content.to,
          subject: content.subject,
          emailType: content.subject.includes("Application") ? "\u{1F3AF} APPLICATION_EMAIL" : "\u{1F4DD} SYSTEM_EMAIL",
          trackingId: options?.trackingId || `auto_${Date.now()}`,
          hasText: !!content.text,
          hasHtml: !!content.html,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          config: {
            host: config.host,
            port: config.port,
            secure: config.secure,
            user: config.auth.user ? config.auth.user.replace(/(.{3}).*@/, "$1***@") : "not set",
            domain: getDomainFromEmail(config.auth.user),
            organization: getOrganizationName(),
            hasEmailFrom: !!process.env.EMAIL_FROM,
            isProduction: isProduction2,
            environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
            vercelRegion: process.env.VERCEL_REGION || "unknown"
          }
        });
        transporter = createTransporter(config);
        const fromName = getOrganizationName();
        const fromEmail = process.env.EMAIL_FROM || `${fromName} <${config.auth.user}>`;
        if (!isProduction2) {
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error("SMTP verification timeout"));
              }, 1e4);
              transporter.verify((error, success) => {
                clearTimeout(timeout);
                if (error) {
                  console.error("SMTP connection verification failed:", error);
                  reject(error);
                } else {
                  console.log("SMTP connection verified successfully");
                  resolve(success);
                }
              });
            });
          } catch (verifyError) {
            console.error("Failed to verify SMTP connection:", verifyError);
          }
        }
        const domain = getDomainFromEmail(config.auth.user);
        const unsubscribeEmail = getUnsubscribeEmail();
        const organizationName = getOrganizationName();
        const mailOptions = {
          from: fromEmail,
          to: content.to,
          subject: content.subject,
          text: content.text,
          html: content.html,
          // Add attachments if provided (e.g., .ics calendar files)
          attachments: content.attachments || [],
          // Optimized headers for better deliverability with Hostinger SMTP
          headers: {
            "Organization": organizationName,
            "X-Mailer": "Local Cooks Community",
            // Proper sender identification for DKIM/SPF alignment
            "Sender": config.auth.user,
            "Return-Path": config.auth.user,
            "Reply-To": config.auth.user,
            // Standard priority headers (avoid high priority to reduce spam score)
            "Importance": "Normal",
            // Merge any additional headers from content
            ...content.headers || {}
          },
          // Proper encoding settings for DKIM
          encoding: "utf8",
          // Enhanced delivery options for Hostinger SMTP
          envelope: {
            from: config.auth.user,
            to: content.to
          },
          // DKIM-compatible message ID with proper domain
          messageId: `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${domain}>`,
          date: /* @__PURE__ */ new Date()
          // DKIM signing is handled by Hostinger SMTP server
        };
        let info;
        let attempts = 0;
        const maxAttempts = 2;
        while (attempts < maxAttempts) {
          attempts++;
          console.log(`\u{1F4E7} Attempt ${attempts}/${maxAttempts} sending email to ${content.to}`);
          try {
            const emailPromise = transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Email sending timeout - exceeded 25 seconds")), 25e3);
            });
            info = await Promise.race([emailPromise, timeoutPromise]);
            console.log(`\u2705 Email sent successfully on attempt ${attempts}`);
            break;
          } catch (attemptError) {
            console.warn(`\u26A0\uFE0F Attempt ${attempts} failed for ${content.to}:`, attemptError instanceof Error ? attemptError.message : String(attemptError));
            if (attempts >= maxAttempts) {
              throw attemptError;
            }
            await new Promise((resolve) => setTimeout(resolve, 1e3 * attempts));
          }
        }
        const executionTime = Date.now() - startTime;
        console.log("Email sent successfully:", {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
          domain,
          organization: organizationName,
          fromEmail,
          executionTime: `${executionTime}ms`,
          isProduction: isProduction2
        });
        if (transporter && typeof transporter.close === "function") {
          transporter.close();
        }
        return true;
      } catch (error) {
        const executionTime = Date.now() - startTime;
        console.error("Error sending email:", {
          error: error instanceof Error ? error.message : error,
          executionTime: `${executionTime}ms`,
          to: content.to,
          subject: content.subject,
          trackingId: options?.trackingId,
          isProduction: process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
        });
        if (error instanceof Error) {
          console.error("Error details:", error.message);
          if ("code" in error) {
            console.error("Error code:", error.code);
          }
          if ("responseCode" in error) {
            console.error("SMTP Response code:", error.responseCode);
          }
        }
        if (transporter && typeof transporter.close === "function") {
          try {
            transporter.close();
          } catch (closeError) {
            console.error("Error closing transporter:", closeError);
          }
        }
        return false;
      }
    };
    getDomainFromEmail = (email) => {
      if (process.env.EMAIL_DOMAIN) {
        return process.env.EMAIL_DOMAIN;
      }
      if (process.env.EMAIL_FROM) {
        const match2 = process.env.EMAIL_FROM.match(/<([^>]+)>/);
        if (match2) {
          const emailPart = match2[1];
          const domainMatch = emailPart.match(/@(.+)$/);
          if (domainMatch) {
            return domainMatch[1];
          }
        }
      }
      const match = email.match(/@(.+)$/);
      if (match) {
        return match[1];
      }
      return "localcooks.community";
    };
    getOrganizationName = () => {
      return process.env.EMAIL_ORGANIZATION || "Local Cooks Community";
    };
    getUnsubscribeEmail = () => {
      return "localcooks@localcook.shop";
    };
    getSupportEmail = () => {
      const domain = getDomainFromEmail(process.env.EMAIL_USER || "");
      return `support@${domain}`;
    };
    detectEmailProvider = (email) => {
      const emailLower = email.toLowerCase();
      const domain = emailLower.split("@")[1] || "";
      if (domain === "gmail.com" || domain === "googlemail.com" || domain.endsWith(".google.com")) {
        return "google";
      }
      if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com" || domain === "msn.com" || domain.endsWith(".outlook.com")) {
        return "outlook";
      }
      if (domain === "yahoo.com" || domain === "yahoo.co.uk" || domain === "yahoo.ca" || domain.endsWith(".yahoo.com")) {
        return "yahoo";
      }
      if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com" || domain.endsWith(".icloud.com")) {
        return "apple";
      }
      return "generic";
    };
    formatDateForCalendar = (date2) => {
      const year = date2.getUTCFullYear();
      const month = String(date2.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date2.getUTCDate()).padStart(2, "0");
      const hours = String(date2.getUTCHours()).padStart(2, "0");
      const minutes = String(date2.getUTCMinutes()).padStart(2, "0");
      const seconds = String(date2.getUTCSeconds()).padStart(2, "0");
      return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    };
    escapeIcalText = (text2) => {
      return text2.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n").replace(/\r/g, "");
    };
    generateEventUid = (bookingDate, startTime, location) => {
      const dateStr = bookingDate instanceof Date ? bookingDate.toISOString().split("T")[0] : bookingDate.split("T")[0];
      const hashInput = `${dateStr}-${startTime}-${location}`;
      let hash = 0;
      for (let i = 0; i < hashInput.length; i++) {
        const char = hashInput.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const positiveHash = Math.abs(hash).toString(36);
      return `${dateStr.replace(/-/g, "")}T${startTime.replace(/:/g, "")}-${positiveHash}@localcooks.com`;
    };
    generateIcsFile = (title, startDateTime, endDateTime, location, description, organizerEmail, attendeeEmails, eventUid) => {
      const startDateStr = formatDateForCalendar(startDateTime);
      const endDateStr = formatDateForCalendar(endDateTime);
      const now = formatDateForCalendar(/* @__PURE__ */ new Date());
      const uid = eventUid || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@localcooks.com`;
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Local Cooks Community//Kitchen Booking System//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        // Indicates this is a calendar invitation
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        // When the event was created
        `DTSTART:${startDateStr}`,
        // Start time in UTC
        `DTEND:${endDateStr}`,
        // End time in UTC
        `SUMMARY:${escapeIcalText(title)}`,
        `DESCRIPTION:${escapeIcalText(description)}`,
        `LOCATION:${escapeIcalText(location)}`,
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        // Increment on updates for synchronization
        "TRANSP:OPAQUE"
        // Indicates busy time
      ];
      if (organizerEmail) {
        lines.push(`ORGANIZER;CN=Local Cooks Community:mailto:${organizerEmail}`);
      } else {
        const supportEmail = getSupportEmail();
        lines.push(`ORGANIZER;CN=Local Cooks Community:mailto:${supportEmail}`);
      }
      if (attendeeEmails && attendeeEmails.length > 0) {
        attendeeEmails.forEach((email) => {
          if (email && email.includes("@")) {
            lines.push(`ATTENDEE;CN=${email.split("@")[0]};RSVP=TRUE;CUTYPE=INDIVIDUAL:mailto:${email}`);
          }
        });
      }
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT15M",
        // 15 minutes before
        "DESCRIPTION:Reminder: Kitchen booking in 15 minutes",
        "END:VALARM",
        "BEGIN:VALARM",
        "ACTION:EMAIL",
        "TRIGGER:-P1D",
        // 1 day before
        "DESCRIPTION:Reminder: Kitchen booking tomorrow",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
      );
      return lines.join("\r\n");
    };
    generateCalendarUrl = (email, title, bookingDate, startTime, endTime, location, description, timezone = "America/St_Johns") => {
      try {
        let bookingDateStr;
        if (bookingDate instanceof Date) {
          bookingDateStr = bookingDate.toISOString().split("T")[0];
        } else if (typeof bookingDate === "string") {
          bookingDateStr = bookingDate.split("T")[0];
        } else {
          bookingDateStr = String(bookingDate);
        }
        const startDateTime = createBookingDateTime(bookingDateStr, startTime, timezone);
        const endDateTime = createBookingDateTime(bookingDateStr, endTime, timezone);
        const startDateStr = formatDateForCalendar(startDateTime);
        const endDateStr = formatDateForCalendar(endDateTime);
        const provider = detectEmailProvider(email);
        switch (provider) {
          case "google":
            const googleParams = new URLSearchParams({
              action: "TEMPLATE",
              text: encodeURIComponent(title),
              dates: `${startDateStr}/${endDateStr}`,
              // ISO 8601 format in UTC
              details: encodeURIComponent(description),
              location: encodeURIComponent(location),
              sf: "true",
              // Show form
              output: "xml"
              // Output format
            });
            return `https://calendar.google.com/calendar/render?${googleParams.toString()}`;
          case "outlook":
            const outlookParams = new URLSearchParams({
              subject: title,
              startdt: startDateTime.toISOString(),
              enddt: endDateTime.toISOString(),
              body: description,
              location
            });
            return `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams.toString()}`;
          case "yahoo":
            const yahooParams = new URLSearchParams({
              v: "60",
              // version
              view: "d",
              type: "20",
              title,
              st: startDateStr.replace(/[-:]/g, "").replace("T", "").replace("Z", ""),
              dur: String(Math.round((endDateTime.getTime() - startDateTime.getTime()) / 6e4)),
              // duration in minutes
              desc: description,
              in_loc: location
            });
            return `https://calendar.yahoo.com/?${yahooParams.toString()}`;
          case "apple":
            const appleParams = new URLSearchParams({
              action: "TEMPLATE",
              text: title,
              dates: `${startDateStr}/${endDateStr}`,
              details: description,
              location
            });
            return `https://calendar.google.com/calendar/render?${appleParams.toString()}`;
          case "generic":
          default:
            const genericParams = new URLSearchParams({
              action: "TEMPLATE",
              text: title,
              dates: `${startDateStr}/${endDateStr}`,
              details: description,
              location
            });
            return `https://calendar.google.com/calendar/render?${genericParams.toString()}`;
        }
      } catch (error) {
        console.error("Error generating calendar URL:", error);
        return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&location=${encodeURIComponent(location)}`;
      }
    };
    getUniformEmailStyles = () => `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lobster&display=swap');
  
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
    line-height: 1.6; 
    color: #475569; 
    margin: 0; 
    padding: 0; 
    background: #f1f5f9;
  }
  .email-container { 
    max-width: 600px; 
    margin: 0 auto; 
    background: white; 
    border-radius: 12px; 
    overflow: hidden; 
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }
  .header { 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white; 
    padding: 24px 32px; 
    text-align: center; 
  }
  .header-image {
    max-width: 280px;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  .content { 
    padding: 40px 32px; 
  }
  .greeting {
    font-size: 24px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
  }
  .message {
    font-size: 16px;
    line-height: 1.6;
    color: #475569;
    margin: 0 0 24px 0;
  }
  .status-badge { 
    display: inline-block; 
    padding: 12px 20px; 
    background: linear-gradient(135deg, #fef7f7 0%, #fecaca 100%); 
    color: hsl(347, 91%, 51%); 
    border: 1px solid hsl(347, 91%, 70%);
    border-radius: 8px; 
    font-weight: 600; 
    margin: 16px 0; 
  }
  .status-badge.approved {
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    color: #16a34a;
    border-color: #bbf7d0;
  }
  .status-badge.rejected {
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    color: #dc2626;
    border-color: #fecaca;
  }
  .status-badge.cancelled {
    background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
    color: #64748b;
    border-color: #cbd5e1;
  }
  .cta-button { 
    display: inline-block; 
    padding: 14px 28px; 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white !important; 
    text-decoration: none; 
    border-radius: 8px; 
    font-weight: 600;
    margin: 24px 0;
    box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
    mso-hide: none;
    mso-text-raise: 0;
  }
  .info-box {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 20px;
    margin: 24px 0;
  }
  .credentials-table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
  }
  .credentials-table td {
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
  }
  .credentials-table td:first-child {
    font-weight: 600;
    color: hsl(347, 91%, 51%);
    background: #f8fafc;
  }
  .credentials-table code {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    color: #1e293b;
    font-weight: 600;
  }
  .footer { 
    background: #f8fafc; 
    padding: 24px 32px; 
    text-align: center; 
    border-top: 1px solid #e2e8f0;
  }
  .footer-text {
    font-size: 14px;
    color: #64748b;
    margin: 0 0 8px 0;
  }
  .footer-links {
    font-size: 13px;
    color: #94a3b8;
  }
  .footer-links a { 
    color: hsl(347, 91%, 51%); 
    text-decoration: none;
  }
  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);
    margin: 24px 0;
  }
  .warning-box {
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
  }
  .warning-text {
    font-size: 14px;
    color: #92400e;
    margin: 0;
  }
  a { color: hsl(347, 91%, 51%); text-decoration: underline; }
</style>`;
    generateStatusChangeEmail = (applicationData) => {
      const getSubjectLine = (status) => {
        switch (status) {
          case "approved":
            return "Application Approved - Local Cooks Community";
          case "rejected":
            return "Application Update - Local Cooks Community";
          case "cancelled":
            return "Application Status Update - Local Cooks Community";
          case "under_review":
            return "Application Under Review - Local Cooks Community";
          default:
            return "Application Status Update - Local Cooks Community";
        }
      };
      const subject = getSubjectLine(applicationData.status);
      const generatePlainText = (status, fullName) => {
        const statusMessages = {
          approved: `Congratulations! Your application has been approved.`,
          rejected: `Thank you for your application. After careful review, we are unable to move forward at this time.`,
          cancelled: `Your application has been cancelled.`,
          under_review: `Your application is currently under review.`,
          pending: `Your application has been received and is pending review.`
        };
        return `Hello ${fullName},

${statusMessages[status] || "Your application status has been updated."}

Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

${status === "approved" ? `Access your dashboard: ${getDashboardUrl()}

\u{1F393} NEXT STEP: Complete your food safety training to unlock all features and get certified!` : ""}${status === "cancelled" ? `

You can submit a new application anytime: ${getWebsiteUrl()}/apply` : ""}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
      };
      const getMessage = (status) => {
        switch (status) {
          case "approved":
            return "Congratulations! Your application has been approved. You now have full access to the Local Cooks platform, including our comprehensive food safety training program.";
          case "rejected":
            return "Thank you for your application. After careful review, we are unable to move forward with your application at this time. We appreciate your interest in Local Cooks.";
          case "cancelled":
            return "Your application has been cancelled. You can submit a new application anytime when you're ready to join the Local Cooks community.";
          case "under_review":
            return "Your application is currently under review by our team. We will notify you once the review is complete.";
          case "pending":
            return "Your application has been received and is pending review. We will contact you with updates soon.";
          default:
            return "Your application status has been updated. Please check your dashboard for more details.";
        }
      };
      const message = getMessage(applicationData.status);
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">${message}</p>
      <div class="status-badge${applicationData.status === "approved" ? " approved" : applicationData.status === "rejected" ? " rejected" : applicationData.status === "cancelled" ? " cancelled" : ""}">
        Status: ${applicationData.status.charAt(0).toUpperCase() + applicationData.status.slice(1)}
      </div>
      ${applicationData.status === "approved" ? `
      <div class="info-box">
        <strong>\u{1F393} Your Next Step: Food Safety Training</strong>
        <p>You now have full access to our comprehensive food safety training program. Complete all 22 training videos to:</p>
        <ul style="margin: 8px 0; padding-left: 20px;">
          <li>Earn your official Local Cooks certification</li>
          <li>Learn essential HACCP principles</li>
          <li>Access advanced platform features</li>
          <li>Build customer trust with verified status</li>
        </ul>
      </div>
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Start Food Safety Training</a>` : ""}${applicationData.status === "cancelled" ? `
      <div class="info-box">
        <strong>Ready to Apply Again?</strong>
        <p>You can submit a new application anytime when you're ready to join the Local Cooks community. We look forward to welcoming you to our platform!</p>
      </div>
      <a href="${getWebsiteUrl()}/apply" class="cta-button" style="color: white !important; text-decoration: none !important;">Submit New Application</a>` : ""}
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: applicationData.email,
        subject,
        text: generatePlainText(applicationData.status, applicationData.fullName),
        html
      };
    };
    generateVendorCredentials = (fullName, phone) => {
      let cleanPhone = phone.replace(/[^0-9]/g, "");
      if (cleanPhone.length === 11 && cleanPhone.startsWith("1")) {
        cleanPhone = cleanPhone.substring(1);
      }
      const username = cleanPhone;
      const namePrefix = fullName.replace(/[^a-zA-Z]/g, "").toLowerCase().substring(0, 3) || "usr";
      const phoneSuffix = cleanPhone.slice(-4) || "0000";
      const password = namePrefix + phoneSuffix;
      return { username, password };
    };
    generateFullVerificationEmail = (userData) => {
      const { username, password } = generateVendorCredentials(userData.fullName, userData.phone);
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chef Account Approved - Login Credentials Included</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Congratulations ${userData.fullName}!</h2>
      <p class="message">
        Your documents have been approved and you are now <strong>fully verified</strong>! You can now start accepting orders and serving customers through our Local Cooks platform.
      </p>
      <div class="status-badge approved">Status: Approved</div>
      
      <div class="info-box">
        <strong>Your Login Credentials:</strong>
        <table class="credentials-table">
          <tr>
            <td>Username:</td>
            <td><code>${username}</code></td>
          </tr>
          <tr>
            <td>Password:</td>
            <td><code>${password}</code></td>
          </tr>
        </table>
      </div>
      
      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> Please change your password after your first login for security.
        </p>
      </div>
      
      <div class="info-box">
        <strong>\u{1F680} Next Steps - Choose Your Path:</strong>
        <p>You now have two important accounts to set up:</p>
      </div>
      
      <div style="text-align: center; margin: 24px 0; width: 100%;">
        <div style="display: block; margin: 0 auto; max-width: 320px;">
          <a href="https://localcook.shop/app/shop/index.php" class="cta-button" style="display: block; width: 100%; background: #2563eb; color: white !important; margin-bottom: 16px; box-sizing: border-box;">
            \u{1F468}\u200D\u{1F373} Access Chef Dashboard
          </a>
          <a href="${getVendorDashboardUrl()}" class="cta-button" style="display: block; width: 100%; background: #16a34a; color: white !important; box-sizing: border-box;">
            \u{1F4B3} Set Up Stripe Payments
          </a>
        </div>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          <strong>\u{1F468}\u200D\u{1F373} Chef Dashboard:</strong> Use your credentials above to log into your chef dashboard where you can manage your profile, products, and orders.
          <br><br>
          <strong>\u{1F4B3} Stripe Payments:</strong> Set up your payment processing to start receiving payments from customers. This is required to get paid for orders.
        </p>
      </div>
      
      <div class="divider"></div>
      
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks Community</strong>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject: "Chef Account Approved - Login Credentials Included",
        html,
        headers: {
          "X-Priority": "3",
          "X-MSMail-Priority": "Normal",
          "Importance": "Normal",
          "List-Unsubscribe": `<mailto:${getUnsubscribeEmail()}>`
        }
      };
    };
    generateApplicationWithDocumentsEmail = (applicationData) => {
      const supportEmail = getSupportEmail();
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application and Documents Received - Under Review</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to Local Cooks! We have received both your application and your supporting documents.
      </p>
      <p class="message">
        Our team will now review your application and documents together. You'll receive another email once the review is complete.
      </p>
      <div class="status-badge">Status: Under Review</div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: applicationData.email,
        subject: "Application and Documents Received - Under Review",
        html
      };
    };
    generateApplicationWithoutDocumentsEmail = (applicationData) => {
      const supportEmail = getSupportEmail();
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Cooks Application Confirmation - Next Steps</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${applicationData.fullName},</h2>
      <p class="message">
        Thank you for submitting your application to Local Cooks! We have received your application and it will be reviewed soon.
      </p>
      <p class="message">
        <strong>Next Steps:</strong> Please visit your dashboard to upload the required documents to complete your application.
      </p>
      <div class="status-badge">Status: Under Review</div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${supportEmail}" class="footer-links">${supportEmail}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: applicationData.email,
        subject: "Local Cooks Application Confirmation - Next Steps",
        html
      };
    };
    generateDocumentStatusChangeEmail = (userData) => {
      const getSubjectLine = (documentType, status) => {
        const docName2 = documentType === "foodSafetyLicenseStatus" ? "Food Safety License" : "Food Establishment Certificate";
        switch (status) {
          case "approved":
            return `${docName2} Approved - Local Cooks Community`;
          case "rejected":
            return `${docName2} Update Required - Local Cooks Community`;
          default:
            return `${docName2} Status Update - Local Cooks Community`;
        }
      };
      const subject = getSubjectLine(userData.documentType, userData.status);
      const generatePlainText = (documentType, status, fullName, adminFeedback) => {
        const docName2 = documentType === "foodSafetyLicenseStatus" ? "Food Safety License" : "Food Establishment Certificate";
        const statusMessages = {
          approved: `Great news! Your ${docName2} has been approved.`,
          rejected: `Your ${docName2} requires some updates before it can be approved.`,
          pending: `Your ${docName2} is being reviewed by our team.`
        };
        return `Hello ${fullName},

${statusMessages[status] || `Your ${docName2} status has been updated.`}

Document: ${docName2}
Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

${adminFeedback ? `Admin Feedback: ${adminFeedback}

` : ""}${status === "approved" ? `Access your dashboard: ${getDashboardUrl()}` : status === "rejected" ? `Please update your document and resubmit: ${getDashboardUrl()}` : ""}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
      };
      const getMessage = (documentType, status) => {
        const docName2 = documentType === "foodSafetyLicenseStatus" ? "Food Safety License" : "Food Establishment Certificate";
        switch (status) {
          case "approved":
            return `Congratulations! Your ${docName2} has been approved by our verification team. This brings you one step closer to being fully verified on Local Cooks.`;
          case "rejected":
            return `Your ${docName2} could not be approved at this time. Please review the feedback below and upload an updated document.`;
          case "pending":
            return `Your ${docName2} is currently being reviewed by our verification team. We will notify you once the review is complete.`;
          default:
            return `Your ${docName2} status has been updated. Please check your dashboard for more details.`;
        }
      };
      const message = getMessage(userData.documentType, userData.status);
      const docName = userData.documentType === "foodSafetyLicenseStatus" ? "Food Safety License" : "Food Establishment Certificate";
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">${message}</p>
      <div class="status-badge${userData.status === "approved" ? " approved" : userData.status === "rejected" ? " rejected" : ""}">
        \u{1F4C4} ${docName}: ${userData.status.charAt(0).toUpperCase() + userData.status.slice(1)}
      </div>
      ${userData.adminFeedback ? `
      <div class="info-box">
        <strong>\u{1F4AC} Admin Feedback:</strong><br>
        ${userData.adminFeedback}
      </div>` : ""}
      ${userData.status === "approved" ? `<a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>` : userData.status === "rejected" ? `<a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Update Document</a>` : ""}
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject,
        text: generatePlainText(userData.documentType, userData.status, userData.fullName, userData.adminFeedback),
        html
      };
    };
    generatePasswordResetEmail = (userData) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Request - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        We received a request to reset your password for your Local Cooks account. If you didn't make this request, you can safely ignore this email.
      </p>
      <p class="message">
        Click the button below to create a new password. This link will expire in 1 hour for security.
      </p>
      <a href="${userData.resetUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Reset My Password</a>
      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> If you didn't request this password reset, please contact our support team immediately.
        </p>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Keep your account secure with <strong>Local Cooks</strong></p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject: "Password Reset Request - Local Cooks",
        html,
        headers: {
          "X-Priority": "3",
          "X-MSMail-Priority": "Normal",
          "Importance": "Normal",
          "List-Unsubscribe": `<mailto:${getUnsubscribeEmail()}>`
        }
      };
    };
    generateEmailVerificationEmail = (userData) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification Required - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Welcome ${userData.fullName}!</h2>
      <p class="message">
        Thank you for joining Local Cooks Community! We're excited to have you on board.
      </p>
      <p class="message">
        To complete your registration and activate your account, please verify your email address by clicking the button below.
      </p>
      <a href="${userData.verificationUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Verify My Email</a>
      <div class="status-badge">Status: Verification Required</div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to the <strong>Local Cooks</strong> community!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject: "Email Verification Required - Local Cooks",
        html,
        headers: {
          "X-Priority": "3",
          "X-MSMail-Priority": "Normal",
          "Importance": "Normal",
          "List-Unsubscribe": `<mailto:${getUnsubscribeEmail()}>`
        }
      };
    };
    generateWelcomeEmail = (userData) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Created - Local Cooks Community</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        Welcome to Local Cooks Community! Your account has been successfully created and verified.
      </p>
      <p class="message">
        You can now access your dashboard to complete your profile setup and start your food safety training modules.
      </p>
      <div class="status-badge approved">Status: Account Active</div>
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for joining <strong>Local Cooks</strong> Community!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject: "Account Created - Local Cooks Community",
        html
      };
    };
    getSubdomainUrl = (userType = "main") => {
      const baseDomain = process.env.BASE_DOMAIN || "localcooks.ca";
      if (process.env.NODE_ENV !== "production" && !process.env.BASE_URL) {
        return "http://localhost:5000";
      }
      if (process.env.BASE_URL && !process.env.BASE_URL.includes("localhost")) {
        const url = new URL(process.env.BASE_URL);
        const hostname = url.hostname;
        const parts = hostname.split(".");
        if (parts.length >= 3) {
          return process.env.BASE_URL;
        }
        if (userType === "main") {
          return process.env.BASE_URL;
        }
        return `https://${userType}.${baseDomain}`;
      }
      if (userType === "main") {
        return `https://${baseDomain}`;
      }
      return `https://${userType}.${baseDomain}`;
    };
    getWebsiteUrl = () => {
      return getSubdomainUrl("main");
    };
    getDashboardUrl = (userType = "chef") => {
      const baseUrl = getSubdomainUrl(userType);
      if (userType === "chef") {
        return `${baseUrl}/auth?redirect=/dashboard`;
      } else if (userType === "kitchen") {
        return `${baseUrl}/portal`;
      } else if (userType === "admin") {
        return `${baseUrl}/admin`;
      }
      return `${baseUrl}/auth?redirect=/dashboard`;
    };
    getPrivacyUrl = () => {
      const baseUrl = getWebsiteUrl();
      return `${baseUrl}/privacy`;
    };
    getVendorDashboardUrl = () => {
      return process.env.VENDOR_DASHBOARD_URL || "https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php";
    };
    getPromoUrl = () => {
      return "https://localcook.shop/app/index.php";
    };
    generateDocumentUpdateEmail = (userData) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Update Received - Local Cooks</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        Thank you for updating your documents. Our team will review them and update your verification status as soon as possible.
      </p>
      <p class="message">
        You'll receive another email once your documents have been reviewed.
      </p>
      <div class="status-badge">
        \u{1F4C4} Document Update Received
      </div>
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Thank you for your interest in <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject: "Document Update Received - Local Cooks",
        html,
        headers: {
          "X-Priority": "3",
          "X-MSMail-Priority": "Normal",
          "Importance": "Normal",
          "List-Unsubscribe": `<mailto:${getUnsubscribeEmail()}>`
        }
      };
    };
    generatePromoCodeEmail = (userData) => {
      const organizationName = getOrganizationName();
      const supportEmail = getSupportEmail();
      const defaultPromoStyle = userData.promoStyle || { colorTheme: "green", borderStyle: "dashed" };
      const messageContent = userData.customMessage || userData.message || "";
      const getSectionData = (sectionId) => {
        if (!userData.sections) return null;
        if (Array.isArray(userData.sections)) {
          return userData.sections.find((s) => s.id === sectionId || s.id === `${sectionId}-section`) || null;
        }
        if (typeof userData.sections === "object") {
          return userData.sections[sectionId] || userData.sections[`${sectionId}-section`] || userData.sections[sectionId.replace("-section", "")] || null;
        }
        return null;
      };
      const getPromoStyling = (colorTheme, borderStyle) => {
        const themes = {
          green: {
            background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
            textColor: "#16a34a",
            accentColor: "#15803d",
            borderColor: "#16a34a",
            border: "2px dashed #16a34a",
            boxShadow: "0 4px 16px rgba(22, 163, 74, 0.15)"
          },
          blue: {
            background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            textColor: "#2563eb",
            accentColor: "#1d4ed8",
            borderColor: "#2563eb",
            border: "2px dashed #2563eb",
            boxShadow: "0 4px 16px rgba(37, 99, 235, 0.15)"
          },
          purple: {
            background: "linear-gradient(135deg, #faf5ff 0%, #e9d5ff 100%)",
            textColor: "#7c3aed",
            accentColor: "#6d28d9",
            borderColor: "#7c3aed",
            border: "2px dashed #7c3aed",
            boxShadow: "0 4px 16px rgba(124, 58, 237, 0.15)"
          },
          red: {
            background: "linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)",
            textColor: "#dc2626",
            accentColor: "#b91c1c",
            borderColor: "#dc2626",
            border: "2px dashed #dc2626",
            boxShadow: "0 4px 16px rgba(220, 38, 38, 0.15)"
          },
          orange: {
            background: "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)",
            textColor: "#ea580c",
            accentColor: "#c2410c",
            borderColor: "#ea580c",
            border: "2px dashed #ea580c",
            boxShadow: "0 4px 16px rgba(234, 88, 12, 0.15)"
          },
          pink: {
            background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)",
            textColor: "#e11d48",
            accentColor: "#be185d",
            borderColor: "#e11d48",
            border: "2px dashed #e11d48",
            boxShadow: "0 4px 16px rgba(225, 29, 72, 0.15)"
          },
          yellow: {
            background: "linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)",
            textColor: "#ca8a04",
            accentColor: "#a16207",
            borderColor: "#ca8a04",
            border: "2px dashed #ca8a04",
            boxShadow: "0 4px 16px rgba(202, 138, 4, 0.15)"
          },
          gray: {
            background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
            textColor: "#475569",
            accentColor: "#334155",
            borderColor: "#475569",
            border: "2px dashed #475569",
            boxShadow: "0 4px 16px rgba(71, 85, 105, 0.15)"
          }
        };
        const theme = themes[colorTheme] || themes.green;
        if (borderStyle === "solid") {
          theme.border = `2px solid ${theme.borderColor}`;
        } else if (borderStyle === "dotted") {
          theme.border = `2px dotted ${theme.borderColor}`;
        }
        return theme;
      };
      const generateAdvancedSections = (sections = []) => {
        return sections.map((section) => {
          switch (section.type) {
            case "text":
              const hasBackground = section.styling?.backgroundColor && section.styling.backgroundColor !== "transparent";
              const paddingValue = hasBackground ? "12px" : section.styling?.padding || "8px 0";
              return `
            <div style="
              font-size: ${section.styling?.fontSize || "16px"};
              color: ${section.styling?.color || "#374151"};
              font-weight: ${section.styling?.fontWeight || "400"};
              font-style: ${section.styling?.fontStyle || "normal"};
              text-align: ${section.styling?.textAlign || "left"};
              padding: ${paddingValue};
              margin: ${section.styling?.margin || "0"};
              line-height: 1.6;
              ${hasBackground ? `background: ${section.styling.backgroundColor};` : ""}
              ${hasBackground ? `border-radius: 8px;` : ""}
            ">
              ${section.content || section.text || ""}
            </div>
          `;
            case "button":
              return `
            <div style="text-align: ${section.styling?.textAlign || "center"}; margin: 20px 0;">
              <a href="${section.styling?.url || getPromoUrl()}" style="
                display: inline-block;
                background: ${section.styling?.backgroundColor || styling.accentColor};
                color: ${section.styling?.color || "#ffffff"} !important;
                text-decoration: none !important;
                padding: ${section.styling?.padding || "12px 24px"};
                border-radius: 6px;
                font-weight: ${section.styling?.fontWeight || "600"};
                font-size: ${section.styling?.fontSize || "16px"};
                border: none;
                cursor: pointer;
              ">
                ${section.content || section.text || "Click Here"}
              </a>
            </div>
          `;
            case "image":
              if (section.content) {
                const hasOverlay = section.overlay?.enabled && section.overlay?.text;
                if (hasOverlay) {
                  return `
                <div style="text-align: ${section.styling?.textAlign || "center"}; margin: 20px 0;">
                  <div style="position: relative; display: inline-block; width: ${section.styling?.width || "200px"}; height: ${section.styling?.height || "120px"};">
                    <img 
                      src="${section.content}" 
                      alt="Email image"
                      style="
                        width: 100%;
                        height: 100%;
                        object-fit: ${section.styling?.objectFit || "cover"};
                        border-radius: ${section.styling?.borderRadius || "8px"};
                        border: 1px solid #e2e8f0;
                        display: block;
                        max-width: 100%;
                      "
                    />
                    <!--[if mso]>
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10;">
                    <![endif]-->
                    <div style="
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -50%);
                      color: ${section.overlay.styling?.color || "#ffffff"};
                      font-size: ${section.overlay.styling?.fontSize || "18px"};
                      font-weight: ${section.overlay.styling?.fontWeight || "600"};
                      text-align: center;
                      background-color: ${section.overlay.styling?.backgroundColor || "rgba(0, 0, 0, 0.5)"};
                      padding: ${section.overlay.styling?.padding || "12px 20px"};
                      border-radius: ${section.overlay.styling?.borderRadius || "6px"};
                      text-shadow: ${section.overlay.styling?.textShadow || "1px 1px 2px rgba(0, 0, 0, 0.7)"};
                      max-width: 90%;
                      word-wrap: break-word;
                      z-index: 10;
                      line-height: 1.4;
                    ">
                      ${section.overlay.text}
                    </div>
                    <!--[if mso]>
                    </div>
                    <![endif]-->
                  </div>
                </div>
              `;
                } else {
                  return `
                <div style="text-align: ${section.styling?.textAlign || "center"}; margin: 20px 0;">
                  <img 
                    src="${section.content}" 
                    alt="Email image"
                    style="
                      width: ${section.styling?.width || "200px"};
                      height: ${section.styling?.height || "120px"};
                      object-fit: ${section.styling?.objectFit || "cover"};
                      border-radius: ${section.styling?.borderRadius || "8px"};
                      border: 1px solid #e2e8f0;
                      display: block;
                      max-width: 100%;
                    "
                  />
                </div>
              `;
                }
              }
              return "";
            default:
              return "";
          }
        }).join("");
      };
      const generateDivider = () => {
        if (!userData.dividers?.enabled) return "";
        return `
      <div style="margin: ${userData.dividers.margin || "24px 0"};">
        <hr style="
          border: none;
          border-top: ${userData.dividers.thickness || "1px"} ${userData.dividers.style || "solid"} ${userData.dividers.color || "#e2e8f0"};
          opacity: ${userData.dividers.opacity || "1"};
          margin: 0;
        " />
      </div>
    `;
      };
      const getGreeting = () => {
        const greetingSection = getSectionData("greeting") || getSectionData("greeting-section");
        if (greetingSection?.content || greetingSection?.text) {
          return greetingSection.content || greetingSection.text;
        }
        return userData.greeting || "Hello! \u{1F44B}";
      };
      const getCustomMessage = () => {
        const messageSection = getSectionData("custom-message") || getSectionData("custom-message-section");
        if (messageSection?.content || messageSection?.text) {
          return messageSection.content || messageSection.text;
        }
        return messageContent || "Thank you for being a valued customer!";
      };
      const generatePlainText = (email, promoCode, customMessage) => {
        if (promoCode) {
          return `Special Promo Code from ${organizationName}

${customMessage}

Your Promo Code: ${promoCode}

To use your promo code:
1. Visit our website: ${getPromoUrl()}
2. Apply during checkout or registration
3. Enjoy your special offer!

Questions? Contact us at ${supportEmail}

Best regards,
${organizationName} Team

Visit: ${getPromoUrl()}
`;
        } else {
          return `Message from ${organizationName}

${customMessage}

Questions? Contact us at ${supportEmail}

Best regards,
${organizationName} Team

Visit: ${getPromoUrl()}
`;
        }
      };
      const subject = userData.subject || (userData.promoCode ? `\u{1F381} Exclusive Promo Code: ${userData.promoCode}` : "Important Update from Local Cooks Community");
      const styling = getPromoStyling(defaultPromoStyle.colorTheme, defaultPromoStyle.borderStyle);
      const finalGreeting = getGreeting();
      const finalMessage = getCustomMessage();
      const generateUsageStepsSection = () => {
        const defaultSteps = [
          `Visit our website: <a href="${userData.orderButton?.url || getPromoUrl()}" style="color: ${userData.usageSteps?.styling?.linkColor || "#1d4ed8"};">${userData.orderButton?.url || getPromoUrl()}</a>`,
          "Browse our amazing local cooks and their delicious offerings",
          "Apply your promo code during checkout",
          "Enjoy your special offer!"
        ];
        const steps = userData.usageSteps?.steps && userData.usageSteps.steps.length > 0 ? userData.usageSteps.steps : defaultSteps;
        const stepsHtml = steps.map((step) => `<li>${step}</li>`).join("");
        return `
      <div class="usage-steps">
        <h4>${userData.usageSteps?.title || "\u{1F680} How to use your promo code:"}</h4>
        <ol>
          ${stepsHtml}
        </ol>
      </div>
      ${generateDivider()}
    `;
      };
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
  <style>
    /* Override email container styles for customization */
    body { 
      background: ${userData.emailContainer?.backgroundColor || "#f1f5f9"} !important;
      ${userData.emailContainer?.backgroundImage ? `background-image: url(${userData.emailContainer.backgroundImage}) !important;` : ""}
      ${userData.emailContainer?.backgroundSize ? `background-size: ${userData.emailContainer.backgroundSize} !important;` : ""}
      ${userData.emailContainer?.backgroundPosition ? `background-position: ${userData.emailContainer.backgroundPosition} !important;` : ""}
      ${userData.emailContainer?.backgroundRepeat ? `background-repeat: ${userData.emailContainer.backgroundRepeat} !important;` : ""}
      ${userData.emailContainer?.backgroundAttachment ? `background-attachment: ${userData.emailContainer.backgroundAttachment} !important;` : ""}
    }
    .email-container { 
      max-width: ${userData.emailContainer?.maxWidth || "600px"} !important; 
      border-radius: ${userData.emailContainer?.borderRadius || "12px"} !important; 
      box-shadow: ${userData.emailContainer?.boxShadow || "0 4px 20px rgba(0,0,0,0.08)"} !important;
    }
    
    .promo-code-box {
      background: ${userData.promoCodeStyling?.backgroundColor || "#f3f4f6"};
      border: ${userData.promoCodeStyling?.borderWidth || userData.promoCodeStyling?.borderStyle || userData.promoCodeStyling?.borderColor ? `${userData.promoCodeStyling?.borderWidth || "2px"} ${userData.promoCodeStyling?.borderStyle || "dashed"} ${userData.promoCodeStyling?.borderColor || "#9ca3af"}` : "2px dashed #9ca3af"};
      border-radius: ${userData.promoCodeStyling?.borderRadius || "12px"};
      padding: ${userData.promoCodeStyling?.padding || "20px"};
      box-shadow: ${userData.promoCodeStyling?.boxShadow || "0 2px 4px rgba(0,0,0,0.1)"};
      display: inline-block;
      min-width: 200px;
    }
    .promo-code {
      font-family: 'Courier New', monospace;
      font-size: ${userData.promoCodeStyling?.fontSize || "24px"};
      font-weight: ${userData.promoCodeStyling?.fontWeight || "bold"};
      color: ${userData.promoCodeStyling?.textColor || "#1f2937"};
      letter-spacing: 2px;
      margin: 0;
    }
    .promo-label {
      font-size: ${userData.promoCodeStyling?.labelFontSize || "16px"};
      font-weight: ${userData.promoCodeStyling?.labelFontWeight || "600"};
      color: ${userData.promoCodeStyling?.labelColor || "#374151"};
      margin: 0;
      text-align: center;
    }
    .greeting {
      font-size: ${getSectionData("greeting")?.styling?.fontSize || getSectionData("greeting-section")?.styling?.fontSize || "18px"};
      font-weight: ${getSectionData("greeting")?.styling?.fontWeight || getSectionData("greeting-section")?.styling?.fontWeight || "normal"};
      font-style: ${getSectionData("greeting")?.styling?.fontStyle || getSectionData("greeting-section")?.styling?.fontStyle || "normal"};
      color: ${getSectionData("greeting")?.styling?.color || getSectionData("greeting-section")?.styling?.color || "#1f2937"};
      text-align: ${getSectionData("greeting")?.styling?.textAlign || getSectionData("greeting-section")?.styling?.textAlign || "left"};
      line-height: ${getSectionData("greeting")?.styling?.lineHeight || getSectionData("greeting-section")?.styling?.lineHeight || "1.6"};
      letter-spacing: ${getSectionData("greeting")?.styling?.letterSpacing || getSectionData("greeting-section")?.styling?.letterSpacing || "normal"};
      text-transform: ${getSectionData("greeting")?.styling?.textTransform || getSectionData("greeting-section")?.styling?.textTransform || "none"};
      margin: ${getSectionData("greeting")?.styling?.margin || getSectionData("greeting-section")?.styling?.margin || "0"};
      ${getSectionData("greeting")?.styling?.marginTop ? `margin-top: ${getSectionData("greeting")?.styling?.marginTop};` : ""}
      ${getSectionData("greeting")?.styling?.marginRight ? `margin-right: ${getSectionData("greeting")?.styling?.marginRight};` : ""}
      ${getSectionData("greeting")?.styling?.marginBottom ? `margin-bottom: ${getSectionData("greeting")?.styling?.marginBottom || "16px"};` : "margin-bottom: 16px;"}
      ${getSectionData("greeting")?.styling?.marginLeft ? `margin-left: ${getSectionData("greeting")?.styling?.marginLeft};` : ""}
      padding: ${getSectionData("greeting")?.styling?.padding || getSectionData("greeting-section")?.styling?.padding || "0"};
      ${getSectionData("greeting")?.styling?.paddingTop ? `padding-top: ${getSectionData("greeting")?.styling?.paddingTop};` : ""}
      ${getSectionData("greeting")?.styling?.paddingRight ? `padding-right: ${getSectionData("greeting")?.styling?.paddingRight};` : ""}
      ${getSectionData("greeting")?.styling?.paddingBottom ? `padding-bottom: ${getSectionData("greeting")?.styling?.paddingBottom};` : ""}
      ${getSectionData("greeting")?.styling?.paddingLeft ? `padding-left: ${getSectionData("greeting")?.styling?.paddingLeft};` : ""}
    }
    .custom-message {
      font-size: ${getSectionData("custom-message")?.styling?.fontSize || getSectionData("custom-message-section")?.styling?.fontSize || "16px"};
      font-weight: ${getSectionData("custom-message")?.styling?.fontWeight || getSectionData("custom-message-section")?.styling?.fontWeight || "normal"};
      font-style: ${getSectionData("custom-message")?.styling?.fontStyle || getSectionData("custom-message-section")?.styling?.fontStyle || "normal"};
      color: ${getSectionData("custom-message")?.styling?.color || getSectionData("custom-message-section")?.styling?.color || "#374151"};
      text-align: ${getSectionData("custom-message")?.styling?.textAlign || getSectionData("custom-message-section")?.styling?.textAlign || "left"};
      line-height: ${getSectionData("custom-message")?.styling?.lineHeight || getSectionData("custom-message-section")?.styling?.lineHeight || "1.7"};
      letter-spacing: ${getSectionData("custom-message")?.styling?.letterSpacing || getSectionData("custom-message-section")?.styling?.letterSpacing || "normal"};
      text-transform: ${getSectionData("custom-message")?.styling?.textTransform || getSectionData("custom-message-section")?.styling?.textTransform || "none"};
      white-space: pre-line; /* Preserves line breaks from admin input */
      margin: ${getSectionData("custom-message")?.styling?.margin || getSectionData("custom-message-section")?.styling?.margin || "24px 0"};
      ${getSectionData("custom-message")?.styling?.marginTop ? `margin-top: ${getSectionData("custom-message")?.styling?.marginTop};` : ""}
      ${getSectionData("custom-message")?.styling?.marginRight ? `margin-right: ${getSectionData("custom-message")?.styling?.marginRight};` : ""}
      ${getSectionData("custom-message")?.styling?.marginBottom ? `margin-bottom: ${getSectionData("custom-message")?.styling?.marginBottom};` : ""}
      ${getSectionData("custom-message")?.styling?.marginLeft ? `margin-left: ${getSectionData("custom-message")?.styling?.marginLeft};` : ""}
      padding: ${getSectionData("custom-message")?.styling?.padding || getSectionData("custom-message-section")?.styling?.padding || "0"};
      ${getSectionData("custom-message")?.styling?.paddingTop ? `padding-top: ${getSectionData("custom-message")?.styling?.paddingTop};` : ""}
      ${getSectionData("custom-message")?.styling?.paddingRight ? `padding-right: ${getSectionData("custom-message")?.styling?.paddingRight};` : ""}
      ${getSectionData("custom-message")?.styling?.paddingBottom ? `padding-bottom: ${getSectionData("custom-message")?.styling?.paddingBottom};` : ""}
      ${getSectionData("custom-message")?.styling?.paddingLeft ? `padding-left: ${getSectionData("custom-message")?.styling?.paddingLeft};` : ""}
    }
    .custom-header {
      background: ${userData.header?.styling?.backgroundColor || "linear-gradient(135deg, #F51042 0%, #FF5470 100%)"};
      ${userData.header?.styling?.backgroundImage ? `background-image: url(${userData.header.styling.backgroundImage});` : ""}
      ${userData.header?.styling?.backgroundSize ? `background-size: ${userData.header.styling.backgroundSize};` : ""}
      ${userData.header?.styling?.backgroundPosition ? `background-position: ${userData.header.styling.backgroundPosition};` : ""}
      ${userData.header?.styling?.backgroundRepeat ? `background-repeat: ${userData.header.styling.backgroundRepeat};` : ""}
      ${userData.header?.styling?.backgroundAttachment ? `background-attachment: ${userData.header.styling.backgroundAttachment};` : ""}
      border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      -webkit-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      -moz-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      border-top-left-radius: ${userData.emailContainer?.borderRadius || "12px"};
      border-top-right-radius: ${userData.emailContainer?.borderRadius || "12px"};
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      padding: ${userData.header?.styling?.padding || "24px 32px"};
      text-align: ${userData.header?.styling?.textAlign || "center"};
      margin: 0 0 24px 0;
      overflow: hidden;
    }
    .custom-header h1 {
      color: ${userData.header?.styling?.titleColor || "#ffffff"};
      font-size: ${userData.header?.styling?.titleFontSize || "32px"};
      font-weight: 700;
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    .custom-header p {
      color: ${userData.header?.styling?.subtitleColor || "#ffffff"};
      font-size: ${userData.header?.styling?.subtitleFontSize || "18px"};
      margin: 0;
      opacity: 0.9;
    }
    .custom-order-button {
      display: inline-block;
      background: ${userData.orderButton?.styling?.backgroundColor || "linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)"};
      color: ${userData.orderButton?.styling?.color || "#ffffff"} !important;
      text-decoration: none !important;
      padding: ${userData.orderButton?.styling?.padding || "14px 28px"};
      border-radius: ${userData.orderButton?.styling?.borderRadius || "8px"};
      font-weight: ${userData.orderButton?.styling?.fontWeight || "600"};
      font-size: ${userData.orderButton?.styling?.fontSize || "16px"};
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
      line-height: 1.4;
      text-align: center;
      word-wrap: break-word;
      word-break: break-word;
      hyphens: auto;
      max-width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      vertical-align: middle;
    }
    .usage-steps {
      background: ${userData.usageSteps?.styling?.backgroundColor || "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)"};
      border: 1px solid ${userData.usageSteps?.styling?.borderColor || "#93c5fd"};
      border-radius: ${userData.usageSteps?.styling?.borderRadius || "8px"};
      padding: ${userData.usageSteps?.styling?.padding || "20px"};
      margin: 24px 0;
    }
    .usage-steps h4 {
      color: ${userData.usageSteps?.styling?.titleColor || "#1d4ed8"};
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 12px 0;
    }
    .usage-steps ol {
      margin: 0;
      padding-left: 20px;
      color: ${userData.usageSteps?.styling?.textColor || "#1e40af"};
    }
    .usage-steps li {
      margin: 6px 0;
      font-size: 14px;
    }
    .custom-footer {
      background: ${userData.footer?.styling?.backgroundColor || "#f8fafc"};
      padding: ${userData.footer?.styling?.padding || "24px 32px"};
      text-align: ${userData.footer?.styling?.textAlign || "center"};
      border-top: 1px solid ${userData.footer?.styling?.borderColor || "#e2e8f0"};
    }
    .custom-footer .footer-text {
      font-size: ${userData.footer?.styling?.fontSize || "14px"};
      color: ${userData.footer?.styling?.textColor || "#64748b"};
      margin: 0 0 8px 0;
      line-height: 1.5;
    }
    .custom-footer .footer-link {
      color: ${userData.footer?.styling?.linkColor || "#F51042"};
      text-decoration: none;
    }
    .cta-container {
      text-align: ${userData.orderButton?.styling?.textAlign || "center"};
      margin: 32px 0;
      padding: 0 20px;
      overflow: hidden;
    }
    
    /* Mobile-specific styles */
    @media only screen and (max-width: 600px) {
      .email-container {
        max-width: ${userData.emailContainer?.mobileMaxWidth || "100%"} !important;
        padding: ${userData.emailContainer?.mobilePadding || "16px"} !important;
      }
      
      .greeting {
        font-size: calc(${getSectionData("greeting")?.styling?.fontSize || "18px"} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-message {
        font-size: calc(${getSectionData("custom-message")?.styling?.fontSize || "16px"} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-order-button {
        ${userData.emailContainer?.mobileButtonSize === "full-width" ? "width: calc(100% - 40px) !important; display: block !important; text-align: center !important; margin: 0 auto !important;" : ""}
        ${userData.emailContainer?.mobileButtonSize === "large" ? "padding: 16px 32px !important; font-size: 18px !important; min-height: 56px !important;" : ""}
        ${userData.emailContainer?.mobileButtonSize === "small" ? "padding: 10px 20px !important; font-size: 14px !important; min-height: 40px !important;" : ""}
        line-height: 1.3 !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        max-width: calc(100% - 40px) !important;
      }
      
      .promo-code-box {
        padding: 16px !important;
        margin: 16px 0 !important;
      }
      
      .promo-code {
        font-size: calc(${userData.promoCodeStyling?.fontSize || "24px"} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-header {
        padding: 20px 16px !important;
        border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")} !important;
        -webkit-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")} !important;
        -moz-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")} !important;
        border-top-left-radius: ${userData.emailContainer?.borderRadius || "12px"} !important;
        border-top-right-radius: ${userData.emailContainer?.borderRadius || "12px"} !important;
        overflow: hidden !important;
      }
      
      .custom-header h1 {
        font-size: calc(${userData.header?.styling?.titleFontSize || "32px"} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .custom-header p {
        font-size: calc(${userData.header?.styling?.subtitleFontSize || "18px"} * ${userData.emailContainer?.mobileFontScale ? parseFloat(userData.emailContainer.mobileFontScale) / 100 : 1}) !important;
      }
      
      .usage-steps {
        padding: 16px !important;
        margin: 16px 0 !important;
      }
      
      .custom-footer {
        padding: 20px 16px !important;
      }
    }
    
    /* Additional mobile email client compatibility */
    @media screen and (max-width: 480px) {
      .custom-header {
        border-radius: ${userData.emailContainer?.borderRadius || "12px"} ${userData.emailContainer?.borderRadius || "12px"} 0 0 !important;
        -webkit-border-top-left-radius: ${userData.emailContainer?.borderRadius || "12px"} !important;
        -webkit-border-top-right-radius: ${userData.emailContainer?.borderRadius || "12px"} !important;
        -webkit-border-bottom-left-radius: 0 !important;
        -webkit-border-bottom-right-radius: 0 !important;
      }
    }
    
    /* Gmail mobile app specific fixes */
    u + .body .custom-header {
      border-radius: ${userData.emailContainer?.borderRadius || "12px"} ${userData.emailContainer?.borderRadius || "12px"} 0 0 !important;
    }
    
    /* Outlook mobile app specific fixes */
    .ExternalClass .custom-header {
      border-radius: ${userData.emailContainer?.borderRadius || "12px"} ${userData.emailContainer?.borderRadius || "12px"} 0 0 !important;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="custom-header" style="
      background: ${userData.header?.styling?.backgroundColor || "linear-gradient(135deg, #F51042 0%, #FF5470 100%)"};
      border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      -webkit-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      -moz-border-radius: ${userData.header?.styling?.borderRadius || (userData.emailContainer?.borderRadius ? `${userData.emailContainer.borderRadius} ${userData.emailContainer.borderRadius} 0 0` : "12px 12px 0 0")};
      border-top-left-radius: ${userData.emailContainer?.borderRadius || "12px"};
      border-top-right-radius: ${userData.emailContainer?.borderRadius || "12px"};
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      padding: ${userData.header?.styling?.padding || "24px 32px"};
      text-align: ${userData.header?.styling?.textAlign || "center"};
      margin: 0 0 24px 0;
      overflow: hidden;
    ">
      <img 
        src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" 
        alt="Local Cooks" 
        style="max-width: 280px; height: auto; display: block; margin: 0 auto${userData.header?.title ? "; margin-bottom: 16px" : ""}"
      />
      ${userData.header?.title ? `<h1 style="color: ${userData.header?.styling?.titleColor || "#ffffff"}; font-size: ${userData.header?.styling?.titleFontSize || "32px"}; font-weight: 700; margin: 0 0 8px 0; line-height: 1.2;">${userData.header.title}</h1>` : ""}
      ${userData.header?.subtitle ? `<p style="color: ${userData.header?.styling?.subtitleColor || "#ffffff"}; font-size: ${userData.header?.styling?.subtitleFontSize || "18px"}; margin: 0; opacity: 0.9;">${userData.header.subtitle}</p>` : ""}
    </div>
    <div class="content">
      <!-- Enhanced Email Design -->
      <h2 class="greeting">${finalGreeting}</h2>
      
      ${generateDivider()}
      
      <div class="custom-message">
        ${finalMessage}
      </div>
      
      ${generateDivider()}
      
      ${userData.promoCode ? `
        <div style="text-align: center; margin: 32px 0;">
          <div class="promo-label" style="margin-bottom: 12px;">${userData.promoCodeLabel || "Use promo code:"}</div>
          <div class="promo-code-box">
            <div class="promo-code">${userData.promoCode}</div>
          </div>
        </div>
        ${generateDivider()}
      ` : ""}

      <!-- Usage Steps Section (Always Show Unless Explicitly Disabled) -->
      ${userData.usageSteps?.enabled !== false ? generateUsageStepsSection() : ""}

      <!-- Custom Sections (if any) -->
      ${userData.sections && (Array.isArray(userData.sections) ? userData.sections.length > 0 : Object.keys(userData.sections).length > 0) ? generateAdvancedSections(Array.isArray(userData.sections) ? userData.sections : Object.values(userData.sections)) + generateDivider() : ""}
      
      <!-- Call to Action Button -->
      <div class="cta-container">
        <a href="${userData.orderButton?.url || getPromoUrl()}" class="custom-order-button">
          ${userData.orderButton?.text || "\u{1F31F} Start Shopping Now"}
        </a>
      </div>
      
      <div class="divider"></div>
    </div>
    <div class="custom-footer">
      ${userData.footer?.mainText ? `<p class="footer-text"><strong>${userData.footer.mainText}</strong></p>` : `<p class="footer-text">Thank you for being part of the <strong>${organizationName}</strong> community!</p>`}
      
      ${userData.footer?.showContact !== false && userData.footer?.contactText ? `
        <p class="footer-text">
          ${userData.footer.contactText.includes("@") ? userData.footer.contactText.replace(/(\S+@\S+)/g, '<a href="mailto:$1" class="footer-link">$1</a>') : userData.footer.contactText}
        </p>
      ` : userData.footer?.showContact !== false ? `
        <p class="footer-text">Questions? Contact us at <a href="mailto:${supportEmail}" class="footer-link">${supportEmail}</a>.</p>
      ` : ""}
      
      ${userData.footer?.showCopyright !== false ? `
        <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, ${userData.footer?.styling?.borderColor || "#e2e8f0"} 50%, transparent 100%); margin: 16px 0;"></div>
        <p class="footer-text" style="opacity: 0.8; font-size: ${userData.footer?.styling?.fontSize ? parseInt(userData.footer.styling.fontSize) - 2 + "px" : "12px"};">
          ${userData.footer?.copyrightText || `&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} ${organizationName}. All rights reserved.`}
        </p>
      ` : ""}
      
      <!-- Unsubscribe Link -->
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid ${userData.footer?.styling?.borderColor || "#e2e8f0"};">
        <p style="text-align: center; font-size: 11px; color: #6b7280; margin: 0;">
          Don't want to receive these emails? 
          <a href="${getWebsiteUrl()}/unsubscribe?email=${encodeURIComponent(userData.email)}" 
             style="color: #F51042; text-decoration: underline;">
            Unsubscribe here
          </a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject,
        text: generatePlainText(userData.email, userData.promoCode, finalMessage),
        html,
        headers: {
          "X-Priority": "3",
          "X-MSMail-Priority": "Normal",
          "Importance": "Normal",
          "List-Unsubscribe": `<mailto:${getUnsubscribeEmail()}>`
        }
      };
    };
    generateChefAllDocumentsApprovedEmail = (userData) => {
      const subject = "All Documents Approved - Welcome to Local Cooks Community!";
      const generatePlainText = (fullName, approvedDocuments, adminFeedback) => {
        const docList2 = approvedDocuments.join(", ");
        return `Hello ${fullName},

\u{1F389} Congratulations! All your submitted documents have been approved by our verification team.

Approved Documents: ${docList2}

You are now fully verified and can start using Local Cooks Community as a chef.

${adminFeedback ? `Admin Feedback: ${adminFeedback}

` : ""}Access your dashboard: ${getDashboardUrl()}

If you have any questions, please contact us at ${getSupportEmail()}.

Best regards,
Local Cooks Community Team

Visit: ${getWebsiteUrl()}
`;
      };
      const docList = userData.approvedDocuments.join(", ");
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${getUniformEmailStyles()}
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" />
    </div>
    <div class="content">
      <h2 class="greeting">Hello ${userData.fullName},</h2>
      <p class="message">
        \u{1F389} <strong>Congratulations!</strong> All your submitted documents have been approved by our verification team.
      </p>
      <p class="message">
        You are now fully verified and can start using Local Cooks Community as a chef.
      </p>
      <div class="status-badge approved">
        \u2705 All Documents Approved
      </div>
      <div class="info-box">
        <strong>\u{1F4C4} Approved Documents:</strong><br>
        ${userData.approvedDocuments.map((doc) => `\u2022 ${doc}`).join("<br>")}
      </div>
      ${userData.adminFeedback ? `
      <div class="info-box">
        <strong>\u{1F4AC} Admin Feedback:</strong><br>
        ${userData.adminFeedback}
      </div>` : ""}
      <a href="${getDashboardUrl()}" class="cta-button" style="color: white !important; text-decoration: none !important;">Access Your Dashboard</a>
      <div class="divider"></div>
    </div>
    <div class="footer">
      <p class="footer-text">Welcome to <a href="${getWebsiteUrl()}" class="footer-links">Local Cooks</a>!</p>
      <p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p>
      <div class="divider"></div>
      <p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p>
    </div>
  </div>
</body>
</html>`;
      return {
        to: userData.email,
        subject,
        text: generatePlainText(userData.fullName, userData.approvedDocuments, userData.adminFeedback),
        html
      };
    };
    generateManagerMagicLinkEmail = (userData) => {
      const subject = "Set Up Your Manager Account - Local Cooks";
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${baseUrl}/password-reset?token=${userData.resetToken}&role=manager`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${userData.name},</h2><p class="message">Your manager account has been created for the Local Cooks commercial kitchen booking system!</p><p class="message">Click the button below to set up your password and access your manager dashboard:</p><a href="${resetUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Set Up Password</a><div class="info-box"><strong>\u{1F510} Account Access:</strong><br>You'll be able to manage kitchen schedules, view bookings, and set up availability for your location.</div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: userData.email, subject, text: `Hello ${userData.name}, Your manager account has been created. Click here to set up your password: ${resetUrl}`, html };
    };
    generateManagerCredentialsEmail = (userData) => {
      const subject = "Your Manager Account - Local Cooks Community";
      const baseUrl = getWebsiteUrl();
      const loginUrl = `${baseUrl}/manager/login`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${userData.name || "Manager"},</h2><p class="message">Your manager account has been created for the Local Cooks kitchen booking system!</p><div class="info-box"><strong>\u{1F510} Your Login Credentials:</strong><table class="credentials-table"><tr><td>Username:</td><td><code>${userData.username}</code></td></tr><tr><td>Password:</td><td><code>${userData.password}</code></td></tr></table></div><div class="warning-box"><p class="warning-text"><strong>\u26A0\uFE0F Important:</strong> Please change your password after your first login for security.</p></div><p class="message">You'll be able to manage kitchen schedules, view bookings, and set up availability for your locations.</p><a href="${loginUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Login Now</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: userData.email, subject, text: `Hello ${userData.name || "Manager"}, Your manager account has been created! Username: ${userData.username}, Password: ${userData.password}. Login at: ${loginUrl}`, html };
    };
    generateBookingNotificationEmail = (bookingData) => {
      const subject = `New Kitchen Booking - ${bookingData.kitchenName}`;
      const timezone = bookingData.timezone || "America/St_Johns";
      const locationName = bookingData.locationName || bookingData.kitchenName;
      const bookingDateObj = bookingData.bookingDate instanceof Date ? bookingData.bookingDate : new Date(bookingData.bookingDate);
      const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
      const calendarDescription = `Kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.

Chef: ${bookingData.chefName}
Date: ${bookingDateObj.toLocaleDateString()}
Time: ${bookingData.startTime} - ${bookingData.endTime}
Status: Pending Approval${bookingData.specialNotes ? `

Notes: ${bookingData.specialNotes}` : ""}`;
      const calendarUrl = generateCalendarUrl(
        bookingData.managerEmail,
        calendarTitle,
        bookingData.bookingDate,
        bookingData.startTime,
        bookingData.endTime,
        locationName,
        calendarDescription,
        timezone
      );
      const calendarButtonText = detectEmailProvider(bookingData.managerEmail) === "outlook" ? "\u{1F4C5} Add to Outlook Calendar" : detectEmailProvider(bookingData.managerEmail) === "yahoo" ? "\u{1F4C5} Add to Yahoo Calendar" : detectEmailProvider(bookingData.managerEmail) === "apple" ? "\u{1F4C5} Add to Apple Calendar" : "\u{1F4C5} Add to Calendar";
      const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split("T")[0] : bookingData.bookingDate.split("T")[0];
      const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
      const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
      const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
      const icsContent = generateIcsFile(
        calendarTitle,
        startDateTime,
        endDateTime,
        locationName,
        calendarDescription,
        getSupportEmail(),
        [bookingData.managerEmail],
        // Manager is the primary attendee for this email
        eventUid
        // Use consistent UID for synchronization
      );
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New Kitchen Booking</h2><p class="message">A chef has made a booking for your kitchen:</p><div class="info-box"><strong>\u{1F468}\u200D\u{1F373} Chef:</strong> ${bookingData.chefName}<br><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}${bookingData.specialNotes ? `<br><br><strong>\u{1F4DD} Notes:</strong> ${bookingData.specialNotes}` : ""}</div><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>\u{1F4CE} Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/manager/bookings" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View Bookings</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return {
        to: bookingData.managerEmail,
        subject,
        text: `New Kitchen Booking - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Add to calendar: ${calendarUrl}`,
        html,
        attachments: [{
          filename: "kitchen-booking.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST"
        }]
      };
    };
    generateBookingCancellationNotificationEmail = (bookingData) => {
      const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Booking Cancelled</h2><p class="message">A chef has cancelled their booking:</p><div class="info-box"><strong>\u{1F468}\u200D\u{1F373} Chef:</strong> ${bookingData.chefName}<br><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${new Date(bookingData.bookingDate).toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #dc2626; font-weight: 600;">Cancelled</span>${bookingData.cancellationReason ? `<br><br><strong>\u{1F4DD} Reason:</strong> ${bookingData.cancellationReason}` : ""}</div><a href="${getDashboardUrl()}/manager/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Bookings</a><div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: bookingData.managerEmail, subject, text: `Booking Cancelled - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${new Date(bookingData.bookingDate).toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}`, html };
    };
    generateBookingStatusChangeNotificationEmail = (bookingData) => {
      const subject = `Booking ${bookingData.status === "confirmed" ? "Confirmed" : "Updated"} - ${bookingData.kitchenName}`;
      const statusColor = bookingData.status === "confirmed" ? "#16a34a" : "#dc2626";
      const statusText = bookingData.status === "confirmed" ? "Confirmed" : "Cancelled";
      const timezone = bookingData.timezone || "America/St_Johns";
      const locationName = bookingData.locationName || bookingData.kitchenName;
      const bookingDateObj = bookingData.bookingDate instanceof Date ? bookingData.bookingDate : new Date(bookingData.bookingDate);
      let calendarUrl = "";
      let calendarButtonText = "\u{1F4C5} Add to Calendar";
      if (bookingData.status === "confirmed") {
        const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
        const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.

Chef: ${bookingData.chefName}
Date: ${bookingDateObj.toLocaleDateString()}
Time: ${bookingData.startTime} - ${bookingData.endTime}
Status: Confirmed`;
        calendarUrl = generateCalendarUrl(
          bookingData.managerEmail,
          calendarTitle,
          bookingData.bookingDate,
          bookingData.startTime,
          bookingData.endTime,
          locationName,
          calendarDescription,
          timezone
        );
        const provider = detectEmailProvider(bookingData.managerEmail);
        calendarButtonText = provider === "outlook" ? "\u{1F4C5} Add to Outlook Calendar" : provider === "yahoo" ? "\u{1F4C5} Add to Yahoo Calendar" : provider === "apple" ? "\u{1F4C5} Add to Apple Calendar" : "\u{1F4C5} Add to Calendar";
      }
      let attachments = [];
      if (bookingData.status === "confirmed" && calendarUrl) {
        const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split("T")[0] : bookingData.bookingDate.split("T")[0];
        const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
        const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
        const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
        const calendarDescription = `Confirmed kitchen booking with ${bookingData.chefName} for ${bookingData.kitchenName}.

Chef: ${bookingData.chefName}
Date: ${bookingDateObj.toLocaleDateString()}
Time: ${bookingData.startTime} - ${bookingData.endTime}
Status: Confirmed`;
        const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
        const icsContent = generateIcsFile(
          calendarTitle,
          startDateTime,
          endDateTime,
          locationName,
          calendarDescription,
          getSupportEmail(),
          [bookingData.managerEmail],
          // Manager is the primary attendee for this email
          eventUid
          // Use consistent UID for synchronization
        );
        attachments = [{
          filename: "kitchen-booking.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST"
        }];
      }
      const calendarButton = bookingData.status === "confirmed" && calendarUrl ? `<p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>\u{1F4CE} Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/manager/bookings" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View Bookings</a></div>` : `<a href="${getDashboardUrl()}/manager/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Bookings</a>`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Booking ${statusText}</h2><p class="message">The booking status has been updated:</p><div class="info-box"><strong>\u{1F468}\u200D\u{1F373} Chef:</strong> ${bookingData.chefName}<br><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>\u{1F4CA} Status:</strong> <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span></div>${calendarButton}<div class="divider"></div></div><div class="footer"><p class="footer-text">If you have any questions, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      const textCalendar = bookingData.status === "confirmed" && calendarUrl ? ` Add to calendar: ${calendarUrl}` : "";
      return {
        to: bookingData.managerEmail,
        subject,
        text: `Booking ${statusText} - Chef: ${bookingData.chefName}, Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}, Status: ${statusText}${textCalendar}`,
        html,
        attachments
      };
    };
    generateBookingRequestEmail = (bookingData) => {
      const subject = `Booking Request Received - ${bookingData.kitchenName}`;
      const timezone = bookingData.timezone || "America/St_Johns";
      const locationName = bookingData.locationName || bookingData.kitchenName;
      const bookingDateObj = bookingData.bookingDate instanceof Date ? bookingData.bookingDate : new Date(bookingData.bookingDate);
      const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
      const calendarDescription = `Kitchen booking request for ${bookingData.kitchenName}.

Date: ${bookingDateObj.toLocaleDateString()}
Time: ${bookingData.startTime} - ${bookingData.endTime}
Status: Pending Approval${bookingData.specialNotes ? `

Notes: ${bookingData.specialNotes}` : ""}`;
      const calendarUrl = generateCalendarUrl(
        bookingData.chefEmail,
        calendarTitle,
        bookingData.bookingDate,
        bookingData.startTime,
        bookingData.endTime,
        locationName,
        calendarDescription,
        timezone
      );
      const provider = detectEmailProvider(bookingData.chefEmail);
      const calendarButtonText = provider === "outlook" ? "\u{1F4C5} Add to Outlook Calendar" : provider === "yahoo" ? "\u{1F4C5} Add to Yahoo Calendar" : provider === "apple" ? "\u{1F4C5} Add to Apple Calendar" : "\u{1F4C5} Add to Calendar";
      const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split("T")[0] : bookingData.bookingDate.split("T")[0];
      const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
      const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
      const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
      const icsContent = generateIcsFile(
        calendarTitle,
        startDateTime,
        endDateTime,
        locationName,
        calendarDescription,
        getSupportEmail(),
        [bookingData.chefEmail],
        // Chef is the primary attendee
        eventUid
        // Use consistent UID for synchronization
      );
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">We've received your kitchen booking request! The manager has been notified and will review it shortly.</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Approval</span>${bookingData.specialNotes ? `<br><br><strong>\u{1F4DD} Notes:</strong> ${bookingData.specialNotes}` : ""}</div><p class="message">You'll receive a confirmation email once the manager approves your booking.</p><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>\u{1F4CE} Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/bookings" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View My Bookings</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return {
        to: bookingData.chefEmail,
        subject,
        text: `Hello ${bookingData.chefName}, We've received your kitchen booking request! Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Status: Pending Approval. You'll receive a confirmation email once approved. Add to calendar: ${calendarUrl}`,
        html,
        attachments: [{
          filename: "kitchen-booking.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST"
        }]
      };
    };
    generateBookingConfirmationEmail = (bookingData) => {
      const subject = `Booking Confirmed - ${bookingData.kitchenName}`;
      const timezone = bookingData.timezone || "America/St_Johns";
      const locationName = bookingData.locationName || bookingData.kitchenName;
      const bookingDateObj = bookingData.bookingDate instanceof Date ? bookingData.bookingDate : new Date(bookingData.bookingDate);
      const calendarTitle = `Kitchen Booking - ${bookingData.kitchenName}`;
      const calendarDescription = `Confirmed kitchen booking for ${bookingData.kitchenName}.

Date: ${bookingDateObj.toLocaleDateString()}
Time: ${bookingData.startTime} - ${bookingData.endTime}
Status: Confirmed${bookingData.specialNotes ? `

Notes: ${bookingData.specialNotes}` : ""}`;
      const calendarUrl = generateCalendarUrl(
        bookingData.chefEmail,
        calendarTitle,
        bookingData.bookingDate,
        bookingData.startTime,
        bookingData.endTime,
        locationName,
        calendarDescription,
        timezone
      );
      const provider = detectEmailProvider(bookingData.chefEmail);
      const calendarButtonText = provider === "outlook" ? "\u{1F4C5} Add to Outlook Calendar" : provider === "yahoo" ? "\u{1F4C5} Add to Yahoo Calendar" : provider === "apple" ? "\u{1F4C5} Add to Apple Calendar" : "\u{1F4C5} Add to Calendar";
      const bookingDateStr = bookingData.bookingDate instanceof Date ? bookingData.bookingDate.toISOString().split("T")[0] : bookingData.bookingDate.split("T")[0];
      const startDateTime = createBookingDateTime(bookingDateStr, bookingData.startTime, timezone);
      const endDateTime = createBookingDateTime(bookingDateStr, bookingData.endTime, timezone);
      const eventUid = generateEventUid(bookingData.bookingDate, bookingData.startTime, locationName);
      const icsContent = generateIcsFile(
        calendarTitle,
        startDateTime,
        endDateTime,
        locationName,
        calendarDescription,
        getSupportEmail(),
        [bookingData.chefEmail],
        // Chef is the primary attendee
        eventUid
        // Use consistent UID for synchronization
      );
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">Great news! Your kitchen booking has been <strong style="color: #16a34a;">CONFIRMED</strong> \u2705</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${bookingDateObj.toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #16a34a; font-weight: 600;">Confirmed</span>${bookingData.specialNotes ? `<br><br><strong>\u{1F4DD} Notes:</strong> ${bookingData.specialNotes}` : ""}</div><p class="message" style="font-size: 14px; color: #64748b; margin-top: 16px;"><strong>\u{1F4CE} Calendar Invite:</strong> A calendar invite has been attached to this email. You can also <a href="${calendarUrl}" target="_blank" style="color: #4285f4;">click here to add it to your calendar</a>.</p><div style="text-align: center; margin: 24px 0;"><a href="${calendarUrl}" target="_blank" class="cta-button" style="display: inline-block; background: #4285f4; color: white !important; text-decoration: none !important; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-right: 12px;">${calendarButtonText}</a><a href="${getDashboardUrl()}/bookings" class="cta-button" style="display: inline-block; color: white !important; text-decoration: none !important;">View My Bookings</a></div><div class="divider"></div></div><div class="footer"><p class="footer-text">If you need to make changes, contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return {
        to: bookingData.chefEmail,
        subject,
        text: `Hello ${bookingData.chefName}, Great news! Your kitchen booking has been CONFIRMED! Kitchen: ${bookingData.kitchenName}, Date: ${bookingDateObj.toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}. Add to calendar: ${calendarUrl}`,
        html,
        attachments: [{
          filename: "kitchen-booking.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST"
        }]
      };
    };
    generateBookingCancellationEmail = (bookingData) => {
      const subject = `Booking Cancelled - ${bookingData.kitchenName}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${bookingData.chefName},</h2><p class="message">Your kitchen booking has been cancelled.</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${bookingData.kitchenName}<br><strong>\u{1F4C5} Date:</strong> ${new Date(bookingData.bookingDate).toLocaleDateString()}<br><strong>\u23F0 Time:</strong> ${bookingData.startTime} - ${bookingData.endTime}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #dc2626; font-weight: 600;">Cancelled</span>${bookingData.cancellationReason ? `<br><br><strong>\u{1F4DD} Reason:</strong> ${bookingData.cancellationReason}` : ""}</div><p class="message">You can make a new booking anytime from your dashboard.</p><a href="${getDashboardUrl()}/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">Browse Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: bookingData.chefEmail, subject, text: `Hello ${bookingData.chefName}, Your kitchen booking has been cancelled. Kitchen: ${bookingData.kitchenName}, Date: ${new Date(bookingData.bookingDate).toLocaleDateString()}, Time: ${bookingData.startTime} - ${bookingData.endTime}${bookingData.cancellationReason ? `. Reason: ${bookingData.cancellationReason}` : ""}`, html };
    };
    generateKitchenAvailabilityChangeEmail = (data) => {
      const subject = `Kitchen Availability Update - ${data.kitchenName}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">The availability for <strong>${data.kitchenName}</strong> has been updated.</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${data.kitchenName}<br><strong>\u{1F4CB} Change Type:</strong> ${data.changeType}<br><strong>\u{1F4DD} Details:</strong> ${data.details}</div><p class="message">Please check the updated availability before making your next booking.</p><a href="${getDashboardUrl()}/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Availability</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, The availability for ${data.kitchenName} has been updated. Change Type: ${data.changeType}. Details: ${data.details}`, html };
    };
    generateKitchenSettingsChangeEmail = (data) => {
      const subject = `Kitchen Settings Updated - ${data.kitchenName}`;
      const greeting = data.isChef ? `Hello ${data.name},` : `Hello ${data.name},`;
      const message = data.isChef ? `The settings for <strong>${data.kitchenName}</strong> have been updated. This may affect your existing or future bookings.` : `The settings for <strong>${data.kitchenName}</strong> have been updated.`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">${greeting}</h2><p class="message">${message}</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${data.kitchenName}<br><strong>\u{1F4DD} Changes:</strong> ${data.changes}</div>${data.isChef ? `<p class="message">Please review the updated settings before making your next booking.</p><a href="${getDashboardUrl()}/bookings" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Details</a>` : `<a href="${getDashboardUrl()}/manager/booking-dashboard" class="cta-button" style="color: white !important; text-decoration: none !important;">View Kitchen Settings</a>`}<div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.email, subject, text: `${greeting} ${message} Kitchen: ${data.kitchenName}. Changes: ${data.changes}`, html };
    };
    generateChefProfileRequestEmail = (data) => {
      const subject = `Chef Access Request - ${data.locationName}`;
      const baseUrl = getWebsiteUrl();
      const reviewUrl = `${baseUrl}/manager/chefs?locationId=${data.locationId}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">New Chef Access Request</h2><p class="message">A chef has requested access to your location and kitchen facilities:</p><div class="info-box"><strong>\u{1F468}\u200D\u{1F373} Chef Name:</strong> ${data.chefName}<br><strong>\u{1F4E7} Chef Email:</strong> ${data.chefEmail}<br><strong>\u{1F4CD} Location:</strong> ${data.locationName}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #f59e0b; font-weight: 600;">Pending Review</span></div><p class="message">Please review the chef's profile and approve or reject their request from your manager dashboard.</p><a href="${reviewUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">Review Chef Request</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.managerEmail, subject, text: `New Chef Access Request - Chef: ${data.chefName} (${data.chefEmail}) has requested access to location: ${data.locationName}. Status: Pending Review. Please review from your manager dashboard.`, html };
    };
    generateChefLocationAccessApprovedEmail = (data) => {
      const subject = `Kitchen Access Approved - ${data.locationName}`;
      const baseUrl = getWebsiteUrl();
      const bookingsUrl = `${baseUrl}/bookings`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! The manager has <strong style="color: #16a34a;">APPROVED</strong> your chef profile for kitchen access at <strong>${data.locationName}</strong> \u2705</p><div class="info-box"><strong>\u{1F3E2} Location:</strong> ${data.locationName}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">You can now book kitchen facilities at this location. Start making your bookings from your dashboard!</p><a href="${bookingsUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, Great news! The manager has approved your chef profile for kitchen access at ${data.locationName}. You can now book kitchen facilities at this location.`, html };
    };
    generateChefKitchenAccessApprovedEmail = (data) => {
      const subject = `Kitchen Access Approved - ${data.kitchenName}`;
      const baseUrl = getWebsiteUrl();
      const bookingsUrl = `${baseUrl}/bookings`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Hello ${data.chefName},</h2><p class="message">Great news! The manager has <strong style="color: #16a34a;">APPROVED</strong> your chef profile for kitchen access at <strong>${data.kitchenName}</strong> \u2705</p><div class="info-box"><strong>\u{1F3E2} Kitchen:</strong> ${data.kitchenName}<br><strong>\u{1F4CA} Status:</strong> <span style="color: #16a34a; font-weight: 600;">Approved</span></div><p class="message">You can now book this kitchen. Start making your bookings from your dashboard!</p><a href="${bookingsUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Available Kitchens</a><div class="divider"></div></div><div class="footer"><p class="footer-text">Questions? Contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.chefEmail, subject, text: `Hello ${data.chefName}, Great news! The manager has approved your chef profile for kitchen access at ${data.kitchenName}. You can now book this kitchen.`, html };
    };
    generateLocationEmailChangedEmail = (data) => {
      const subject = `Location Notification Email Updated - ${data.locationName}`;
      const baseUrl = getWebsiteUrl();
      const dashboardUrl = `${baseUrl}/manager/dashboard`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title>${getUniformEmailStyles()}</head><body><div class="email-container"><div class="header"><img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" alt="Local Cooks" class="header-image" /></div><div class="content"><h2 class="greeting">Location Notification Email Updated</h2><p class="message">This email address has been set as the notification email for <strong>${data.locationName}</strong>.</p><div class="info-box"><strong>\u{1F4CD} Location:</strong> ${data.locationName}<br><strong>\u{1F4E7} Notification Email:</strong> ${data.email}</div><p class="message">You will now receive email notifications for bookings, cancellations, and other important updates for this location.</p><a href="${dashboardUrl}" class="cta-button" style="color: white !important; text-decoration: none !important;">View Dashboard</a><div class="divider"></div></div><div class="footer"><p class="footer-text">If you didn't make this change, please contact us at <a href="mailto:${getSupportEmail()}" class="footer-links">${getSupportEmail()}</a>.</p><div class="divider"></div><p class="footer-text">&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} Local Cooks Community</p></div></div></body></html>`;
      return { to: data.email, subject, text: `Location Notification Email Updated - This email address has been set as the notification email for ${data.locationName}. You will now receive email notifications for bookings, cancellations, and other important updates for this location.`, html };
    };
  }
});

// server/domains/applications/application.repository.ts
import { eq as eq3, desc, and as and2 } from "drizzle-orm";
var ApplicationRepository;
var init_application_repository = __esm({
  "server/domains/applications/application.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    ApplicationRepository = class {
      async getAll() {
        return db.select().from(applications).orderBy(desc(applications.createdAt));
      }
      async findById(id) {
        const [application] = await db.select().from(applications).where(eq3(applications.id, id));
        return application || null;
      }
      async findByUserId(userId) {
        return db.select().from(applications).where(eq3(applications.userId, userId)).orderBy(desc(applications.createdAt));
      }
      async hasPendingApplication(userId) {
        const results = await db.select({ id: applications.id }).from(applications).where(
          and2(
            eq3(applications.userId, userId),
            eq3(applications.status, "inReview")
          )
        ).limit(1);
        return results.length > 0;
      }
      async create(data) {
        const now = /* @__PURE__ */ new Date();
        const [application] = await db.insert(applications).values({
          ...data,
          status: "inReview",
          createdAt: now,
          foodSafetyLicenseStatus: data.foodSafetyLicenseUrl ? "pending" : "pending",
          // Default
          foodEstablishmentCertStatus: data.foodEstablishmentCertUrl ? "pending" : "pending"
          // Default
        }).returning();
        return application;
      }
      async updateStatus(id, status) {
        const [updated] = await db.update(applications).set({ status }).where(eq3(applications.id, id)).returning();
        return updated || null;
      }
      async updateDocuments(id, updates) {
        const resetStatus = {};
        if (updates.foodSafetyLicenseUrl) resetStatus.foodSafetyLicenseStatus = "pending";
        if (updates.foodEstablishmentCertUrl) resetStatus.foodEstablishmentCertStatus = "pending";
        const [updated] = await db.update(applications).set({
          ...updates,
          ...resetStatus
        }).where(eq3(applications.id, id)).returning();
        return updated || null;
      }
      async verifyDocuments(data) {
        const [updated] = await db.update(applications).set({
          foodSafetyLicenseStatus: data.foodSafetyLicenseStatus,
          foodEstablishmentCertStatus: data.foodEstablishmentCertStatus,
          documentsAdminFeedback: data.documentsAdminFeedback,
          documentsReviewedBy: data.documentsReviewedBy,
          documentsReviewedAt: /* @__PURE__ */ new Date()
        }).where(eq3(applications.id, data.id)).returning();
        return updated || null;
      }
    };
  }
});

// server/domains/applications/application.service.ts
var ApplicationService, applicationService;
var init_application_service = __esm({
  "server/domains/applications/application.service.ts"() {
    "use strict";
    init_application_repository();
    init_domain_error();
    ApplicationService = class {
      repo;
      constructor(repo) {
        this.repo = repo || new ApplicationRepository();
      }
      async getAllApplications() {
        return this.repo.getAll();
      }
      async getApplicationById(id) {
        const app2 = await this.repo.findById(id);
        if (!app2) {
          throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
        }
        return app2;
      }
      async getApplicationsByUserId(userId) {
        return this.repo.findByUserId(userId);
      }
      async submitApplication(data) {
        if (!data.userId) {
          throw new DomainError(ApplicationErrorCodes.VALIDATION_ERROR, "User ID is required", 400);
        }
        const hasPending = await this.repo.hasPendingApplication(data.userId);
        if (hasPending) {
          throw new DomainError(
            ApplicationErrorCodes.VALIDATION_ERROR,
            "You already have a pending application. Please wait for it to be processed.",
            409
          );
        }
        return this.repo.create(data);
      }
      async approveApplication(id, adminId) {
        const app2 = await this.repo.findById(id);
        if (!app2) {
          throw new DomainError(ApplicationErrorCodes.APPLICATION_NOT_FOUND, `Application ${id} not found`, 404);
        }
        if (app2.status !== "inReview") {
          throw new DomainError(
            ApplicationErrorCodes.VALIDATION_ERROR,
            `Application is already processed (Status: ${app2.status})`,
            400
          );
        }
        const updated = await this.repo.updateStatus(id, "approved");
        if (!updated) throw new Error("Failed to approve application");
        return updated;
      }
      async updateStatus(id, status) {
        const app2 = await this.repo.updateStatus(id, status);
        if (!app2) {
          throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
        }
        return app2;
      }
      async updateDocuments(id, updates) {
        const app2 = await this.repo.updateDocuments(id, updates);
        if (!app2) {
          throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
        }
        return app2;
      }
      async cancelApplication(id, userId) {
        const app2 = await this.repo.findById(id);
        if (!app2) {
          throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
        }
        if (app2.userId !== userId) {
          throw new DomainError("FORBIDDEN", "You can only cancel your own applications", 403);
        }
        const updated = await this.repo.updateStatus(id, "cancelled");
        if (!updated) throw new Error("Failed to cancel application");
        return updated;
      }
      async verifyDocuments(data) {
        const app2 = await this.repo.verifyDocuments(data);
        if (!app2) {
          throw new DomainError("APPLICATION_NOT_FOUND", `Application ${data.id} not found`, 404);
        }
        return app2;
      }
    };
    applicationService = new ApplicationService();
  }
});

// server/domains/microlearning/microlearning.repository.ts
import { eq as eq4, desc as desc2 } from "drizzle-orm";
var MicrolearningRepository;
var init_microlearning_repository = __esm({
  "server/domains/microlearning/microlearning.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    MicrolearningRepository = class {
      async getProgress(userId) {
        return db.select().from(videoProgress).where(eq4(videoProgress.userId, userId)).orderBy(desc2(videoProgress.updatedAt));
      }
      async getCompletion(userId) {
        const [completion] = await db.select().from(microlearningCompletions).where(eq4(microlearningCompletions.userId, userId));
        return completion || null;
      }
      async upsertVideoProgress(data) {
        return db.insert(videoProgress).values(data).onConflictDoUpdate({
          target: [videoProgress.userId, videoProgress.videoId],
          set: {
            progress: data.progress,
            completed: data.completed,
            watchedPercentage: data.watchedPercentage,
            isRewatching: data.isRewatching,
            updatedAt: /* @__PURE__ */ new Date(),
            // Update completedAt if it's provided in the new data
            ...data.completedAt ? { completedAt: data.completedAt } : {}
          }
        });
      }
      async createCompletion(data) {
        const [completion] = await db.insert(microlearningCompletions).values(data).returning();
        return completion;
      }
    };
  }
});

// server/domains/microlearning/microlearning.service.ts
var MicrolearningService, microlearningService;
var init_microlearning_service = __esm({
  "server/domains/microlearning/microlearning.service.ts"() {
    "use strict";
    init_microlearning_repository();
    MicrolearningService = class {
      repo;
      constructor(repo) {
        this.repo = repo || new MicrolearningRepository();
      }
      async getUserProgress(userId) {
        return this.repo.getProgress(userId);
      }
      async getUserCompletion(userId) {
        return this.repo.getCompletion(userId);
      }
      async updateVideoProgress(data) {
        return this.repo.upsertVideoProgress({
          userId: data.userId,
          videoId: data.videoId,
          progress: String(data.progress),
          completed: data.completed,
          watchedPercentage: String(data.watchedPercentage),
          isRewatching: data.isRewatching ?? false,
          updatedAt: /* @__PURE__ */ new Date(),
          completedAt: data.completedAt || null
        });
      }
      async completeMicrolearning(data) {
        return this.repo.createCompletion(data);
      }
    };
    microlearningService = new MicrolearningService();
  }
});

// server/r2-storage.ts
var r2_storage_exports = {};
__export(r2_storage_exports, {
  deleteFromR2: () => deleteFromR2,
  fileExistsInR2: () => fileExistsInR2,
  getPresignedUrl: () => getPresignedUrl,
  isR2Configured: () => isR2Configured,
  uploadToR2: () => uploadToR2
});
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
function getR2PublicUrl() {
  if (process.env.CLOUDFLARE_R2_PUBLIC_URL) {
    return process.env.CLOUDFLARE_R2_PUBLIC_URL;
  }
  if (R2_ACCOUNT_ID && R2_BUCKET_NAME) {
    return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;
  }
  return "";
}
function getS3Client() {
  if (!s3Client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      throw new Error("Cloudflare R2 credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_BUCKET_NAME environment variables.");
    }
    if (!R2_ENDPOINT) {
      throw new Error("R2 endpoint could not be constructed. Please check CLOUDFLARE_ACCOUNT_ID is set.");
    }
    s3Client = new S3Client({
      region: "auto",
      // R2 uses 'auto' as the region
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      },
      // Force path style for R2 compatibility
      forcePathStyle: false
    });
  }
  return s3Client;
}
async function uploadToR2(file, userId, folder = "documents") {
  try {
    const client = getS3Client();
    const timestamp2 = Date.now();
    const documentType = file.fieldname || "file";
    const ext = file.originalname.split(".").pop() || "";
    const baseName = file.originalname.replace(/\.[^/.]+$/, "");
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `${userId}_${documentType}_${timestamp2}_${sanitizedBaseName}.${ext}`;
    const key = `${folder}/${filename}`;
    let fileBuffer;
    if (file.buffer) {
      fileBuffer = file.buffer;
    } else if (file.path) {
      const fs6 = await import("fs");
      fileBuffer = fs6.readFileSync(file.path);
    } else {
      throw new Error("File buffer or path not available");
    }
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: file.mimetype
      // Make file publicly accessible (if your R2 bucket allows public access)
      // Note: You need to configure CORS and public access in Cloudflare dashboard
    });
    await client.send(command);
    let publicUrl;
    if (R2_PUBLIC_URL) {
      publicUrl = R2_PUBLIC_URL.endsWith("/") ? `${R2_PUBLIC_URL}${key}` : `${R2_PUBLIC_URL}/${key}`;
    } else {
      publicUrl = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${key}`;
    }
    console.log(`\u2705 File uploaded to R2: ${key} -> ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error("\u274C Error uploading to R2:", error);
    throw new Error(`Failed to upload file to R2: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
async function deleteFromR2(fileUrl) {
  try {
    const client = getS3Client();
    let actualFileUrl = fileUrl;
    if (fileUrl.includes("/api/files/r2-proxy")) {
      try {
        const urlObj2 = new URL(fileUrl, "http://localhost");
        const urlParam = urlObj2.searchParams.get("url");
        if (urlParam) {
          actualFileUrl = decodeURIComponent(urlParam);
          console.log(`\u{1F50D} Extracted R2 URL from proxy: ${actualFileUrl}`);
        } else {
          console.error("\u274C Proxy URL missing url parameter:", fileUrl);
          return false;
        }
      } catch (urlError) {
        console.error("\u274C Error parsing proxy URL:", urlError);
        return false;
      }
    }
    const urlObj = new URL(actualFileUrl);
    const pathname = urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;
    const pathParts = pathname.split("/").filter((p) => p);
    const bucketIndex = pathParts.indexOf(R2_BUCKET_NAME);
    let key;
    if (bucketIndex >= 0) {
      key = pathParts.slice(bucketIndex + 1).join("/");
    } else {
      const knownFolders = ["documents", "kitchen-applications", "images", "profiles"];
      const firstPart = pathParts[0];
      if (knownFolders.includes(firstPart)) {
        key = pathname;
      } else {
        key = pathname;
      }
    }
    key = key.replace(/^\/+|\/+$/g, "");
    if (!key || key.length === 0) {
      console.error(`\u274C Invalid key extracted from URL: ${fileUrl} -> ${actualFileUrl}`);
      return false;
    }
    console.log("\u{1F50D} R2 Delete Debug:", {
      originalUrl: fileUrl,
      actualFileUrl,
      extractedKey: key,
      bucketName: R2_BUCKET_NAME,
      pathname: urlObj.pathname,
      pathParts,
      bucketIndex
    });
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key
    });
    await client.send(command);
    console.log(`\u2705 File deleted from R2: ${key}`);
    return true;
  } catch (error) {
    console.error("\u274C Error deleting from R2:", {
      error: error instanceof Error ? error.message : "Unknown error",
      fileUrl,
      stack: error instanceof Error ? error.stack : void 0
    });
    return false;
  }
}
async function fileExistsInR2(fileUrl) {
  try {
    const client = getS3Client();
    const urlObj = new URL(fileUrl);
    const key = urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;
    const keyParts = key.split("/");
    const bucketIndex = keyParts.indexOf(R2_BUCKET_NAME);
    const actualKey = bucketIndex >= 0 ? keyParts.slice(bucketIndex + 1).join("/") : key;
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: actualKey
    });
    await client.send(command);
    return true;
  } catch (error) {
    return false;
  }
}
async function getPresignedUrl(fileUrl, expiresIn = 3600) {
  try {
    const client = getS3Client();
    const urlObj = new URL(fileUrl);
    const pathname = urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;
    const pathParts = pathname.split("/").filter((p) => p);
    const bucketIndex = pathParts.indexOf(R2_BUCKET_NAME);
    let key;
    if (bucketIndex >= 0) {
      key = pathParts.slice(bucketIndex + 1).join("/");
    } else {
      const knownFolders = ["documents", "kitchen-applications", "images", "profiles"];
      const firstPart = pathParts[0];
      if (knownFolders.includes(firstPart)) {
        key = pathname;
      } else {
        key = pathname;
      }
    }
    key = key.replace(/^\/+|\/+$/g, "");
    if (!key || key.length === 0) {
      throw new Error(`Invalid key extracted from URL: ${fileUrl}`);
    }
    try {
      await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    } catch (error) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        if (key.startsWith("documents/") && (key.includes("foodSafetyLicenseFile") || key.includes("foodEstablishmentCert"))) {
          const remappedKey = key.replace("documents/", "kitchen-applications/");
          console.log(`[R2 Storage] Key ${key} not found. Checking remapped: ${remappedKey}`);
          try {
            await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: remappedKey }));
            key = remappedKey;
            console.log(`[R2 Storage] Using remapped key: ${key}`);
          } catch (remapError) {
            console.log(`[R2 Storage] Remapped key also not found: ${remappedKey}`);
          }
        }
      } else {
        console.warn(`[R2 Storage] Warning: HeadObject validation failed for ${key}:`, error.message);
      }
    }
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key
    });
    const presignedUrl = await getSignedUrl(client, command, { expiresIn });
    return presignedUrl;
  } catch (error) {
    console.error("\u274C Error generating presigned URL:", {
      error: error instanceof Error ? error.message : "Unknown error",
      fileUrl,
      stack: error instanceof Error ? error.stack : void 0
    });
    throw new Error(`Failed to generate presigned URL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}
var R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL, R2_ENDPOINT, s3Client;
var init_r2_storage = __esm({
  "server/r2-storage.ts"() {
    "use strict";
    R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    R2_PUBLIC_URL = getR2PublicUrl();
    R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "";
    s3Client = null;
  }
});

// server/fileUpload.ts
import multer from "multer";
import path from "path";
import fs from "fs";
var isProduction, uploadsDir, storage, memoryStorage, fileFilter, upload, uploadToBlob, getFileUrl;
var init_fileUpload = __esm({
  "server/fileUpload.ts"() {
    "use strict";
    init_r2_storage();
    isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    uploadsDir = path.join(process.cwd(), "uploads", "documents");
    if (!isProduction && !fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadsDir);
      },
      filename: (req, file, cb) => {
        const userId = req.neonUser?.id || req.user?.id || "unknown";
        const timestamp2 = Date.now();
        const documentType = file.fieldname;
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const filename = `${userId}_${documentType}_${timestamp2}_${baseName}${ext}`;
        cb(null, filename);
      }
    });
    memoryStorage = multer.memoryStorage();
    fileFilter = (req, file, cb) => {
      const allowedMimes = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type. Only PDF, JPG, JPEG, PNG, and WebP files are allowed."));
      }
    };
    upload = multer({
      storage: isProduction ? memoryStorage : storage,
      limits: {
        fileSize: 10 * 1024 * 1024
        // 10MB limit
      },
      fileFilter
    });
    uploadToBlob = async (file, userId, folder = "documents") => {
      try {
        if (isR2Configured()) {
          return await uploadToR2(file, userId, folder);
        } else {
          const filename = file.filename || `${userId}_${Date.now()}_${file.originalname}`;
          return getFileUrl(filename);
        }
      } catch (error) {
        console.error("Error uploading file:", error);
        throw new Error("Failed to upload file to cloud storage");
      }
    };
    getFileUrl = (filename) => {
      return `/api/files/documents/${filename}`;
    };
  }
});

// server/domains/locations/location.repository.ts
import { eq as eq7, and as and5, desc as desc4 } from "drizzle-orm";
var LocationRepository;
var init_location_repository = __esm({
  "server/domains/locations/location.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_domain_error();
    LocationRepository = class {
      /**
       * Find location by ID
       */
      async findById(id) {
        try {
          const [location] = await db.select().from(locations).where(eq7(locations.id, id)).limit(1);
          return location || null;
        } catch (error) {
          console.error(`[LocationRepository] Error finding location by ID ${id}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to find location",
            500
          );
        }
      }
      /**
       * Find locations by manager ID
       */
      async findByManagerId(managerId) {
        try {
          const results = await db.select().from(locations).where(eq7(locations.managerId, managerId)).orderBy(desc4(locations.createdAt));
          return results;
        } catch (error) {
          console.error(`[LocationRepository] Error finding locations by manager ${managerId}:`, error);
          throw new DomainError(
            LocationErrorCodes.NO_MANAGER_ASSIGNED,
            "Failed to find locations",
            500
          );
        }
      }
      /**
       * Create new location
       */
      async create(dto) {
        try {
          const [location] = await db.insert(locations).values({
            name: dto.name,
            address: dto.address,
            managerId: dto.managerId,
            notificationEmail: dto.notificationEmail || null,
            notificationPhone: dto.notificationPhone || null,
            cancellationPolicyHours: dto.cancellationPolicyHours || 24,
            cancellationPolicyMessage: dto.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
            defaultDailyBookingLimit: dto.defaultDailyBookingLimit || 2,
            minimumBookingWindowHours: dto.minimumBookingWindowHours || 1,
            logoUrl: dto.logoUrl || null,
            brandImageUrl: dto.brandImageUrl || null,
            description: dto.description || null,
            customOnboardingLink: dto.customOnboardingLink || null,
            timezone: dto.timezone || "America/St_Johns",
            kitchenLicenseUrl: dto.kitchenLicenseUrl || null,
            kitchenLicenseStatus: dto.kitchenLicenseStatus || "pending",
            kitchenLicenseExpiry: dto.kitchenLicenseExpiry || null
          }).returning();
          return location;
        } catch (error) {
          console.error("[LocationRepository] Error creating location:", error);
          throw new DomainError(
            LocationErrorCodes.INVALID_ADDRESS,
            "Failed to create location",
            500
          );
        }
      }
      /**
       * Update existing location
       */
      async update(id, dto) {
        try {
          const [location] = await db.update(locations).set({
            name: dto.name,
            address: dto.address,
            managerId: dto.managerId,
            notificationEmail: dto.notificationEmail,
            notificationPhone: dto.notificationPhone,
            cancellationPolicyHours: dto.cancellationPolicyHours,
            cancellationPolicyMessage: dto.cancellationPolicyMessage,
            defaultDailyBookingLimit: dto.defaultDailyBookingLimit,
            minimumBookingWindowHours: dto.minimumBookingWindowHours,
            logoUrl: dto.logoUrl,
            brandImageUrl: dto.brandImageUrl,
            description: dto.description,
            customOnboardingLink: dto.customOnboardingLink,
            timezone: dto.timezone,
            kitchenLicenseUrl: dto.kitchenLicenseUrl,
            kitchenLicenseStatus: dto.kitchenLicenseStatus,
            kitchenLicenseExpiry: dto.kitchenLicenseExpiry
          }).where(eq7(locations.id, id)).returning();
          return location || null;
        } catch (error) {
          console.error(`[LocationRepository] Error updating location ${id}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update location",
            500
          );
        }
      }
      /**
       * Verify kitchen license
       */
      async verifyKitchenLicense(dto) {
        try {
          const [location] = await db.update(locations).set({
            kitchenLicenseStatus: dto.kitchenLicenseStatus,
            kitchenLicenseFeedback: dto.kitchenLicenseFeedback || null,
            kitchenLicenseApprovedBy: dto.kitchenLicenseApprovedBy,
            kitchenLicenseApprovedAt: /* @__PURE__ */ new Date(),
            kitchenLicenseExpiry: dto.kitchenLicenseExpiry || null
          }).where(eq7(locations.id, dto.locationId)).returning();
          return location || null;
        } catch (error) {
          console.error(`[LocationRepository] Error verifying kitchen license for location ${dto.locationId}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to verify kitchen license",
            500
          );
        }
      }
      /**
       * Update kitchen license URL
       */
      async updateKitchenLicenseUrl(locationId, licenseUrl) {
        try {
          const [location] = await db.update(locations).set({ kitchenLicenseUrl: licenseUrl }).where(eq7(locations.id, locationId)).returning();
          return location || null;
        } catch (error) {
          console.error(`[LocationRepository] Error updating kitchen license URL for location ${locationId}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update kitchen license URL",
            500
          );
        }
      }
      /**
       * Find all locations
       */
      async findAll() {
        try {
          const results = await db.select().from(locations).orderBy(desc4(locations.createdAt));
          return results;
        } catch (error) {
          console.error("[LocationRepository] Error finding all locations:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to find locations",
            500
          );
        }
      }
      /**
       * Check if location name exists
       */
      async nameExists(name, excludeId) {
        try {
          const result = await db.select({ id: locations.id }).from(locations).where(
            excludeId ? and5(eq7(locations.name, name), eq7(locations.id, excludeId)) : eq7(locations.name, name)
          ).limit(1);
          return result.length > 0;
        } catch (error) {
          console.error(`[LocationRepository] Error checking name existence ${name}:`, error);
          return false;
        }
      }
      /**
       * Find locations by manager
       */
      async countByManagerId(managerId) {
        try {
          const results = await db.select({ id: locations.id }).from(locations).where(eq7(locations.managerId, managerId));
          return results.length;
        } catch (error) {
          console.error(`[LocationRepository] Error counting locations by manager ${managerId}:`, error);
          return 0;
        }
      }
      /**
       * Find requirements by location ID
       */
      async findRequirementsByLocationId(locationId) {
        try {
          const [requirements] = await db.select().from(locationRequirements).where(eq7(locationRequirements.locationId, locationId));
          return requirements || null;
        } catch (error) {
          console.error(`[LocationRepository] Error finding requirements for location ${locationId}:`, error);
          return null;
        }
      }
      /**
       * Upsert location requirements
       */
      async upsertRequirements(locationId, dto) {
        try {
          const existing = await this.findRequirementsByLocationId(locationId);
          if (existing) {
            const [updated] = await db.update(locationRequirements).set({
              ...dto,
              updatedAt: /* @__PURE__ */ new Date()
            }).where(eq7(locationRequirements.locationId, locationId)).returning();
            return updated;
          } else {
            const [created] = await db.insert(locationRequirements).values({
              locationId,
              ...dto,
              // Ensure custom fields default to empty array if not provided
              customFields: dto.customFields ?? [],
              tier1_custom_fields: dto.tier1_custom_fields ?? [],
              tier2_custom_fields: dto.tier2_custom_fields ?? []
            }).returning();
            return created;
          }
        } catch (error) {
          console.error(`[LocationRepository] Error upserting requirements for location ${locationId}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update location requirements",
            500
          );
        }
      }
      /**
       * Delete location
       */
      async delete(id) {
        try {
          await db.delete(locations).where(eq7(locations.id, id));
        } catch (error) {
          console.error(`[LocationRepository] Error deleting location ${id}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to delete location",
            500
          );
        }
      }
    };
  }
});

// server/shared/validators/input-validator.ts
import { z as z3 } from "zod";
async function validateLocationInput(data) {
  const locationSchema = z3.object({
    managerId: z3.number().positive("Manager ID must be positive"),
    name: z3.string().min(2, "Location name must be at least 2 characters"),
    address: z3.string().min(5, "Address must be at least 5 characters"),
    notificationEmail: z3.string().email("Invalid email format").optional(),
    notificationPhone: z3.string().optional(),
    cancellationPolicyHours: z3.number().positive("Cancellation policy hours must be positive").optional(),
    cancellationPolicyMessage: z3.string().optional(),
    defaultDailyBookingLimit: z3.number().positive("Daily booking limit must be positive").optional(),
    minimumBookingWindowHours: z3.number().positive("Minimum booking window must be positive").optional(),
    logoUrl: z3.string().optional(),
    brandImageUrl: z3.string().optional(),
    timezone: z3.string().optional(),
    kitchenLicenseUrl: z3.string().optional(),
    kitchenLicenseStatus: z3.enum(["pending", "approved", "rejected"]).optional(),
    kitchenLicenseExpiry: z3.string().optional()
  });
  try {
    return locationSchema.parse(data);
  } catch (error) {
    if (error instanceof z3.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}
async function validateKitchenInput(data) {
  const kitchenSchema = z3.object({
    locationId: z3.number().positive("Location ID must be positive"),
    name: z3.string().min(1, "Kitchen name is required"),
    description: z3.string().optional(),
    imageUrl: z3.string().optional(),
    // Allow relative paths for local dev (starts with /)
    galleryImages: z3.array(z3.string()).optional(),
    amenities: z3.array(z3.string()).optional(),
    isActive: z3.boolean().optional(),
    hourlyRate: z3.number().positive("Hourly rate must be positive").optional(),
    currency: z3.string().length(3).optional(),
    minimumBookingHours: z3.number().positive("Minimum booking hours must be positive").optional(),
    pricingModel: z3.enum(["hourly", "daily", "weekly", "monthly-flat", "per-cubic-foot"]).optional()
  });
  try {
    return kitchenSchema.parse(data);
  } catch (error) {
    if (error instanceof z3.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}
var init_input_validator = __esm({
  "server/shared/validators/input-validator.ts"() {
    "use strict";
  }
});

// server/chat-service.ts
var chat_service_exports = {};
__export(chat_service_exports, {
  deleteConversation: () => deleteConversation,
  getUnreadCounts: () => getUnreadCounts,
  initializeConversation: () => initializeConversation,
  notifyTierTransition: () => notifyTierTransition,
  sendSystemNotification: () => sendSystemNotification
});
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { eq as eq8 } from "drizzle-orm";
async function getAdminDb() {
  if (!adminDb) {
    const app2 = initializeFirebaseAdmin();
    if (!app2) {
      throw new Error("Failed to initialize Firebase Admin");
    }
    adminDb = getFirestore(app2);
    adminDb.settings({ ignoreUndefinedProperties: true });
  }
  return adminDb;
}
async function initializeConversation(applicationData) {
  try {
    const adminDb2 = await getAdminDb();
    const [location] = await db.select({ managerId: locations.managerId }).from(locations).where(eq8(locations.id, applicationData.locationId)).limit(1);
    if (!location || !location.managerId) {
      console.error("Location not found or has no manager");
      return null;
    }
    const managerId = location.managerId;
    const existingQuery = await adminDb2.collection("conversations").where("applicationId", "==", applicationData.id).limit(1).get();
    if (!existingQuery.empty) {
      return existingQuery.docs[0].id;
    }
    const conversationRef = await adminDb2.collection("conversations").add({
      applicationId: applicationData.id,
      chefId: applicationData.chefId,
      managerId,
      locationId: applicationData.locationId,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadChefCount: 0,
      unreadManagerCount: 0
    });
    await db.update(chefKitchenApplications).set({ chat_conversation_id: conversationRef.id }).where(eq8(chefKitchenApplications.id, applicationData.id));
    return conversationRef.id;
  } catch (error) {
    console.error("Error initializing conversation:", error);
    return null;
  }
}
async function sendSystemNotification(conversationId, eventType, data) {
  try {
    const adminDb2 = await getAdminDb();
    let content = "";
    switch (eventType) {
      case "TIER1_APPROVED":
        content = `\u2705 Step 1 Approved: Your food handler certificate has been verified. You can now proceed to Step 2 - Kitchen Coordination.`;
        break;
      case "TIER1_REJECTED":
        content = `\u274C Step 1 Rejected: ${data?.reason || "Your application did not meet the requirements."}`;
        break;
      case "TIER2_COMPLETE":
        content = `\u2705 Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved.`;
        break;
      case "TIER3_SUBMITTED":
        content = `\u{1F4CB} Step 3 Submitted: Your government application has been submitted. We'll notify you once it's approved.`;
        break;
      case "TIER4_APPROVED":
        content = `\u{1F389} Step 4 Approved: Congratulations! Your license has been entered and you're fully approved to use the kitchen.`;
        break;
      case "DOCUMENT_UPLOADED":
        content = `\u{1F4C4} Document Uploaded: ${data?.fileName || "A document"} has been uploaded for review.`;
        break;
      case "DOCUMENT_VERIFIED":
        content = `\u2705 Document Verified: ${data?.documentName || "Your document"} has been verified.`;
        break;
      case "STATUS_CHANGED":
        content = `\u{1F4CA} Status Changed: Application status updated to ${data?.status || "new status"}.`;
        break;
      default:
        content = data?.message || "System notification";
    }
    const recentMessages = await adminDb2.collection("conversations").doc(conversationId).collection("messages").where("type", "==", "system").where("content", "==", content).get();
    if (!recentMessages.empty) {
      const now = (/* @__PURE__ */ new Date()).getTime();
      const isDuplicate = recentMessages.docs.some((doc) => {
        const msg = doc.data();
        const createdAt = msg.createdAt?.toDate?.() || (msg.createdAt instanceof Date ? msg.createdAt : null);
        return createdAt && now - createdAt.getTime() < 1e4;
      });
      if (isDuplicate) {
        console.log(`[CHAT] Skipping duplicate system message: "${content.substring(0, 30)}..."`);
        return;
      }
    }
    await adminDb2.collection("conversations").doc(conversationId).collection("messages").add({
      senderId: 0,
      senderRole: "system",
      content,
      type: "system",
      createdAt: FieldValue.serverTimestamp(),
      readAt: null
    });
    await adminDb2.collection("conversations").doc(conversationId).update({
      lastMessageAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Error sending system notification:", error);
  }
}
async function getUnreadCounts(userId, role) {
  try {
    const adminDb2 = await getAdminDb();
    const field = role === "chef" ? "chefId" : "managerId";
    const unreadField = role === "chef" ? "unreadChefCount" : "unreadManagerCount";
    const { AggregateField } = await import("firebase-admin/firestore");
    const snapshot = await adminDb2.collection("conversations").where(field, "==", userId).aggregate({
      totalUnread: AggregateField.sum(unreadField)
    }).get();
    return snapshot.data().totalUnread || 0;
  } catch (error) {
    console.error("Error getting unread counts:", error);
    return 0;
  }
}
async function deleteConversation(conversationId) {
  try {
    const adminDb2 = await getAdminDb();
    const messagesRef = adminDb2.collection("conversations").doc(conversationId).collection("messages");
    const messagesSnapshot = await messagesRef.get();
    const batchSize = 10;
    for (let i = 0; i < messagesSnapshot.docs.length; i += batchSize) {
      const batch = adminDb2.batch();
      const batchDocs = messagesSnapshot.docs.slice(i, i + batchSize);
      for (const doc of batchDocs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
    await adminDb2.collection("conversations").doc(conversationId).delete();
    console.log(`Successfully deleted conversation ${conversationId} and all its messages`);
  } catch (error) {
    console.error("Error deleting conversation:", error);
    throw error;
  }
}
async function notifyTierTransition(applicationId, fromTier, toTier, reason) {
  try {
    const [application] = await db.select().from(chefKitchenApplications).where(eq8(chefKitchenApplications.id, applicationId)).limit(1);
    if (!application) {
      console.error("Application not found for tier transition notification");
      return;
    }
    let conversationId = application.chat_conversation_id;
    if (!conversationId) {
      conversationId = await initializeConversation({
        id: applicationId,
        chefId: application.chefId,
        locationId: application.locationId
      });
      if (!conversationId) {
        console.error("Failed to initialize conversation for tier transition");
        return;
      }
    }
    let eventType = "";
    if (toTier === 2 && fromTier === 1) {
      eventType = "TIER1_APPROVED";
    } else if (toTier === 3 && fromTier === 2) {
      eventType = "TIER2_COMPLETE";
    } else if (toTier === 4) {
      eventType = "TIER4_APPROVED";
    }
    if (eventType && conversationId) {
      await sendSystemNotification(conversationId, eventType, { reason });
    }
  } catch (error) {
    console.error("Error notifying tier transition:", error);
  }
}
var adminDb;
var init_chat_service = __esm({
  "server/chat-service.ts"() {
    "use strict";
    init_firebase_setup();
    init_db();
    init_schema();
    adminDb = null;
  }
});

// server/domains/locations/location.service.ts
import { eq as eq9 } from "drizzle-orm";
var LocationService, locationService;
var init_location_service = __esm({
  "server/domains/locations/location.service.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_location_repository();
    init_domain_error();
    init_input_validator();
    LocationService = class {
      constructor(locationRepo) {
        this.locationRepo = locationRepo;
      }
      /**
       * Create new location with validation
       */
      async createLocation(dto) {
        try {
          const validatedData = await validateLocationInput(dto);
          if (validatedData.managerId) {
            const locationCount = await this.locationRepo.countByManagerId(validatedData.managerId);
            if (locationCount >= 10) {
              throw new DomainError(
                LocationErrorCodes.NO_MANAGER_ASSIGNED,
                "Manager cannot have more than 10 locations",
                400
              );
            }
          }
          const location = await this.locationRepo.create(validatedData);
          return location;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[LocationService] Error creating location:", error);
          throw new DomainError(
            LocationErrorCodes.INVALID_ADDRESS,
            "Failed to create location",
            500
          );
        }
      }
      /**
       * Update location with validation
       */
      async updateLocation(dto) {
        try {
          const existingLocation = await this.locationRepo.findById(dto.id);
          if (!existingLocation) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Location not found",
              404
            );
          }
          if (dto.managerId && dto.managerId !== existingLocation.managerId) {
            throw new DomainError(
              LocationErrorCodes.NO_MANAGER_ASSIGNED,
              "Cannot change location manager",
              400
            );
          }
          const updated = await this.locationRepo.update(dto.id, dto);
          if (!updated) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Failed to update location",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[LocationService] Error updating location:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update location",
            500
          );
        }
      }
      /**
       * Verify kitchen license
       */
      async verifyKitchenLicense(dto) {
        try {
          const existingLocation = await this.locationRepo.findById(dto.locationId);
          if (!existingLocation) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Location not found",
              404
            );
          }
          if (dto.kitchenLicenseStatus === "approved" && !dto.kitchenLicenseExpiry) {
            throw new DomainError(
              LocationErrorCodes.INVALID_ADDRESS,
              "License expiry date is required when approving",
              400
            );
          }
          if (dto.kitchenLicenseStatus === "approved" && !dto.kitchenLicenseApprovedBy) {
            throw new DomainError(
              LocationErrorCodes.NO_MANAGER_ASSIGNED,
              "Approved by user ID is required when approving",
              400
            );
          }
          const updated = await this.locationRepo.verifyKitchenLicense(dto);
          if (!updated) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Failed to verify kitchen license",
              404
            );
          }
          return updated;
        } catch (error) {
          console.error("[LocationService] Error verifying kitchen license:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to verify kitchen license",
            500
          );
        }
      }
      /**
       * Update kitchen license URL
       */
      async updateKitchenLicenseUrl(locationId, licenseUrl) {
        try {
          const existingLocation = await this.locationRepo.findById(locationId);
          if (!existingLocation) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Location not found",
              404
            );
          }
          const updated = await this.locationRepo.updateKitchenLicenseUrl(locationId, licenseUrl);
          if (!updated) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Failed to update kitchen license URL",
              404
            );
          }
          return updated;
        } catch (error) {
          console.error("[LocationService] Error updating kitchen license URL:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update kitchen license URL",
            500
          );
        }
      }
      /**
       * Get location by ID
       */
      async getLocationById(id) {
        try {
          const location = await this.locationRepo.findById(id);
          if (!location) {
            throw new DomainError(
              LocationErrorCodes.LOCATION_NOT_FOUND,
              "Location not found",
              404
            );
          }
          return location;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[LocationService] Error getting location by ID:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to get location",
            500
          );
        }
      }
      /**
       * Get locations by manager ID
       */
      async getLocationsByManagerId(managerId) {
        try {
          return await this.locationRepo.findByManagerId(managerId);
        } catch (error) {
          console.error("[LocationService] Error getting locations by manager:", error);
          throw new DomainError(
            LocationErrorCodes.NO_MANAGER_ASSIGNED,
            "Failed to get locations",
            500
          );
        }
      }
      /**
       * Get all locations
       */
      async getAllLocations() {
        try {
          return await this.locationRepo.findAll();
        } catch (error) {
          console.error("[LocationService] Error getting all locations:", error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to get locations",
            500
          );
        }
      }
      /**
       * Get location requirements with defaults if not configured
       */
      async getLocationRequirementsWithDefaults(locationId) {
        try {
          const requirements = await this.locationRepo.findRequirementsByLocationId(locationId);
          if (requirements) {
            return {
              ...requirements,
              customFields: Array.isArray(requirements.customFields) ? requirements.customFields : [],
              tier1_custom_fields: Array.isArray(requirements.tier1_custom_fields) ? requirements.tier1_custom_fields : [],
              tier2_custom_fields: Array.isArray(requirements.tier2_custom_fields) ? requirements.tier2_custom_fields : []
            };
          }
          return {
            id: -1,
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
            floor_plans_url: "",
            ventilation_specs: "",
            ventilation_specs_url: "",
            equipment_list: [],
            materials_description: "",
            createdAt: /* @__PURE__ */ new Date(),
            updatedAt: /* @__PURE__ */ new Date()
          };
        } catch (error) {
          console.error(`[LocationService] Error getting requirements for location ${locationId}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to get location requirements",
            500
          );
        }
      }
      /**
       * Upsert location requirements
       */
      async upsertLocationRequirements(locationId, dto) {
        try {
          await this.getLocationById(locationId);
          const requirements = await this.locationRepo.upsertRequirements(locationId, dto);
          return requirements;
        } catch (error) {
          if (error instanceof DomainError) throw error;
          console.error(`[LocationService] Error upserting requirements for location ${locationId}:`, error);
          throw new DomainError(
            LocationErrorCodes.LOCATION_NOT_FOUND,
            "Failed to update location requirements",
            500
          );
        }
      }
      async deleteLocation(id) {
        try {
          const locationApps = await db.select({
            id: chefKitchenApplications.id,
            conversationId: chefKitchenApplications.chat_conversation_id
          }).from(chefKitchenApplications).where(eq9(chefKitchenApplications.locationId, id));
          if (locationApps.length > 0) {
            const { deleteConversation: deleteConversation2 } = await Promise.resolve().then(() => (init_chat_service(), chat_service_exports));
            const cleanupPromises = locationApps.filter((app2) => app2.conversationId).map(
              (app2) => deleteConversation2(app2.conversationId).catch((err) => console.error(`Failed to delete conversation ${app2.conversationId}:`, err))
            );
            await Promise.all(cleanupPromises);
            console.log(`[LocationService] Cleaned up ${cleanupPromises.length} conversations for deleted location ${id}`);
          }
          await this.locationRepo.delete(id);
        } catch (error) {
          console.error("[LocationService] Error deleting location:", error);
          throw error;
        }
      }
    };
    locationService = new LocationService(new LocationRepository());
  }
});

// server/domains/kitchens/kitchen.repository.ts
import { eq as eq10, and as and6, desc as desc5, gte, lte, sql as sql2 } from "drizzle-orm";
var KitchenRepository;
var init_kitchen_repository = __esm({
  "server/domains/kitchens/kitchen.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_domain_error();
    KitchenRepository = class {
      /**
       * Helper to map DB result to DTO
       */
      mapToDTO(row) {
        return {
          ...row,
          description: row.description || void 0,
          hourlyRate: row.hourlyRate ? parseFloat(row.hourlyRate) : null,
          galleryImages: row.galleryImages || [],
          // Ensure type safety for JSONB
          amenities: row.amenities || [],
          // Ensure type safety for JSONB
          // Cast enum to specific string union type if needed, or trust strict match
          pricingModel: row.pricingModel,
          taxRatePercent: row.taxRatePercent ? parseFloat(row.taxRatePercent) : null
        };
      }
      /**
       * Find kitchen by ID
       */
      async findById(id) {
        try {
          const [kitchen] = await db.select().from(kitchens).where(eq10(kitchens.id, id)).limit(1);
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error finding kitchen by ID ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to find kitchen",
            500
          );
        }
      }
      /**
       * Find kitchens by location ID
       */
      async findByLocationId(locationId) {
        try {
          const results = await db.select().from(kitchens).where(eq10(kitchens.locationId, locationId)).orderBy(desc5(kitchens.createdAt));
          return results.map((k) => this.mapToDTO(k));
        } catch (error) {
          console.error(`[KitchenRepository] Error finding kitchens by location ${locationId}:`, error);
          throw new DomainError(
            KitchenErrorCodes.LOCATION_NOT_FOUND,
            "Failed to find kitchens",
            500
          );
        }
      }
      /**
       * Find active kitchens by location ID
       */
      async findActiveByLocationId(locationId) {
        try {
          const results = await db.select().from(kitchens).where(
            and6(
              eq10(kitchens.locationId, locationId),
              eq10(kitchens.isActive, true)
            )
          ).orderBy(desc5(kitchens.createdAt));
          return results.map((k) => this.mapToDTO(k));
        } catch (error) {
          console.error(`[KitchenRepository] Error finding active kitchens by location ${locationId}:`, error);
          throw new DomainError(
            KitchenErrorCodes.LOCATION_NOT_FOUND,
            "Failed to find kitchens",
            500
          );
        }
      }
      /**
       * Find all active kitchens
       */
      async findAllActive() {
        try {
          const results = await db.select().from(kitchens).where(eq10(kitchens.isActive, true)).orderBy(desc5(kitchens.createdAt));
          return results.map((k) => this.mapToDTO(k));
        } catch (error) {
          console.error("[KitchenRepository] Error finding all active kitchens:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to find kitchens",
            500
          );
        }
      }
      /**
       * Create new kitchen
       */
      async create(dto) {
        try {
          const [kitchen] = await db.insert(kitchens).values({
            locationId: dto.locationId,
            name: dto.name,
            description: dto.description || null,
            imageUrl: dto.imageUrl || null,
            galleryImages: dto.galleryImages || [],
            amenities: dto.amenities || [],
            isActive: dto.isActive !== void 0 ? dto.isActive : true,
            hourlyRate: dto.hourlyRate ? dto.hourlyRate.toString() : null,
            // Convert number to string for numeric column
            currency: dto.currency || "CAD",
            minimumBookingHours: dto.minimumBookingHours || 1,
            pricingModel: dto.pricingModel || "hourly",
            taxRatePercent: dto.taxRatePercent ? dto.taxRatePercent.toString() : null
          }).returning();
          return this.mapToDTO(kitchen);
        } catch (error) {
          console.error("[KitchenRepository] Error creating kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to create kitchen",
            500
          );
        }
      }
      /**
       * Update existing kitchen
       */
      async update(id, dto) {
        try {
          const [kitchen] = await db.update(kitchens).set({
            locationId: dto.locationId,
            name: dto.name,
            description: dto.description,
            imageUrl: dto.imageUrl,
            galleryImages: dto.galleryImages,
            amenities: dto.amenities,
            isActive: dto.isActive,
            hourlyRate: dto.hourlyRate ? dto.hourlyRate.toString() : void 0,
            // Convert number to string
            currency: dto.currency,
            minimumBookingHours: dto.minimumBookingHours,
            pricingModel: dto.pricingModel,
            taxRatePercent: dto.taxRatePercent ? dto.taxRatePercent.toString() : dto.taxRatePercent === null ? null : void 0
          }).where(eq10(kitchens.id, id)).returning();
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error updating kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to update kitchen",
            500
          );
        }
      }
      /**
       * Activate kitchen
       */
      async activate(id) {
        try {
          const [kitchen] = await db.update(kitchens).set({ isActive: true }).where(eq10(kitchens.id, id)).returning();
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error activating kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to activate kitchen",
            500
          );
        }
      }
      /**
       * Deactivate kitchen
       */
      async deactivate(id) {
        try {
          const [kitchen] = await db.update(kitchens).set({ isActive: false }).where(eq10(kitchens.id, id)).returning();
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error deactivating kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to deactivate kitchen",
            500
          );
        }
      }
      /**
       * Check if kitchen name exists for location
       */
      async nameExistsForLocation(name, locationId, excludeId) {
        try {
          const result = await db.select({ id: kitchens.id }).from(kitchens).where(
            and6(
              eq10(kitchens.locationId, locationId),
              eq10(kitchens.name, name),
              excludeId ? eq10(kitchens.id, excludeId) : void 0
            )
          ).limit(1);
          return result.length > 0;
        } catch (error) {
          console.error(`[KitchenRepository] Error checking name existence for location ${locationId}:`, error);
          return false;
        }
      }
      /**
       * Update kitchen image
       */
      async updateImage(id, imageUrl) {
        try {
          const [kitchen] = await db.update(kitchens).set({ imageUrl }).where(eq10(kitchens.id, id)).returning();
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error updating image for kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to update kitchen image",
            500
          );
        }
      }
      /**
       * Update kitchen gallery
       */
      async updateGallery(id, galleryImages) {
        try {
          const [kitchen] = await db.update(kitchens).set({ galleryImages }).where(eq10(kitchens.id, id)).returning();
          return kitchen ? this.mapToDTO(kitchen) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error updating gallery for kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to update kitchen gallery",
            500
          );
        }
      }
      /**
       * Find all kitchens
       */
      async findAll() {
        try {
          const results = await db.select().from(kitchens).orderBy(desc5(kitchens.createdAt));
          return results.map((k) => this.mapToDTO(k));
        } catch (error) {
          console.error("[KitchenRepository] Error finding all kitchens:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to find kitchens",
            500
          );
        }
      }
      /**
       * Find all kitchens with location details
       */
      async findAllWithLocation() {
        try {
          const results = await db.select({
            kitchen: kitchens,
            location: locations
          }).from(kitchens).leftJoin(locations, eq10(kitchens.locationId, locations.id)).orderBy(desc5(kitchens.createdAt));
          return results.map(({ kitchen, location }) => ({
            ...this.mapToDTO(kitchen),
            location: location ? {
              ...location,
              logoUrl: location.logoUrl || null,
              brandImageUrl: location.brandImageUrl || null,
              kitchenLicenseUrl: location.kitchenLicenseUrl || null,
              kitchenLicenseFeedback: location.kitchenLicenseFeedback || null,
              kitchenLicenseExpiry: location.kitchenLicenseExpiry || null,
              notificationEmail: location.notificationEmail || null,
              notificationPhone: location.notificationPhone || null,
              kitchenLicenseApprovedBy: location.kitchenLicenseApprovedBy || null
            } : void 0
          }));
        } catch (error) {
          console.error("[KitchenRepository] Error finding kitchens with location:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to find kitchens with location",
            500
          );
        }
      }
      /**
       * Delete kitchen
       */
      async delete(id) {
        try {
          await db.delete(kitchens).where(eq10(kitchens.id, id));
        } catch (error) {
          console.error(`[KitchenRepository] Error deleting kitchen ${id}:`, error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to delete kitchen",
            500
          );
        }
      }
      // ==========================================
      // Date Overrides
      // ==========================================
      mapOverrideToDTO(row) {
        return {
          ...row,
          startTime: row.startTime,
          endTime: row.endTime,
          reason: row.reason || null
        };
      }
      async findOverrides(kitchenId, startDate, endDate) {
        try {
          const results = await db.select().from(kitchenDateOverrides).where(
            and6(
              eq10(kitchenDateOverrides.kitchenId, kitchenId),
              gte(kitchenDateOverrides.specificDate, startDate),
              lte(kitchenDateOverrides.specificDate, endDate)
            )
          ).orderBy(kitchenDateOverrides.specificDate);
          return results.map((o) => this.mapOverrideToDTO(o));
        } catch (error) {
          console.error(`[KitchenRepository] Error finding overrides for kitchen ${kitchenId}:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to find overrides", 500);
        }
      }
      async findOverrideById(id) {
        try {
          const [override] = await db.select().from(kitchenDateOverrides).where(eq10(kitchenDateOverrides.id, id)).limit(1);
          return override ? this.mapOverrideToDTO(override) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error finding override ${id}:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to find override", 500);
        }
      }
      async createOverride(dto) {
        try {
          const [override] = await db.insert(kitchenDateOverrides).values({
            kitchenId: dto.kitchenId,
            specificDate: new Date(dto.specificDate),
            startTime: dto.startTime,
            endTime: dto.endTime,
            isAvailable: dto.isAvailable !== void 0 ? dto.isAvailable : false,
            reason: dto.reason
          }).returning();
          return this.mapOverrideToDTO(override);
        } catch (error) {
          console.error(`[KitchenRepository] Error creating override:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to create override", 500);
        }
      }
      async updateOverride(id, dto) {
        try {
          const [override] = await db.update(kitchenDateOverrides).set({
            startTime: dto.startTime,
            endTime: dto.endTime,
            isAvailable: dto.isAvailable,
            reason: dto.reason,
            updatedAt: /* @__PURE__ */ new Date()
          }).where(eq10(kitchenDateOverrides.id, id)).returning();
          return override ? this.mapOverrideToDTO(override) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error updating override ${id}:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to update override", 500);
        }
      }
      async deleteOverride(id) {
        try {
          await db.delete(kitchenDateOverrides).where(eq10(kitchenDateOverrides.id, id));
        } catch (error) {
          console.error(`[KitchenRepository] Error deleting override ${id}:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to delete override", 500);
        }
      }
      // ==========================================
      // Availability
      // ==========================================
      async findAvailability(kitchenId) {
        try {
          return await db.select().from(kitchenAvailability).where(eq10(kitchenAvailability.kitchenId, kitchenId));
        } catch (error) {
          console.error(`[KitchenRepository] Error finding availability for kitchen ${kitchenId}:`, error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to find availability", 500);
        }
      }
      async findOverrideForDate(kitchenId, date2) {
        try {
          const dateStr = date2.toISOString().split("T")[0];
          const [override] = await db.select().from(kitchenDateOverrides).where(
            and6(
              eq10(kitchenDateOverrides.kitchenId, kitchenId),
              sql2`DATE(${kitchenDateOverrides.specificDate}) = ${dateStr}::date`
            )
          ).limit(1);
          return override ? this.mapOverrideToDTO(override) : null;
        } catch (error) {
          console.error(`[KitchenRepository] Error finding override for date:`, error);
          return null;
        }
      }
    };
  }
});

// server/domains/kitchens/kitchen.service.ts
var KitchenService, kitchenService;
var init_kitchen_service = __esm({
  "server/domains/kitchens/kitchen.service.ts"() {
    "use strict";
    init_kitchen_repository();
    init_domain_error();
    init_input_validator();
    KitchenService = class {
      constructor(kitchenRepo) {
        this.kitchenRepo = kitchenRepo;
      }
      /**
       * Create new kitchen with validation
       */
      async createKitchen(dto) {
        try {
          const validatedData = await validateKitchenInput(dto);
          const nameExists = await this.kitchenRepo.nameExistsForLocation(validatedData.name, validatedData.locationId);
          if (nameExists) {
            throw new DomainError(
              KitchenErrorCodes.INVALID_PRICING,
              "Kitchen with this name already exists for this location",
              409
            );
          }
          const kitchen = await this.kitchenRepo.create(validatedData);
          return kitchen;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error creating kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            `Failed to create kitchen: ${error.message || "Unknown error"}`,
            500,
            { originalError: error }
          );
        }
      }
      /**
       * Update kitchen with validation
       */
      async updateKitchen(dto) {
        try {
          const existingKitchen = await this.kitchenRepo.findById(dto.id);
          if (!existingKitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          if (dto.locationId && dto.locationId !== existingKitchen.locationId) {
            throw new DomainError(
              KitchenErrorCodes.LOCATION_NOT_FOUND,
              "Cannot change kitchen location",
              400
            );
          }
          if (dto.name && dto.locationId) {
            const nameExists = await this.kitchenRepo.nameExistsForLocation(dto.name, dto.locationId, dto.id);
            if (nameExists) {
              throw new DomainError(
                KitchenErrorCodes.INVALID_PRICING,
                "Kitchen with this name already exists for this location",
                409
              );
            }
          }
          const updated = await this.kitchenRepo.update(dto.id, dto);
          if (!updated) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Failed to update kitchen",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error updating kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to update kitchen",
            500
          );
        }
      }
      /**
       * Activate kitchen
       */
      async activateKitchen(id) {
        try {
          const existingKitchen = await this.kitchenRepo.findById(id);
          if (!existingKitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          if (existingKitchen.isActive) {
            throw new DomainError(
              KitchenErrorCodes.INVALID_PRICING,
              "Kitchen is already active",
              400
            );
          }
          const updated = await this.kitchenRepo.activate(id);
          if (!updated) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Failed to activate kitchen",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error activating kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to activate kitchen",
            500
          );
        }
      }
      /**
       * Deactivate kitchen
       */
      async deactivateKitchen(id) {
        try {
          const existingKitchen = await this.kitchenRepo.findById(id);
          if (!existingKitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          if (!existingKitchen.isActive) {
            throw new DomainError(
              KitchenErrorCodes.INVALID_PRICING,
              "Kitchen is already inactive",
              400
            );
          }
          const updated = await this.kitchenRepo.deactivate(id);
          if (!updated) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Failed to deactivate kitchen",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error deactivating kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to deactivate kitchen",
            500
          );
        }
      }
      /**
       * Update kitchen image
       */
      async updateKitchenImage(id, imageUrl) {
        try {
          const existingKitchen = await this.kitchenRepo.findById(id);
          if (!existingKitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          const updated = await this.kitchenRepo.updateImage(id, imageUrl);
          if (!updated) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Failed to update kitchen image",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error updating kitchen image:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to update kitchen image",
            500
          );
        }
      }
      /**
       * Update kitchen gallery
       */
      async updateKitchenGallery(id, galleryImages) {
        try {
          const existingKitchen = await this.kitchenRepo.findById(id);
          if (!existingKitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          const updated = await this.kitchenRepo.updateGallery(id, galleryImages);
          if (!updated) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Failed to update kitchen gallery",
              404
            );
          }
          return updated;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error updating kitchen gallery:", error);
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            "Failed to update kitchen gallery",
            500
          );
        }
      }
      /**
       * Get kitchen by ID
       */
      async getKitchenById(id) {
        try {
          const kitchen = await this.kitchenRepo.findById(id);
          if (!kitchen) {
            throw new DomainError(
              KitchenErrorCodes.KITCHEN_NOT_FOUND,
              "Kitchen not found",
              404
            );
          }
          return kitchen;
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error getting kitchen by ID:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to get kitchen",
            500
          );
        }
      }
      /**
       * Get kitchens by location ID
       */
      async getKitchensByLocationId(locationId, activeOnly) {
        try {
          if (activeOnly) {
            return await this.kitchenRepo.findActiveByLocationId(locationId);
          } else {
            return await this.kitchenRepo.findByLocationId(locationId);
          }
        } catch (error) {
          console.error("[KitchenService] Error getting kitchens by location:", error);
          throw new DomainError(
            KitchenErrorCodes.LOCATION_NOT_FOUND,
            "Failed to get kitchens",
            500
          );
        }
      }
      /**
       * Get all active kitchens
       */
      async getAllActiveKitchens() {
        try {
          return await this.kitchenRepo.findAllActive();
        } catch (error) {
          console.error("[KitchenService] Error getting all active kitchens:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to get kitchens",
            500
          );
        }
      }
      /**
       * Get all kitchens
       */
      async getAllKitchens() {
        try {
          return await this.kitchenRepo.findAll();
        } catch (error) {
          console.error("[KitchenService] Error getting all kitchens:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to get kitchens",
            500
          );
        }
      }
      /**
       * Get all kitchens with location details
       */
      async getAllKitchensWithLocation() {
        try {
          return await this.kitchenRepo.findAllWithLocation();
        } catch (error) {
          console.error("[KitchenService] Error getting all kitchens with location:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to get kitchens with location",
            500
          );
        }
      }
      /**
       * Delete kitchen
       */
      async deleteKitchen(id) {
        try {
          await this.getKitchenById(id);
          await this.kitchenRepo.delete(id);
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          console.error("[KitchenService] Error deleting kitchen:", error);
          throw new DomainError(
            KitchenErrorCodes.KITCHEN_NOT_FOUND,
            "Failed to delete kitchen",
            500
          );
        }
      }
      // ==========================================
      // Date Overrides
      // ==========================================
      async getKitchenDateOverrides(kitchenId, start, end) {
        try {
          await this.getKitchenById(kitchenId);
          return await this.kitchenRepo.findOverrides(kitchenId, start, end);
        } catch (error) {
          if (error instanceof DomainError) throw error;
          console.error("[KitchenService] Error getting overrides:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to get overrides", 500);
        }
      }
      async createKitchenDateOverride(dto) {
        try {
          await this.getKitchenById(dto.kitchenId);
          return await this.kitchenRepo.createOverride(dto);
        } catch (error) {
          if (error instanceof DomainError) throw error;
          console.error("[KitchenService] Error creating override:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to create override", 500);
        }
      }
      async updateKitchenDateOverride(id, dto) {
        try {
          const existing = await this.kitchenRepo.findOverrideById(id);
          if (!existing) {
            throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Override not found", 404);
          }
          const updated = await this.kitchenRepo.updateOverride(id, dto);
          if (!updated) throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to update override", 500);
          return updated;
        } catch (error) {
          if (error instanceof DomainError) throw error;
          console.error("[KitchenService] Error updating override:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to update override", 500);
        }
      }
      async deleteKitchenDateOverride(id) {
        try {
          await this.kitchenRepo.deleteOverride(id);
        } catch (error) {
          console.error("[KitchenService] Error deleting override:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to delete override", 500);
        }
      }
      // ==========================================
      // Availability Helpers
      // ==========================================
      async getKitchenAvailability(kitchenId) {
        try {
          return this.kitchenRepo.findAvailability(kitchenId);
        } catch (error) {
          console.error("[KitchenService] Error getting availability:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to get availability", 500);
        }
      }
      async getKitchenDateOverrideForDate(kitchenId, date2) {
        try {
          return this.kitchenRepo.findOverrideForDate(kitchenId, date2);
        } catch (error) {
          console.error("[KitchenService] Error getting override for date:", error);
          throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, "Failed to get override", 500);
        }
      }
    };
    kitchenService = new KitchenService(new KitchenRepository());
  }
});

// server/domains/applications/tier-validation.ts
var tier_validation_exports = {};
__export(tier_validation_exports, {
  TierValidationService: () => TierValidationService,
  tierValidationService: () => tierValidationService
});
var TierValidationService, tierValidationService;
var init_tier_validation = __esm({
  "server/domains/applications/tier-validation.ts"() {
    "use strict";
    TierValidationService = class {
      /**
       * Validate if an application meets all requirements for a specific tier
       * This ensures enterprise-grade compliance with manager-set rules
       */
      validateTierRequirements(application, requirements, targetTier) {
        const missing = [];
        if (targetTier >= 1) {
          const tier1Fields = requirements.tier1_custom_fields || [];
          this.validateCustomFields(application, tier1Fields, missing);
        }
        if (targetTier >= 2) {
          if (requirements.tier2_food_establishment_cert_required) {
            if (application.foodEstablishmentCertStatus !== "approved") {
              missing.push("Food Establishment Certificate must be approved");
            }
            if (requirements.tier2_food_establishment_expiry_required && !application.foodEstablishmentCertExpiry) {
              missing.push("Food Establishment Certificate expiry date is required");
            }
          }
          if (requirements.tier2_insurance_document_required) {
            const tierData = application.tier_data || {};
            const hasInsurance = tierData.tierFiles?.["tier2_insurance_document"] || tierData.insuranceUrl;
            if (!hasInsurance) {
              missing.push("Insurance Document is required");
            }
          }
          if (requirements.tier2_allergen_plan_required) {
            const tierData = application.tier_data || {};
            if (!tierData.allergen_plan_confirmed && !tierData.tierFiles?.["tier2_allergen_plan"]) {
              missing.push("Allergen Plan is required");
            }
          }
          const tier2Fields = requirements.tier2_custom_fields || [];
          this.validateCustomFields(application, tier2Fields, missing);
        }
        return {
          valid: missing.length === 0,
          missingRequirements: missing
        };
      }
      validateCustomFields(application, fields, missing) {
        if (!fields || fields.length === 0) return;
        const tierData = application.tier_data || {};
        const customData = tierData.custom_fields || {};
        for (const field of fields) {
          if (field.required) {
            const value = customData[field.id];
            const fileValue = tierData.tierFiles?.[field.id];
            if ((value === void 0 || value === null || value === "") && !fileValue) {
              missing.push(`Missing required field: ${field.label}`);
            }
          }
        }
      }
    };
    tierValidationService = new TierValidationService();
  }
});

// server/phone-utils.ts
import { eq as eq12, and as and8, desc as desc6 } from "drizzle-orm";
async function getManagerPhone(location, managerId, pool3) {
  let phone = location?.notificationPhone || location?.notification_phone || null;
  if (phone) {
    const normalized = validateAndNormalizePhone(phone);
    if (normalized) {
      return normalized;
    }
    console.warn(`\u26A0\uFE0F Location notification phone is invalid format: ${phone}`);
  }
  if (!phone && managerId) {
    try {
      const result = await db.select({ phone: applications.phone }).from(applications).where(eq12(applications.userId, managerId)).orderBy(desc6(applications.createdAt)).limit(1);
      if (result.length > 0 && result[0].phone) {
        phone = result[0].phone;
        const normalized = validateAndNormalizePhone(phone);
        if (normalized) {
          return normalized;
        }
        console.warn(`\u26A0\uFE0F Manager application phone is invalid format: ${phone}`);
      }
    } catch (error) {
      console.warn("Could not retrieve manager phone from application:", error);
    }
  }
  return null;
}
async function getChefPhone(chefId, pool3) {
  if (!chefId) return null;
  try {
    const result = await db.select({ phone: applications.phone }).from(applications).where(eq12(applications.userId, chefId)).orderBy(desc6(applications.createdAt)).limit(1);
    if (result.length > 0 && result[0].phone) {
      const phone = result[0].phone;
      const normalized = validateAndNormalizePhone(phone);
      if (normalized) {
        return normalized;
      }
      console.warn(`\u26A0\uFE0F Chef application phone is invalid format: ${phone}`);
    }
  } catch (error) {
    console.warn("Could not retrieve chef phone from application:", error);
  }
  return null;
}
function normalizePhoneForStorage(phone) {
  if (!phone) return null;
  return validateAndNormalizePhone(phone);
}
var init_phone_utils = __esm({
  "server/phone-utils.ts"() {
    "use strict";
    init_phone_validation();
    init_db();
    init_schema();
  }
});

// server/routes/applications.ts
var applications_exports = {};
__export(applications_exports, {
  default: () => applications_default
});
import { Router as Router7 } from "express";
import fs3 from "fs";
import { fromZodError as fromZodError2 } from "zod-validation-error";
var router7, appRepo, appService, userRepo, userService2, applications_default;
var init_applications = __esm({
  "server/routes/applications.ts"() {
    "use strict";
    init_schema();
    init_fileUpload();
    init_email();
    init_phone_utils();
    init_firebase_auth_middleware();
    init_application_repository();
    init_application_service();
    init_user_repository();
    init_user_service();
    init_domain_error();
    router7 = Router7();
    appRepo = new ApplicationRepository();
    appService = new ApplicationService(appRepo);
    userRepo = new UserRepository();
    userService2 = new UserService(userRepo);
    router7.post(
      "/",
      upload.fields([
        { name: "foodSafetyLicense", maxCount: 1 },
        { name: "foodEstablishmentCert", maxCount: 1 }
      ]),
      async (req, res) => {
        try {
          if (!req.neonUser) {
            if (req.files) {
              const files2 = req.files;
              Object.values(files2).flat().forEach((file) => {
                try {
                  fs3.unlinkSync(file.path);
                } catch (e) {
                  console.error("Error cleaning up file:", e);
                }
              });
            }
            return res.status(401).json({ message: "You must be logged in to submit an application" });
          }
          const parsedData = insertApplicationSchema.safeParse(req.body);
          if (!parsedData.success) {
            if (req.files) {
              const files2 = req.files;
              Object.values(files2).flat().forEach((file) => {
                try {
                  fs3.unlinkSync(file.path);
                } catch (e) {
                  console.error("Error cleaning up file:", e);
                }
              });
            }
            const validationError = fromZodError2(parsedData.error);
            return res.status(400).json({
              message: "Validation error",
              errors: validationError.details
            });
          }
          const applicationData = {
            // Map fields from parsedData to CreateApplicationDTO
            userId: req.neonUser.id,
            fullName: parsedData.data.fullName,
            email: parsedData.data.email,
            phone: normalizePhoneForStorage(parsedData.data.phone) || parsedData.data.phone,
            foodSafetyLicense: parsedData.data.foodSafetyLicense,
            foodEstablishmentCert: parsedData.data.foodEstablishmentCert,
            kitchenPreference: parsedData.data.kitchenPreference,
            feedback: parsedData.data.feedback,
            // Files handled below
            foodSafetyLicenseUrl: void 0,
            foodEstablishmentCertUrl: void 0
          };
          console.log("=== APPLICATION SUBMISSION WITH DOCUMENTS ===");
          const files = req.files;
          if (files) {
            const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
            if (files.foodSafetyLicense && files.foodSafetyLicense[0]) {
              console.log("\u{1F4C4} Uploading food safety license file...");
              if (isProduction2) {
                applicationData.foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.neonUser.id);
              } else {
                applicationData.foodSafetyLicenseUrl = getFileUrl(files.foodSafetyLicense[0].filename);
              }
            }
            if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
              console.log("\u{1F4C4} Uploading food establishment cert file...");
              if (isProduction2) {
                applicationData.foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.neonUser.id);
              } else {
                applicationData.foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
              }
            }
          }
          if (req.body.foodSafetyLicenseUrl && !applicationData.foodSafetyLicenseUrl) {
            applicationData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
          }
          if (req.body.foodEstablishmentCertUrl && !applicationData.foodEstablishmentCertUrl) {
            applicationData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
          }
          const application = await appService.submitApplication(applicationData);
          console.log("\u2705 Application created successfully:", {
            id: application.id,
            hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl)
          });
          try {
            if (application.email) {
              const hasDocuments = !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl);
              if (hasDocuments) {
                const emailContent = generateApplicationWithDocumentsEmail({
                  fullName: application.fullName || "Applicant",
                  email: application.email
                });
                await sendEmail(emailContent, {
                  trackingId: `app_with_docs_${application.id}_${Date.now()} `
                });
              } else {
                const emailContent = generateApplicationWithoutDocumentsEmail({
                  fullName: application.fullName || "Applicant",
                  email: application.email
                });
                await sendEmail(emailContent, {
                  trackingId: `app_no_docs_${application.id}_${Date.now()} `
                });
              }
            }
          } catch (emailError) {
            console.error("Error sending new application email:", emailError);
          }
          console.log("=== APPLICATION SUBMISSION COMPLETE ===");
          return res.status(201).json(application);
        } catch (error) {
          console.error("Error creating application:", error);
          if (req.files) {
            const files = req.files;
            Object.values(files).flat().forEach((file) => {
              try {
                if (file.path) {
                  fs3.unlinkSync(file.path);
                }
              } catch (e) {
                console.error("Error cleaning up file:", e);
              }
            });
          }
          if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
          }
          return res.status(500).json({ message: "Internal server error" });
        }
      }
    );
    router7.patch(
      "/:id/documents",
      requireFirebaseAuthWithUser,
      upload.fields([
        { name: "foodSafetyLicense", maxCount: 1 },
        { name: "foodEstablishmentCert", maxCount: 1 }
      ]),
      async (req, res) => {
        try {
          const id = parseInt(req.params.id);
          if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
          }
          console.log(`\u{1F4DD} PATCH /api/applications/${id}/documents - User ${req.neonUser.id} updating documents`);
          const application = await appService.getApplicationById(id);
          if (!application) {
            return res.status(404).json({ message: "Application not found" });
          }
          if (application.userId !== req.neonUser.id) {
            return res.status(403).json({ message: "Access denied" });
          }
          const files = req.files;
          let foodSafetyLicenseUrl;
          let foodEstablishmentCertUrl;
          const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
          if (files) {
            if (files.foodSafetyLicense && files.foodSafetyLicense[0]) {
              console.log("\u{1F4C4} Uploading food safety license file...");
              if (isProduction2) {
                foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.neonUser.id, "documents");
              } else {
                foodSafetyLicenseUrl = getFileUrl(files.foodSafetyLicense[0].filename);
              }
            }
            if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
              console.log("\u{1F4C4} Uploading food establishment cert file...");
              if (isProduction2) {
                foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.neonUser.id, "documents");
              } else {
                foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
              }
            }
          }
          const updates = {};
          if (foodSafetyLicenseUrl) {
            updates.foodSafetyLicenseUrl = foodSafetyLicenseUrl;
          }
          if (foodEstablishmentCertUrl) {
            updates.foodEstablishmentCertUrl = foodEstablishmentCertUrl;
          }
          if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: "No documents provided for update" });
          }
          const updatedApplication = await appService.updateDocuments(id, updates);
          if (!updatedApplication) {
            return res.status(500).json({ message: "Failed to update application documents" });
          }
          res.json(updatedApplication);
        } catch (error) {
          console.error("Error updating application documents:", error);
          res.status(500).json({
            error: "Failed to update application documents",
            message: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    );
    router7.get("/", async (req, res) => {
      if (!req.neonUser) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (req.neonUser.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }
      try {
        const applications3 = await appService.getAllApplications();
        return res.status(200).json(applications3);
      } catch (error) {
        console.error("Error fetching applications:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    router7.get("/my-applications", async (req, res) => {
      if (!req.neonUser) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const userId = req.neonUser.id;
        const applications3 = await appService.getApplicationsByUserId(userId);
        return res.status(200).json(applications3);
      } catch (error) {
        console.error("Error fetching user applications:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    router7.get("/:id", async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid application ID" });
        }
        const application = await appService.getApplicationById(id);
        return res.status(200).json(application);
      } catch (error) {
        console.error("Error fetching application:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    router7.patch("/:id/status", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Not authenticated" });
        }
        if (req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied. Admin role required." });
        }
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid application ID" });
        }
        const parsedData = updateApplicationStatusSchema.safeParse({
          id,
          ...req.body
        });
        if (!parsedData.success) {
          const validationError = fromZodError2(parsedData.error);
          return res.status(400).json({
            message: "Validation error",
            errors: validationError.details
          });
        }
        const updatedApplication = await appService.updateStatus(id, parsedData.data.status);
        try {
          if (updatedApplication.email) {
            const emailContent = generateStatusChangeEmail({
              fullName: updatedApplication.fullName || "Applicant",
              email: updatedApplication.email,
              status: updatedApplication.status
            });
            await sendEmail(emailContent, {
              trackingId: `status_${updatedApplication.id}_${updatedApplication.status}_${Date.now()} `
            });
          }
        } catch (emailError) {
          console.error("Error sending status change email:", emailError);
        }
        return res.status(200).json(updatedApplication);
      } catch (error) {
        console.error("Error updating application status:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    router7.patch("/:id/cancel", async (req, res) => {
      const userId = req.neonUser?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid application ID" });
        }
        const updatedApplication = await appService.cancelApplication(id, userId);
        try {
          if (updatedApplication.email) {
            const emailContent = generateStatusChangeEmail({
              fullName: updatedApplication.fullName || "Applicant",
              email: updatedApplication.email,
              status: "cancelled"
            });
            await sendEmail(emailContent, {
              trackingId: `cancel_${updatedApplication.id}_${Date.now()} `
            });
          }
        } catch (emailError) {
          console.error("Error sending cancellation email:", emailError);
        }
        return res.status(200).json(updatedApplication);
      } catch (error) {
        console.error("Error cancelling application:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    router7.patch("/:id/document-verification", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Not authenticated" });
        }
        if (req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied. Admin role required." });
        }
        const applicationId = parseInt(req.params.id);
        if (isNaN(applicationId)) {
          return res.status(400).json({ message: "Invalid application ID" });
        }
        const parsedData = updateDocumentVerificationSchema.safeParse({
          id: applicationId,
          ...req.body,
          documentsReviewedBy: req.neonUser.id
        });
        if (!parsedData.success) {
          const validationError = fromZodError2(parsedData.error);
          return res.status(400).json({
            message: "Validation error",
            errors: validationError.details
          });
        }
        const existingApplication = await appService.getApplicationById(applicationId);
        const verifyDto = {
          id: applicationId,
          foodSafetyLicenseStatus: parsedData.data.foodSafetyLicenseStatus || existingApplication.foodSafetyLicenseStatus,
          foodEstablishmentCertStatus: parsedData.data.foodEstablishmentCertStatus || existingApplication.foodEstablishmentCertStatus,
          documentsAdminFeedback: parsedData.data.documentsAdminFeedback,
          documentsReviewedBy: req.neonUser.id
        };
        const updatedApplication = await appService.verifyDocuments(verifyDto);
        if (updatedApplication.foodSafetyLicenseStatus === "approved" && (!updatedApplication.foodEstablishmentCertUrl || updatedApplication.foodEstablishmentCertStatus === "approved")) {
          if (updatedApplication.userId) {
            await userService2.verifyUser(updatedApplication.userId, true);
            console.log(`User ${updatedApplication.userId} has been fully verified`);
          }
        }
        return res.status(200).json(updatedApplication);
      } catch (error) {
        console.error("Error updating application document verification:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    applications_default = router7;
  }
});

// server/routes/utils.ts
var utils_exports = {};
__export(utils_exports, {
  normalizeImageUrl: () => normalizeImageUrl
});
function normalizeImageUrl(url, req) {
  if (!url) return null;
  const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const getOrigin = () => {
    let protocol;
    let host;
    if (isProduction2) {
      protocol = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
      host = req.get("x-forwarded-host") || req.get("host") || req.headers.host || "";
      if (protocol !== "https") protocol = "https";
    } else {
      protocol = req.protocol || "http";
      host = req.get("host") || req.headers.host || "localhost:5001";
    }
    return `${protocol}://${host}`;
  };
  if (url.startsWith("https://files.localcooks.ca/")) {
    const r2Path = url.replace("https://files.localcooks.ca/", "");
    const origin = getOrigin();
    return `${origin}/api/files/images/r2/${encodeURIComponent(r2Path)}`;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (url.includes("r2.localcooks.com/documents/") || url.includes(".r2.dev/documents/")) {
      const filename = url.split("/").pop();
      if (filename) {
        const origin = getOrigin();
        return `${origin}/api/files/documents/${filename}`;
      }
    }
    return url;
  }
  if (url.startsWith("/")) {
    const origin = getOrigin();
    if (!origin || origin === "://") {
      console.warn(`[normalizeImageUrl] Could not determine host for URL: ${url}`);
      return url;
    }
    return `${origin}${url}`;
  }
  return url;
}
var init_utils = __esm({
  "server/routes/utils.ts"() {
    "use strict";
  }
});

// server/routes/locations.ts
var locations_exports = {};
__export(locations_exports, {
  default: () => locations_default
});
import { Router as Router8 } from "express";
import { fromZodError as fromZodError3 } from "zod-validation-error";
var router8, locationRepository2, locationService3, kitchenRepository2, kitchenService3, locations_default;
var init_locations = __esm({
  "server/routes/locations.ts"() {
    "use strict";
    init_firebase_auth_middleware();
    init_utils();
    init_schema();
    init_location_repository();
    init_location_service();
    init_kitchen_repository();
    init_kitchen_service();
    init_domain_error();
    router8 = Router8();
    locationRepository2 = new LocationRepository();
    locationService3 = new LocationService(locationRepository2);
    kitchenRepository2 = new KitchenRepository();
    kitchenService3 = new KitchenService(kitchenRepository2);
    router8.get("/public/locations", async (req, res) => {
      try {
        const [allLocations, allKitchens] = await Promise.all([
          locationService3.getAllLocations(),
          kitchenService3.getAllActiveKitchens()
        ]);
        const publicLocations = allLocations.map((location) => {
          const locationKitchens = allKitchens.filter((k) => k.locationId === location.id);
          const featuredKitchen = locationKitchens.find((k) => k.imageUrl) || locationKitchens[0];
          const featuredKitchenImage = normalizeImageUrl(featuredKitchen?.imageUrl || null, req);
          const logoUrl = normalizeImageUrl(location.logoUrl || null, req);
          const brandImageUrl = normalizeImageUrl(location.brandImageUrl || null, req);
          const kitchenCount = locationKitchens.length;
          return {
            id: location.id,
            name: location.name,
            address: location.address,
            brandImageUrl,
            brand_image_url: brandImageUrl,
            // compatibility
            logoUrl,
            logo_url: logoUrl,
            // compatibility
            featuredKitchenImage,
            featured_kitchen_image: featuredKitchenImage,
            // compatibility
            kitchenCount,
            kitchen_count: kitchenCount,
            // compatibility
            description: location.description || null
          };
        });
        res.json(publicLocations);
      } catch (error) {
        console.error("Error fetching public locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
      }
    });
    router8.get("/public/locations/:locationId/details", async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const location = await locationService3.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ error: "Location not found" });
        }
        const activeKitchens = await kitchenService3.getKitchensByLocationId(locationId, true);
        const brandImageUrl = normalizeImageUrl(
          location.brandImageUrl || null,
          req
        );
        const logoUrl = normalizeImageUrl(
          location.logoUrl || null,
          req
        );
        const sanitizedKitchens = activeKitchens.map((kitchen) => {
          const kImageUrl = normalizeImageUrl(
            kitchen.imageUrl || null,
            req
          );
          const kGalleryImages = (kitchen.galleryImages || []).map(
            (img) => normalizeImageUrl(img, req)
          ).filter((url) => url !== null);
          const hourlyRateCents = kitchen.hourlyRate;
          const hourlyRate = hourlyRateCents !== null && hourlyRateCents !== void 0 ? (typeof hourlyRateCents === "string" ? parseFloat(hourlyRateCents) : hourlyRateCents) / 100 : null;
          return {
            id: kitchen.id,
            name: kitchen.name,
            description: kitchen.description,
            imageUrl: kImageUrl,
            image_url: kImageUrl,
            galleryImages: kGalleryImages,
            gallery_images: kGalleryImages,
            // compatibility
            amenities: kitchen.amenities || [],
            hourlyRate,
            hourly_rate: hourlyRate,
            // compatibility
            pricingModel: kitchen.pricingModel || "hourly",
            currency: kitchen.currency || "CAD"
          };
        });
        res.json({
          id: location.id,
          name: location.name,
          address: location.address,
          brandImageUrl,
          brand_image_url: brandImageUrl,
          // compatibility
          logoUrl,
          logo_url: logoUrl,
          // compatibility
          description: location.description || null,
          customOnboardingLink: location.customOnboardingLink || null,
          kitchens: sanitizedKitchens
        });
      } catch (error) {
        console.error("Error fetching location details:", error);
        if (error instanceof DomainError) {
          return res.status(error.statusCode).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to fetch location details" });
      }
    });
    router8.get("/public/locations/:locationId/requirements", async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const requirements = await locationService3.getLocationRequirementsWithDefaults(locationId);
        res.json(requirements);
      } catch (error) {
        console.error("Error getting location requirements:", error);
        res.status(500).json({ error: "Failed to get requirements" });
      }
    });
    router8.get(
      "/manager/locations/:locationId/requirements",
      requireFirebaseAuthWithUser,
      requireManager,
      async (req, res) => {
        try {
          const user = req.neonUser;
          const locationId = parseInt(req.params.locationId);
          if (isNaN(locationId)) {
            return res.status(400).json({ error: "Invalid location ID" });
          }
          const location = await locationService3.getLocationById(locationId);
          if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: "Access denied" });
          }
          const requirements = await locationService3.getLocationRequirementsWithDefaults(locationId);
          res.json(requirements);
        } catch (error) {
          console.error("Error getting location requirements:", error);
          res.status(500).json({ error: "Failed to get requirements" });
        }
      }
    );
    router8.put(
      "/manager/locations/:locationId/requirements",
      requireFirebaseAuthWithUser,
      requireManager,
      async (req, res) => {
        try {
          const user = req.neonUser;
          const locationId = parseInt(req.params.locationId);
          if (isNaN(locationId)) {
            return res.status(400).json({ error: "Invalid location ID" });
          }
          const location = await locationService3.getLocationById(locationId);
          if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: "Access denied" });
          }
          const parseResult = updateLocationRequirementsSchema.safeParse(req.body);
          if (!parseResult.success) {
            const validationError = fromZodError3(parseResult.error);
            console.error("\u274C Validation error updating location requirements:", validationError.message);
            return res.status(400).json({
              error: "Validation error",
              message: validationError.message,
              details: validationError.details
            });
          }
          const updates = parseResult.data;
          const requirements = await locationService3.upsertLocationRequirements(locationId, updates);
          console.log(`\u2705 Location requirements updated for location ${locationId} by manager ${user.id} `);
          res.json({ success: true, requirements });
        } catch (error) {
          console.error("\u274C Error updating location requirements:", error);
          res.status(500).json({
            error: "Failed to update requirements",
            message: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    );
    locations_default = router8;
  }
});

// server/alwaysFoodSafeAPI.ts
async function submitToAlwaysFoodSafe(submission) {
  const apiKey = process.env.ALWAYS_FOOD_SAFE_API_KEY;
  const apiUrl = process.env.ALWAYS_FOOD_SAFE_API_URL || "https://api.alwaysfoodsafe.com";
  if (!apiKey) {
    throw new Error("Always Food Safe API key not configured");
  }
  try {
    const response = await fetch(`${apiUrl}/api/v1/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "LocalCooks-Platform/1.0"
      },
      body: JSON.stringify({
        user: {
          id: submission.userId,
          name: submission.userName,
          email: submission.email
        },
        completion: {
          date: submission.completionDate.toISOString(),
          modules: submission.videoProgress.map((video) => ({
            id: video.videoId,
            completed: video.completed,
            progress: video.progress,
            completedAt: video.completedAt
          }))
        },
        course: {
          type: "microlearning",
          provider: "LocalCooks",
          modules: ["food-handling", "contamination-prevention", "allergen-awareness"]
        }
      })
    });
    if (!response.ok) {
      throw new Error(`Always Food Safe API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return {
      success: true,
      certificateId: data.certificate?.id,
      certificateUrl: data.certificate?.url,
      message: data.message || "Completion submitted successfully"
    };
  } catch (error) {
    console.error("Always Food Safe API submission failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
}
function isAlwaysFoodSafeConfigured() {
  return !!(process.env.ALWAYS_FOOD_SAFE_API_KEY && process.env.ALWAYS_FOOD_SAFE_API_URL);
}
var init_alwaysFoodSafeAPI = __esm({
  "server/alwaysFoodSafeAPI.ts"() {
    "use strict";
  }
});

// server/routes/microlearning.ts
var microlearning_exports = {};
__export(microlearning_exports, {
  default: () => microlearning_default
});
import { Router as Router9 } from "express";
var router9, hasApprovedApplication, microlearning_default;
var init_microlearning = __esm({
  "server/routes/microlearning.ts"() {
    "use strict";
    init_user_service();
    init_microlearning_service();
    init_application_service();
    init_alwaysFoodSafeAPI();
    router9 = Router9();
    hasApprovedApplication = async (userId) => {
      try {
        const applications3 = await applicationService.getApplicationsByUserId(userId);
        return applications3.some((app2) => app2.status === "approved");
      } catch (error) {
        console.error("Error checking application status:", error);
        return false;
      }
    };
    router9.get("/progress/:userId", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const paramUserId = req.params.userId;
        let userId;
        if (isNaN(parseInt(paramUserId))) {
          userId = req.neonUser.id;
        } else {
          userId = parseInt(paramUserId);
        }
        if (req.neonUser.id !== userId && req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
        const progress = await microlearningService.getUserProgress(userId);
        const completionStatus = await microlearningService.getUserCompletion(userId);
        const hasApproval = await hasApprovedApplication(userId);
        const isAdmin = req.neonUser.role === "admin";
        const isCompleted = completionStatus?.confirmed || false;
        const accessLevel = isAdmin || hasApproval || isCompleted ? "full" : "limited";
        res.json({
          success: true,
          progress: progress || [],
          completionConfirmed: completionStatus?.confirmed || false,
          completedAt: completionStatus?.completedAt,
          hasApprovedApplication: hasApproval,
          accessLevel,
          // admins get full access, others limited to first video only
          isAdmin
        });
      } catch (error) {
        console.error("Error fetching microlearning progress:", error);
        res.status(500).json({ message: "Failed to fetch progress" });
      }
    });
    router9.post("/progress", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const { userId, videoId, progress, completed, completedAt, watchedPercentage } = req.body;
        if (req.neonUser.id !== userId && req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
        const hasApproval = await hasApprovedApplication(userId);
        const completionStatus = await microlearningService.getUserCompletion(userId);
        const isCompleted = completionStatus?.confirmed || false;
        const firstVideoId = "basics-cross-contamination";
        const isAdmin = req.neonUser.role === "admin";
        if (!hasApproval && !isAdmin && !isCompleted && videoId !== firstVideoId) {
          return res.status(403).json({
            message: "Application approval required to access this video",
            accessLevel: "limited",
            firstVideoOnly: true
          });
        }
        const actualCompleted = completed;
        const progressData = {
          userId,
          videoId,
          progress: Math.max(0, Math.min(100, progress)),
          // Clamp between 0-100
          watchedPercentage: Math.max(0, Math.min(100, watchedPercentage || 0)),
          // Clamp between 0-100
          completed: actualCompleted,
          completedAt: actualCompleted ? completedAt ? new Date(completedAt) : /* @__PURE__ */ new Date() : null,
          updatedAt: /* @__PURE__ */ new Date()
        };
        await microlearningService.updateVideoProgress(progressData);
        res.json({
          success: true,
          message: "Progress updated successfully"
        });
      } catch (error) {
        console.error("Error updating video progress:", error);
        res.status(500).json({ message: "Failed to update progress" });
      }
    });
    router9.post("/complete", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const { userId, completionDate, videoProgress: videoProgress2 } = req.body;
        if (req.neonUser.id !== userId && req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
        const hasApproval = await hasApprovedApplication(userId);
        const isAdmin = req.neonUser.role === "admin";
        if (!hasApproval && !isAdmin) {
          return res.status(403).json({
            message: "Application approval required to complete full certification",
            accessLevel: "limited",
            requiresApproval: true
          });
        }
        const requiredVideos = [
          // Food Safety Basics Module (14 videos)
          "basics-personal-hygiene",
          "basics-temperature-danger",
          "basics-cross-contamination",
          "basics-allergen-awareness",
          "basics-food-storage",
          "basics-cooking-temps",
          "basics-cooling-reheating",
          "basics-thawing",
          "basics-receiving",
          "basics-fifo",
          "basics-illness-reporting",
          "basics-pest-control",
          "basics-chemical-safety",
          "basics-food-safety-plan",
          // Safety and Hygiene How-To's Module (8 videos)
          "howto-handwashing",
          "howto-sanitizing",
          "howto-thermometer",
          "howto-cleaning-schedule",
          "howto-equipment-cleaning",
          "howto-uniform-care",
          "howto-wound-care",
          "howto-inspection-prep"
        ];
        const completedVideos = videoProgress2.filter((v) => v.completed).map((v) => v.videoId);
        const allRequired = requiredVideos.every((videoId) => completedVideos.includes(videoId));
        if (!allRequired) {
          return res.status(400).json({
            message: "All required videos must be completed before certification",
            missingVideos: requiredVideos.filter((id) => !completedVideos.includes(id))
          });
        }
        const user = await userService.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        const completionData = {
          userId,
          completedAt: new Date(completionDate),
          videoProgress: videoProgress2,
          confirmed: true,
          certificateGenerated: false
        };
        await microlearningService.completeMicrolearning(completionData);
        let alwaysFoodSafeResult = null;
        if (isAlwaysFoodSafeConfigured()) {
          try {
            alwaysFoodSafeResult = await submitToAlwaysFoodSafe({
              userId,
              userName: user.username,
              email: `${user.username}@localcooks.ca`,
              // Placeholder email since User type doesn't have email
              completionDate: new Date(completionDate),
              videoProgress: videoProgress2
            });
          } catch (afsError) {
            console.error("Always Food Safe API error:", afsError);
          }
        }
        res.json({
          success: true,
          message: "Microlearning completed successfully",
          completionConfirmed: true,
          alwaysFoodSafeIntegration: alwaysFoodSafeResult?.success ? "success" : "not_configured",
          certificateId: alwaysFoodSafeResult?.certificateId,
          certificateUrl: alwaysFoodSafeResult?.certificateUrl
        });
      } catch (error) {
        console.error("Error completing microlearning:", error);
        res.status(500).json({ message: "Failed to complete microlearning" });
      }
    });
    router9.get("/completion/:userId", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const paramUserId = req.params.userId;
        let userId;
        if (isNaN(parseInt(paramUserId))) {
          userId = req.neonUser.id;
        } else {
          userId = parseInt(paramUserId);
        }
        if (req.neonUser.id !== userId && req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
        const completion = await microlearningService.getUserCompletion(userId);
        if (!completion) {
          return res.json({ confirmed: false, completedAt: null });
        }
        res.json(completion);
      } catch (error) {
        console.error("Error getting microlearning completion status:", error);
        res.status(500).json({ message: "Failed to get completion status" });
      }
    });
    router9.get("/certificate/:userId", async (req, res) => {
      try {
        if (!req.neonUser) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const userId = parseInt(req.params.userId);
        if (req.neonUser.id !== userId && req.neonUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
        const completion = await microlearningService.getUserCompletion(userId);
        if (!completion || !completion.confirmed) {
          return res.status(404).json({ message: "No confirmed completion found" });
        }
        const user = await userService.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        const certificateUrl = `/api/certificates/microlearning-${userId}-${Date.now()}.pdf`;
        res.json({
          success: true,
          certificateUrl,
          completionDate: completion.completedAt,
          message: "Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl"
        });
      } catch (error) {
        console.error("Error generating certificate:", error);
        res.status(500).json({ message: "Failed to generate certificate" });
      }
    });
    microlearning_default = router9;
  }
});

// server/routes/files.ts
var files_exports = {};
__export(files_exports, {
  default: () => files_default
});
import express, { Router as Router10 } from "express";
import path2 from "path";
import fs4 from "fs";
var router10, files_default;
var init_files = __esm({
  "server/routes/files.ts"() {
    "use strict";
    init_r2_storage();
    init_fileUpload();
    init_firebase_auth_middleware();
    init_user_service();
    init_r2_storage();
    router10 = Router10();
    router10.post(
      "/upload-file",
      optionalFirebaseAuth,
      // Auth first so req.neonUser is set for multer filename generation
      upload.single("file"),
      // Then process file
      async (req, res) => {
        try {
          const userId = req.neonUser?.id || req.user?.id;
          if (!userId) {
            if (req.file && req.file.path) {
              try {
                fs4.unlinkSync(req.file.path);
              } catch (e) {
                console.error("Error cleaning up file:", e);
              }
            }
            return res.status(401).json({ error: "Not authenticated" });
          }
          if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
          }
          const folder = req.body.folder || "documents";
          const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
          let fileUrl;
          let fileName;
          if (isProduction2) {
            fileUrl = await uploadToBlob(req.file, userId, folder);
            fileName = fileUrl.split("/").pop() || req.file.originalname;
          } else {
            fileUrl = getFileUrl(req.file.filename);
            fileName = req.file.filename;
          }
          return res.status(200).json({
            success: true,
            url: fileUrl,
            fileName,
            size: req.file.size,
            type: req.file.mimetype
          });
        } catch (error) {
          console.error("File upload error:", error);
          if (req.file && req.file.path) {
            try {
              fs4.unlinkSync(req.file.path);
            } catch (e) {
              console.error("Error cleaning up file:", e);
            }
          }
          return res.status(500).json({
            error: "File upload failed",
            details: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    );
    router10.post("/images/presigned-url", optionalFirebaseAuth, async (req, res) => {
      try {
        const user = req.neonUser;
        const { imageUrl } = req.body;
        if (!imageUrl || typeof imageUrl !== "string") {
          return res.status(400).json({ error: "imageUrl is required" });
        }
        const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
        const isDevelopment = process.env.NODE_ENV === "development" || !isProduction2 && !process.env.VERCEL_ENV;
        if (isDevelopment) {
          console.log("\u{1F4BB} Development mode: Returning original URL without presigned URL");
          return res.json({ url: imageUrl });
        }
        if (isProduction2) {
          try {
            if (!isR2Configured()) {
              console.warn("R2 not configured, returning original URL");
              return res.json({ url: imageUrl });
            }
            const isPublic = imageUrl.includes("/public/") || imageUrl.includes("/kitchens/");
            if (!isPublic) {
              if (!user) {
                return res.status(401).json({ error: "Not authenticated" });
              }
              console.log(`\u2705 Presigned URL request from authenticated user: ${user.id} (${user.role || "no role"})`);
            }
            const presignedUrl = await getPresignedUrl(imageUrl, 3600);
            return res.json({ url: presignedUrl });
          } catch (error) {
            console.error("Error generating presigned URL, falling back to original URL:", {
              error: error instanceof Error ? error.message : "Unknown error",
              imageUrl
            });
            return res.json({ url: imageUrl });
          }
        }
        return res.json({ url: imageUrl });
      } catch (error) {
        console.error("Error in presigned URL endpoint:", error);
        return res.status(500).json({
          error: "Failed to generate presigned URL",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });
    router10.get("/images/r2/:path(*)", async (req, res) => {
      try {
        const pathParam = req.params.path;
        if (!pathParam) {
          return res.status(400).send("Missing path parameter");
        }
        const fullR2Url = `https://files.localcooks.ca/${pathParam}`;
        const presignedUrl = await getPresignedUrl(fullR2Url);
        res.redirect(307, presignedUrl);
      } catch (error) {
        console.error("[R2 Proxy] Error:", error);
        res.status(404).send("File not found or access denied");
      }
    });
    router10.get("/r2-proxy", async (req, res) => {
      try {
        const { url } = req.query;
        if (!url || typeof url !== "string") {
          return res.status(400).send("Missing or invalid url parameter");
        }
        console.log(`[R2 Proxy] Request for: ${url}`);
        const presignedUrl = await getPresignedUrl(url);
        res.redirect(307, presignedUrl);
      } catch (error) {
        console.error("[R2 Proxy] Error:", error);
        const fallbackUrl = req.query.url;
        if (fallbackUrl) {
          console.log(`[R2 Proxy] Falling back to original URL: ${fallbackUrl}`);
          return res.redirect(fallbackUrl);
        }
        res.status(500).send("Failed to proxy image");
      }
    });
    router10.get("/r2-presigned", async (req, res) => {
      try {
        const { url } = req.query;
        if (!url || typeof url !== "string") {
          return res.status(400).json({ error: "Missing or invalid url parameter" });
        }
        console.log(`[R2 Presigned] Request for: ${url}`);
        const presignedUrl = await getPresignedUrl(url);
        return res.json({ url: presignedUrl });
      } catch (error) {
        console.error("[R2 Presigned] Error:", error);
        res.status(500).json({ error: "Failed to generate presigned URL" });
      }
    });
    router10.use("/documents", express.static(path2.join(process.cwd(), "uploads/documents")));
    router10.get("/documents/:filename", optionalFirebaseAuth, async (req, res) => {
      try {
        let userId = null;
        let userRole = null;
        if (req.neonUser) {
          userId = req.neonUser.id;
          userRole = req.neonUser.role || null;
        } else if (req.query.token && typeof req.query.token === "string") {
          try {
            const { verifyFirebaseToken: verifyFirebaseToken2 } = await Promise.resolve().then(() => (init_firebase_setup(), firebase_setup_exports));
            const decodedToken = await verifyFirebaseToken2(req.query.token);
            if (decodedToken) {
              const neonUser = await userService.getUserByFirebaseUid(decodedToken.uid);
              if (neonUser) {
                userId = neonUser.id;
                userRole = neonUser.role || null;
              }
            }
          } catch (error) {
            console.error("Error verifying query token:", error);
          }
        }
        const filename = req.params.filename;
        if (!userId) {
          console.log("[FILE ACCESS] Authentication failed for:", filename);
          return res.status(401).json({
            message: "Not authenticated",
            hint: "Files must be accessed with authentication. Use the presigned URL endpoint or include an auth token."
          });
        }
        console.log("[FILE ACCESS] Authenticated user:", userId, "role:", userRole, "accessing:", filename);
        const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
        if (filename.startsWith("http://") || filename.startsWith("https://")) {
          if (isProduction2) {
            try {
              if (isR2Configured()) {
                const urlParts = filename.split("/");
                const fileUserIdMatch = urlParts.find((part) => /^\d+$/.test(part));
                const fileUserId2 = fileUserIdMatch ? parseInt(fileUserIdMatch) : null;
                if (fileUserId2 && userId !== fileUserId2 && userRole !== "admin" && userRole !== "manager") {
                  return res.status(403).json({ message: "Access denied" });
                }
                const presignedUrl = await getPresignedUrl(filename, 3600);
                return res.redirect(presignedUrl);
              }
            } catch (error) {
              console.error("Error generating presigned URL:", error);
              return res.status(500).json({ message: "Error accessing file" });
            }
          }
        }
        const filePath = path2.join(process.cwd(), "uploads", "documents", filename);
        const filenameParts = filename.split("_");
        let fileUserId = null;
        let isPublicAccess = false;
        if (filenameParts[0] === "unknown") {
          if (userRole === "admin" || userRole === "manager") {
            isPublicAccess = true;
          }
        } else {
          const userIdMatch = filenameParts[0].match(/^\d+$/);
          if (userIdMatch) {
            fileUserId = parseInt(userIdMatch[0]);
          }
        }
        const isOwner = fileUserId !== null && userId === fileUserId;
        const isAdminOrManager = userRole === "admin" || userRole === "manager";
        if (!isOwner && !isAdminOrManager) {
          try {
            const searchPattern = `%${filename}`;
            const { kitchens: kitchens3 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
            const { db: db2 } = await Promise.resolve().then(() => (init_db(), db_exports));
            const { or: or3, like, sql: sql12 } = await import("drizzle-orm");
            const [kitchenMatch] = await db2.select({ id: kitchens3.id }).from(kitchens3).where(
              or3(
                like(kitchens3.imageUrl, searchPattern),
                sql12`${kitchens3.galleryImages} @> ${JSON.stringify([`/api/files/documents/${filename}`])}::jsonb`,
                // also try with just filename if that's how it's stored in array
                sql12`${kitchens3.galleryImages} @> ${JSON.stringify([filename])}::jsonb`
              )
            ).limit(1);
            if (kitchenMatch) {
              console.log(`[FILE ACCESS] Public access granted for kitchen image: ${filename}`);
              isPublicAccess = true;
            }
          } catch (dbError) {
            console.error("Error checking public access:", dbError);
          }
        }
        if (!isOwner && !isAdminOrManager && !isPublicAccess) {
          return res.status(403).json({ message: "Access denied" });
        }
        if (fs4.existsSync(filePath)) {
          const stat = fs4.statSync(filePath);
          const ext = path2.extname(filename).toLowerCase();
          let contentType = "application/octet-stream";
          if (ext === ".pdf") contentType = "application/pdf";
          else if ([".jpg", ".jpeg"].includes(ext)) contentType = "image/jpeg";
          else if (ext === ".png") contentType = "image/png";
          else if (ext === ".webp") contentType = "image/webp";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Length", stat.size);
          res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
          const readStream = fs4.createReadStream(filePath);
          readStream.pipe(res);
        } else {
          const isProduction3 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
          const { getPresignedUrl: getPresignedUrl2, isR2Configured: isR2Configured2 } = await Promise.resolve().then(() => (init_r2_storage(), r2_storage_exports));
          if (isR2Configured2()) {
            try {
              const fakeUrl = `https://r2.localcooks.com/documents/${filename}`;
              const presignedUrl = await getPresignedUrl2(fakeUrl, 3600);
              console.log(`[FILE ACCESS] Redirecting to R2 for: ${filename}`);
              return res.redirect(307, presignedUrl);
            } catch (r2Error) {
              console.error("[FILE ACCESS] R2 fallback failed:", r2Error);
              return res.status(404).json({ message: "File not found" });
            }
          } else {
            return res.status(404).json({ message: "File not found" });
          }
        }
      } catch (error) {
        console.error("Error serving file:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    });
    files_default = router10;
  }
});

// shared/timezone-utils.ts
import { TZDate } from "@date-fns/tz";
import { format, isBefore, isAfter, isWithinInterval } from "date-fns";
var DEFAULT_TIMEZONE;
var init_timezone_utils = __esm({
  "shared/timezone-utils.ts"() {
    "use strict";
    DEFAULT_TIMEZONE = "America/St_Johns";
  }
});

// server/api-response.ts
function errorResponse(res, error, statusCode = 500) {
  const message = process.env.NODE_ENV === "production" ? "An unexpected error occurred" : error?.message || "Unknown error";
  console.error("[API Error]", error);
  return res.status(statusCode).json({ error: message });
}
var init_api_response = __esm({
  "server/api-response.ts"() {
    "use strict";
  }
});

// server/domains/bookings/booking.repository.ts
import { eq as eq13, and as and9, desc as desc7, asc, lt, not, sql as sql3 } from "drizzle-orm";
function getKitchenBookingSelection() {
  return {
    id: kitchenBookings.id,
    chefId: kitchenBookings.chefId,
    kitchenId: kitchenBookings.kitchenId,
    bookingDate: kitchenBookings.bookingDate,
    startTime: kitchenBookings.startTime,
    endTime: kitchenBookings.endTime,
    status: kitchenBookings.status,
    specialNotes: kitchenBookings.specialNotes,
    bookingType: kitchenBookings.bookingType,
    totalPrice: kitchenBookings.totalPrice,
    // string in DB
    hourlyRate: kitchenBookings.hourlyRate,
    durationHours: kitchenBookings.durationHours,
    paymentStatus: kitchenBookings.paymentStatus,
    createdAt: kitchenBookings.createdAt
  };
}
function getStorageBookingSelection() {
  return {
    id: storageBookings.id,
    storageListingId: storageBookings.storageListingId,
    kitchenBookingId: storageBookings.kitchenBookingId,
    chefId: storageBookings.chefId,
    startDate: storageBookings.startDate,
    endDate: storageBookings.endDate,
    status: storageBookings.status,
    totalPrice: storageBookings.totalPrice,
    pricingModel: storageBookings.pricingModel,
    paymentStatus: storageBookings.paymentStatus,
    paymentIntentId: storageBookings.paymentIntentId,
    serviceFee: storageBookings.serviceFee,
    currency: storageBookings.currency,
    createdAt: storageBookings.createdAt,
    updatedAt: storageBookings.updatedAt
  };
}
var BookingRepository;
var init_booking_repository = __esm({
  "server/domains/bookings/booking.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    BookingRepository = class {
      // ===== DTO MAPPING HELPERS =====
      // Postgres numeric columns are returned as strings by node-postgres.
      // These helpers cast them to JavaScript numbers for frontend compatibility.
      mapKitchenBookingToDTO(row) {
        if (!row) return null;
        return {
          ...row,
          totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
          hourlyRate: row.hourlyRate ? parseFloat(row.hourlyRate) : null,
          durationHours: row.durationHours ? parseFloat(row.durationHours) : null,
          serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null,
          damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : null
        };
      }
      mapStorageBookingToDTO(row) {
        if (!row) return null;
        return {
          ...row,
          totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
          serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null,
          basePrice: row.basePrice ? parseFloat(row.basePrice) : null
        };
      }
      mapEquipmentBookingToDTO(row) {
        if (!row) return null;
        return {
          ...row,
          totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
          damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : null,
          serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null
        };
      }
      // ===== KITCHEN BOOKINGS =====
      async createKitchenBooking(data) {
        const [booking] = await db.insert(kitchenBookings).values(data).returning();
        return this.mapKitchenBookingToDTO(booking);
      }
      async getKitchenBookingById(id) {
        const [booking] = await db.select().from(kitchenBookings).where(eq13(kitchenBookings.id, id));
        return this.mapKitchenBookingToDTO(booking);
      }
      async updateKitchenBooking(id, updates) {
        const [updated] = await db.update(kitchenBookings).set({ ...updates, updatedAt: /* @__PURE__ */ new Date() }).where(eq13(kitchenBookings.id, id)).returning();
        return this.mapKitchenBookingToDTO(updated);
      }
      async getKitchenBookingsByKitchenId(kitchenId) {
        const rows = await db.select().from(kitchenBookings).where(eq13(kitchenBookings.kitchenId, kitchenId));
        return rows.map((row) => this.mapKitchenBookingToDTO(row));
      }
      async getKitchenBookingsByChefId(chefId) {
        const results = await db.select({
          booking: kitchenBookings,
          kitchen: kitchens,
          location: locations
        }).from(kitchenBookings).innerJoin(kitchens, eq13(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq13(kitchens.locationId, locations.id)).where(eq13(kitchenBookings.chefId, chefId)).orderBy(desc7(kitchenBookings.bookingDate));
        return results.map((row) => ({
          ...this.mapKitchenBookingToDTO(row.booking),
          kitchen: row.kitchen,
          location: row.location,
          kitchenName: row.kitchen.name,
          locationName: row.location.name
        }));
      }
      async getBookingsByManagerId(managerId) {
        const results = await db.select({
          booking: kitchenBookings,
          kitchen: kitchens,
          location: locations,
          chef: users
        }).from(kitchenBookings).innerJoin(kitchens, eq13(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq13(kitchens.locationId, locations.id)).leftJoin(users, eq13(kitchenBookings.chefId, users.id)).where(eq13(locations.managerId, managerId)).orderBy(desc7(kitchenBookings.bookingDate));
        return results.map((row) => ({
          ...this.mapKitchenBookingToDTO(row.booking),
          kitchen: row.kitchen,
          location: row.location,
          chef: row.chef,
          chefName: row.chef?.username,
          kitchenName: row.kitchen.name,
          locationName: row.location.name
        }));
      }
      async getBookingsByKitchen(kitchenId) {
        return db.select({
          ...getKitchenBookingSelection(),
          chefName: users.username,
          chefEmail: users.username
          // Fallback/Placeholder logic as in original
        }).from(kitchenBookings).leftJoin(users, eq13(kitchenBookings.chefId, users.id)).where(eq13(kitchenBookings.kitchenId, kitchenId)).orderBy(desc7(kitchenBookings.bookingDate));
      }
      async findConflictingBookings(kitchenId, date2, startTime, endTime, excludeBookingId) {
        const dateStr = date2.toISOString().split("T")[0];
        const conditions = [
          eq13(kitchenBookings.kitchenId, kitchenId),
          not(eq13(kitchenBookings.status, "cancelled")),
          sql3`DATE(${kitchenBookings.bookingDate}) = ${dateStr}::date`,
          sql3`${kitchenBookings.startTime} < ${endTime}`,
          sql3`${kitchenBookings.endTime} > ${startTime}`
        ];
        if (excludeBookingId) {
          conditions.push(not(eq13(kitchenBookings.id, excludeBookingId)));
        }
        const conflicts = await db.select().from(kitchenBookings).where(and9(...conditions));
        return conflicts;
      }
      // ===== STORAGE BOOKINGS =====
      async createStorageBooking(data) {
        const [booking] = await db.insert(storageBookings).values(data).returning();
        return this.mapStorageBookingToDTO(booking);
      }
      async getStorageBookingsByChefId(chefId) {
        const result = await db.select({
          ...getStorageBookingSelection(),
          storageName: storageListings.name,
          storageType: storageListings.storageType,
          kitchenId: storageListings.kitchenId,
          kitchenName: kitchens.name
        }).from(storageBookings).innerJoin(storageListings, eq13(storageBookings.storageListingId, storageListings.id)).innerJoin(kitchens, eq13(storageListings.kitchenId, kitchens.id)).where(eq13(storageBookings.chefId, chefId)).orderBy(desc7(storageBookings.startDate));
        return result.map((row) => ({
          ...row,
          totalPrice: row.totalPrice ? parseFloat(row.totalPrice.toString()) / 100 : 0,
          serviceFee: row.serviceFee ? parseFloat(row.serviceFee.toString()) / 100 : 0
        }));
      }
      async getStorageBookingById(id) {
        const [booking] = await db.select({
          ...getStorageBookingSelection(),
          storageName: storageListings.name,
          storageType: storageListings.storageType,
          kitchenId: storageListings.kitchenId,
          kitchenName: kitchens.name,
          basePrice: storageListings.basePrice,
          minimumBookingDuration: storageListings.minimumBookingDuration
        }).from(storageBookings).innerJoin(storageListings, eq13(storageBookings.storageListingId, storageListings.id)).innerJoin(kitchens, eq13(storageListings.kitchenId, kitchens.id)).where(eq13(storageBookings.id, id));
        return this.mapStorageBookingToDTO(booking);
      }
      async updateStorageBooking(id, updates) {
        const [updated] = await db.update(storageBookings).set({ ...updates, updatedAt: /* @__PURE__ */ new Date() }).where(eq13(storageBookings.id, id)).returning();
        return this.mapStorageBookingToDTO(updated);
      }
      async deleteStorageBooking(id) {
        return db.delete(storageBookings).where(eq13(storageBookings.id, id));
      }
      async getStorageBookingsByKitchenBookingId(kitchenBookingId) {
        const rows = await db.select().from(storageBookings).where(eq13(storageBookings.kitchenBookingId, kitchenBookingId));
        return rows.map((row) => this.mapStorageBookingToDTO(row));
      }
      async getExpiredStorageBookings(today) {
        return db.select({
          id: storageBookings.id,
          storageListingId: storageBookings.storageListingId,
          chefId: storageBookings.chefId,
          endDate: storageBookings.endDate,
          totalPrice: storageBookings.totalPrice,
          serviceFee: storageBookings.serviceFee,
          paymentStatus: storageBookings.paymentStatus,
          paymentIntentId: storageBookings.paymentIntentId,
          basePrice: storageListings.basePrice,
          minimumBookingDuration: storageListings.minimumBookingDuration
        }).from(storageBookings).innerJoin(storageListings, eq13(storageBookings.storageListingId, storageListings.id)).where(and9(
          lt(storageBookings.endDate, today),
          not(eq13(storageBookings.status, "cancelled")),
          not(eq13(storageBookings.paymentStatus, "failed"))
        )).orderBy(asc(storageBookings.endDate));
      }
      // ===== EQUIPMENT BOOKINGS =====
      async getEquipmentBookingsByChefId(chefId) {
        const result = await db.select({
          id: equipmentBookings.id,
          equipmentListingId: equipmentBookings.equipmentListingId,
          kitchenBookingId: equipmentBookings.kitchenBookingId,
          chefId: equipmentBookings.chefId,
          startDate: equipmentBookings.startDate,
          endDate: equipmentBookings.endDate,
          status: equipmentBookings.status,
          totalPrice: equipmentBookings.totalPrice,
          pricingModel: equipmentBookings.pricingModel,
          paymentStatus: equipmentBookings.paymentStatus,
          paymentIntentId: equipmentBookings.paymentIntentId,
          damageDeposit: equipmentBookings.damageDeposit,
          serviceFee: equipmentBookings.serviceFee,
          currency: equipmentBookings.currency,
          createdAt: equipmentBookings.createdAt,
          updatedAt: equipmentBookings.updatedAt,
          equipmentType: equipmentListings.equipmentType,
          brand: equipmentListings.brand,
          model: equipmentListings.model,
          availabilityType: equipmentListings.availabilityType,
          kitchenId: equipmentListings.kitchenId,
          kitchenName: kitchens.name
        }).from(equipmentBookings).innerJoin(equipmentListings, eq13(equipmentBookings.equipmentListingId, equipmentListings.id)).innerJoin(kitchens, eq13(equipmentListings.kitchenId, kitchens.id)).where(eq13(equipmentBookings.chefId, chefId)).orderBy(desc7(equipmentBookings.startDate));
        return result.map((row) => ({
          ...row,
          totalPrice: row.totalPrice ? parseFloat(row.totalPrice.toString()) / 100 : 0,
          damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit.toString()) / 100 : 0,
          serviceFee: row.serviceFee ? parseFloat(row.serviceFee.toString()) / 100 : 0
        }));
      }
      async createEquipmentBooking(data) {
        const [booking] = await db.insert(equipmentBookings).values(data).returning();
        return this.mapEquipmentBookingToDTO(booking);
      }
      async updateEquipmentBooking(id, updates) {
        const [updated] = await db.update(equipmentBookings).set({ ...updates, updatedAt: /* @__PURE__ */ new Date() }).where(eq13(equipmentBookings.id, id)).returning();
        return this.mapEquipmentBookingToDTO(updated);
      }
      async getEquipmentBookingsByKitchenBookingId(kitchenBookingId) {
        const rows = await db.select().from(equipmentBookings).where(eq13(equipmentBookings.kitchenBookingId, kitchenBookingId));
        return rows.map((row) => this.mapEquipmentBookingToDTO(row));
      }
      async deleteEquipmentBooking(id) {
        return db.delete(equipmentBookings).where(eq13(equipmentBookings.id, id));
      }
    };
  }
});

// server/services/pricing-service.ts
var pricing_service_exports = {};
__export(pricing_service_exports, {
  calculateDurationHours: () => calculateDurationHours,
  calculateKitchenBookingPrice: () => calculateKitchenBookingPrice,
  calculatePlatformFee: () => calculatePlatformFee,
  calculatePlatformFeeDynamic: () => calculatePlatformFeeDynamic,
  calculateTax: () => calculateTax,
  calculateTotalWithFees: () => calculateTotalWithFees,
  getKitchenPricing: () => getKitchenPricing,
  getServiceFeeRate: () => getServiceFeeRate
});
import { eq as eq14 } from "drizzle-orm";
function calculateDurationHours(startTime, endTime) {
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;
  const durationMinutes = endTotalMinutes - startTotalMinutes;
  const durationHours = durationMinutes / 60;
  return Math.max(0, durationHours);
}
async function getKitchenPricing(kitchenId) {
  try {
    const [kitchen] = await db.select({
      hourlyRate: kitchens.hourlyRate,
      currency: kitchens.currency,
      minimumBookingHours: kitchens.minimumBookingHours,
      taxRatePercent: kitchens.taxRatePercent
    }).from(kitchens).where(eq14(kitchens.id, kitchenId));
    if (!kitchen) {
      return null;
    }
    const hourlyRateCents = kitchen.hourlyRate ? parseFloat(kitchen.hourlyRate) : 0;
    return {
      hourlyRate: hourlyRateCents,
      currency: kitchen.currency || "CAD",
      minimumBookingHours: kitchen.minimumBookingHours || 1,
      taxRatePercent: kitchen.taxRatePercent ? parseFloat(kitchen.taxRatePercent) : null
    };
  } catch (error) {
    console.error("Error getting kitchen pricing:", error);
    throw error;
  }
}
async function calculateKitchenBookingPrice(kitchenId, startTime, endTime) {
  try {
    const pricing = await getKitchenPricing(kitchenId);
    if (!pricing || !pricing.hourlyRate || pricing.hourlyRate <= 0) {
      const durationHours2 = calculateDurationHours(startTime, endTime);
      return {
        totalPriceCents: 0,
        durationHours: durationHours2,
        hourlyRateCents: 0,
        currency: pricing?.currency || "CAD",
        taxRatePercent: pricing?.taxRatePercent ?? null,
        taxAmountCents: 0
      };
    }
    const durationHours = calculateDurationHours(startTime, endTime);
    const effectiveDuration = Math.max(durationHours, pricing.minimumBookingHours);
    const basePriceCents = Math.round(pricing.hourlyRate * effectiveDuration);
    const taxAmountCents = calculateTax(basePriceCents, pricing.taxRatePercent ?? null);
    return {
      totalPriceCents: basePriceCents,
      // This is the subtotal
      durationHours: effectiveDuration,
      hourlyRateCents: pricing.hourlyRate,
      currency: pricing.currency,
      taxRatePercent: pricing.taxRatePercent ?? null,
      taxAmountCents
      // New field
    };
  } catch (error) {
    console.error("Error calculating kitchen booking price:", error);
    throw error;
  }
}
async function getServiceFeeRate() {
  try {
    const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq14(platformSettings.key, "service_fee_rate"));
    if (!setting) {
      return 0.05;
    }
    const rate = parseFloat(setting.value);
    if (isNaN(rate) || rate < 0 || rate > 1) {
      return 0.05;
    }
    return rate;
  } catch (error) {
    console.error("Error getting service fee rate from platform_settings:", error);
    return 0.05;
  }
}
function calculatePlatformFee(basePriceCents, commissionRate = 0.05) {
  return Math.round(basePriceCents * commissionRate);
}
async function calculatePlatformFeeDynamic(basePriceCents) {
  const rate = await getServiceFeeRate();
  return calculatePlatformFee(basePriceCents, rate);
}
function calculateTax(basePriceCents, taxRatePercent) {
  if (!taxRatePercent || taxRatePercent <= 0) {
    return 0;
  }
  return Math.round(basePriceCents * (taxRatePercent / 100));
}
function calculateTotalWithFees(basePriceCents, serviceFeeCents = 0, damageDepositCents = 0, taxAmountCents = 0) {
  return basePriceCents + serviceFeeCents + damageDepositCents + taxAmountCents;
}
var init_pricing_service = __esm({
  "server/services/pricing-service.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/logger.ts
var isProd, logger;
var init_logger = __esm({
  "server/logger.ts"() {
    "use strict";
    isProd = process.env.NODE_ENV === "production";
    logger = {
      info: (msg, data) => {
        if (!isProd) console.log(`[INFO] ${msg}`, data || "");
      },
      warn: (msg, data) => {
        console.warn(`[WARN] ${msg}`, data || "");
      },
      error: (msg, error) => {
        console.error(`[ERROR] ${msg}`, error);
      },
      debug: (msg, data) => {
        if (!isProd) console.log(`[DEBUG] ${msg}`, data || "");
      }
    };
  }
});

// server/domains/bookings/booking.service.ts
import { eq as eq15, and as and10 } from "drizzle-orm";
var BookingService, bookingService;
var init_booking_service = __esm({
  "server/domains/bookings/booking.service.ts"() {
    "use strict";
    init_booking_repository();
    init_pricing_service();
    init_schema();
    init_logger();
    init_db();
    init_kitchen_service();
    BookingService = class {
      repo;
      constructor(repo) {
        this.repo = repo || new BookingRepository();
      }
      /**
       * Create a new kitchen booking
       */
      async createKitchenBooking(data) {
        const pricing = await calculateKitchenBookingPrice(
          data.kitchenId,
          data.startTime,
          data.endTime
        );
        const kitchen = await kitchenService.getKitchenById(data.kitchenId);
        if (!kitchen) throw new Error("Kitchen not found");
        if (!data.chefId) {
          throw new Error("Chef ID is required for booking");
        }
        const hasAccess = await db.query.chefLocationAccess.findFirst({
          where: and10(
            eq15(chefLocationAccess.chefId, data.chefId),
            eq15(chefLocationAccess.locationId, kitchen.locationId)
          )
        });
        if (!hasAccess) {
          throw new Error("You do not have approved access to this kitchen location. Please complete all required application steps (Tier 2) to book.");
        }
        const serviceFeeCents = await calculatePlatformFeeDynamic(pricing.totalPriceCents);
        const totalWithFeesCents = calculateTotalWithFees(
          pricing.totalPriceCents,
          serviceFeeCents,
          0
          // No damage deposit for kitchen only logic here, handling addons via separate logic if needed or bundled.
        );
        const booking = await this.repo.createKitchenBooking({
          ...data,
          totalPrice: totalWithFeesCents.toString(),
          hourlyRate: pricing.hourlyRateCents.toString(),
          durationHours: pricing.durationHours.toString(),
          serviceFee: serviceFeeCents.toString(),
          currency: pricing.currency,
          storageItems: [],
          // To be populated if needed
          equipmentItems: [],
          // To be populated if needed
          paymentStatus: data.paymentStatus || "pending"
        });
        if (data.selectedStorageIds && data.selectedStorageIds.length > 0) {
        }
        if (data.selectedEquipmentIds && data.selectedEquipmentIds.length > 0) {
        }
        return booking;
      }
      async getBookingById(id) {
        return this.repo.getKitchenBookingById(id);
      }
      async updateBookingStatus(id, status) {
        return this.repo.updateKitchenBooking(id, { status });
      }
      async cancelBooking(bookingId, cancelledByUserId, isChef) {
        const booking = await this.repo.getKitchenBookingById(bookingId);
        if (!booking) throw new Error("Booking not found");
        await this.repo.updateKitchenBooking(bookingId, { status: "cancelled" });
      }
      async getBookingsByKitchenId(kitchenId) {
        return this.repo.getKitchenBookingsByKitchenId(kitchenId);
      }
      // For the MVP of this refactor, I will focus on the DB Operation.
      // Notification logic is typically in the ROUTE in the current codebase (bookings.ts lines 426+)
      // We should eventually move that here.
      // We should eventually move that here.
      async createPortalBooking(data) {
        const dbData = {
          ...data,
          // If externalContact object is passed, flatten it
          externalContactName: data.externalContact?.name,
          externalContactEmail: data.externalContact?.email,
          externalContactPhone: data.externalContact?.phone,
          externalContactCompany: data.externalContact?.company,
          // Ensure bookingType is set
          bookingType: data.bookingType || "portal"
        };
        return this.repo.createKitchenBooking(dbData);
      }
      // Proxy methods for repository
      async getBookingsByKitchen(kitchenId) {
        return this.repo.getBookingsByKitchen(kitchenId);
      }
      async getKitchenBookingsByChef(chefId) {
        return this.repo.getKitchenBookingsByChefId(chefId);
      }
      async getBookingsByManager(managerId) {
        return this.repo.getBookingsByManagerId(managerId);
      }
      // ===== STORAGE BOOKINGS =====
      async getStorageBookingsByChef(chefId) {
        return this.repo.getStorageBookingsByChefId(chefId);
      }
      async getEquipmentBookingsByChef(chefId) {
        return this.repo.getEquipmentBookingsByChefId(chefId);
      }
      async getStorageBookingsByKitchenBooking(kitchenBookingId) {
        return this.repo.getStorageBookingsByKitchenBookingId(kitchenBookingId);
      }
      async getEquipmentBookingsByKitchenBooking(kitchenBookingId) {
        return this.repo.getEquipmentBookingsByKitchenBookingId(kitchenBookingId);
      }
      // ===== AVAILABILITY LOGIC =====
      async validateBookingAvailability(kitchenId, bookingDate, startTime, endTime) {
        try {
          if (startTime >= endTime) {
            return { valid: false, error: "End time must be after start time" };
          }
          const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, bookingDate);
          let availabilityStartTime;
          let availabilityEndTime;
          if (dateOverride) {
            if (!dateOverride.isAvailable) {
              return { valid: false, error: "Kitchen is closed on this date" };
            }
            if (dateOverride.startTime && dateOverride.endTime) {
              availabilityStartTime = dateOverride.startTime;
              availabilityEndTime = dateOverride.endTime;
            } else {
              return { valid: false, error: "Kitchen availability not properly configured for this date" };
            }
          } else {
            const dayOfWeek = bookingDate.getUTCDay();
            const availability = await kitchenService.getKitchenAvailability(kitchenId);
            const dayAvailability = availability.find((a) => a.dayOfWeek === dayOfWeek);
            if (!dayAvailability || !dayAvailability.isAvailable) {
              return { valid: false, error: "Kitchen is not available on this day" };
            }
            availabilityStartTime = dayAvailability.startTime;
            availabilityEndTime = dayAvailability.endTime;
          }
          if (startTime < availabilityStartTime || endTime > availabilityEndTime) {
            return { valid: false, error: "Booking time must be within manager-set available hours" };
          }
          const startHour = parseInt(startTime.split(":")[0]);
          const availabilityStartHour = parseInt(availabilityStartTime.split(":")[0]);
          const availabilityEndHour = parseInt(availabilityEndTime.split(":")[0]);
          if (startHour < availabilityStartHour || startHour >= availabilityEndHour) {
            return { valid: false, error: "Start time must be within manager-set available slot times" };
          }
          return { valid: true };
        } catch (error) {
          logger.error("Error validating booking availability:", error);
          return { valid: false, error: "Error validating booking availability" };
        }
      }
      async getAvailableTimeSlots(kitchenId, date2) {
        try {
          const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date2);
          let startHour;
          let endHour;
          if (dateOverride) {
            if (!dateOverride.isAvailable) {
              return [];
            }
            if (dateOverride.startTime && dateOverride.endTime) {
              startHour = parseInt(dateOverride.startTime.split(":")[0]);
              endHour = parseInt(dateOverride.endTime.split(":")[0]);
            } else {
              return [];
            }
          } else {
            const dayOfWeek = date2.getUTCDay();
            const availability = await kitchenService.getKitchenAvailability(kitchenId);
            const dayAvailability = availability.find((a) => a.dayOfWeek === dayOfWeek);
            if (!dayAvailability || !dayAvailability.isAvailable) {
              return [];
            }
            startHour = parseInt(dayAvailability.startTime.split(":")[0]);
            endHour = parseInt(dayAvailability.endTime.split(":")[0]);
          }
          const slots = [];
          for (let hour = startHour; hour < endHour; hour++) {
            slots.push(`${hour.toString().padStart(2, "0")}:00`);
          }
          const bookings = await this.getBookingsByKitchen(kitchenId);
          const dateStr = date2.toISOString().split("T")[0];
          const dayBookings = bookings.filter((b) => {
            const bookingDateStr = new Date(b.bookingDate).toISOString().split("T")[0];
            return bookingDateStr === dateStr && b.status !== "cancelled";
          });
          const bookedSlots = /* @__PURE__ */ new Set();
          dayBookings.forEach((booking) => {
            const [startHours, startMins] = booking.startTime.split(":").map(Number);
            const [endHours, endMins] = booking.endTime.split(":").map(Number);
            const startTotalMins = startHours * 60 + startMins;
            const endTotalMins = endHours * 60 + endMins;
            for (const slot of slots) {
              const [slotHours, slotMins] = slot.split(":").map(Number);
              const slotTotalMins = slotHours * 60 + slotMins;
              if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
                bookedSlots.add(slot);
              }
            }
          });
          return slots.filter((slot) => !bookedSlots.has(slot));
        } catch (error) {
          logger.error("Error getting available time slots:", error);
          throw error;
        }
      }
      async getAvailableSlots(kitchenId, dateStr) {
        try {
          const date2 = new Date(dateStr);
          const slots = await this.getAvailableTimeSlots(kitchenId, date2);
          return slots.map((time) => ({ time, available: true }));
        } catch (error) {
          logger.error("Error getting available slots:", error);
          return [];
        }
      }
      async getAllTimeSlotsWithBookingInfo(kitchenId, date2) {
        try {
          const dateOverride = await kitchenService.getKitchenDateOverrideForDate(kitchenId, date2);
          let startHour;
          let endHour;
          let capacity;
          if (dateOverride) {
            if (!dateOverride.isAvailable) {
              return [];
            }
            if (dateOverride.startTime && dateOverride.endTime) {
              startHour = parseInt(dateOverride.startTime.split(":")[0]);
              endHour = parseInt(dateOverride.endTime.split(":")[0]);
              capacity = dateOverride.maxConcurrentBookings ?? 1;
            } else {
              return [];
            }
          } else {
            const dayOfWeek = date2.getUTCDay();
            const availability = await kitchenService.getKitchenAvailability(kitchenId);
            const dayAvailability = availability.find((a) => a.dayOfWeek === dayOfWeek);
            if (!dayAvailability || !dayAvailability.isAvailable) {
              return [];
            }
            startHour = parseInt(dayAvailability.startTime.split(":")[0]);
            endHour = parseInt(dayAvailability.endTime.split(":")[0]);
            capacity = dayAvailability.maxConcurrentBookings ?? 1;
          }
          const allSlots = [];
          for (let hour = startHour; hour < endHour; hour++) {
            allSlots.push(`${hour.toString().padStart(2, "0")}:00`);
          }
          const bookings = await this.getBookingsByKitchen(kitchenId);
          const dateStr = date2.toISOString().split("T")[0];
          const dayBookings = bookings.filter((b) => {
            const bookingDateStr = new Date(b.bookingDate).toISOString().split("T")[0];
            return bookingDateStr === dateStr && b.status !== "cancelled";
          });
          const slotBookingCounts = /* @__PURE__ */ new Map();
          allSlots.forEach((slot) => slotBookingCounts.set(slot, 0));
          dayBookings.forEach((booking) => {
            const [startHours, startMins] = booking.startTime.split(":").map(Number);
            const [endHours, endMins] = booking.endTime.split(":").map(Number);
            const startTotalMins = startHours * 60 + startMins;
            const endTotalMins = endHours * 60 + endMins;
            allSlots.forEach((slot) => {
              const [slotHours, slotMins] = slot.split(":").map(Number);
              const slotTotalMins = slotHours * 60 + slotMins;
              if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
                slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
              }
            });
          });
          return allSlots.map((slot) => {
            const bookedCount = slotBookingCounts.get(slot) || 0;
            return {
              time: slot,
              available: Math.max(0, capacity - bookedCount),
              capacity,
              isFullyBooked: bookedCount >= capacity
            };
          });
        } catch (error) {
          logger.error("Error getting all time slots with booking info:", error);
          throw error;
        }
      }
      async getStorageBookingById(id) {
        return this.repo.getStorageBookingById(id);
      }
      async extendStorageBooking(id, newEndDate) {
        const booking = await this.repo.getStorageBookingById(id);
        if (!booking) throw new Error(`Storage booking with id ${id} not found`);
        const currentEndDate = new Date(booking.endDate);
        if (newEndDate <= currentEndDate) throw new Error("New end date must be after the current end date");
        const extensionDays = Math.ceil((newEndDate.getTime() - currentEndDate.getTime()) / (1e3 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;
        if (extensionDays < minDays) throw new Error(`Extension must be at least ${minDays} day${minDays > 1 ? "s" : ""}`);
        const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
        const serviceFeeRate = await getServiceFeeRate2();
        const basePricePerDayDollars = booking.basePrice ? parseFloat(booking.basePrice.toString()) / 100 : 0;
        const extensionBasePrice = basePricePerDayDollars * extensionDays;
        const extensionServiceFee = extensionBasePrice * serviceFeeRate;
        const extensionTotalPrice = extensionBasePrice + extensionServiceFee;
        const extensionTotalPriceCents = Math.round(extensionTotalPrice * 100);
        const extensionServiceFeeCents = Math.round(extensionServiceFee * 100);
        const existingTotalPriceCents = Math.round(parseFloat((booking.totalPrice || "0").toString()));
        const existingServiceFeeCents = Math.round(parseFloat((booking.serviceFee || "0").toString()));
        const newTotalPriceCents = existingTotalPriceCents + extensionTotalPriceCents;
        const newServiceFeeCents = existingServiceFeeCents + extensionServiceFeeCents;
        await this.repo.updateStorageBooking(id, {
          endDate: newEndDate,
          totalPrice: newTotalPriceCents.toString(),
          serviceFee: newServiceFeeCents.toString()
        });
        const updatedBooking = await this.repo.getStorageBookingById(id);
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
      async processOverstayerPenalties(maxDaysToCharge = 7) {
        const today = /* @__PURE__ */ new Date();
        today.setHours(0, 0, 0, 0);
        const expiredBookings = await this.repo.getExpiredStorageBookings(today);
        const processedBookings = [];
        const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
        const serviceFeeRate = await getServiceFeeRate2();
        for (const row of expiredBookings) {
          try {
            const bookingId = row.id;
            const endDate = new Date(row.endDate);
            const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1e3 * 60 * 60 * 24));
            const daysToCharge = Math.min(daysOverdue, maxDaysToCharge);
            if (daysToCharge <= 0) continue;
            const basePriceDollars = row.basePrice ? parseFloat(row.basePrice.toString()) / 100 : 0;
            const penaltyRatePerDay = basePriceDollars * 2;
            const penaltyBasePrice = penaltyRatePerDay * daysToCharge;
            const penaltyServiceFee = penaltyBasePrice * serviceFeeRate;
            const penaltyTotalPrice = penaltyBasePrice + penaltyServiceFee;
            const penaltyTotalPriceCents = Math.round(penaltyTotalPrice * 100);
            const penaltyServiceFeeCents = Math.round(penaltyServiceFee * 100);
            const currentTotalPriceCents = row.totalPrice ? Math.round(parseFloat(row.totalPrice.toString())) : 0;
            const currentServiceFeeCents = row.serviceFee ? Math.round(parseFloat(row.serviceFee.toString())) : 0;
            const newTotalPriceCents = currentTotalPriceCents + penaltyTotalPriceCents;
            const newServiceFeeCents = currentServiceFeeCents + penaltyServiceFeeCents;
            const newEndDate = new Date(endDate);
            newEndDate.setDate(newEndDate.getDate() + daysToCharge);
            await this.repo.updateStorageBooking(bookingId, {
              endDate: newEndDate,
              totalPrice: newTotalPriceCents.toString(),
              serviceFee: newServiceFeeCents.toString()
            });
            processedBookings.push({
              bookingId,
              chefId: row.chefId,
              daysOverdue,
              daysCharged: daysToCharge,
              penaltyAmount: penaltyTotalPrice,
              newEndDate: newEndDate.toISOString()
            });
          } catch (error) {
            logger.error(`Error processing penalty for booking ${row.id}`, error);
          }
        }
        return processedBookings;
      }
    };
    bookingService = new BookingService();
  }
});

// server/domains/users/chef.repository.ts
import { eq as eq16, and as and11, inArray as inArray3 } from "drizzle-orm";
var ChefRepository;
var init_chef_repository = __esm({
  "server/domains/users/chef.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    ChefRepository = class {
      // ===== Access Management =====
      async grantLocationAccess(chefId, locationId, grantedBy) {
        const [access] = await db.insert(chefLocationAccess).values({
          chefId,
          locationId,
          grantedBy
        }).onConflictDoNothing().returning();
        return access;
      }
      async revokeLocationAccess(chefId, locationId) {
        await db.delete(chefLocationAccess).where(
          and11(
            eq16(chefLocationAccess.chefId, chefId),
            eq16(chefLocationAccess.locationId, locationId)
          )
        );
      }
      async getLocationAccess(chefId) {
        return db.select().from(chefLocationAccess).where(eq16(chefLocationAccess.chefId, chefId));
      }
      async hasLocationAccess(chefId, locationId) {
        const access = await db.select().from(chefLocationAccess).where(
          and11(
            eq16(chefLocationAccess.chefId, chefId),
            eq16(chefLocationAccess.locationId, locationId)
          )
        ).limit(1);
        return access.length > 0;
      }
      // ===== Profile Management =====
      async findProfile(chefId, locationId) {
        const [profile] = await db.select().from(chefLocationProfiles).where(
          and11(
            eq16(chefLocationProfiles.chefId, chefId),
            eq16(chefLocationProfiles.locationId, locationId)
          )
        );
        return profile || null;
      }
      async getProfilesByChefId(chefId) {
        return db.select().from(chefLocationProfiles).where(eq16(chefLocationProfiles.chefId, chefId));
      }
      async createProfile(chefId, locationId) {
        const [profile] = await db.insert(chefLocationProfiles).values({
          chefId,
          locationId,
          status: "pending"
        }).returning();
        return profile;
      }
      async updateProfile(id, updates) {
        const [updated] = await db.update(chefLocationProfiles).set(updates).where(eq16(chefLocationProfiles.id, id)).returning();
        return updated || null;
      }
      // Complex query for Manager Dashboard
      async getProfilesForManager(locationIds) {
        if (locationIds.length === 0) return [];
        const profiles = await db.select().from(chefLocationProfiles).where(inArray3(chefLocationProfiles.locationId, locationIds));
        return profiles;
      }
    };
  }
});

// server/domains/users/chef.service.ts
var ChefService, chefService;
var init_chef_service = __esm({
  "server/domains/users/chef.service.ts"() {
    "use strict";
    init_chef_repository();
    init_user_service();
    init_location_service();
    init_application_service();
    ChefService = class {
      constructor(repo) {
        this.repo = repo;
      }
      // ===== Access Management =====
      async grantLocationAccess(chefId, locationId, grantedBy) {
        return this.repo.grantLocationAccess(chefId, locationId, grantedBy);
      }
      async revokeLocationAccess(chefId, locationId) {
        return this.repo.revokeLocationAccess(chefId, locationId);
      }
      async getLocationAccess(chefId) {
        return this.repo.getLocationAccess(chefId);
      }
      async hasLocationAccess(chefId, locationId) {
        return this.repo.hasLocationAccess(chefId, locationId);
      }
      // ===== Profile Management =====
      async shareProfileWithLocation(chefId, locationId) {
        const existing = await this.repo.findProfile(chefId, locationId);
        if (existing) {
          if (existing.status === "rejected") {
            return this.repo.updateProfile(existing.id, {
              status: "pending",
              sharedAt: /* @__PURE__ */ new Date(),
              reviewedBy: null,
              reviewedAt: null,
              reviewFeedback: null
            });
          }
          return existing;
        }
        return this.repo.createProfile(chefId, locationId);
      }
      async getProfile(chefId, locationId) {
        return this.repo.findProfile(chefId, locationId);
      }
      async getChefProfiles(chefId) {
        return this.repo.getProfilesByChefId(chefId);
      }
      async updateProfileStatus(profileId, status, reviewedBy, feedback) {
        return this.repo.updateProfile(profileId, {
          status,
          reviewedBy,
          reviewedAt: /* @__PURE__ */ new Date(),
          reviewFeedback: feedback || null
        });
      }
      async getApplicationStatusForBooking(chefId, locationId) {
        const profile = await this.getProfile(chefId, locationId);
        if (!profile) {
          return {
            hasApplication: false,
            status: null,
            canBook: false,
            message: "You must share your profile with this location before booking."
          };
        }
        if (profile.status === "approved") {
          return {
            hasApplication: true,
            status: "approved",
            canBook: true,
            message: "Application approved. You can book kitchens at this location."
          };
        } else if (profile.status === "rejected") {
          return {
            hasApplication: true,
            status: "rejected",
            canBook: false,
            message: "Your profile was rejected by the manager."
          };
        } else {
          return {
            hasApplication: true,
            status: "pending",
            // or inReview
            canBook: false,
            message: "Your profile is pending manager review."
          };
        }
      }
      async getChefProfilesForManager(managerId) {
        const managerLocations = await locationService.getLocationsByManagerId(managerId);
        if (managerLocations.length === 0) {
          return [];
        }
        const locationIds = managerLocations.map((l) => l.id);
        const profiles = await this.repo.getProfilesForManager(locationIds);
        const enrichedProfiles = await Promise.all(
          profiles.map(async (profile) => {
            const chef = await userService.getUser(profile.chefId);
            const location = managerLocations.find((l) => l.id === profile.locationId);
            const apps = await applicationService.getApplicationsByUserId(profile.chefId);
            const approvedApps = apps.filter((a) => a.status === "approved").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            const latestApp = approvedApps.length > 0 ? approvedApps[approvedApps.length - 1] : null;
            return {
              ...profile,
              chef: chef ? {
                id: chef.id,
                username: chef.username
              } : null,
              location: location ? {
                id: location.id,
                name: location.name,
                address: location.address
              } : null,
              application: latestApp ? {
                id: latestApp.id,
                fullName: latestApp.fullName,
                email: latestApp.email,
                phone: latestApp.phone,
                foodSafetyLicenseUrl: latestApp.foodSafetyLicenseUrl,
                foodEstablishmentCertUrl: latestApp.foodEstablishmentCertUrl
              } : null
            };
          })
        );
        return enrichedProfiles;
      }
    };
    chefService = new ChefService(new ChefRepository());
  }
});

// server/domains/managers/manager.repository.ts
import { eq as eq17, and as and12, desc as desc9, sql as sql4, ne as ne3 } from "drizzle-orm";
var ManagerRepository, managerRepository;
var init_manager_repository = __esm({
  "server/domains/managers/manager.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_logger();
    ManagerRepository = class {
      async findAllManagers() {
        return await db.select().from(users).where(eq17(users.role, "manager"));
      }
      async findManagerByUserId(userId) {
        const [user] = await db.select().from(users).where(eq17(users.id, userId));
        return user;
      }
      async updateOnboardingStatus(userId, updates) {
        const dbUpdates = {};
        if (updates.completed !== void 0) dbUpdates.managerOnboardingCompleted = updates.completed;
        if (updates.skipped !== void 0) dbUpdates.managerOnboardingSkipped = updates.skipped;
        if (updates.steps !== void 0) dbUpdates.managerOnboardingStepsCompleted = updates.steps;
        const [updated] = await db.update(users).set(dbUpdates).where(eq17(users.id, userId)).returning();
        return updated;
      }
      // Moved from server/routes/manager.ts
      async findInvoices(managerId, filters) {
        const { startDate, endDate, locationId, limit = 50, offset = 0 } = filters;
        const conditions = [
          eq17(locations.managerId, managerId),
          ne3(kitchenBookings.status, "cancelled"),
          eq17(kitchenBookings.paymentStatus, "paid")
        ];
        if (startDate) {
          const startStr = Array.isArray(startDate) ? startDate[0] : String(startDate);
          conditions.push(sql4`(DATE(${kitchenBookings.bookingDate}) >= ${startStr}::date OR DATE(${kitchenBookings.createdAt}) >= ${startStr}::date)`);
        }
        if (endDate) {
          const endStr = Array.isArray(endDate) ? endDate[0] : String(endDate);
          conditions.push(sql4`(DATE(${kitchenBookings.bookingDate}) <= ${endStr}::date OR DATE(${kitchenBookings.createdAt}) <= ${endStr}::date)`);
        }
        if (locationId) {
          conditions.push(eq17(locations.id, locationId));
        }
        const rows = await db.select({
          id: kitchenBookings.id,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
          totalPrice: kitchenBookings.totalPrice,
          hourlyRate: kitchenBookings.hourlyRate,
          durationHours: kitchenBookings.durationHours,
          serviceFee: kitchenBookings.serviceFee,
          paymentStatus: kitchenBookings.paymentStatus,
          paymentIntentId: kitchenBookings.paymentIntentId,
          currency: kitchenBookings.currency,
          kitchenName: kitchens.name,
          locationName: locations.name,
          chefName: users.username,
          chefEmail: users.username,
          // Using username as email fallback if needed, or users.email is ideal but schema uses username often
          createdAt: kitchenBookings.createdAt
        }).from(kitchenBookings).innerJoin(kitchens, eq17(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq17(kitchens.locationId, locations.id)).leftJoin(users, eq17(kitchenBookings.chefId, users.id)).where(and12(...conditions)).orderBy(desc9(kitchenBookings.createdAt), desc9(kitchenBookings.bookingDate)).limit(limit).offset(offset);
        logger.info(`[ManagerRepository] Invoices query for manager ${managerId}: Found ${rows.length} invoices`);
        return {
          invoices: rows,
          total: rows.length
        };
      }
      async getRevenueMetrics(managerId, startDate, endDate, locationId) {
        throw new Error("Method not implemented in Repository. Use RevenueService.");
      }
    };
    managerRepository = new ManagerRepository();
  }
});

// server/services/revenue-service-v2.ts
var revenue_service_v2_exports = {};
__export(revenue_service_v2_exports, {
  getRevenueByDateFromTransactions: () => getRevenueByDateFromTransactions,
  getRevenueByLocationFromTransactions: () => getRevenueByLocationFromTransactions,
  getRevenueMetricsFromTransactions: () => getRevenueMetricsFromTransactions
});
import { sql as sql5 } from "drizzle-orm";
async function getRevenueMetricsFromTransactions(managerId, db2, startDate, endDate, locationId) {
  try {
    if (managerId === void 0 || managerId === null || isNaN(managerId)) {
      console.error("[Revenue Service V2] Invalid managerId:", managerId);
      throw new Error("Invalid manager ID");
    }
    const params = [managerId];
    if (locationId) {
      params.push(locationId);
    }
    console.log("[Revenue Service V2] getRevenueMetricsFromTransactions params:", { managerId, locationId, startDate, endDate });
    const tableCheck = await db2.execute(sql5`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    const tableExists = tableCheck.rows[0]?.table_exists;
    if (!tableExists) {
      console.log("[Revenue Service V2] payment_transactions table does not exist, will fallback to legacy method");
      throw new Error("payment_transactions table does not exist");
    }
    const managerIdParam = sql5`${managerId}`;
    const countCheck = await db2.execute(sql5`
      SELECT COUNT(*) as count
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE (
        pt.manager_id = ${managerIdParam} 
        OR (pt.manager_id IS NULL AND l.manager_id = ${managerIdParam})
      )
        AND pt.booking_type IN ('kitchen', 'bundle')
    `);
    const transactionCount = parseInt(countCheck.rows[0]?.count || "0");
    console.log(`[Revenue Service V2] Found ${transactionCount} payment_transactions for manager ${managerId}`);
    const bookingCountCheck = await db2.execute(sql5`
      SELECT 
        COUNT(DISTINCT kb.id) as total_bookings,
        COUNT(DISTINCT CASE WHEN pt_kitchen.id IS NOT NULL OR pt_bundle.id IS NOT NULL THEN kb.id END) as bookings_with_transactions
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt_kitchen ON pt_kitchen.booking_id = kb.id 
        AND pt_kitchen.booking_type = 'kitchen'
        AND (pt_kitchen.manager_id = ${managerIdParam} OR (pt_kitchen.manager_id IS NULL AND l.manager_id = ${managerIdParam}))
      LEFT JOIN payment_transactions pt_bundle ON pt_bundle.booking_id = kb.id 
        AND pt_bundle.booking_type = 'bundle'
        AND (pt_bundle.manager_id = ${managerIdParam} OR (pt_bundle.manager_id IS NULL AND l.manager_id = ${managerIdParam}))
      WHERE l.manager_id = ${managerIdParam}
        AND kb.status != 'cancelled'
        AND (kb.payment_intent_id IS NOT NULL OR kb.total_price IS NOT NULL)
    `);
    const totalBookings = parseInt(bookingCountCheck.rows[0]?.total_bookings || "0");
    const bookingsWithTransactions = parseInt(bookingCountCheck.rows[0]?.bookings_with_transactions || "0");
    console.log(`[Revenue Service V2] Booking coverage: ${bookingsWithTransactions}/${totalBookings} bookings have payment_transactions`);
    if (transactionCount === 0) {
      console.log("[Revenue Service V2] No payment_transactions found, falling back to legacy method");
      throw new Error("No payment_transactions found for manager");
    }
    if (totalBookings > 0 && bookingsWithTransactions < totalBookings) {
      console.log(`[Revenue Service V2] Incomplete payment_transactions coverage (${bookingsWithTransactions}/${totalBookings}), falling back to legacy method`);
      throw new Error("Incomplete payment_transactions coverage");
    }
    const whereConditions = [sql5`
      (
        pt.manager_id = ${managerIdParam} 
        OR (pt.manager_id IS NULL AND l.manager_id = ${managerIdParam})
      )
    `];
    whereConditions.push(sql5`(pt.status = 'succeeded' OR pt.status = 'processing')`);
    whereConditions.push(sql5`pt.booking_type IN ('kitchen', 'bundle')`);
    if (locationId) {
      whereConditions.push(sql5`l.id = ${locationId}`);
    }
    if (startDate || endDate) {
      const start = startDate ? typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0] : null;
      const end = endDate ? typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0] : null;
      console.log("[Revenue Service V2] Applying date filter:", { startDate: start, endDate: end, managerId });
      if (start && end) {
        whereConditions.push(sql5`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= ${start}::date AND DATE(pt.paid_at) <= ${end}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at) >= ${start}::date AND DATE(pt.created_at) <= ${end}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= ${start}::date AND DATE(pt.created_at) <= ${end}::date)
          )
        `);
      } else if (start) {
        whereConditions.push(sql5`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= ${start}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at) >= ${start}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= ${start}::date)
          )
        `);
      } else if (end) {
        whereConditions.push(sql5`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) <= ${end}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at) <= ${end}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at) <= ${end}::date)
          )
        `);
      }
    }
    whereConditions.push(sql5`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          LEFT JOIN kitchen_bookings kb2 ON pt2.booking_id = kb2.id AND pt2.booking_type IN ('kitchen', 'bundle')
          LEFT JOIN kitchens k2 ON kb2.kitchen_id = k2.id
          LEFT JOIN locations l2 ON k2.location_id = l2.id
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND (pt2.manager_id = ${managerId} OR (pt2.manager_id IS NULL AND l2.manager_id = ${managerId}))
        )
      )
    `);
    const whereClause = sql5`WHERE ${sql5.join(whereConditions, sql5` AND `)}`;
    const result = await db2.execute(sql5`
      SELECT 
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        -- This ensures we use Stripe-synced amounts when available
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.manager_revenue::numeric ELSE 0 END), 0)::bigint as deposited_manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN pt.booking_id END) as paid_booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'processing' THEN pt.booking_id END) as processing_booking_count,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN pt.status = 'processing' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as processing_payments,
        COALESCE(SUM(CASE WHEN pt.status IN ('refunded', 'partially_refunded') THEN pt.refund_amount::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(pt.amount::numeric), 0)::numeric as avg_booking_value
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      LEFT JOIN locations l ON k.location_id = l.id
      ${whereClause}
    `);
    const row = result.rows[0] || {};
    console.log("[Revenue Service V2] Query result:", {
      managerId,
      startDate: startDate ? typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0] : "none",
      endDate: endDate ? typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0] : "none",
      locationId: locationId || "none",
      total_revenue: row.total_revenue,
      platform_fee: row.platform_fee,
      manager_revenue: row.manager_revenue,
      deposited_manager_revenue: row.deposited_manager_revenue,
      booking_count: row.booking_count,
      completed_payments: row.completed_payments,
      processing_payments: row.processing_payments
    });
    const parseNumeric = (value) => {
      if (!value) return 0;
      if (typeof value === "string") return parseInt(value) || 0;
      return parseInt(String(value)) || 0;
    };
    const completedPayments = parseNumeric(row.completed_payments);
    const pendingPayments = parseNumeric(row.pending_payments);
    const platformFee = parseNumeric(row.platform_fee);
    const managerRevenue = parseNumeric(row.manager_revenue);
    const depositedManagerRevenue = parseNumeric(row.deposited_manager_revenue);
    const refundedAmount = parseNumeric(row.refunded_amount);
    const bookingCount = parseInt(row.booking_count) || 0;
    const paidBookingCount = parseInt(row.paid_booking_count) || 0;
    const cancelledBookingCount = 0;
    const averageBookingValue = row.avg_booking_value ? Math.round(parseFloat(String(row.avg_booking_value))) : 0;
    const totalRevenue = parseNumeric(row.total_revenue);
    const finalManagerRevenue = managerRevenue;
    const metrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      managerRevenue: isNaN(finalManagerRevenue) ? 0 : finalManagerRevenue,
      // Use database value from Stripe (includes processing)
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue,
      // Only succeeded transactions (what's in bank)
      pendingPayments: isNaN(pendingPayments) ? 0 : pendingPayments,
      completedPayments: isNaN(completedPayments) ? 0 : completedPayments,
      averageBookingValue: isNaN(averageBookingValue) ? 0 : averageBookingValue,
      bookingCount: isNaN(bookingCount) ? 0 : bookingCount,
      paidBookingCount: isNaN(paidBookingCount) ? 0 : paidBookingCount,
      cancelledBookingCount: isNaN(cancelledBookingCount) ? 0 : cancelledBookingCount,
      refundedAmount: isNaN(refundedAmount) ? 0 : refundedAmount
    };
    console.log("[Revenue Service V2] Final metrics:", metrics);
    return metrics;
  } catch (error) {
    console.error("Error getting revenue metrics from transactions:", error);
    throw error;
  }
}
async function getRevenueByLocationFromTransactions(managerId, db2, startDate, endDate) {
  try {
    const tableCheck = await db2.execute(sql5`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error("payment_transactions table does not exist");
    }
    const whereConditions = [sql5`pt.manager_id = ${managerId}`];
    whereConditions.push(sql5`pt.booking_type IN ('kitchen', 'bundle')`);
    whereConditions.push(sql5`(pt.status = 'succeeded' OR pt.status = 'processing')`);
    whereConditions.push(sql5`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND pt2.manager_id = pt.manager_id
        )
      )
    `);
    const whereClause = sql5`WHERE ${sql5.join(whereConditions, sql5` AND `)}`;
    const result = await db2.execute(sql5`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN pt.booking_id END) as paid_count
      FROM payment_transactions pt
      JOIN kitchens k ON (
        (pt.booking_type = 'kitchen' AND pt.booking_id IN (SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id))
        OR (pt.booking_type = 'bundle' AND pt.booking_id IN (SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id))
        OR (pt.booking_type = 'storage' AND pt.booking_id IN (
          SELECT sb.id FROM storage_bookings sb
          JOIN storage_listings sl ON sb.storage_listing_id = sl.id
          WHERE sl.kitchen_id = k.id
        ))
        OR (pt.booking_type = 'equipment' AND pt.booking_id IN (
          SELECT eb.id FROM equipment_bookings eb
          JOIN equipment_listings el ON eb.equipment_listing_id = el.id
          WHERE el.kitchen_id = k.id
        ))
      )
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `);
    console.log(`[Revenue Service V2] Revenue by location: ${result.rows.length} locations found`);
    return result.rows.map((row) => {
      const parseNumeric = (value) => {
        if (!value) return 0;
        if (typeof value === "string") return parseInt(value) || 0;
        return parseInt(String(value)) || 0;
      };
      const locTotalRevenue = parseNumeric(row.total_revenue);
      const locPlatformFee = parseNumeric(row.platform_fee);
      const locManagerRevenue = Math.max(0, locTotalRevenue - locPlatformFee);
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue: locTotalRevenue,
        platformFee: locPlatformFee,
        managerRevenue: locManagerRevenue,
        // Calculated as total - platform fee
        bookingCount: parseInt(row.booking_count) || 0,
        paidBookingCount: parseInt(row.paid_count) || 0
      };
    });
  } catch (error) {
    console.error("Error getting revenue by location from transactions:", error);
    throw error;
  }
}
async function getRevenueByDateFromTransactions(managerId, db2, startDate, endDate) {
  try {
    const tableCheck = await db2.execute(sql5`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error("payment_transactions table does not exist");
    }
    const start = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
    const end = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];
    const whereConditions = [sql5`pt.manager_id = ${managerId}`];
    whereConditions.push(sql5`pt.booking_type IN ('kitchen', 'bundle')`);
    whereConditions.push(sql5`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND pt2.manager_id = pt.manager_id
        )
      )
    `);
    whereConditions.push(sql5`
      (
        (pt.status = 'succeeded' AND pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= ${start}::date AND DATE(pt.paid_at) <= ${end}::date)
        OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= ${start}::date AND DATE(pt.created_at) <= ${end}::date)
      )
    `);
    const whereClause = sql5`WHERE ${sql5.join(whereConditions, sql5` AND `)}`;
    const result = await db2.execute(sql5`
      SELECT 
        DATE(
          CASE 
            WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
            THEN pt.paid_at
            ELSE pt.created_at
          END
        )::text as date,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count
      FROM payment_transactions pt
      ${whereClause}
      GROUP BY DATE(
        CASE 
          WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
          THEN pt.paid_at
          ELSE pt.created_at
        END
      )
      ORDER BY date ASC
    `);
    console.log(`[Revenue Service V2] Revenue by date: ${result.rows.length} dates found`);
    return result.rows.map((row) => {
      const parseNumeric = (value) => {
        if (!value) return 0;
        if (typeof value === "string") return parseInt(value) || 0;
        return parseInt(String(value)) || 0;
      };
      return {
        date: row.date,
        totalRevenue: parseNumeric(row.total_revenue),
        platformFee: parseNumeric(row.platform_fee),
        managerRevenue: Math.max(0, parseNumeric(row.total_revenue) - parseNumeric(row.platform_fee)),
        // Calculate as total - platform fee
        bookingCount: parseInt(row.booking_count) || 0
      };
    });
  } catch (error) {
    console.error("Error getting revenue by date from transactions:", error);
    throw error;
  }
}
var init_revenue_service_v2 = __esm({
  "server/services/revenue-service-v2.ts"() {
    "use strict";
  }
});

// server/services/revenue-service.ts
var revenue_service_exports = {};
__export(revenue_service_exports, {
  calculateManagerRevenue: () => calculateManagerRevenue,
  getCompleteRevenueMetrics: () => getCompleteRevenueMetrics,
  getRevenueByDate: () => getRevenueByDate,
  getRevenueByLocation: () => getRevenueByLocation,
  getRevenueMetrics: () => getRevenueMetrics,
  getTransactionHistory: () => getTransactionHistory
});
import { sql as sql6 } from "drizzle-orm";
function calculateManagerRevenue(totalRevenue, serviceFeeRate) {
  if (serviceFeeRate < 0 || serviceFeeRate > 1) {
    console.warn(`Invalid service fee rate: ${serviceFeeRate}, using 0`);
    return totalRevenue;
  }
  const managerRate = 1 - serviceFeeRate;
  return Math.round(totalRevenue * managerRate);
}
async function getRevenueMetrics(managerId, db2, startDate, endDate, locationId) {
  try {
    const whereConditions = [sql6`l.manager_id = ${managerId}`, sql6`kb.status != 'cancelled'`];
    if (locationId) {
      whereConditions.push(sql6`l.id = ${locationId}`);
    }
    const whereClause = sql6`WHERE ${sql6.join(whereConditions, sql6` AND `)}`;
    const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
    const serviceFeeRate = await getServiceFeeRate2();
    const debugQuery = await db2.execute(sql6`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN kb.total_price IS NOT NULL THEN 1 END) as bookings_with_price,
        COUNT(CASE WHEN kb.total_price IS NULL THEN 1 END) as bookings_without_price,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END) as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END) as processing_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END) as processing_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN kb.payment_intent_id IS NOT NULL THEN 1 END) as with_payment_intent,
        COUNT(CASE WHEN kb.payment_status IS NULL THEN 1 END) as null_payment_status
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = ${managerId}
    `);
    console.log("[Revenue Service] Debug - Manager bookings:", {
      managerId,
      debug: debugQuery.rows[0],
      locationId,
      startDate,
      endDate
    });
    const result = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END)::int as processing_count,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END)::int as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 1 END)::int as refunded_count,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'paid' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'processing' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as pending_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::numeric as avg_booking_value
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
    `);
    const pendingWhereConditions = [
      sql6`l.manager_id = ${managerId}`,
      sql6`kb.status != 'cancelled'`,
      sql6`kb.payment_status = 'processing'`
    ];
    if (locationId) {
      pendingWhereConditions.push(sql6`l.id = ${locationId}`);
    }
    const pendingWhereClause = sql6`WHERE ${sql6.join(pendingWhereConditions, sql6` AND `)}`;
    const pendingResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as pending_payments_all,
        COUNT(*)::int as pending_count_all
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${pendingWhereClause}
    `);
    console.log("[Revenue Service] Pending payments query result:", {
      managerId,
      locationId,
      pendingCount: pendingResult.rows[0]?.pending_count_all || 0,
      pendingAmount: pendingResult.rows[0]?.pending_payments_all || 0
    });
    const completedWhereConditions = [
      sql6`l.manager_id = ${managerId}`,
      sql6`kb.status != 'cancelled'`,
      sql6`kb.payment_status = 'paid'`
    ];
    if (locationId) {
      completedWhereConditions.push(sql6`l.id = ${locationId}`);
    }
    const completedWhereClause = sql6`WHERE ${sql6.join(completedWhereConditions, sql6` AND `)}`;
    const completedResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as completed_payments_all,
        COUNT(*)::int as completed_count_all
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${completedWhereClause}
    `);
    const pendingRow = pendingResult.rows[0] || {};
    const allPendingPayments = typeof pendingRow.pending_payments_all === "string" ? parseInt(pendingRow.pending_payments_all) || 0 : pendingRow.pending_payments_all ? parseInt(String(pendingRow.pending_payments_all)) : 0;
    console.log("[Revenue Service] Pending payments result:", {
      allPendingPayments,
      pendingCount: pendingRow.pending_count_all || 0,
      rawValue: pendingRow.pending_payments_all
    });
    const completedRow = completedResult.rows[0] || {};
    const allCompletedPayments = typeof completedRow.completed_payments_all === "string" ? parseInt(completedRow.completed_payments_all) || 0 : completedRow.completed_payments_all ? parseInt(String(completedRow.completed_payments_all)) : 0;
    console.log("[Revenue Service] Main query result count:", result.rows.length);
    if (result.rows.length > 0) {
      const dbgRow = result.rows[0];
      console.log("[Revenue Service] Main query result:", {
        total_revenue: dbgRow.total_revenue,
        platform_fee: dbgRow.platform_fee,
        booking_count: dbgRow.booking_count
      });
    }
    if (result.rows.length === 0) {
      console.log("[Revenue Service] No bookings in date range, checking for payments outside date range...");
      const pendingServiceFeeResult2 = await db2.execute(sql6`
        SELECT 
          COALESCE(SUM(
            COALESCE(kb.service_fee, 0)::numeric
          ), 0)::bigint as pending_service_fee
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        ${pendingWhereClause}
      `);
      const completedServiceFeeResult2 = await db2.execute(sql6`
        SELECT 
          COALESCE(SUM(
            COALESCE(kb.service_fee, 0)::numeric
          ), 0)::bigint as completed_service_fee
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        ${completedWhereClause}
      `);
      const pSFr2 = pendingServiceFeeResult2.rows[0] || {};
      const pendingServiceFee2 = typeof pSFr2.pending_service_fee === "string" ? parseInt(pSFr2.pending_service_fee) || 0 : pSFr2.pending_service_fee ? parseInt(String(pSFr2.pending_service_fee)) : 0;
      const cSFr2 = completedServiceFeeResult2.rows[0] || {};
      const completedServiceFee2 = typeof cSFr2.completed_service_fee === "string" ? parseInt(cSFr2.completed_service_fee) || 0 : cSFr2.completed_service_fee ? parseInt(String(cSFr2.completed_service_fee)) : 0;
      const totalRevenueWithAllPayments2 = allCompletedPayments + allPendingPayments;
      const totalServiceFee2 = pendingServiceFee2 + completedServiceFee2;
      const managerRevenue2 = totalRevenueWithAllPayments2 - totalServiceFee2;
      const depositedManagerRevenue2 = allCompletedPayments - completedServiceFee2;
      return {
        totalRevenue: totalRevenueWithAllPayments2 || 0,
        platformFee: totalServiceFee2 || 0,
        managerRevenue: managerRevenue2 || 0,
        depositedManagerRevenue: depositedManagerRevenue2 || 0,
        pendingPayments: allPendingPayments,
        completedPayments: allCompletedPayments,
        // Show ALL completed payments, not just in date range
        averageBookingValue: 0,
        bookingCount: 0,
        paidBookingCount: parseInt(completedRow.completed_count_all) || 0,
        cancelledBookingCount: 0,
        refundedAmount: 0
      };
    }
    const row = result.rows[0];
    console.log("[Revenue Service] Query result:", {
      total_revenue: row.total_revenue,
      platform_fee: row.platform_fee,
      booking_count: row.booking_count,
      paid_count: row.paid_count,
      serviceFeeRate,
      rowData: row
    });
    const totalRevenue = typeof row.total_revenue === "string" ? parseInt(row.total_revenue) : row.total_revenue ? parseInt(String(row.total_revenue)) : 0;
    const platformFee = typeof row.platform_fee === "string" ? parseInt(row.platform_fee) : row.platform_fee ? parseInt(String(row.platform_fee)) : 0;
    const totalRevenueWithAllPayments = allCompletedPayments + allPendingPayments;
    const pendingServiceFeeResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(
          COALESCE(kb.service_fee, 0)::numeric
        ), 0)::bigint as pending_service_fee
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${pendingWhereClause}
    `);
    const completedServiceFeeResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(
          COALESCE(kb.service_fee, 0)::numeric
        ), 0)::bigint as completed_service_fee
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${completedWhereClause}
    `);
    const pSFr = pendingServiceFeeResult.rows[0] || {};
    const pendingServiceFee = typeof pSFr.pending_service_fee === "string" ? parseInt(pSFr.pending_service_fee) || 0 : pSFr.pending_service_fee ? parseInt(String(pSFr.pending_service_fee)) : 0;
    const cSFr = completedServiceFeeResult.rows[0] || {};
    const completedServiceFee = typeof cSFr.completed_service_fee === "string" ? parseInt(cSFr.completed_service_fee) || 0 : cSFr.completed_service_fee ? parseInt(String(cSFr.completed_service_fee)) : 0;
    const totalServiceFee = pendingServiceFee + completedServiceFee;
    const managerRevenue = totalRevenueWithAllPayments - totalServiceFee;
    const depositedManagerRevenue = allCompletedPayments - completedServiceFee;
    return {
      totalRevenue: isNaN(totalRevenueWithAllPayments) ? 0 : totalRevenueWithAllPayments || 0,
      platformFee: isNaN(totalServiceFee) ? 0 : totalServiceFee || 0,
      managerRevenue: isNaN(managerRevenue) ? 0 : managerRevenue || 0,
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue || 0,
      pendingPayments: allPendingPayments,
      // Use ALL pending payments, not just those in date range
      completedPayments: allCompletedPayments,
      // Use ALL completed payments, not just those in date range
      averageBookingValue: row.avg_booking_value ? isNaN(Math.round(parseFloat(String(row.avg_booking_value)))) ? 0 : Math.round(parseFloat(String(row.avg_booking_value))) : 0,
      bookingCount: isNaN(parseInt(row.booking_count)) ? 0 : parseInt(row.booking_count) || 0,
      paidBookingCount: isNaN(parseInt(completedRow.completed_count_all)) ? 0 : parseInt(completedRow.completed_count_all) || 0,
      // Use count from all completed payments query
      cancelledBookingCount: isNaN(parseInt(row.cancelled_count)) ? 0 : parseInt(row.cancelled_count) || 0,
      refundedAmount: typeof row.refunded_amount === "string" ? isNaN(parseInt(row.refunded_amount)) ? 0 : parseInt(row.refunded_amount) || 0 : row.refunded_amount ? isNaN(parseInt(String(row.refunded_amount))) ? 0 : parseInt(String(row.refunded_amount)) : 0
    };
  } catch (error) {
    console.error("Error getting revenue metrics:", error);
    throw error;
  }
}
async function getRevenueByLocation(managerId, db2, startDate, endDate) {
  try {
    if (managerId === void 0 || managerId === null || isNaN(managerId)) {
      console.error("[Revenue Service] Invalid managerId:", managerId);
      throw new Error("Invalid manager ID");
    }
    const managerIdParam = sql6`${managerId}`;
    const whereConditions = [sql6`l.manager_id = ${managerIdParam}`, sql6`kb.status != 'cancelled'`];
    if (startDate) {
      const start = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
      whereConditions.push(sql6`DATE(kb.booking_date) >= ${start}::date`);
    }
    if (endDate) {
      const end = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];
      whereConditions.push(sql6`DATE(kb.booking_date) <= ${end}::date`);
    }
    const whereClause = sql6`WHERE ${sql6.join(whereConditions, sql6` AND `)}`;
    const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
    const serviceFeeRate = await getServiceFeeRate2();
    const result = await db2.execute(sql6`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `);
    return result.rows.map((row) => {
      const totalRevenue = typeof row.total_revenue === "string" ? parseInt(row.total_revenue) || 0 : row.total_revenue ? parseInt(String(row.total_revenue)) : 0;
      const platformFee = typeof row.platform_fee === "string" ? parseInt(row.platform_fee) || 0 : row.platform_fee ? parseInt(String(row.platform_fee)) : 0;
      const managerRevenue = totalRevenue - platformFee;
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue,
        platformFee,
        managerRevenue: managerRevenue || 0,
        bookingCount: parseInt(row.booking_count) || 0,
        paidBookingCount: parseInt(row.paid_count) || 0
      };
    });
  } catch (error) {
    console.error("Error getting revenue by location:", error);
    throw error;
  }
}
async function getRevenueByDate(managerId, db2, startDate, endDate) {
  try {
    if (managerId === void 0 || managerId === null || isNaN(managerId)) {
      console.error("[Revenue Service] Invalid managerId:", managerId);
      throw new Error("Invalid manager ID");
    }
    const start = typeof startDate === "string" ? startDate : startDate ? startDate.toISOString().split("T")[0] : null;
    const end = typeof endDate === "string" ? endDate : endDate ? endDate.toISOString().split("T")[0] : null;
    const managerIdParam = sql6`${managerId}`;
    if (!start || !end) {
      console.warn("[Revenue Service] Missing date parameters for getRevenueByDate");
    }
    const startParam = start ? sql6`${start}::date` : sql6`CURRENT_DATE - INTERVAL '30 days'`;
    const endParam = end ? sql6`${end}::date` : sql6`CURRENT_DATE`;
    const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
    const serviceFeeRate = await getServiceFeeRate2();
    const result = await db2.execute(sql6`
      SELECT 
        DATE(kb.booking_date)::text as date,
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = ${managerIdParam}
        AND kb.status != 'cancelled'
        AND DATE(kb.booking_date) >= ${startParam}
        AND DATE(kb.booking_date) <= ${endParam}
      GROUP BY DATE(kb.booking_date)
      ORDER BY date ASC
    `);
    console.log("[Revenue Service] Revenue by date query:", {
      managerId,
      start,
      end,
      resultCount: result.rows.length
    });
    return result.rows.map((row) => {
      const totalRevenue = typeof row.total_revenue === "string" ? parseInt(row.total_revenue) || 0 : row.total_revenue ? parseInt(String(row.total_revenue)) : 0;
      const platformFee = typeof row.platform_fee === "string" ? parseInt(row.platform_fee) || 0 : row.platform_fee ? parseInt(String(row.platform_fee)) : 0;
      const managerRevenue = totalRevenue - platformFee;
      return {
        date: row.date,
        totalRevenue,
        platformFee,
        managerRevenue: managerRevenue || 0,
        bookingCount: parseInt(row.booking_count) || 0
      };
    });
  } catch (error) {
    console.error("Error getting revenue by date:", error);
    throw error;
  }
}
async function getTransactionHistory(managerId, db2, startDate, endDate, locationId, limit = 100, offset = 0) {
  try {
    const whereConditions = [sql6`l.manager_id = ${managerId}`, sql6`kb.status != 'cancelled'`];
    if (startDate) {
      const start = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
      whereConditions.push(sql6`(DATE(kb.booking_date) >= ${start}::date OR DATE(kb.created_at) >= ${start}::date)`);
    }
    if (endDate) {
      const end = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];
      whereConditions.push(sql6`(DATE(kb.booking_date) <= ${end}::date OR DATE(kb.created_at) <= ${end}::date)`);
    }
    if (locationId) {
      whereConditions.push(sql6`l.id = ${locationId}`);
    }
    const whereClause = sql6`WHERE ${sql6.join(whereConditions, sql6` AND `)}`;
    const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
    const serviceFeeRate = await getServiceFeeRate2();
    const result = await db2.execute(sql6`
      SELECT 
        kb.id,
        kb.booking_date,
        kb.start_time,
        kb.end_time,
        COALESCE(
          kb.total_price,
          CASE 
            WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
            THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
            ELSE 0
          END
        )::bigint as total_price,
        COALESCE(kb.service_fee, 0)::bigint as service_fee,
        kb.payment_status,
        kb.payment_intent_id,
        kb.status,
        kb.currency,
        k.name as kitchen_name,
        l.id as location_id,
        l.name as location_name,
        u.username as chef_name,
        u.username as chef_email,
        kb.created_at
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN users u ON kb.chef_id = u.id
      ${whereClause}
      ORDER BY kb.booking_date DESC, kb.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return result.rows.map((row) => {
      const totalPriceCents = row.total_price != null ? parseInt(String(row.total_price)) : 0;
      const serviceFeeCents = row.service_fee != null ? parseInt(String(row.service_fee)) : 0;
      const managerRevenue = totalPriceCents - serviceFeeCents;
      return {
        id: row.id,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        totalPrice: totalPriceCents,
        serviceFee: serviceFeeCents,
        managerRevenue: managerRevenue || 0,
        paymentStatus: row.payment_status,
        paymentIntentId: row.payment_intent_id,
        status: row.status,
        currency: row.currency || "CAD",
        kitchenName: row.kitchen_name,
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        chefName: row.chef_name || "Guest",
        chefEmail: row.chef_email,
        createdAt: row.created_at
      };
    });
  } catch (error) {
    console.error("Error getting transaction history:", error);
    throw error;
  }
}
async function getCompleteRevenueMetrics(managerId, db2, startDate, endDate, locationId) {
  try {
    console.log("[Revenue Service] getCompleteRevenueMetrics called:", {
      managerId,
      startDate,
      endDate,
      locationId
    });
    try {
      const { getRevenueMetricsFromTransactions: getRevenueMetricsFromTransactions2 } = await Promise.resolve().then(() => (init_revenue_service_v2(), revenue_service_v2_exports));
      const metrics = await getRevenueMetricsFromTransactions2(managerId, db2, startDate, endDate, locationId);
      console.log("[Revenue Service] Using payment_transactions for revenue metrics");
      return metrics;
    } catch (error) {
      console.warn("[Revenue Service] Failed to use payment_transactions, falling back to booking tables:", error);
    }
    const kitchenMetrics = await getRevenueMetrics(managerId, db2, startDate, endDate, locationId);
    console.log("[Revenue Service] Kitchen metrics:", kitchenMetrics);
    const whereConditions = [sql6`l.manager_id = ${managerId}`];
    if (startDate) {
      const start = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
      whereConditions.push(sql6`DATE(sb.start_date) >= ${start}::date`);
    }
    if (endDate) {
      const end = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];
      whereConditions.push(sql6`DATE(sb.start_date) <= ${end}::date`);
    }
    if (locationId) {
      whereConditions.push(sql6`l.id = ${locationId}`);
    }
    const whereClause = sql6`WHERE ${sql6.join(whereConditions, sql6` AND `)}`;
    const storageResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(COALESCE(sb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(sb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN sb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'paid' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'processing' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as processing_payments
      FROM storage_bookings sb
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND sb.status != 'cancelled'
    `);
    const equipmentWhereConditions = [sql6`l.manager_id = ${managerId}`];
    if (startDate) {
      const start = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
      equipmentWhereConditions.push(sql6`DATE(eb.start_date) >= ${start}::date`);
    }
    if (endDate) {
      const end = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];
      equipmentWhereConditions.push(sql6`DATE(eb.start_date) <= ${end}::date`);
    }
    if (locationId) {
      equipmentWhereConditions.push(sql6`l.id = ${locationId}`);
    }
    const equipmentWhereClause = sql6`WHERE ${sql6.join(equipmentWhereConditions, sql6` AND `)}`;
    const equipmentResult = await db2.execute(sql6`
      SELECT 
        COALESCE(SUM(COALESCE(eb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(eb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN eb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'paid' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'processing' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as processing_payments
      FROM equipment_bookings eb
      JOIN equipment_listings el ON eb.equipment_listing_id = el.id
      JOIN kitchens k ON el.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${equipmentWhereClause}
        AND eb.status != 'cancelled'
    `);
    const storageRow = storageResult.rows[0] || {};
    const equipmentRow = equipmentResult.rows[0] || {};
    const parseNumeric = (value) => {
      if (!value) return 0;
      if (typeof value === "string") return parseInt(value) || 0;
      return parseInt(String(value)) || 0;
    };
    const totalRevenue = kitchenMetrics.totalRevenue + parseNumeric(storageRow.total_revenue) + parseNumeric(equipmentRow.total_revenue);
    const platformFee = kitchenMetrics.platformFee + parseNumeric(storageRow.platform_fee) + parseNumeric(equipmentRow.platform_fee);
    const managerRevenue = totalRevenue - platformFee;
    const pendingPaymentsTotal = kitchenMetrics.pendingPayments + parseNumeric(storageRow.processing_payments) + parseNumeric(equipmentRow.processing_payments);
    const completedPaymentsTotal = kitchenMetrics.completedPayments + parseNumeric(storageRow.completed_payments) + parseNumeric(equipmentRow.completed_payments);
    const completedPlatformFee = kitchenMetrics.platformFee * (kitchenMetrics.completedPayments / (kitchenMetrics.totalRevenue || 1));
    const storageCompletedPlatformFee = parseNumeric(storageRow.platform_fee) * (parseNumeric(storageRow.completed_payments) / (parseNumeric(storageRow.total_revenue) || 1));
    const equipmentCompletedPlatformFee = parseNumeric(equipmentRow.platform_fee) * (parseNumeric(equipmentRow.completed_payments) / (parseNumeric(equipmentRow.total_revenue) || 1));
    const depositedManagerRevenue = completedPaymentsTotal - (completedPlatformFee + storageCompletedPlatformFee + equipmentCompletedPlatformFee);
    const totalBookingCount = kitchenMetrics.bookingCount + parseNumeric(storageRow.booking_count) + parseNumeric(equipmentRow.booking_count);
    const totalPaidCount = kitchenMetrics.paidBookingCount + parseNumeric(storageRow.paid_count) + parseNumeric(equipmentRow.paid_count);
    const finalMetrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      managerRevenue: isNaN(managerRevenue) ? 0 : managerRevenue || 0,
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue,
      pendingPayments: isNaN(pendingPaymentsTotal) ? 0 : pendingPaymentsTotal,
      completedPayments: isNaN(completedPaymentsTotal) ? 0 : completedPaymentsTotal,
      averageBookingValue: totalRevenue > 0 && totalBookingCount > 0 ? isNaN(Math.round(totalRevenue / totalBookingCount)) ? 0 : Math.round(totalRevenue / totalBookingCount) : 0,
      bookingCount: isNaN(totalBookingCount) ? 0 : totalBookingCount,
      paidBookingCount: isNaN(totalPaidCount) ? 0 : totalPaidCount,
      cancelledBookingCount: isNaN(kitchenMetrics.cancelledBookingCount) ? 0 : kitchenMetrics.cancelledBookingCount,
      refundedAmount: isNaN(kitchenMetrics.refundedAmount) ? 0 : kitchenMetrics.refundedAmount
    };
    console.log("[Revenue Service] Final complete metrics:", finalMetrics);
    return finalMetrics;
  } catch (error) {
    console.error("Error getting complete revenue metrics:", error);
    throw error;
  }
}
var init_revenue_service = __esm({
  "server/services/revenue-service.ts"() {
    "use strict";
  }
});

// server/services/stripe-connect-service.ts
var stripe_connect_service_exports = {};
__export(stripe_connect_service_exports, {
  createAccountLink: () => createAccountLink,
  createAccountUpdateLink: () => createAccountUpdateLink,
  createConnectAccount: () => createConnectAccount,
  createDashboardLoginLink: () => createDashboardLoginLink,
  getAccount: () => getAccount,
  getAccountBalance: () => getAccountBalance,
  getAccountStatus: () => getAccountStatus,
  getBalanceTransactions: () => getBalanceTransactions,
  getPayout: () => getPayout,
  getPayouts: () => getPayouts,
  isAccountReady: () => isAccountReady
});
import Stripe from "stripe";
async function createConnectAccount(params) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  const {
    managerId,
    email,
    country = "CA"
    // Default to Canada
  } = params;
  try {
    const account = await stripe.accounts.create({
      type: "express",
      country,
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      // Metadata to track which manager this belongs to
      metadata: {
        manager_id: managerId.toString(),
        platform: "localcooks"
      }
    });
    return { accountId: account.id };
  } catch (error) {
    console.error("Error creating Stripe Connect account:", error);
    throw new Error(`Failed to create Connect account: ${error.message}`);
  }
}
async function createAccountLink(accountId, refreshUrl, returnUrl) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding"
    });
    return { url: accountLink.url };
  } catch (error) {
    console.error("Error creating account link:", error);
    throw new Error(`Failed to create account link: ${error.message}`);
  }
}
async function createAccountUpdateLink(accountId, refreshUrl, returnUrl) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_update"
    });
    return { url: accountLink.url };
  } catch (error) {
    console.error("Error creating account update link:", error);
    throw new Error(`Failed to create account update link: ${error.message}`);
  }
}
async function isAccountReady(accountId) {
  if (!stripe) {
    return false;
  }
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account.charges_enabled === true && account.payouts_enabled === true;
  } catch (error) {
    console.error("Error checking account readiness:", error);
    return false;
  }
}
async function getAccountStatus(accountId) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      isReady: account.charges_enabled && account.payouts_enabled || false
    };
  } catch (error) {
    console.error("Error retrieving account status:", error);
    throw new Error(`Failed to retrieve account status: ${error.message}`);
  }
}
async function getAccount(accountId) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account;
  } catch (error) {
    if (error.code === "resource_missing") {
      return null;
    }
    console.error("Error retrieving account:", error);
    throw new Error(`Failed to retrieve account: ${error.message}`);
  }
}
async function getPayouts(accountId, limit = 100) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const payouts = await stripe.payouts.list(
      {
        limit
      },
      {
        stripeAccount: accountId
      }
    );
    return payouts.data;
  } catch (error) {
    console.error("Error retrieving payouts:", error);
    throw new Error(`Failed to retrieve payouts: ${error.message}`);
  }
}
async function getPayout(accountId, payoutId) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const payout = await stripe.payouts.retrieve(
      payoutId,
      {
        stripeAccount: accountId
      }
    );
    return payout;
  } catch (error) {
    if (error.code === "resource_missing") {
      return null;
    }
    console.error("Error retrieving payout:", error);
    throw new Error(`Failed to retrieve payout: ${error.message}`);
  }
}
async function getBalanceTransactions(accountId, startDate, endDate, limit = 100) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const params = {
      limit
    };
    if (startDate) {
      params.created = {
        gte: Math.floor(startDate.getTime() / 1e3)
      };
    }
    if (endDate) {
      if (params.created && typeof params.created === "object" && "gte" in params.created) {
        params.created = {
          ...params.created,
          lte: Math.floor(endDate.getTime() / 1e3)
        };
      } else {
        params.created = {
          lte: Math.floor(endDate.getTime() / 1e3)
        };
      }
    }
    const transactions = await stripe.balanceTransactions.list(
      params,
      {
        stripeAccount: accountId
      }
    );
    return transactions.data;
  } catch (error) {
    console.error("Error retrieving balance transactions:", error);
    throw new Error(`Failed to retrieve balance transactions: ${error.message}`);
  }
}
async function getAccountBalance(accountId) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId
    });
    return balance;
  } catch (error) {
    console.error("Error retrieving balance:", error);
    throw new Error(`Failed to retrieve balance: ${error.message}`);
  }
}
async function createDashboardLoginLink(accountId) {
  if (!stripe) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const loginLink = await stripe.accounts.createLoginLink(accountId);
    return { url: loginLink.url };
  } catch (error) {
    console.error("Error creating dashboard login link:", error);
    throw new Error(`Failed to create dashboard login link: ${error.message}`);
  }
}
var stripeSecretKey, stripe;
var init_stripe_connect_service = __esm({
  "server/services/stripe-connect-service.ts"() {
    "use strict";
    stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.warn("\u26A0\uFE0F STRIPE_SECRET_KEY not found in environment variables");
    }
    stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover"
    }) : null;
  }
});

// server/domains/managers/manager.service.ts
import { eq as eq18 } from "drizzle-orm";
var ManagerService, managerService;
var init_manager_service = __esm({
  "server/domains/managers/manager.service.ts"() {
    "use strict";
    init_manager_repository();
    init_db();
    init_revenue_service();
    init_stripe_connect_service();
    init_schema();
    ManagerService = class {
      async getAllManagers() {
        return await managerRepository.findAllManagers();
      }
      async updateOnboarding(userId, updates) {
        return await managerRepository.updateOnboardingStatus(userId, updates);
      }
      async getRevenueOverview(managerId, query) {
        return await getCompleteRevenueMetrics(
          managerId,
          db,
          query.startDate,
          query.endDate,
          query.locationId
        );
      }
      async getInvoices(managerId, query) {
        const filters = {
          startDate: query.startDate,
          endDate: query.endDate,
          locationId: query.locationId ? parseInt(query.locationId) : void 0,
          limit: query.limit ? parseInt(query.limit) : 50,
          offset: query.offset ? parseInt(query.offset) : 0
        };
        const result = await managerRepository.findInvoices(managerId, filters);
        const invoices = result.invoices.map((row) => {
          let totalPriceCents = 0;
          if (row.totalPrice != null) {
            totalPriceCents = parseInt(String(row.totalPrice));
          } else if (row.hourlyRate != null && row.durationHours != null) {
            totalPriceCents = Math.round(parseFloat(String(row.hourlyRate)) * parseFloat(String(row.durationHours)));
          }
          const serviceFeeCents = row.serviceFee != null ? parseInt(String(row.serviceFee)) : 0;
          return {
            bookingId: row.id,
            bookingDate: row.bookingDate,
            startTime: row.startTime,
            endTime: row.endTime,
            totalPrice: totalPriceCents / 100,
            serviceFee: serviceFeeCents / 100,
            paymentStatus: row.paymentStatus,
            paymentIntentId: row.paymentIntentId,
            currency: row.currency || "CAD",
            kitchenName: row.kitchenName,
            locationName: row.locationName,
            chefName: row.chefName || "Guest",
            chefEmail: row.chefEmail,
            createdAt: row.createdAt
          };
        });
        return {
          invoices,
          total: result.total
        };
      }
      async getPayouts(managerId, limit = 50) {
        const [userResult] = await db.select({ stripeConnectAccountId: users.stripeConnectAccountId }).from(users).where(eq18(users.id, managerId)).limit(1);
        if (!userResult?.stripeConnectAccountId) {
          return {
            payouts: [],
            total: 0,
            message: "No Stripe Connect account linked"
          };
        }
        const accountId = userResult.stripeConnectAccountId;
        const payouts = await getPayouts(accountId, limit);
        return {
          payouts: payouts.map((p) => ({
            id: p.id,
            amount: p.amount / 100,
            // Convert cents to dollars
            currency: p.currency,
            status: p.status,
            arrivalDate: new Date(p.arrival_date * 1e3).toISOString(),
            created: new Date(p.created * 1e3).toISOString(),
            description: p.description,
            method: p.method,
            type: p.type
          })),
          total: payouts.length
        };
      }
    };
    managerService = new ManagerService();
  }
});

// server/services/invoice-service.ts
var invoice_service_exports = {};
__export(invoice_service_exports, {
  generateInvoicePDF: () => generateInvoicePDF
});
import PDFDocument from "pdfkit";
import { eq as eq19 } from "drizzle-orm";
async function generateInvoicePDF(booking, chef, kitchen, location, storageBookings2, equipmentBookings2, paymentIntentId, options) {
  const invoiceViewer = options?.viewer ?? "chef";
  let stripePlatformFee = 0;
  let stripeTotalAmount = 0;
  let stripeBaseAmount = 0;
  let stripeNetAmount = 0;
  let stripeProcessingFeeCents = 0;
  const stripeStorageBaseAmounts = /* @__PURE__ */ new Map();
  const stripeEquipmentBaseAmounts = /* @__PURE__ */ new Map();
  if (paymentIntentId) {
    try {
      const [paymentTransaction] = await db.select().from(paymentTransactions).where(eq19(paymentTransactions.paymentIntentId, paymentIntentId)).limit(1);
      if (paymentTransaction) {
        stripeTotalAmount = parseInt(String(paymentTransaction.amount)) || 0;
        stripePlatformFee = parseInt(String(paymentTransaction.serviceFee)) || 0;
        stripeBaseAmount = parseInt(String(paymentTransaction.baseAmount)) || 0;
        if (paymentTransaction.metadata) {
          const meta = typeof paymentTransaction.metadata === "string" ? JSON.parse(paymentTransaction.metadata) : paymentTransaction.metadata;
          if (meta?.stripeFees?.processingFee) {
            stripeProcessingFeeCents = Math.round(Number(meta.stripeFees.processingFee));
          }
        }
        console.log(`[Invoice] Using Stripe-synced amounts: total=${stripeTotalAmount}, base=${stripeBaseAmount}, platformFee=${stripePlatformFee}`);
      }
    } catch (error) {
      console.warn("[Invoice] Could not fetch payment transaction, will calculate fees:", error);
    }
  }
  let totalAmount = 0;
  const items = [];
  const kitchenId = booking.kitchenId || booking.kitchen_id;
  const startTime = booking.startTime || booking.start_time;
  const endTime = booking.endTime || booking.end_time;
  if (kitchenId) {
    try {
      let kitchenAmount = 0;
      let durationHours = 0;
      let hourlyRate = 0;
      if ((booking.hourly_rate || booking.hourlyRate) && (booking.duration_hours || booking.durationHours)) {
        const hourlyRateCents = parseFloat(String(booking.hourly_rate || booking.hourlyRate));
        durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        hourlyRate = hourlyRateCents / 100;
        kitchenAmount = hourlyRateCents * durationHours / 100;
      } else if (stripeBaseAmount > 0) {
        kitchenAmount = stripeBaseAmount / 100;
        if (booking.duration_hours || booking.durationHours) {
          durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (booking.hourly_rate || booking.hourlyRate) {
          hourlyRate = parseFloat(String(booking.hourly_rate || booking.hourlyRate)) / 100;
        } else if (durationHours > 0) {
          hourlyRate = kitchenAmount / durationHours;
        }
      } else if (booking.total_price || booking.totalPrice) {
        const totalPriceCents = booking.total_price ? parseFloat(String(booking.total_price)) : parseFloat(String(booking.totalPrice));
        const hasPaymentTransaction = stripeBaseAmount > 0 || stripeTotalAmount > 0;
        const serviceFeeCents = hasPaymentTransaction || booking.service_fee !== void 0 && booking.service_fee !== null || booking.serviceFee !== void 0 && booking.serviceFee !== null ? parseFloat(String(booking.service_fee || booking.serviceFee || "0")) : 0;
        const basePriceCents = hasPaymentTransaction || serviceFeeCents > 0 ? totalPriceCents - serviceFeeCents : totalPriceCents;
        kitchenAmount = basePriceCents / 100;
        if (booking.duration_hours || booking.durationHours) {
          durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (booking.hourly_rate || booking.hourlyRate) {
          hourlyRate = parseFloat(String(booking.hourly_rate || booking.hourlyRate)) / 100;
        }
      } else if (startTime && endTime) {
        const { calculateKitchenBookingPrice: calculateKitchenBookingPrice2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
        const kitchenPricing = await calculateKitchenBookingPrice2(
          kitchenId,
          startTime,
          endTime
        );
        if (kitchenPricing.totalPriceCents > 0) {
          durationHours = kitchenPricing.durationHours;
          hourlyRate = kitchenPricing.hourlyRateCents / 100;
          kitchenAmount = kitchenPricing.totalPriceCents / 100;
        }
      }
      if (kitchenAmount > 0) {
        if (!durationHours && startTime && endTime) {
          const start = startTime.split(":").map(Number);
          const end = endTime.split(":").map(Number);
          const startMinutes = start[0] * 60 + start[1];
          const endMinutes = end[0] * 60 + end[1];
          durationHours = Math.max(1, (endMinutes - startMinutes) / 60);
        }
        if (!hourlyRate && durationHours > 0) {
          hourlyRate = kitchenAmount / durationHours;
        }
        totalAmount += kitchenAmount;
        items.push({
          description: `Kitchen Booking (${durationHours.toFixed(1)} hour${durationHours !== 1 ? "s" : ""})`,
          quantity: durationHours,
          rate: hourlyRate,
          amount: kitchenAmount
        });
      }
    } catch (error) {
      console.error("Error calculating kitchen price:", error);
    }
  }
  if (storageBookings2 && storageBookings2.length > 0) {
    for (const storageBooking of storageBookings2) {
      try {
        let storageAmount = 0;
        let basePrice = 0;
        let days = 0;
        const startDate = new Date(storageBooking.startDate || storageBooking.start_date);
        const endDate = new Date(storageBooking.endDate || storageBooking.end_date);
        days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
        const storageListingId = storageBooking.storageListingId || storageBooking.storage_listing_id;
        if (storageListingId) {
          const [listing] = await db.select({
            basePrice: storageListings.basePrice,
            pricingModel: storageListings.pricingModel,
            minimumBookingDuration: storageListings.minimumBookingDuration
          }).from(storageListings).where(eq19(storageListings.id, storageListingId)).limit(1);
          if (listing) {
            const listingBasePriceCents = parseFloat(String(listing.basePrice)) || 0;
            const pricingModel = listing.pricingModel || "daily";
            const minDays = listing.minimumBookingDuration || 1;
            const effectiveDays = Math.max(days, minDays);
            if (pricingModel === "hourly") {
              const hours = Math.ceil((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60));
              const minHours = minDays * 24;
              const effectiveHours = Math.max(hours, minHours);
              basePrice = listingBasePriceCents / 100;
              storageAmount = listingBasePriceCents * effectiveHours / 100;
            } else if (pricingModel === "monthly-flat") {
              basePrice = listingBasePriceCents / 100;
              storageAmount = basePrice;
            } else {
              basePrice = listingBasePriceCents / 100;
              storageAmount = listingBasePriceCents * effectiveDays / 100;
            }
          }
        }
        if (storageAmount === 0 && (storageBooking.total_price || storageBooking.totalPrice)) {
          const totalPriceCents = parseFloat(String(storageBooking.total_price || storageBooking.totalPrice));
          const serviceFeeCents = parseFloat(String(storageBooking.service_fee || storageBooking.serviceFee || "0"));
          const basePriceCents = totalPriceCents - serviceFeeCents;
          storageAmount = basePriceCents / 100;
          basePrice = days > 0 ? storageAmount / days : 0;
        }
        if (storageAmount > 0) {
          totalAmount += storageAmount;
          items.push({
            description: `Storage Booking (${days} day${days !== 1 ? "s" : ""})`,
            quantity: days,
            rate: basePrice,
            amount: storageAmount
          });
        }
      } catch (error) {
        console.error("Error calculating storage price:", error);
      }
    }
  }
  if (equipmentBookings2 && equipmentBookings2.length > 0) {
    for (const equipmentBooking of equipmentBookings2) {
      try {
        let sessionRate = 0;
        const equipmentListingId = equipmentBooking.equipmentId || equipmentBooking.equipment_id || equipmentBooking.equipmentListingId || equipmentBooking.equipment_listing_id;
        if (equipmentListingId) {
          const [listing] = await db.select({ sessionRate: equipmentListings.sessionRate }).from(equipmentListings).where(eq19(equipmentListings.id, equipmentListingId)).limit(1);
          if (listing) {
            const listingSessionRateCents = parseFloat(String(listing.sessionRate)) || 0;
            sessionRate = listingSessionRateCents / 100;
          }
        }
        if (sessionRate === 0 && (equipmentBooking.total_price || equipmentBooking.totalPrice)) {
          const totalPriceCents = parseFloat(String(equipmentBooking.total_price || equipmentBooking.totalPrice));
          const serviceFeeCents = parseFloat(String(equipmentBooking.service_fee || equipmentBooking.serviceFee || "0"));
          const basePriceCents = totalPriceCents - serviceFeeCents;
          sessionRate = basePriceCents / 100;
        }
        if (sessionRate > 0) {
          totalAmount += sessionRate;
          items.push({
            description: "Equipment Rental",
            quantity: 1,
            rate: sessionRate,
            amount: sessionRate
          });
        }
      } catch (error) {
        console.error("Error calculating equipment price:", error);
      }
    }
  }
  let platformFee = 0;
  if (stripePlatformFee > 0) {
    platformFee = stripePlatformFee / 100;
    console.log(`[Invoice] Using Stripe platform fee: $${platformFee.toFixed(2)}`);
  } else if (booking.service_fee || booking.serviceFee) {
    const storedServiceFeeCents = parseFloat(String(booking.service_fee || booking.serviceFee));
    platformFee = storedServiceFeeCents / 100;
    console.log(`[Invoice] Using stored service_fee from booking: $${platformFee.toFixed(2)}`);
  } else {
    let serviceFeeRate = 0.05;
    try {
      const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
      serviceFeeRate = await getServiceFeeRate2();
    } catch (error) {
      console.warn("[Invoice] Could not get service fee rate, using default 5%:", error);
    }
    if (totalAmount > 0) {
      platformFee = totalAmount * serviceFeeRate;
      console.log(`[Invoice] Calculated platform fee (fallback): $${platformFee.toFixed(2)}`);
    }
  }
  const stripeProcessingFee = 0.3;
  const processingFee = stripeProcessingFeeCents > 0 ? stripeProcessingFeeCents / 100 : stripeProcessingFee;
  const processingFeeCents = stripeProcessingFeeCents > 0 ? stripeProcessingFeeCents : Math.round(stripeProcessingFee * 100);
  const serviceFee = platformFee + processingFee;
  const platformFeeCents = Math.round(platformFee * 100);
  const taxAmount = booking.taxAmount ? Number(booking.taxAmount) / 100 : 0;
  const taxCents = Math.round(taxAmount * 100);
  const subtotalCents = Math.round(totalAmount * 100);
  const subtotalWithTaxCents = subtotalCents + taxCents;
  const chefTotalCents = subtotalWithTaxCents - platformFeeCents - processingFeeCents;
  const platformFeeForInvoiceCents = invoiceViewer === "chef" ? Math.max(0, chefTotalCents - subtotalWithTaxCents) : platformFeeCents;
  const platformFeeForInvoice = platformFeeForInvoiceCents / 100;
  const totalForInvoice = invoiceViewer === "manager" ? (subtotalWithTaxCents - platformFeeCents - processingFeeCents) / 100 : subtotalWithTaxCents / 100;
  const grandTotal = totalForInvoice;
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "LETTER"
      });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);
      doc.fontSize(28).font("Helvetica-Bold").text("INVOICE", 50, 50);
      doc.fontSize(10).font("Helvetica");
      const invoiceDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      const invoiceNumber = `LC-${booking.id}-${(/* @__PURE__ */ new Date()).getFullYear()}`;
      const pageWidth = doc.page.width;
      const rightMargin = pageWidth - 50;
      const labelWidth = 80;
      const valueStartX = rightMargin - 200;
      let rightY = 50;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Invoice #:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(invoiceNumber, valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      doc.font("Helvetica-Bold");
      doc.text("Date:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(invoiceDate, valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      if (paymentIntentId) {
        doc.font("Helvetica-Bold");
        doc.text("Payment ID:", valueStartX, rightY, { width: labelWidth, align: "right" });
        doc.font("Helvetica");
        const paymentIdDisplay = paymentIntentId.length > 20 ? paymentIntentId.substring(0, 20) + "..." : paymentIntentId;
        doc.text(paymentIdDisplay, valueStartX + labelWidth + 5, rightY);
      }
      let leftY = 120;
      doc.fontSize(14).font("Helvetica-Bold").text("Local Cooks Community", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica").text("support@localcook.shop", 50, leftY);
      leftY += 30;
      doc.fontSize(12).font("Helvetica-Bold").text("Bill To:", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica");
      if (chef) {
        doc.text(chef.username || chef.email || "Chef", 50, leftY);
        leftY += 15;
        if (chef.email) {
          doc.text(chef.email, 50, leftY);
          leftY += 15;
        }
      }
      leftY += 20;
      doc.fontSize(12).font("Helvetica-Bold").text("Booking Details:", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica");
      const bookingDateStr = booking.bookingDate ? new Date(booking.bookingDate).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }) : "N/A";
      doc.text(`Kitchen: ${kitchen?.name || "Kitchen"}`, 50, leftY);
      leftY += 15;
      if (location?.name) {
        doc.text(`Location: ${location.name}`, 50, leftY);
        leftY += 15;
      }
      doc.text(`Date: ${bookingDateStr}`, 50, leftY);
      leftY += 15;
      doc.text(`Time: ${booking.startTime || booking.start_time || "N/A"} - ${booking.endTime || booking.end_time || "N/A"}`, 50, leftY);
      leftY += 30;
      const tableTop = leftY;
      doc.rect(50, tableTop, 500, 25).fill("#f3f4f6");
      doc.fontSize(10).font("Helvetica-Bold");
      doc.fillColor("#000000");
      doc.text("Description", 60, tableTop + 8, { width: 250 });
      doc.text("Qty", 320, tableTop + 8, { width: 50 });
      doc.text("Rate", 380, tableTop + 8, { width: 110, align: "right" });
      doc.text("Amount", 500, tableTop + 8, { width: 50, align: "right" });
      doc.moveTo(50, tableTop + 25).lineTo(550, tableTop + 25).stroke();
      let currentY = tableTop + 35;
      items.forEach((item, index) => {
        if (index % 2 === 0) {
          doc.rect(50, currentY - 5, 500, 20).fill("#fafafa");
        }
        doc.fontSize(10).font("Helvetica").fillColor("#000000");
        doc.text(item.description, 60, currentY, { width: 250 });
        doc.text(item.quantity.toString(), 320, currentY);
        doc.text(`$${item.rate.toFixed(2)}`, 380, currentY, { align: "right", width: 110 });
        doc.text(`$${item.amount.toFixed(2)}`, 500, currentY, { align: "right", width: 50 });
        currentY += 20;
      });
      currentY += 10;
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
      currentY += 15;
      const formatAmount = (amount, negative = false) => {
        const normalized = Math.abs(amount);
        return `${negative ? "-" : ""}$${normalized.toFixed(2)}`;
      };
      const addTotalRow = (label, amount, negative = false) => {
        doc.text(label, 380, currentY, { width: 110, align: "right" });
        doc.text(formatAmount(amount, negative), 500, currentY, { align: "right", width: 50 });
        currentY += 20;
      };
      addTotalRow("Subtotal:", totalAmount);
      if (taxAmount > 0) {
        addTotalRow("Tax:", taxAmount);
      }
      if (platformFeeForInvoice > 0) {
        addTotalRow("Platform Fee:", platformFeeForInvoice, invoiceViewer === "manager");
      }
      if (invoiceViewer === "manager" && processingFee > 0) {
        addTotalRow("Stripe Processing Fee:", processingFee, true);
      }
      doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
      currentY += 10;
      doc.fontSize(12).font("Helvetica-Bold");
      doc.text("Total:", 380, currentY, { align: "right", width: 110 });
      doc.text(`$${grandTotal.toFixed(2)}`, 500, currentY, { align: "right", width: 50 });
      doc.font("Helvetica").fontSize(10);
      currentY += 40;
      doc.rect(50, currentY, 500, 60).stroke("#e5e7eb");
      doc.rect(50, currentY, 500, 60).fill("#f9fafb");
      currentY += 15;
      doc.fontSize(10).font("Helvetica-Bold").text("Payment Information", 60, currentY);
      currentY += 18;
      doc.font("Helvetica");
      doc.text("Payment Method: Credit/Debit Card", 60, currentY);
      currentY += 15;
      doc.text("Payment Status: Paid", 60, currentY);
      currentY += 15;
      doc.fontSize(9).fillColor("#6b7280").text("Note: Payment has been processed successfully.", 60, currentY);
      doc.fillColor("#000000");
      const pageHeight = doc.page.height;
      const footerY = pageHeight - 80;
      doc.moveTo(50, footerY).lineTo(550, footerY).stroke("#e5e7eb");
      doc.fontSize(9).fillColor("#6b7280").text("Thank you for your business!", 50, footerY + 15, { align: "center", width: 500 });
      doc.text("For questions, contact support@localcook.shop", 50, footerY + 30, { align: "center", width: 500 });
      doc.fillColor("#000000");
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
var init_invoice_service = __esm({
  "server/services/invoice-service.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/services/payout-statement-service.ts
var payout_statement_service_exports = {};
__export(payout_statement_service_exports, {
  generatePayoutStatementPDF: () => generatePayoutStatementPDF
});
import PDFDocument2 from "pdfkit";
async function generatePayoutStatementPDF(managerId, managerName, managerEmail, payout, balanceTransactions, bookings) {
  let totalEarnings = 0;
  let totalPlatformFees = 0;
  const totalBookings = bookings.length;
  let serviceFeeRate = 0.05;
  try {
    const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
    serviceFeeRate = await getServiceFeeRate2();
  } catch (error) {
    console.error("Error getting service fee rate for payout statement:", error);
  }
  bookings.forEach((booking) => {
    const totalPrice = (booking.totalPrice || booking.total_price || 0) / 100;
    const serviceFee = (booking.serviceFee || booking.service_fee || 0) / 100;
    const managerRevenue = totalPrice * (1 - serviceFeeRate);
    totalEarnings += managerRevenue;
    totalPlatformFees += serviceFee;
  });
  const payoutAmount = payout.amount / 100;
  const payoutDate = new Date(payout.created * 1e3);
  const payoutStatus = payout.status;
  const periodStart = bookings.length > 0 ? new Date(Math.min(...bookings.map((b) => new Date(b.booking_date || b.created_at).getTime()))) : payoutDate;
  const periodEnd = payoutDate;
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument2({
        margin: 50,
        size: "LETTER"
      });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);
      doc.fontSize(28).font("Helvetica-Bold").text("PAYOUT STATEMENT", 50, 50);
      doc.fontSize(10).font("Helvetica");
      const statementDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      const statementNumber = `PS-${payout.id.substring(3)}-${payoutDate.getFullYear()}`;
      const pageWidth = doc.page.width;
      const rightMargin = pageWidth - 50;
      const labelWidth = 100;
      const valueStartX = rightMargin - 200;
      let rightY = 50;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Statement #:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(statementNumber, valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      doc.font("Helvetica-Bold");
      doc.text("Date:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(statementDate, valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      doc.font("Helvetica-Bold");
      doc.text("Payout ID:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      const payoutIdDisplay = payout.id.length > 20 ? payout.id.substring(0, 20) + "..." : payout.id;
      doc.text(payoutIdDisplay, valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      doc.font("Helvetica-Bold");
      doc.text("Status:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(payoutStatus.charAt(0).toUpperCase() + payoutStatus.slice(1), valueStartX + labelWidth + 5, rightY);
      rightY += 15;
      doc.font("Helvetica-Bold");
      doc.text("Payout Date:", valueStartX, rightY, { width: labelWidth, align: "right" });
      doc.font("Helvetica");
      doc.text(payoutDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }), valueStartX + labelWidth + 5, rightY);
      let leftY = 120;
      doc.fontSize(14).font("Helvetica-Bold").text("Local Cooks Community", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica").text("support@localcooks.ca", 50, leftY);
      leftY += 30;
      doc.fontSize(12).font("Helvetica-Bold").text("Pay To:", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica");
      doc.text(managerName || "Manager", 50, leftY);
      leftY += 15;
      if (managerEmail) {
        doc.text(managerEmail, 50, leftY);
        leftY += 15;
      }
      leftY += 20;
      doc.fontSize(12).font("Helvetica-Bold").text("Period:", 50, leftY);
      leftY += 18;
      doc.fontSize(10).font("Helvetica");
      doc.text(
        `${periodStart.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} - ${periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
        50,
        leftY
      );
      leftY += 40;
      doc.fontSize(14).font("Helvetica-Bold").text("Summary", 50, leftY);
      leftY += 25;
      const summaryItems = [
        { label: "Total Bookings", value: totalBookings.toString() },
        { label: "Total Revenue", value: `$${totalEarnings.toFixed(2)}` },
        { label: "Platform Fees", value: `-$${totalPlatformFees.toFixed(2)}` },
        { label: "Net Earnings", value: `$${totalEarnings.toFixed(2)}` },
        { label: "Payout Amount", value: `$${payoutAmount.toFixed(2)}` }
      ];
      summaryItems.forEach((item) => {
        doc.fontSize(10).font("Helvetica");
        doc.text(item.label + ":", 50, leftY, { width: 200 });
        doc.font("Helvetica-Bold");
        doc.text(item.value, 250, leftY);
        leftY += 20;
      });
      if (bookings.length > 0) {
        leftY += 20;
        doc.fontSize(14).font("Helvetica-Bold").text("Booking Details", 50, leftY);
        leftY += 25;
        doc.fontSize(9).font("Helvetica-Bold");
        doc.text("Date", 50, leftY);
        doc.text("Kitchen", 120, leftY);
        doc.text("Chef", 250, leftY);
        doc.text("Amount", 350, leftY, { width: 100, align: "right" });
        leftY += 15;
        doc.moveTo(50, leftY).lineTo(550, leftY).stroke();
        leftY += 10;
        doc.fontSize(8).font("Helvetica");
        bookings.slice(0, 30).forEach((booking) => {
          if (leftY > 700) {
            doc.addPage();
            leftY = 50;
          }
          const bookingDateRaw = booking.bookingDate || booking.booking_date || booking.createdAt || booking.created_at;
          const bookingDate = new Date(bookingDateRaw);
          const dateStr = bookingDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const kitchenName = (booking.kitchenName || booking.kitchen_name || "Kitchen").substring(0, 20);
          const chefName = (booking.chefName || booking.chef_name || "Guest").substring(0, 20);
          const amount = (booking.totalPrice || booking.total_price || 0) / 100 * (1 - serviceFeeRate);
          doc.text(dateStr, 50, leftY);
          doc.text(kitchenName, 120, leftY, { width: 120 });
          doc.text(chefName, 250, leftY, { width: 90 });
          doc.text(`$${amount.toFixed(2)}`, 350, leftY, { width: 100, align: "right" });
          leftY += 15;
        });
        if (bookings.length > 30) {
          leftY += 5;
          doc.fontSize(8).font("Helvetica").text(`... and ${bookings.length - 30} more bookings`, 50, leftY);
        }
      }
      const footerY = doc.page.height - 100;
      doc.fontSize(8).font("Helvetica");
      doc.text(
        "This is an automated payout statement from Local Cooks Community.",
        50,
        footerY,
        { align: "center", width: doc.page.width - 100 }
      );
      doc.text(
        "For questions, contact support@localcooks.ca",
        50,
        footerY + 15,
        { align: "center", width: doc.page.width - 100 }
      );
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
var init_payout_statement_service = __esm({
  "server/services/payout-statement-service.ts"() {
    "use strict";
  }
});

// server/routes/manager.ts
var manager_exports = {};
__export(manager_exports, {
  default: () => manager_default
});
import { Router as Router11 } from "express";
import { eq as eq20, inArray as inArray4, and as and13, desc as desc10, sql as sql7 } from "drizzle-orm";
var router11, manager_default;
var init_manager = __esm({
  "server/routes/manager.ts"() {
    "use strict";
    init_db();
    init_firebase_auth_middleware();
    init_schema();
    init_user_service();
    init_email();
    init_phone_utils();
    init_timezone_utils();
    init_api_response();
    init_schema();
    init_booking_service();
    init_kitchen_service();
    init_location_service();
    init_chef_service();
    init_manager_service();
    router11 = Router11();
    router11.get("/revenue/overview", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const { startDate, endDate, locationId } = req.query;
        const metrics = await managerService.getRevenueOverview(managerId, {
          startDate,
          endDate,
          locationId: locationId ? parseInt(locationId) : void 0
        });
        res.json(metrics);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/invoices", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const result = await managerService.getInvoices(managerId, req.query);
        res.json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/invoices/:bookingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const bookingId = parseInt(req.params.bookingId);
        if (isNaN(bookingId) || bookingId <= 0) {
          return res.status(400).json({ error: "Invalid booking ID" });
        }
        const [booking] = await db.select({
          id: kitchenBookings.id,
          chefId: kitchenBookings.chefId,
          kitchenId: kitchenBookings.kitchenId,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
          status: kitchenBookings.status,
          totalPrice: kitchenBookings.totalPrice,
          hourlyRate: kitchenBookings.hourlyRate,
          durationHours: kitchenBookings.durationHours,
          serviceFee: kitchenBookings.serviceFee,
          paymentStatus: kitchenBookings.paymentStatus,
          paymentIntentId: kitchenBookings.paymentIntentId,
          currency: kitchenBookings.currency,
          createdAt: kitchenBookings.createdAt,
          updatedAt: kitchenBookings.updatedAt,
          kitchenName: kitchens.name,
          locationName: locations.name,
          managerId: locations.managerId
        }).from(kitchenBookings).innerJoin(kitchens, eq20(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq20(kitchens.locationId, locations.id)).where(eq20(kitchenBookings.id, bookingId)).limit(1);
        if (!booking) {
          return res.status(404).json({ error: "Booking not found" });
        }
        if (booking.managerId !== managerId) {
          return res.status(403).json({ error: "Access denied to this booking" });
        }
        if (booking.status === "cancelled" && !booking.paymentIntentId && !booking.totalPrice) {
          return res.status(400).json({ error: "Invoice cannot be downloaded for cancelled bookings without payment information" });
        }
        let chef = null;
        if (booking.chefId) {
          const [chefData] = await db.select({ id: users.id, username: users.username }).from(users).where(eq20(users.id, booking.chefId)).limit(1);
          chef = chefData || null;
        }
        const storageRows = await db.select({
          id: storageBookings.id,
          kitchenBookingId: storageBookings.kitchenBookingId,
          storageListingId: storageBookings.storageListingId,
          startDate: storageBookings.startDate,
          endDate: storageBookings.endDate,
          status: storageBookings.status,
          totalPrice: storageBookings.totalPrice,
          storageName: storageListings.name
        }).from(storageBookings).innerJoin(storageListings, eq20(storageBookings.storageListingId, storageListings.id)).where(eq20(storageBookings.kitchenBookingId, bookingId));
        const equipmentRows = await db.select({
          id: equipmentBookings.id,
          kitchenBookingId: equipmentBookings.kitchenBookingId,
          equipmentListingId: equipmentBookings.equipmentListingId,
          status: equipmentBookings.status,
          totalPrice: equipmentBookings.totalPrice,
          equipmentType: equipmentListings.equipmentType,
          brand: equipmentListings.brand,
          model: equipmentListings.model
        }).from(equipmentBookings).innerJoin(equipmentListings, eq20(equipmentBookings.equipmentListingId, equipmentListings.id)).where(eq20(equipmentBookings.kitchenBookingId, bookingId));
        const { generateInvoicePDF: generateInvoicePDF2 } = await Promise.resolve().then(() => (init_invoice_service(), invoice_service_exports));
        const pdfBuffer = await generateInvoicePDF2(
          booking,
          chef,
          { name: booking.kitchenName },
          { name: booking.locationName },
          storageRows,
          equipmentRows,
          booking.paymentIntentId
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="invoice-${bookingId}.pdf"`);
        res.send(pdfBuffer);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/by-location", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const { startDate, endDate } = req.query;
        const { getRevenueByLocation: getRevenueByLocation2 } = await Promise.resolve().then(() => (init_revenue_service(), revenue_service_exports));
        const result = await getRevenueByLocation2(
          managerId,
          db,
          startDate,
          endDate
        );
        res.json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/charts", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const { startDate, endDate, period, locationId } = req.query;
        const { getRevenueByDate: getRevenueByDate2 } = await Promise.resolve().then(() => (init_revenue_service(), revenue_service_exports));
        const data = await getRevenueByDate2(
          managerId,
          db,
          startDate,
          endDate
        );
        res.json({ data, period: period || "daily" });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/transactions", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const { startDate, endDate, locationId, paymentStatus, limit = "50", offset = "0" } = req.query;
        const { getTransactionHistory: getTransactionHistory2 } = await Promise.resolve().then(() => (init_revenue_service(), revenue_service_exports));
        const transactions = await getTransactionHistory2(
          managerId,
          db,
          startDate,
          endDate,
          locationId ? parseInt(locationId) : void 0,
          parseInt(limit),
          parseInt(offset)
        );
        res.json({ transactions, total: transactions.length });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.post("/stripe-connect/create", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      console.log("[Stripe Connect] Create request received for manager:", req.neonUser?.id);
      try {
        const managerId = req.neonUser.id;
        const userResult = await db.execute(sql7`
            SELECT id, username as email, stripe_connect_account_id 
            FROM users 
            WHERE id = ${managerId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow) {
          console.error("[Stripe Connect] User not found for ID:", managerId);
          return res.status(404).json({ error: "User not found" });
        }
        const user = {
          id: userRow.id,
          email: userRow.email,
          stripeConnectAccountId: userRow.stripe_connect_account_id
        };
        const { createConnectAccount: createConnectAccount2, createAccountLink: createAccountLink2, isAccountReady: isAccountReady2, createDashboardLoginLink: createDashboardLoginLink2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
        const refreshUrl = `${baseUrl}/manager/stripe-connect/refresh`;
        const returnUrl = `${baseUrl}/manager/stripe-connect/return?success=true`;
        if (user.stripeConnectAccountId) {
          const isReady = await isAccountReady2(user.stripeConnectAccountId);
          if (isReady) {
            return res.json({ alreadyExists: true, accountId: user.stripeConnectAccountId });
          } else {
            const link2 = await createAccountLink2(user.stripeConnectAccountId, refreshUrl, returnUrl);
            return res.json({ url: link2.url });
          }
        }
        console.log("[Stripe Connect] Creating new account for email:", user.email);
        const { accountId } = await createConnectAccount2({
          managerId,
          email: user.email,
          country: "CA"
        });
        await userService.updateUser(managerId, { stripeConnectAccountId: accountId });
        const link = await createAccountLink2(accountId, refreshUrl, returnUrl);
        return res.json({ url: link.url });
      } catch (error) {
        console.error("[Stripe Connect] Error in create route:", error);
        return errorResponse(res, error);
      }
    });
    router11.get("/stripe-connect/onboarding-link", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const userResult = await db.execute(sql7`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${managerId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow?.stripe_connect_account_id) {
          return res.status(400).json({ error: "No Stripe Connect account found" });
        }
        const { createAccountLink: createAccountLink2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
        const refreshUrl = `${baseUrl}/manager/stripe-connect/refresh`;
        const returnUrl = `${baseUrl}/manager/stripe-connect/return?success=true`;
        const link = await createAccountLink2(userRow.stripe_connect_account_id, refreshUrl, returnUrl);
        return res.json({ url: link.url });
      } catch (error) {
        console.error("[Stripe Connect] Error in onboarding-link route:", error);
        return errorResponse(res, error);
      }
    });
    router11.get("/stripe-connect/dashboard-link", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const userResult = await db.execute(sql7`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${managerId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow?.stripe_connect_account_id) {
          return res.status(400).json({ error: "No Stripe Connect account found" });
        }
        const { createDashboardLoginLink: createDashboardLoginLink2, isAccountReady: isAccountReady2, createAccountLink: createAccountLink2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const isReady = await isAccountReady2(userRow.stripe_connect_account_id);
        if (isReady) {
          const link = await createDashboardLoginLink2(userRow.stripe_connect_account_id);
          return res.json({ url: link.url });
        } else {
          const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
          const refreshUrl = `${baseUrl}/manager/stripe-connect/refresh`;
          const returnUrl = `${baseUrl}/manager/stripe-connect/return?success=true`;
          const link = await createAccountLink2(userRow.stripe_connect_account_id, refreshUrl, returnUrl);
          return res.json({ url: link.url, requiresOnboarding: true });
        }
      } catch (error) {
        console.error("[Stripe Connect] Error in dashboard-link route:", error);
        return errorResponse(res, error);
      }
    });
    router11.get("/stripe-connect/status", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const [manager] = await db.select({ stripeConnectAccountId: users.stripeConnectAccountId }).from(users).where(eq20(users.id, managerId)).limit(1);
        if (!manager?.stripeConnectAccountId) {
          return res.json({
            connected: false,
            accountId: null,
            payoutsEnabled: false,
            chargesEnabled: false,
            detailsSubmitted: false
          });
        }
        res.json({
          connected: true,
          accountId: manager.stripeConnectAccountId,
          payoutsEnabled: true,
          chargesEnabled: true,
          detailsSubmitted: true
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.post("/stripe-connect/sync", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const [manager] = await db.select().from(users).where(eq20(users.id, managerId)).limit(1);
        if (!manager?.stripeConnectAccountId) {
          return res.status(400).json({ error: "No Stripe account connected" });
        }
        const { getAccountStatus: getAccountStatus2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const status = await getAccountStatus2(manager.stripeConnectAccountId);
        const onboardingStatus = status.detailsSubmitted ? "complete" : "in_progress";
        await db.update(users).set({
          stripeConnectOnboardingStatus: onboardingStatus
          // If they are fully ready, ensure manager onboarding is arguably complete for payments part
          // keeping it simple for now, just updating stripe status
        }).where(eq20(users.id, managerId));
        res.json({
          connected: true,
          accountId: manager.stripeConnectAccountId,
          status: onboardingStatus,
          details: status
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/payouts", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const { limit = "50" } = req.query;
        const result = await managerService.getPayouts(managerId, parseInt(limit));
        res.json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/payouts/:payoutId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const payoutId = req.params.payoutId;
        const [userResult] = await db.select({ stripeConnectAccountId: users.stripeConnectAccountId }).from(users).where(eq20(users.id, managerId)).limit(1);
        if (!userResult?.stripeConnectAccountId) {
          return res.status(404).json({ error: "No Stripe Connect account linked" });
        }
        const accountId = userResult.stripeConnectAccountId;
        const { getPayout: getPayout2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const payout = await getPayout2(accountId, payoutId);
        if (!payout) {
          return res.status(404).json({ error: "Payout not found" });
        }
        const payoutDate = new Date(payout.created * 1e3);
        const periodStart = new Date(payoutDate);
        periodStart.setDate(periodStart.getDate() - 7);
        const { getBalanceTransactions: getBalanceTransactions2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const transactions = await getBalanceTransactions2(
          accountId,
          periodStart,
          payoutDate,
          100
        );
        const bookingRows = await db.select({
          id: kitchenBookings.id,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
          totalPrice: kitchenBookings.totalPrice,
          serviceFee: kitchenBookings.serviceFee,
          paymentStatus: kitchenBookings.paymentStatus,
          paymentIntentId: kitchenBookings.paymentIntentId,
          kitchenName: kitchens.name,
          locationName: locations.name,
          chefName: users.username,
          chefEmail: users.username
        }).from(kitchenBookings).innerJoin(kitchens, eq20(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq20(kitchens.locationId, locations.id)).leftJoin(users, eq20(kitchenBookings.chefId, users.id)).where(
          and13(
            eq20(locations.managerId, managerId),
            eq20(kitchenBookings.paymentStatus, "paid"),
            sql7`DATE(${kitchenBookings.bookingDate}) >= ${periodStart.toISOString().split("T")[0]}::date`,
            sql7`DATE(${kitchenBookings.bookingDate}) <= ${payoutDate.toISOString().split("T")[0]}::date`
          )
        ).orderBy(desc10(kitchenBookings.bookingDate));
        res.json({
          payout: {
            id: payout.id,
            amount: payout.amount / 100,
            currency: payout.currency,
            status: payout.status,
            arrivalDate: new Date(payout.arrival_date * 1e3).toISOString(),
            created: new Date(payout.created * 1e3).toISOString(),
            description: payout.description,
            method: payout.method,
            type: payout.type
          },
          transactions: transactions.map((t) => ({
            id: t.id,
            amount: t.amount / 100,
            currency: t.currency,
            description: t.description,
            fee: t.fee / 100,
            net: t.net / 100,
            status: t.status,
            type: t.type,
            created: new Date(t.created * 1e3).toISOString()
          })),
          bookings: bookingRows.map((row) => ({
            id: row.id,
            bookingDate: row.bookingDate,
            startTime: row.startTime,
            endTime: row.endTime,
            totalPrice: (parseInt(String(row.totalPrice)) || 0) / 100,
            serviceFee: (parseInt(String(row.serviceFee)) || 0) / 100,
            paymentStatus: row.paymentStatus,
            paymentIntentId: row.paymentIntentId,
            kitchenName: row.kitchenName,
            locationName: row.locationName,
            chefName: row.chefName || "Guest",
            chefEmail: row.chefEmail
          }))
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/revenue/payouts/:payoutId/statement", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const payoutId = req.params.payoutId;
        const [manager] = await db.select({
          id: users.id,
          username: users.username,
          stripeConnectAccountId: users.stripeConnectAccountId
        }).from(users).where(eq20(users.id, managerId)).limit(1);
        if (!manager?.stripeConnectAccountId) {
          return res.status(404).json({ error: "No Stripe Connect account linked" });
        }
        const accountId = manager.stripeConnectAccountId;
        const { getPayout: getPayout2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const payout = await getPayout2(accountId, payoutId);
        if (!payout) {
          return res.status(404).json({ error: "Payout not found" });
        }
        const payoutDate = new Date(payout.created * 1e3);
        const periodStart = new Date(payoutDate);
        periodStart.setDate(periodStart.getDate() - 7);
        const bookingRows = await db.select({
          id: kitchenBookings.id,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
          totalPrice: kitchenBookings.totalPrice,
          serviceFee: kitchenBookings.serviceFee,
          paymentStatus: kitchenBookings.paymentStatus,
          paymentIntentId: kitchenBookings.paymentIntentId,
          kitchenName: kitchens.name,
          locationName: locations.name,
          chefName: users.username,
          chefEmail: users.username
        }).from(kitchenBookings).innerJoin(kitchens, eq20(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq20(kitchens.locationId, locations.id)).leftJoin(users, eq20(kitchenBookings.chefId, users.id)).where(
          and13(
            eq20(locations.managerId, managerId),
            eq20(kitchenBookings.paymentStatus, "paid"),
            sql7`DATE(${kitchenBookings.bookingDate}) >= ${periodStart.toISOString().split("T")[0]}::date`,
            sql7`DATE(${kitchenBookings.bookingDate}) <= ${payoutDate.toISOString().split("T")[0]}::date`
          )
        ).orderBy(desc10(kitchenBookings.bookingDate));
        const { getBalanceTransactions: getBalanceTransactions2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const transactions = await getBalanceTransactions2(
          accountId,
          periodStart,
          payoutDate,
          100
        );
        const { generatePayoutStatementPDF: generatePayoutStatementPDF2 } = await Promise.resolve().then(() => (init_payout_statement_service(), payout_statement_service_exports));
        const pdfBuffer = await generatePayoutStatementPDF2(
          managerId,
          manager.username || "Manager",
          manager.username || "",
          payout,
          transactions,
          bookingRows
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="payout-statement-${payoutId.substring(3)}.pdf"`);
        res.send(pdfBuffer);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/kitchens/:locationId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const locationId = parseInt(req.params.locationId);
        const location = await locationService.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ error: "Location not found" });
        }
        if (location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied to this location" });
        }
        const kitchens3 = await kitchenService.getKitchensByLocationId(locationId);
        res.json(kitchens3);
      } catch (error) {
        console.error("Error fetching kitchen settings:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchen settings" });
      }
    });
    router11.post("/kitchens", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { locationId, name, description, features, imageUrl } = req.body;
        const location = await locationService.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ error: "Location not found" });
        }
        if (location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied to this location" });
        }
        const created = await kitchenService.createKitchen({
          locationId,
          name,
          description,
          imageUrl,
          amenities: features || [],
          isActive: true,
          // Auto-activate
          hourlyRate: void 0,
          // Manager sets pricing later
          minimumBookingHours: 1,
          pricingModel: "hourly"
        });
        res.status(201).json(created);
      } catch (error) {
        console.error("Error creating kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to create kitchen" });
      }
    });
    router11.put("/kitchens/:kitchenId/image", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const { imageUrl } = req.body;
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        if (imageUrl && kitchen.imageUrl) {
          const { deleteFromR2: deleteFromR22 } = await Promise.resolve().then(() => (init_r2_storage(), r2_storage_exports));
          try {
            if (kitchen.imageUrl !== imageUrl) {
              await deleteFromR22(kitchen.imageUrl);
            }
          } catch (e) {
            console.error("Failed to delete old image:", e);
          }
        }
        const updated = await kitchenService.updateKitchenImage(kitchenId, imageUrl);
        res.json(updated);
      } catch (error) {
        console.error("Error updating kitchen image:", error);
        res.status(500).json({ error: error.message || "Failed to update kitchen image" });
      }
    });
    router11.put("/kitchens/:kitchenId/gallery", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const { method, imageUrl, index } = req.body;
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        let updatedImages = [...kitchen.galleryImages || []];
        const { deleteFromR2: deleteFromR22 } = await Promise.resolve().then(() => (init_r2_storage(), r2_storage_exports));
        if (method === "add") {
          if (imageUrl) updatedImages.push(imageUrl);
        } else if (method === "remove" && typeof index === "number") {
          if (index >= 0 && index < updatedImages.length) {
            const removedUrl = updatedImages[index];
            updatedImages.splice(index, 1);
            try {
              await deleteFromR22(removedUrl);
            } catch (e) {
              console.error("Failed to delete removed gallery image:", e);
            }
          }
        } else if (method === "reorder" && Array.isArray(imageUrl)) {
          updatedImages = imageUrl;
        }
        await kitchenService.updateKitchenGallery(kitchenId, updatedImages);
        const updated = await kitchenService.getKitchenById(kitchenId);
        res.json(updated);
      } catch (error) {
        console.error("Error updating gallery:", error);
        res.status(500).json({ error: error.message || "Failed to update gallery" });
      }
    });
    router11.put("/kitchens/:kitchenId/details", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const { name, description, features } = req.body;
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        const updated = await kitchenService.updateKitchen({
          id: kitchenId,
          name,
          description,
          amenities: features
        });
        res.json(updated);
      } catch (error) {
        console.error("Error updating kitchen details:", error);
        res.status(500).json({ error: error.message || "Failed to update kitchen details" });
      }
    });
    router11.delete("/kitchens/:kitchenId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        const imageUrl = kitchen.imageUrl;
        const galleryImages = kitchen.galleryImages || [];
        await kitchenService.deleteKitchen(kitchenId);
        const { deleteFromR2: deleteFromR22 } = await Promise.resolve().then(() => (init_r2_storage(), r2_storage_exports));
        if (imageUrl) {
          try {
            await deleteFromR22(imageUrl);
          } catch (e) {
            console.error(`Failed to delete kitchen image ${imageUrl}:`, e);
          }
        }
        if (galleryImages.length > 0) {
          await Promise.all(galleryImages.map(async (img) => {
            try {
              await deleteFromR22(img);
            } catch (e) {
              console.error(`Failed to delete gallery image ${img}:`, e);
            }
          }));
        }
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to delete kitchen" });
      }
    });
    router11.get("/kitchens/:kitchenId/pricing", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        res.json({
          hourlyRate: kitchen.hourlyRate,
          // In dollars if getKitchenById handled it, or cents? 
          // routes.ts typically converted it? 
          // Wait, updateKitchenPricing converts dollars to cents.
          // getKitchenById likely returns cents?
          // Let's check updateKitchenPricing in storage-firebase.ts if needed.
          // But for now, returning raw db value or whatever getKitchenById returns.
          // Typically frontend expects dollars if input was dollars?
          // routes.ts 4350 just sends `res.json(pricing)`.
          // Let's assume getKitchenById returns it as is.
          currency: kitchen.currency,
          minimumBookingHours: kitchen.minimumBookingHours,
          pricingModel: kitchen.pricingModel,
          taxRatePercent: kitchen.taxRatePercent !== void 0 && kitchen.taxRatePercent !== null ? Number(kitchen.taxRatePercent) : null
        });
      } catch (error) {
        console.error("Error getting kitchen pricing:", error);
        res.status(500).json({ error: error.message || "Failed to get kitchen pricing" });
      }
    });
    router11.put("/kitchens/:kitchenId/pricing", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        const { hourlyRate, currency, minimumBookingHours, pricingModel, taxRatePercent } = req.body;
        if (hourlyRate !== void 0 && hourlyRate !== null && (typeof hourlyRate !== "number" || hourlyRate < 0)) {
          return res.status(400).json({ error: "Hourly rate must be a positive number or null" });
        }
        if (currency !== void 0 && typeof currency !== "string") {
          return res.status(400).json({ error: "Currency must be a string" });
        }
        if (minimumBookingHours !== void 0 && (typeof minimumBookingHours !== "number" || minimumBookingHours < 1)) {
          return res.status(400).json({ error: "Minimum booking hours must be at least 1" });
        }
        if (pricingModel !== void 0 && !["hourly", "daily", "weekly"].includes(pricingModel)) {
          return res.status(400).json({ error: "Pricing model must be 'hourly', 'daily', or 'weekly'" });
        }
        const pricing = {};
        if (hourlyRate !== void 0) {
          pricing.hourlyRate = hourlyRate === null ? null : hourlyRate;
        }
        if (currency !== void 0) pricing.currency = currency;
        if (minimumBookingHours !== void 0) pricing.minimumBookingHours = minimumBookingHours;
        if (minimumBookingHours !== void 0) pricing.minimumBookingHours = minimumBookingHours;
        if (pricingModel !== void 0) pricing.pricingModel = pricingModel;
        if (taxRatePercent !== void 0) {
          pricing.taxRatePercent = taxRatePercent ? parseFloat(taxRatePercent) : null;
        }
        const updated = await kitchenService.updateKitchen({
          id: kitchenId,
          ...pricing
        });
        console.log(`\u2705 Kitchen ${kitchenId} pricing updated by manager ${user.id}`);
        res.json(updated);
      } catch (error) {
        console.error("Error updating kitchen pricing:", error);
        res.status(500).json({ error: error.message || "Failed to update kitchen pricing" });
      }
    });
    router11.put("/kitchens/:kitchenId/availability", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        const { isAvailable, reason } = req.body;
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
        if (isAvailable === false) {
        }
        const updated = await kitchenService.updateKitchen({ id: kitchenId, isActive: isAvailable });
        res.json(updated);
      } catch (error) {
        console.error("Error setting availability:", error);
        res.status(500).json({ error: error.message || "Failed to set availability" });
      }
    });
    router11.get("/bookings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const bookings = await bookingService.getBookingsByManager(user.id);
        res.json(bookings);
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: error.message || "Failed to fetch bookings" });
      }
    });
    router11.get("/profile", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const managerId = req.neonUser.id;
        const [user] = await db.select({
          managerProfileData: users.managerProfileData
        }).from(users).where(eq20(users.id, managerId)).limit(1);
        if (!user) {
          return res.status(404).json({ error: "Manager profile not found" });
        }
        const profile = user.managerProfileData || {};
        res.json({
          profileImageUrl: profile.profileImageUrl || null,
          phone: profile.phone || null,
          displayName: profile.displayName || null
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.put("/profile", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { username, displayName, phone, profileImageUrl } = req.body;
        const profileUpdates = {};
        if (displayName !== void 0) profileUpdates.displayName = displayName;
        if (phone !== void 0) {
          if (phone && phone.trim() !== "") {
            const normalized = normalizePhoneForStorage(phone);
            if (!normalized) return res.status(400).json({ error: "Invalid phone" });
            profileUpdates.phone = normalized;
          } else {
            profileUpdates.phone = null;
          }
        }
        if (profileImageUrl !== void 0) profileUpdates.profileImageUrl = profileImageUrl;
        if (username !== void 0 && username !== user.username) {
          const existingUser = await userService.getUserByUsername(username);
          if (existingUser && existingUser.id !== user.id) {
            return res.status(400).json({ error: "Username already exists" });
          }
          await userService.updateUser(user.id, { username });
        }
        if (Object.keys(profileUpdates).length > 0) {
          const [currentUser] = await db.select({ managerProfileData: users.managerProfileData }).from(users).where(eq20(users.id, user.id)).limit(1);
          const currentData = currentUser?.managerProfileData || {};
          const newData = { ...currentData, ...profileUpdates };
          await db.update(users).set({ managerProfileData: newData }).where(eq20(users.id, user.id));
        }
        const [updatedUser] = await db.select({ managerProfileData: users.managerProfileData }).from(users).where(eq20(users.id, user.id)).limit(1);
        const finalProfile = updatedUser?.managerProfileData || {};
        res.json({
          profileImageUrl: finalProfile.profileImageUrl || null,
          phone: finalProfile.phone || null,
          displayName: finalProfile.displayName || null
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.get("/chef-profiles", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const profiles = await chefService.getChefProfilesForManager(user.id);
        res.json(profiles);
      } catch (error) {
        res.status(500).json({ error: error.message || "Failed to get profiles" });
      }
    });
    router11.get("/portal-applications", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { users: users5 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
        const managedLocations = await db.select().from(locations).where(eq20(locations.managerId, user.id));
        if (managedLocations.length === 0) return res.json([]);
        const locationIds = managedLocations.map((loc) => loc.id);
        const applications3 = await db.select({
          application: portalUserApplications,
          location: locations,
          user: users5
        }).from(portalUserApplications).innerJoin(locations, eq20(portalUserApplications.locationId, locations.id)).innerJoin(users5, eq20(portalUserApplications.userId, users5.id)).where(inArray4(portalUserApplications.locationId, locationIds));
        const formatted = applications3.map((app2) => ({
          ...app2.application,
          location: { id: app2.location.id, name: app2.location.name, address: app2.location.address },
          user: { id: app2.user.id, username: app2.user.username },
          // fields mapped from joins
          id: app2.application.id
          // Ensure ID is correct
        }));
        const accessRecords = await db.select().from(portalUserLocationAccess).where(inArray4(portalUserLocationAccess.locationId, locationIds));
        res.json({ applications: formatted, accessCount: accessRecords.length });
      } catch (error) {
        console.error("Error getting apps:", error);
        res.status(500).json({ error: error.message });
      }
    });
    router11.put("/portal-applications/:id/status", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      res.status(501).json({ error: "Not fully implemented in refactor yet" });
    });
    router11.put("/chef-profiles/:id/status", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const profileId = parseInt(req.params.id);
        const { status, reviewFeedback } = req.body;
        if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid status" });
        const updated = await chefService.updateProfileStatus(
          profileId,
          status,
          user.id,
          reviewFeedback
        );
        if (status === "approved") {
        }
        res.json(updated);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.delete("/chef-location-access", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { chefId, locationId } = req.body;
        await chefService.revokeLocationAccess(chefId, locationId);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.get("/kitchens/:kitchenId/bookings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        const bookings = await bookingService.getBookingsByKitchen(kitchenId);
        res.json(bookings);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.get("/bookings/:id", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const id = parseInt(req.params.id);
        const booking = await bookingService.getBookingById(id);
        if (!booking) return res.status(404).json({ error: "Booking not found" });
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        if (!kitchen) return res.status(404).json({ error: "Kitchen not found" });
        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location || location.managerId !== user.id) return res.status(403).json({ error: "Access denied" });
        res.json({ ...booking, kitchen, location });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.put("/bookings/:id/status", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { status } = req.body;
        await bookingService.updateBookingStatus(id, status);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.get("/kitchens/:kitchenId/date-overrides", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate) : /* @__PURE__ */ new Date();
        const end = endDate ? new Date(endDate) : new Date((/* @__PURE__ */ new Date()).setFullYear((/* @__PURE__ */ new Date()).getFullYear() + 1));
        const overrides = await kitchenService.getKitchenDateOverrides(kitchenId, start, end);
        res.json(overrides);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.post("/kitchens/:kitchenId/date-overrides", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { specificDate, startTime, endTime, isAvailable, reason } = req.body;
        const parseDateString = (dateStr) => {
          const [year, month, day] = dateStr.split("-").map(Number);
          return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        };
        const parsedDate = parseDateString(specificDate);
        const override = await kitchenService.createKitchenDateOverride({
          kitchenId,
          specificDate: parsedDate,
          startTime,
          endTime,
          isAvailable: isAvailable !== void 0 ? isAvailable : false,
          reason
        });
        res.json(override);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.put("/date-overrides/:id", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { startTime, endTime, isAvailable, reason } = req.body;
        await kitchenService.updateKitchenDateOverride(id, {
          id,
          startTime,
          endTime,
          isAvailable,
          reason
        });
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.delete("/date-overrides/:id", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await kitchenService.deleteKitchenDateOverride(id);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router11.put("/locations/:locationId/cancellation-policy", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      console.log("[PUT] /api/manager/locations/:locationId/cancellation-policy hit", {
        locationId: req.params.locationId,
        body: req.body
      });
      try {
        const user = req.neonUser;
        const { locationId } = req.params;
        const locationIdNum = parseInt(locationId);
        if (isNaN(locationIdNum) || locationIdNum <= 0) {
          console.error("[PUT] Invalid locationId:", locationId);
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const { cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours, notificationEmail, notificationPhone, logoUrl, brandImageUrl, timezone, description, customOnboardingLink } = req.body;
        console.log("[PUT] Request body:", {
          cancellationPolicyHours,
          cancellationPolicyMessage,
          defaultDailyBookingLimit,
          minimumBookingWindowHours,
          notificationEmail,
          logoUrl,
          brandImageUrl,
          timezone,
          locationId: locationIdNum
        });
        if (cancellationPolicyHours !== void 0 && (typeof cancellationPolicyHours !== "number" || cancellationPolicyHours < 0)) {
          return res.status(400).json({ error: "Cancellation policy hours must be a non-negative number" });
        }
        if (defaultDailyBookingLimit !== void 0 && (typeof defaultDailyBookingLimit !== "number" || defaultDailyBookingLimit < 1 || defaultDailyBookingLimit > 24)) {
          return res.status(400).json({ error: "Daily booking limit must be between 1 and 24 hours" });
        }
        if (minimumBookingWindowHours !== void 0 && (typeof minimumBookingWindowHours !== "number" || minimumBookingWindowHours < 0 || minimumBookingWindowHours > 168)) {
          return res.status(400).json({ error: "Minimum booking window hours must be between 0 and 168 hours" });
        }
        const locationResults = await db.select().from(locations).where(and13(eq20(locations.id, locationIdNum), eq20(locations.managerId, user.id)));
        const location = locationResults[0];
        if (!location) {
          console.error("[PUT] Location not found or access denied:", {
            locationId: locationIdNum,
            managerId: user.id,
            userRole: user.role
          });
          return res.status(404).json({ error: "Location not found or access denied" });
        }
        console.log("[PUT] Location verified:", {
          locationId: location.id,
          locationName: location.name,
          managerId: location.managerId
        });
        const oldNotificationEmail = location.notificationEmail || location.notification_email || null;
        const updates = {
          updatedAt: /* @__PURE__ */ new Date()
        };
        if (cancellationPolicyHours !== void 0) {
          updates.cancellationPolicyHours = cancellationPolicyHours;
        }
        if (cancellationPolicyMessage !== void 0) {
          updates.cancellationPolicyMessage = cancellationPolicyMessage;
        }
        if (defaultDailyBookingLimit !== void 0) {
          updates.defaultDailyBookingLimit = defaultDailyBookingLimit;
        }
        if (minimumBookingWindowHours !== void 0) {
          updates.minimumBookingWindowHours = minimumBookingWindowHours;
        }
        if (notificationEmail !== void 0) {
          if (notificationEmail && notificationEmail.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
            return res.status(400).json({ error: "Invalid email format" });
          }
          updates.notificationEmail = notificationEmail && notificationEmail.trim() !== "" ? notificationEmail.trim() : null;
          console.log("[PUT] Setting notificationEmail:", {
            raw: notificationEmail,
            processed: updates.notificationEmail,
            oldEmail: oldNotificationEmail
          });
        }
        if (notificationPhone !== void 0) {
          if (notificationPhone && notificationPhone.trim() !== "") {
            const normalized = normalizePhoneForStorage(notificationPhone);
            if (!normalized) {
              return res.status(400).json({
                error: "Invalid phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
              });
            }
            updates.notificationPhone = normalized;
            console.log("[PUT] Setting notificationPhone:", {
              raw: notificationPhone,
              normalized
            });
          } else {
            updates.notificationPhone = null;
          }
        }
        if (logoUrl !== void 0) {
          const processedLogoUrl = logoUrl && logoUrl.trim() !== "" ? logoUrl.trim() : null;
          updates.logoUrl = processedLogoUrl;
          updates.logo_url = processedLogoUrl;
          console.log("[PUT] Setting logoUrl:", {
            raw: logoUrl,
            processed: processedLogoUrl,
            type: typeof processedLogoUrl,
            inUpdates: updates.logoUrl,
            alsoSetAsLogo_url: updates.logo_url
          });
        }
        if (brandImageUrl !== void 0) {
          const processedBrandImageUrl = brandImageUrl && brandImageUrl.trim() !== "" ? brandImageUrl.trim() : null;
          updates.brandImageUrl = processedBrandImageUrl;
          updates.brand_image_url = processedBrandImageUrl;
          console.log("[PUT] Setting brandImageUrl:", {
            raw: brandImageUrl,
            processed: processedBrandImageUrl
          });
        }
        if (timezone !== void 0) {
          updates.timezone = DEFAULT_TIMEZONE;
          console.log("[PUT] Setting timezone (locked to Newfoundland):", {
            raw: timezone,
            processed: DEFAULT_TIMEZONE,
            note: "Timezone is locked and cannot be changed"
          });
        }
        if (description !== void 0) {
          updates.description = description && description.trim() !== "" ? description.trim() : null;
          console.log("[PUT] Setting description:", {
            raw: description,
            processed: updates.description
          });
        }
        if (customOnboardingLink !== void 0) {
          updates.customOnboardingLink = customOnboardingLink && customOnboardingLink.trim() !== "" ? customOnboardingLink.trim() : null;
          console.log("[PUT] Setting customOnboardingLink:", {
            raw: customOnboardingLink,
            processed: updates.customOnboardingLink
          });
        }
        console.log("[PUT] Final updates object before DB update:", JSON.stringify(updates, null, 2));
        console.log("[PUT] Updates keys:", Object.keys(updates));
        console.log("[PUT] Updates object has logoUrl?", "logoUrl" in updates);
        console.log("[PUT] Updates object logoUrl value:", updates.logoUrl);
        console.log("[PUT] Updates object has logo_url?", "logo_url" in updates);
        console.log("[PUT] Updates object logo_url value:", updates.logo_url);
        const updatedResults = await db.update(locations).set(updates).where(eq20(locations.id, locationIdNum)).returning();
        console.log("[PUT] Updated location from DB (full object):", JSON.stringify(updatedResults[0], null, 2));
        console.log("[PUT] Updated location logoUrl (camelCase):", updatedResults[0].logoUrl);
        console.log("[PUT] Updated location logo_url (snake_case):", updatedResults[0].logo_url);
        console.log("[PUT] Updated location all keys:", Object.keys(updatedResults[0] || {}));
        if (!updatedResults || updatedResults.length === 0) {
          console.error("[PUT] Cancellation policy update failed: No location returned from DB", {
            locationId: locationIdNum,
            updates
          });
          return res.status(500).json({ error: "Failed to update location settings - no rows updated" });
        }
        const updated = updatedResults[0];
        console.log("[PUT] Location settings updated successfully:", {
          locationId: updated.id,
          cancellationPolicyHours: updated.cancellationPolicyHours,
          defaultDailyBookingLimit: updated.defaultDailyBookingLimit,
          defaultDailyBookingLimitRaw: updated.default_daily_booking_limit,
          notificationEmail: updated.notificationEmail || updated.notification_email || "not set",
          logoUrl: updated.logoUrl || updated.logo_url || "NOT SET"
        });
        if (defaultDailyBookingLimit !== void 0) {
          const savedValue = updated.defaultDailyBookingLimit ?? updated.default_daily_booking_limit;
          console.log("[PUT] \u2705 Verified defaultDailyBookingLimit save:", {
            requested: defaultDailyBookingLimit,
            saved: savedValue,
            match: savedValue === defaultDailyBookingLimit
          });
          if (savedValue !== defaultDailyBookingLimit) {
            console.error("[PUT] \u274C WARNING: defaultDailyBookingLimit mismatch!", {
              requested: defaultDailyBookingLimit,
              saved: savedValue
            });
          }
        }
        const response = {
          ...updated,
          logoUrl: updated.logoUrl || updated.logo_url || null,
          notificationEmail: updated.notificationEmail || updated.notification_email || null,
          notificationPhone: updated.notificationPhone || updated.notification_phone || null,
          cancellationPolicyHours: updated.cancellationPolicyHours || updated.cancellation_policy_hours,
          cancellationPolicyMessage: updated.cancellationPolicyMessage || updated.cancellation_policy_message,
          defaultDailyBookingLimit: updated.defaultDailyBookingLimit || updated.default_daily_booking_limit,
          minimumBookingWindowHours: updated.minimumBookingWindowHours || updated.minimum_booking_window_hours || 1,
          timezone: updated.timezone || DEFAULT_TIMEZONE,
          description: updated.description || null,
          customOnboardingLink: updated.customOnboardingLink || updated.custom_onboarding_link || null
        };
        if (notificationEmail !== void 0 && response.notificationEmail && response.notificationEmail !== oldNotificationEmail) {
          try {
            const emailContent = generateLocationEmailChangedEmail({
              email: response.notificationEmail,
              locationName: location.name || "Location",
              locationId: locationIdNum
            });
            await sendEmail(emailContent);
            console.log(`\u2705 Location notification email change notification sent to: ${response.notificationEmail}`);
          } catch (emailError) {
            console.error("Error sending location email change notification:", emailError);
          }
        }
        console.log("[PUT] Sending response with notificationEmail:", response.notificationEmail);
        res.status(200).json(response);
      } catch (error) {
        console.error("Error updating cancellation policy:", error);
        res.status(500).json({ error: error.message || "Failed to update cancellation policy" });
      }
    });
    router11.get("/locations", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        console.log("[GET] /api/manager/locations - Raw locations from DB:", locations4.map((loc) => ({
          id: loc.id,
          name: loc.name,
          logoUrl: loc.logoUrl,
          logo_url: loc.logo_url,
          allKeys: Object.keys(loc)
        })));
        const mappedLocations = locations4.map((loc) => ({
          ...loc,
          notificationEmail: loc.notificationEmail || loc.notification_email || null,
          notificationPhone: loc.notificationPhone || loc.notification_phone || null,
          cancellationPolicyHours: loc.cancellationPolicyHours || loc.cancellation_policy_hours,
          cancellationPolicyMessage: loc.cancellationPolicyMessage || loc.cancellation_policy_message,
          defaultDailyBookingLimit: loc.defaultDailyBookingLimit || loc.default_daily_booking_limit,
          minimumBookingWindowHours: loc.minimumBookingWindowHours || loc.minimum_booking_window_hours || 1,
          logoUrl: loc.logoUrl || loc.logo_url || null,
          timezone: loc.timezone || DEFAULT_TIMEZONE,
          description: loc.description || null,
          customOnboardingLink: loc.customOnboardingLink || loc.custom_onboarding_link || null,
          // Kitchen license status fields
          kitchenLicenseUrl: loc.kitchenLicenseUrl || loc.kitchen_license_url || null,
          kitchenLicenseStatus: loc.kitchenLicenseStatus || loc.kitchen_license_status || "pending",
          kitchenLicenseApprovedBy: loc.kitchenLicenseApprovedBy || loc.kitchen_license_approved_by || null,
          kitchenLicenseApprovedAt: loc.kitchenLicenseApprovedAt || loc.kitchen_license_approved_at || null,
          kitchenLicenseFeedback: loc.kitchenLicenseFeedback || loc.kitchen_license_feedback || null
        }));
        console.log(
          "[GET] /api/manager/locations - Mapped locations:",
          mappedLocations.map((loc) => ({
            id: loc.id,
            name: loc.name,
            logoUrl: loc.logoUrl,
            notificationEmail: loc.notificationEmail || "not set"
          }))
        );
        res.json(mappedLocations);
      } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: error.message || "Failed to fetch locations" });
      }
    });
    router11.post("/locations", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const {
          name,
          address,
          notificationEmail,
          notificationPhone,
          kitchenLicenseUrl,
          kitchenLicenseStatus,
          kitchenLicenseExpiry
        } = req.body;
        if (!name || !address) {
          return res.status(400).json({ error: "Name and address are required" });
        }
        let normalizedNotificationPhone = void 0;
        if (notificationPhone && notificationPhone.trim() !== "") {
          const normalized = normalizePhoneForStorage(notificationPhone);
          if (!normalized) {
            return res.status(400).json({
              error: "Invalid phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
            });
          }
          normalizedNotificationPhone = normalized;
        }
        console.log("Creating location for manager:", {
          managerId: user.id,
          name,
          address,
          notificationPhone: normalizedNotificationPhone,
          kitchenLicenseUrl: kitchenLicenseUrl ? "Provided" : "Not provided"
        });
        const location = await locationService.createLocation({
          name,
          address,
          managerId: user.id,
          notificationEmail: notificationEmail || void 0,
          notificationPhone: normalizedNotificationPhone,
          kitchenLicenseUrl: kitchenLicenseUrl || void 0,
          kitchenLicenseStatus: kitchenLicenseStatus || "pending",
          kitchenLicenseExpiry: kitchenLicenseExpiry || void 0
        });
        const mappedLocation = {
          ...location,
          managerId: location.managerId || location.manager_id || null,
          notificationEmail: location.notificationEmail || location.notification_email || null,
          notificationPhone: location.notificationPhone || location.notification_phone || null,
          cancellationPolicyHours: location.cancellationPolicyHours || location.cancellation_policy_hours || 24,
          cancellationPolicyMessage: location.cancellationPolicyMessage || location.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
          defaultDailyBookingLimit: location.defaultDailyBookingLimit || location.default_daily_booking_limit || 2,
          createdAt: location.createdAt || location.created_at,
          updatedAt: location.updatedAt || location.updated_at
        };
        res.status(201).json(mappedLocation);
      } catch (error) {
        console.error("Error creating location:", error);
        console.error("Error details:", error.message, error.stack);
        res.status(500).json({ error: error.message || "Failed to create location" });
      }
    });
    router11.put("/locations/:locationId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId) || locationId <= 0) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this location" });
        }
        const {
          name,
          address,
          notificationEmail,
          notificationPhone,
          kitchenLicenseUrl,
          kitchenLicenseStatus,
          kitchenLicenseExpiry
        } = req.body;
        const updates = {};
        if (name !== void 0) updates.name = name;
        if (address !== void 0) updates.address = address;
        if (notificationEmail !== void 0) updates.notificationEmail = notificationEmail || null;
        if (notificationPhone !== void 0) {
          if (notificationPhone && notificationPhone.trim() !== "") {
            const normalized = normalizePhoneForStorage(notificationPhone);
            if (!normalized) {
              return res.status(400).json({
                error: "Invalid phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
              });
            }
            updates.notificationPhone = normalized;
          } else {
            updates.notificationPhone = null;
          }
        }
        if (kitchenLicenseUrl !== void 0) {
          updates.kitchenLicenseUrl = kitchenLicenseUrl || null;
          if (kitchenLicenseUrl) {
            updates.kitchenLicenseUploadedAt = /* @__PURE__ */ new Date();
            if (kitchenLicenseStatus === void 0) {
              updates.kitchenLicenseStatus = "pending";
            }
          }
        }
        if (kitchenLicenseStatus !== void 0) {
          if (kitchenLicenseStatus && !["pending", "approved", "rejected"].includes(kitchenLicenseStatus)) {
            return res.status(400).json({
              error: "Invalid kitchenLicenseStatus. Must be 'pending', 'approved', or 'rejected'"
            });
          }
          updates.kitchenLicenseStatus = kitchenLicenseStatus || null;
        }
        if (kitchenLicenseExpiry !== void 0) {
          updates.kitchenLicenseExpiry = kitchenLicenseExpiry || null;
        }
        console.log(`\u{1F4BE} Updating location ${locationId} with:`, updates);
        const updated = await locationService.updateLocation({ id: locationId, ...updates });
        if (!updated) {
          console.error(`\u274C Location ${locationId} not found in database`);
          return res.status(404).json({ error: "Location not found" });
        }
        console.log(`\u2705 Location ${locationId} updated successfully`);
        const mappedLocation = {
          ...updated,
          managerId: updated.managerId || updated.manager_id || null,
          notificationEmail: updated.notificationEmail || updated.notification_email || null,
          notificationPhone: updated.notificationPhone || updated.notification_phone || null,
          cancellationPolicyHours: updated.cancellationPolicyHours || updated.cancellation_policy_hours || 24,
          cancellationPolicyMessage: updated.cancellationPolicyMessage || updated.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
          defaultDailyBookingLimit: updated.defaultDailyBookingLimit || updated.default_daily_booking_limit || 2,
          createdAt: updated.createdAt || updated.created_at,
          updatedAt: updated.updatedAt || updated.updated_at
        };
        return res.json(mappedLocation);
      } catch (error) {
        console.error("\u274C Error updating location:", error);
        console.error("Error stack:", error.stack);
        res.status(500).json({ error: error.message || "Failed to update location" });
      }
    });
    router11.post("/complete-onboarding", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { skipped } = req.body;
        console.log(`[POST] /api/manager/complete-onboarding - User: ${user.id}, skipped: ${skipped}`);
        const updatedUser = await managerService.updateOnboarding(user.id, {
          completed: true,
          skipped: !!skipped
        });
        if (!updatedUser) {
          return res.status(500).json({ error: "Failed to update onboarding status" });
        }
        res.json({ success: true, user: updatedUser });
      } catch (error) {
        console.error("Error completing manager onboarding:", error);
        res.status(500).json({ error: error.message || "Failed to complete onboarding" });
      }
    });
    router11.post("/onboarding/step", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { stepId, locationId } = req.body;
        if (stepId === void 0) {
          return res.status(400).json({ error: "stepId is required" });
        }
        console.log(`[POST] /api/manager/onboarding/step - User: ${user.id}, stepId: ${stepId}, locationId: ${locationId}`);
        const currentSteps = user.managerOnboardingStepsCompleted || {};
        const stepKey = locationId ? `${stepId}_location_${locationId}` : `${stepId}`;
        const newSteps = {
          ...currentSteps,
          [stepKey]: true
        };
        const updatedUser = await managerService.updateOnboarding(user.id, {
          steps: newSteps
        });
        if (!updatedUser) {
          return res.status(500).json({ error: "Failed to update onboarding step" });
        }
        res.json({
          success: true,
          stepsCompleted: updatedUser.managerOnboardingStepsCompleted
        });
      } catch (error) {
        console.error("Error tracking onboarding step:", error);
        res.status(500).json({ error: error.message || "Failed to track onboarding step" });
      }
    });
    router11.get("/availability/:kitchenId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const managerLocations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = managerLocations.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        const availability = await kitchenService.getKitchenAvailability(kitchenId);
        res.json(availability);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router11.post("/availability", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { kitchenId, dayOfWeek, startTime, endTime, isAvailable } = req.body;
        if (!kitchenId || dayOfWeek === void 0 || dayOfWeek < 0 || dayOfWeek > 6) {
          return res.status(400).json({ error: "kitchenId and valid dayOfWeek (0-6) are required" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const managerLocations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = managerLocations.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        const { kitchenAvailability: kitchenAvailability2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
        const [existing] = await db.select().from(kitchenAvailability2).where(
          and13(
            eq20(kitchenAvailability2.kitchenId, kitchenId),
            eq20(kitchenAvailability2.dayOfWeek, dayOfWeek)
          )
        ).limit(1);
        let result;
        if (existing) {
          [result] = await db.update(kitchenAvailability2).set({
            startTime: startTime || "00:00",
            endTime: endTime || "00:00",
            isAvailable: isAvailable ?? false
          }).where(eq20(kitchenAvailability2.id, existing.id)).returning();
        } else {
          [result] = await db.insert(kitchenAvailability2).values({
            kitchenId,
            dayOfWeek,
            startTime: startTime || "00:00",
            endTime: endTime || "00:00",
            isAvailable: isAvailable ?? false
          }).returning();
        }
        res.json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    manager_default = router11;
  }
});

// server/routes/middleware.ts
import { eq as eq21, desc as desc11 } from "drizzle-orm";
async function getAuthenticatedUser(req) {
  if (req.neonUser) {
    return {
      id: req.neonUser.id,
      username: req.neonUser.username,
      role: req.neonUser.role || ""
    };
  }
  return null;
}
async function requireChef(req, res, next) {
  if (!req.neonUser) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const hasChefAccess = req.neonUser.isChef === true || // isChef flag is true
  req.neonUser.role === "chef" || // role is 'chef'
  req.neonUser.role === "admin";
  if (!hasChefAccess) {
    console.log(`[requireChef] Access denied for user ${req.neonUser.id}:`, {
      role: req.neonUser.role,
      isChef: req.neonUser.isChef
    });
    return res.status(403).json({ error: "Access denied. Chef role required." });
  }
  next();
}
async function requirePortalUser(req, res, next) {
  try {
    const user = req.neonUser;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const accessRecords = await db.select().from(portalUserLocationAccess).where(eq21(portalUserLocationAccess.portalUserId, user.id)).limit(1);
    if (accessRecords.length > 0) {
      return next();
    }
    const applications3 = await db.select().from(portalUserApplications).where(eq21(portalUserApplications.userId, user.id)).orderBy(desc11(portalUserApplications.createdAt)).limit(1);
    if (applications3.length > 0) {
      const app2 = applications3[0];
      if (app2.status === "approved") {
        return next();
      }
      return res.status(403).json({
        error: "Access denied. Your application is pending approval.",
        status: app2.status,
        applicationId: app2.id,
        awaitingApproval: app2.status === "inReview"
      });
    }
    return res.status(403).json({
      error: "Access denied. You must submit a portal application first.",
      status: "no_application"
    });
  } catch (error) {
    console.error("Error in requirePortalUser middleware:", error);
    return res.status(401).json({ error: "Authentication failed" });
  }
}
var init_middleware = __esm({
  "server/routes/middleware.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/routes/kitchens.ts
var kitchens_exports = {};
__export(kitchens_exports, {
  default: () => kitchens_default
});
import { Router as Router12 } from "express";
import { eq as eq22, inArray as inArray5, desc as desc12, and as and14 } from "drizzle-orm";
var router12, kitchens_default;
var init_kitchens = __esm({
  "server/routes/kitchens.ts"() {
    "use strict";
    init_db();
    init_middleware();
    init_utils();
    init_schema();
    init_email();
    init_kitchen_service();
    init_location_service();
    init_chef_service();
    init_booking_service();
    init_user_service();
    router12 = Router12();
    router12.get("/chef/kitchens", requireChef, async (req, res) => {
      try {
        const allKitchens = await kitchenService.getAllKitchensWithLocation();
        const activeKitchens = allKitchens.filter((kitchen) => kitchen.isActive);
        const normalizedKitchens = activeKitchens.map((kitchen) => {
          const normalizedImageUrl = normalizeImageUrl(kitchen.imageUrl || null, req);
          const normalizedGalleryImages = (kitchen.galleryImages || []).map(
            (img) => normalizeImageUrl(img, req)
          ).filter((url) => url !== null);
          const locationBrandImageUrl = kitchen.location?.brandImageUrl || null;
          const locationLogoUrl = kitchen.location?.logoUrl || null;
          const normalizedLocationBrandImageUrl = normalizeImageUrl(locationBrandImageUrl, req);
          const normalizedLocationLogoUrl = normalizeImageUrl(locationLogoUrl, req);
          return {
            ...kitchen,
            imageUrl: normalizedImageUrl,
            image_url: normalizedImageUrl,
            // Also set snake_case for compatibility
            galleryImages: normalizedGalleryImages,
            gallery_images: normalizedGalleryImages,
            // Also set snake_case for compatibility
            locationBrandImageUrl: normalizedLocationBrandImageUrl,
            location_brand_image_url: normalizedLocationBrandImageUrl,
            // Also set snake_case for compatibility
            locationLogoUrl: normalizedLocationLogoUrl,
            location_logo_url: normalizedLocationLogoUrl
            // Also set snake_case for compatibility
          };
        });
        console.log(`[API] /api/chef/kitchens - Returning ${normalizedKitchens.length} active kitchens (all locations for marketing)`);
        res.json(normalizedKitchens);
      } catch (error) {
        console.error("Error fetching kitchens:", error);
        res.status(500).json({ error: "Failed to fetch kitchens", details: error.message });
      }
    });
    router12.get("/chef/kitchens/:kitchenId/pricing", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        const pricing = {
          hourlyRate: kitchen.hourlyRate,
          currency: kitchen.currency,
          pricingModel: kitchen.pricingModel,
          minimumBookingHours: kitchen.minimumBookingHours
        };
        res.json(pricing);
      } catch (error) {
        if (error.statusCode === 404) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        console.error("Error getting kitchen pricing:", error);
        res.status(500).json({ error: error.message || "Failed to get kitchen pricing" });
      }
    });
    router12.get("/chef/kitchens/:kitchenId/policy", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        const locationId = kitchen.locationId;
        if (!locationId) {
          return res.status(404).json({ error: "Location not found for this kitchen" });
        }
        const location = await locationService.getLocationById(locationId);
        const maxSlotsPerChef = location.defaultDailyBookingLimit ?? 2;
        res.json({ maxSlotsPerChef });
      } catch (error) {
        if (error.statusCode === 404) {
          return res.status(404).json({ error: error.message });
        }
        console.error("Error getting kitchen policy:", error);
        res.status(500).json({ error: error.message || "Failed to get kitchen policy" });
      }
    });
    router12.post("/chef/share-profile", requireChef, async (req, res) => {
      try {
        const { locationId } = req.body;
        const chefId = req.user.id;
        if (!locationId) {
          return res.status(400).json({ error: "locationId is required" });
        }
        const hasLocationAccess = await chefService.hasLocationAccess(chefId, locationId);
        if (!hasLocationAccess) {
          return res.status(403).json({ error: "You don't have access to this location. Please contact an administrator." });
        }
        const chef = await userService.getUser(chefId);
        if (!chef) {
          return res.status(404).json({ error: "Chef not found" });
        }
        const location = await locationService.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ error: "Location not found" });
        }
        const chefApp = await db.select().from(applications).where(and14(
          eq22(applications.userId, chefId),
          eq22(applications.status, "approved")
        )).orderBy(desc12(applications.createdAt)).limit(1);
        const profile = await chefService.shareProfileWithLocation(chefId, locationId);
        if (profile && profile.status === "pending") {
          try {
            const managerEmail = location.notificationEmail || location.notification_email;
            if (managerEmail) {
              const chefName = chefApp.length > 0 && chefApp[0].fullName ? chefApp[0].fullName : chef.username || "Chef";
              const chefEmail = chefApp.length > 0 && chefApp[0].email ? chefApp[0].email : chef.email || chef.username || "chef@example.com";
              const emailContent = generateChefProfileRequestEmail({
                managerEmail,
                chefName,
                chefEmail,
                locationName: location.name || "Location",
                locationId
              });
              await sendEmail(emailContent);
              console.log(`\u2705 Chef profile request notification sent to manager: ${managerEmail}`);
            }
          } catch (emailError) {
            console.error("Error sending chef profile request notification:", emailError);
          }
        }
        res.status(201).json(profile);
      } catch (error) {
        console.error("Error sharing chef profile:", error);
        res.status(500).json({ error: error.message || "Failed to share profile" });
      }
    });
    router12.get("/chef/profiles", requireChef, async (req, res) => {
      try {
        const chefId = req.neonUser.id;
        const locationAccessRecords = await db.select().from(chefLocationAccess).where(eq22(chefLocationAccess.chefId, chefId));
        const locationIds = locationAccessRecords.map((access) => access.locationId);
        if (locationIds.length === 0) {
          return res.json([]);
        }
        const allLocations = await db.select().from(locations).where(inArray5(locations.id, locationIds));
        const profiles = await Promise.all(
          locationIds.map(async (locationId) => {
            const profile = await chefService.getProfile(chefId, locationId);
            const location = allLocations.find((l) => l.id === locationId);
            return { locationId, location, profile };
          })
        );
        res.json(profiles);
      } catch (error) {
        console.error("Error getting chef profiles:", error);
        res.status(500).json({ error: error.message || "Failed to get profiles" });
      }
    });
    router12.get("/chef/kitchens/:kitchenId/slots", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { date: date2 } = req.query;
        if (!date2) {
          return res.status(400).json({ error: "Date parameter is required" });
        }
        const [year, month, day] = date2.split("-").map(Number);
        const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        if (isNaN(bookingDate.getTime())) {
          return res.status(400).json({ error: "Invalid date format" });
        }
        const slotsInfo = await bookingService.getAllTimeSlotsWithBookingInfo(kitchenId, bookingDate);
        res.json(slotsInfo);
      } catch (error) {
        console.error("Error fetching time slots:", error);
        res.status(500).json({
          error: "Failed to fetch time slots",
          message: error.message
        });
      }
    });
    router12.get("/chef/kitchens/:kitchenId/availability", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { date: date2 } = req.query;
        if (!date2) {
          return res.status(400).json({ error: "Date parameter is required" });
        }
        const [year, month, day] = date2.split("-").map(Number);
        const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        if (isNaN(bookingDate.getTime())) {
          return res.status(400).json({ error: "Invalid date format" });
        }
        console.log(`\u{1F50D} Fetching available slots for kitchen ${kitchenId} on ${date2}`);
        const slots = await bookingService.getAvailableTimeSlots(kitchenId, bookingDate);
        console.log(`\u2705 Returning ${slots.length} available slots`);
        res.json(slots);
      } catch (error) {
        console.error("Error fetching available slots:", error);
        res.status(500).json({
          error: "Failed to fetch available slots",
          message: error.message
        });
      }
    });
    kitchens_default = router12;
  }
});

// server/services/stripe-service.ts
var stripe_service_exports = {};
__export(stripe_service_exports, {
  cancelPaymentIntent: () => cancelPaymentIntent,
  capturePaymentIntent: () => capturePaymentIntent,
  confirmPaymentIntent: () => confirmPaymentIntent,
  createPaymentIntent: () => createPaymentIntent,
  createRefund: () => createRefund,
  getPaymentIntent: () => getPaymentIntent,
  getStripePaymentAmounts: () => getStripePaymentAmounts,
  verifyPaymentIntentForBooking: () => verifyPaymentIntentForBooking
});
import Stripe2 from "stripe";
async function createPaymentIntent(params) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  const {
    amount,
    currency = "cad",
    chefId,
    kitchenId,
    metadata = {},
    statementDescriptor = "LOCALCOOKS",
    managerConnectAccountId,
    applicationFeeAmount,
    enableACSS = true,
    // Default to true for ACSS debit support
    enableCards = true,
    // Default to true for standard card payments
    useAuthorizationHold = true,
    // DEPRECATED: No longer used - always uses automatic capture
    saveCardForFuture = true,
    // Default to true to save cards for future use
    customerId
  } = params;
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than 0");
  }
  const hasApplicationFee = applicationFeeAmount !== void 0 && applicationFeeAmount !== null;
  if (hasApplicationFee && !managerConnectAccountId) {
    throw new Error("managerConnectAccountId is required when applicationFeeAmount is provided");
  }
  if (managerConnectAccountId && !hasApplicationFee) {
  }
  if (hasApplicationFee && applicationFeeAmount < 0) {
    throw new Error("Application fee must be 0 or a positive amount");
  }
  if (hasApplicationFee && applicationFeeAmount >= amount) {
    throw new Error("Application fee must be less than total amount");
  }
  if (!enableACSS && !enableCards) {
    throw new Error("At least one payment method must be enabled");
  }
  const cleanDescriptor = statementDescriptor.replace(/[<>'"]/g, "").substring(0, 15).toUpperCase();
  try {
    const paymentMethodTypes = [];
    if (enableCards) {
      paymentMethodTypes.push("card");
    }
    if (enableACSS) {
      paymentMethodTypes.push("acss_debit");
    }
    const paymentIntentParams = {
      amount,
      currency,
      payment_method_types: paymentMethodTypes,
      // Don't auto-confirm - we'll confirm after collecting payment method
      confirm: false,
      // Use automatic capture: payments are immediately processed when confirmed
      capture_method: "automatic",
      metadata: {
        booking_type: "kitchen",
        kitchen_id: kitchenId.toString(),
        chef_id: chefId.toString(),
        expected_amount: amount.toString(),
        // Store expected amount for verification
        ...metadata
      }
    };
    if (enableCards) {
      paymentIntentParams.statement_descriptor_suffix = cleanDescriptor.substring(0, 22);
    } else if (enableACSS) {
      paymentIntentParams.statement_descriptor = cleanDescriptor;
    }
    paymentIntentParams.payment_method_options = {};
    if (enableACSS) {
      paymentIntentParams.payment_method_options.acss_debit = {
        mandate_options: {
          payment_schedule: "combined",
          // Creates a mandate for future debits
          transaction_type: "personal",
          // Default to personal, can be made configurable
          interval_description: "Payment for kitchen booking and future bookings as authorized"
          // Required for 'combined' or 'interval' payment schedules
        }
      };
    }
    if (saveCardForFuture && enableCards) {
      paymentIntentParams.setup_future_usage = "off_session";
    }
    if (customerId) {
      paymentIntentParams.customer = customerId;
    }
    if (managerConnectAccountId) {
      paymentIntentParams.transfer_data = {
        destination: managerConnectAccountId
      };
      paymentIntentParams.metadata.manager_connect_account_id = managerConnectAccountId;
      if (hasApplicationFee) {
        paymentIntentParams.application_fee_amount = applicationFeeAmount;
        paymentIntentParams.metadata.platform_fee = applicationFeeAmount.toString();
      }
    }
    const paymentIntent = await stripe2.paymentIntents.create(paymentIntentParams);
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      amount: paymentIntent.amount
    };
  } catch (error) {
    console.error("Error creating PaymentIntent:", error);
    throw new Error(`Failed to create payment intent: ${error.message}`);
  }
}
async function confirmPaymentIntent(paymentIntentId, paymentMethodId) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const paymentIntent = await stripe2.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId
    });
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || "",
      status: paymentIntent.status,
      amount: paymentIntent.amount
    };
  } catch (error) {
    console.error("Error confirming PaymentIntent:", error);
    throw new Error(`Failed to confirm payment intent: ${error.message}`);
  }
}
async function getPaymentIntent(paymentIntentId) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const paymentIntent = await stripe2.paymentIntents.retrieve(paymentIntentId);
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || "",
      status: paymentIntent.status,
      amount: paymentIntent.amount
    };
  } catch (error) {
    if (error.code === "resource_missing") {
      return null;
    }
    console.error("Error retrieving PaymentIntent:", error);
    throw new Error(`Failed to retrieve payment intent: ${error.message}`);
  }
}
async function getStripePaymentAmounts(paymentIntentId, managerConnectAccountId) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const paymentIntent = await stripe2.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"]
    });
    if (!paymentIntent.latest_charge) {
      console.warn(`[Stripe] No charge found for PaymentIntent ${paymentIntentId}`);
      return null;
    }
    const chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id;
    const charge = typeof paymentIntent.latest_charge === "string" ? await stripe2.charges.retrieve(paymentIntent.latest_charge) : paymentIntent.latest_charge;
    let balanceTransaction = null;
    if (charge.balance_transaction) {
      const balanceTransactionId = typeof charge.balance_transaction === "string" ? charge.balance_transaction : charge.balance_transaction.id;
      balanceTransaction = await stripe2.balanceTransactions.retrieve(balanceTransactionId);
    }
    const stripeAmount = paymentIntent.amount;
    let stripeNetAmount = stripeAmount;
    let stripeProcessingFee = 0;
    let stripePlatformFee = 0;
    if (balanceTransaction) {
      stripeNetAmount = balanceTransaction.net;
      if (managerConnectAccountId && paymentIntent.application_fee_amount) {
        stripePlatformFee = paymentIntent.application_fee_amount;
        stripeProcessingFee = stripeAmount - stripePlatformFee - stripeNetAmount;
      } else {
        stripeProcessingFee = balanceTransaction.fee;
        stripeNetAmount = stripeAmount - stripeProcessingFee;
      }
    } else {
      stripeProcessingFee = Math.round(stripeAmount * 0.029 + 30);
      if (managerConnectAccountId && paymentIntent.application_fee_amount) {
        stripePlatformFee = paymentIntent.application_fee_amount;
        stripeNetAmount = stripeAmount - stripePlatformFee - stripeProcessingFee;
      } else {
        stripeNetAmount = stripeAmount - stripeProcessingFee;
      }
    }
    return {
      stripeAmount,
      stripeNetAmount,
      stripeProcessingFee,
      stripePlatformFee,
      chargeId
    };
  } catch (error) {
    console.error(`[Stripe] Error fetching payment amounts for ${paymentIntentId}:`, error);
    return null;
  }
}
async function capturePaymentIntent(paymentIntentId, amountToCapture) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const captureParams = {};
    if (amountToCapture !== void 0) {
      captureParams.amount_to_capture = amountToCapture;
    }
    const paymentIntent = await stripe2.paymentIntents.capture(paymentIntentId, captureParams);
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || "",
      status: paymentIntent.status,
      amount: paymentIntent.amount
    };
  } catch (error) {
    console.error("Error capturing PaymentIntent:", error);
    throw new Error(`Failed to capture payment intent: ${error.message}`);
  }
}
async function cancelPaymentIntent(paymentIntentId) {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const paymentIntent = await stripe2.paymentIntents.cancel(paymentIntentId);
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || "",
      status: paymentIntent.status,
      amount: paymentIntent.amount
    };
  } catch (error) {
    console.error("Error canceling PaymentIntent:", error);
    throw new Error(`Failed to cancel payment intent: ${error.message}`);
  }
}
async function createRefund(paymentIntentId, amount, reason = "requested_by_customer") {
  if (!stripe2) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  try {
    const paymentIntent = await stripe2.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent.latest_charge) {
      throw new Error("Payment intent has no charge to refund");
    }
    const chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id;
    const refundParams = {
      charge: chargeId,
      reason
    };
    if (amount !== void 0 && amount > 0) {
      refundParams.amount = amount;
    }
    const refund = await stripe2.refunds.create(refundParams);
    if (!refund.charge || typeof refund.charge !== "string") {
      throw new Error("Refund created but charge ID is missing");
    }
    if (!refund.status || typeof refund.status !== "string") {
      throw new Error("Refund created but status is missing");
    }
    const refundChargeId = refund.charge;
    const refundStatus = refund.status;
    return {
      id: refund.id,
      amount: refund.amount,
      status: refundStatus,
      charge: refundChargeId
    };
  } catch (error) {
    console.error("Error creating refund:", error);
    throw new Error(`Failed to create refund: ${error.message}`);
  }
}
async function verifyPaymentIntentForBooking(paymentIntentId, chefId, expectedAmount) {
  try {
    if (!stripe2) {
      return { valid: false, status: "error", error: "Stripe is not configured" };
    }
    const paymentIntent = await stripe2.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent) {
      return { valid: false, status: "not_found", error: "Payment intent not found" };
    }
    if (paymentIntent.metadata?.chef_id !== chefId.toString()) {
      return { valid: false, status: paymentIntent.status, error: "Payment intent does not belong to this chef" };
    }
    const storedExpectedAmount = paymentIntent.metadata?.expected_amount ? parseInt(paymentIntent.metadata.expected_amount) : null;
    const amountToCompare = storedExpectedAmount !== null ? storedExpectedAmount : expectedAmount;
    const amountDifference = Math.abs(paymentIntent.amount - amountToCompare);
    if (amountDifference > 5) {
      console.error("Payment amount mismatch:", {
        paymentIntentAmount: paymentIntent.amount,
        expectedAmount: amountToCompare,
        storedExpectedAmount,
        calculatedExpectedAmount: expectedAmount,
        difference: amountDifference,
        differenceDollars: (amountDifference / 100).toFixed(2)
      });
      return { valid: false, status: paymentIntent.status, error: "Payment amount does not match booking amount" };
    }
    const validStatuses = ["succeeded", "processing"];
    if (!validStatuses.includes(paymentIntent.status)) {
      return {
        valid: false,
        status: paymentIntent.status,
        error: `Payment is not in a valid state: ${paymentIntent.status}`
      };
    }
    return { valid: true, status: paymentIntent.status };
  } catch (error) {
    console.error("Error verifying PaymentIntent:", error);
    if (error.code === "resource_missing") {
      return { valid: false, status: "not_found", error: "Payment intent not found" };
    }
    return { valid: false, status: "error", error: error.message };
  }
}
var stripeSecretKey2, stripe2;
var init_stripe_service = __esm({
  "server/services/stripe-service.ts"() {
    "use strict";
    stripeSecretKey2 = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey2) {
      console.warn("\u26A0\uFE0F STRIPE_SECRET_KEY not found in environment variables");
    }
    stripe2 = stripeSecretKey2 ? new Stripe2(stripeSecretKey2, {
      apiVersion: "2025-12-15.clover"
    }) : null;
  }
});

// server/domains/inventory/inventory.repository.ts
import { eq as eq23 } from "drizzle-orm";
var InventoryRepository;
var init_inventory_repository = __esm({
  "server/domains/inventory/inventory.repository.ts"() {
    "use strict";
    init_db();
    init_schema();
    InventoryRepository = class {
      // ===== STORAGE =====
      /**
       * Helper to map DB result to DTO with proper numeric type conversions.
       * Postgres numeric columns are returned as strings by node-postgres.
       */
      mapStorageToDTO(row) {
        return {
          ...row,
          // Convert numeric string fields to numbers for frontend compatibility
          basePrice: row.basePrice ? parseFloat(row.basePrice) : null,
          pricePerCubicFoot: row.pricePerCubicFoot ? parseFloat(row.pricePerCubicFoot) : null,
          dimensionsLength: row.dimensionsLength ? parseFloat(row.dimensionsLength) : null,
          dimensionsWidth: row.dimensionsWidth ? parseFloat(row.dimensionsWidth) : null,
          dimensionsHeight: row.dimensionsHeight ? parseFloat(row.dimensionsHeight) : null,
          totalVolume: row.totalVolume ? parseFloat(row.totalVolume) : null,
          basePricePerSqft: row.basePricePerSqft ? parseFloat(row.basePricePerSqft) : null,
          squareFeet: row.squareFeet ? parseFloat(row.squareFeet) : null,
          availableSquareFeet: row.availableSquareFeet ? parseFloat(row.availableSquareFeet) : null,
          bookedSquareFeet: row.bookedSquareFeet ? parseFloat(row.bookedSquareFeet) : null
        };
      }
      async createStorageListing(data) {
        const [listing] = await db.insert(storageListings).values(data).returning();
        return this.mapStorageToDTO(listing);
      }
      async getStorageListingsByKitchenId(kitchenId) {
        const rows = await db.select().from(storageListings).where(eq23(storageListings.kitchenId, kitchenId));
        return rows.map((row) => this.mapStorageToDTO(row));
      }
      async getStorageListingById(id) {
        const [listing] = await db.select().from(storageListings).where(eq23(storageListings.id, id));
        return listing ? this.mapStorageToDTO(listing) : null;
      }
      async updateStorageListing(id, updates) {
        const { id: _id, createdAt, updatedAt, approvedAt, ...safeUpdates } = updates;
        const [updated] = await db.update(storageListings).set({
          ...safeUpdates,
          updatedAt: /* @__PURE__ */ new Date()
          // Always use fresh Date
        }).where(eq23(storageListings.id, id)).returning();
        return updated ? this.mapStorageToDTO(updated) : null;
      }
      async deleteStorageListing(id) {
        return db.delete(storageListings).where(eq23(storageListings.id, id));
      }
      // ===== EQUIPMENT =====
      /**
       * Helper to map DB result to DTO with proper numeric type conversions.
       * Postgres numeric columns are returned as strings by node-postgres.
       */
      mapEquipmentToDTO(row) {
        return {
          ...row,
          // Convert numeric string fields to numbers for frontend compatibility
          sessionRate: row.sessionRate ? parseFloat(row.sessionRate) : 0,
          damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : 0,
          hourlyRate: row.hourlyRate ? parseFloat(row.hourlyRate) : null,
          dailyRate: row.dailyRate ? parseFloat(row.dailyRate) : null,
          weeklyRate: row.weeklyRate ? parseFloat(row.weeklyRate) : null,
          monthlyRate: row.monthlyRate ? parseFloat(row.monthlyRate) : null
        };
      }
      async createEquipmentListing(data) {
        const [listing] = await db.insert(equipmentListings).values(data).returning();
        return this.mapEquipmentToDTO(listing);
      }
      async getEquipmentListingsByKitchenId(kitchenId) {
        const rows = await db.select().from(equipmentListings).where(eq23(equipmentListings.kitchenId, kitchenId));
        return rows.map((row) => this.mapEquipmentToDTO(row));
      }
      async getEquipmentListingById(id) {
        const [listing] = await db.select().from(equipmentListings).where(eq23(equipmentListings.id, id));
        return listing ? this.mapEquipmentToDTO(listing) : null;
      }
      async updateEquipmentListing(id, updates) {
        const { id: _id, createdAt, updatedAt, approvedAt, ...safeUpdates } = updates;
        const [updated] = await db.update(equipmentListings).set({
          ...safeUpdates,
          updatedAt: /* @__PURE__ */ new Date()
          // Always use fresh Date
        }).where(eq23(equipmentListings.id, id)).returning();
        return updated ? this.mapEquipmentToDTO(updated) : null;
      }
      async deleteEquipmentListing(id) {
        return db.delete(equipmentListings).where(eq23(equipmentListings.id, id));
      }
    };
  }
});

// server/domains/inventory/inventory.service.ts
var InventoryService, inventoryService;
var init_inventory_service = __esm({
  "server/domains/inventory/inventory.service.ts"() {
    "use strict";
    init_inventory_repository();
    InventoryService = class {
      repo;
      constructor(repo) {
        this.repo = repo || new InventoryRepository();
      }
      // ===== STORAGE =====
      async createStorageListing(data) {
        return this.repo.createStorageListing(data);
      }
      async getStorageListingsByKitchen(kitchenId) {
        return this.repo.getStorageListingsByKitchenId(kitchenId);
      }
      async getStorageListingById(id) {
        return this.repo.getStorageListingById(id);
      }
      async updateStorageListing(id, updates) {
        return this.repo.updateStorageListing(id, updates);
      }
      async deleteStorageListing(id) {
        return this.repo.deleteStorageListing(id);
      }
      // ===== EQUIPMENT =====
      async createEquipmentListing(data) {
        return this.repo.createEquipmentListing(data);
      }
      async getEquipmentListingsByKitchen(kitchenId) {
        return this.repo.getEquipmentListingsByKitchenId(kitchenId);
      }
      async getEquipmentListingById(id) {
        return this.repo.getEquipmentListingById(id);
      }
      async updateEquipmentListing(id, updates) {
        return this.repo.updateEquipmentListing(id, updates);
      }
      async deleteEquipmentListing(id) {
        return this.repo.deleteEquipmentListing(id);
      }
    };
    inventoryService = new InventoryService();
  }
});

// server/sms.ts
var sms_exports = {};
__export(sms_exports, {
  formatPhoneNumber: () => formatPhoneNumber,
  generateChefBookingCancellationSMS: () => generateChefBookingCancellationSMS,
  generateChefBookingConfirmationSMS: () => generateChefBookingConfirmationSMS,
  generateChefSelfCancellationSMS: () => generateChefSelfCancellationSMS,
  generateManagerBookingCancellationSMS: () => generateManagerBookingCancellationSMS,
  generateManagerBookingSMS: () => generateManagerBookingSMS,
  generateManagerPortalBookingSMS: () => generateManagerPortalBookingSMS,
  generatePortalUserBookingCancellationSMS: () => generatePortalUserBookingCancellationSMS,
  generatePortalUserBookingConfirmationSMS: () => generatePortalUserBookingConfirmationSMS,
  sendSMS: () => sendSMS,
  testSMS: () => testSMS
});
import twilio from "twilio";
var getSMSConfig, formatPhoneNumber, sendSMS, generateManagerBookingSMS, generateManagerPortalBookingSMS, generateChefBookingConfirmationSMS, generateChefBookingCancellationSMS, generatePortalUserBookingConfirmationSMS, generatePortalUserBookingCancellationSMS, generateManagerBookingCancellationSMS, generateChefSelfCancellationSMS, testSMS;
var init_sms = __esm({
  "server/sms.ts"() {
    "use strict";
    getSMSConfig = () => {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber) {
        const missing = [];
        if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
        if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
        if (!fromNumber) missing.push("TWILIO_PHONE_NUMBER");
        console.warn("\u26A0\uFE0F Twilio configuration is missing. SMS functionality will be disabled.");
        console.warn(`   Missing variables: ${missing.join(", ")}`);
        console.warn("   Please set these environment variables to enable SMS functionality.");
        return null;
      }
      if (!fromNumber.startsWith("+")) {
        console.warn(`\u26A0\uFE0F TWILIO_PHONE_NUMBER should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US). Current value: ${fromNumber}`);
      }
      if (fromNumber.startsWith("+1") && fromNumber.length === 12) {
        const areaCode = fromNumber.substring(2, 5);
        const firstDigit = parseInt(areaCode[0]);
        if (firstDigit >= 2 && firstDigit <= 9) {
          console.log(`\u2705 Twilio phone number detected as North American (US/Canada): ${fromNumber}`);
        }
      }
      return {
        accountSid,
        authToken,
        fromNumber
      };
    };
    formatPhoneNumber = (phone) => {
      if (!phone) return null;
      const trimmed = phone.trim();
      if (!trimmed) return null;
      const cleaned = trimmed.replace(/[^\d+]/g, "");
      if (cleaned.startsWith("+")) {
        const digitsAfterPlus = cleaned.substring(1);
        if (digitsAfterPlus.length >= 1 && digitsAfterPlus.length <= 15 && /^\d+$/.test(digitsAfterPlus)) {
          return cleaned;
        }
        console.warn(`\u26A0\uFE0F Invalid E.164 format (must be + followed by 1-15 digits): ${phone}`);
        return null;
      }
      const digitsOnly = cleaned.replace(/\D/g, "");
      if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
        return `+${digitsOnly}`;
      }
      if (digitsOnly.length === 10) {
        const areaCode = digitsOnly.substring(0, 3);
        const exchangeCode = digitsOnly.substring(3, 6);
        const firstDigit = parseInt(digitsOnly[0]);
        const fourthDigit = parseInt(digitsOnly[3]);
        if (firstDigit >= 2 && firstDigit <= 9 && fourthDigit >= 2 && fourthDigit <= 9) {
          return `+1${digitsOnly}`;
        } else {
          console.warn(`\u26A0\uFE0F Invalid North American phone number format: ${phone}`);
          console.warn("   Area code and exchange code must start with digits 2-9");
          return null;
        }
      }
      console.warn(`\u26A0\uFE0F Could not format phone number: ${phone} (digits only: ${digitsOnly}, length: ${digitsOnly.length})`);
      console.warn("   Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US)");
      console.warn("   Or 10-digit North American numbers (e.g., 4161234567 for Canada, 2125551234 for US)");
      return null;
    };
    sendSMS = async (to, message, options) => {
      const startTime = Date.now();
      try {
        const config = getSMSConfig();
        if (!config) {
          console.warn("\u26A0\uFE0F SMS not sent - Twilio configuration missing");
          return false;
        }
        const formattedPhone = formatPhoneNumber(to);
        if (!formattedPhone) {
          console.error(`\u274C SMS not sent - Invalid phone number: ${to}`);
          console.error("   Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US)");
          console.error("   Or 10-digit North American numbers (e.g., 4161234567 for Canada, 2125551234 for US)");
          return false;
        }
        if (message.length > 1600) {
          console.warn(`\u26A0\uFE0F SMS message is ${message.length} characters (limit: 1600). Message will be split into multiple parts.`);
        }
        const client = twilio(config.accountSid, config.authToken);
        const formattedFrom = formatPhoneNumber(config.fromNumber);
        if (!formattedFrom) {
          console.error(`\u274C SMS not sent - Invalid TWILIO_PHONE_NUMBER format: ${config.fromNumber}`);
          console.error("   TWILIO_PHONE_NUMBER must be in E.164 format (e.g., +1234567890)");
          return false;
        }
        const messageResult = await client.messages.create({
          body: message,
          from: formattedFrom,
          // Use formatted from number
          to: formattedPhone
        });
        const duration = Date.now() - startTime;
        console.log(`\u2705 SMS sent successfully:`, {
          to: formattedPhone,
          messageSid: messageResult.sid,
          status: messageResult.status,
          duration: `${duration}ms`,
          trackingId: options?.trackingId || `auto_${Date.now()}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        return true;
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetails = {
          to,
          formattedTo: formatPhoneNumber(to),
          error: errorMessage,
          duration: `${duration}ms`,
          trackingId: options?.trackingId || `auto_${Date.now()}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (error && typeof error === "object" && "code" in error) {
          errorDetails.twilioCode = error.code;
          errorDetails.twilioMessage = error.message;
          errorDetails.twilioStatus = error.status;
          errorDetails.twilioMoreInfo = error.moreInfo;
        }
        console.error(`\u274C SMS sending failed:`, errorDetails);
        if (error && typeof error === "object" && "code" in error) {
          const twilioCode = error.code;
          switch (twilioCode) {
            case 21211:
              console.error("   \u2192 Invalid phone number format. Ensure phone numbers are in E.164 format (e.g., +1234567890)");
              break;
            case 21212:
              console.error("   \u2192 Invalid phone number. The number provided is not a valid phone number.");
              break;
            case 21408:
              console.error("   \u2192 Permission denied. Check your Twilio account permissions.");
              break;
            case 21608:
              console.error("   \u2192 Unsubscribed recipient. The recipient has opted out of receiving messages.");
              break;
            case 21610:
              console.error('   \u2192 Invalid "from" phone number. Check TWILIO_PHONE_NUMBER is correct and verified in Twilio.');
              break;
            case 21614:
              console.error('   \u2192 "To" number is not a valid mobile number.');
              break;
            case 30003:
              console.error("   \u2192 Unreachable destination. The phone number may be invalid or unreachable.");
              break;
            case 30004:
              console.error("   \u2192 Message blocked. The message may be blocked by carrier or Twilio.");
              break;
            case 30005:
              console.error("   \u2192 Unknown destination. The destination number is not recognized.");
              break;
            case 30006:
              console.error("   \u2192 Landline or unreachable. The number may be a landline that cannot receive SMS.");
              break;
            default:
              console.error(`   \u2192 Twilio error code: ${twilioCode}. Check Twilio documentation for details.`);
          }
        }
        return false;
      }
    };
    generateManagerBookingSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `New kitchen booking from ${data.chefName}:

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

Please check your dashboard to confirm or manage this booking.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generateManagerPortalBookingSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `New kitchen booking from portal user ${data.portalUserName}:

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

Please check your dashboard to confirm or manage this booking.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generateChefBookingConfirmationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `Your kitchen booking has been confirmed!

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

See you there!

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generateChefBookingCancellationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      const reasonText = data.reason ? `
Reason: ${data.reason}` : "";
      return `Your kitchen booking has been cancelled.

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}${reasonText}

Please contact the manager if you have questions.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generatePortalUserBookingConfirmationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `Your kitchen booking has been confirmed!

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

See you there!

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generatePortalUserBookingCancellationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      const reasonText = data.reason ? `
Reason: ${data.reason}` : "";
      return `Your kitchen booking has been cancelled.

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}${reasonText}

Please contact the manager if you have questions.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generateManagerBookingCancellationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `Chef ${data.chefName} has cancelled their booking:

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

Please check your dashboard for details.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    generateChefSelfCancellationSMS = (data) => {
      const date2 = new Date(data.bookingDate).toLocaleDateString();
      return `Your kitchen booking has been cancelled:

Kitchen: ${data.kitchenName}
Date: ${date2}
Time: ${data.startTime} - ${data.endTime}

If you need to book again, please visit the dashboard.

We've also sent you an email. If not found, please check your spam folder.`;
    };
    testSMS = async (to) => {
      try {
        const config = getSMSConfig();
        if (!config) {
          return {
            success: false,
            message: "Twilio configuration is missing. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables."
          };
        }
        const formattedPhone = formatPhoneNumber(to);
        if (!formattedPhone) {
          return {
            success: false,
            message: `Invalid phone number format: ${to}. Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US) or 10-digit North American numbers.`
          };
        }
        const formattedFrom = formatPhoneNumber(config.fromNumber);
        if (!formattedFrom) {
          return {
            success: false,
            message: `Invalid TWILIO_PHONE_NUMBER format: ${config.fromNumber}. Must be in E.164 format (e.g., +1234567890).`
          };
        }
        const client = twilio(config.accountSid, config.authToken);
        const testMessage = "Test SMS from Local Cooks Community. If you received this, SMS is working correctly!";
        const messageResult = await client.messages.create({
          body: testMessage,
          from: formattedFrom,
          to: formattedPhone
        });
        return {
          success: true,
          message: "SMS sent successfully!",
          details: {
            messageSid: messageResult.sid,
            status: messageResult.status,
            to: formattedPhone,
            from: formattedFrom
          }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const details = { error: errorMessage };
        if (error && typeof error === "object" && "code" in error) {
          details.twilioCode = error.code;
          details.twilioMessage = error.message;
          details.twilioStatus = error.status;
        }
        return {
          success: false,
          message: `SMS test failed: ${errorMessage}`,
          details
        };
      }
    };
  }
});

// server/services/stripe-checkout-fee-service.ts
var stripe_checkout_fee_service_exports = {};
__export(stripe_checkout_fee_service_exports, {
  calculateCheckoutFees: () => calculateCheckoutFees
});
function calculateCheckoutFees(bookingPrice) {
  if (bookingPrice <= 0) {
    throw new Error("Booking price must be greater than 0");
  }
  const bookingPriceInCents = Math.round(bookingPrice * 100);
  const percentageFeeInCents = Math.round(bookingPrice * 0.029 * 100);
  const flatFeeInCents = 30;
  const totalPlatformFeeInCents = percentageFeeInCents + flatFeeInCents;
  const totalChargeInCents = bookingPriceInCents + totalPlatformFeeInCents;
  return {
    bookingPriceInCents,
    percentageFeeInCents,
    flatFeeInCents,
    totalPlatformFeeInCents,
    totalChargeInCents
  };
}
var init_stripe_checkout_fee_service = __esm({
  "server/services/stripe-checkout-fee-service.ts"() {
    "use strict";
  }
});

// server/services/stripe-checkout-service.ts
var stripe_checkout_service_exports = {};
__export(stripe_checkout_service_exports, {
  createCheckoutSession: () => createCheckoutSession
});
import Stripe3 from "stripe";
async function createCheckoutSession(params) {
  if (!stripe3) {
    throw new Error("Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.");
  }
  const {
    bookingPriceInCents,
    platformFeeInCents,
    managerStripeAccountId,
    customerEmail,
    bookingId,
    currency = "cad",
    successUrl,
    cancelUrl,
    metadata = {}
  } = params;
  if (bookingPriceInCents <= 0) {
    throw new Error("Booking price must be greater than 0");
  }
  if (platformFeeInCents <= 0) {
    throw new Error("Platform fee must be greater than 0");
  }
  if (platformFeeInCents >= bookingPriceInCents + platformFeeInCents) {
    throw new Error("Platform fee must be less than total charge amount");
  }
  if (!managerStripeAccountId) {
    throw new Error("Manager Stripe account ID is required");
  }
  if (!customerEmail) {
    throw new Error("Customer email is required");
  }
  const totalAmountInCents = bookingPriceInCents + platformFeeInCents;
  try {
    const session = await stripe3.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: "Kitchen Session Booking"
            },
            unit_amount: bookingPriceInCents
          },
          quantity: 1
        },
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: "Platform Service Fee"
            },
            unit_amount: platformFeeInCents
          },
          quantity: 1
        }
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeInCents,
        transfer_data: {
          destination: managerStripeAccountId
        },
        metadata: {
          booking_id: bookingId.toString(),
          ...metadata
        }
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        booking_id: bookingId.toString(),
        booking_price_cents: bookingPriceInCents.toString(),
        platform_fee_cents: platformFeeInCents.toString(),
        total_cents: totalAmountInCents.toString(),
        manager_account_id: managerStripeAccountId,
        ...metadata
      }
    });
    if (!session.url) {
      throw new Error("Failed to create checkout session URL");
    }
    return {
      sessionId: session.id,
      sessionUrl: session.url
    };
  } catch (error) {
    console.error("Error creating Stripe Checkout session:", error);
    throw new Error(`Failed to create checkout session: ${error.message}`);
  }
}
var stripeSecretKey3, stripe3;
var init_stripe_checkout_service = __esm({
  "server/services/stripe-checkout-service.ts"() {
    "use strict";
    stripeSecretKey3 = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey3) {
      console.warn("\u26A0\uFE0F STRIPE_SECRET_KEY not found in environment variables");
    }
    stripe3 = stripeSecretKey3 ? new Stripe3(stripeSecretKey3, {
      apiVersion: "2025-12-15.clover"
    }) : null;
  }
});

// server/services/stripe-checkout-transactions-service.ts
var stripe_checkout_transactions_service_exports = {};
__export(stripe_checkout_transactions_service_exports, {
  createTransaction: () => createTransaction,
  getTransactionBySessionId: () => getTransactionBySessionId,
  updateTransactionBySessionId: () => updateTransactionBySessionId
});
import { sql as sql8 } from "drizzle-orm";
async function createTransaction(params, db2) {
  const {
    bookingId,
    stripeSessionId,
    customerEmail,
    bookingAmountCents,
    platformFeePercentageCents,
    platformFeeFlatCents,
    totalPlatformFeeCents,
    totalCustomerChargedCents,
    managerReceivesCents,
    metadata = {}
  } = params;
  const result = await db2.execute(sql8`
    INSERT INTO transactions (
      booking_id,
      stripe_session_id,
      customer_email,
      booking_amount_cents,
      platform_fee_percentage_cents,
      platform_fee_flat_cents,
      total_platform_fee_cents,
      total_customer_charged_cents,
      manager_receives_cents,
      status,
      metadata
    ) VALUES (
      ${bookingId},
      ${stripeSessionId},
      ${customerEmail},
      ${bookingAmountCents},
      ${platformFeePercentageCents},
      ${platformFeeFlatCents},
      ${totalPlatformFeeCents},
      ${totalCustomerChargedCents},
      ${managerReceivesCents},
      ${"pending"},
      ${JSON.stringify(metadata)}
    )
    RETURNING *
  `);
  if (result.rows.length === 0) {
    throw new Error("Failed to create transaction record");
  }
  return mapRowToTransaction(result.rows[0]);
}
async function updateTransactionBySessionId(sessionId, params, db2) {
  const updates = [];
  if (params.status !== void 0) {
    updates.push(sql8`status = ${params.status}`);
  }
  if (params.stripePaymentIntentId !== void 0) {
    updates.push(sql8`stripe_payment_intent_id = ${params.stripePaymentIntentId}`);
  }
  if (params.stripeChargeId !== void 0) {
    updates.push(sql8`stripe_charge_id = ${params.stripeChargeId}`);
  }
  if (params.completedAt !== void 0) {
    updates.push(sql8`completed_at = ${params.completedAt}`);
  }
  if (params.refundedAt !== void 0) {
    updates.push(sql8`refunded_at = ${params.refundedAt}`);
  }
  if (params.metadata !== void 0) {
    updates.push(sql8`metadata = ${JSON.stringify(params.metadata)}`);
  }
  if (updates.length === 0) {
    return getTransactionBySessionId(sessionId, db2);
  }
  const result = await db2.execute(sql8`
    UPDATE transactions
    SET ${sql8.join(updates, sql8`, `)}
    WHERE stripe_session_id = ${sessionId}
    RETURNING *
  `);
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToTransaction(result.rows[0]);
}
async function getTransactionBySessionId(sessionId, db2) {
  const result = await db2.execute(sql8`
    SELECT * FROM transactions WHERE stripe_session_id = ${sessionId}
  `);
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToTransaction(result.rows[0]);
}
function mapRowToTransaction(row) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    stripe_session_id: row.stripe_session_id,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    stripe_charge_id: row.stripe_charge_id,
    customer_email: row.customer_email,
    booking_amount_cents: row.booking_amount_cents,
    platform_fee_percentage_cents: row.platform_fee_percentage_cents,
    platform_fee_flat_cents: row.platform_fee_flat_cents,
    total_platform_fee_cents: row.total_platform_fee_cents,
    total_customer_charged_cents: row.total_customer_charged_cents,
    manager_receives_cents: row.manager_receives_cents,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    refunded_at: row.refunded_at,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {}
  };
}
var init_stripe_checkout_transactions_service = __esm({
  "server/services/stripe-checkout-transactions-service.ts"() {
    "use strict";
  }
});

// server/date-utils.ts
var date_utils_exports = {};
__export(date_utils_exports, {
  getHoursUntilBooking: () => getHoursUntilBooking,
  isBookingTimePast: () => isBookingTimePast
});
import { isAfter as isAfter2, differenceInHours } from "date-fns";
import { TZDate as TZDate2 } from "@date-fns/tz";
function isBookingTimePast(dateStr, timeStr, timezone = "America/Edmonton") {
  const bookingDateTime = createBookingDateTime2(dateStr, timeStr, timezone);
  const now = new TZDate2(/* @__PURE__ */ new Date(), timezone);
  return isAfter2(now, bookingDateTime);
}
function getHoursUntilBooking(dateStr, timeStr, timezone = "America/Edmonton") {
  const bookingDateTime = createBookingDateTime2(dateStr, timeStr, timezone);
  const now = new TZDate2(/* @__PURE__ */ new Date(), timezone);
  return differenceInHours(bookingDateTime, now);
}
function createBookingDateTime2(dateStr, timeStr, timezone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  const tzDate = new TZDate2(year, month - 1, day, hours, minutes, 0, 0, timezone);
  return tzDate;
}
var init_date_utils = __esm({
  "server/date-utils.ts"() {
    "use strict";
  }
});

// server/routes/bookings.ts
var bookings_exports = {};
__export(bookings_exports, {
  default: () => bookings_default
});
import { Router as Router13 } from "express";
import { eq as eq24, and as and15 } from "drizzle-orm";
var router13, bookings_default;
var init_bookings = __esm({
  "server/routes/bookings.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_logger();
    init_middleware();
    init_stripe_service();
    init_pricing_service();
    init_user_service();
    init_booking_service();
    init_inventory_service();
    init_kitchen_service();
    init_location_service();
    init_chef_service();
    init_phone_utils();
    init_sms();
    router13 = Router13();
    router13.post("/bookings/checkout", async (req, res) => {
      try {
        const { bookingId, managerStripeAccountId, bookingPrice, customerEmail } = req.body;
        if (!bookingId || !managerStripeAccountId || !bookingPrice || !customerEmail) {
          return res.status(400).json({
            error: "Missing required fields: bookingId, managerStripeAccountId, bookingPrice, and customerEmail are required"
          });
        }
        const bookingPriceNum = parseFloat(bookingPrice);
        if (isNaN(bookingPriceNum) || bookingPriceNum <= 0) {
          return res.status(400).json({
            error: "bookingPrice must be a positive number"
          });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
          return res.status(400).json({
            error: "Invalid email format"
          });
        }
        if (!pool) {
          return res.status(500).json({ error: "Database connection not available" });
        }
        const [booking] = await db.select({ id: kitchenBookings.id, kitchenId: kitchenBookings.kitchenId }).from(kitchenBookings).where(eq24(kitchenBookings.id, bookingId)).limit(1);
        if (!booking) {
          return res.status(404).json({ error: "Booking not found" });
        }
        const { calculateCheckoutFees: calculateCheckoutFees2 } = await Promise.resolve().then(() => (init_stripe_checkout_fee_service(), stripe_checkout_fee_service_exports));
        const feeCalculation = calculateCheckoutFees2(bookingPriceNum);
        const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
        const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
        const baseUrl = `${protocol}://${host}`;
        const { createCheckoutSession: createCheckoutSession2 } = await Promise.resolve().then(() => (init_stripe_checkout_service(), stripe_checkout_service_exports));
        const checkoutSession = await createCheckoutSession2({
          bookingPriceInCents: feeCalculation.bookingPriceInCents,
          platformFeeInCents: feeCalculation.totalPlatformFeeInCents,
          managerStripeAccountId,
          customerEmail,
          bookingId,
          currency: "cad",
          successUrl: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${baseUrl}/booking-cancel?booking_id=${bookingId}`,
          metadata: {
            booking_id: bookingId.toString(),
            kitchen_id: (booking.kitchenId || "").toString()
          }
        });
        const { createTransaction: createTransaction2 } = await Promise.resolve().then(() => (init_stripe_checkout_transactions_service(), stripe_checkout_transactions_service_exports));
        await createTransaction2(
          {
            bookingId,
            stripeSessionId: checkoutSession.sessionId,
            customerEmail,
            bookingAmountCents: feeCalculation.bookingPriceInCents,
            platformFeePercentageCents: feeCalculation.percentageFeeInCents,
            platformFeeFlatCents: feeCalculation.flatFeeInCents,
            totalPlatformFeeCents: feeCalculation.totalPlatformFeeInCents,
            totalCustomerChargedCents: feeCalculation.totalChargeInCents,
            managerReceivesCents: feeCalculation.bookingPriceInCents,
            // Manager receives the booking amount
            metadata: {
              booking_id: bookingId.toString(),
              kitchen_id: (booking.kitchenId || "").toString(),
              manager_account_id: managerStripeAccountId
            }
          },
          db
        );
        res.json({
          sessionUrl: checkoutSession.sessionUrl,
          sessionId: checkoutSession.sessionId,
          booking: {
            price: bookingPriceNum,
            platformFee: feeCalculation.totalPlatformFeeInCents / 100,
            total: feeCalculation.totalChargeInCents / 100
          }
        });
      } catch (error) {
        console.error("Error creating checkout session:", error);
        res.status(500).json({
          error: error.message || "Failed to create checkout session"
        });
      }
    });
    router13.get("/chef/storage-bookings", requireChef, async (req, res) => {
      try {
        const storageBookings2 = await bookingService.getStorageBookingsByChef(req.neonUser.id);
        res.json(storageBookings2);
      } catch (error) {
        console.error("Error fetching storage bookings:", error);
        res.status(500).json({ error: "Failed to fetch storage bookings" });
      }
    });
    router13.get("/chef/storage-bookings/:id", requireChef, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid storage booking ID" });
        }
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
          return res.status(404).json({ error: "Storage booking not found" });
        }
        if (booking.chefId !== req.neonUser.id) {
          return res.status(403).json({ error: "You don't have permission to view this booking" });
        }
        res.json(booking);
      } catch (error) {
        console.error("Error fetching storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to fetch storage booking" });
      }
    });
    router13.post("/admin/storage-bookings/process-overstayer-penalties", async (req, res) => {
      try {
        const { maxDaysToCharge } = req.body;
        const processed = await bookingService.processOverstayerPenalties(maxDaysToCharge || 7);
        res.json({
          success: true,
          processed: processed.length,
          bookings: processed,
          message: `Processed ${processed.length} overstayer penalty charges`
        });
      } catch (error) {
        console.error("Error processing overstayer penalties:", error);
        res.status(500).json({ error: error.message || "Failed to process overstayer penalties" });
      }
    });
    router13.put("/chef/storage-bookings/:id/extend", requireChef, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid storage booking ID" });
        }
        const { newEndDate } = req.body;
        if (!newEndDate) {
          return res.status(400).json({ error: "newEndDate is required" });
        }
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
          return res.status(404).json({ error: "Storage booking not found" });
        }
        if (booking.chefId !== req.neonUser.id) {
          return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }
        if (booking.status === "cancelled") {
          return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }
        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
          return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }
        const extendedBooking = await bookingService.extendStorageBooking(id, newEndDateObj);
        res.json({
          success: true,
          booking: extendedBooking,
          message: `Storage booking extended successfully. Additional cost: $${extendedBooking.extensionDetails.extensionTotalPrice.toFixed(2)} CAD`
        });
      } catch (error) {
        console.error("Error extending storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to extend storage booking" });
      }
    });
    router13.get("/chef/bookings/:id", requireChef, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid booking ID" });
        }
        const booking = await bookingService.getBookingById(id);
        if (!booking) {
          return res.status(404).json({ error: "Booking not found" });
        }
        if (booking.chefId !== req.neonUser.id) {
          return res.status(403).json({ error: "You don't have permission to view this booking" });
        }
        const storageBookings2 = await bookingService.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings2 = await bookingService.getEquipmentBookingsByKitchenBooking(id);
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        res.json({
          ...booking,
          kitchen,
          storageBookings: storageBookings2,
          equipmentBookings: equipmentBookings2
        });
      } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking details" });
      }
    });
    router13.get("/bookings/:id/invoice", requireChef, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid booking ID" });
        }
        const booking = await bookingService.getBookingById(id);
        if (!booking) {
          return res.status(404).json({ error: "Booking not found" });
        }
        if (booking.chefId !== req.neonUser.id) {
          return res.status(403).json({ error: "You don't have permission to view this invoice" });
        }
        const chef = await userService.getUser(booking.chefId);
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        const storageBookings2 = await bookingService.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings2 = await bookingService.getEquipmentBookingsByKitchenBooking(id);
        let location = null;
        if (kitchen && kitchen.locationId) {
          const locationId = kitchen.locationId || kitchen.location_id;
          const [locationData] = await db.select({ id: locations.id, name: locations.name, address: locations.address }).from(locations).where(eq24(locations.id, locationId)).limit(1);
          if (locationData) {
            location = locationData;
          }
        }
        const paymentIntentId = booking.paymentIntentId || booking.payment_intent_id || null;
        const { generateInvoicePDF: generateInvoicePDF2 } = await Promise.resolve().then(() => (init_invoice_service(), invoice_service_exports));
        const pdfBuffer = await generateInvoicePDF2(
          booking,
          chef,
          kitchen,
          location,
          storageBookings2,
          equipmentBookings2,
          paymentIntentId
        );
        res.setHeader("Content-Type", "application/pdf");
        const bookingDate = booking.bookingDate ? new Date(booking.bookingDate).toISOString().split("T")[0] : "unknown";
        res.setHeader("Content-Disposition", `attachment; filename="LocalCooks-Invoice-${id}-${bookingDate}.pdf"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);
      } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ error: error.message || "Failed to generate invoice" });
      }
    });
    router13.put("/chef/bookings/:id/cancel", requireChef, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (!pool) {
          return res.status(500).json({ error: "Database not available" });
        }
        const rows = await db.select({
          id: kitchenBookings.id,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
          kitchenId: kitchenBookings.kitchenId,
          chefId: kitchenBookings.chefId,
          paymentIntentId: kitchenBookings.paymentIntentId,
          paymentStatus: kitchenBookings.paymentStatus,
          cancellationPolicyHours: locations.cancellationPolicyHours,
          cancellationPolicyMessage: locations.cancellationPolicyMessage
        }).from(kitchenBookings).innerJoin(kitchens, eq24(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq24(kitchens.locationId, locations.id)).where(
          and15(
            eq24(kitchenBookings.id, id),
            eq24(kitchenBookings.chefId, req.neonUser.id)
          )
        ).limit(1);
        if (rows.length === 0) {
          return res.status(404).json({ error: "Booking not found" });
        }
        const booking = rows[0];
        const bookingDateTime = /* @__PURE__ */ new Date(`${booking.bookingDate?.toISOString().split("T")[0]}T${booking.startTime}`);
        const now = /* @__PURE__ */ new Date();
        const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1e3 * 60 * 60);
        const cancellationHours = booking.cancellationPolicyHours || 24;
        if (booking.paymentIntentId && hoursUntilBooking >= cancellationHours && booking.paymentStatus === "paid") {
          try {
            const { createRefund: createRefund2, getPaymentIntent: getPaymentIntent2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
            const paymentIntent = await getPaymentIntent2(booking.paymentIntentId);
            if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
              const refund = await createRefund2(booking.paymentIntentId, void 0, "requested_by_customer");
              logger.info(`[Cancel Booking] Created refund for booking ${id} (PaymentIntent: ${booking.paymentIntentId}, Refund: ${refund.id})`);
              await db.update(kitchenBookings).set({ paymentStatus: "refunded" }).where(eq24(kitchenBookings.id, id));
            }
          } catch (error) {
            console.error(`[Cancel Booking] Error creating refund for booking ${id}:`, error);
          }
        }
        await bookingService.cancelBooking(id, req.neonUser.id, true);
        try {
          const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
          if (!kitchen) {
            console.warn(`\u26A0\uFE0F Kitchen ${booking.kitchenId} not found for email notification`);
          } else {
            const kitchenLocationId = kitchen.locationId || kitchen.location_id;
            if (!kitchenLocationId) {
              console.warn(`\u26A0\uFE0F Kitchen ${booking.kitchenId} has no locationId`);
            } else if (!pool) {
              console.warn(`\u26A0\uFE0F Database pool not available for email notification`);
            } else {
              const [location] = await db.select({ id: locations.id, name: locations.name, managerId: locations.managerId, notificationEmail: locations.notificationEmail }).from(locations).where(eq24(locations.id, kitchenLocationId));
              if (!location) {
                logger.warn(`\u26A0\uFE0F Location ${kitchenLocationId} not found for email notification`);
              } else {
                const chef = await userService.getUser(booking.chefId);
                if (!chef) {
                  console.warn(`\u26A0\uFE0F Chef ${booking.chefId} not found for email notification`);
                } else {
                  const managerId = location.managerId;
                  let manager = null;
                  if (managerId) {
                    const [managerResult] = await db.select({ id: users.id, username: users.username }).from(users).where(eq24(users.id, managerId));
                    if (managerResult) {
                      manager = managerResult;
                    }
                  }
                  const chefPhone = await getChefPhone(booking.chefId, pool);
                  const { sendEmail: sendEmail2, generateBookingCancellationEmail: generateBookingCancellationEmail4, generateBookingCancellationNotificationEmail: generateBookingCancellationNotificationEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
                  try {
                    const chefEmail = generateBookingCancellationEmail4({
                      chefEmail: chef.username || "",
                      chefName: chef.username || "Chef",
                      kitchenName: kitchen.name || "Kitchen",
                      bookingDate: booking.bookingDate?.toISOString() || "",
                      startTime: booking.startTime,
                      endTime: booking.endTime,
                      cancellationReason: "You cancelled this booking"
                    });
                    await sendEmail2(chefEmail);
                    logger.info(`\u2705 Booking cancellation email sent to chef: ${chef.username}`);
                  } catch (emailError) {
                    logger.error("Error sending chef cancellation email:", emailError);
                  }
                  if (chefPhone) {
                    try {
                      const smsMessage = generateChefSelfCancellationSMS({
                        kitchenName: kitchen.name || "Kitchen",
                        bookingDate: booking.bookingDate?.toISOString() || "",
                        startTime: booking.startTime,
                        endTime: booking.endTime || ""
                      });
                      await sendSMS(chefPhone, smsMessage, { trackingId: `booking_${id}_chef_self_cancelled` });
                      console.log(`\u2705 Booking cancellation SMS sent to chef: ${chefPhone}`);
                    } catch (smsError) {
                      console.error("Error sending chef cancellation SMS:", smsError);
                    }
                  }
                  const notificationEmailAddress = location.notificationEmail || (manager ? manager.username || null : null);
                  if (notificationEmailAddress) {
                    try {
                      const managerEmail = generateBookingCancellationNotificationEmail3({
                        managerEmail: notificationEmailAddress,
                        chefName: chef.username || "Chef",
                        kitchenName: kitchen.name || "Kitchen",
                        bookingDate: booking.bookingDate?.toISOString() || "",
                        startTime: booking.startTime,
                        endTime: booking.endTime,
                        cancellationReason: "Cancelled by chef"
                      });
                      await sendEmail2(managerEmail);
                      console.log(`\u2705 Booking cancellation notification email sent to manager: ${notificationEmailAddress}`);
                    } catch (emailError) {
                      console.error("Error sending manager cancellation email:", emailError);
                      console.error("Manager email error details:", emailError instanceof Error ? emailError.message : emailError);
                    }
                  } else {
                    console.warn(`\u26A0\uFE0F No notification email found for location ${kitchenLocationId}`);
                  }
                  try {
                    const managerPhone = await getManagerPhone(location, managerId, pool);
                    if (managerPhone) {
                      const smsMessage = generateManagerBookingCancellationSMS({
                        chefName: chef.username || "Chef",
                        kitchenName: kitchen.name || "Kitchen",
                        bookingDate: booking.bookingDate?.toISOString() || "",
                        startTime: booking.startTime,
                        endTime: booking.endTime
                      });
                      await sendSMS(managerPhone, smsMessage, { trackingId: `booking_${id}_manager_cancelled` });
                      console.log(`\u2705 Booking cancellation SMS sent to manager: ${managerPhone}`);
                    }
                  } catch (smsError) {
                    console.error("Error sending manager cancellation SMS:", smsError);
                  }
                }
              }
            }
          }
        } catch (emailError) {
          console.error("Error sending booking cancellation emails:", emailError);
        }
        res.json({ success: true });
      } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel booking" });
      }
    });
    router13.post("/payments/create-intent", requireChef, async (req, res) => {
      try {
        const { kitchenId, bookingDate, startTime, endTime, selectedStorage, selectedEquipmentIds, expectedAmountCents } = req.body;
        const chefId = req.neonUser.id;
        if (!kitchenId || !bookingDate || !startTime || !endTime) {
          return res.status(400).json({ error: "Missing required booking fields" });
        }
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime);
        let totalPriceCents = kitchenPricing.totalPriceCents;
        if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0 && pool) {
          for (const storage2 of selectedStorage) {
            try {
              const storageListing = await inventoryService.getStorageListingById(storage2.storageListingId);
              if (storageListing) {
                const basePriceCents = storageListing.basePrice ? Math.round(parseFloat(String(storageListing.basePrice))) : 0;
                const minDays = storageListing.minimumBookingDuration || 1;
                const startDate = new Date(storage2.startDate);
                const endDate = new Date(storage2.endDate);
                const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
                const effectiveDays = Math.max(days, minDays);
                let storagePrice = basePriceCents * effectiveDays;
                if (storageListing.pricingModel === "hourly") {
                  const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60)));
                  storagePrice = basePriceCents * durationHours;
                } else if (storageListing.pricingModel === "monthly-flat") {
                  storagePrice = basePriceCents;
                }
                totalPriceCents += storagePrice;
              }
            } catch (error) {
              console.error("Error calculating storage price:", error);
            }
          }
        }
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
          for (const equipmentListingId of selectedEquipmentIds) {
            try {
              const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);
              if (equipmentListing && equipmentListing.availabilityType === "included") {
                continue;
              }
              if (equipmentListing) {
                const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;
                const damageDepositCents = equipmentListing.damageDeposit ? Math.round(parseFloat(String(equipmentListing.damageDeposit))) : 0;
                totalPriceCents += sessionRateCents + damageDepositCents;
              }
            } catch (error) {
              logger.error(`Error calculating equipment price for listing ${equipmentListingId}:`, error);
            }
          }
        }
        const serviceFeeCents = await calculatePlatformFeeDynamic(totalPriceCents);
        const stripeProcessingFeeCents = 30;
        const totalServiceFeeCents = serviceFeeCents + stripeProcessingFeeCents;
        const totalWithFeesCents = calculateTotalWithFees(totalPriceCents, totalServiceFeeCents, 0);
        let managerConnectAccountId;
        try {
          const rows = await db.select({
            stripeConnectAccountId: users.stripeConnectAccountId
          }).from(kitchens).innerJoin(locations, eq24(kitchens.locationId, locations.id)).innerJoin(users, eq24(locations.managerId, users.id)).where(eq24(kitchens.id, kitchenId)).limit(1);
          if (rows.length > 0 && rows[0].stripeConnectAccountId) {
            managerConnectAccountId = rows[0].stripeConnectAccountId;
          }
        } catch (error) {
          logger.error(`Error fetching manager Stripe account for kitchen ${kitchenId}:`, error);
        }
        console.log(`[Payment] Creating intent: Subtotal=${totalPriceCents}, Fee=${totalServiceFeeCents}, Total=${totalWithFeesCents}, Expected=${expectedAmountCents}`);
        const metadata = {
          kitchenId: String(kitchenId),
          chefId: String(chefId),
          bookingDate: String(bookingDate),
          startTime: String(startTime),
          endTime: String(endTime),
          hasStorage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
          hasEquipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
          serviceFeeCents: String(serviceFeeCents),
          stripeProcessingFeeCents: String(stripeProcessingFeeCents)
        };
        const paymentIntent = await createPaymentIntent({
          amount: totalWithFeesCents,
          currency: kitchenPricing.currency.toLowerCase(),
          chefId,
          kitchenId,
          managerConnectAccountId,
          applicationFeeAmount: managerConnectAccountId ? serviceFeeCents : void 0,
          enableACSS: false,
          // Disable ACSS - only use card payments with automatic capture
          enableCards: true,
          // Enable card payments only
          metadata: {
            booking_date: bookingDate,
            start_time: startTime,
            end_time: endTime,
            expected_amount: totalWithFeesCents.toString()
            // Store expected amount for verification
          }
        });
        res.json({
          clientSecret: paymentIntent.clientSecret || paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          id: paymentIntent.id,
          amount: totalWithFeesCents,
          currency: kitchenPricing.currency.toUpperCase(),
          breakdown: {
            subtotal: totalPriceCents,
            serviceFee: totalServiceFeeCents,
            total: totalWithFeesCents
          }
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: error.message || "Failed to create payment intent" });
      }
    });
    router13.post("/payments/confirm", requireChef, async (req, res) => {
      try {
        const { paymentIntentId, paymentMethodId } = req.body;
        const chefId = req.neonUser.id;
        if (!paymentIntentId || !paymentMethodId) {
          return res.status(400).json({ error: "Missing paymentIntentId or paymentMethodId" });
        }
        const { confirmPaymentIntent: confirmPaymentIntent2, getPaymentIntent: getPaymentIntent2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
        const paymentIntent = await getPaymentIntent2(paymentIntentId);
        if (!paymentIntent) {
          return res.status(404).json({ error: "Payment intent not found" });
        }
        const confirmed = await confirmPaymentIntent2(paymentIntentId, paymentMethodId);
        res.json({
          paymentIntentId: confirmed.id,
          status: confirmed.status
        });
      } catch (error) {
        console.error("Error confirming payment:", error);
        res.status(500).json({
          error: "Failed to confirm payment",
          message: error.message
        });
      }
    });
    router13.get("/payments/intent/:id/status", requireChef, async (req, res) => {
      try {
        const { id } = req.params;
        const chefId = req.neonUser.id;
        const { getPaymentIntent: getPaymentIntent2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
        const paymentIntent = await getPaymentIntent2(id);
        if (!paymentIntent) {
          return res.status(404).json({ error: "Payment intent not found" });
        }
        res.json({
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status
        });
      } catch (error) {
        console.error("Error getting payment intent status:", error);
        res.status(500).json({
          error: "Failed to get payment intent status",
          message: error.message
        });
      }
    });
    router13.post("/payments/capture", requireChef, async (req, res) => {
      res.status(410).json({
        error: "This endpoint is deprecated. Payments are now automatically captured when confirmed.",
        message: "With automatic capture enabled, payments are processed immediately. No manual capture is needed."
      });
    });
    router13.post("/payments/cancel", requireChef, async (req, res) => {
      try {
        const { paymentIntentId } = req.body;
        const chefId = req.neonUser.id;
        if (!paymentIntentId) {
          return res.status(400).json({ error: "Missing paymentIntentId" });
        }
        const { cancelPaymentIntent: cancelPaymentIntent2, getPaymentIntent: getPaymentIntent2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
        const paymentIntent = await getPaymentIntent2(paymentIntentId);
        if (!paymentIntent) {
          return res.status(404).json({ error: "Payment intent not found" });
        }
        const cancellableStatuses = ["requires_payment_method", "requires_capture", "requires_confirmation"];
        if (!cancellableStatuses.includes(paymentIntent.status)) {
          return res.status(400).json({
            error: `Payment intent cannot be cancelled. Current status: ${paymentIntent.status}`
          });
        }
        const canceled = await cancelPaymentIntent2(paymentIntentId);
        res.json({
          success: true,
          paymentIntentId: canceled.id,
          status: canceled.status,
          message: "Payment intent cancelled. Note: For captured payments, use refunds instead."
        });
      } catch (error) {
        console.error("Error canceling payment intent:", error);
        res.status(500).json({
          error: "Failed to cancel payment intent",
          message: error.message
        });
      }
    });
    router13.post("/chef/bookings", requireChef, async (req, res) => {
      try {
        const { kitchenId, bookingDate, startTime, endTime, specialNotes, selectedStorageIds, selectedStorage, selectedEquipmentIds, paymentIntentId } = req.body;
        const chefId = req.neonUser.id;
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        const kitchenLocationId1 = kitchen.locationId;
        if (!kitchenLocationId1) {
          return res.status(400).json({ error: "Kitchen location not found" });
        }
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId1);
        if (!applicationStatus.canBook) {
          return res.status(403).json({
            error: applicationStatus.message,
            hasApplication: applicationStatus.hasApplication,
            applicationStatus: applicationStatus.status
          });
        }
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await bookingService.validateBookingAvailability(
          kitchenId,
          bookingDateObj,
          startTime,
          endTime
        );
        if (!availabilityCheck.valid) {
          return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }
        const kitchenLocationId2 = kitchen.locationId;
        let location = null;
        let timezone = "America/Edmonton";
        let minimumBookingWindowHours = 1;
        if (kitchenLocationId2) {
          location = await locationService.getLocationById(kitchenLocationId2);
          if (location) {
            timezone = location.timezone || "America/Edmonton";
            const minWindow = location.minimumBookingWindowHours ?? location.minimum_booking_window_hours;
            if (minWindow !== null && minWindow !== void 0) {
              minimumBookingWindowHours = Number(minWindow);
              console.log(`[Booking Window] Using location minimum booking window: ${minimumBookingWindowHours} hours for kitchen ${kitchenId}`);
            } else {
              console.log(`[Booking Window] Location has no minimum booking window set, using default: 1 hour`);
            }
          }
        }
        const bookingDateStr = typeof bookingDate === "string" ? bookingDate.split("T")[0] : bookingDateObj.toISOString().split("T")[0];
        const { isBookingTimePast: isBookingTimePast2, getHoursUntilBooking: getHoursUntilBooking2 } = await Promise.resolve().then(() => (init_date_utils(), date_utils_exports));
        if (isBookingTimePast2(bookingDateStr, startTime, timezone)) {
          return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }
        const hoursUntilBooking = getHoursUntilBooking2(bookingDateStr, startTime, timezone);
        if (hoursUntilBooking < minimumBookingWindowHours) {
          return res.status(400).json({
            error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? "s" : ""} in advance`
          });
        }
        if (paymentIntentId) {
          const { getPaymentIntent: getPaymentIntent2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
          const paymentIntent = await getPaymentIntent2(paymentIntentId);
          if (!paymentIntent) {
            return res.status(400).json({ error: "Invalid payment intent" });
          }
          if (paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing") {
            return res.status(400).json({
              error: `Payment not completed. Status: ${paymentIntent.status}`
            });
          }
        }
        const booking = await bookingService.createKitchenBooking({
          kitchenId,
          chefId,
          bookingDate: bookingDateObj,
          startTime,
          endTime,
          status: "confirmed",
          // Auto-confirm bookings
          paymentStatus: paymentIntentId ? "paid" : "pending",
          paymentIntentId,
          specialNotes,
          selectedStorageIds: selectedStorageIds || [],
          // Handle legacy IDs
          selectedEquipmentIds: selectedEquipmentIds || []
        });
        try {
          if (!pool) throw new Error("Database pool not available");
          const kitchen2 = await kitchenService.getKitchenById(kitchenId);
          const chef = await userService.getUser(chefId);
          if (chef && kitchen2) {
            const { sendEmail: sendEmail2, generateBookingConfirmationEmail: generateBookingConfirmationEmail4, generateBookingNotificationEmail: generateBookingNotificationEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
            const chefEmail = generateBookingConfirmationEmail4({
              chefEmail: chef.username,
              chefName: chef.username,
              // Or fullName if available
              kitchenName: kitchen2.name,
              bookingDate: bookingDateObj,
              startTime,
              endTime
              // totalPrice: booking.totalPrice // In cents (removed as not supported by email template)
            });
            await sendEmail2(chefEmail);
            if (location) {
              const notificationEmail = location.notificationEmail || location.notification_email;
              if (notificationEmail) {
                const managerEmail = generateBookingNotificationEmail3({
                  managerEmail: notificationEmail,
                  chefName: chef.username,
                  kitchenName: kitchen2.name,
                  bookingDate: bookingDateObj,
                  startTime,
                  endTime
                });
                await sendEmail2(managerEmail);
              }
            }
          }
        } catch (emailError) {
          console.error("Error sending booking emails:", emailError);
        }
        res.status(201).json(booking);
      } catch (error) {
        console.error("Error creating booking:", error);
        res.status(500).json({ error: error.message || "Failed to create booking" });
      }
    });
    router13.get("/chef/bookings", requireChef, async (req, res) => {
      try {
        const chefId = req.neonUser.id;
        console.log(`[CHEF BOOKINGS] Fetching bookings for chef ID: ${chefId}`);
        const bookings = await bookingService.getKitchenBookingsByChef(chefId);
        res.json(bookings);
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
      }
    });
    bookings_default = router13;
  }
});

// server/routes/equipment.ts
var equipment_exports = {};
__export(equipment_exports, {
  default: () => equipment_default
});
import { Router as Router14 } from "express";
var router14, equipment_default;
var init_equipment = __esm({
  "server/routes/equipment.ts"() {
    "use strict";
    init_firebase_auth_middleware();
    init_middleware();
    init_inventory_service();
    init_kitchen_service();
    init_location_service();
    router14 = Router14();
    router14.get("/manager/kitchens/:kitchenId/equipment-listings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        const listings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);
        res.json(listings);
      } catch (error) {
        console.error("Error getting equipment listings:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listings" });
      }
    });
    router14.get("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const listing = await inventoryService.getEquipmentListingById(listingId);
        if (!listing) {
          return res.status(404).json({ error: "Equipment listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(listing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        res.json(listing);
      } catch (error) {
        console.error("Error getting equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listing" });
      }
    });
    router14.post("/manager/equipment-listings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { kitchenId, ...listingData } = req.body;
        if (!kitchenId || isNaN(parseInt(kitchenId))) {
          return res.status(400).json({ error: "Valid kitchen ID is required" });
        }
        const kitchen = await kitchenService.getKitchenById(parseInt(kitchenId));
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        if (!listingData.equipmentType || !listingData.category || !listingData.condition) {
          return res.status(400).json({ error: "Equipment type, category, and condition are required" });
        }
        if (!listingData.availabilityType || !["included", "rental"].includes(listingData.availabilityType)) {
          return res.status(400).json({ error: "Availability type must be 'included' or 'rental'" });
        }
        if (listingData.availabilityType === "rental") {
          if (!listingData.sessionRate || listingData.sessionRate <= 0) {
            return res.status(400).json({ error: "Session rate is required for rental equipment" });
          }
        }
        const created = await inventoryService.createEquipmentListing({
          kitchenId: parseInt(kitchenId),
          ...listingData
        });
        console.log(`\u2705 Equipment listing created by manager ${user.id}`);
        res.status(201).json(created);
      } catch (error) {
        console.error("Error creating equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to create equipment listing" });
      }
    });
    router14.put("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const existingListing = await inventoryService.getEquipmentListingById(listingId);
        if (!existingListing) {
          return res.status(404).json({ error: "Equipment listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        const updated = await inventoryService.updateEquipmentListing(listingId, req.body);
        console.log(`\u2705 Equipment listing ${listingId} updated by manager ${user.id}`);
        res.json(updated);
      } catch (error) {
        console.error("Error updating equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to update equipment listing" });
      }
    });
    router14.delete("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const existingListing = await inventoryService.getEquipmentListingById(listingId);
        if (!existingListing) {
          return res.status(404).json({ error: "Equipment listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        await inventoryService.deleteEquipmentListing(listingId);
        console.log(`\u2705 Equipment listing ${listingId} deleted by manager ${user.id}`);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to delete equipment listing" });
      }
    });
    router14.get("/chef/kitchens/:kitchenId/equipment-listings", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const allListings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);
        const visibleListings = allListings.filter(
          (listing) => listing.isActive === true
        );
        const includedEquipment = visibleListings.filter((l) => l.availabilityType === "included");
        const rentalEquipment = visibleListings.filter((l) => l.availabilityType === "rental");
        console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);
        res.json({
          all: visibleListings,
          included: includedEquipment,
          rental: rentalEquipment
        });
      } catch (error) {
        console.error("Error getting equipment listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listings" });
      }
    });
    equipment_default = router14;
  }
});

// server/routes/storage-listings.ts
var storage_listings_exports = {};
__export(storage_listings_exports, {
  default: () => storage_listings_default
});
import { Router as Router15 } from "express";
var router15, storage_listings_default;
var init_storage_listings = __esm({
  "server/routes/storage-listings.ts"() {
    "use strict";
    init_firebase_auth_middleware();
    init_middleware();
    init_inventory_service();
    init_kitchen_service();
    init_location_service();
    router15 = Router15();
    router15.get("/manager/kitchens/:kitchenId/storage-listings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        const listings = await inventoryService.getStorageListingsByKitchen(kitchenId);
        res.json(listings);
      } catch (error) {
        console.error("Error getting storage listings:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
      }
    });
    router15.get("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const listing = await inventoryService.getStorageListingById(listingId);
        if (!listing) {
          return res.status(404).json({ error: "Storage listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(listing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        res.json(listing);
      } catch (error) {
        console.error("Error getting storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listing" });
      }
    });
    router15.post("/manager/storage-listings", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const { kitchenId, ...listingData } = req.body;
        if (!kitchenId || isNaN(parseInt(kitchenId))) {
          return res.status(400).json({ error: "Valid kitchen ID is required" });
        }
        const kitchen = await kitchenService.getKitchenById(parseInt(kitchenId));
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this kitchen" });
        }
        if (!listingData.name || !listingData.storageType || !listingData.pricingModel || !listingData.basePrice) {
          return res.status(400).json({ error: "Name, storage type, pricing model, and base price are required" });
        }
        const created = await inventoryService.createStorageListing({
          kitchenId: parseInt(kitchenId),
          ...listingData
        });
        console.log(`\u2705 Storage listing created by manager ${user.id}`);
        res.status(201).json(created);
      } catch (error) {
        console.error("Error creating storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to create storage listing" });
      }
    });
    router15.put("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const existingListing = await inventoryService.getStorageListingById(listingId);
        if (!existingListing) {
          return res.status(404).json({ error: "Storage listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        const updated = await inventoryService.updateStorageListing(listingId, req.body);
        console.log(`\u2705 Storage listing ${listingId} updated by manager ${user.id}`);
        res.json(updated);
      } catch (error) {
        console.error("Error updating storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to update storage listing" });
      }
    });
    router15.delete("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
      try {
        const user = req.neonUser;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
          return res.status(400).json({ error: "Invalid listing ID" });
        }
        const existingListing = await inventoryService.getStorageListingById(listingId);
        if (!existingListing) {
          return res.status(404).json({ error: "Storage listing not found" });
        }
        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const locations4 = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations4.some((loc) => loc.id === kitchen.locationId);
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied to this listing" });
        }
        await inventoryService.deleteStorageListing(listingId);
        console.log(`\u2705 Storage listing ${listingId} deleted by manager ${user.id}`);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to delete storage listing" });
      }
    });
    router15.get("/chef/kitchens/:kitchenId/storage-listings", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const allListings = await inventoryService.getStorageListingsByKitchen(kitchenId);
        const visibleListings = allListings.filter(
          (listing) => (listing.status === "approved" || listing.status === "active") && listing.isActive === true
        );
        console.log(`[API] /api/chef/kitchens/${kitchenId}/storage-listings - Returning ${visibleListings.length} visible listings (out of ${allListings.length} total)`);
        res.json(visibleListings);
      } catch (error) {
        console.error("Error getting storage listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
      }
    });
    storage_listings_default = router15;
  }
});

// server/routes/admin.ts
var admin_exports = {};
__export(admin_exports, {
  default: () => admin_default
});
import { Router as Router16 } from "express";
import { eq as eq25, sql as sql9 } from "drizzle-orm";
async function getAuthenticatedUser2(req) {
  if (req.neonUser) {
    return {
      id: req.neonUser.id,
      username: req.neonUser.username,
      role: req.neonUser.role || ""
    };
  }
  return null;
}
var router16, admin_default;
var init_admin = __esm({
  "server/routes/admin.ts"() {
    "use strict";
    init_db();
    init_user_service();
    init_firebase_auth_middleware();
    init_schema();
    init_email();
    init_phone_utils();
    init_passwordUtils();
    init_location_service();
    init_kitchen_service();
    init_chef_service();
    init_booking_service();
    router16 = Router16();
    router16.get("/revenue/all-managers", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        if (res.headersSent) {
          return;
        }
        const { startDate, endDate } = req.query;
        const { getServiceFeeRate: getServiceFeeRate2 } = await Promise.resolve().then(() => (init_pricing_service(), pricing_service_exports));
        const serviceFeeRate = await getServiceFeeRate2();
        const conditions = [sql9`kb.status != 'cancelled'`];
        if (startDate) {
          conditions.push(sql9`kb.booking_date >= ${startDate}::date`);
        }
        if (endDate) {
          conditions.push(sql9`kb.booking_date <= ${endDate}::date`);
        }
        const bookingFilters = sql9.join(conditions, sql9` AND `);
        const managerRole = "manager";
        const result = await db.execute(sql9`
        SELECT 
          u.id as manager_id,
          u.username as manager_name,
          u.username as manager_email,
          l.id as location_id,
          l.name as location_name,
          COALESCE(SUM(CASE WHEN kb.id IS NOT NULL THEN kb.total_price ELSE 0 END), 0)::bigint as total_revenue,
          COALESCE(SUM(CASE WHEN kb.id IS NOT NULL THEN kb.service_fee ELSE 0 END), 0)::bigint as platform_fee,
          COUNT(kb.id)::int as booking_count,
          COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
        FROM users u
        LEFT JOIN locations l ON l.manager_id = u.id
        LEFT JOIN kitchens k ON k.location_id = l.id
        LEFT JOIN kitchen_bookings kb ON kb.kitchen_id = k.id AND ${bookingFilters}
        WHERE u.role = ${managerRole}
        GROUP BY u.id, u.username, l.id, l.name
        ORDER BY u.username ASC, total_revenue DESC
      `);
        const managerMap = /* @__PURE__ */ new Map();
        result.rows.forEach((row) => {
          const managerId = parseInt(row.manager_id);
          const totalRevenue = parseInt(row.total_revenue) || 0;
          const platformFee = parseInt(row.platform_fee) || 0;
          const managerRevenue = totalRevenue - platformFee;
          if (!managerMap.has(managerId)) {
            managerMap.set(managerId, {
              managerId,
              managerName: row.manager_name,
              managerEmail: row.manager_email,
              totalRevenue: 0,
              platformFee: 0,
              managerRevenue: 0,
              bookingCount: 0,
              paidBookingCount: 0,
              locations: []
            });
          }
          const manager = managerMap.get(managerId);
          manager.totalRevenue += totalRevenue;
          manager.platformFee += parseInt(row.platform_fee) || 0;
          manager.managerRevenue += managerRevenue;
          manager.bookingCount += parseInt(row.booking_count) || 0;
          manager.paidBookingCount += parseInt(row.paid_count) || 0;
          if (row.location_id) {
            manager.locations.push({
              locationId: parseInt(row.location_id),
              locationName: row.location_name || "Unnamed Location",
              totalRevenue,
              platformFee: parseInt(row.platform_fee) || 0,
              managerRevenue,
              bookingCount: parseInt(row.booking_count) || 0,
              paidBookingCount: parseInt(row.paid_count) || 0
            });
          }
        });
        const managers = Array.from(managerMap.values()).map((m) => ({
          ...m,
          totalRevenue: m.totalRevenue / 100,
          platformFee: m.platformFee / 100,
          managerRevenue: m.managerRevenue / 100,
          locations: m.locations.map((loc) => ({
            ...loc,
            totalRevenue: loc.totalRevenue / 100,
            platformFee: loc.platformFee / 100,
            managerRevenue: loc.managerRevenue / 100
          })),
          _raw: {
            totalRevenue: m.totalRevenue,
            platformFee: m.platformFee,
            managerRevenue: m.managerRevenue
          }
        }));
        res.json({ managers, total: managers.length });
      } catch (error) {
        console.error("Error getting all managers revenue:", error);
        res.status(500).json({ error: error.message || "Failed to get all managers revenue" });
      }
    });
    router16.get("/revenue/platform-overview", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        if (res.headersSent) {
          return;
        }
        const { startDate, endDate } = req.query;
        const managerCountResult = await db.select({ count: sql9`count(*)::int` }).from(users).where(eq25(users.role, "manager"));
        const totalManagers = managerCountResult[0]?.count || 0;
        const conditions = [sql9`kb.status != 'cancelled'`];
        if (startDate) {
          conditions.push(sql9`kb.booking_date >= ${startDate}::date`);
        }
        if (endDate) {
          conditions.push(sql9`kb.booking_date <= ${endDate}::date`);
        }
        const bookingFilters = sql9.join(conditions, sql9` AND `);
        const bookingResult = await db.execute(sql9`
        SELECT 
          COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
          COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
          COUNT(*)::int as booking_count,
          COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
          COUNT(CASE WHEN kb.payment_status = 'pending' THEN 1 END)::int as pending_count
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        WHERE ${bookingFilters}
      `);
        const row = bookingResult.rows[0] || {};
        res.json({
          totalPlatformRevenue: (parseInt(row.total_revenue) || 0) / 100,
          totalPlatformFees: (parseInt(row.platform_fee) || 0) / 100,
          activeManagers: totalManagers,
          // Use total managers count, not just those with bookings
          totalBookings: parseInt(row.booking_count) || 0,
          paidBookingCount: parseInt(row.paid_count) || 0,
          pendingBookingCount: parseInt(row.pending_count) || 0,
          _raw: {
            totalRevenue: parseInt(row.total_revenue) || 0,
            platformFee: parseInt(row.platform_fee) || 0
          }
        });
      } catch (error) {
        console.error("Error getting platform overview:", error);
        res.status(500).json({ error: error.message || "Failed to get platform overview" });
      }
    });
    router16.get("/revenue/manager/:managerId", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        if (res.headersSent) {
          return;
        }
        const managerId = parseInt(req.params.managerId);
        if (isNaN(managerId) || managerId <= 0) {
          return res.status(400).json({ error: "Invalid manager ID" });
        }
        const { startDate, endDate } = req.query;
        const { pool: pool3 } = await Promise.resolve().then(() => (init_db(), db_exports));
        const { getCompleteRevenueMetrics: getCompleteRevenueMetrics2, getRevenueByLocation: getRevenueByLocation2 } = await Promise.resolve().then(() => (init_revenue_service(), revenue_service_exports));
        const metrics = await getCompleteRevenueMetrics2(
          managerId,
          db,
          startDate ? new Date(startDate) : void 0,
          endDate ? new Date(endDate) : void 0
        );
        const revenueByLocation = await getRevenueByLocation2(
          managerId,
          db,
          startDate ? new Date(startDate) : void 0,
          endDate ? new Date(endDate) : void 0
        );
        const [managerRecord] = await db.select({ id: users.id, username: users.username }).from(users).where(eq25(users.id, managerId)).limit(1);
        res.json({
          manager: managerRecord || null,
          metrics: {
            ...metrics,
            totalRevenue: metrics.totalRevenue / 100,
            platformFee: metrics.platformFee / 100,
            managerRevenue: metrics.managerRevenue / 100,
            pendingPayments: metrics.pendingPayments / 100,
            completedPayments: metrics.completedPayments / 100,
            averageBookingValue: metrics.averageBookingValue / 100,
            refundedAmount: metrics.refundedAmount / 100
          },
          revenueByLocation: revenueByLocation.map((loc) => ({
            ...loc,
            totalRevenue: loc.totalRevenue / 100,
            platformFee: loc.platformFee / 100,
            managerRevenue: loc.managerRevenue / 100
          }))
        });
      } catch (error) {
        console.error("Error getting manager revenue details:", error);
        res.status(500).json({ error: error.message || "Failed to get manager revenue details" });
      }
    });
    router16.post("/chef-location-access", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const { chefId, locationId } = req.body;
        if (!chefId || !locationId) {
          return res.status(400).json({ error: "chefId and locationId are required" });
        }
        const access = await chefService.grantLocationAccess(chefId, locationId, user.id);
        try {
          const location = await locationService.getLocationById(locationId);
          if (!location) {
            console.warn(`\u26A0\uFE0F Location ${locationId} not found for email notification`);
          } else {
            const chef = await userService.getUser(chefId);
            if (!chef) {
              console.warn(`\u26A0\uFE0F Chef ${chefId} not found for email notification`);
            } else {
              try {
                const chefEmail = generateChefLocationAccessApprovedEmail({
                  chefEmail: chef.username || "",
                  chefName: chef.username || "Chef",
                  locationName: location.name || "Location",
                  locationId
                });
                await sendEmail(chefEmail);
                console.log(`\u2705 Chef location access granted email sent to chef: ${chef.username}`);
              } catch (emailError) {
                console.error("Error sending chef access email:", emailError);
                console.error("Chef email error details:", emailError instanceof Error ? emailError.message : emailError);
              }
            }
          }
        } catch (emailError) {
          console.error("Error sending chef access emails:", emailError);
        }
        res.status(201).json(access);
      } catch (error) {
        console.error("Error granting chef location access:", error);
        res.status(500).json({ error: error.message || "Failed to grant access" });
      }
    });
    router16.delete("/chef-location-access", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const { chefId, locationId } = req.body;
        if (!chefId || !locationId) {
          return res.status(400).json({ error: "chefId and locationId are required" });
        }
        await chefService.revokeLocationAccess(chefId, locationId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error revoking chef location access:", error);
        res.status(500).json({ error: error.message || "Failed to revoke access" });
      }
    });
    router16.get("/chef-location-access", async (req, res) => {
      try {
        console.log("[Admin Chef Access] GET request received");
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        console.log("[Admin Chef Access] Auth check:", { hasSession: !!sessionUser, hasFirebase: !!isFirebaseAuth });
        if (!sessionUser && !isFirebaseAuth) {
          console.log("[Admin Chef Access] Not authenticated");
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        console.log("[Admin Chef Access] User:", { id: user.id, role: user.role });
        if (user.role !== "admin") {
          console.log("[Admin Chef Access] Not admin");
          return res.status(403).json({ error: "Admin access required" });
        }
        const allUsers = await db.select({
          id: users.id,
          username: users.username,
          role: users.role,
          isChef: users.isChef
        }).from(users);
        const chefs = allUsers.filter((u) => {
          const role = u.role;
          const isChef = u.isChef ?? u.is_chef;
          return role === "chef" || isChef === true;
        });
        console.log(`[Admin Chef Access] Total users: ${allUsers.length}, Found ${chefs.length} chefs in database`);
        const allLocations = await db.select().from(locations);
        console.log(`[Admin Chef Access] Found ${allLocations.length} locations`);
        let allAccess = [];
        try {
          allAccess = await db.select().from(chefLocationAccess);
          console.log(`[Admin Chef Access] Found ${allAccess.length} location access records`);
        } catch (error) {
          console.error(`[Admin Chef Access] Error querying chef_location_access table:`, error.message);
          if (error.message?.includes("does not exist") || error.message?.includes("relation") || error.code === "42P01") {
            console.log(`[Admin Chef Access] Table doesn't exist yet, returning empty access`);
            allAccess = [];
          } else {
            throw error;
          }
        }
        const response = chefs.map((chef) => {
          const chefAccess = allAccess.filter((a) => {
            const accessChefId = a.chefId ?? a.chef_id;
            return accessChefId === chef.id;
          });
          const accessibleLocations = chefAccess.map((access) => {
            const accessLocationId = access.locationId ?? access.location_id;
            const location = allLocations.find((l) => l.id === accessLocationId);
            if (location) {
              const grantedAt = access.grantedAt ?? access.granted_at;
              return {
                id: location.id,
                name: location.name,
                address: location.address ?? null,
                accessGrantedAt: grantedAt ? typeof grantedAt === "string" ? grantedAt : new Date(grantedAt).toISOString() : void 0
              };
            }
            return null;
          }).filter((l) => l !== null);
          return {
            chef: {
              id: chef.id,
              username: chef.username
            },
            accessibleLocations
          };
        });
        console.log(`[Admin Chef Access] Returning ${response.length} chefs with location access info`);
        res.json(response);
      } catch (error) {
        console.error("[Admin Chef Access] Error:", error);
        console.error("[Admin Chef Access] Error stack:", error.stack);
        res.status(500).json({ error: error.message || "Failed to get access" });
      }
    });
    router16.post("/managers", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const { username, password, email, name } = req.body;
        if (!username || !password) {
          return res.status(400).json({ error: "Username and password are required" });
        }
        const existingUser = await userService.getUserByUsername(username);
        if (existingUser) {
          return res.status(400).json({ error: "Username already exists" });
        }
        const hashedPassword = await hashPassword(password);
        const manager = await userService.createUser({
          username,
          password: hashedPassword,
          role: "manager",
          isChef: false,
          isManager: true,
          isPortalUser: false,
          has_seen_welcome: false,
          // Manager must change password on first login
          managerProfileData: {}
        });
        try {
          const managerEmail = email || username;
          const welcomeEmail = generateManagerCredentialsEmail({
            email: managerEmail,
            name: name || "Manager",
            username,
            password
          });
          await sendEmail(welcomeEmail);
          console.log(`\u2705 Welcome email with credentials sent to manager: ${managerEmail}`);
        } catch (emailError) {
          console.error("Error sending manager welcome email:", emailError);
          console.error("Email error details:", emailError instanceof Error ? emailError.message : emailError);
        }
        res.status(201).json({ success: true, managerId: manager.id });
      } catch (error) {
        console.error("Error creating manager:", error);
        console.error("Error details:", error.message, error.stack);
        res.status(500).json({ error: error.message || "Failed to create manager" });
      }
    });
    router16.get("/managers", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const result = await db.execute(sql9.raw(`
            SELECT 
              u.id, 
              u.username, 
              u.role,
              COALESCE(
                json_agg(
                  json_build_object(
                    'locationId', l.id,
                    'locationName', l.name,
                    'notificationEmail', l.notification_email
                  )
                ) FILTER (WHERE l.id IS NOT NULL),
                '[]'::json
              ) as locations
            FROM users u
            LEFT JOIN locations l ON l.manager_id = u.id
            WHERE u.role = 'manager'
            GROUP BY u.id, u.username, u.role
            ORDER BY u.username ASC
        `));
        const managersWithEmails = result.rows.map((row) => {
          let locations4 = row.locations;
          if (locations4 === null || locations4 === void 0) {
            locations4 = [];
          } else if (typeof locations4 === "string") {
            try {
              const trimmed = locations4.trim();
              if (trimmed === "[]" || trimmed === "" || trimmed === "null") {
                locations4 = [];
              } else {
                locations4 = JSON.parse(locations4);
              }
            } catch (e) {
              locations4 = [];
            }
          }
          if (!Array.isArray(locations4)) {
            if (locations4 && typeof locations4 === "object" && "0" in locations4) {
              locations4 = Object.values(locations4);
            } else {
              locations4 = [];
            }
          }
          const managerData = {
            id: row.id,
            username: row.username,
            role: row.role
          };
          managerData.locations = locations4.map((loc) => ({
            locationId: loc.locationId || loc.location_id || loc.id,
            locationName: loc.locationName || loc.location_name || loc.name,
            notificationEmail: loc.notificationEmail || loc.notification_email || null
          }));
          return managerData;
        });
        const verifiedManagers = managersWithEmails.map((manager) => {
          if (!manager.hasOwnProperty("locations")) {
            manager.locations = [];
          } else if (!Array.isArray(manager.locations)) {
            manager.locations = Array.isArray(manager.locations) ? manager.locations : [];
          }
          return {
            id: manager.id,
            username: manager.username,
            role: manager.role,
            locations: Array.isArray(manager.locations) ? manager.locations : []
          };
        });
        return res.json(verifiedManagers);
      } catch (error) {
        console.error("Error fetching managers:", error);
        res.status(500).json({ error: error.message || "Failed to fetch managers" });
      }
    });
    router16.get("/locations/licenses", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const { status } = req.query;
        const query = db.select({
          id: locations.id,
          name: locations.name,
          address: locations.address,
          managerId: locations.managerId,
          kitchenLicenseUrl: locations.kitchenLicenseUrl,
          kitchenLicenseStatus: locations.kitchenLicenseStatus,
          kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
          kitchenLicenseFeedback: locations.kitchenLicenseFeedback,
          kitchenLicenseApprovedAt: locations.kitchenLicenseApprovedAt,
          managerName: users.username,
          managerEmail: users.username
          // simplified for now
        }).from(locations).leftJoin(users, eq25(locations.managerId, users.id));
        if (status) {
          query.where(eq25(locations.kitchenLicenseStatus, status));
        }
        const results = await query;
        const licenses = results.map((loc) => ({
          id: loc.id,
          name: loc.name,
          address: loc.address,
          managerId: loc.managerId,
          managerUsername: loc.managerName,
          kitchenLicenseUrl: loc.kitchenLicenseUrl,
          kitchenLicenseStatus: loc.kitchenLicenseStatus || "pending",
          kitchenLicenseExpiry: loc.kitchenLicenseExpiry,
          kitchenLicenseFeedback: loc.kitchenLicenseFeedback,
          kitchenLicenseApprovedAt: loc.kitchenLicenseApprovedAt
        }));
        res.json(licenses);
      } catch (error) {
        console.error("Error fetching location licenses:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location licenses" });
      }
    });
    router16.get("/locations/pending-licenses", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const pendingLicenses = await db.select({
          id: locations.id,
          name: locations.name,
          address: locations.address,
          managerId: locations.managerId,
          kitchenLicenseUrl: locations.kitchenLicenseUrl,
          kitchenLicenseStatus: locations.kitchenLicenseStatus,
          kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
          kitchenLicenseFeedback: locations.kitchenLicenseFeedback,
          managerName: users.username
        }).from(locations).leftJoin(users, eq25(locations.managerId, users.id)).where(eq25(locations.kitchenLicenseStatus, "pending"));
        const formatted = pendingLicenses.map((loc) => ({
          id: loc.id,
          name: loc.name,
          address: loc.address,
          managerId: loc.managerId,
          managerUsername: loc.managerName,
          kitchenLicenseUrl: loc.kitchenLicenseUrl,
          kitchenLicenseStatus: loc.kitchenLicenseStatus,
          kitchenLicenseExpiry: loc.kitchenLicenseExpiry,
          kitchenLicenseFeedback: loc.kitchenLicenseFeedback
        }));
        res.json(formatted);
      } catch (error) {
        console.error("Error fetching pending licenses:", error);
        res.status(500).json({ error: error.message || "Failed to fetch pending licenses" });
      }
    });
    router16.get("/locations/pending-licenses-count", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const result = await db.select({ count: sql9`count(*)::int` }).from(locations).where(eq25(locations.kitchenLicenseStatus, "pending"));
        const count2 = result[0]?.count || 0;
        res.json({ count: count2 });
      } catch (error) {
        res.status(500).json({ error: "Failed to get count" });
      }
    });
    router16.put("/locations/:id/kitchen-license", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const locationId = parseInt(req.params.id);
        const { status, feedback } = req.body;
        if (isNaN(locationId)) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        if (!["approved", "rejected", "pending"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        const updateData = {
          kitchenLicenseStatus: status,
          kitchenLicenseFeedback: feedback || null
        };
        if (status === "approved") {
          updateData.kitchenLicenseApprovedAt = /* @__PURE__ */ new Date();
        } else {
          updateData.kitchenLicenseApprovedAt = null;
        }
        await db.update(locations).set(updateData).where(eq25(locations.id, locationId));
        res.json({ message: "License status updated successfully" });
      } catch (error) {
        console.error("Error updating license status:", error);
        res.status(500).json({ error: error.message || "Failed to update license status" });
      }
    });
    router16.get("/locations", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const user = req.neonUser;
        const locations4 = await locationService.getAllLocations();
        const mappedLocations = locations4.map((loc) => ({
          ...loc,
          managerId: loc.managerId || loc.manager_id || null,
          notificationEmail: loc.notificationEmail || loc.notification_email || null,
          cancellationPolicyHours: loc.cancellationPolicyHours || loc.cancellation_policy_hours || 24,
          cancellationPolicyMessage: loc.cancellationPolicyMessage || loc.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
          defaultDailyBookingLimit: loc.defaultDailyBookingLimit || loc.default_daily_booking_limit || 2,
          createdAt: loc.createdAt || loc.created_at,
          updatedAt: loc.updatedAt || loc.updated_at
        }));
        res.json(mappedLocations);
      } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
      }
    });
    router16.post("/locations", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const user = req.neonUser;
        const { name, address, managerId } = req.body;
        let managerIdNum = void 0;
        if (managerId !== void 0 && managerId !== null && managerId !== "") {
          managerIdNum = parseInt(managerId.toString());
          if (isNaN(managerIdNum) || managerIdNum <= 0) {
            return res.status(400).json({ error: "Invalid manager ID format" });
          }
          const manager = await userService.getUser(managerIdNum);
          if (!manager) {
            return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
          }
          if (manager.role !== "manager") {
            return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
          }
        }
        let normalizedNotificationPhone = void 0;
        if (req.body.notificationPhone && req.body.notificationPhone.trim() !== "") {
          const normalized = normalizePhoneForStorage(req.body.notificationPhone);
          if (!normalized) {
            return res.status(400).json({
              error: "Invalid notification phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
            });
          }
          normalizedNotificationPhone = normalized;
        }
        const location = await locationService.createLocation({
          name,
          address,
          managerId: managerIdNum,
          notificationEmail: req.body.notificationEmail || void 0,
          notificationPhone: normalizedNotificationPhone
        });
        const mappedLocation = {
          ...location,
          managerId: location.managerId || location.manager_id || null,
          notificationEmail: location.notificationEmail || location.notification_email || null,
          notificationPhone: location.notificationPhone || location.notification_phone || null,
          cancellationPolicyHours: location.cancellationPolicyHours || location.cancellation_policy_hours || 24,
          cancellationPolicyMessage: location.cancellationPolicyMessage || location.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
          defaultDailyBookingLimit: location.defaultDailyBookingLimit || location.default_daily_booking_limit || 2,
          createdAt: location.createdAt || location.created_at,
          updatedAt: location.updatedAt || location.updated_at
        };
        res.status(201).json(mappedLocation);
      } catch (error) {
        console.error("Error creating location:", error);
        res.status(500).json({ error: error.message || "Failed to create location" });
      }
    });
    router16.get("/kitchens/:locationId", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId) || locationId <= 0) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const kitchens3 = await kitchenService.getKitchensByLocationId(locationId);
        res.json(kitchens3);
      } catch (error) {
        console.error("Error fetching kitchens:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
      }
    });
    router16.post("/kitchens", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const { locationId, name, description, taxRatePercent } = req.body;
        if (!locationId || !name) {
          return res.status(400).json({ error: "Location ID and name are required" });
        }
        const locationIdNum = parseInt(locationId.toString());
        if (isNaN(locationIdNum) || locationIdNum <= 0) {
          return res.status(400).json({ error: "Invalid location ID format" });
        }
        const location = await locationService.getLocationById(locationIdNum);
        if (!location) {
          return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
        }
        const kitchen = await kitchenService.createKitchen({
          locationId: locationIdNum,
          name,
          description,
          isActive: true,
          hourlyRate: void 0,
          minimumBookingHours: 1,
          pricingModel: "hourly",
          taxRatePercent: taxRatePercent ? parseFloat(taxRatePercent) : null
        });
        res.status(201).json(kitchen);
      } catch (error) {
        console.error("Error creating kitchen:", error);
        if (error.code === "23503") {
          return res.status(400).json({ error: "The selected location does not exist or is invalid." });
        }
        res.status(500).json({ error: error.message || "Failed to create kitchen" });
      }
    });
    router16.put("/locations/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const locationId = parseInt(req.params.id);
        if (isNaN(locationId) || locationId <= 0) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        const { name, address, managerId, notificationEmail, notificationPhone } = req.body;
        let managerIdNum = void 0;
        if (managerId !== void 0 && managerId !== null && managerId !== "") {
          managerIdNum = parseInt(managerId.toString());
          if (isNaN(managerIdNum) || managerIdNum <= 0) {
            return res.status(400).json({ error: "Invalid manager ID format" });
          }
          const manager = await userService.getUser(managerIdNum);
          if (!manager) {
            return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
          }
          if (manager.role !== "manager") {
            return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
          }
        } else if (managerId === null || managerId === "") {
          managerIdNum = null;
        }
        const updates = {};
        if (name !== void 0) updates.name = name;
        if (address !== void 0) updates.address = address;
        if (managerIdNum !== void 0) updates.managerId = managerIdNum;
        if (notificationEmail !== void 0) updates.notificationEmail = notificationEmail || null;
        if (notificationPhone !== void 0) {
          if (notificationPhone && notificationPhone.trim() !== "") {
            const normalized = normalizePhoneForStorage(notificationPhone);
            if (!normalized) {
              return res.status(400).json({
                error: "Invalid phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
              });
            }
            updates.notificationPhone = normalized;
          } else {
            updates.notificationPhone = null;
          }
        }
        const updated = await locationService.updateLocation({ id: locationId, ...updates });
        if (!updated) {
          return res.status(404).json({ error: "Location not found" });
        }
        const mappedLocation = {
          ...updated,
          managerId: updated.managerId || updated.manager_id || null,
          notificationEmail: updated.notificationEmail || updated.notification_email || null,
          cancellationPolicyHours: updated.cancellationPolicyHours || updated.cancellation_policy_hours || 24,
          cancellationPolicyMessage: updated.cancellationPolicyMessage || updated.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
          defaultDailyBookingLimit: updated.defaultDailyBookingLimit || updated.default_daily_booking_limit || 2,
          createdAt: updated.createdAt || updated.created_at,
          updatedAt: updated.updatedAt || updated.updated_at
        };
        return res.json(mappedLocation);
      } catch (error) {
        console.error("Error updating location:", error);
        res.status(500).json({ error: error.message || "Failed to update location" });
      }
    });
    router16.delete("/locations/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const locationId = parseInt(req.params.id);
        if (isNaN(locationId) || locationId <= 0) {
          return res.status(400).json({ error: "Invalid location ID" });
        }
        await locationService.deleteLocation(locationId);
        res.json({ success: true, message: "Location deleted successfully" });
      } catch (error) {
        console.error("Error deleting location:", error);
        res.status(500).json({ error: error.message || "Failed to delete location" });
      }
    });
    router16.put("/kitchens/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const kitchenId = parseInt(req.params.id);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const currentKitchen = await kitchenService.getKitchenById(kitchenId);
        if (!currentKitchen) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const { name, description, isActive, locationId, taxRatePercent } = req.body;
        const updates = {};
        const changesList = [];
        if (name !== void 0 && name !== currentKitchen.name) {
          updates.name = name;
          changesList.push(`Name changed to "${name}"`);
        }
        if (description !== void 0 && description !== currentKitchen.description) {
          updates.description = description;
          changesList.push(`Description updated`);
        }
        if (isActive !== void 0 && isActive !== currentKitchen.isActive) {
          updates.isActive = isActive;
          changesList.push(`Status changed to ${isActive ? "Active" : "Inactive"}`);
        }
        if (locationId !== void 0) {
          const locationIdNum = parseInt(locationId.toString());
          if (isNaN(locationIdNum) || locationIdNum <= 0) {
            return res.status(400).json({ error: "Invalid location ID format" });
          }
          const location = await locationService.getLocationById(locationIdNum);
          if (!location) {
            return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
          }
          if (locationIdNum !== currentKitchen.locationId) {
            updates.locationId = locationIdNum;
            changesList.push(`Location changed to "${location.name}"`);
          }
        }
        if (taxRatePercent !== void 0) {
          const newRate = taxRatePercent ? parseFloat(taxRatePercent) : null;
          if (newRate !== currentKitchen.taxRatePercent) {
            updates.taxRatePercent = newRate;
            changesList.push(`Tax rate changed to ${newRate ? newRate + "%" : "None"}`);
          }
        }
        if (Object.keys(updates).length === 0) {
          return res.json(currentKitchen);
        }
        const updated = await kitchenService.updateKitchen({ id: kitchenId, ...updates });
        if (!updated) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        if (changesList.length > 0) {
          try {
            const kitchen = await kitchenService.getKitchenById(kitchenId);
            if (kitchen) {
              const location = await locationService.getLocationById(kitchen.locationId);
              const bookings = await bookingService.getBookingsByKitchenId(kitchenId);
              const customChefIds = bookings.map((b) => b.chefId).filter((id) => id !== null);
              const uniqueChefIds = Array.from(new Set(customChefIds));
              const changes = changesList.join(", ");
              for (const chefId of uniqueChefIds) {
                try {
                  const chef = await userService.getUser(chefId);
                  if (chef) {
                    const email = generateKitchenSettingsChangeEmail({
                      email: chef.username,
                      name: chef.displayName || chef.username || "Chef",
                      kitchenName: kitchen.name,
                      changes,
                      isChef: true
                    });
                    await sendEmail(email);
                  }
                } catch (emailError) {
                  console.error(`Error sending email to chef ${chefId}:`, emailError);
                }
              }
              if (location?.managerId) {
                try {
                  const manager = await userService.getUser(location.managerId);
                  if (manager) {
                    const notificationEmail = location.notificationEmail || location.notification_email || manager.username;
                    const email = generateKitchenSettingsChangeEmail({
                      email: notificationEmail,
                      name: manager.username,
                      kitchenName: kitchen.name,
                      changes,
                      isChef: false
                    });
                    await sendEmail(email);
                  }
                } catch (emailError) {
                  console.error(`Error sending email to manager:`, emailError);
                }
              }
            }
          } catch (emailError) {
            console.error("Error sending kitchen settings change emails:", emailError);
          }
        }
        res.json(updated);
      } catch (error) {
        console.error("Error updating kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to update kitchen" });
      }
    });
    router16.delete("/kitchens/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const kitchenId = parseInt(req.params.id);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        await kitchenService.deleteKitchen(kitchenId);
        res.json({ success: true, message: "Kitchen deleted successfully" });
      } catch (error) {
        console.error("Error deleting kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to delete kitchen" });
      }
    });
    router16.put("/managers/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const managerId = parseInt(req.params.id);
        if (isNaN(managerId) || managerId <= 0) {
          return res.status(400).json({ error: "Invalid manager ID" });
        }
        const { username, role, isManager, locationNotificationEmails } = req.body;
        const manager = await userService.getUser(managerId);
        if (!manager) {
          return res.status(404).json({ error: "Manager not found" });
        }
        if (manager.role !== "manager") {
          return res.status(400).json({ error: "User is not a manager" });
        }
        const updates = {};
        if (username !== void 0) {
          const existingUser = await userService.getUserByUsername(username);
          if (existingUser && existingUser.id !== managerId) {
            return res.status(400).json({ error: "Username already exists" });
          }
          updates.username = username;
        }
        if (role !== void 0) updates.role = role;
        if (isManager !== void 0) updates.isManager = isManager;
        const updated = await userService.updateUser(managerId, updates);
        if (!updated) {
          return res.status(404).json({ error: "Failed to update manager" });
        }
        if (locationNotificationEmails && Array.isArray(locationNotificationEmails)) {
          const { db: db2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const { locations: locations5 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
          const { eq: eq31 } = await import("drizzle-orm");
          for (const emailUpdate of locationNotificationEmails) {
            if (emailUpdate.locationId && emailUpdate.notificationEmail !== void 0) {
              const locationId = parseInt(emailUpdate.locationId.toString());
              if (!isNaN(locationId)) {
                const email = emailUpdate.notificationEmail?.trim() || "";
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  continue;
                }
                await db2.update(locations5).set({
                  notificationEmail: email || null,
                  updatedAt: /* @__PURE__ */ new Date()
                }).where(eq31(locations5.id, locationId));
              }
            }
          }
        }
        const { locations: locations4 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
        const { eq: eq30 } = await import("drizzle-orm");
        const managedLocations = await db.select().from(locations4).where(eq30(locations4.managerId, managerId));
        const notificationEmails = managedLocations.map((loc) => loc.notificationEmail || loc.notification_email).filter((email) => email && email.trim() !== "");
        const response = {
          ...updated,
          locations: managedLocations.map((loc) => ({
            locationId: loc.id,
            locationName: loc.name,
            notificationEmail: loc.notificationEmail || loc.notification_email || null
          })),
          notificationEmails,
          primaryNotificationEmail: notificationEmails.length > 0 ? notificationEmails[0] : null
        };
        res.json(response);
      } catch (error) {
        console.error("Error updating manager:", error);
        res.status(500).json({ error: error.message || "Failed to update manager" });
      }
    });
    router16.delete("/managers/:id", async (req, res) => {
      try {
        const sessionUser = await getAuthenticatedUser2(req);
        const isFirebaseAuth = req.neonUser;
        if (!sessionUser && !isFirebaseAuth) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const user = isFirebaseAuth ? req.neonUser : sessionUser;
        if (user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }
        const managerId = parseInt(req.params.id);
        if (isNaN(managerId) || managerId <= 0) {
          return res.status(400).json({ error: "Invalid manager ID" });
        }
        if (managerId === user.id) {
          return res.status(400).json({ error: "You cannot delete your own account" });
        }
        const manager = await userService.getUser(managerId);
        if (!manager) {
          return res.status(404).json({ error: "Manager not found" });
        }
        if (manager.role !== "manager") {
          return res.status(400).json({ error: "User is not a manager" });
        }
        await userService.deleteUser(managerId);
        res.json({ success: true, message: "Manager deleted successfully" });
      } catch (error) {
        console.error("Error deleting manager:", error);
        res.status(500).json({ error: error.message || "Failed to delete manager" });
      }
    });
    router16.post("/test-email", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const user = req.neonUser;
        console.log(`POST /api/admin/test-email - User ID: ${user.id}`);
        const {
          email,
          subject,
          previewText,
          sections,
          header,
          footer,
          usageSteps,
          emailContainer,
          customDesign
        } = req.body;
        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }
        console.log("Test email request - Validation passed, generating test email");
        const emailContent = generatePromoCodeEmail({
          email,
          promoCode: "TEST123",
          promoCodeLabel: "\u{1F381} Test Promo Code",
          customMessage: "This is a test email to verify the email system is working correctly.",
          greeting: "Hello! \u{1F44B}",
          subject: subject || "Test Email from Local Cooks",
          previewText: previewText || "Test email preview",
          designSystem: customDesign?.designSystem,
          isPremium: true,
          sections: sections || [],
          header: header || {
            title: "Local Cooks Header",
            subtitle: "Premium Quality Food Subheader",
            styling: {
              backgroundColor: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
              titleColor: "#ffffff",
              subtitleColor: "#ffffff",
              titleFontSize: "32px",
              subtitleFontSize: "18px",
              padding: "24px",
              borderRadius: "0px",
              textAlign: "center"
            }
          },
          footer: footer || {
            mainText: "Thank you for being part of the Local Cooks community!",
            contactText: "Questions? Contact us at support@localcooks.com",
            copyrightText: "\xA9 2024 Local Cooks. All rights reserved.",
            showContact: true,
            showCopyright: true,
            styling: {
              backgroundColor: "#f8fafc",
              textColor: "#64748b",
              linkColor: "#F51042",
              fontSize: "14px",
              padding: "24px 32px",
              textAlign: "center",
              borderColor: "#e2e8f0"
            }
          },
          usageSteps: usageSteps || {
            title: "\u{1F680} How to use your promo code:",
            steps: [
              'Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>',
              "Browse our amazing local cooks and their delicious offerings",
              "Apply your promo code during checkout",
              "Enjoy your special offer!"
            ],
            enabled: true,
            styling: {
              backgroundColor: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              borderColor: "#93c5fd",
              titleColor: "#1d4ed8",
              textColor: "#1e40af",
              linkColor: "#1d4ed8",
              padding: "20px",
              borderRadius: "8px"
            }
          },
          emailContainer: emailContainer || {
            maxWidth: "600px",
            backgroundColor: "#f1f5f9",
            borderRadius: "12px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
          },
          dividers: {
            enabled: true,
            style: "solid",
            color: "#e2e8f0",
            thickness: "1px",
            margin: "24px 0",
            opacity: "1"
          },
          promoStyle: { colorTheme: "green", borderStyle: "dashed" },
          orderButton: {
            text: "\u{1F31F} Test Order Button",
            url: "https://localcooks.ca",
            styling: {
              backgroundColor: "#F51042",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: "600",
              padding: "12px 24px",
              borderRadius: "8px",
              textAlign: "center"
            }
          }
        });
        const emailSent = await sendEmail(emailContent, {
          trackingId: `test_email_${email}_${Date.now()}`
        });
        if (emailSent) {
          console.log(`Test email sent successfully to ${email}`);
          res.json({
            success: true,
            message: "Test email sent successfully",
            recipient: email
          });
        } else {
          console.error(`Failed to send test email to ${email}`);
          res.status(500).json({
            error: "Failed to send email",
            message: "Email service unavailable"
          });
        }
      } catch (error) {
        console.error("Error sending test email:", error);
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });
    router16.post("/send-promo-email", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
      try {
        const user = req.neonUser;
        console.log(`POST /api/admin/send-promo-email - User ID: ${user.id}`);
        const {
          email,
          customEmails,
          emailMode,
          recipients,
          promoCode,
          promoCodeLabel,
          message,
          customMessage,
          greeting,
          buttonText,
          orderUrl,
          subject,
          previewText,
          designSystem,
          isPremium,
          sections,
          header,
          footer,
          usageSteps,
          emailContainer,
          dividers,
          promoCodeStyling,
          promoStyle,
          customDesign
        } = req.body;
        const messageContent = customMessage || message;
        let targetEmails = [];
        if (recipients && Array.isArray(recipients) && recipients.length > 0) {
          targetEmails = recipients.map(
            (recipient) => typeof recipient === "string" ? recipient : recipient.email
          ).filter(Boolean);
        } else if (emailMode === "custom" && customEmails && Array.isArray(customEmails)) {
          targetEmails = customEmails;
        } else if (email) {
          targetEmails = [email];
        }
        if (targetEmails.length === 0) {
          return res.status(400).json({ error: "At least one email address is required" });
        }
        const results = [];
        let successCount = 0;
        let failureCount = 0;
        for (const targetEmail of targetEmails) {
          try {
            const emailContent = generatePromoCodeEmail({
              email: targetEmail,
              promoCode,
              promoCodeLabel: promoCodeLabel || "\u{1F381} Special Offer Code For You",
              customMessage: messageContent,
              greeting: greeting || "Hi there! \u{1F44B}",
              subject: subject || "Special Offer from Local Cooks",
              previewText: previewText || "Don't miss out on this exclusive offer",
              designSystem,
              isPremium: isPremium || true,
              sections: sections || [],
              header,
              footer,
              usageSteps,
              emailContainer,
              dividers,
              promoCodeStyling,
              promoStyle,
              orderButton: {
                text: buttonText || "\u{1F31F} Start Shopping Now",
                url: orderUrl || "https://localcooks.ca",
                styling: {
                  backgroundColor: "#F51042",
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: "600",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  textAlign: "center"
                }
              }
            });
            const emailSent = await sendEmail(emailContent, {
              trackingId: `promo_email_${targetEmail}_${Date.now()}`
            });
            if (emailSent) {
              results.push({ email: targetEmail, status: "success" });
              successCount++;
            } else {
              results.push({ email: targetEmail, status: "failed", error: "Email sending failed" });
              failureCount++;
            }
          } catch (error) {
            console.error(`Error sending promo email to ${targetEmail}:`, error);
            results.push({ email: targetEmail, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
            failureCount++;
          }
        }
        if (successCount > 0) {
          res.json({
            success: true,
            message: `Promo emails sent: ${successCount} successful, ${failureCount} failed`,
            results
          });
        } else {
          res.status(500).json({
            error: "All email sending failed",
            message: "Failed to send promo emails to any recipients.",
            results
          });
        }
      } catch (error) {
        console.error("Error sending promo email:", error);
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });
    admin_default = router16;
  }
});

// server/services/payment-transactions-service.ts
var payment_transactions_service_exports = {};
__export(payment_transactions_service_exports, {
  addPaymentHistory: () => addPaymentHistory,
  createPaymentTransaction: () => createPaymentTransaction,
  findPaymentTransactionByBooking: () => findPaymentTransactionByBooking,
  findPaymentTransactionByIntentId: () => findPaymentTransactionByIntentId,
  getManagerPaymentTransactions: () => getManagerPaymentTransactions,
  getPaymentHistory: () => getPaymentHistory,
  syncExistingPaymentTransactionsFromStripe: () => syncExistingPaymentTransactionsFromStripe,
  syncStripeAmountsToBookings: () => syncStripeAmountsToBookings,
  updatePaymentTransaction: () => updatePaymentTransaction
});
import { sql as sql10 } from "drizzle-orm";
async function createPaymentTransaction(params, db2) {
  const {
    bookingId,
    bookingType,
    chefId,
    managerId,
    amount,
    baseAmount,
    serviceFee,
    managerRevenue,
    currency = "CAD",
    paymentIntentId,
    paymentMethodId,
    status = "pending",
    stripeStatus,
    metadata = {}
  } = params;
  const netAmount = amount;
  const result = await db2.execute(sql10`
    INSERT INTO payment_transactions (
      booking_id,
      booking_type,
      chef_id,
      manager_id,
      amount,
      base_amount,
      service_fee,
      manager_revenue,
      refund_amount,
      net_amount,
      currency,
      payment_intent_id,
      payment_method_id,
      status,
      stripe_status,
      metadata
    ) VALUES (
      ${bookingId},
      ${bookingType},
      ${chefId},
      ${managerId},
      ${amount.toString()},
      ${baseAmount.toString()},
      ${serviceFee.toString()},
      ${managerRevenue.toString()},
      '0',
      ${netAmount.toString()},
      ${currency},
      ${paymentIntentId || null},
      ${paymentMethodId || null},
      ${status},
      ${stripeStatus || null},
      ${JSON.stringify(metadata)}
    )
    RETURNING *
  `);
  const record = result.rows[0];
  await addPaymentHistory(
    record.id,
    {
      previousStatus: null,
      newStatus: status,
      eventType: "created",
      eventSource: "system",
      description: `Payment transaction created for ${bookingType} booking ${bookingId}`,
      metadata: { initialAmount: amount, baseAmount, serviceFee, managerRevenue }
    },
    db2
  );
  return record;
}
async function updatePaymentTransaction(transactionId, params, db2) {
  const currentResult = await db2.execute(sql10`
    SELECT status, refund_amount, amount
    FROM payment_transactions
    WHERE id = ${transactionId}
  `);
  if (currentResult.rows.length === 0) {
    return null;
  }
  const current = currentResult.rows[0];
  const previousStatus = current.status;
  const currentRefundAmount = parseFloat(current.refund_amount || "0");
  const currentAmount = parseFloat(current.amount || "0");
  const updates = [];
  if (params.status !== void 0) {
    updates.push(sql10`status = ${params.status}`);
  }
  if (params.stripeStatus !== void 0) {
    updates.push(sql10`stripe_status = ${params.stripeStatus}`);
  }
  if (params.chargeId !== void 0) {
    updates.push(sql10`charge_id = ${params.chargeId}`);
  }
  if (params.refundId !== void 0) {
    updates.push(sql10`refund_id = ${params.refundId}`);
  }
  if (params.refundAmount !== void 0) {
    updates.push(sql10`refund_amount = ${params.refundAmount.toString()}`);
    const newRefundAmount = params.refundAmount;
    const netAmount = currentAmount - newRefundAmount;
    updates.push(sql10`net_amount = ${netAmount.toString()}`);
  }
  if (params.refundReason !== void 0) {
    updates.push(sql10`refund_reason = ${params.refundReason}`);
  }
  if (params.failureReason !== void 0) {
    updates.push(sql10`failure_reason = ${params.failureReason}`);
  }
  if (params.paidAt !== void 0) {
    updates.push(sql10`paid_at = ${params.paidAt}`);
  }
  if (params.refundedAt !== void 0) {
    updates.push(sql10`refunded_at = ${params.refundedAt}`);
  }
  if (params.lastSyncedAt !== void 0) {
    updates.push(sql10`last_synced_at = ${params.lastSyncedAt}`);
  }
  if (params.webhookEventId !== void 0) {
    updates.push(sql10`webhook_event_id = ${params.webhookEventId}`);
  }
  if (params.stripeAmount !== void 0 || params.stripeNetAmount !== void 0) {
    if (params.stripeAmount !== void 0) {
      updates.push(sql10`amount = ${params.stripeAmount.toString()}`);
    }
    if (params.stripeNetAmount !== void 0) {
      updates.push(sql10`net_amount = ${params.stripeNetAmount.toString()}`);
      updates.push(sql10`manager_revenue = ${params.stripeNetAmount.toString()}`);
    }
    if (params.stripePlatformFee !== void 0 && params.stripePlatformFee > 0) {
      updates.push(sql10`service_fee = ${params.stripePlatformFee.toString()}`);
    } else if (params.stripeAmount !== void 0 && params.stripeNetAmount !== void 0) {
      const totalFees = params.stripeAmount - params.stripeNetAmount;
      const processingFee = params.stripeProcessingFee || 0;
      const actualPlatformFee = Math.max(0, totalFees - processingFee);
      updates.push(sql10`service_fee = ${actualPlatformFee.toString()}`);
    }
    if (params.stripeAmount !== void 0) {
      const platformFee = params.stripePlatformFee || (params.stripeAmount !== void 0 && params.stripeNetAmount !== void 0 ? Math.max(0, params.stripeAmount - params.stripeNetAmount - (params.stripeProcessingFee || 0)) : 0);
      const baseAmount = params.stripeAmount - platformFee;
      updates.push(sql10`base_amount = ${baseAmount.toString()}`);
    }
    const currentMetadataResult = await db2.execute(sql10`
      SELECT metadata FROM payment_transactions WHERE id = ${transactionId}
    `);
    const currentMetadata = currentMetadataResult.rows[0]?.metadata ? typeof currentMetadataResult.rows[0].metadata === "string" ? JSON.parse(currentMetadataResult.rows[0].metadata) : currentMetadataResult.rows[0].metadata : {};
    const stripeFees = {
      processingFee: params.stripeProcessingFee || 0,
      platformFee: params.stripePlatformFee || 0,
      syncedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const updatedMetadata = {
      ...currentMetadata,
      stripeFees
    };
    updates.push(sql10`metadata = ${JSON.stringify(updatedMetadata)}`);
  } else if (params.metadata !== void 0) {
    updates.push(sql10`metadata = ${JSON.stringify(params.metadata)}`);
  }
  if (updates.length === 0) {
    const result2 = await db2.execute(sql10`
      SELECT * FROM payment_transactions WHERE id = ${transactionId}
    `);
    return result2.rows[0];
  }
  const result = await db2.execute(sql10`
    UPDATE payment_transactions
    SET ${sql10.join(updates, sql10`, `)}, updated_at = NOW()
    WHERE id = ${transactionId}
    RETURNING *
  `);
  const updated = result.rows[0];
  if (params.status !== void 0 && params.status !== previousStatus) {
    const historyMetadata = { ...params.metadata || {} };
    if (params.stripeAmount !== void 0 || params.stripeNetAmount !== void 0) {
      historyMetadata.stripeAmounts = {
        amount: params.stripeAmount,
        netAmount: params.stripeNetAmount,
        processingFee: params.stripeProcessingFee,
        platformFee: params.stripePlatformFee,
        syncedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    await addPaymentHistory(
      transactionId,
      {
        previousStatus,
        newStatus: params.status,
        eventType: "status_change",
        eventSource: params.webhookEventId ? "stripe_webhook" : "system",
        description: `Status changed from ${previousStatus} to ${params.status}${params.stripeAmount !== void 0 ? " (Stripe amounts synced)" : ""}`,
        stripeEventId: params.webhookEventId,
        metadata: historyMetadata
      },
      db2
    );
  }
  if ((params.stripeAmount !== void 0 || params.stripeNetAmount !== void 0) && params.status === void 0) {
    await addPaymentHistory(
      transactionId,
      {
        previousStatus: updated.status,
        newStatus: updated.status,
        eventType: "stripe_sync",
        eventSource: params.webhookEventId ? "stripe_webhook" : "system",
        description: `Stripe amounts synced: Amount $${((params.stripeAmount || parseFloat(updated.amount || "0")) / 100).toFixed(2)}, Net $${((params.stripeNetAmount || parseFloat(updated.net_amount || "0")) / 100).toFixed(2)}`,
        stripeEventId: params.webhookEventId,
        metadata: {
          stripeAmounts: {
            amount: params.stripeAmount,
            netAmount: params.stripeNetAmount,
            processingFee: params.stripeProcessingFee,
            platformFee: params.stripePlatformFee,
            syncedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        }
      },
      db2
    );
  }
  if (params.refundAmount !== void 0 && params.refundAmount > currentRefundAmount) {
    await addPaymentHistory(
      transactionId,
      {
        previousStatus,
        newStatus: updated.status,
        eventType: params.refundAmount === parseFloat(updated.amount || "0") ? "refund" : "partial_refund",
        eventSource: params.webhookEventId ? "stripe_webhook" : "system",
        description: `Refund of ${params.refundAmount / 100} ${updated.currency}${params.refundReason ? `: ${params.refundReason}` : ""}`,
        stripeEventId: params.webhookEventId,
        metadata: {
          refundAmount: params.refundAmount,
          refundReason: params.refundReason,
          refundId: params.refundId
        }
      },
      db2
    );
  }
  return updated;
}
async function syncStripeAmountsToBookings(paymentIntentId, stripeAmounts, db2) {
  try {
    const transactionResult = await db2.execute(sql10`
      SELECT 
        pt.id,
        pt.booking_id,
        pt.booking_type,
        pt.base_amount,
        pt.service_fee,
        pt.amount as current_amount,
        pt.manager_revenue as current_manager_revenue
      FROM payment_transactions pt
      WHERE pt.payment_intent_id = ${paymentIntentId}
    `);
    if (transactionResult.rows.length === 0) {
      console.warn(`[Stripe Sync] No payment transaction found for PaymentIntent ${paymentIntentId}`);
      return;
    }
    const transaction = transactionResult.rows[0];
    const bookingId = transaction.booking_id;
    const bookingType = transaction.booking_type;
    if (bookingType === "bundle") {
      const kitchenBooking = await db2.execute(sql10`
        SELECT id, total_price, service_fee
        FROM kitchen_bookings
        WHERE id = ${bookingId}
      `);
      const storageBookings2 = await db2.execute(sql10`
        SELECT id, total_price, service_fee
        FROM storage_bookings
        WHERE kitchen_booking_id = ${bookingId}
      `);
      const equipmentBookings2 = await db2.execute(sql10`
        SELECT id, total_price, service_fee
        FROM equipment_bookings
        WHERE kitchen_booking_id = ${bookingId}
      `);
      let totalBaseAmount = parseFloat(transaction.base_amount || "0");
      if (totalBaseAmount === 0) {
        const kbAmount = parseFloat(kitchenBooking.rows[0]?.total_price || "0");
        const sbAmount = storageBookings2.rows.reduce((sum, sb) => sum + parseFloat(sb.total_price || "0"), 0);
        const ebAmount = equipmentBookings2.rows.reduce((sum, eb) => sum + parseFloat(eb.total_price || "0"), 0);
        totalBaseAmount = kbAmount + sbAmount + ebAmount;
      }
      if (kitchenBooking.rows.length > 0 && totalBaseAmount > 0) {
        const kbBase = parseFloat(kitchenBooking.rows[0].total_price || "0");
        const kbProportion = kbBase / totalBaseAmount;
        const kbStripeAmount = Math.round(stripeAmounts.stripeAmount * kbProportion);
        const kbStripeNet = Math.round(stripeAmounts.stripeNetAmount * kbProportion);
        const kbServiceFee = stripeAmounts.stripePlatformFee > 0 ? Math.round(stripeAmounts.stripePlatformFee * kbProportion) : Math.round((kbStripeAmount - kbStripeNet) * 0.5);
        await db2.execute(sql10`
          UPDATE kitchen_bookings
          SET 
            total_price = ${kbStripeAmount.toString()},
            service_fee = ${kbServiceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      }
      for (const sb of storageBookings2.rows) {
        const sbBase = parseFloat(sb.total_price || "0");
        if (totalBaseAmount > 0 && sbBase > 0) {
          const sbProportion = sbBase / totalBaseAmount;
          const sbStripeAmount = Math.round(stripeAmounts.stripeAmount * sbProportion);
          const sbStripeNet = Math.round(stripeAmounts.stripeNetAmount * sbProportion);
          const sbServiceFee = stripeAmounts.stripePlatformFee > 0 ? Math.round(stripeAmounts.stripePlatformFee * sbProportion) : Math.round((sbStripeAmount - sbStripeNet) * 0.5);
          await db2.execute(sql10`
            UPDATE storage_bookings
            SET 
              total_price = ${sbStripeAmount.toString()},
              service_fee = ${sbServiceFee.toString()},
              updated_at = NOW()
            WHERE id = ${sb.id}
          `);
        }
      }
      for (const eb of equipmentBookings2.rows) {
        const ebBase = parseFloat(eb.total_price || "0");
        if (totalBaseAmount > 0 && ebBase > 0) {
          const ebProportion = ebBase / totalBaseAmount;
          const ebStripeAmount = Math.round(stripeAmounts.stripeAmount * ebProportion);
          const ebStripeNet = Math.round(stripeAmounts.stripeNetAmount * ebProportion);
          const ebServiceFee = stripeAmounts.stripePlatformFee > 0 ? Math.round(stripeAmounts.stripePlatformFee * ebProportion) : Math.round((ebStripeAmount - ebStripeNet) * 0.5);
          await db2.execute(sql10`
            UPDATE equipment_bookings
            SET 
              total_price = ${ebStripeAmount.toString()},
              service_fee = ${ebServiceFee.toString()},
              updated_at = NOW()
            WHERE id = ${eb.id}
          `);
        }
      }
    } else {
      const serviceFee = stripeAmounts.stripePlatformFee > 0 ? stripeAmounts.stripePlatformFee : Math.max(0, stripeAmounts.stripeAmount - stripeAmounts.stripeNetAmount - stripeAmounts.stripeProcessingFee);
      if (bookingType === "kitchen") {
        await db2.execute(sql10`
          UPDATE kitchen_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      } else if (bookingType === "storage") {
        await db2.execute(sql10`
          UPDATE storage_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      } else if (bookingType === "equipment") {
        await db2.execute(sql10`
          UPDATE equipment_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      }
    }
    console.log(`[Stripe Sync] Synced Stripe amounts to ${bookingType} booking(s) for PaymentIntent ${paymentIntentId}`);
  } catch (error) {
    console.error(`[Stripe Sync] Error syncing Stripe amounts to bookings for ${paymentIntentId}:`, error);
  }
}
async function syncExistingPaymentTransactionsFromStripe(managerId, db2, options) {
  let getStripePaymentAmounts2;
  const importPaths = [
    "./stripe-service",
    // Path 1: Relative without extension (works in some builds)
    "./stripe-service.js",
    // Path 2: Relative with .js extension (standard)
    "../server/services/stripe-service.js"
    // Path 3: From api/ perspective
  ];
  let lastError = null;
  for (const importPath of importPaths) {
    try {
      const mod = await import(importPath);
      if (mod.getStripePaymentAmounts) {
        getStripePaymentAmounts2 = mod.getStripePaymentAmounts;
        break;
      }
    } catch (e) {
      lastError = e;
      continue;
    }
  }
  if (!getStripePaymentAmounts2) {
    console.error("[Stripe Sync] Failed to import stripe-service from all paths:", importPaths);
    throw new Error(`Cannot import stripe-service from any path. Last error: ${lastError?.message || "Unknown"}`);
  }
  const limit = options?.limit || 1e3;
  const onlyUnsynced = options?.onlyUnsynced !== false;
  try {
    const params = [managerId];
    const unsyncedFilter = onlyUnsynced ? sql10` AND (pt.last_synced_at IS NULL OR pt.metadata->>'stripeFees' IS NULL)` : sql10``;
    const result = await db2.execute(sql10`
      SELECT 
        pt.id,
        pt.payment_intent_id,
        pt.manager_id,
        pt.booking_id,
        pt.booking_type,
        pt.amount as current_amount,
        pt.manager_revenue as current_manager_revenue,
        pt.last_synced_at
      FROM payment_transactions pt
      WHERE pt.payment_intent_id IS NOT NULL
        AND pt.status IN ('succeeded', 'processing')
        AND (
          pt.manager_id = ${managerId} 
          OR EXISTS (
            SELECT 1 FROM kitchen_bookings kb
            JOIN kitchens k ON kb.kitchen_id = k.id
            JOIN locations l ON k.location_id = l.id
            WHERE kb.id = pt.booking_id 
              AND l.manager_id = ${managerId}
          )
        )
      ${unsyncedFilter}
      ORDER BY pt.created_at DESC
      LIMIT ${limit}
    `);
    const transactions = result.rows;
    console.log(`[Stripe Sync] Found ${transactions.length} payment transactions to sync for manager ${managerId}`);
    let synced = 0;
    let failed = 0;
    const errors = [];
    for (const transaction of transactions) {
      const paymentIntentId = transaction.payment_intent_id;
      if (!paymentIntentId) continue;
      try {
        let managerConnectAccountId;
        try {
          const managerResult = await db2.execute(sql10`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${transaction.manager_id || managerId} AND stripe_connect_account_id IS NOT NULL
          `);
          if (managerResult.rows.length > 0) {
            managerConnectAccountId = managerResult.rows[0].stripe_connect_account_id;
          }
        } catch (error) {
          console.warn(`[Stripe Sync] Could not fetch manager Connect account:`, error);
        }
        const stripeAmounts = await getStripePaymentAmounts2(paymentIntentId, managerConnectAccountId);
        if (!stripeAmounts) {
          console.warn(`[Stripe Sync] Could not fetch Stripe amounts for ${paymentIntentId}`);
          failed++;
          errors.push({ paymentIntentId, error: "Could not fetch Stripe amounts" });
          continue;
        }
        await updatePaymentTransaction(transaction.id, {
          stripeAmount: stripeAmounts.stripeAmount,
          stripeNetAmount: stripeAmounts.stripeNetAmount,
          stripeProcessingFee: stripeAmounts.stripeProcessingFee,
          stripePlatformFee: stripeAmounts.stripePlatformFee,
          lastSyncedAt: /* @__PURE__ */ new Date()
        }, db2);
        await syncStripeAmountsToBookings(paymentIntentId, stripeAmounts, db2);
        synced++;
        console.log(`[Stripe Sync] Synced transaction ${transaction.id} (PaymentIntent: ${paymentIntentId})`);
      } catch (error) {
        console.error(`[Stripe Sync] Error syncing transaction ${transaction.id} (${paymentIntentId}):`, error);
        failed++;
        errors.push({ paymentIntentId, error: error.message || "Unknown error" });
      }
    }
    console.log(`[Stripe Sync] Completed: ${synced} synced, ${failed} failed`);
    return { synced, failed, errors };
  } catch (error) {
    console.error(`[Stripe Sync] Error syncing existing transactions:`, error);
    throw error;
  }
}
async function findPaymentTransactionByIntentId(paymentIntentId, db2) {
  const result = await db2.execute(sql10`
    SELECT * FROM payment_transactions
    WHERE payment_intent_id = ${paymentIntentId}
    LIMIT 1
  `);
  return result.rows[0];
}
async function findPaymentTransactionByBooking(bookingId, bookingType, db2) {
  const result = await db2.execute(sql10`
    SELECT * FROM payment_transactions
    WHERE booking_id = ${bookingId} AND booking_type = ${bookingType}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return result.rows[0];
}
async function addPaymentHistory(transactionId, history, db2) {
  await db2.execute(sql10`
    INSERT INTO payment_history (
      transaction_id,
      previous_status,
      new_status,
      event_type,
      event_source,
      stripe_event_id,
      description,
      metadata,
      created_by
    ) VALUES (
      ${transactionId},
      ${history.previousStatus},
      ${history.newStatus},
      ${history.eventType},
      ${history.eventSource || "system"},
      ${history.stripeEventId || null},
      ${history.description || null},
      ${JSON.stringify(history.metadata || {})},
      ${history.createdBy || null}
    )
  `);
}
async function getPaymentHistory(transactionId, db2) {
  const result = await db2.execute(sql10`
    SELECT * FROM payment_history
    WHERE transaction_id = ${transactionId}
    ORDER BY created_at ASC
  `);
  return result.rows;
}
async function getManagerPaymentTransactions(managerId, db2, filters) {
  const whereConditions = [sql10`manager_id = ${managerId}`];
  if (filters?.status) {
    whereConditions.push(sql10`status = ${filters.status}`);
  }
  if (filters?.startDate) {
    whereConditions.push(sql10`
      (
        (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at >= ${filters.startDate})
        OR (status != 'succeeded' AND created_at >= ${filters.startDate})
      )
    `);
  }
  if (filters?.endDate) {
    whereConditions.push(sql10`
      (
        (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at <= ${filters.endDate})
        OR (status != 'succeeded' AND created_at <= ${filters.endDate})
      )
    `);
  }
  const whereClause = sql10`WHERE ${sql10.join(whereConditions, sql10` AND `)}`;
  const countResult = await db2.execute(sql10`
    SELECT COUNT(*) as total FROM payment_transactions ${whereClause}
  `);
  const total = parseInt(countResult.rows[0].total);
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  const result = await db2.execute(sql10`
    SELECT * FROM payment_transactions
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN status = 'succeeded' AND paid_at IS NOT NULL 
        THEN paid_at 
        ELSE created_at 
      END DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return {
    transactions: result.rows,
    total
  };
}
var init_payment_transactions_service = __esm({
  "server/services/payment-transactions-service.ts"() {
    "use strict";
  }
});

// server/routes/webhooks.ts
var webhooks_exports = {};
__export(webhooks_exports, {
  default: () => webhooks_default
});
import { Router as Router17 } from "express";
import Stripe4 from "stripe";
import { eq as eq26, and as and16, ne as ne6, notInArray } from "drizzle-orm";
async function handleCheckoutSessionCompleted(session, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { updateTransactionBySessionId: updateTransactionBySessionId2 } = await Promise.resolve().then(() => (init_stripe_checkout_transactions_service(), stripe_checkout_transactions_service_exports));
    const stripeSecretKey4 = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey4) {
      logger.error("Stripe secret key not available");
      return;
    }
    const stripe4 = new Stripe4(stripeSecretKey4, {
      apiVersion: "2025-12-15.clover"
    });
    const expandedSession = await stripe4.checkout.sessions.retrieve(session.id, {
      expand: ["line_items", "payment_intent"]
    });
    const paymentIntent = expandedSession.payment_intent;
    let paymentIntentId;
    let chargeId;
    if (typeof paymentIntent === "object" && paymentIntent !== null) {
      paymentIntentId = paymentIntent.id;
      if (paymentIntent.latest_charge) {
        chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id;
      }
    } else if (typeof paymentIntent === "string") {
      paymentIntentId = paymentIntent;
      try {
        const pi = await stripe4.paymentIntents.retrieve(paymentIntent);
        if (pi.latest_charge) {
          chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
        }
      } catch (error) {
        logger.warn("Could not fetch payment intent details:", { error });
      }
    }
    const updateParams = {
      status: "completed",
      completedAt: /* @__PURE__ */ new Date(),
      metadata: {
        webhook_event_id: webhookEventId,
        session_mode: expandedSession.mode
      }
    };
    if (paymentIntentId) {
      updateParams.stripePaymentIntentId = paymentIntentId;
    }
    if (chargeId) {
      updateParams.stripeChargeId = chargeId;
    }
    const updatedTransaction = await updateTransactionBySessionId2(
      session.id,
      updateParams,
      db
    );
    if (updatedTransaction) {
      logger.info(`[Webhook] Updated transaction for Checkout session ${session.id}:`, {
        paymentIntentId,
        chargeId,
        amount: `$${(updatedTransaction.total_customer_charged_cents / 100).toFixed(2)}`,
        managerReceives: `$${(updatedTransaction.manager_receives_cents / 100).toFixed(2)}`
      });
    } else {
      logger.warn(`[Webhook] Transaction not found for Checkout session ${session.id}`);
    }
  } catch (error) {
    logger.error(`[Webhook] Error handling checkout.session.completed:`, error);
  }
}
async function handlePaymentIntentSucceeded(paymentIntent, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { findPaymentTransactionByIntentId: findPaymentTransactionByIntentId2, updatePaymentTransaction: updatePaymentTransaction2 } = await Promise.resolve().then(() => (init_payment_transactions_service(), payment_transactions_service_exports));
    const { getStripePaymentAmounts: getStripePaymentAmounts2 } = await Promise.resolve().then(() => (init_stripe_service(), stripe_service_exports));
    const transaction = await findPaymentTransactionByIntentId2(paymentIntent.id, db);
    if (transaction) {
      let managerConnectAccountId;
      try {
        const [manager] = await db.select({ stripeConnectAccountId: users.stripeConnectAccountId }).from(users).where(
          and16(
            eq26(users.id, transaction.manager_id),
            ne6(users.stripeConnectAccountId, "")
          )
        ).limit(1);
        if (manager?.stripeConnectAccountId) {
          managerConnectAccountId = manager.stripeConnectAccountId;
        }
      } catch (error) {
        logger.warn(`[Webhook] Could not fetch manager Connect account:`, { error });
      }
      const stripeAmounts = await getStripePaymentAmounts2(paymentIntent.id, managerConnectAccountId);
      const updateParams = {
        status: "succeeded",
        stripeStatus: paymentIntent.status,
        chargeId: typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id,
        paidAt: /* @__PURE__ */ new Date(),
        lastSyncedAt: /* @__PURE__ */ new Date(),
        webhookEventId
      };
      if (stripeAmounts) {
        updateParams.stripeAmount = stripeAmounts.stripeAmount;
        updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
        updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
        updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
        logger.info(`[Webhook] Syncing Stripe amounts for ${paymentIntent.id}:`, {
          amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
          netAmount: `$${(stripeAmounts.stripeNetAmount / 100).toFixed(2)}`,
          processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
          platformFee: `$${(stripeAmounts.stripePlatformFee / 100).toFixed(2)}`
        });
      }
      await updatePaymentTransaction2(transaction.id, updateParams, db);
      logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}${stripeAmounts ? " with Stripe amounts" : ""}`);
      if (stripeAmounts) {
        const { syncStripeAmountsToBookings: syncStripeAmountsToBookings2 } = await Promise.resolve().then(() => (init_payment_transactions_service(), payment_transactions_service_exports));
        await syncStripeAmountsToBookings2(paymentIntent.id, stripeAmounts, db);
      }
    }
    await db.transaction(async (tx) => {
      await tx.update(kitchenBookings).set({
        paymentStatus: "paid",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(kitchenBookings.paymentIntentId, paymentIntent.id),
          ne6(kitchenBookings.paymentStatus, "paid")
        )
      );
      await tx.update(storageBookings).set({
        paymentStatus: "paid",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(storageBookings.paymentIntentId, paymentIntent.id),
          ne6(storageBookings.paymentStatus, "paid")
        )
      );
      await tx.update(equipmentBookings).set({
        paymentStatus: "paid",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(equipmentBookings.paymentIntentId, paymentIntent.id),
          ne6(equipmentBookings.paymentStatus, "paid")
        )
      );
    });
    logger.info(`[Webhook] Updated booking payment status to 'paid' for PaymentIntent ${paymentIntent.id}`);
  } catch (error) {
    logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
  }
}
async function handlePaymentIntentFailed(paymentIntent, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { findPaymentTransactionByIntentId: findPaymentTransactionByIntentId2, updatePaymentTransaction: updatePaymentTransaction2 } = await Promise.resolve().then(() => (init_payment_transactions_service(), payment_transactions_service_exports));
    const transaction = await findPaymentTransactionByIntentId2(paymentIntent.id, db);
    if (transaction) {
      await updatePaymentTransaction2(transaction.id, {
        status: "failed",
        stripeStatus: paymentIntent.status,
        failureReason: paymentIntent.last_payment_error?.message || "Payment failed",
        lastSyncedAt: /* @__PURE__ */ new Date(),
        webhookEventId
      }, db);
      logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`);
    }
    await db.transaction(async (tx) => {
      const excludedStatuses = ["paid", "refunded", "partially_refunded"];
      await tx.update(kitchenBookings).set({
        paymentStatus: "failed",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(kitchenBookings.paymentIntentId, paymentIntent.id),
          notInArray(kitchenBookings.paymentStatus, excludedStatuses)
        )
      );
      await tx.update(storageBookings).set({
        paymentStatus: "failed",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(storageBookings.paymentIntentId, paymentIntent.id),
          notInArray(storageBookings.paymentStatus, excludedStatuses)
        )
      );
      await tx.update(equipmentBookings).set({
        paymentStatus: "failed",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(equipmentBookings.paymentIntentId, paymentIntent.id),
          notInArray(equipmentBookings.paymentStatus, excludedStatuses)
        )
      );
    });
    logger.info(`[Webhook] Updated booking payment status to 'failed' for PaymentIntent ${paymentIntent.id}`);
  } catch (error) {
    logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
  }
}
async function handlePaymentIntentCanceled(paymentIntent, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { findPaymentTransactionByIntentId: findPaymentTransactionByIntentId2, updatePaymentTransaction: updatePaymentTransaction2 } = await Promise.resolve().then(() => (init_payment_transactions_service(), payment_transactions_service_exports));
    const transaction = await findPaymentTransactionByIntentId2(paymentIntent.id, db);
    if (transaction) {
      await updatePaymentTransaction2(transaction.id, {
        status: "canceled",
        stripeStatus: paymentIntent.status,
        lastSyncedAt: /* @__PURE__ */ new Date(),
        webhookEventId
      }, db);
      logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`);
    }
    await db.transaction(async (tx) => {
      const excludedStatuses = ["paid", "refunded", "partially_refunded"];
      await tx.update(kitchenBookings).set({
        paymentStatus: "failed",
        // Map cancel to failed for backward compatibility
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(kitchenBookings.paymentIntentId, paymentIntent.id),
          notInArray(kitchenBookings.paymentStatus, excludedStatuses)
        )
      );
      await tx.update(storageBookings).set({
        paymentStatus: "failed",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(storageBookings.paymentIntentId, paymentIntent.id),
          notInArray(storageBookings.paymentStatus, excludedStatuses)
        )
      );
      await tx.update(equipmentBookings).set({
        paymentStatus: "failed",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(equipmentBookings.paymentIntentId, paymentIntent.id),
          notInArray(equipmentBookings.paymentStatus, excludedStatuses)
        )
      );
    });
    logger.info(`[Webhook] Updated booking payment status for PaymentIntent ${paymentIntent.id}`);
  } catch (error) {
    logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
  }
}
async function handleChargeRefunded(charge, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { findPaymentTransactionByIntentId: findPaymentTransactionByIntentId2, updatePaymentTransaction: updatePaymentTransaction2 } = await Promise.resolve().then(() => (init_payment_transactions_service(), payment_transactions_service_exports));
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntentId) {
      logger.warn(`[Webhook] Charge ${charge.id} has no payment_intent`);
      return;
    }
    const isPartial = charge.amount_refunded < charge.amount;
    const refundStatus = isPartial ? "partially_refunded" : "refunded";
    const refundAmountCents = charge.amount_refunded;
    const transaction = await findPaymentTransactionByIntentId2(paymentIntentId, db);
    if (transaction) {
      await updatePaymentTransaction2(transaction.id, {
        status: refundStatus,
        refundAmount: refundAmountCents,
        refundId: charge.refunds?.data?.[0]?.id,
        refundedAt: /* @__PURE__ */ new Date(),
        lastSyncedAt: /* @__PURE__ */ new Date(),
        webhookEventId
      }, db);
      logger.info(`[Webhook] Updated payment_transactions for refund on PaymentIntent ${paymentIntentId}`);
    }
    await db.transaction(async (tx) => {
      await tx.update(kitchenBookings).set({
        paymentStatus: refundStatus,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(kitchenBookings.paymentIntentId, paymentIntentId),
          eq26(kitchenBookings.paymentStatus, "paid")
        )
      );
      await tx.update(storageBookings).set({
        paymentStatus: refundStatus,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(storageBookings.paymentIntentId, paymentIntentId),
          eq26(storageBookings.paymentStatus, "paid")
        )
      );
      await tx.update(equipmentBookings).set({
        paymentStatus: refundStatus,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and16(
          eq26(equipmentBookings.paymentIntentId, paymentIntentId),
          eq26(equipmentBookings.paymentStatus, "paid")
        )
      );
    });
    logger.info(`[Webhook] Updated booking payment status to '${refundStatus}' for PaymentIntent ${paymentIntentId}`);
  } catch (error) {
    logger.error(`[Webhook] Error updating refund status for charge ${charge.id}:`, error);
  }
}
async function handleAccountUpdated(account, webhookEventId) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }
  try {
    const { getAccountStatus: getAccountStatus2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
    const chargesEnabled = account.charges_enabled;
    const payoutsEnabled = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;
    const onboardingStatus = detailsSubmitted ? "complete" : "in_progress";
    const [manager] = await db.select({ id: users.id }).from(users).where(eq26(users.stripeConnectAccountId, account.id)).limit(1);
    if (manager) {
      await db.update(users).set({
        stripeConnectOnboardingStatus: onboardingStatus,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq26(users.id, manager.id));
      logger.info(`[Webhook] Updated onboarding status to '${onboardingStatus}' for manager ${manager.id} (Account: ${account.id})`);
    } else {
      logger.warn(`[Webhook] Received account.updated for unknown account ${account.id}`);
    }
  } catch (error) {
    logger.error(`[Webhook] Error handling account.updated for ${account.id}:`, error);
  }
}
var router17, webhooks_default;
var init_webhooks = __esm({
  "server/routes/webhooks.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_logger();
    init_api_response();
    router17 = Router17();
    router17.post("/stripe", async (req, res) => {
      try {
        const sig = req.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const stripeSecretKey4 = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey4) {
          return res.status(500).json({ error: "Stripe not configured" });
        }
        const stripe4 = new Stripe4(stripeSecretKey4, {
          apiVersion: "2025-12-15.clover"
        });
        if (!webhookSecret) {
          if (process.env.NODE_ENV === "production") {
            logger.error("\u274C CRITICAL: STRIPE_WEBHOOK_SECRET is required in production!");
            return res.status(500).json({ error: "Webhook configuration error" });
          }
          logger.warn("\u26A0\uFE0F STRIPE_WEBHOOK_SECRET not configured - webhook verification disabled (development only)");
        }
        let event;
        if (webhookSecret && sig) {
          try {
            event = stripe4.webhooks.constructEvent(req.body, sig, webhookSecret);
          } catch (err) {
            logger.error("\u26A0\uFE0F Webhook signature verification failed:", err.message);
            return res.status(400).json({ error: `Webhook Error: ${err.message}` });
          }
        } else {
          event = req.body;
        }
        const webhookEventId = event.id;
        switch (event.type) {
          case "checkout.session.completed":
            await handleCheckoutSessionCompleted(event.data.object, webhookEventId);
            break;
          case "payment_intent.succeeded":
            await handlePaymentIntentSucceeded(event.data.object, webhookEventId);
            break;
          case "payment_intent.payment_failed":
            await handlePaymentIntentFailed(event.data.object, webhookEventId);
            break;
          case "payment_intent.canceled":
            await handlePaymentIntentCanceled(event.data.object, webhookEventId);
            break;
          case "charge.refunded":
            await handleChargeRefunded(event.data.object, webhookEventId);
            break;
          case "account.updated":
            await handleAccountUpdated(event.data.object, webhookEventId);
            break;
          default:
            if (event.type.startsWith("charge.")) {
              await handleChargeRefunded(event.data.object, webhookEventId);
            } else {
              logger.info(`Unhandled event type: ${event.type}`);
            }
        }
        res.json({ received: true });
      } catch (err) {
        logger.error("Unhandled webhook error:", err);
        return errorResponse(res, err);
      }
    });
    webhooks_default = router17;
  }
});

// shared/subdomain-utils.ts
function getSubdomainFromHostname(hostname) {
  if (!hostname) return null;
  const hostWithoutPort = hostname.split(":")[0];
  const parts = hostWithoutPort.split(".");
  if (hostWithoutPort === "localhost" || hostWithoutPort === "127.0.0.1") {
    return "main";
  }
  if (parts.length === 2 && parts[1] === "localhost") {
    const subdomain = parts[0].toLowerCase();
    switch (subdomain) {
      case "chef":
        return "chef";
      case "kitchen":
        return "kitchen";
      case "admin":
        return "admin";
      default:
        return "main";
    }
  }
  if (parts.length >= 3) {
    const subdomain = parts[0].toLowerCase();
    switch (subdomain) {
      case "chef":
        return "chef";
      case "kitchen":
        return "kitchen";
      case "admin":
        return "admin";
      default:
        return null;
    }
  }
  return "main";
}
function getSubdomainFromHeaders(headers) {
  const forwardedHost = headers["x-forwarded-host"] || headers["x-vercel-deployment-url"];
  if (forwardedHost) {
    const hostname = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    return getSubdomainFromHostname(hostname);
  }
  const host = headers["host"];
  if (host) {
    const hostname = Array.isArray(host) ? host[0] : host;
    return getSubdomainFromHostname(hostname);
  }
  return null;
}
function getRequiredSubdomainForRole(role) {
  if (!role) return null;
  switch (role.toLowerCase()) {
    case "chef":
      return "chef";
    case "manager":
      return "kitchen";
    case "admin":
      return "admin";
    default:
      return null;
  }
}
function isRoleAllowedForSubdomain(role, subdomain, isPortalUser = false, isChef = false, isManager = false) {
  if (isPortalUser && subdomain === "kitchen") {
    return true;
  }
  let effectiveRole = role;
  if (!effectiveRole) {
    if (isManager) {
      effectiveRole = "manager";
    } else if (isChef) {
      effectiveRole = "chef";
    }
  }
  const requiredSubdomain = getRequiredSubdomainForRole(effectiveRole);
  if (!requiredSubdomain) {
    return false;
  }
  return subdomain === requiredSubdomain;
}
var init_subdomain_utils = __esm({
  "shared/subdomain-utils.ts"() {
    "use strict";
  }
});

// server/routes/portal-auth.ts
var portal_auth_exports = {};
__export(portal_auth_exports, {
  default: () => portal_auth_default
});
import { Router as Router18 } from "express";
import { eq as eq27, and as and17 } from "drizzle-orm";
import * as admin from "firebase-admin";
var router18, portal_auth_default;
var init_portal_auth = __esm({
  "server/routes/portal-auth.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_user_service();
    init_location_service();
    init_passwordUtils();
    init_phone_utils();
    init_subdomain_utils();
    router18 = Router18();
    router18.post("/portal-login", async (req, res) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) {
          return res.status(400).json({ error: "Username and password are required" });
        }
        console.log("Portal user login attempt for:", username);
        const portalUser = await userService.getUserByUsername(username);
        if (!portalUser) {
          console.log("Portal user not found:", username);
          return res.status(401).json({ error: "Incorrect username or password" });
        }
        const isPortalUser = portalUser.isPortalUser || portalUser.is_portal_user;
        if (!isPortalUser) {
          console.log("User is not a portal user:", username);
          return res.status(403).json({ error: "Not authorized - portal user access required" });
        }
        const passwordMatches = await comparePasswords(password, portalUser.password);
        if (!passwordMatches) {
          console.log("Password mismatch for portal user:", username);
          return res.status(401).json({ error: "Incorrect username or password" });
        }
        const subdomain = getSubdomainFromHeaders(req.headers);
        const isChef = portalUser.isChef || portalUser.is_chef || false;
        const isManager = portalUser.isManager || portalUser.is_manager || false;
        if (!isRoleAllowedForSubdomain(portalUser.role, subdomain, isPortalUser || false, isChef, isManager)) {
          console.log(`Portal user ${username} attempted login from wrong subdomain: ${subdomain}`);
          return res.status(403).json({
            error: "Access denied. Portal users must login from the kitchen subdomain.",
            requiredSubdomain: "kitchen"
          });
        }
        const uid = portalUser.firebaseUid || `portal:${portalUser.id}`;
        try {
          const customToken = await admin.auth().createCustomToken(uid, {
            role: portalUser.role,
            isPortalUser: true,
            neonUserId: portalUser.id
          });
          const getPortalUserLocation = async () => {
            try {
              const accessRecords = await db.select().from(portalUserLocationAccess).where(eq27(portalUserLocationAccess.portalUserId, portalUser.id));
              if (accessRecords.length > 0) {
                return accessRecords[0].locationId;
              }
              return null;
            } catch (error) {
              console.error("Error fetching portal user location:", error);
              return null;
            }
          };
          const locationId = await getPortalUserLocation();
          res.json({
            token: customToken,
            user: {
              id: portalUser.id,
              username: portalUser.username,
              role: portalUser.role,
              isPortalUser: true,
              locationId
            }
          });
        } catch (tokenError) {
          console.error("Error creating custom token:", tokenError);
          return res.status(500).json({ error: "Failed to create authentication token" });
        }
      } catch (error) {
        console.error("Portal login error:", error);
        res.status(500).json({ error: error.message || "Portal login failed" });
      }
    });
    router18.post("/portal-register", async (req, res) => {
      console.log("[Routes] /api/portal-register called");
      try {
        const { username, password, locationId, fullName, email, phone, company } = req.body;
        if (!username || !password || !locationId || !fullName || !email || !phone) {
          return res.status(400).json({ error: "Username, password, locationId, fullName, email, and phone are required" });
        }
        const location = await locationService.getLocationById(parseInt(locationId));
        if (!location) {
          return res.status(400).json({ error: "Location not found" });
        }
        let user = await userService.getUserByUsername(username);
        let isNewUser = false;
        if (!user) {
          const hashedPassword = await hashPassword(password);
          user = await userService.createUser({
            username,
            password: hashedPassword,
            role: "chef",
            // Default role, but portal user flag takes precedence
            isChef: false,
            isManager: false,
            isPortalUser: true,
            managerProfileData: {}
          });
          isNewUser = true;
        } else {
          const isPortalUser = user.isPortalUser || user.is_portal_user;
          if (!isPortalUser) {
            return res.status(400).json({ error: "Username already exists with different account type" });
          }
        }
        let existingApplications = [];
        try {
          existingApplications = await db.select().from(portalUserApplications).where(
            and17(
              eq27(portalUserApplications.userId, user.id),
              eq27(portalUserApplications.locationId, parseInt(locationId))
            )
          );
        } catch (dbError) {
          console.error("Error checking existing applications:", dbError);
          if (dbError.message && dbError.message.includes("does not exist")) {
            return res.status(500).json({
              error: "Database migration required. Please run the migration to create portal_user_applications table.",
              details: "Run: migrations/0005_add_portal_user_tables.sql"
            });
          }
          throw dbError;
        }
        if (existingApplications.length > 0) {
          const existingApp = existingApplications[0];
          if (existingApp.status === "inReview" || existingApp.status === "approved") {
            return res.status(400).json({
              error: "You already have an application for this location",
              applicationId: existingApp.id,
              status: existingApp.status
            });
          }
        }
        let application;
        try {
          const normalizedPhone = normalizePhoneForStorage(phone);
          if (!normalizedPhone) {
            return res.status(400).json({ error: "Invalid phone number format. Please enter a valid phone number." });
          }
          application = await db.insert(portalUserApplications).values({
            userId: user.id,
            locationId: parseInt(locationId),
            fullName,
            email,
            phone: normalizedPhone,
            company: company || null,
            status: "inReview"
          }).returning();
        } catch (dbError) {
          console.error("Error creating application:", dbError);
          if (dbError.message && dbError.message.includes("does not exist")) {
            return res.status(500).json({
              error: "Database migration required. Please run the migration to create portal_user_applications table.",
              details: "Run: migrations/0005_add_portal_user_tables.sql"
            });
          }
          throw dbError;
        }
        try {
          const uid = user.firebaseUid || `portal:${user.id}`;
          const customToken = await admin.auth().createCustomToken(uid, {
            role: user.role,
            isPortalUser: true,
            neonUserId: user.id
          });
          (async () => {
            try {
              const { sendEmail: sendEmail2 } = await Promise.resolve().then(() => (init_email(), email_exports));
              let managerEmail = location.notificationEmail || location.notification_email;
              if (!managerEmail) {
                const managerId = location.managerId || location.manager_id;
                if (managerId) {
                  const manager = await userService.getUser(managerId);
                  if (manager && manager.username) {
                    managerEmail = manager.username;
                  }
                }
              }
              if (managerEmail) {
                const emailContent = {
                  to: managerEmail,
                  subject: `New Portal User Application - ${location.name}`,
                  text: `A new portal user has applied for access to your location:

Location: ${location.name}
Applicant Name: ${fullName}
Email: ${email}
Phone: ${phone}
${company ? `Company: ${company}
` : ""}
Please log in to your manager dashboard to review and approve this application.`,
                  html: `<h2>New Portal User Application</h2><p><strong>Location:</strong> ${location.name}</p><p><strong>Applicant Name:</strong> ${fullName}</p><p><strong>Email:</strong> ${email}</p><p><strong>Phone:</strong> ${phone}</p>${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}<p>Please log in to your manager dashboard to review and approve this application.</p>`
                };
                await sendEmail2(emailContent);
                console.log(`\u2705 Portal user application notification sent to manager: ${managerEmail}`);
              } else {
                console.log("\u26A0\uFE0F No manager email found for location - skipping email notification");
              }
            } catch (emailError) {
              console.error("Error sending application notification email:", emailError);
            }
            res.status(201).json({
              token: customToken,
              user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isPortalUser: true
              },
              application: {
                id: application[0].id,
                status: application[0].status,
                message: "Your application has been submitted. You are now logged in. The location manager will review it shortly."
              }
            });
          })();
        } catch (tokenError) {
          console.error("Error creating token after registration:", tokenError);
          return res.status(500).json({ error: "Registration successful but login failed. Please try logging in." });
        }
      } catch (error) {
        console.error("Portal registration error:", error);
        res.status(500).json({ error: error.message || "Portal registration failed" });
      }
    });
    portal_auth_default = router18;
  }
});

// server/routes/portal.ts
var portal_exports = {};
__export(portal_exports, {
  default: () => portal_default
});
import { Router as Router19 } from "express";
import { eq as eq28, desc as desc13 } from "drizzle-orm";
var router19, portal_default;
var init_portal = __esm({
  "server/routes/portal.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_middleware();
    init_booking_service();
    init_kitchen_service();
    init_location_service();
    router19 = Router19();
    router19.get("/application-status", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, user.id)).limit(1);
        if (accessRecords.length > 0) {
          return res.json({
            hasAccess: true,
            status: "approved"
          });
        }
        const applications3 = await db.select().from(portalUserApplications).where(eq28(portalUserApplications.userId, user.id)).orderBy(desc13(portalUserApplications.createdAt)).limit(1);
        if (applications3.length > 0) {
          const app2 = applications3[0];
          return res.json({
            hasAccess: false,
            status: app2.status,
            applicationId: app2.id,
            locationId: app2.locationId,
            awaitingApproval: app2.status === "inReview"
          });
        }
        return res.json({
          hasAccess: false,
          status: "no_application",
          awaitingApproval: false
        });
      } catch (error) {
        console.error("Error getting portal application status:", error);
        res.status(500).json({ error: error.message || "Failed to get application status" });
      }
    });
    router19.get("/my-location", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const locationId = accessRecords[0].locationId;
        const locationRecords = await db.select().from(locations).where(eq28(locations.id, locationId)).limit(1);
        if (locationRecords.length === 0) {
          return res.status(404).json({ error: "Location not found" });
        }
        const location = locationRecords[0];
        const slug = location.name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
        res.json({
          id: location.id,
          name: location.name,
          address: location.address,
          logoUrl: location.logoUrl || location.logo_url || null,
          slug
        });
      } catch (error) {
        console.error("Error fetching portal user location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
      }
    });
    router19.get("/locations", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const locationId = accessRecords[0].locationId;
        const locationRecords = await db.select().from(locations).where(eq28(locations.id, locationId)).limit(1);
        if (locationRecords.length === 0) {
          return res.status(404).json({ error: "Location not found" });
        }
        const location = locationRecords[0];
        const slug = location.name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
        res.json([{
          id: location.id,
          name: location.name,
          address: location.address,
          logoUrl: location.logoUrl || location.logo_url || null,
          slug
        }]);
      } catch (error) {
        console.error("Error fetching portal user location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
      }
    });
    router19.get("/locations/:locationSlug", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const locationSlug = req.params.locationSlug;
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const userLocationId = accessRecords[0].locationId;
        const locationRecords = await db.select().from(locations).where(eq28(locations.id, userLocationId)).limit(1);
        if (locationRecords.length === 0) {
          return res.status(404).json({ error: "Location not found" });
        }
        const location = locationRecords[0];
        const slug = location.name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
        if (slug !== locationSlug) {
          return res.status(403).json({ error: "Access denied. You can only access your assigned location." });
        }
        res.json({
          id: location.id,
          name: location.name,
          address: location.address,
          logoUrl: location.logoUrl || location.logo_url || null
        });
      } catch (error) {
        console.error("Error fetching portal location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
      }
    });
    router19.get("/locations/:locationSlug/kitchens", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const locationSlug = req.params.locationSlug;
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const userLocationId = accessRecords[0].locationId;
        const locationRecords = await db.select().from(locations).where(eq28(locations.id, userLocationId)).limit(1);
        if (locationRecords.length === 0) {
          return res.status(404).json({ error: "Location not found" });
        }
        const location = locationRecords[0];
        const slug = location.name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
        if (slug !== locationSlug) {
          return res.status(403).json({ error: "Access denied. You can only access kitchens at your assigned location." });
        }
        const kitchensList = await kitchenService.getKitchensByLocationId(userLocationId, true);
        const publicKitchens = kitchensList.filter((kitchen) => kitchen.isActive !== false).map((kitchen) => ({
          id: kitchen.id,
          name: kitchen.name,
          description: kitchen.description,
          locationId: kitchen.locationId || kitchen.location_id
        }));
        res.json(publicKitchens);
      } catch (error) {
        console.error("Error fetching portal kitchens:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
      }
    });
    router19.get("/kitchens/:kitchenId/availability", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const kitchenId = parseInt(req.params.kitchenId);
        const date2 = req.query.date;
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        if (!date2) {
          return res.status(400).json({ error: "Date parameter is required" });
        }
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const userLocationId = accessRecords[0].locationId;
        const kitchenRecords = await db.select().from(kitchens).where(eq28(kitchens.id, kitchenId)).limit(1);
        if (kitchenRecords.length === 0) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const kitchen = kitchenRecords[0];
        const kitchenLocationId = kitchen.locationId || kitchen.location_id;
        if (kitchenLocationId !== userLocationId) {
          return res.status(403).json({ error: "Access denied. You can only access kitchens at your assigned location." });
        }
        const slots = await bookingService.getAvailableSlots(kitchenId, date2);
        res.json({ slots });
      } catch (error) {
        console.error("Error fetching portal availability:", error);
        res.status(500).json({ error: error.message || "Failed to fetch availability" });
      }
    });
    router19.post("/bookings", requirePortalUser, async (req, res) => {
      try {
        const userId = req.neonUser.id;
        const {
          locationId,
          kitchenId,
          bookingDate,
          startTime,
          endTime,
          bookingName,
          bookingEmail,
          bookingPhone,
          bookingCompany,
          specialNotes
        } = req.body;
        if (!locationId || !kitchenId || !bookingDate || !startTime || !endTime || !bookingName || !bookingEmail) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        const accessRecords = await db.select().from(portalUserLocationAccess).where(eq28(portalUserLocationAccess.portalUserId, userId)).limit(1);
        if (accessRecords.length === 0) {
          return res.status(404).json({ error: "No location assigned to this portal user" });
        }
        const userLocationId = accessRecords[0].locationId;
        if (parseInt(locationId) !== userLocationId) {
          return res.status(403).json({ error: "Access denied. You can only book kitchens at your assigned location." });
        }
        const kitchenRecords = await db.select().from(kitchens).where(eq28(kitchens.id, parseInt(kitchenId))).limit(1);
        if (kitchenRecords.length === 0) {
          return res.status(404).json({ error: "Kitchen not found" });
        }
        const kitchen = kitchenRecords[0];
        const kitchenLocationId = kitchen.locationId || kitchen.location_id;
        if (kitchenLocationId !== userLocationId) {
          return res.status(403).json({ error: "Access denied. You can only book kitchens at your assigned location." });
        }
        const bookingDateObj = new Date(bookingDate);
        const now = /* @__PURE__ */ new Date();
        if (bookingDateObj < now) {
          return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }
        const availabilityCheck = await bookingService.validateBookingAvailability(
          parseInt(kitchenId),
          bookingDateObj,
          startTime,
          endTime
        );
        if (!availabilityCheck.valid) {
          return res.status(400).json({ error: availabilityCheck.error || "Time slot not available" });
        }
        const location = await locationService.getLocationById(userLocationId);
        const minimumBookingWindowHours = location?.minimumBookingWindowHours ?? 1;
        const isToday = bookingDateObj.toDateString() === now.toDateString();
        if (isToday) {
          const [startHours, startMins] = startTime.split(":").map(Number);
          const slotTime = new Date(bookingDateObj);
          slotTime.setHours(startHours, startMins, 0, 0);
          const hoursUntilBooking = (slotTime.getTime() - now.getTime()) / (1e3 * 60 * 60);
          if (hoursUntilBooking < minimumBookingWindowHours) {
            return res.status(400).json({
              error: `Bookings must be made at least ${minimumBookingWindowHours} hour(s) in advance`
            });
          }
        }
        const booking = await bookingService.createPortalBooking({
          kitchenId: parseInt(kitchenId),
          bookingDate: bookingDateObj,
          startTime,
          endTime,
          specialNotes: specialNotes || `Portal booking from ${bookingName}${bookingCompany ? ` (${bookingCompany})` : ""}`,
          bookingType: "portal",
          createdBy: userId,
          externalContact: {
            name: bookingName,
            email: bookingEmail,
            phone: bookingPhone || null,
            company: bookingCompany || null
          }
        });
        try {
          const { sendEmail: sendEmail2 } = await Promise.resolve().then(() => (init_email(), email_exports));
          const { sendSMS: sendSMS2, generatePortalUserBookingConfirmationSMS: generatePortalUserBookingConfirmationSMS2, generateManagerPortalBookingSMS: generateManagerPortalBookingSMS2 } = await Promise.resolve().then(() => (init_sms(), sms_exports));
          const locationData = await locationService.getLocationById(userLocationId);
          const notificationEmail = locationData?.notificationEmail;
          if (notificationEmail) {
            const { generateBookingNotificationEmail: generateBookingNotificationEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
          }
        } catch (error) {
          console.error("Error sending booking notifications:", error);
        }
        res.status(201).json({
          success: true,
          booking: {
            id: booking.id,
            bookingDate,
            startTime,
            endTime,
            status: "pending"
          },
          message: "Booking submitted successfully."
        });
      } catch (error) {
        console.error("Error creating portal booking:", error);
        res.status(500).json({ error: error.message || "Failed to create booking" });
      }
    });
    portal_default = router19;
  }
});

// server/routes/chef.ts
var chef_exports = {};
__export(chef_exports, {
  default: () => chef_default
});
import { Router as Router20 } from "express";
import { sql as sql11 } from "drizzle-orm";
import { eq as eq29 } from "drizzle-orm";
var router20, chef_default;
var init_chef = __esm({
  "server/routes/chef.ts"() {
    "use strict";
    init_inventory_service();
    init_location_service();
    init_kitchen_service();
    init_user_service();
    init_middleware();
    init_db();
    init_schema();
    init_api_response();
    router20 = Router20();
    router20.post("/stripe-connect/create", requireChef, async (req, res) => {
      console.log("[Chef Stripe Connect] Create request received for chef:", req.neonUser?.id);
      try {
        const chefId = req.neonUser.id;
        const userResult = await db.execute(sql11`
            SELECT id, username as email, stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow) {
          console.error("[Chef Stripe Connect] User not found for ID:", chefId);
          return res.status(404).json({ error: "User not found" });
        }
        const user = {
          id: userRow.id,
          email: userRow.email,
          stripeConnectAccountId: userRow.stripe_connect_account_id
        };
        const { createConnectAccount: createConnectAccount2, createAccountLink: createAccountLink2, isAccountReady: isAccountReady2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
        const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh`;
        const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true`;
        if (user.stripeConnectAccountId) {
          const isReady = await isAccountReady2(user.stripeConnectAccountId);
          if (isReady) {
            return res.json({ alreadyExists: true, accountId: user.stripeConnectAccountId });
          } else {
            const link2 = await createAccountLink2(user.stripeConnectAccountId, refreshUrl, returnUrl);
            return res.json({ url: link2.url });
          }
        }
        console.log("[Chef Stripe Connect] Creating new account for email:", user.email);
        const { accountId } = await createConnectAccount2({
          managerId: chefId,
          // Using managerId field for consistency with service
          email: user.email,
          country: "CA"
        });
        await userService.updateUser(chefId, { stripeConnectAccountId: accountId });
        const link = await createAccountLink2(accountId, refreshUrl, returnUrl);
        return res.json({ url: link.url });
      } catch (error) {
        console.error("[Chef Stripe Connect] Error in create route:", error);
        return errorResponse(res, error);
      }
    });
    router20.get("/stripe-connect/onboarding-link", requireChef, async (req, res) => {
      try {
        const chefId = req.neonUser.id;
        const userResult = await db.execute(sql11`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow?.stripe_connect_account_id) {
          return res.status(400).json({ error: "No Stripe Connect account found" });
        }
        const { createAccountLink: createAccountLink2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
        const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh`;
        const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true`;
        const link = await createAccountLink2(userRow.stripe_connect_account_id, refreshUrl, returnUrl);
        return res.json({ url: link.url });
      } catch (error) {
        console.error("[Chef Stripe Connect] Error in onboarding-link route:", error);
        return errorResponse(res, error);
      }
    });
    router20.get("/stripe-connect/dashboard-link", requireChef, async (req, res) => {
      try {
        const chefId = req.neonUser.id;
        const userResult = await db.execute(sql11`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : userResult[0];
        if (!userRow?.stripe_connect_account_id) {
          return res.status(400).json({ error: "No Stripe Connect account found" });
        }
        const { createDashboardLoginLink: createDashboardLoginLink2, isAccountReady: isAccountReady2, createAccountLink: createAccountLink2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const isReady = await isAccountReady2(userRow.stripe_connect_account_id);
        if (isReady) {
          const link = await createDashboardLoginLink2(userRow.stripe_connect_account_id);
          return res.json({ url: link.url });
        } else {
          const baseUrl = process.env.VITE_APP_URL || "http://localhost:5173";
          const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh`;
          const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true`;
          const link = await createAccountLink2(userRow.stripe_connect_account_id, refreshUrl, returnUrl);
          return res.json({ url: link.url, requiresOnboarding: true });
        }
      } catch (error) {
        console.error("[Chef Stripe Connect] Error in dashboard-link route:", error);
        return errorResponse(res, error);
      }
    });
    router20.post("/stripe-connect/sync", requireChef, async (req, res) => {
      try {
        const chefId = req.neonUser.id;
        const [chef] = await db.select().from(users).where(eq29(users.id, chefId)).limit(1);
        if (!chef?.stripeConnectAccountId) {
          return res.status(400).json({ error: "No Stripe account connected" });
        }
        const { getAccountStatus: getAccountStatus2 } = await Promise.resolve().then(() => (init_stripe_connect_service(), stripe_connect_service_exports));
        const status = await getAccountStatus2(chef.stripeConnectAccountId);
        const onboardingStatus = status.detailsSubmitted ? "complete" : "in_progress";
        await db.update(users).set({
          stripeConnectOnboardingStatus: onboardingStatus
        }).where(eq29(users.id, chefId));
        res.json({
          connected: true,
          accountId: chef.stripeConnectAccountId,
          status: onboardingStatus,
          details: status
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    });
    router20.get("/kitchens/:kitchenId/equipment-listings", requireChef, async (req, res) => {
      try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
          return res.status(400).json({ error: "Invalid kitchen ID" });
        }
        const allListings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);
        const visibleListings = allListings.filter(
          (listing) => listing.isActive === true
        );
        const includedEquipment = visibleListings.filter((l) => l.availabilityType === "included");
        const rentalEquipment = visibleListings.filter((l) => l.availabilityType === "rental");
        console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings (chef.ts) - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);
        res.json({
          all: visibleListings,
          included: includedEquipment,
          rental: rentalEquipment
        });
      } catch (error) {
        console.error("Error getting equipment listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listings" });
      }
    });
    router20.get("/locations", requireChef, async (req, res) => {
      try {
        const allLocations = await locationService.getAllLocations();
        const activeKitchens = await kitchenService.getAllActiveKitchens();
        const locationIdsWithKitchens = new Set(
          activeKitchens.map((kitchen) => kitchen.locationId || kitchen.location_id).filter(Boolean)
        );
        const locationsWithKitchens = allLocations.filter(
          (location) => locationIdsWithKitchens.has(location.id)
        );
        console.log(`[API] /api/chef/locations - Returning ${locationsWithKitchens.length} locations with active kitchens`);
        const { normalizeImageUrl: normalizeImageUrl2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
        const normalizedLocations = locationsWithKitchens.map((location) => ({
          ...location,
          brandImageUrl: normalizeImageUrl2(location.brandImageUrl, req),
          logoUrl: normalizeImageUrl2(location.logoUrl, req)
        }));
        res.json(normalizedLocations);
      } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
      }
    });
    chef_default = router20;
  }
});

// server/index.ts
init_firebase_setup();
import "dotenv/config";
import express3 from "express";

// server/routes/firebase/admin-email.ts
init_firebase_auth_middleware();
init_db();
init_schema();
import { Router } from "express";
import { and, isNotNull, ne } from "drizzle-orm";
var router = Router();
router.post("/admin/send-company-email", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    console.log(`\u{1F525} POST /api/admin/send-company-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);
    const {
      emailType = "general",
      // 'promotional', 'general', 'announcement', 'newsletter'
      emailMode,
      recipients,
      promoCode,
      // Optional for non-promotional emails
      promoCodeLabel,
      message,
      customMessage,
      greeting,
      subject,
      previewText,
      header,
      footer,
      orderButton,
      usageSteps,
      emailContainer,
      dividers,
      promoCodeStyling,
      promoStyle,
      sections,
      customDesign
    } = req.body;
    const messageContent = customMessage || message;
    if (!messageContent || messageContent.length < 10) {
      console.log("\u{1F525} Company email request - Invalid message:", {
        customMessage: customMessage?.substring(0, 50),
        message: message?.substring(0, 50),
        messageLength: messageContent?.length
      });
      return res.status(400).json({ error: "Message content is required (minimum 10 characters)" });
    }
    if (emailType === "promotional" && !promoCode) {
      console.log("\u{1F525} Company email request - Missing promo code for promotional email");
      return res.status(400).json({ error: "Promo code is required for promotional emails" });
    }
    let targetEmails = [];
    if (emailMode === "all") {
      try {
        const result = await db.select({ email: users.username }).from(users).where(
          and(
            isNotNull(users.username),
            ne(users.username, "")
          )
        );
        targetEmails = result.map((row) => row.email);
      } catch (error) {
        console.error("\u{1F525} Error fetching user emails:", error);
        return res.status(500).json({ error: "Failed to fetch user emails" });
      }
    } else if (emailMode === "custom" && recipients) {
      const customEmails = recipients.split(",").map((email) => email.trim()).filter((email) => email.length > 0);
      targetEmails = customEmails;
    } else {
      return res.status(400).json({ error: "Invalid email mode or recipients" });
    }
    if (targetEmails.length === 0) {
      console.log("\u{1F525} Company email request - No valid email addresses provided");
      return res.status(400).json({ error: "At least one email address is required" });
    }
    console.log(`\u{1F525} Admin ${req.neonUser?.username} sending ${emailType} email to ${targetEmails.length} recipient(s)`);
    const { sendEmail: sendEmail2, generatePromoCodeEmail: generatePromoCodeEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    for (const targetEmail of targetEmails) {
      try {
        const emailContent = generatePromoCodeEmail3({
          email: targetEmail,
          promoCode,
          promoCodeLabel: promoCodeLabel || "\u{1F381} Special Offer Code For You",
          customMessage: messageContent,
          greeting: greeting || "Hello! \u{1F44B}",
          subject: subject || `\u{1F381} Special Offer: ${promoCode}`,
          previewText,
          header: header || {
            title: "Special Offer Just For You!",
            subtitle: "Don't miss out on this exclusive deal"
          },
          footer,
          orderButton: orderButton || {
            text: "\u{1F31F} Start Shopping Now",
            url: "https://localcooks.ca"
          },
          usageSteps: usageSteps || {
            enabled: true,
            title: "\u{1F680} How to use your offer:",
            steps: [
              `Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>`,
              "Browse our amazing local cooks and their delicious offerings",
              promoCode ? "Apply your promo code during checkout" : "Complete your order",
              "Enjoy your special offer!"
            ]
          },
          emailContainer: emailContainer || {
            maxWidth: "600px",
            backgroundColor: "#f1f5f9",
            borderRadius: "12px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            opacity: "1"
          },
          dividers,
          promoCodeStyling,
          promoStyle: promoStyle || { colorTheme: "green", borderStyle: "dashed" },
          sections
        });
        const emailSent = await sendEmail2(emailContent, {
          trackingId: `promo_email_${targetEmail}_${Date.now()}`
        });
        if (emailSent) {
          console.log(`\u{1F525} ${emailType} email sent successfully to ${targetEmail}`);
          results.push({ email: targetEmail, status: "success" });
          successCount++;
        } else {
          console.error(`\u{1F525} Failed to send ${emailType} email to ${targetEmail}`);
          results.push({ email: targetEmail, status: "failed", error: "Email sending failed" });
          failureCount++;
        }
      } catch (error) {
        console.error(`\u{1F525} Error sending ${emailType} email to ${targetEmail}:`, error);
        results.push({ email: targetEmail, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
        failureCount++;
      }
    }
    if (successCount > 0) {
      res.json({
        success: true,
        message: `${emailType} emails sent: ${successCount} successful, ${failureCount} failed`,
        emailType,
        results,
        summary: {
          total: targetEmails.length,
          successful: successCount,
          failed: failureCount
        }
      });
    } else {
      res.status(500).json({
        error: "All email sending failed",
        message: `Failed to send ${emailType} emails to any recipients.`,
        results
      });
    }
  } catch (error) {
    console.error("\u{1F525} Error sending company email:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred"
    });
  }
});
router.post("/admin/send-promo-email", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    console.log(`\u{1F525} POST /api/admin/send-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);
    const {
      email,
      customEmails,
      emailMode,
      promoCode,
      customMessage,
      message,
      promoCodeLabel,
      greeting,
      recipientType,
      designSystem,
      isPremium,
      sections,
      orderButton,
      header,
      footer,
      usageSteps,
      emailContainer,
      subject,
      previewText,
      promoStyle,
      promoCodeStyling,
      buttonText,
      orderUrl
    } = req.body;
    const messageContent = customMessage || message;
    if (emailMode === "custom") {
      if (!customEmails || !Array.isArray(customEmails) || customEmails.length === 0) {
        console.log("Promo email request - Missing custom emails");
        return res.status(400).json({ error: "At least one email address is required" });
      }
    } else {
      if (!email) {
        console.log("Promo email request - Missing email");
        return res.status(400).json({ error: "Email is required" });
      }
    }
    if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
      console.log("\u{1F525} Promo email request - Invalid promo code length");
      return res.status(400).json({ error: "Promo code must be at least 3 characters long if provided" });
    }
    if (!messageContent || messageContent.length < 10) {
      console.log("Promo email request - Invalid message:", {
        customMessage: customMessage?.substring(0, 50),
        message: message?.substring(0, 50),
        messageContent: messageContent?.substring(0, 50)
      });
      return res.status(400).json({ error: "Message must be at least 10 characters" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailMode === "custom") {
      for (const customEmail of customEmails) {
        if (!emailRegex.test(customEmail)) {
          return res.status(400).json({
            error: "Invalid email",
            message: `Please provide a valid email address: ${customEmail}`
          });
        }
      }
    } else {
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: "Invalid email",
          message: "Please provide a valid email address"
        });
      }
    }
    if (promoCode && promoCode.length > 0 && (promoCode.length < 3 || promoCode.length > 50)) {
      return res.status(400).json({
        error: "Invalid promo code",
        message: "Promo code must be between 3 and 50 characters"
      });
    }
    if (messageContent.length > 1e3) {
      return res.status(400).json({
        error: "Invalid message",
        message: "Message must be less than 1000 characters"
      });
    }
    const targetEmails = emailMode === "custom" ? customEmails : [email];
    console.log(`\u{1F525} Admin ${req.neonUser?.username} sending promo email to ${targetEmails.length} recipient(s) with code: ${promoCode}`);
    const { sendEmail: sendEmail2, generatePromoCodeEmail: generatePromoCodeEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    for (const targetEmail of targetEmails) {
      try {
        const emailContent = generatePromoCodeEmail3({
          email: targetEmail,
          promoCode: promoCode.trim(),
          customMessage: messageContent.trim(),
          greeting,
          promoStyle: promoStyle || { colorTheme: "green", borderStyle: "dashed" },
          promoCodeStyling,
          designSystem,
          isPremium: isPremium || false,
          sections: sections || [],
          orderButton: orderButton || {
            text: buttonText || "Get Started",
            url: orderUrl || "https://localcooks.ca",
            styling: {
              backgroundColor: "#F51042",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: "600",
              padding: "12px 24px",
              borderRadius: "8px",
              textAlign: "center"
            }
          },
          header: header || {
            title: "Local Cooks Header",
            subtitle: "Premium Quality Food Subheader",
            styling: {
              backgroundColor: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
              titleColor: "#ffffff",
              subtitleColor: "#ffffff",
              titleFontSize: "32px",
              subtitleFontSize: "18px",
              padding: "24px",
              borderRadius: "0px",
              textAlign: "center"
            }
          },
          footer: footer || {
            mainText: "Thank you for being part of the Local Cooks community!",
            contactText: "Questions? Contact us at support@localcooks.com",
            copyrightText: "\xA9 2024 Local Cooks. All rights reserved.",
            showContact: true,
            showCopyright: true,
            styling: {
              backgroundColor: "#f8fafc",
              textColor: "#64748b",
              linkColor: "#F51042",
              fontSize: "14px",
              padding: "24px 32px",
              textAlign: "center",
              borderColor: "#e2e8f0"
            }
          },
          usageSteps: usageSteps || {
            title: "\u{1F680} How to use your promo code:",
            steps: [
              `Visit our website: <a href="${orderUrl || "https://localcooks.ca"}" style="color: #1d4ed8;">${orderUrl || "https://localcooks.ca"}</a>`,
              "Browse our amazing local cooks and their delicious offerings",
              "Apply your promo code during checkout",
              "Enjoy your special offer!"
            ],
            enabled: true,
            styling: {
              backgroundColor: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              borderColor: "#93c5fd",
              titleColor: "#1d4ed8",
              textColor: "#1e40af",
              linkColor: "#1d4ed8",
              padding: "20px",
              borderRadius: "8px"
            }
          },
          emailContainer: emailContainer || {
            maxWidth: "600px",
            backgroundColor: "#f1f5f9",
            borderRadius: "12px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
          },
          dividers: {
            enabled: true,
            style: "solid",
            color: "#e2e8f0",
            thickness: "1px",
            margin: "24px 0",
            opacity: "1"
          },
          subject,
          previewText,
          promoCodeLabel
        });
        const emailSent = await sendEmail2(emailContent, {
          trackingId: `promo_custom_${targetEmail}_${promoCode}_${Date.now()}`
        });
        if (emailSent) {
          console.log(`\u{1F525} Promo email sent successfully to ${targetEmail} with code ${promoCode}`);
          results.push({ email: targetEmail, status: "success" });
          successCount++;
        } else {
          console.error(`\u{1F525} Failed to send promo email to ${targetEmail}`);
          results.push({ email: targetEmail, status: "failed", error: "Email sending failed" });
          failureCount++;
        }
      } catch (error) {
        console.error(`\u{1F525} Error sending promo email to ${targetEmail}:`, error);
        results.push({ email: targetEmail, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
        failureCount++;
      }
    }
    if (successCount > 0) {
      return res.status(200).json({
        message: `Promo code emails sent: ${successCount} successful, ${failureCount} failed`,
        results,
        promoCode,
        sentBy: req.neonUser?.username,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        summary: {
          total: targetEmails.length,
          successful: successCount,
          failed: failureCount
        }
      });
    } else {
      return res.status(500).json({
        error: "All email sending failed",
        message: "Failed to send promo code emails to any recipients.",
        results
      });
    }
  } catch (error) {
    console.error("\u{1F525} Error sending promo email:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while sending the promo code email"
    });
  }
});
router.post("/admin/test-promo-email", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    console.log(`\u{1F525} POST /api/admin/test-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);
    const {
      email,
      promoCode,
      customMessage,
      message,
      promoCodeLabel,
      greeting,
      designSystem,
      isPremium,
      sections,
      orderButton,
      header,
      footer,
      usageSteps,
      emailContainer,
      subject,
      previewText,
      promoStyle,
      promoCodeStyling
    } = req.body;
    const messageContent = customMessage || message;
    console.log(`\u{1F525} Admin ${req.neonUser?.username} testing promo email`);
    const { sendEmail: sendEmail2, generatePromoCodeEmail: generatePromoCodeEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
    const emailContent = generatePromoCodeEmail3({
      email: email || "test@example.com",
      promoCode: promoCode || "TEST20",
      customMessage: messageContent || "This is a test promo code email from the admin panel. Thank you for being an amazing customer!",
      greeting,
      promoStyle: promoStyle || { colorTheme: "green", borderStyle: "dashed" },
      promoCodeStyling,
      designSystem,
      isPremium: isPremium || false,
      sections: sections || [],
      orderButton,
      header: header || {
        title: "Local Cooks Header",
        subtitle: "Premium Quality Food Subheader",
        styling: {
          backgroundColor: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
          titleColor: "#ffffff",
          subtitleColor: "#ffffff",
          titleFontSize: "32px",
          subtitleFontSize: "18px",
          padding: "24px",
          borderRadius: "0px",
          textAlign: "center"
        }
      },
      footer: footer || {
        mainText: "Thank you for being part of the Local Cooks community!",
        contactText: "Questions? Contact us at support@localcooks.com",
        copyrightText: "\xA9 2024 Local Cooks. All rights reserved.",
        showContact: true,
        showCopyright: true,
        styling: {
          backgroundColor: "#f8fafc",
          textColor: "#64748b",
          linkColor: "#F51042",
          fontSize: "14px",
          padding: "24px 32px",
          textAlign: "center",
          borderColor: "#e2e8f0"
        }
      },
      usageSteps: usageSteps || {
        title: "\u{1F680} How to use your promo code:",
        steps: [
          'Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>',
          "Browse our amazing local cooks and their delicious offerings",
          "Apply your promo code during checkout",
          "Enjoy your special offer!"
        ],
        enabled: true,
        styling: {
          backgroundColor: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          borderColor: "#93c5fd",
          titleColor: "#1d4ed8",
          textColor: "#1e40af",
          linkColor: "#1d4ed8",
          padding: "20px",
          borderRadius: "8px"
        }
      },
      emailContainer: emailContainer || {
        maxWidth: "600px",
        backgroundColor: "#f1f5f9",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
      },
      dividers: {
        enabled: true,
        style: "solid",
        color: "#e2e8f0",
        thickness: "1px",
        margin: "24px 0",
        opacity: "1"
      },
      subject,
      previewText,
      promoCodeLabel
    });
    const emailSent = await sendEmail2(emailContent, {
      trackingId: `test_promo_custom_${email || "test"}_${Date.now()}`
    });
    if (emailSent) {
      return res.status(200).json({
        message: "Test promo email sent successfully",
        email: email || "test@example.com",
        promoCode: promoCode || "TEST20"
      });
    } else {
      return res.status(500).json({
        error: "Test email failed",
        message: "Failed to send test promo email"
      });
    }
  } catch (error) {
    console.error("\u{1F525} Error sending test promo email:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while testing promo email"
    });
  }
});
router.post(
  "/admin/preview-promo-email",
  requireFirebaseAuthWithUser,
  requireAdmin,
  async (req, res) => {
    try {
      console.log(`\u{1F525} POST /api/admin/preview-promo-email - Firebase UID: ${req.firebaseUser?.uid}, Neon User ID: ${req.neonUser?.id}`);
      const {
        promoCode,
        customMessage,
        message,
        promoCodeLabel,
        greeting,
        designSystem,
        isPremium,
        sections,
        orderButton,
        header,
        footer,
        usageSteps,
        emailContainer,
        subject,
        previewText,
        promoStyle,
        promoCodeStyling,
        buttonText,
        orderUrl
      } = req.body;
      const messageContent = customMessage || message;
      if (!promoCode || !messageContent) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "Promo code and message are required for preview"
        });
      }
      console.log(`\u{1F525} Admin ${req.neonUser?.username} previewing promo email`);
      const { generatePromoCodeEmail: generatePromoCodeEmail3 } = await Promise.resolve().then(() => (init_email(), email_exports));
      const emailContent = generatePromoCodeEmail3({
        email: "preview@example.com",
        // Dummy email for preview
        promoCode: promoCode.trim(),
        customMessage: messageContent.trim(),
        message: messageContent.trim(),
        // Also pass as message for compatibility
        greeting,
        promoStyle: promoStyle || { colorTheme: "green", borderStyle: "dashed" },
        promoCodeStyling,
        designSystem,
        isPremium: isPremium || false,
        sections: sections || [],
        orderButton: orderButton || {
          text: buttonText || "Get Started",
          url: orderUrl || "https://localcooks.ca",
          styling: {
            backgroundColor: "#F51042",
            color: "#ffffff",
            fontSize: "16px",
            fontWeight: "600",
            padding: "12px 24px",
            borderRadius: "8px",
            textAlign: "center"
          }
        },
        header: header || {
          title: "Local Cooks Header",
          subtitle: "Premium Quality Food Subheader",
          styling: {
            backgroundColor: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
            titleColor: "#ffffff",
            subtitleColor: "#ffffff",
            titleFontSize: "32px",
            subtitleFontSize: "18px",
            padding: "24px",
            borderRadius: "0px",
            textAlign: "center"
          }
        },
        footer: footer || {
          mainText: "Thank you for being part of the Local Cooks community!",
          contactText: "Questions? Contact us at support@localcooks.com",
          copyrightText: "\xA9 2024 Local Cooks. All rights reserved.",
          showContact: true,
          showCopyright: true,
          styling: {
            backgroundColor: "#f8fafc",
            textColor: "#64748b",
            linkColor: "#F51042",
            fontSize: "14px",
            padding: "24px 32px",
            textAlign: "center",
            borderColor: "#e2e8f0"
          }
        },
        usageSteps: usageSteps || {
          title: "\u{1F680} How to use your promo code:",
          steps: [
            `Visit our website: <a href="${orderUrl || "https://localcooks.ca"}" style="color: #1d4ed8;">${orderUrl || "https://localcooks.ca"}</a>`,
            "Browse our amazing local cooks and their delicious offerings",
            "Apply your promo code during checkout",
            "Enjoy your special offer!"
          ],
          enabled: true,
          styling: {
            backgroundColor: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            borderColor: "#93c5fd",
            titleColor: "#1d4ed8",
            textColor: "#1e40af",
            linkColor: "#1d4ed8",
            padding: "20px",
            borderRadius: "8px"
          }
        },
        emailContainer: emailContainer || {
          maxWidth: "600px",
          backgroundColor: "#f1f5f9",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
        },
        dividers: {
          enabled: true,
          style: "solid",
          color: "#e2e8f0",
          thickness: "1px",
          margin: "24px 0",
          opacity: "1"
        },
        subject,
        previewText,
        promoCodeLabel
      });
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(emailContent.html || "<p>No HTML content generated</p>");
    } catch (error) {
      console.error("\u{1F525} Error generating promo email preview:", error);
      return res.status(500).json({
        error: "Internal server error",
        message: "An error occurred while generating email preview"
      });
    }
  }
);
var adminEmailRouter = router;

// server/routes/firebase/dashboard.ts
init_firebase_auth_middleware();
init_application_service();
init_microlearning_service();
import { Router as Router2 } from "express";
var router2 = Router2();
router2.get("/firebase/dashboard", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const userId = req.neonUser.id;
    const firebaseUid = req.firebaseUser.uid;
    console.log(`\u{1F3E0} Dashboard request: Firebase UID ${firebaseUid} \u2192 Neon User ID ${userId}`);
    const [applications3, microlearningProgress] = await Promise.all([
      applicationService.getApplicationsByUserId(userId),
      microlearningService.getUserProgress(userId)
    ]);
    res.json({
      user: {
        id: userId,
        username: req.neonUser.username,
        role: req.neonUser.role,
        firebaseUid
      },
      applications: applications3,
      microlearningProgress
    });
  } catch (error) {
    console.error("Error getting dashboard data:", error);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});
router2.get("/firebase/applications/my", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const userId = req.neonUser.id;
    console.log(`\u{1F4CB} GET /api/firebase/applications/my - User ${userId}`);
    const applications3 = await applicationService.getApplicationsByUserId(userId);
    const transformed = applications3.map((app2) => ({
      ...app2,
      // Add snake_case aliases for legacy frontend compatibility
      user_id: app2.userId,
      full_name: app2.fullName,
      created_at: app2.createdAt,
      food_safety_license: app2.foodSafetyLicense,
      food_safety_license_url: app2.foodSafetyLicenseUrl
    }));
    res.json(transformed);
  } catch (error) {
    console.error("Error getting user applications:", error);
    res.status(500).json({ error: "Failed to get applications" });
  }
});
var dashboardRouter = router2;

// server/routes/firebase/media.ts
init_fileUpload();
init_firebase_auth_middleware();
import { Router as Router3 } from "express";

// server/upload-handler.ts
init_fileUpload();
init_r2_storage();
import fs2 from "fs";
async function handleFileUpload(req, res) {
  try {
    const userId = req.neonUser?.id || req.user?.id;
    if (!userId) {
      if (req.file && req.file.path) {
        try {
          fs2.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Error cleaning up file:", e);
        }
      }
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const isProduction2 = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    let fileUrl;
    let fileName;
    const folder = req.file.fieldname === "profileImage" ? "profiles" : req.file.fieldname === "image" ? "images" : "documents";
    if (isProduction2 && isR2Configured()) {
      try {
        fileUrl = await uploadToBlob(req.file, userId, folder);
        fileName = fileUrl.split("/").pop() || req.file.originalname;
      } catch (error) {
        console.error("\u274C Error uploading to R2:", error);
        if (req.file.path) {
          try {
            fs2.unlinkSync(req.file.path);
          } catch (e) {
            console.error("Error cleaning up file:", e);
          }
        }
        res.status(500).json({
          error: "File upload failed",
          details: "Failed to upload file to cloud storage"
        });
        return;
      }
    } else {
      fileUrl = getFileUrl(req.file.filename || `${userId}_${Date.now()}_${req.file.originalname}`);
      fileName = req.file.filename || req.file.originalname;
    }
    res.status(200).json({
      success: true,
      url: fileUrl,
      fileName,
      size: req.file.size,
      type: req.file.mimetype
    });
  } catch (error) {
    console.error("File upload error:", error);
    if (req.file && req.file.path) {
      try {
        fs2.unlinkSync(req.file.path);
      } catch (e) {
        console.error("Error cleaning up file:", e);
      }
    }
    res.status(500).json({
      error: "File upload failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// server/routes/firebase/media.ts
var router3 = Router3();
var handleUpload = [
  upload.single("file"),
  requireFirebaseAuthWithUser,
  handleFileUpload
];
router3.post("/upload", ...handleUpload);
router3.post("/firebase/upload-file", ...handleUpload);
var mediaRouter = router3;

// server/routes/firebase/health.ts
import { Router as Router4 } from "express";
var router4 = Router4();
router4.get("/firebase-health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    message: "Firebase Auth \u2192 Neon DB bridge is working",
    architecture: "Stateless JWT - No Sessions Required",
    auth: {
      firebaseConfigured: !!process.env.FIREBASE_PROJECT_ID,
      neonConfigured: !!process.env.DATABASE_URL,
      sessionFree: true
    }
  });
});
var healthRouter = router4;

// server/routes/firebase/platform.ts
init_firebase_auth_middleware();
init_db();
init_schema();
import { Router as Router5 } from "express";
import { eq as eq5 } from "drizzle-orm";
var router5 = Router5();
router5.get("/platform-settings/service-fee-rate", async (req, res) => {
  try {
    const [setting] = await db.select().from(platformSettings).where(eq5(platformSettings.key, "service_fee_rate")).limit(1);
    if (setting) {
      const rate = parseFloat(setting.value);
      if (!isNaN(rate) && rate >= 0 && rate <= 1) {
        return res.json({
          key: "service_fee_rate",
          value: setting.value,
          rate,
          percentage: (rate * 100).toFixed(2),
          description: setting.description
        });
      }
    }
    return res.json({
      key: "service_fee_rate",
      value: "0.05",
      rate: 0.05,
      percentage: "5.00",
      description: "Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable."
    });
  } catch (error) {
    console.error("Error getting service fee rate:", error);
    res.status(500).json({
      error: "Failed to get service fee rate",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router5.get("/admin/platform-settings/service-fee-rate", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    const [setting] = await db.select().from(platformSettings).where(eq5(platformSettings.key, "service_fee_rate")).limit(1);
    if (setting) {
      const rate = parseFloat(setting.value);
      if (!isNaN(rate) && rate >= 0 && rate <= 1) {
        return res.json({
          key: "service_fee_rate",
          value: setting.value,
          rate,
          percentage: (rate * 100).toFixed(2),
          description: setting.description,
          updatedAt: setting.updatedAt
        });
      }
    }
    return res.json({
      key: "service_fee_rate",
      value: "0.05",
      rate: 0.05,
      percentage: "5.00",
      description: "Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable."
    });
  } catch (error) {
    console.error("Error getting service fee rate:", error);
    res.status(500).json({
      error: "Failed to get service fee rate",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router5.put("/admin/platform-settings/service-fee-rate", requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    const { rate } = req.body;
    if (rate === void 0 || rate === null) {
      return res.status(400).json({ error: "Rate is required" });
    }
    const rateValue = typeof rate === "string" ? parseFloat(rate) : rate;
    if (isNaN(rateValue) || rateValue < 0 || rateValue > 1) {
      return res.status(400).json({ error: "Rate must be a number between 0 and 1 (e.g., 0.05 for 5%)" });
    }
    const userId = req.neonUser.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    const [existing] = await db.select().from(platformSettings).where(eq5(platformSettings.key, "service_fee_rate")).limit(1);
    if (existing) {
      const [updated] = await db.update(platformSettings).set({
        value: rateValue.toString(),
        updatedBy: userId,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq5(platformSettings.key, "service_fee_rate")).returning();
      return res.json({
        key: "service_fee_rate",
        value: updated.value,
        rate: rateValue,
        percentage: (rateValue * 100).toFixed(2),
        description: updated.description,
        updatedAt: updated.updatedAt,
        message: "Service fee rate updated successfully"
      });
    } else {
      const [created] = await db.insert(platformSettings).values({
        key: "service_fee_rate",
        value: rateValue.toString(),
        description: "Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.",
        updatedBy: userId
      }).returning();
      return res.json({
        key: "service_fee_rate",
        value: created.value,
        rate: rateValue,
        percentage: (rateValue * 100).toFixed(2),
        description: created.description,
        updatedAt: created.updatedAt,
        message: "Service fee rate created successfully"
      });
    }
  } catch (error) {
    console.error("Error updating service fee rate:", error);
    res.status(500).json({
      error: "Failed to update service fee rate",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
var platformRouter = router5;

// server/routes/firebase/kitchen-applications.ts
init_fileUpload();
init_firebase_auth_middleware();
init_db();
init_schema();
import { Router as Router6 } from "express";
import { fromZodError } from "zod-validation-error";

// server/domains/applications/chef-application.service.ts
init_db();
init_schema();
import { eq as eq6, and as and4, desc as desc3, inArray, getTableColumns } from "drizzle-orm";
var ChefApplicationService = class {
  /**
   * Get all applications for a specific location (Manager view)
   */
  async getApplicationsByLocation(locationId) {
    try {
      return await db.select({
        ...getTableColumns(chefKitchenApplications),
        chef: {
          id: users.id,
          username: users.username,
          role: users.role
          // Not selecting fullName/email if not guaranteed on users table
        }
      }).from(chefKitchenApplications).leftJoin(users, eq6(chefKitchenApplications.chefId, users.id)).where(eq6(chefKitchenApplications.locationId, locationId)).orderBy(desc3(chefKitchenApplications.createdAt));
    } catch (error) {
      console.error("[ChefApplicationService] Error fetching applications by location:", error);
      throw error;
    }
  }
  /**
   * Get applications for a specific chef (Chef view)
   */
  async getChefApplications(chefId) {
    try {
      const apps = await db.select({
        ...getTableColumns(chefKitchenApplications),
        location: {
          id: locations.id,
          name: locations.name,
          address: locations.address,
          managerId: locations.managerId
          // city not explicitly in schema snippet I saw, omit to be safe or check if needed
        }
      }).from(chefKitchenApplications).leftJoin(locations, eq6(chefKitchenApplications.locationId, locations.id)).where(eq6(chefKitchenApplications.chefId, chefId)).orderBy(desc3(chefKitchenApplications.createdAt));
      return apps.map((app2) => ({
        ...app2,
        locationName: app2.location?.name,
        locationAddress: app2.location?.address,
        location: app2.location
        // Ensure full location object is passed
      }));
    } catch (error) {
      console.error("[ChefApplicationService] Error fetching chef applications:", error);
      throw error;
    }
  }
  /**
   * Update application status
   */
  async updateApplicationStatus(applicationId, status, feedback, reviewedBy) {
    try {
      const [updatedApp] = await db.update(chefKitchenApplications).set({
        status,
        feedback,
        reviewedBy,
        reviewedAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq6(chefKitchenApplications.id, applicationId)).returning();
      return updatedApp;
    } catch (error) {
      console.error("[ChefApplicationService] Error updating application status:", error);
      throw error;
    }
  }
  /**
   * Grant location access to a chef
   */
  async grantLocationAccess(chefId, locationId, grantedBy) {
    try {
      const existingAccess = await db.select().from(chefLocationAccess).where(and4(
        eq6(chefLocationAccess.chefId, chefId),
        eq6(chefLocationAccess.locationId, locationId)
      )).limit(1);
      if (existingAccess.length > 0) {
        return existingAccess[0];
      }
      const [newAccess] = await db.insert(chefLocationAccess).values({
        chefId,
        locationId,
        grantedBy
      }).returning();
      return newAccess;
    } catch (error) {
      console.error("[ChefApplicationService] Error granting location access:", error);
      if (error.code === "23505") return null;
      throw error;
    }
  }
  /**
   * Get a specific application for a chef at a location
   */
  async getChefApplication(chefId, locationId) {
    try {
      const [application] = await db.select().from(chefKitchenApplications).where(and4(
        eq6(chefKitchenApplications.chefId, chefId),
        eq6(chefKitchenApplications.locationId, locationId)
      )).limit(1);
      return application;
    } catch (error) {
      console.error("[ChefApplicationService] Error fetching chef application:", error);
      throw error;
    }
  }
  /**
   * Get all applications for a manager across their locations
   */
  async getApplicationsForManager(managerId) {
    try {
      const managedLocations = await db.select({ id: locations.id }).from(locations).where(eq6(locations.managerId, managerId));
      if (managedLocations.length === 0) return [];
      const locationIds = managedLocations.map((l) => l.id);
      return await db.select({
        ...getTableColumns(chefKitchenApplications),
        chef: {
          id: users.id,
          username: users.username,
          role: users.role
          // Using safe fields
        },
        location: {
          id: locations.id,
          name: locations.name,
          address: locations.address
        }
      }).from(chefKitchenApplications).leftJoin(users, eq6(chefKitchenApplications.chefId, users.id)).leftJoin(locations, eq6(chefKitchenApplications.locationId, locations.id)).where(inArray(chefKitchenApplications.locationId, locationIds)).orderBy(desc3(chefKitchenApplications.createdAt));
    } catch (error) {
      console.error("[ChefApplicationService] Error fetching manager applications:", error);
      throw error;
    }
  }
  /**
   * Get approved kitchens for a chef
   */
  async getApprovedKitchens(chefId) {
    try {
      const approvedApps = await db.select({
        applicationId: chefKitchenApplications.id,
        locationId: chefKitchenApplications.locationId,
        approvedAt: chefKitchenApplications.updatedAt,
        location: {
          id: locations.id,
          name: locations.name,
          address: locations.address,
          logoUrl: locations.logoUrl,
          brandImageUrl: locations.brandImageUrl,
          managerId: locations.managerId
        }
      }).from(chefKitchenApplications).leftJoin(locations, eq6(chefKitchenApplications.locationId, locations.id)).where(and4(
        eq6(chefKitchenApplications.chefId, chefId),
        eq6(chefKitchenApplications.status, "approved")
      ));
      return approvedApps.filter((app2) => app2.location).map((app2) => ({
        id: app2.location.id,
        name: app2.location.name,
        address: app2.location.address,
        logoUrl: app2.location.logoUrl,
        brandImageUrl: app2.location.brandImageUrl,
        applicationId: app2.applicationId,
        approvedAt: app2.approvedAt,
        locationId: app2.locationId,
        managerId: app2.location.managerId
      }));
    } catch (error) {
      console.error("[ChefApplicationService] Error fetching approved kitchens:", error);
      throw error;
    }
  }
  /**
   * Get detailed status for kitchen access/application
   */
  async getApplicationStatus(chefId, locationId) {
    try {
      const application = await this.getChefApplication(chefId, locationId);
      if (!application) {
        return {
          hasApplication: false,
          status: null,
          canBook: false,
          message: "You must apply to this kitchen before booking. Please submit an application first."
        };
      }
      const currentTier = application.current_tier ?? 1;
      const isFullyApproved = currentTier >= 3;
      switch (application.status) {
        case "approved":
          return {
            hasApplication: true,
            status: isFullyApproved ? "approved" : "inReview",
            canBook: isFullyApproved,
            message: isFullyApproved ? "Application completed. You can book kitchens at this location." : "Application approved but not fully complete. Please complete all steps to book."
          };
        case "inReview":
          return {
            hasApplication: true,
            status: "inReview",
            canBook: false,
            message: "Your application is pending manager review. Please wait for approval before booking."
          };
        case "rejected":
          return {
            hasApplication: true,
            status: "rejected",
            canBook: false,
            message: "Your application was rejected. You can re-apply with updated documents."
          };
        case "cancelled":
          return {
            hasApplication: true,
            status: "cancelled",
            canBook: false,
            message: "Your application was cancelled. You can submit a new application."
          };
        default:
          return {
            hasApplication: true,
            status: application.status,
            canBook: false,
            message: "Unknown application status. Please contact support."
          };
      }
    } catch (error) {
      console.error("[ChefApplicationService] Error checking application status:", error);
      return {
        hasApplication: false,
        status: null,
        canBook: false,
        message: "Error checking application status. Please try again."
      };
    }
  }
  /**
   * Create or update chef kitchen application (resubmission support)
   */
  async createApplication(data) {
    try {
      const [existing] = await db.select().from(chefKitchenApplications).where(
        and4(
          eq6(chefKitchenApplications.chefId, data.chefId),
          eq6(chefKitchenApplications.locationId, data.locationId)
        )
      ).limit(1);
      if (existing) {
        const [updated] = await db.update(chefKitchenApplications).set({
          ...data,
          status: "inReview",
          // Reset status on resubmission
          feedback: null,
          // Clear old feedback
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq6(chefKitchenApplications.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(chefKitchenApplications).values({
        ...data,
        status: "inReview",
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }).returning();
      return created;
    } catch (error) {
      console.error("[ChefApplicationService] Error creating/updating application:", error);
      throw error;
    }
  }
  /**
   * Cancel application (Chef side)
   */
  async cancelApplication(applicationId, chefId) {
    try {
      const [application] = await db.select().from(chefKitchenApplications).where(and4(
        eq6(chefKitchenApplications.id, applicationId),
        eq6(chefKitchenApplications.chefId, chefId)
      )).limit(1);
      if (!application) {
        throw new Error("Application not found or unauthorized");
      }
      const [cancelled] = await db.update(chefKitchenApplications).set({
        status: "cancelled",
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq6(chefKitchenApplications.id, applicationId)).returning();
      return cancelled;
    } catch (error) {
      console.error("[ChefApplicationService] Error cancelling application:", error);
      throw error;
    }
  }
  /**
   * Update application documents
   */
  async updateApplicationDocuments(data) {
    try {
      const [updated] = await db.update(chefKitchenApplications).set({
        ...data.foodSafetyLicenseUrl && { foodSafetyLicenseUrl: data.foodSafetyLicenseUrl },
        ...data.foodEstablishmentCertUrl && { foodEstablishmentCertUrl: data.foodEstablishmentCertUrl },
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq6(chefKitchenApplications.id, data.id)).returning();
      if (!updated) {
        throw new Error("Application not found");
      }
      return updated;
    } catch (error) {
      console.error("[ChefApplicationService] Error updating application documents:", error);
      throw error;
    }
  }
  /**
   * Get application by ID
   */
  async getApplicationById(applicationId) {
    try {
      const [application] = await db.select().from(chefKitchenApplications).where(eq6(chefKitchenApplications.id, applicationId)).limit(1);
      return application;
    } catch (error) {
      console.error("[ChefApplicationService] Error getting application by ID:", error);
      throw error;
    }
  }
  /**
   * Update application tier
   */
  async updateApplicationTier(applicationId, newTier, tierData) {
    try {
      const current = await this.getApplicationById(applicationId);
      if (!current) {
        throw new Error("Application not found");
      }
      const now = /* @__PURE__ */ new Date();
      const setData = {
        current_tier: newTier,
        updatedAt: now
      };
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
      if (tierData !== void 0) {
        setData.tier_data = tierData;
      }
      const [updated] = await db.update(chefKitchenApplications).set(setData).where(eq6(chefKitchenApplications.id, applicationId)).returning();
      return updated;
    } catch (error) {
      console.error("[ChefApplicationService] Error updating application tier:", error);
      throw error;
    }
  }
};
var chefApplicationService = new ChefApplicationService();

// server/routes/firebase/kitchen-applications.ts
init_location_repository();
init_location_service();
init_kitchen_repository();
init_kitchen_service();
init_application_repository();
init_application_service();
init_chat_service();
import { and as and7, eq as eq11 } from "drizzle-orm";
var router6 = Router6();
var locationRepository = new LocationRepository();
var locationService2 = new LocationService(locationRepository);
var kitchenRepository = new KitchenRepository();
var kitchenService2 = new KitchenService(kitchenRepository);
var applicationRepository = new ApplicationRepository();
var applicationService2 = new ApplicationService(applicationRepository);
router6.post(
  "/firebase/chef/kitchen-applications",
  upload.fields([
    { name: "foodSafetyLicenseFile", maxCount: 1 },
    { name: "foodEstablishmentCertFile", maxCount: 1 },
    { name: "tier2_insurance_document", maxCount: 1 }
  ]),
  requireFirebaseAuthWithUser,
  async (req, res) => {
    try {
      console.log(`\u{1F373} POST /api/firebase/chef/kitchen-applications - Chef ${req.neonUser.id} submitting kitchen application`);
      const files = req.files;
      let foodSafetyLicenseUrl;
      let foodEstablishmentCertUrl;
      const tierFileUrls = {};
      if (files) {
        if (files["foodSafetyLicenseFile"]?.[0]) {
          try {
            foodSafetyLicenseUrl = await uploadToBlob(files["foodSafetyLicenseFile"][0], req.neonUser.id, "documents");
            console.log(`\u2705 Uploaded food safety license: ${foodSafetyLicenseUrl}`);
          } catch (uploadError) {
            console.error("\u274C Failed to upload food safety license:", uploadError);
          }
        }
        if (files["foodEstablishmentCertFile"]?.[0]) {
          try {
            foodEstablishmentCertUrl = await uploadToBlob(files["foodEstablishmentCertFile"][0], req.neonUser.id, "documents");
            console.log(`\u2705 Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
          } catch (uploadError) {
            console.error("\u274C Failed to upload food establishment cert:", uploadError);
          }
        }
        const tierFileFields = [
          "tier2_insurance_document",
          "tier2_allergen_plan",
          "tier2_supplier_list",
          "tier2_quality_control",
          "tier2_traceability",
          "tier3_food_safety_plan",
          "tier3_production_timeline",
          "tier3_cleaning_schedule",
          "tier3_training_records"
        ];
        for (const field of tierFileFields) {
          if (files[field]?.[0]) {
            try {
              const url = await uploadToBlob(files[field][0], req.neonUser.id, "documents");
              tierFileUrls[field] = url;
              console.log(`\u2705 Uploaded ${field}: ${url}`);
            } catch (uploadError) {
              console.error(`\u274C Failed to upload ${field}:`, uploadError);
            }
          }
        }
      }
      let customFieldsData;
      if (req.body.customFieldsData) {
        try {
          customFieldsData = typeof req.body.customFieldsData === "string" ? JSON.parse(req.body.customFieldsData) : req.body.customFieldsData;
        } catch (error) {
          console.error("Error parsing customFieldsData:", error);
          customFieldsData = void 0;
        }
      }
      let tierData;
      if (req.body.tier_data) {
        try {
          tierData = typeof req.body.tier_data === "string" ? JSON.parse(req.body.tier_data) : req.body.tier_data;
          if (Object.keys(tierFileUrls).length > 0) {
            tierData = { ...tierData, tierFiles: tierFileUrls };
          }
        } catch (error) {
          console.error("Error parsing tier_data:", error);
        }
      }
      const locationId = parseInt(req.body.locationId);
      const location = await locationService2.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ error: "Kitchen location not found" });
      }
      const requirements = await locationService2.getLocationRequirementsWithDefaults(locationId);
      let phoneValue = "";
      const phoneInput = req.body.phone ? req.body.phone.trim() : "";
      if (requirements.requirePhone) {
        if (!phoneInput || phoneInput === "") {
          return res.status(400).json({
            error: "Validation error",
            message: "Phone number is required for this location",
            details: [{
              code: "too_small",
              minimum: 1,
              type: "string",
              inclusive: true,
              exact: false,
              message: "Phone number is required",
              path: ["phone"]
            }]
          });
        }
        const { phoneNumberSchema: phoneNumberSchema2 } = await Promise.resolve().then(() => (init_phone_validation(), phone_validation_exports));
        const phoneValidation = phoneNumberSchema2.safeParse(phoneInput);
        if (!phoneValidation.success) {
          const validationError = fromZodError(phoneValidation.error);
          return res.status(400).json({
            error: "Validation error",
            message: validationError.message,
            details: validationError.details
          });
        }
        phoneValue = phoneValidation.data;
      } else {
        if (phoneInput && phoneInput !== "") {
          const { optionalPhoneNumberSchema: optionalPhoneNumberSchema2 } = await Promise.resolve().then(() => (init_phone_validation(), phone_validation_exports));
          const phoneValidation = optionalPhoneNumberSchema2.safeParse(phoneInput);
          if (!phoneValidation.success) {
            const validationError = fromZodError(phoneValidation.error);
            return res.status(400).json({
              error: "Validation error",
              message: validationError.message,
              details: validationError.details
            });
          }
          phoneValue = phoneValidation.data || "";
        }
      }
      let businessInfo = {};
      if (req.body.businessDescription) {
        try {
          businessInfo = typeof req.body.businessDescription === "string" ? JSON.parse(req.body.businessDescription) : req.body.businessDescription;
        } catch (error) {
          console.error("Error parsing businessDescription:", error);
          businessInfo = {};
        }
      }
      const fullNameParts = (req.body.fullName || "").trim().split(/\s+/);
      const firstName = fullNameParts[0] || "";
      const lastName = fullNameParts.slice(1).join(" ") || "";
      if (requirements.requireFirstName && (!firstName || firstName.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "First name is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "First name is required",
            path: ["firstName"]
          }]
        });
      }
      if (requirements.requireLastName && (!lastName || lastName.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Last name is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Last name is required",
            path: ["lastName"]
          }]
        });
      }
      if (requirements.requireEmail && (!req.body.email || req.body.email.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Email is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Email is required",
            path: ["email"]
          }]
        });
      }
      if (requirements.requireBusinessName && (!businessInfo.businessName || businessInfo.businessName.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Business name is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Business name is required",
            path: ["businessName"]
          }]
        });
      }
      if (requirements.requireBusinessType && (!businessInfo.businessType || businessInfo.businessType.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Business type is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Business type is required",
            path: ["businessType"]
          }]
        });
      }
      if (requirements.requireExperience && (!businessInfo.experience || businessInfo.experience.trim() === "") && (!req.body.cookingExperience || req.body.cookingExperience.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Experience level is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Experience level is required",
            path: ["experience"]
          }]
        });
      }
      if (requirements.requireBusinessDescription && (!businessInfo.description || businessInfo.description.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Business description is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Business description is required",
            path: ["businessDescription"]
          }]
        });
      }
      if (requirements.requireFoodHandlerCert && !req.body.foodSafetyLicense) {
        return res.status(400).json({
          error: "Validation error",
          message: "Food handler certificate is required for this location",
          details: [{
            code: "custom",
            message: "Food handler certificate is required",
            path: ["foodSafetyLicense"]
          }]
        });
      }
      if (requirements.requireFoodHandlerExpiry && (!businessInfo.foodHandlerCertExpiry || businessInfo.foodHandlerCertExpiry.trim() === "") && (!req.body.foodSafetyLicenseExpiry || req.body.foodSafetyLicenseExpiry.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Food handler certificate expiry date is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Food handler certificate expiry date is required",
            path: ["foodHandlerCertExpiry"]
          }]
        });
      }
      let foodEstablishmentCertValue = "no";
      foodEstablishmentCertValue = req.body.foodEstablishmentCert || "no";
      if (requirements.requireUsageFrequency && (!businessInfo.usageFrequency || businessInfo.usageFrequency.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Usage frequency is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Usage frequency is required",
            path: ["usageFrequency"]
          }]
        });
      }
      if (requirements.requireSessionDuration && (!businessInfo.sessionDuration || businessInfo.sessionDuration.trim() === "")) {
        return res.status(400).json({
          error: "Validation error",
          message: "Session duration is required for this location",
          details: [{
            code: "too_small",
            minimum: 1,
            type: "string",
            message: "Session duration is required",
            path: ["sessionDuration"]
          }]
        });
      }
      const formData = {
        chefId: req.neonUser.id,
        locationId,
        fullName: req.body.fullName || `${firstName} ${lastName}`.trim() || "N/A",
        email: req.body.email || "",
        phone: phoneValue,
        // Empty string if not required (database has notNull constraint)
        kitchenPreference: req.body.kitchenPreference || "commercial",
        businessDescription: req.body.businessDescription || void 0,
        cookingExperience: req.body.cookingExperience || businessInfo.experience || void 0,
        foodSafetyLicense: req.body.foodSafetyLicense || "no",
        foodSafetyLicenseUrl: foodSafetyLicenseUrl || req.body.foodSafetyLicenseUrl || void 0,
        foodSafetyLicenseExpiry: req.body.foodSafetyLicenseExpiry || businessInfo.foodHandlerCertExpiry || void 0,
        foodEstablishmentCert: foodEstablishmentCertValue,
        foodEstablishmentCertUrl: foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl || void 0,
        foodEstablishmentCertExpiry: req.body.foodEstablishmentCertExpiry || businessInfo.foodEstablishmentCertExpiry || void 0,
        customFieldsData: customFieldsData || void 0
      };
      const currentTierValue = parseInt(req.body.current_tier) || 1;
      if (req.body.current_tier) {
        formData.current_tier = currentTierValue;
      }
      if (currentTierValue === 2) {
        const existingApp = await chefApplicationService.getChefApplication(req.neonUser.id, locationId);
        const mergedTierData = {
          ...existingApp?.tier_data || {},
          ...tierData || {},
          // Ensure tierFiles are included (uploaded documents like insurance)
          tierFiles: {
            ...existingApp?.tier_data?.tierFiles || {},
            ...tierData?.tierFiles || {},
            ...tierFileUrls
          },
          // Store Step 2 custom fields separately in tier_data
          tier2_custom_fields_data: customFieldsData || {},
          tier2_submitted_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        formData.tier_data = mergedTierData;
        if (existingApp?.customFieldsData) {
          formData.customFieldsData = existingApp.customFieldsData;
        }
        formData.tier2_completed_at = /* @__PURE__ */ new Date();
      } else if (tierData) {
        formData.tier_data = tierData;
      } else if (Object.keys(tierFileUrls).length > 0) {
        formData.tier_data = { tierFiles: tierFileUrls };
      }
      const currentTier = parseInt(req.body.current_tier) || 1;
      if (currentTier === 2) {
        if (requirements.tier2_food_establishment_cert_required) {
          const hasFoodEstablishmentCert = foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl;
          if (!hasFoodEstablishmentCert) {
            return res.status(400).json({
              error: "Validation error",
              message: "Food Establishment Certificate is required for Tier 2",
              details: [{
                code: "custom",
                message: "Food Establishment Certificate is required",
                path: ["foodEstablishmentCert"]
              }]
            });
          }
        }
        if (requirements.tier2_insurance_document_required) {
          const hasInsuranceDoc = tierFileUrls["tier2_insurance_document"];
          if (!hasInsuranceDoc) {
            return res.status(400).json({
              error: "Validation error",
              message: "Insurance Document is required for Tier 2",
              details: [{
                code: "custom",
                message: "Insurance Document is required",
                path: ["tier2_insurance_document"]
              }]
            });
          }
        }
      }
      if (req.body.government_license_number) {
        formData.government_license_number = req.body.government_license_number;
      }
      if (req.body.government_license_received_date) {
        formData.government_license_received_date = req.body.government_license_received_date;
      }
      if (req.body.government_license_expiry_date) {
        formData.government_license_expiry_date = req.body.government_license_expiry_date;
      }
      const parsedData = insertChefKitchenApplicationSchema.safeParse(formData);
      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        console.log("\u274C Validation failed:", validationError.details);
        return res.status(400).json({
          error: "Validation error",
          message: validationError.message,
          details: validationError.details
        });
      }
      const applicationData = {
        ...parsedData.data,
        // Include tier fields (not in Zod schema but needed for storage)
        ...formData.current_tier && { current_tier: formData.current_tier },
        ...formData.tier_data && { tier_data: formData.tier_data },
        ...formData.tier2_completed_at && { tier2_completed_at: formData.tier2_completed_at },
        ...formData.customFieldsData && { customFieldsData: formData.customFieldsData },
        ...foodEstablishmentCertUrl && { foodEstablishmentCertUrl }
      };
      const application = await chefApplicationService.createApplication(applicationData);
      console.log(`\u2705 Kitchen application created/updated: Chef ${req.neonUser.id} \u2192 Location ${parsedData.data.locationId}, ID: ${application.id}`);
      res.status(201).json({
        success: true,
        application,
        message: "Kitchen application submitted successfully. The kitchen manager will review your application.",
        isResubmission: application.createdAt < application.updatedAt
      });
    } catch (error) {
      console.error("Error creating kitchen application:", error);
      res.status(500).json({
        error: "Failed to submit kitchen application",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);
router6.get("/firebase/chef/kitchen-applications", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const chefId = req.neonUser.id;
    const applications3 = await chefApplicationService.getChefApplications(chefId);
    res.json(applications3);
  } catch (error) {
    console.error("Error getting chef kitchen applications:", error);
    res.status(500).json({ error: "Failed to get kitchen applications" });
  }
});
router6.get("/firebase/chef/kitchen-applications/location/:locationId", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }
    const application = await chefApplicationService.getChefApplication(req.neonUser.id, locationId);
    if (!application) {
      return res.json({
        hasApplication: false,
        canBook: false,
        message: "You have not applied to this kitchen yet.",
        application: null
      });
    }
    const location = await locationService2.getLocationById(locationId);
    const currentTier = application.current_tier ?? 1;
    res.json({
      ...application,
      hasApplication: true,
      canBook: application.status === "approved" && currentTier >= 3,
      location: location ? {
        id: location.id,
        name: location.name,
        address: location.address,
        managerId: location.managerId
      } : null
    });
  } catch (error) {
    console.error("Error getting chef kitchen application:", error);
    res.status(500).json({ error: "Failed to get kitchen application" });
  }
});
router6.get("/firebase/chef/kitchen-access-status/:locationId", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }
    const accessStatus = await chefApplicationService.getApplicationStatus(req.neonUser.id, locationId);
    res.json(accessStatus);
  } catch (error) {
    console.error("Error getting kitchen access status:", error);
    res.status(500).json({ error: "Failed to get kitchen access status" });
  }
});
router6.get("/firebase/chef/approved-kitchens", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const approvedKitchens = await chefApplicationService.getApprovedKitchens(req.neonUser.id);
    res.json(approvedKitchens);
  } catch (error) {
    console.error("Error getting approved kitchens:", error);
    res.status(500).json({ error: "Failed to get approved kitchens" });
  }
});
router6.patch("/firebase/chef/kitchen-applications/:id/cancel", requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    const cancelledApplication = await chefApplicationService.cancelApplication(applicationId, req.neonUser.id);
    res.json({
      success: true,
      application: cancelledApplication,
      message: "Application cancelled successfully"
    });
  } catch (error) {
    console.error("Error cancelling kitchen application:", error);
    res.status(500).json({
      error: "Failed to cancel application",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router6.patch(
  "/firebase/chef/kitchen-applications/:id/documents",
  upload.fields([
    { name: "foodSafetyLicenseFile", maxCount: 1 },
    { name: "foodEstablishmentCertFile", maxCount: 1 }
  ]),
  requireFirebaseAuthWithUser,
  async (req, res) => {
    try {
      const applicationId = parseInt(req.params.id);
      if (isNaN(applicationId)) {
        return res.status(400).json({ error: "Invalid application ID" });
      }
      const [existing] = await chefApplicationService.getChefApplications(req.neonUser.id);
      const applications3 = await chefApplicationService.getChefApplications(req.neonUser.id);
      const application = applications3.find((a) => a.id === applicationId);
      if (!application) {
        return res.status(403).json({ error: "Application not found or access denied" });
      }
      const files = req.files;
      const updateData = { id: applicationId };
      if (files) {
        if (files["foodSafetyLicenseFile"]?.[0]) {
          try {
            updateData.foodSafetyLicenseUrl = await uploadToBlob(files["foodSafetyLicenseFile"][0], req.neonUser.id, "documents");
          } catch (uploadError) {
            console.error("\u274C Failed to upload food safety license:", uploadError);
          }
        }
        if (files["foodEstablishmentCertFile"]?.[0]) {
          try {
            updateData.foodEstablishmentCertUrl = await uploadToBlob(files["foodEstablishmentCertFile"][0], req.neonUser.id, "documents");
          } catch (uploadError) {
            console.error("\u274C Failed to upload food establishment cert:", uploadError);
          }
        }
      }
      const updatedApplication = await chefApplicationService.updateApplicationDocuments(updateData);
      res.json({
        success: true,
        application: updatedApplication,
        message: "Documents updated successfully. They will be reviewed by the manager."
      });
    } catch (error) {
      console.error("Error updating kitchen application documents:", error);
      res.status(500).json({
        error: "Failed to update documents",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);
router6.get("/manager/kitchen-applications", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const user = req.neonUser;
    const applications3 = await chefApplicationService.getApplicationsForManager(user.id);
    res.json(applications3);
  } catch (error) {
    console.error("Error getting kitchen applications for manager:", error);
    res.status(500).json({ error: "Failed to get applications" });
  }
});
router6.get("/manager/kitchen-applications/location/:locationId", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const user = req.neonUser;
    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }
    const location = await locationService2.getLocationById(locationId);
    if (!location || location.managerId !== user.id) {
      return res.status(403).json({ error: "Access denied to this location" });
    }
    const applications3 = await chefApplicationService.getApplicationsByLocation(locationId);
    res.json(applications3);
  } catch (error) {
    console.error("Error getting kitchen applications for location:", error);
    res.status(500).json({ error: "Failed to get applications" });
  }
});
router6.patch("/manager/kitchen-applications/:id/status", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const user = req.neonUser;
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    const { status, feedback } = req.body;
    if (!status || !["approved", "rejected", "inReview"].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved", "rejected", or "inReview"' });
    }
    const applications3 = await chefApplicationService.getApplicationsForManager(user.id);
    const application = applications3.find((a) => a.id === applicationId);
    if (!application) {
      return res.status(404).json({ error: "Application not found or access denied" });
    }
    const location = await locationService2.getLocationById(application.locationId);
    if (!location || location.managerId !== user.id) {
      return res.status(403).json({ error: "Access denied to this application" });
    }
    let updatedApplication = await chefApplicationService.updateApplicationStatus(
      applicationId,
      status,
      feedback,
      user.id
    );
    if (req.body.current_tier !== void 0 && updatedApplication) {
      const newTier = parseInt(req.body.current_tier);
      const tierData = req.body.tier_data;
      updatedApplication = await chefApplicationService.updateApplicationTier(
        applicationId,
        newTier,
        tierData
      ) || updatedApplication;
    }
    console.log(`\u2705 Application ${applicationId} ${status} by Manager ${user.id}`);
    if (status === "approved" && updatedApplication) {
      const currentTier = updatedApplication.current_tier ?? 1;
      const previousTier = application.current_tier ?? 1;
      if (currentTier > previousTier) {
        await notifyTierTransition(applicationId, previousTier, currentTier);
      }
      if (currentTier >= 2) {
        const { tierValidationService: tierValidationService2 } = await Promise.resolve().then(() => (init_tier_validation(), tier_validation_exports));
        const requirements = await locationService2.getLocationRequirementsWithDefaults(application.locationId);
        const validation = tierValidationService2.validateTierRequirements(
          updatedApplication,
          requirements,
          2
          // Validate for Tier 2 strictness
        );
        if (validation.valid) {
          try {
            const existingAccess = await db.select().from(chefLocationAccess).where(
              and7(
                eq11(chefLocationAccess.chefId, application.chefId),
                eq11(chefLocationAccess.locationId, application.locationId)
              )
            );
            if (existingAccess.length === 0) {
              await db.insert(chefLocationAccess).values({
                chefId: application.chefId,
                locationId: application.locationId,
                grantedBy: req.neonUser.id,
                grantedAt: /* @__PURE__ */ new Date()
              });
              console.log(`\u2705 Granted chef ${application.chefId} access to location ${application.locationId} (Requirements Met)`);
            }
          } catch (accessError) {
            console.error("Error granting chef access:", accessError);
          }
        } else {
          console.log(`\u2139\uFE0F Chef ${application.chefId} at Tier ${currentTier} but missing requirements: ${validation.missingRequirements.join(", ")}`);
        }
      }
    }
    res.json({
      success: true,
      application: updatedApplication,
      message: `Application ${status} successfully`
    });
  } catch (error) {
    console.error("Error updating kitchen application status:", error);
    res.status(500).json({
      error: "Failed to update application status",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router6.patch("/manager/kitchen-applications/:id/verify-documents", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const user = req.neonUser;
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    const { foodSafetyLicenseStatus, foodEstablishmentCertStatus } = req.body;
    const validStatuses = ["pending", "approved", "rejected"];
    if (foodSafetyLicenseStatus && !validStatuses.includes(foodSafetyLicenseStatus)) {
      return res.status(400).json({ error: "Invalid food safety license status" });
    }
    if (foodEstablishmentCertStatus && !validStatuses.includes(foodEstablishmentCertStatus)) {
      return res.status(400).json({ error: "Invalid food establishment cert status" });
    }
    const application = await chefApplicationService.getApplicationById(applicationId);
    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }
    const location = await locationService2.getLocationById(application.locationId);
    if (!location || location.managerId !== user.id) {
      return res.status(403).json({ error: "Access denied to this application" });
    }
    const updateData = { id: applicationId };
    if (foodSafetyLicenseStatus) updateData.foodSafetyLicenseStatus = foodSafetyLicenseStatus;
    if (foodEstablishmentCertStatus) updateData.foodEstablishmentCertStatus = foodEstablishmentCertStatus;
    const updatedApplication = await chefApplicationService.updateApplicationDocuments(updateData);
    if (updatedApplication?.chat_conversation_id) {
      const documentName = foodSafetyLicenseStatus === "approved" ? "Food Safety License" : foodEstablishmentCertStatus === "approved" ? "Food Establishment Certificate" : "Document";
      if (foodSafetyLicenseStatus === "approved" || foodEstablishmentCertStatus === "approved") {
        await sendSystemNotification(
          updatedApplication.chat_conversation_id,
          "DOCUMENT_VERIFIED",
          { documentName }
        );
      }
    }
    res.json({
      success: true,
      application: updatedApplication,
      message: "Document verification updated"
    });
  } catch (error) {
    console.error("Error verifying kitchen application documents:", error);
    res.status(500).json({
      error: "Failed to verify documents",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router6.patch("/manager/kitchen-applications/:id/tier", requireFirebaseAuthWithUser, requireManager, async (req, res) => {
  try {
    const user = req.neonUser;
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    const parsed = updateApplicationTierSchema.safeParse({
      id: applicationId,
      ...req.body
    });
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation error",
        message: parsed.error.message
      });
    }
    const application = await chefApplicationService.getApplicationById(applicationId);
    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }
    const location = await locationService2.getLocationById(application.locationId);
    if (!location || location.managerId !== user.id) {
      return res.status(403).json({ error: "Access denied to this application" });
    }
    const updatedApplication = await chefApplicationService.updateApplicationTier(
      applicationId,
      parsed.data.current_tier,
      parsed.data.tier_data
    );
    if (updatedApplication?.chat_conversation_id) {
      const fromTier = application.current_tier ?? 1;
      const toTier = parsed.data.current_tier;
      await notifyTierTransition(applicationId, fromTier, toTier);
    }
    res.json({
      success: true,
      application: updatedApplication,
      message: `Application advanced to Tier ${parsed.data.current_tier}`
    });
  } catch (error) {
    console.error("Error updating application tier:", error);
    res.status(500).json({
      error: "Failed to update application tier",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
var kitchenApplicationsRouter = router6;

// server/firebase-routes.ts
function registerFirebaseRoutes(app2) {
  console.log("\u{1F525} Registering Firebase Routes (Modular)...");
  const apiPrefix = "/api";
  app2.use(apiPrefix, adminEmailRouter);
  app2.use(apiPrefix, dashboardRouter);
  app2.use(apiPrefix, mediaRouter);
  app2.use(apiPrefix, healthRouter);
  app2.use(apiPrefix, platformRouter);
  app2.use(apiPrefix, kitchenApplicationsRouter);
  console.log("\u2705 All Firebase modules registered.");
}

// server/routes.ts
init_email();
init_firebase_setup();
init_firebase_auth_middleware();
init_user_repository();
init_user_service();
import { createServer } from "http";
async function registerRoutes(app2) {
  console.log("[Routes] Registering all routes including chef-kitchen-access and portal user routes...");
  app2.use(optionalFirebaseAuth);
  app2.use("/api/applications", (await Promise.resolve().then(() => (init_applications(), applications_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_locations(), locations_exports))).default);
  app2.use("/api/microlearning", (await Promise.resolve().then(() => (init_microlearning(), microlearning_exports))).default);
  app2.use("/api/firebase/microlearning", (await Promise.resolve().then(() => (init_microlearning(), microlearning_exports))).default);
  app2.use("/api/files", (await Promise.resolve().then(() => (init_files(), files_exports))).default);
  const userRepo2 = new UserRepository();
  const userService3 = new UserService(userRepo2);
  app2.get("/api/user-exists", async (req, res) => {
    const username = req.query.username;
    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }
    const exists = await userService3.checkUsernameExists(username);
    res.json({ exists });
  });
  app2.get("/api/firebase/user/me", requireFirebaseAuthWithUser, async (req, res) => {
    try {
      const user = req.neonUser;
      res.json({
        ...user,
        is_verified: user.isVerified,
        has_seen_welcome: user.has_seen_welcome
      });
    } catch (error) {
      console.error("[API] Error getting user:", error);
      res.status(500).json({ error: "Failed to get user info" });
    }
  });
  app2.get("/api/user/profile", requireFirebaseAuthWithUser, async (req, res) => {
    try {
      const user = req.neonUser;
      const responseUser = {
        ...user,
        is_verified: user.isVerified
      };
      res.json(responseUser);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });
  app2.post("/api/firebase-sync-user", requireFirebaseAuthWithUser, async (req, res) => {
    try {
      const user = req.neonUser;
      res.json(user);
    } catch (error) {
      console.error("Error syncing user:", error);
      res.status(500).json({ error: "Failed to sync user" });
    }
  });
  app2.post("/api/firebase-register-user", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
      }
      const token = authHeader.split("Bearer ")[1];
      const decodedToken = await verifyFirebaseToken(token);
      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const { email, uid, role, ...otherData } = req.body;
      if (decodedToken.uid !== uid) {
        return res.status(403).json({ error: "Token mismatch" });
      }
      const existing = await userService3.getUserByFirebaseUid(uid);
      if (existing) {
        return res.json(existing);
      }
      const newUser = await userService3.createUser({
        username: email,
        email,
        firebaseUid: uid,
        role: role || "user",
        isVerified: decodedToken.email_verified || false,
        ...otherData
      });
      res.status(201).json(newUser);
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });
  app2.post("/api/unsubscribe", async (req, res) => {
    try {
      const { email, reason, feedback, timestamp: timestamp2 } = req.body;
      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email address is required"
        });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email format"
        });
      }
      const unsubscribeNotificationContent = {
        to: "localcooks@localcook.shop",
        subject: `\u{1F6AB} Unsubscribe Request - ${email}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks - Unsubscribe Request</h1>
            </div>
            
            <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin-top: 0;">New Unsubscribe Request</h2>
              
              <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #dc2626; font-weight: 600;">
                  \u{1F4E7} Email: <span style="font-weight: normal;">${email}</span>
                </p>
              </div>
              
              <div style="margin: 20px 0;">
                <h3 style="color: #374151; margin-bottom: 10px;">Request Details:</h3>
                <ul style="color: #6b7280; line-height: 1.6;">
                  <li><strong>Timestamp:</strong> ${new Date(timestamp2).toLocaleString()}</li>
                  <li><strong>Reason:</strong> ${reason || "Not specified"}</li>
                  ${feedback ? `<li><strong>Feedback:</strong> ${feedback}</li>` : ""}
                </ul>
              </div>
              
              <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 6px; padding: 15px; margin: 20px 0;">
                <h4 style="color: #0369a1; margin: 0 0 10px 0;">Action Required:</h4>
                <p style="color: #0c4a6e; margin: 0; font-size: 14px;">
                  Please manually remove <strong>${email}</strong> from all email lists and marketing databases within 24 hours.
                </p>
              </div>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  This is an automated notification from the Local Cooks unsubscribe system.
                </p>
              </div>
            </div>
          </div>
        `,
        text: `
          Local Cooks - Unsubscribe Request
          
          New unsubscribe request received:
          
          Email: ${email}
          Timestamp: ${new Date(timestamp2).toLocaleString()}
          Reason: ${reason || "Not specified"}
          ${feedback ? `Feedback: ${feedback}` : ""}
          
          ACTION REQUIRED: Please manually remove ${email} from all email lists and marketing databases within 24 hours.
        `
      };
      const emailSent = await sendEmail(unsubscribeNotificationContent, {
        trackingId: `unsubscribe_${email}_${Date.now()}`
      });
      if (!emailSent) {
        console.error("Failed to send unsubscribe notification email");
        return res.status(500).json({
          success: false,
          message: "Failed to process unsubscribe request"
        });
      }
      const userConfirmationContent = {
        to: email,
        subject: "Local Cooks - Unsubscribe Request Received",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks</h1>
              <p style="color: white; margin: 5px 0 0 0; opacity: 0.9;">Unsubscribe Confirmation</p>
            </div>
            
            <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin-top: 0;">We've Received Your Request</h2>
              
              <p style="color: #374151; line-height: 1.6;">
                Hi there,
              </p>
              
              <p style="color: #374151; line-height: 1.6;">
                We've received your request to unsubscribe from our email communications. We're sorry to see you go!
              </p>
              
              <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #0c4a6e;">
                  <strong>What happens next:</strong><br>
                  Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
                </p>
              </div>
              
              <p style="color: #374151; line-height: 1.6;">
                If you have any questions or if this was done in error, please don't hesitate to contact us at 
                <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>.
              </p>
              
              <p style="color: #374151; line-height: 1.6;">
                Thank you for being part of the Local Cooks community!
              </p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  Local Cooks Team<br>
                  <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>
                </p>
              </div>
            </div>
          </div>
        `,
        text: `
          Local Cooks - Unsubscribe Confirmation
          
          Hi there,
          
          We've received your request to unsubscribe from our email communications. We're sorry to see you go!
          
          What happens next:
          Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
          
          If you have any questions or if this was done in error, please contact us at localcooks@localcook.shop.
          
          Thank you for being part of the Local Cooks community!
          
          Local Cooks Team
          localcooks@localcook.shop
        `
      };
      await sendEmail(userConfirmationContent, {
        trackingId: `unsubscribe_confirmation_${email}_${Date.now()}`
      });
      console.log(`\u2705 Unsubscribe request processed for: ${email}`);
      res.json({
        success: true,
        message: "Unsubscribe request processed successfully"
      });
    } catch (error) {
      console.error("Error processing unsubscribe request:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    }
  });
  app2.use("/api/manager", (await Promise.resolve().then(() => (init_manager(), manager_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_kitchens(), kitchens_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_bookings(), bookings_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_equipment(), equipment_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_storage_listings(), storage_listings_exports))).default);
  app2.use("/api/admin", (await Promise.resolve().then(() => (init_admin(), admin_exports))).default);
  app2.use("/api/webhooks", (await Promise.resolve().then(() => (init_webhooks(), webhooks_exports))).default);
  app2.use("/api", (await Promise.resolve().then(() => (init_portal_auth(), portal_auth_exports))).default);
  app2.use("/api/portal", (await Promise.resolve().then(() => (init_portal(), portal_exports))).default);
  app2.use("/api/chef", (await Promise.resolve().then(() => (init_chef(), chef_exports))).default);
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express2 from "express";
import fs5 from "fs";
import { nanoid } from "nanoid";
import path3 from "path";
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const { createLogger, createServer: createViteServer } = await import("vite");
  const viteConfigPath = "../vite.config";
  const viteConfigModule = await import(viteConfigPath);
  const viteConfig = viteConfigModule.default;
  const viteLogger = createLogger();
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    if (req.originalUrl.startsWith("/api/")) {
      return next();
    }
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs5.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path3.resolve(import.meta.dirname, "public");
  if (!fs5.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express2.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express3();
app.set("env", process.env.NODE_ENV || "development");
app.use(express3.json({ limit: "12mb" }));
app.use(express3.urlencoded({ limit: "12mb", extended: true }));
initializeFirebaseAdmin();
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
var routesInitialized = false;
var initPromise = (async () => {
  if (routesInitialized) return;
  try {
    log("[INIT] Starting route registration...");
    await registerRoutes(app);
    registerFirebaseRoutes(app);
    app.use((err, _req, res, _next) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      console.error(err);
    });
    routesInitialized = true;
    log("[ROUTES] All routes registered successfully");
    if (process.env.VERCEL) {
      log("[SERVERLESS] Running on Vercel - routes registered");
    } else {
      const { createServer: createServer2 } = await import("http");
      const server = createServer2(app);
      const port = process.env.PORT || (app.get("env") === "development" ? 5001 : 5e3);
      if (app.get("env") === "development") {
        await setupVite(app, server);
      } else {
        serveStatic(app);
      }
      server.listen(port, () => {
        log(`[LOCAL] Server running on http://localhost:${port}`);
      });
    }
  } catch (error) {
    console.error("Failed to register routes:", error);
    throw error;
  }
})();
app.use(async (req, res, next) => {
  if (!routesInitialized) {
    await initPromise;
  }
  next();
});
var index_default = app;
export {
  index_default as default
};
