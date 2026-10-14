-- WRITE ONLY. 0082 was applied separately; never modify it. Owner amendment: review every claim first.
ALTER TYPE damage_claim_status ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE damage_claim_status ADD VALUE IF NOT EXISTS 'awaiting_kitchen';
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS chef_visible_at timestamptz;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS review_request text;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS kitchen_reply text;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS withdrawal_operation jsonb;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS booking_hold_notified_at timestamptz;
INSERT INTO platform_settings (key, value, description) VALUES
  ('damageClaimsReviewFirst', 'true', 'Local Cooks reviews every damage/cleaning claim before sending it to the chef')
  ON CONFLICT (key) DO NOTHING;
CREATE INDEX IF NOT EXISTS damage_claims_first_review ON damage_claims(id)
  WHERE chef_visible_at IS NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS damage_claims_escalation_due ON damage_claims(chef_response_deadline, id) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS damage_claims_withdrawal_recovery ON damage_claims(id)
  WHERE withdrawal_operation->>'state' = 'pending';
CREATE INDEX IF NOT EXISTS damage_claims_hold_notice_due ON damage_claims(upheld_at, id)
  WHERE chef_owes AND upheld_at IS NOT NULL AND hold_released_at IS NULL AND resolved_at IS NULL
    AND charge_succeeded_at IS NULL AND booking_hold_notified_at IS NULL;
-- Existing claim/evidence/history RLS remains enabled. Reassert server-only privileges for the expanded rows.
ALTER TABLE damage_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE damage_claims FROM PUBLIC;
REVOKE ALL ON SEQUENCE damage_claims_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE damage_claims FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE damage_claims_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
