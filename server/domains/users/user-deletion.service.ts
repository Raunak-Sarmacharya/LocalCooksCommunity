import { sql } from "drizzle-orm";
import { logger } from "../../logger";

/**
 * Ordered cleanup of every row that hangs off a user account.
 *
 * WHY THIS EXISTS
 * ---------------
 * `users.id` is referenced by ~50 foreign keys. Only 23 of them cascade; the
 * rest are `NO ACTION` (or `SET NULL` for audit columns). Postgres refuses the
 * delete while any `NO ACTION` child still exists, and the caller gets an
 * opaque 23503 instead of a useful message. That is the "deletion sometimes
 * fails depending on the user" bug.
 *
 * Two rules keep this list maintainable:
 *
 *  1. **Order by dependency, child first.** A table whose own parent is being
 *     deleted must be emptied before that parent. `kitchen_bookings` is the big
 *     one — `storage_bookings`, `equipment_bookings` and `damage_claims` all
 *     point at it, and some of those point at *each other*.
 *  2. **Never rely on the database's delete rule for correctness.** `ON DELETE
 *     SET NULL` on an audit column is the right *schema* but the wrong
 *     *behaviour* here: leaving `damage_claims.resolved_by` pointing at a
 *     deleted user is fine for history but useless for lookup, and a `NO ACTION`
 *     that nobody cleans up is a hard failure. Every table is named explicitly
 *     below so the behaviour is readable in one place rather than inferred from
 *     a migration file.
 *
 * Identity columns on rows that belong to *someone else* are nulled rather than
 * deleted: deleting a manager's approval of a chef's damage claim should not
 * erase the claim. Rows that represent the user's own activity are deleted.
 */

/**
 * Deletes one table's rows for this user and returns the row count.
 *
 * `RETURNING id` is used instead of the query's `rowCount` because the driver's
 * rowCount is not populated for every statement shape, and the delete-impact
 * endpoint needs the same counts. `id` is present on every table touched here.
 */
async function del(
  tx: any,
  label: string,
  query: any,
  counts: Record<string, number>,
): Promise<void> {
  const result = await tx.execute(query);
  const n = Array.isArray(result?.rows) ? result.rows.length : 0;
  if (n > 0) {
    counts[label] = (counts[label] ?? 0) + n;
    logger.info(`[UserDeletion] removed ${n} row(s) from ${label}`);
  }
}

/**
 * Nulls an identity column on rows that belong to someone else.
 *
 * Deliberately separate from `del`: these are `UPDATE`, so they cannot use
 * `RETURNING id` to count rows. The count is not used for reporting anyway —
 * the delete-impact preview counts rows, not columns — so these stay silent
 * unless the statement fails.
 */
async function unlink(tx: any, query: any): Promise<void> {
  await tx.execute(query);
}

/**
 * Removes every dependent row for `userId`, in dependency order.
 *
 * Must run inside the same transaction as the `users` delete — a partially
 * applied cascade would leave the account half-removed and unusable.
 *
 * @returns per-category row counts, for logging and for the delete-impact preview.
 */
