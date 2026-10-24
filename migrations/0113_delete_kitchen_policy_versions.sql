-- Deleting a kitchen (or an account that owns kitchens) with no bookings must also remove that kitchen's cancellation
-- policy versions; until now the immutability trigger refused, so such kitchens could only ever be archived and a
-- manager account with kitchens but no bookings could not be deleted at all. Bookings keep their own policy snapshot,
-- so nothing a customer agreed to is lost. The delete is allowed only inside a marked deletion transaction, and only
-- while the kitchen has no bookings other than the kitchen's own blocks.
CREATE OR REPLACE FUNCTION protect_published_cancellation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('localcooks.deleting_kitchen_policies', true) = 'on'
    AND NOT EXISTS (SELECT 1 FROM kitchen_bookings WHERE kitchen_id = OLD.kitchen_id AND booking_type <> 'manager_blocked') THEN
    RETURN OLD;
  END IF;
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published cancellation policies are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
