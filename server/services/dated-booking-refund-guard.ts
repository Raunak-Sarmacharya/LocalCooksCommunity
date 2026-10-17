import { sql } from 'drizzle-orm';
import { db } from '../db';

/**
 * CP6: a multi-day booking's refunds are made per day (`dated-booking-cancellation.ts`), each debiting exactly that day's
 * kitchen share. An unscoped refund (a manager's amount, an admin full refund, a raw status change) can't say which day
 * pays for it, so those paths refuse and point to the day-scoped commands.
 */
export const DATED_REFUND_REFUSAL = 'Refunds on a multi-day booking are made per day: cancel or refund that day, or remove its equipment, from the booking; or ask Local Cooks for a goodwill refund.';
const refuse = () => { throw Object.assign(new Error(DATED_REFUND_REFUSAL), { status: 409, statusCode: 409 }); };

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
  if (result.rows.length) refuse();
}
