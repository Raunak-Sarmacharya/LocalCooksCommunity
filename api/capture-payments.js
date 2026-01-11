/**
 * Vercel Cron Job: Capture Pre-Authorized Payments
 * 
 * This endpoint is called hourly by Vercel Cron to capture payments for bookings
 * after the cancellation period has expired.
 * 
 * Flow:
 * 1. Find bookings with payment_intent_id in 'requires_capture' status
 * 2. Check if cancellation period has expired (booking_date - cancellation_policy_hours)
 * 3. If expired, capture the payment intent
 * 4. Update booking payment_status to 'paid'
 * 
 * Schedule: Hourly (configure in vercel.json)
 */

const { pool } = require('./server/db');
const Stripe = require('stripe');

module.exports = async (req, res) => {
  // Verify this is a cron request (Vercel adds Authorization header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
    });

    const { capturePaymentIntent } = await import('../server/services/stripe-service.ts');

    // Find bookings with payment intents that need to be captured
    // Only capture if:
    // 1. Payment intent is in 'requires_capture' status (authorization hold placed)
    // 2. Booking is not cancelled
    // 3. Cancellation period has expired (booking_date - cancellation_policy_hours < NOW())
    const bookingsToCapture = await pool.query(`
      SELECT 
        kb.id as booking_id,
        kb.payment_intent_id,
        kb.booking_date,
        kb.start_time,
        kb.status,
        kb.payment_status,
        l.cancellation_policy_hours,
        kb.total_price
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE kb.payment_intent_id IS NOT NULL
        AND kb.status != 'cancelled'
        AND kb.payment_status = 'pending'
        AND l.cancellation_policy_hours IS NOT NULL
        AND (
          -- Cancellation period has expired
          (kb.booking_date::date || ' ' || kb.start_time)::timestamp 
          - (l.cancellation_policy_hours || 24 || ' hours')::interval 
          <= NOW()
        )
    `);

    console.log(`[Capture Payments] Found ${bookingsToCapture.rows.length} bookings ready to capture`);

    const results = {
      processed: 0,
      captured: 0,
      failed: 0,
      errors: []
    };

    for (const booking of bookingsToCapture.rows) {
      try {
        // Verify payment intent is still in requires_capture status
        const { getPaymentIntent } = await import('../server/services/stripe-service.ts');
        const paymentIntent = await getPaymentIntent(booking.payment_intent_id);

        if (!paymentIntent) {
          console.warn(`[Capture Payments] Payment intent ${booking.payment_intent_id} not found for booking ${booking.booking_id}`);
          results.errors.push({
            bookingId: booking.booking_id,
            paymentIntentId: booking.payment_intent_id,
            error: 'Payment intent not found'
          });
          results.failed++;
          continue;
        }

        if (paymentIntent.status !== 'requires_capture') {
          console.log(`[Capture Payments] Payment intent ${booking.payment_intent_id} is not in requires_capture status (${paymentIntent.status}), skipping`);
          results.processed++;
          continue;
        }

        // Capture the payment
        const captured = await capturePaymentIntent(booking.payment_intent_id);

        // Retrieve the full payment intent to get charge ID after capture
        const stripePaymentIntent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
        const chargeId = typeof stripePaymentIntent.latest_charge === 'string' 
          ? stripePaymentIntent.latest_charge 
          : stripePaymentIntent.latest_charge?.id;

        // Update booking payment status
        await pool.query(`
          UPDATE kitchen_bookings
          SET 
            payment_status = 'paid',
            updated_at = NOW()
          WHERE id = $1
        `, [booking.booking_id]);

        // Update payment_transactions if exists
        // This is critical for managers to see revenue in their dashboards
        const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('../server/services/payment-transactions-service.ts');
        const transaction = await findPaymentTransactionByIntentId(booking.payment_intent_id, pool);
        if (transaction) {
          await updatePaymentTransaction(transaction.id, {
            status: 'succeeded',
            stripeStatus: 'succeeded',
            chargeId: chargeId || undefined,
            paidAt: new Date(),
            lastSyncedAt: new Date(),
          }, pool);
          console.log(`[Capture Payments] Updated payment_transaction ${transaction.id} with chargeId: ${chargeId}`);
        } else {
          console.warn(`[Capture Payments] No payment_transaction found for PaymentIntent ${booking.payment_intent_id} - transaction may not have been created during booking`);
        }

        console.log(`[Capture Payments] Successfully captured payment for booking ${booking.booking_id} (PaymentIntent: ${booking.payment_intent_id})`);
        results.captured++;
        results.processed++;
      } catch (error) {
        console.error(`[Capture Payments] Error capturing payment for booking ${booking.booking_id}:`, error);
        results.errors.push({
          bookingId: booking.booking_id,
          paymentIntentId: booking.payment_intent_id,
          error: error.message
        });
        results.failed++;
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.processed} bookings: ${results.captured} captured, ${results.failed} failed`,
      results
    });
  } catch (error) {
    console.error('[Capture Payments] Fatal error:', error);
    res.status(500).json({ 
      error: 'Failed to process payment captures',
      message: error.message 
    });
  }
};
