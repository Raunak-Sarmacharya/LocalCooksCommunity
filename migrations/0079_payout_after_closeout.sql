-- Payout after closeout (docs/architecture/phase0/build-payout-after-closeout.md). Additive only; NOT applied by the build.
-- payout_timing NULL = legacy at_capture. Existing rows are untouched: no backfill, no release decisions.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_timing text;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_eligible_at timestamptz;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_hold_reason text;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_released_at timestamptz;

-- Due sweep: unreleased after-closeout kitchen shares, by eligibility time.
CREATE INDEX IF NOT EXISTS payment_transactions_closeout_payout_due
  ON payment_transactions (payout_eligible_at, id)
  WHERE payout_timing = 'after_closeout' AND transfer_id IS NULL AND payout_released_at IS NULL;

-- Retry sweep: a committed release decision whose transfer has not been recorded yet.
CREATE INDEX IF NOT EXISTS payment_transactions_closeout_payout_retry
  ON payment_transactions (id)
  WHERE payout_timing = 'after_closeout' AND transfer_id IS NULL AND payout_released_at IS NOT NULL
    AND COALESCE(metadata->>'payoutNoEntitlement', 'false') <> 'true';
