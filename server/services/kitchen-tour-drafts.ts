/**
 * A brand-new account's tour request, held until its email is verified (owner, Oct 25), the same way as
 * kitchen-request-drafts. Validated with the booking route's own schema, so sending a draft is exactly the request
 * the page would have sent.
 */
import { requestKitchenViewingSchema } from "@shared/schema";

type Query = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;
const MAX_BYTES = 8_000;

export const tourDraftSchema = requestKitchenViewingSchema.omit({ chefId: true, durationMinutes: true }).extend({
  locationId: requestKitchenViewingSchema.shape.locationId.int().positive(),
  targetedKitchenId: requestKitchenViewingSchema.shape.targetedKitchenId.int().positive(),
}).refine(draft => Date.parse(String(draft.scheduledAt)) > Date.now(), { message: "Pick a time in the future", path: ["scheduledAt"] })
  .refine(draft => JSON.stringify(draft).length <= MAX_BYTES, { message: "Too large" });

export type TourDraft = { locationId: number; targetedKitchenId: number; scheduledAt: string; chefNotes?: string; intakeData: Record<string, unknown> };

/** The draft to keep from a request body; null when it isn't a valid tour request. */
export function tourDraftFromBody(body: unknown): TourDraft | null {
  const parsed = tourDraftSchema.safeParse(body);
  if (!parsed.success) return null;
  const { locationId, targetedKitchenId, scheduledAt, chefNotes, intakeData } = parsed.data;
  return { locationId, targetedKitchenId, scheduledAt: new Date(scheduledAt).toISOString(), chefNotes, intakeData };
}

export async function saveTourDraft(query: Query, userId: number, draft: TourDraft) {
  await query(`INSERT INTO kitchen_tour_drafts (user_id, kitchen_id, location_id, scheduled_at, intake, chef_notes) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, kitchen_id) DO UPDATE SET location_id = EXCLUDED.location_id, scheduled_at = EXCLUDED.scheduled_at,
      intake = EXCLUDED.intake, chef_notes = EXCLUDED.chef_notes, updated_at = now()`,
    [userId, draft.targetedKitchenId, draft.locationId, draft.scheduledAt, JSON.stringify(draft.intakeData), draft.chefNotes || null]);
}

export async function readTourDraft(query: Query, userId: number, kitchenId: number): Promise<(TourDraft & { createdAt: Date }) | null> {
  const { rows } = await query(`SELECT location_id, scheduled_at, intake, chef_notes, created_at FROM kitchen_tour_drafts WHERE user_id = $1 AND kitchen_id = $2`, [userId, kitchenId]);
  if (!rows.length) return null;
  const row = rows[0];
  return { locationId: row.location_id, targetedKitchenId: kitchenId, scheduledAt: new Date(row.scheduled_at).toISOString(),
    intakeData: typeof row.intake === "string" ? JSON.parse(row.intake) : row.intake, chefNotes: row.chef_notes ?? undefined, createdAt: row.created_at };
}

export async function deleteTourDraft(query: Query, userId: number, kitchenId: number) {
  await query(`DELETE FROM kitchen_tour_drafts WHERE user_id = $1 AND kitchen_id = $2`, [userId, kitchenId]);
}
