-- Write only. Owner decisions: build-damage-claims.md. Existing history/evidence and legacy claims survive.
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS claim_version integer NOT NULL DEFAULT 1;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS request_key text;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS cost_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS visit_evidence jsonb;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS upheld_at timestamptz;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS chef_owes boolean NOT NULL DEFAULT true;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS hold_released_at timestamptz;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS funded_by text NOT NULL DEFAULT 'chef';
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS payment_operation jsonb;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS transfer_operation jsonb;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS compensation_operation jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS damage_claims_request_unique ON damage_claims(manager_id, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS damage_claims_response_due ON damage_claims(id, chef_response_deadline) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS damage_claims_booking_hold ON damage_claims(chef_id, upheld_at, id)
  WHERE chef_owes AND upheld_at IS NOT NULL AND hold_released_at IS NULL AND resolved_at IS NULL AND charge_succeeded_at IS NULL;
CREATE INDEX IF NOT EXISTS damage_claims_money_recovery ON damage_claims(id)
  WHERE payment_operation->>'state' IN ('pending','cancel_pending')
    OR transfer_operation->>'state' = 'pending' OR compensation_operation->>'state' = 'pending';
CREATE INDEX IF NOT EXISTS commitment_problems_chef_payout ON commitment_problems(booking_id, reported_by) WHERE status <> 'resolved';
-- The pilot cap is server-enforced for new submissions; legacy amounts are retained for staff reconciliation.
ALTER TABLE damage_claims ADD CONSTRAINT damage_claims_v2_cap CHECK
  (claim_version <> 2 OR (claimed_amount_cents BETWEEN 1 AND 25000 AND jsonb_array_length(cost_lines) > 0));
ALTER TABLE damage_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_claim_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE damage_claims, damage_evidence, damage_claim_history FROM PUBLIC;
REVOKE ALL ON SEQUENCE damage_claims_id_seq, damage_evidence_id_seq, damage_claim_history_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE damage_claims, damage_evidence, damage_claim_history FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE damage_claims_id_seq, damage_evidence_id_seq, damage_claim_history_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
