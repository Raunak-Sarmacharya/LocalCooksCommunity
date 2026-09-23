CREATE TABLE IF NOT EXISTS kitchen_booking_visits (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id) ON DELETE CASCADE,
  block_index integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  checkin_status kitchen_checkin_status NOT NULL DEFAULT 'not_checked_in',
  checked_in_at timestamp,
  checked_in_method text,
  checkin_photo_urls jsonb DEFAULT '[]'::jsonb,
  checkin_notes text,
  checkin_checklist_items jsonb,
  checkout_requested_at timestamp,
  checked_out_at timestamp,
  checkout_photo_urls jsonb DEFAULT '[]'::jsonb,
  checkout_notes text,
  checkout_checklist_items jsonb,
  checkout_approved_at timestamp,
  checkout_approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  no_show_detected_at timestamp,
  actual_start_time text,
  actual_end_time text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_booking_visits_block_nonnegative CHECK (block_index >= 0),
  CONSTRAINT kitchen_booking_visits_booking_block_unique UNIQUE (booking_id, block_index)
);

CREATE INDEX IF NOT EXISTS kitchen_booking_visits_review_lookup
  ON kitchen_booking_visits (checkin_status, checkout_requested_at);

ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS kitchen_booking_visit_id integer
  REFERENCES kitchen_booking_visits(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS damage_claims_kitchen_visit_unique
  ON damage_claims (kitchen_booking_visit_id) WHERE kitchen_booking_visit_id IS NOT NULL;

-- Every booking writer (Checkout webhook, fallback, portal, free booking) uses
-- the same source of truth. Contiguous slots remain on the legacy lifecycle.
CREATE OR REPLACE FUNCTION create_kitchen_booking_visits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  slot record;
  block_start text;
  block_end text;
  block_number integer := 0;
BEGIN
  -- Older clients may send string slots. Normalize and sort around the
  -- operating-day start so the after-midnight tail stays last.
  FOR slot IN
    SELECT start_time, end_time FROM (
      SELECT CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
                  ELSE value->>'startTime' END AS start_time,
             CASE WHEN jsonb_typeof(value) = 'string'
                    THEN to_char(((value #>> '{}')::time + interval '1 hour'), 'HH24:MI')
                  ELSE value->>'endTime' END AS end_time
      FROM jsonb_array_elements(COALESCE(NEW.selected_slots, '[]'::jsonb))
    ) normalized
    WHERE start_time ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND end_time ~ '^[0-2][0-9]:[0-5][0-9]$'
    ORDER BY ((extract(epoch FROM (start_time::time - COALESCE(NEW.operating_window_start_time, NEW.start_time)::time))::int + 86400) % 86400)
  LOOP
    IF block_start IS NULL THEN
      block_start := slot.start_time;
      block_end := slot.end_time;
    ELSIF block_end = slot.start_time THEN
      block_end := slot.end_time;
    ELSE
      INSERT INTO kitchen_booking_visits (booking_id, block_index, start_time, end_time)
        VALUES (NEW.id, block_number, block_start, block_end)
        ON CONFLICT (booking_id, block_index) DO NOTHING;
      block_number := block_number + 1;
      block_start := slot.start_time;
      block_end := slot.end_time;
    END IF;
  END LOOP;
  IF block_number > 0 THEN
    INSERT INTO kitchen_booking_visits (booking_id, block_index, start_time, end_time)
      VALUES (NEW.id, block_number, block_start, block_end)
      ON CONFLICT (booking_id, block_index) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kitchen_booking_visits_on_insert ON kitchen_bookings;
CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings
  FOR EACH ROW EXECUTE FUNCTION create_kitchen_booking_visits();
