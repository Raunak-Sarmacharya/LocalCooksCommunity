import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, checkinCheckoutChecklists, kitchenCheckinCheckoutOverrides, checklistItemSchema, photoRequirementSchema } from '@shared/schema';
import { kitchenChecklistFields, resolveKitchenChecklist } from '@shared/kitchen-checklist';
import { activeChecklist } from '@shared/active-checklist';
import { changedKitchenSections, queueKitchenInstructionUpdates } from './kitchen-instructions-updated';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = Pick<typeof db, 'select'>;
export class KitchenSetupError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function ownedKitchenSetup(kitchenId: number, managerId: number, tx: Database = db) {
  if (!Number.isSafeInteger(kitchenId) || kitchenId <= 0) throw new KitchenSetupError(400, 'Invalid kitchen ID');
  const [row] = await tx.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(kitchens.id, kitchenId), eq(locations.managerId, managerId))).limit(1);
  if (!row) throw new KitchenSetupError(403, 'Access denied');
  return row;
}

export async function kitchenChecklistSetup(kitchenId: number, locationId: number, tx: Database = db) {
  const [defaults] = await tx.select().from(checkinCheckoutChecklists).where(eq(checkinCheckoutChecklists.locationId, locationId)).limit(1);
  const [override] = await tx.select().from(kitchenCheckinCheckoutOverrides).where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchenId)).limit(1);
  const empty = { checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [], checkinInstructions: null, checkoutInstructions: null };
  return { defaults: defaults || empty, override: override || null,
    effective: activeChecklist(resolveKitchenChecklist(override, defaults || empty)!) };
}

export function validateKitchenOverridePatch(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new KitchenSetupError(400, 'Expected section fields');
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body)) {
    if (!kitchenChecklistFields.includes(field as typeof kitchenChecklistFields[number])) throw new KitchenSetupError(400, `Unknown kitchen section field: ${field}`);
    if (value === null) patch[field] = null;
    else if (field.endsWith('Instructions')) {
      if (typeof value !== 'string' || value.length > 20_000) throw new KitchenSetupError(400, 'Instructions must be text (up to 20000 characters) or null');
      patch[field] = value;
    } else {
      const parsed = (field.endsWith('Items') ? checklistItemSchema : photoRequirementSchema).array().max(100).safeParse(value);
      if (!parsed.success) throw new KitchenSetupError(400, `Invalid ${field}`);
      if (new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) throw new KitchenSetupError(400, `Duplicate IDs in ${field}`);
      patch[field] = parsed.data;
    }
  }
  return patch;
}

export async function setKitchenChecklistOverrides(kitchenId: number, managerId: number, body: unknown) {
  const patch = validateKitchenOverridePatch(body);
  return db.transaction(async tx => {
    const { kitchen } = await ownedKitchenSetup(kitchenId, managerId, tx);
    // All location and kitchen writers share this lock, including a missing override row.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7242, ${kitchen.locationId})`);
    const before = await kitchenChecklistSetup(kitchenId, kitchen.locationId, tx);
    if (Object.keys(patch).length) {
      const merged = { ...before.override, ...patch };
      if (kitchenChecklistFields.every(field => merged[field] == null)) {
        await tx.delete(kitchenCheckinCheckoutOverrides).where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchenId));
      } else {
        await tx.insert(kitchenCheckinCheckoutOverrides).values({ kitchenId, locationId: kitchen.locationId, ...patch, updatedBy: managerId })
          .onConflictDoUpdate({ target: kitchenCheckinCheckoutOverrides.kitchenId, set: { ...patch, updatedBy: managerId, updatedAt: new Date() } });
      }
    }
    const after = await kitchenChecklistSetup(kitchenId, kitchen.locationId, tx);
    await queueKitchenInstructionUpdates(tx, kitchenId, before.effective, after.effective, managerId);
    return after;
  });
}

/** Called inside the same transaction as the location upsert. */
export async function queueLocationInstructionUpdates(tx: Transaction, locationId: number,
  before: Record<string, unknown> | null, after: Record<string, unknown>, managerId: number) {
  if (!changedKitchenSections(before, after).length) return;
  const rows = await tx.select({ kitchen: kitchens, override: kitchenCheckinCheckoutOverrides }).from(kitchens)
    .leftJoin(kitchenCheckinCheckoutOverrides, eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchens.id))
    .where(eq(kitchens.locationId, locationId));
  for (const { kitchen, override } of rows) await queueKitchenInstructionUpdates(tx, kitchen.id,
    resolveKitchenChecklist(override, before), resolveKitchenChecklist(override, after), managerId);
}
