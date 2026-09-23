// Read-only verification of the kitchen checkout migration against the configured database.
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const objects = await client.query(`SELECT
        to_regclass('public.kitchen_checkout_holds') IS NOT NULL AS checkout_holds,
        to_regclass('public.kitchen_checkout_holds_active_lookup') IS NOT NULL AS hold_lookup_index,
        to_regclass('public.kitchen_bookings_payment_intent_unique') IS NOT NULL AS payment_intent_index,
        to_regclass('public.kitchen_availability_kitchen_day_unique') IS NOT NULL AS weekly_index,
        to_regclass('public.kitchen_date_overrides_kitchen_day_unique') IS NOT NULL AS override_index`);
    const columns = await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kitchen_bookings'
        AND column_name IN ('operating_window_start_time', 'pricing_mode')`);
    const holdColumns = await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kitchen_checkout_holds'`);
    const constraints = await client.query(`SELECT conname FROM pg_constraint
        WHERE conname = 'kitchen_bookings_pricing_mode_check'`);
    const timezones = await client.query(`SELECT timezone, count(*)::integer AS locations FROM locations GROUP BY timezone ORDER BY timezone`);
    const bookingShape = await client.query(`SELECT
      count(*)::integer AS bookings,
      count(*) FILTER (WHERE pricing_mode IS NULL)::integer AS legacy_rate_snapshots,
      count(*) FILTER (WHERE operating_window_start_time IS NULL)::integer AS legacy_window_snapshots,
      count(*) FILTER (WHERE selected_slots IS NULL OR jsonb_typeof(selected_slots) <> 'array')::integer AS invalid_slot_shapes,
      count(*) FILTER (WHERE start_time > end_time)::integer AS overnight_envelopes
      FROM kitchen_bookings`);
    const result = {
      objects: objects.rows[0],
      bookingColumns: columns.rows.map(row => row.column_name).sort(),
      holdColumns: holdColumns.rows.map(row => row.column_name).sort(),
      pricingModeConstraint: constraints.rowCount === 1,
      locationTimezones: timezones.rows,
      bookingShape: bookingShape.rows[0],
    };
    console.log(JSON.stringify(result, null, 2));
    const requiredHoldColumns = ['id', 'kitchen_id', 'chef_id', 'operating_date', 'window_start_time',
      'selected_slots', 'stripe_session_id', 'expires_at', 'created_at'];
    if (Object.values(result.objects).some(value => value !== true)
      || result.bookingColumns.length !== 2 || !result.pricingModeConstraint
      || requiredHoldColumns.some(column => !result.holdColumns.includes(column))) {
      process.exitCode = 1;
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`Read-only schema verification failed: ${error.message}`);
  process.exitCode = 1;
});
