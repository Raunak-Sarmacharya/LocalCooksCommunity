import { sql } from 'drizzle-orm';
import { db } from '../db';

type Connection = Pick<typeof db, 'execute'>;
export class BookingMoneyFrozen extends Error {
  constructor() { super('Payments for this booking are paused while Local Cooks reviews a support flag or an earlier payment update. Review and resolve it before sending a refund or kitchen payment.'); }
}
/**
 * Includes separate linked add-on charges and standalone storage rentals. Missing flag storage fails closed.
 * `payout`: a kitchen transfer. A storage chargeback never holds it (Local Cooks absorbs chargebacks in the pilot).
 */
export async function assertBookingMoneyWritable(target: {
  bookingId?: number; storageRentalId?: number; paymentIntentId?: string; paymentTransactionId?: number; transferId?: string; operationKey?: string; payout?: boolean;
}, connection: Connection = db) {
  const result = await connection.execute(sql`
    WITH linked_sources AS (
      SELECT p.booking_type, p.booking_id FROM payment_transactions p
        WHERE p.payment_intent_id = ${target.paymentIntentId ?? null}
          OR p.id = ${target.paymentTransactionId ?? null} OR p.transfer_id = ${target.transferId ?? null}
    ), linked_bookings AS (
      SELECT ${target.bookingId ?? null}::integer AS booking_id UNION
        SELECT CASE WHEN l.booking_type IN ('kitchen','bundle') THEN l.booking_id
          WHEN l.booking_type = 'equipment' THEN e.kitchen_booking_id END
        FROM linked_sources l
        LEFT JOIN equipment_bookings e ON l.booking_type = 'equipment' AND e.id = l.booking_id
    ), linked_storage AS (
      SELECT ${target.storageRentalId ?? null}::integer AS storage_booking_id UNION
        SELECT booking_id FROM linked_sources WHERE booking_type = 'storage'
    )
    SELECT f.id FROM booking_flags f WHERE f.resolved_at IS NULL AND f.booking_id IN (SELECT booking_id FROM linked_bookings)
    UNION ALL SELECT f.id FROM booking_flags f WHERE f.resolved_at IS NULL AND f.storage_booking_id IN (SELECT storage_booking_id FROM linked_storage)
      AND NOT (${target.payout === true} AND f.kind = 'chargeback')
    UNION ALL SELECT a.id FROM support_actions a WHERE (a.booking_id IN (SELECT booking_id FROM linked_bookings)
        OR a.storage_booking_id IN (SELECT storage_booking_id FROM linked_storage))
      AND a.status IN ('executing','recovery_required') AND a.action_type IN ('goodwill_refund','cancel_kitchen_caused','refund_captured_request','accept_cancellation_for_manager','claim_compensate','claim_withdraw','retry_refund','mark_refunded')
      AND (a.action_type NOT IN ('retry_refund','mark_refunded') OR a.status = 'executing')
      AND a.operation_key <> COALESCE(${target.operationKey ?? null}, '')
    UNION ALL SELECT c.booking_id FROM kitchen_booking_changes c
      WHERE c.booking_id IN (SELECT booking_id FROM linked_bookings)
      AND c.policy->'operation'->>'state' = 'pending'
      AND c.policy->'operation'->>'action' IN ('capture', 'refund', 'compensate')
      AND COALESCE(${target.operationKey ?? null}, '') NOT LIKE (c.policy->'operation'->>'key') || '%'
    UNION ALL SELECT p.id FROM payment_transactions p WHERE p.booking_id IN (SELECT booking_id FROM linked_bookings)
      AND p.booking_type IN ('kitchen', 'bundle') AND p.metadata->'changeTransferOperation'->>'state' = 'pending'
      AND p.metadata->'changeTransferOperation'->>'key' <> COALESCE(${target.operationKey ?? null}, '') LIMIT 1`);
  if (result.rows.length) throw new BookingMoneyFrozen();
}
