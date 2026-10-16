import { inArray } from 'drizzle-orm';
import { db } from '../db';
import { cancellationPolicyAudit, platformSettings } from '@shared/schema';
import { PLATFORM_MAX_TERM_DAYS } from '@shared/storage-rental';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Platform keys seeded by migration 0093; the values here are the same defaults. */
export const STORAGE_MAX_TERM_KEY = 'storage_max_term_days';
export const STORAGE_DISPOSAL_KEY = 'storage_kitchen_disposal_enabled';

export type StorageSettings = { maxTermDays: number; kitchenDisposalEnabled: boolean };

/** Platform storage settings: the longest term a chef can pay for, and whether kitchens may record disposal. */
export async function storageSettings(reader: Tx | typeof db = db): Promise<StorageSettings> {
  const rows = await reader.select().from(platformSettings).where(inArray(platformSettings.key, [STORAGE_MAX_TERM_KEY, STORAGE_DISPOSAL_KEY]));
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return validateStorageSettings({
    maxTermDays: values[STORAGE_MAX_TERM_KEY] === undefined ? PLATFORM_MAX_TERM_DAYS : Number(values[STORAGE_MAX_TERM_KEY]),
    kitchenDisposalEnabled: values[STORAGE_DISPOSAL_KEY] === undefined ? false : values[STORAGE_DISPOSAL_KEY] === 'true',
  });
}

export function validateStorageSettings(value: any): StorageSettings {
  if (!Number.isSafeInteger(value?.maxTermDays) || value.maxTermDays < 1 || value.maxTermDays > PLATFORM_MAX_TERM_DAYS)
    throw Error(`Maximum storage term must be a whole number of days from 1 to ${PLATFORM_MAX_TERM_DAYS}`);
  if (typeof value?.kitchenDisposalEnabled !== 'boolean') throw Error('Kitchen disposal must be on or off');
  return { maxTermDays: value.maxTermDays, kitchenDisposalEnabled: value.kitchenDisposalEnabled };
}

/** Saves either or both settings and records the change in the cancellation-policy audit trail. */
export async function saveStorageSettings(input: any, actorId: number) {
  return db.transaction(async tx => {
    const before = await storageSettings(tx);
    const value = validateStorageSettings({
      maxTermDays: input?.maxTermDays ?? before.maxTermDays,
      kitchenDisposalEnabled: input?.kitchenDisposalEnabled ?? before.kitchenDisposalEnabled,
    });
    for (const [key, data] of [[STORAGE_MAX_TERM_KEY, JSON.stringify(value.maxTermDays)], [STORAGE_DISPOSAL_KEY, JSON.stringify(value.kitchenDisposalEnabled)]] as const)
      await tx.insert(platformSettings).values({ key, value: data, updatedBy: actorId }).onConflictDoUpdate({ target: platformSettings.key, set: { value: data, updatedBy: actorId, updatedAt: new Date() } });
    await tx.insert(cancellationPolicyAudit).values({ actorId, reason: 'Platform storage settings', beforeState: before, afterState: value });
    return value;
  });
}

/** The longest term a listing may offer: the kitchen's own lower max, never above the platform max (clamped on read). */
export const listingMaxTermDays = (platformMaxDays: number, listingMaxDays: number | null | undefined) =>
  listingMaxDays == null ? platformMaxDays : Math.min(platformMaxDays, listingMaxDays);
