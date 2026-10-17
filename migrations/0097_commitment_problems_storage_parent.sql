-- Applied to dev Oct 17 (prod pending owner go-ahead). 0093 added storage_booking_id but kept the booking-or-tour check,
-- so every storage problem report failed. A problem belongs to exactly one booking, tour or storage rental.
ALTER TABLE commitment_problems DROP CONSTRAINT IF EXISTS commitment_problems_check;
ALTER TABLE commitment_problems ADD CONSTRAINT commitment_problems_one_parent CHECK (num_nonnulls(booking_id, viewing_id, storage_booking_id) = 1);
