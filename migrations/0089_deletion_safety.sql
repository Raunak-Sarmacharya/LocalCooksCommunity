-- WP-D round 2: deleting an account, location or kitchen must never destroy payment history.
-- NOT APPLIED. Apply before deploying the deletion guards (the code archives instead of deleting history).

-- 1) Kitchens and locations with booking/claim history are archived, never deleted.
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2) Cascades that silently erased bookings, extensions, add-ons and claims become RESTRICT.
--    Constraint names are looked up in pg_constraint (like 0087); each edge is dropped and re-added once.
DO $$
DECLARE
  edge text[];
  fk record;
  edges text[][] := ARRAY[
    ARRAY['locations','manager_id','users'],
    ARRAY['kitchens','location_id','locations'],
    ARRAY['kitchen_bookings','kitchen_id','kitchens'],
    ARRAY['kitchen_bookings','chef_id','users'],
    ARRAY['kitchen_bookings','created_by','users'],
    ARRAY['storage_bookings','kitchen_booking_id','kitchen_bookings'],
    ARRAY['storage_bookings','storage_listing_id','storage_listings'],
    ARRAY['equipment_bookings','kitchen_booking_id','kitchen_bookings'],
    ARRAY['damage_claims','location_id','locations'],
    ARRAY['damage_claims','manager_id','users'],
    ARRAY['damage_claims','chef_id','users'],
    ARRAY['kitchen_booking_extensions','booking_id','kitchen_bookings']
  ];
BEGIN
  FOREACH edge SLICE 1 IN ARRAY edges LOOP
    IF to_regclass(edge[1]) IS NULL OR to_regclass(edge[3]) IS NULL THEN
      RAISE EXCEPTION 'Missing deletion-safety prerequisite: % / %', edge[1], edge[3];
    END IF;
    FOR fk IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND con.conrelid = to_regclass(edge[1])
        AND con.confrelid = to_regclass(edge[3])
        AND att.attname = edge[2]
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', edge[1], fk.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT',
      edge[1], edge[1] || '_' || edge[2] || '_fkey', edge[2], edge[3]);
  END LOOP;
END $$;

-- 3) Durable record of every account deletion/anonymization, including audited admin overrides. No FKs on purpose:
--    it must outlive the account it describes.
CREATE TABLE IF NOT EXISTS account_deletion_audit (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  username text NOT NULL,
  role text,
  actor_id integer,
  override_used boolean NOT NULL DEFAULT false,
  override_reason text,
  outcome text NOT NULL,
  blockers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_deletion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE account_deletion_audit FROM PUBLIC;
