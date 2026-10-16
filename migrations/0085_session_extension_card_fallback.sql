ALTER TABLE kitchen_booking_extensions
  ADD COLUMN checkout_session_id text UNIQUE,
  ADD COLUMN card_failed_at timestamptz,
  ADD COLUMN refunded_at timestamptz,
  ADD COLUMN refund_id text;
