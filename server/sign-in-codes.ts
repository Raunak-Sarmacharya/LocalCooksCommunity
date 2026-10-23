import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Email sign-in codes (Slack/Notion style): a 6-digit code typed on the device that asked, so asking on a PC and reading
 * the email on a phone still signs the PC in. One live code per email, stored only as a hash; 10 minutes, one use,
 * 5 wrong tries ends it, and an address can be sent at most 5 codes an hour (each new code resets the tries).
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS_PER_HOUR = 5;

type Query = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;

const hash = (email: string, code: string) => createHash("sha256").update(`${email}:${code}`).digest("hex");

/** A fresh code for this email, or null when the address has had too many this hour. */
export async function issueSignInCode(query: Query, email: string, now = new Date()): Promise<string | null> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const { rows } = await query(
    `INSERT INTO sign_in_codes (email, code_hash, expires_at, attempts, sends, window_started_at, created_at)
     VALUES ($1, $2, $3, 0, 1, $4, $4)
     ON CONFLICT (email) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = EXCLUDED.created_at,
       sends = CASE WHEN sign_in_codes.window_started_at < $5 THEN 1 ELSE sign_in_codes.sends + 1 END,
       window_started_at = CASE WHEN sign_in_codes.window_started_at < $5 THEN EXCLUDED.window_started_at ELSE sign_in_codes.window_started_at END
     WHERE sign_in_codes.window_started_at < $5 OR sign_in_codes.sends < ${MAX_SENDS_PER_HOUR}
     RETURNING email`,
    [email, hash(email, code), new Date(now.getTime() + CODE_TTL_MS), now, hourAgo],
  );
  return rows.length ? code : null;
}

export type CodeCheck = "ok" | "wrong" | "expired";

/** Checks and, when right, uses up the code. "expired" covers no code, too old, and too many wrong tries. */
export async function checkSignInCode(query: Query, email: string, code: string, now = new Date()): Promise<CodeCheck> {
  if (!/^\d{6}$/.test(code)) return "wrong";
  // Count the try first (atomically), so parallel guesses can't share one attempt.
  const { rows } = await query(
    `UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = $1 AND expires_at > $2 AND attempts < ${MAX_ATTEMPTS}
     RETURNING code_hash, attempts`,
    [email, now],
  );
  if (!rows.length) return "expired";
  const expected = Buffer.from(rows[0].code_hash, "hex"), given = Buffer.from(hash(email, code), "hex");
  if (!timingSafeEqual(expected, given)) return rows[0].attempts >= MAX_ATTEMPTS ? "expired" : "wrong";
  // One use: only the request that ends the code signs in. The row stays so the hourly send count holds.
  const used = await query(`UPDATE sign_in_codes SET expires_at = to_timestamp(0) WHERE email = $1 AND code_hash = $2 AND expires_at > $3 RETURNING email`,
    [email, rows[0].code_hash, now]);
  return used.rows.length ? "ok" : "expired";
}
