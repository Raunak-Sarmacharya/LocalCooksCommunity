import { validateAndNormalizePhone } from '@shared/phone-validation';
import { db } from './db';
import { applications, portalUserApplications } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Utility functions for phone number handling across the application
 */

/**
 * Gets a manager's phone number with fallback logic
 * Priority: location.notificationPhone > applications.phone (manager's application)
 * Always checks applications table as fallback if location phone is not available
 */
export async function getManagerPhone(
  location: any,
  managerId: number | null | undefined,
  pool?: any
): Promise<string | null> {
  // First, check location's notification phone
  let phone = location?.notificationPhone || location?.notification_phone || null;

  if (phone) {
    const normalized = validateAndNormalizePhone(phone);
    if (normalized) {
      return normalized;
    }
    console.warn(`⚠️ Location notification phone is invalid format: ${phone}`);
  }

  // Fallback: Get phone from manager's application
  if (!phone && managerId) {
    try {
      const result = await db.select({ phone: applications.phone })
        .from(applications)
        .where(eq(applications.userId, managerId))
        .orderBy(desc(applications.createdAt))
        .limit(1);

      if (result.length > 0 && result[0].phone) {
        phone = result[0].phone;
        const normalized = validateAndNormalizePhone(phone);
        if (normalized) {
          return normalized;
        }
        console.warn(`⚠️ Manager application phone is invalid format: ${phone}`);
      }
    } catch (error) {
      // Non-critical error
      console.warn('Could not retrieve manager phone from application:', error);
    }
  }

  return null;
}

/**
 * Gets a chef's phone number from their application
 */
export async function getChefPhone(
  chefId: number,
  pool?: any
): Promise<string | null> {
  if (!chefId) return null;

  try {
    const result = await db.select({ phone: applications.phone })
      .from(applications)
      .where(eq(applications.userId, chefId))
      .orderBy(desc(applications.createdAt))
      .limit(1);

    if (result.length > 0 && result[0].phone) {
      const phone = result[0].phone;
      const normalized = validateAndNormalizePhone(phone);
      if (normalized) {
        return normalized;
      }
      console.warn(`⚠️ Chef application phone is invalid format: ${phone}`);
    }
  } catch (error) {
    console.warn('Could not retrieve chef phone from application:', error);
  }

  return null;
}

/**
 * Gets a portal user's phone number from their application
 * Priority: portal_user_applications.phone > applications.phone (fallback)
 */
export async function getPortalUserPhone(
  userId: number,
  locationId: number,
  pool?: any
): Promise<string | null> {
  if (!userId) return null;

  let phone: string | null = null;

  // First, try portal_user_applications table (if locationId is provided)
  if (locationId) {
    try {
      const result = await db.select({ phone: portalUserApplications.phone })
        .from(portalUserApplications)
        .where(
          and(
            eq(portalUserApplications.userId, userId),
            eq(portalUserApplications.locationId, locationId)
          )
        )
        .orderBy(desc(portalUserApplications.createdAt))
        .limit(1);

      if (result.length > 0 && result[0].phone) {
        phone = result[0].phone;
        const normalized = validateAndNormalizePhone(phone);
        if (normalized) {
          return normalized;
        }
        console.warn(`⚠️ Portal user application phone is invalid format: ${phone}`);
        phone = null; // Reset if invalid
      }
    } catch (error) {
      console.warn('Could not retrieve portal user phone from portal_user_applications:', error);
    }
  }

  // Fallback: Get phone from applications table (if not found in portal_user_applications)
  if (!phone) {
    try {
      const result = await db.select({ phone: applications.phone })
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(desc(applications.createdAt))
        .limit(1);

      if (result.length > 0 && result[0].phone) {
        phone = result[0].phone;
        const normalized = validateAndNormalizePhone(phone);
        if (normalized) {
          return normalized;
        }
        console.warn(`⚠️ Applications table phone is invalid format: ${phone}`);
      }
    } catch (error) {
      console.warn('Could not retrieve phone from applications table:', error);
    }
  }

  return null;
}

/**
 * Normalizes a phone number before storing in database
 * Always stores in E.164 format for consistency
 */
export function normalizePhoneForStorage(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return validateAndNormalizePhone(phone);
}

