/**
 * Location-owned HST %. Kitchen.taxRatePercent stays the checkout source of truth for money
 * readers; saving the location rate copies it onto every kitchen in the same transaction
 * (shortcut: leave kitchen.taxRatePercent readers untouched).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations } from '@shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function parseTaxRatePercent(value: unknown): number | null | { error: string } {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return { error: 'Tax rate must be between 0 and 100 percent' };
  }
  return value;
}

export async function saveLocationTaxRate(locationId: number, managerId: number, taxRatePercent: number | null) {
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: locations.id }).from(locations)
      .where(eq(locations.id, locationId)).limit(1);
    if (!owned) throw Object.assign(new Error('Location not found'), { status: 404 });
    const [managerOwned] = await tx.select({ id: locations.id, managerId: locations.managerId }).from(locations)
      .where(eq(locations.id, locationId)).limit(1);
    if (!managerOwned || managerOwned.managerId !== managerId) {
      throw Object.assign(new Error('Access denied'), { status: 403 });
    }
    const rate = taxRatePercent == null ? null : String(taxRatePercent);
    // shortcut: write kitchens.tax_rate_percent so pricing/checkout/revenue keep reading the kitchen column.
    await tx.update(locations).set({ taxRatePercent: rate, updatedAt: new Date() }).where(eq(locations.id, locationId));
    await tx.update(kitchens).set({ taxRatePercent: rate, updatedAt: new Date() }).where(eq(kitchens.locationId, locationId));
    return { taxRatePercent };
  });
}

/** Apply tax inside an existing transaction (location update path). */
export async function syncLocationTaxRateInTx(tx: Tx, locationId: number, taxRatePercent: number | null) {
  const rate = taxRatePercent == null ? null : String(taxRatePercent);
  // shortcut: keep kitchen.taxRatePercent in lockstep for every money reader of that column.
  await tx.update(locations).set({ taxRatePercent: rate, updatedAt: new Date() }).where(eq(locations.id, locationId));
  await tx.update(kitchens).set({ taxRatePercent: rate, updatedAt: new Date() }).where(eq(kitchens.locationId, locationId));
}
