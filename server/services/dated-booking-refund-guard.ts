import { sql } from 'drizzle-orm';
import { db } from '../db';

export const DATED_REFUND_REFUSAL = 'Dated booking cancellations and refunds are unavailable until whole-booking deadlines are supported. Contact Local Cooks support for manual review through the existing incident tools.';
export function assertLegacyCancellation(booking: { scheduleRevision?: number | null }, sources: Array<{ payoutPartition?: string | null }>) {
  // shortcut: CP6 must apply the first-day deadline before dated cancellations/refunds can use this engine.
  if ((booking.scheduleRevision ?? 0) > 0 || sources.some(source => source.payoutPartition === 'per_day'))
    throw Object.assign(new Error(DATED_REFUND_REFUSAL), { status: 409, statusCode: 409 });
}

/** Covers direct refunds as well as separately charged items linked to a dated parent. */
export async function assertLegacyBookingRefund(target: { bookingId?: number; paymentIntentId?: string; paymentTransactionId?: number }, connection: Pick<typeof db, 'execute'> = db) {
  const result = await connection.execute(sql`
    WITH sources AS (
      SELECT p.*, CASE WHEN p.booking_type IN ('kitchen', 'bundle') THEN p.booking_id
        WHEN p.booking_type = 'equipment' THEN e.kitchen_booking_id
        WHEN p.booking_type = 'storage' THEN s.kitchen_booking_id END AS parent_id
      FROM payment_transactions p
      LEFT JOIN equipment_bookings e ON p.booking_type = 'equipment' AND e.id = p.booking_id
      LEFT JOIN storage_bookings s ON p.booking_type = 'storage' AND s.id = p.booking_id
      WHERE p.payment_intent_id = ${target.paymentIntentId ?? null} OR p.id = ${target.paymentTransactionId ?? null}
    ), parents AS (
      SELECT ${target.bookingId ?? null}::integer AS id UNION
      SELECT parent_id FROM sources WHERE payment_intent_id = ${target.paymentIntentId ?? null} OR id = ${target.paymentTransactionId ?? null}
    )
    SELECT id FROM kitchen_bookings WHERE id IN (SELECT id FROM parents) AND schedule_revision > 0
    UNION ALL SELECT p.id FROM payment_transactions p WHERE p.payout_partition = 'per_day' AND
      (p.id IN (SELECT id FROM sources)
        OR p.booking_type IN ('kitchen', 'bundle') AND p.booking_id IN (SELECT id FROM parents)
        OR p.booking_type = 'equipment' AND p.booking_id IN (SELECT id FROM equipment_bookings WHERE kitchen_booking_id IN (SELECT id FROM parents))
        OR p.booking_type = 'storage' AND p.booking_id IN (SELECT id FROM storage_bookings WHERE kitchen_booking_id IN (SELECT id FROM parents))) LIMIT 1`);
  if (result.rows.length) assertLegacyCancellation({ scheduleRevision: 1 }, []);
}