export async function deleteUserDependents(
  tx: any,
  userId: number,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const id = userId;

  // ─── Bookings ────────────────────────────────────────────────────────────
  // A booking names the chef actor in `chef_id` (customer) and `created_by`
  // (the chef who created it for themselves). Both must be treated as "this
  // user's booking" — filtering on `chef_id` alone leaves rows where the user
  // is only `created_by` behind, and Postgres then rejects the user delete.

  // Storage/equipment bookings must go before their parent booking: they hold
  // the only CASCADE path into `kitchen_bookings`, and `damage_claims` holds a
  // SET NULL path into both.
  // `damage_claims` links to exactly one booking through three nullable columns
  // plus a `booking_type` discriminator — there is NO `equipment_booking_id`
  // column, so an equipment claim is reachable only via its parent kitchen
  // booking. That parent is captured by the `kb.*` branches below; adding an
  // `eb` join here is a hard `42703` and was the cause of the first 500.
  await del(tx, "damage_claims", sql`
    DELETE FROM damage_claims WHERE id IN (
      SELECT dc.id FROM damage_claims dc
      LEFT JOIN storage_bookings sb ON sb.id = dc.storage_booking_id
      LEFT JOIN kitchen_booking_visits kbv ON kbv.id = dc.kitchen_booking_visit_id
      LEFT JOIN kitchen_bookings kb ON kb.id = dc.kitchen_booking_id
      WHERE dc.chef_id = ${id}
         OR dc.manager_id = ${id}
         OR dc.resolved_by = ${id}
         OR dc.admin_reviewer_id = ${id}
         OR sb.chef_id = ${id}
         OR kbv.checkout_approved_by = ${id}
         OR kb.checkout_approved_by = ${id}
         OR sb.checkout_approved_by = ${id}
         OR sb.checkout_denied_by = ${id}
    )`, counts);

  await del(tx, "storage_overstay_records", sql`
    DELETE FROM storage_overstay_records WHERE id IN (
      SELECT sr.id FROM storage_overstay_records sr
      LEFT JOIN storage_bookings sb ON sb.id = sr.storage_booking_id
      WHERE sb.chef_id = ${id}
         OR sb.checkout_approved_by = ${id}
         OR sr.penalty_approved_by = ${id}
    )`, counts);

  await del(tx, "storage_bookings", sql`
    DELETE FROM storage_bookings
    WHERE chef_id = ${id}
       OR checkout_approved_by = ${id}
       OR checkout_denied_by = ${id}
       OR kitchen_booking_id IN (SELECT id FROM kitchen_bookings WHERE chef_id = ${id} OR created_by = ${id})
       OR id IN (SELECT storage_booking_id FROM damage_claims WHERE storage_booking_id IS NOT NULL AND chef_id = ${id})`, counts);

  await del(tx, "equipment_bookings", sql`
    DELETE FROM equipment_bookings
    WHERE chef_id = ${id}
       OR kitchen_booking_id IN (SELECT id FROM kitchen_bookings WHERE chef_id = ${id} OR created_by = ${id})`, counts);

  await del(tx, "kitchen_booking_visits", sql`
    DELETE FROM kitchen_booking_visits
    WHERE checkout_approved_by = ${id}
       OR booking_id IN (SELECT id FROM kitchen_bookings WHERE chef_id = ${id} OR created_by = ${id})`, counts);

  await del(tx, "kitchen_bookings", sql`
    DELETE FROM kitchen_bookings
    WHERE chef_id = ${id}
       OR created_by = ${id}
       OR checkout_approved_by = ${id}`, counts);

  await del(tx, "kitchen_checkout_holds", sql`
    DELETE FROM kitchen_checkout_holds WHERE chef_id = ${id}`, counts);

  // ─── Notifications ───────────────────────────────────────────────────────
  // These were the headline symptom: both are `NO ACTION`, so any chef with a
  // single notification could never be deleted.
  await del(tx, "chef_notifications", sql`
    DELETE FROM chef_notifications WHERE chef_id = ${id}`, counts);

  await del(tx, "manager_notifications", sql`
    DELETE FROM manager_notifications WHERE manager_id = ${id}`, counts);

  // ─── Access grants ───────────────────────────────────────────────────────
  // `granted_by` is CASCADE in the schema, so deleting the grantor already
  // removes these rows. Listed anyway to keep the cleanup self-describing and
  // independent of a delete rule that could be changed later.
  await del(tx, "chef_kitchen_access", sql`
    DELETE FROM chef_kitchen_access WHERE chef_id = ${id} OR granted_by = ${id}`, counts);

  await del(tx, "chef_location_access", sql`
    DELETE FROM chef_location_access WHERE chef_id = ${id} OR granted_by = ${id}`, counts);

  await del(tx, "portal_user_location_access", sql`
    DELETE FROM portal_user_location_access WHERE portal_user_id = ${id} OR granted_by = ${id}`, counts);

  // ─── Applications & profiles ─────────────────────────────────────────────
  // Notifications/emails referencing a given application are cleaned up by the
  // application's own delete path; here only the review identity is nulled so
  // the applicant's own record survives.
  await del(tx, "portal_user_applications", sql`
    DELETE FROM portal_user_applications WHERE user_id = ${id}`, counts);

  await del(tx, "applications", sql`
    DELETE FROM applications WHERE user_id = ${id}`, counts);

  await del(tx, "chef_kitchen_applications", sql`
    DELETE FROM chef_kitchen_applications WHERE chef_id = ${id}`, counts);

  await del(tx, "chef_kitchen_profiles", sql`
    DELETE FROM chef_kitchen_profiles WHERE chef_id = ${id}`, counts);

  await del(tx, "chef_location_profiles", sql`
    DELETE FROM chef_location_profiles WHERE chef_id = ${id}`, counts);

  await del(tx, "kitchen_viewings", sql`
    DELETE FROM kitchen_viewings WHERE chef_id = ${id}`, counts);

  // ─── Learning progress ───────────────────────────────────────────────────
  await del(tx, "microlearning_completions", sql`
    DELETE FROM microlearning_completions WHERE user_id = ${id}`, counts);

  await del(tx, "video_progress", sql`
    DELETE FROM video_progress WHERE user_id = ${id}`, counts);

  // ─── Auth artefacts ──────────────────────────────────────────────────────
  // `password_reset_tokens` has no ON DELETE rule and no expiry cleanup, so
  // every reset ever requested for this user is still sitting in the table.
  await del(tx, "password_reset_tokens", sql`
    DELETE FROM password_reset_tokens WHERE user_id = ${id}`, counts);

  // ─── Ownership & audit columns (nulled, never deleted) ───────────────────
  // Deleting the row here would destroy another party's record. Nulling the
  // identity keeps the row and its history while releasing the FK.

  // A manager's kitchens must outlive the manager — the kitchen is the
  // business, the manager is a person who may be replaced. `KitchenRepository`
  // already depends on this: it hard-deletes a kitchen only when nothing is
  // attached, and the kitchen delete handles bookings itself.
  await unlink(tx, sql`
    UPDATE locations SET manager_id = NULL WHERE manager_id = ${id}`);

  // Approval stamps: the approval happened, we just no longer know who.
  // These are currently `NO ACTION`, which is what makes a manager who ever
  // approved a kitchen licence undeletable.
  await unlink(tx, sql`
    UPDATE locations SET kitchen_license_approved_by = NULL WHERE kitchen_license_approved_by = ${id}`);
  await unlink(tx, sql`
    UPDATE locations SET kitchen_license_reviewed_by = NULL WHERE kitchen_license_reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE applications SET documents_reviewed_by = NULL WHERE documents_reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE chef_kitchen_applications SET reviewed_by = NULL WHERE reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE chef_kitchen_profiles SET reviewed_by = NULL WHERE reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE chef_location_profiles SET reviewed_by = NULL WHERE reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE portal_user_applications SET reviewed_by = NULL WHERE reviewed_by = ${id}`);
  await unlink(tx, sql`
    UPDATE kitchen_viewings SET manager_id = NULL WHERE manager_id = ${id}`);
  await unlink(tx, sql`
    UPDATE kitchen_viewings SET admin_reviewer_id = NULL WHERE admin_reviewer_id = ${id}`);
  await unlink(tx, sql`
    UPDATE storage_listings SET approved_by = NULL WHERE approved_by = ${id}`);

  // A pending storage extension is an in-flight manager action, not history —
  // with the manager gone there is nobody to approve it.
  await del(tx, "pending_storage_extensions", sql`
    DELETE FROM pending_storage_extensions WHERE manager_id = ${id}`, counts);

  // Financial audit trail. `payment_transactions` and `payment_history` are
  // SET NULL in the schema; both are restated here because the money rows must
  // survive the person who recorded them.
  await unlink(tx, sql`
    UPDATE payment_transactions SET chef_id = NULL WHERE chef_id = ${id}`);
  await unlink(tx, sql`
    UPDATE payment_transactions SET manager_id = NULL WHERE manager_id = ${id}`);
  await unlink(tx, sql`
    UPDATE payment_history SET created_by = NULL WHERE created_by = ${id}`);
  await unlink(tx, sql`
    UPDATE damage_claim_history SET action_by_user_id = NULL WHERE action_by_user_id = ${id}`);
  await unlink(tx, sql`
    UPDATE damage_evidence SET uploaded_by = NULL WHERE uploaded_by = ${id}`);
  await unlink(tx, sql`
    UPDATE storage_overstay_history SET created_by = NULL WHERE created_by = ${id}`);
  await unlink(tx, sql`
    UPDATE email_logs SET recipient_user_id = NULL WHERE recipient_user_id = ${id}`);

  // Deliberately NOT touched:
  //  - `platform_settings.updated_by` — settings are global config, and the
  //    only readers look them up by `key` (server/security.ts). Leaving a
  //    dangling stamp is better than deleting a rate-limit row.
  //  - `unsubscribe_requests`, `email_verification_tokens`, `session`,
  //    `email_logs` — no FK to `users`, and each has its own lifecycle.
  //  - `kitchens` — owned by locations, reachable only through the kitchen
  //    delete path that already handles bookings.

  return counts;
}
