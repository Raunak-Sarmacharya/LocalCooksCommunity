import { sql, type SQL } from "drizzle-orm";
import { logger } from "../../logger";

/** The same ownership predicates drive cleanup and the admin's impact preview. */
export function userDeletionTargets(id: number): Array<{ table: string; where: SQL }> {
  const locationIds = sql`SELECT id FROM locations WHERE manager_id = ${id}`;
  const kitchenIds = sql`SELECT id FROM kitchens WHERE location_id IN (${locationIds})`;
  const bookingIds = sql`SELECT id FROM kitchen_bookings WHERE chef_id = ${id} OR created_by = ${id} OR kitchen_id IN (${kitchenIds})`;
  const storageIds = sql`SELECT id FROM storage_bookings WHERE chef_id = ${id} OR kitchen_booking_id IN (${bookingIds}) OR storage_listing_id IN (SELECT id FROM storage_listings WHERE kitchen_id IN (${kitchenIds}))`;
  const equipmentIds = sql`SELECT id FROM equipment_bookings WHERE chef_id = ${id} OR kitchen_booking_id IN (${bookingIds}) OR equipment_listing_id IN (SELECT id FROM equipment_listings WHERE kitchen_id IN (${kitchenIds}))`;
  const viewingIds = sql`SELECT id FROM kitchen_viewings WHERE chef_id = ${id} OR location_id IN (${locationIds})`;
  const emails = sql`SELECT lower(username) FROM users WHERE id = ${id} UNION SELECT lower(pending_email) FROM users WHERE id = ${id} AND pending_email IS NOT NULL`;
  const relatedNotification = sql`metadata->>'locationId' IN (SELECT id::text FROM locations WHERE id IN (${locationIds}))
    OR metadata->>'kitchenId' IN (SELECT id::text FROM kitchens WHERE id IN (${kitchenIds}))
    OR metadata->>'bookingId' IN (SELECT id::text FROM kitchen_bookings WHERE id IN (${bookingIds}))
    OR metadata->>'storageBookingId' IN (SELECT id::text FROM storage_bookings WHERE id IN (${storageIds}))
    OR metadata->>'equipmentBookingId' IN (SELECT id::text FROM equipment_bookings WHERE id IN (${equipmentIds}))
    OR metadata->>'viewingId' IN (SELECT id::text FROM kitchen_viewings WHERE id IN (${viewingIds}))
    OR metadata->>'applicationId' IN (SELECT id::text FROM chef_kitchen_applications WHERE chef_id = ${id} OR location_id IN (${locationIds}))`;
  return [
    // Notifications contain JSON IDs, so remove them before those parents vanish.
    { table: "chef_notifications", where: sql`chef_id = ${id} OR (${relatedNotification})` },
    { table: "manager_notifications", where: sql`manager_id = ${id} OR location_id IN (${locationIds}) OR (${relatedNotification})` },
    { table: "email_logs", where: sql`recipient_user_id = ${id} OR lower(recipient_email) IN (${emails})
      OR (split_part(tracking_id, ':', 1) = 'advance' AND (
        (split_part(tracking_id, ':', 2) = 'booking' AND split_part(tracking_id, ':', 3) IN (SELECT id::text FROM kitchen_bookings WHERE id IN (${bookingIds})))
        OR (split_part(tracking_id, ':', 2) = 'tour' AND split_part(tracking_id, ':', 3) IN (SELECT id::text FROM kitchen_viewings WHERE id IN (${viewingIds})))
      ))` },
    // New lifecycle tables must go before the bookings/tours they reference.
    { table: "commitment_problems", where: sql`reported_by = ${id} OR booking_id IN (${bookingIds}) OR viewing_id IN (${viewingIds}) OR kitchen_id IN (${kitchenIds})` },
    { table: "kitchen_booking_attendance_events", where: sql`actor_id = ${id} OR booking_id IN (${bookingIds}) OR visit_id IN (SELECT id FROM kitchen_booking_visits WHERE booking_id IN (${bookingIds}))` },
    { table: "booking_lifecycle_events", where: sql`actor_id = ${id} OR booking_id IN (${bookingIds})` },
    { table: "kitchen_booking_changes", where: sql`manager_id = ${id} OR booking_id IN (${bookingIds})` },
    { table: "storage_overstay_quotes", where: sql`chef_id = ${id} OR storage_listing_id IN (SELECT id FROM storage_listings WHERE kitchen_id IN (${kitchenIds}))` },
    { table: "tour_feedback_responses", where: sql`respondent_id = ${id} OR viewing_id IN (${viewingIds})` },
    { table: "tour_repeat_authorizations", where: sql`granted_by = ${id} OR revoked_by = ${id} OR source_tour_id IN (${viewingIds}) OR used_by_tour_id IN (${viewingIds})` },
    { table: "damage_claims", where: sql`chef_id = ${id} OR manager_id = ${id} OR location_id IN (${locationIds}) OR kitchen_booking_id IN (${bookingIds}) OR storage_booking_id IN (${storageIds}) OR kitchen_booking_visit_id IN (SELECT id FROM kitchen_booking_visits WHERE booking_id IN (${bookingIds}))` },
    { table: "storage_overstay_records", where: sql`storage_booking_id IN (${storageIds})` },
    // booking_id on the payment ledger is polymorphic, not a foreign key.
    { table: "payment_transactions", where: sql`chef_id = ${id} OR manager_id = ${id} OR (booking_type IN ('kitchen', 'bundle') AND booking_id IN (${bookingIds})) OR (booking_type = 'storage' AND booking_id IN (${storageIds})) OR (booking_type = 'equipment' AND booking_id IN (${equipmentIds}))` },
    { table: "pending_storage_extensions", where: sql`manager_id = ${id} OR storage_booking_id IN (${storageIds})` },
    { table: "storage_bookings", where: sql`id IN (${storageIds})` },
    { table: "equipment_bookings", where: sql`id IN (${equipmentIds})` },
    { table: "kitchen_booking_visits", where: sql`booking_id IN (${bookingIds})` },
    { table: "kitchen_bookings", where: sql`id IN (${bookingIds})` },
    { table: "kitchen_checkout_holds", where: sql`chef_id = ${id} OR kitchen_id IN (${kitchenIds})` },
    { table: "chef_kitchen_access", where: sql`chef_id = ${id} OR granted_by = ${id} OR kitchen_id IN (${kitchenIds})` },
    { table: "chef_location_access", where: sql`chef_id = ${id} OR granted_by = ${id} OR location_id IN (${locationIds})` },
    { table: "portal_user_location_access", where: sql`portal_user_id = ${id} OR granted_by = ${id} OR location_id IN (${locationIds})` },
    { table: "portal_user_applications", where: sql`user_id = ${id} OR location_id IN (${locationIds})` },
    { table: "applications", where: sql`user_id = ${id}` },
    { table: "chef_kitchen_applications", where: sql`chef_id = ${id} OR location_id IN (${locationIds})` },
    { table: "chef_kitchen_profiles", where: sql`chef_id = ${id} OR kitchen_id IN (${kitchenIds})` },
    { table: "chef_location_profiles", where: sql`chef_id = ${id} OR location_id IN (${locationIds})` },
    { table: "kitchen_viewings", where: sql`id IN (${viewingIds})` },
    { table: "microlearning_completions", where: sql`user_id = ${id}` },
    { table: "video_progress", where: sql`user_id = ${id}` },
    { table: "password_reset_tokens", where: sql`user_id = ${id}` },
    { table: "email_verification_tokens", where: sql`lower(email) IN (${emails})` },
    { table: "unsubscribe_requests", where: sql`lower(email) IN (${emails})` },
    { table: "session", where: sql`sess->>'userId' = ${String(id)} OR sess->>'neonUserId' = ${String(id)} OR sess->'passport'->>'user' = ${String(id)} OR sess->>'firebaseUid' IN (SELECT firebase_uid FROM users WHERE id = ${id} AND firebase_uid IS NOT NULL)` },
    { table: "storage_listings", where: sql`kitchen_id IN (${kitchenIds})` },
    { table: "equipment_listings", where: sql`kitchen_id IN (${kitchenIds})` },
    { table: "kitchens", where: sql`id IN (${kitchenIds})` },
    { table: "locations", where: sql`id IN (${locationIds})` },
  ];
}

