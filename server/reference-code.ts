import crypto from 'crypto';
import { db } from './db';
import { sql } from 'drizzle-orm';

// Enterprise-grade reference code generator
// Format: {PREFIX}-{6 chars} e.g. KB-A7K9MX
// Safe character set: no ambiguous chars (0/O, 1/I/L)
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars
const CODE_LENGTH = 6; // 32^6 = ~1 billion combinations per prefix

// Prefix mapping for each record type
export const REFERENCE_PREFIXES = {
  kitchen_booking: 'KB',
  storage_booking: 'SB',
  storage_extension: 'EXT',
  overstay_penalty: 'OP',
  damage_claim: 'DC',
} as const;

export type ReferenceType = keyof typeof REFERENCE_PREFIXES;

/**
 * Generates a cryptographically random reference code
 * Format: {PREFIX}-{6 random chars from safe set}
 * Example: KB-A7K9MX, SB-X3P2NR, DC-B4R7TY
 */
function generateCode(prefix: string): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += SAFE_CHARS[bytes[i] % SAFE_CHARS.length];
  }
  return `${prefix}-${code}`;
}

/**
 * Generates a unique reference code with collision check.
 * Checks ALL reference_code columns across all booking tables to ensure global uniqueness.
 * Retries up to 5 times on collision (astronomically unlikely with 32^6 per prefix).
 */
export async function generateReferenceCode(type: ReferenceType): Promise<string> {
  const prefix = REFERENCE_PREFIXES[type];

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(prefix);

    // Check for collision across all tables with reference_code
    const result = await db.execute(sql`
      SELECT 1 FROM (
        SELECT reference_code FROM kitchen_bookings WHERE reference_code = ${code}
        UNION ALL
        SELECT reference_code FROM storage_bookings WHERE reference_code = ${code}
        UNION ALL
        SELECT reference_code FROM pending_storage_extensions WHERE reference_code = ${code}
        UNION ALL
        SELECT reference_code FROM storage_overstay_records WHERE reference_code = ${code}
        UNION ALL
        SELECT reference_code FROM damage_claims WHERE reference_code = ${code}
      ) AS refs LIMIT 1
    `);

    if (result.rows.length === 0) {
      return code;
    }
  }

  // Fallback: append timestamp suffix (should never happen)
  const fallback = `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  return fallback;
}

/**
 * Generates reference codes in bulk (for backfilling existing records).
 * Returns an array of unique codes.
 */
export function generateBulkCodes(type: ReferenceType, count: number): string[] {
  const prefix = REFERENCE_PREFIXES[type];
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateCode(prefix));
  }
  return Array.from(codes);
}
