-- Additive, manual release prerequisite. Do not apply to shared targets from this chat.
CREATE TABLE IF NOT EXISTS commitment_problems (
  id SERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'schedule')),
  booking_id INTEGER REFERENCES kitchen_bookings(id),
  viewing_id INTEGER REFERENCES kitchen_viewings(id),
  kitchen_id INTEGER REFERENCES kitchens(id),
  reported_by INTEGER NOT NULL REFERENCES users(id),
  owner TEXT NOT NULL DEFAULT 'local_cooks' CHECK (owner = 'local_cooks'),
  claimed_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','acknowledged','escalated','resolved')),
  description TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK ((booking_id IS NOT NULL)::integer + (viewing_id IS NOT NULL)::integer = 1)
);
CREATE INDEX IF NOT EXISTS commitment_problems_outstanding ON commitment_problems(status, id);
