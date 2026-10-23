/**
 * A brand-new account's request to cook, held until its email is verified (owner, Oct 23). Only the request route's
 * own text fields are kept, so sending a draft is exactly the request the form would have sent.
 */
type Query = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;

export const DRAFT_FIELDS = ["fullName", "phone", "kitchenPreference", "sourceTourId", "businessDescription", "shopName", "shopAddress",
  "cookingExperience", "foodSafetyLicense", "foodEstablishmentCert", "foodSafetyLicenseExpiry", "foodEstablishmentCertExpiry", "customFieldsData"] as const;
const MAX_BYTES = 32_000;

/** The whitelisted text fields of a request body; null when there's nothing to keep or it's too large. */
export function draftFieldsFromBody(body: Record<string, unknown>): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (const key of DRAFT_FIELDS) {
    const value = body[key];
    if (typeof value === "string" && value !== "") fields[key] = value;
  }
  if (!Object.keys(fields).length || JSON.stringify(fields).length > MAX_BYTES) return null;
  return fields;
}

export async function saveDraft(query: Query, userId: number, locationId: number, fields: Record<string, string>, licenseUrl: string | null) {
  await query(`INSERT INTO kitchen_request_drafts (user_id, location_id, fields, food_safety_license_url) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, location_id) DO UPDATE SET fields = EXCLUDED.fields,
      food_safety_license_url = COALESCE(EXCLUDED.food_safety_license_url, kitchen_request_drafts.food_safety_license_url), updated_at = now()`,
    [userId, locationId, JSON.stringify(fields), licenseUrl]);
}

export async function readDraft(query: Query, userId: number, locationId: number): Promise<{ fields: Record<string, string>; licenseUrl: string | null; createdAt: Date } | null> {
  const { rows } = await query(`SELECT fields, food_safety_license_url, created_at FROM kitchen_request_drafts WHERE user_id = $1 AND location_id = $2`, [userId, locationId]);
  if (!rows.length) return null;
  const fields = typeof rows[0].fields === "string" ? JSON.parse(rows[0].fields) : rows[0].fields;
  return { fields, licenseUrl: rows[0].food_safety_license_url ?? null, createdAt: rows[0].created_at };
}

export async function deleteDraft(query: Query, userId: number, locationId: number) {
  await query(`DELETE FROM kitchen_request_drafts WHERE user_id = $1 AND location_id = $2`, [userId, locationId]);
}