export async function getUserDeletionImpact(tx: any, id: number): Promise<Record<string, number>> {
  const columns = userDeletionTargets(id).map(({ table, where }) =>
    sql`(SELECT COUNT(*) FROM ${sql.identifier(table)} WHERE ${where})::int AS ${sql.identifier(table)}`);
  const result = await tx.execute(sql`SELECT ${sql.join(columns, sql`, `)}`);
  return result.rows[0];
}

/** Run inside the user's deletion transaction. Migration 0071 is required. */
export async function deleteUserDependents(tx: any, id: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  // Audit triggers allow only this account's purge/anonymization, for this transaction.
  await tx.execute(sql`SELECT set_config('localcooks.deleting_user_id', ${String(id)}, true)`);
  await tx.execute(sql`UPDATE tour_visit_events SET actor_id = NULL WHERE actor_id = ${id}`);
  for (const { table, where } of userDeletionTargets(id)) {
    const result = await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${where} RETURNING 1`);
    if (result.rows.length) counts[table] = result.rows.length;
  }

  // Review/approval of somebody else's record is not ownership of that record.
  const auditColumns = [
    ["locations", "kitchen_license_approved_by"], ["locations", "kitchen_license_reviewed_by"],
    ["applications", "documents_reviewed_by"], ["chef_kitchen_applications", "reviewed_by"],
    ["chef_kitchen_profiles", "reviewed_by"], ["chef_location_profiles", "reviewed_by"],
    ["portal_user_applications", "reviewed_by"], ["kitchen_viewings", "manager_id"],
    ["kitchen_viewings", "admin_reviewer_id"], ["kitchen_viewings", "outcome_recorded_by"],
    ["storage_listings", "approved_by"], ["storage_bookings", "checkout_approved_by"],
    ["storage_bookings", "checkout_denied_by"], ["kitchen_bookings", "checkout_approved_by"],
    ["kitchen_booking_visits", "checkout_approved_by"], ["damage_claims", "resolved_by"],
    ["damage_claims", "admin_reviewer_id"], ["damage_claim_history", "action_by_user_id"],
    ["damage_evidence", "uploaded_by"], ["storage_overstay_history", "created_by"],
    ["storage_overstay_records", "penalty_approved_by"], ["storage_overstay_records", "dispute_reviewed_by"],
    ["payment_history", "created_by"], ["commitment_problems", "claimed_by"], ["platform_settings", "updated_by"],
  ];
  for (const [table, column] of auditColumns) {
    await tx.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = NULL WHERE ${sql.identifier(column)} = ${id}`);
  }
  logger.info(`Removed dependents for user ${id}`, counts);
  return counts;
}
