/**
 * Input Validation Utilities
 * 
 * Centralized validation logic for domain services.
 * Uses Zod schemas where possible for consistency.
 */

import { z } from 'zod';

/**
 * Validate user input using Zod schema
 */
export async function validateUserInput(data: unknown) {
  const userSchema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username must be at most 50 characters'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    email: z.string().email('Invalid email format').optional(),
    role: z.enum(['admin', 'chef', 'manager']).optional(),
    firebaseUid: z.string().optional(),
    isVerified: z.boolean().optional(),
    has_seen_welcome: z.boolean().optional(),
  });

  try {
    return userSchema.parse(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate booking input using Zod schema
 */
export async function validateBookingInput(data: unknown) {
  const bookingSchema = z.object({
    chefId: z.number().positive('Chef ID must be positive'),
    kitchenId: z.number().positive('Kitchen ID must be positive'),
    startDate: z.coerce.date().min(new Date(), 'Start date cannot be in the past'),
    endDate: z.coerce.date(),
    specialNotes: z.string().optional(),
  });

  try {
    return bookingSchema.parse(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate application input using Zod schema
 */
export async function validateApplicationInput(data: unknown) {
  const applicationSchema = z.object({
    userId: z.number().positive('User ID must be positive'),
    fullName: z.string().min(2, 'Full name must be at least 2 characters'),
    email: z.string().email('Invalid email format'),
    phone: z.string().min(10, 'Phone number must be at least 10 characters'),
    foodSafetyLicense: z.enum(['yes', 'no', 'notSure']),
    foodEstablishmentCert: z.enum(['yes', 'no', 'notSure']),
    kitchenPreference: z.enum(['commercial', 'home', 'notSure']),
    foodSafetyLicenseUrl: z.string().optional(),
    foodEstablishmentCertUrl: z.string().optional(),
    feedback: z.string().optional(),
  });

  try {
    return applicationSchema.parse(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate location input using Zod schema
 */
export async function validateLocationInput(data: unknown) {
  const locationSchema = z.object({
    managerId: z.number().positive('Manager ID must be positive'),
    name: z.string().min(2, 'Location name must be at least 2 characters'),
    address: z.string().min(5, 'Address must be at least 5 characters'),
    notificationEmail: z.string().email('Invalid email format').optional(),
    notificationPhone: z.string().optional(),
    cancellationPolicyHours: z.number().positive('Cancellation policy hours must be positive').optional(),
    cancellationPolicyMessage: z.string().optional(),
    defaultDailyBookingLimit: z.number().positive('Daily booking limit must be positive').optional(),
    minimumBookingWindowHours: z.number().positive('Minimum booking window must be positive').optional(),
    logoUrl: z.string().optional(),
    brandImageUrl: z.string().optional(),
    timezone: z.string().optional(),
    kitchenLicenseUrl: z.string().optional(),
    kitchenLicenseStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
    kitchenLicenseExpiry: z.string().optional(),
    // Terms & Policies document URL
    kitchenTermsUrl: z.string().optional(),
    // Contact fields
    contactEmail: z.string().email('Invalid contact email format').optional().or(z.literal('')),
    contactPhone: z.string().optional(),
    preferredContactMethod: z.enum(['email', 'phone', 'both']).optional(),
    description: z.string().optional(),
    customOnboardingLink: z.string().optional(),
  });

  try {
    return locationSchema.parse(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate kitchen input using Zod schema
 */
export async function validateKitchenInput(data: unknown) {
  const kitchenSchema = z.object({
    locationId: z.number().positive('Location ID must be positive'),
    name: z.string().min(1, 'Kitchen name is required'),
    description: z.string().optional(),
    imageUrl: z.string().optional(), // Allow relative paths for local dev (starts with /)
    galleryImages: z.array(z.string()).optional(),
    amenities: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    hourlyRate: z.number().positive('Hourly rate must be positive').optional(),
    currency: z.string().length(3).optional(),
    minimumBookingHours: z.number().positive('Minimum booking hours must be positive').optional(),
    pricingModel: z.enum(['hourly', 'daily', 'weekly', 'monthly-flat', 'per-cubic-foot']).optional(),
  });

  try {
    return kitchenSchema.parse(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }
}
