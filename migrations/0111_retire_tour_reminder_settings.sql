-- Tours now send one reminder 2 hours before for both sides, like bookings (owner, Oct 24). These settings no longer
-- exist in code or on the admin page; remove their saved values so nothing suggests they still apply.
DELETE FROM platform_settings WHERE key IN (
  'tour_preparation_minute_of_day',
  'tour_preparation_enabled',
  'tour_departure_reminder_minutes',
  'tour_departure_enabled',
  'tour_outcome_reminder_minutes'
);
