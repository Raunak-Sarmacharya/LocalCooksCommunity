-- Migration: Add pending_storage_extensions table
-- Tracks pending storage extension requests awaiting payment confirmation

CREATE TABLE IF NOT EXISTS pending_storage_extensions (
    id SERIAL PRIMARY KEY,
    storage_booking_id INTEGER NOT NULL REFERENCES storage_bookings(id) ON DELETE CASCADE,
    new_end_date TIMESTAMP NOT NULL,
    extension_days INTEGER NOT NULL,
    extension_base_price_cents INTEGER NOT NULL,
    extension_service_fee_cents INTEGER NOT NULL,
    extension_total_price_cents INTEGER NOT NULL,
    stripe_session_id TEXT NOT NULL,
    stripe_payment_intent_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Index for looking up pending extensions by session ID
CREATE INDEX IF NOT EXISTS idx_pending_storage_extensions_session_id 
ON pending_storage_extensions(stripe_session_id);

-- Index for looking up pending extensions by storage booking ID
CREATE INDEX IF NOT EXISTS idx_pending_storage_extensions_booking_id 
ON pending_storage_extensions(storage_booking_id);

-- Index for finding pending extensions by status
CREATE INDEX IF NOT EXISTS idx_pending_storage_extensions_status 
ON pending_storage_extensions(status);
