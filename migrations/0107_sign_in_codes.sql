-- Email sign-in codes (owner, Oct 23): signing in with email sends a 6-digit code typed on the device that asked,
-- replacing the sign-in link. One live code per email; only its hash is stored. attempts caps guesses per code;
-- sends/window_started_at cap how many codes one address can be sent per hour (each new code resets attempts).
CREATE TABLE IF NOT EXISTS sign_in_codes (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sends integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sign_in_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sign_in_codes FROM PUBLIC;
