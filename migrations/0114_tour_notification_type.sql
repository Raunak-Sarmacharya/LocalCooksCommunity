-- Tour notices were stored as 'booking_confirmed' (request sent, offered times, declined, cancelled...), so the bell showed
-- them as booking confirmations. One type for every tour notice; the message itself says what happened. Idempotent.
ALTER TYPE chef_notification_type ADD VALUE IF NOT EXISTS 'tour_update';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'tour_update';
