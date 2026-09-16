/**
 * Default check-in / check-out checklist rows for a location.
 *
 * Managers who never open settings must still have an explicit DB row with
 * every section OFF. Missing rows made left-joins return null, and several
 * chef/booking callers treated `!== false` as enabled.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  checkinCheckoutChecklists,
  type CheckinCheckoutChecklist,
} from "@shared/schema";

/** Schema default: sections are off until a manager explicitly enables them. */
export function isChecklistSectionEnabled(
  value: boolean | null | undefined,
): boolean {
  return value === true;
}

const DEFAULT_CHECKLIST_ROW = {
  checkinEnabled: false,
  checkinItems: [] as unknown[],
  checkinPhotoRequirements: [] as unknown[],
  checkinInstructions: null as string | null,
  checkoutEnabled: false,
  checkoutItems: [] as unknown[],
  checkoutPhotoRequirements: [] as unknown[],
  checkoutInstructions: null as string | null,
  storageCheckoutEnabled: false,
  storageCheckoutItems: [] as unknown[],
  storageCheckoutPhotoRequirements: [] as unknown[],
  storageCheckoutInstructions: null as string | null,
  storageCheckinEnabled: false,
  storageCheckinItems: [] as unknown[],
  storageCheckinPhotoRequirements: [] as unknown[],
  storageCheckinInstructions: null as string | null,
  smartLockCheckinInstructions: null as string | null,
};

/**
 * Ensure a checklist row exists for this location (all toggles off, empty items).
 * Idempotent; safe under concurrent first-touch.
 */
export async function ensureDefaultCheckinCheckoutChecklist(
  locationId: number,
): Promise<CheckinCheckoutChecklist> {
  const [existing] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(checkinCheckoutChecklists)
    .values({
      locationId,
      ...DEFAULT_CHECKLIST_ROW,
    })
    .onConflictDoNothing({ target: checkinCheckoutChecklists.locationId })
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  if (!raced) {
    throw new Error(
      `Failed to ensure checkin_checkout_checklists row for location ${locationId}`,
    );
  }
  return raced;
}
