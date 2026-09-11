ALTER TABLE "payment_transactions"
ADD COLUMN IF NOT EXISTS "tax_amount" numeric DEFAULT '0';

COMMENT ON COLUMN "payment_transactions"."tax_amount" IS
'Tax collected for the kitchen and included in manager gross payout, stored in cents.';
