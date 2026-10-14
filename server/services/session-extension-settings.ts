/**
 * Session-extension settings (build-session-extensions.md, Settings).
 * - Kitchen: "Approve extensions automatically when the time is free" (default OFF).
 * - Local Cooks: a per-kitchen override (on/off/follow the kitchen, reason required, audited) and a platform kill switch
 *   that pauses every new extension, offer and extra-time payment (in-flight decisions still reconcile).
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, platformSettings } from '@shared/schema';

export const sessionExtensionsEnabledKey = 'session_extensions_enabled';
type Reader = Pick<typeof db, 'select'>;
export type SettingsActor = { id: number; role: string | null };
export class SessionExtensionSettingsError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** Fails closed: an unreadable value pauses money movement until Local Cooks fixes it. */
export async function sessionExtensionsEnabled(reader: Reader = db) {
  const [setting] = await reader.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, sessionExtensionsEnabledKey)).limit(1);
  if (setting && !['0', '1'].includes(setting.value)) return false;
  return !setting || setting.value === '1';
}
export const effectiveAutoApprove = (kitchen: { autoApproveSessionExtensions: boolean; sessionExtensionsAdminOverride: boolean | null }) =>
  kitchen.sessionExtensionsAdminOverride ?? kitchen.autoApproveSessionExtensions;

async function owned(kitchenId: number, actor: SettingsActor) {
  const [row] = await db.select({ kitchen: kitchens, managerId: locations.managerId }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, kitchenId)).limit(1);
  if (!row || actor.role !== 'admin' && !(actor.role === 'manager' && row.managerId === actor.id)) throw new SessionExtensionSettingsError('Kitchen not found', 404);
  return row;
}
async function overrideReason(kitchenId: number) {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, `session_extensions_override_${kitchenId}`)).limit(1);
  try { return row ? (JSON.parse(row.value) as { reason?: string }).reason ?? null : null; } catch { return null; }
}
export async function readSessionExtensionSettings(kitchenId: number, actor: SettingsActor) {
  const { kitchen } = await owned(kitchenId, actor);
  return { kitchenId, kitchenName: kitchen.name, enabled: await sessionExtensionsEnabled(), autoApprove: kitchen.autoApproveSessionExtensions,
    override: kitchen.sessionExtensionsAdminOverride, overrideReason: kitchen.sessionExtensionsAdminOverride == null ? null : await overrideReason(kitchenId),
    effectiveAutoApprove: effectiveAutoApprove(kitchen) };
}
/** Manager: the kitchen's own choice. Local Cooks: an override (true/false) or `null` to follow the kitchen, with a reason. */
export async function saveSessionExtensionSettings(kitchenId: number, actor: SettingsActor, input: { autoApprove?: boolean; override?: boolean | null; reason?: string }) {
  const { kitchen } = await owned(kitchenId, actor);
  if (actor.role !== 'admin') {
    if (input.override !== undefined) throw new SessionExtensionSettingsError('Only Local Cooks can override extension settings', 403);
    if (typeof input.autoApprove !== 'boolean') throw new SessionExtensionSettingsError('Choose on or off');
    if (kitchen.sessionExtensionsAdminOverride != null) throw new SessionExtensionSettingsError('Local Cooks set this for your kitchen. Contact Local Cooks to change it.', 409);
  } else if (input.override === undefined || !input.reason?.trim()) throw new SessionExtensionSettingsError('Choose the override and include a reason');
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 0)`);
    await tx.update(kitchens).set({ ...(actor.role !== 'admin' ? { autoApproveSessionExtensions: input.autoApprove } : { sessionExtensionsAdminOverride: input.override }),
      updatedAt: new Date() }).where(eq(kitchens.id, kitchenId));
    if (actor.role === 'admin') {
      const value = JSON.stringify({ override: input.override, reason: input.reason!.trim().slice(0, 2000), actorId: actor.id, at: new Date().toISOString(),
        before: kitchen.sessionExtensionsAdminOverride });
      await tx.insert(platformSettings).values({ key: `session_extensions_override_${kitchenId}`, value, updatedBy: actor.id,
        description: 'Local Cooks override for automatic session-extension approval (latest decision)' })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actor.id, updatedAt: new Date() } });
    }
  });
  return readSessionExtensionSettings(kitchenId, actor);
}
export async function setSessionExtensionsEnabled(actor: SettingsActor, enabled: boolean, reason: string) {
  if (actor.role !== 'admin') throw new SessionExtensionSettingsError('Only Local Cooks can pause extensions', 403);
  if (!reason.trim()) throw new SessionExtensionSettingsError('Include a reason');
  const value = enabled ? '1' : '0', description = `Session extensions ${enabled ? 'on' : 'paused'}: ${reason.trim().slice(0, 500)}`;
  await db.insert(platformSettings).values({ key: sessionExtensionsEnabledKey, value, updatedBy: actor.id, description })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, description, updatedBy: actor.id, updatedAt: new Date() } });
  return { enabled: await sessionExtensionsEnabled() };
}
