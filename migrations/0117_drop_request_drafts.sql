-- Code-first sign-up (owner, Oct 26): no account or held request exists until the emailed code proves the inbox, so the
-- held drafts from 0108 (Request to apply) and 0115 (tour request) are no longer read or written. Dev rows were test data.
DROP TABLE IF EXISTS kitchen_request_drafts;
DROP TABLE IF EXISTS kitchen_tour_drafts;
