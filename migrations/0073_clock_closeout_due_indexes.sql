-- Applied to dev Supabase 2026-10-13 (owner approved). Additive performance indexes only.
-- The application uses existing visit_duties JSON and works without these indexes.
CREATE INDEX IF NOT EXISTS kitchen_bookings_clock_due_idx
  ON kitchen_bookings ((visit_duties->'clockCloseout'->>'nextDueAt'), id)
  WHERE status IN ('confirmed', 'completed', 'cancellation_requested');

CREATE INDEX IF NOT EXISTS kitchen_bookings_clock_legacy_idx
  ON kitchen_bookings (booking_date, id)
  WHERE status IN ('confirmed', 'cancellation_requested')
    AND visit_duties->'clockCloseout' IS NULL;
