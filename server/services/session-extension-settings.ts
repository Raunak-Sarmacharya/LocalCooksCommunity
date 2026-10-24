/**
 * Session-extension settings: the Local Cooks platform switch that pauses every new extension, offer and
 * extra-time payment (in-flight decisions still reconcile). There is no automatic approval: a customer's request
 * always waits for the kitchen (owner, Oct 24).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { platformSettings } from '@shared/schema';

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
export async function setSessionExtensionsEnabled(actor: SettingsActor, enabled: boolean, reason: string) {
  if (actor.role !== 'admin') throw new SessionExtensionSettingsError('Only Local Cooks can pause extensions', 403);
  if (!reason.trim()) throw new SessionExtensionSettingsError('Include a reason');
  const value = enabled ? '1' : '0', description = `Session extensions ${enabled ? 'on' : 'paused'}: ${reason.trim().slice(0, 500)}`;
  await db.insert(platformSettings).values({ key: sessionExtensionsEnabledKey, value, updatedBy: actor.id, description })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, description, updatedBy: actor.id, updatedAt: new Date() } });
  return { enabled: await sessionExtensionsEnabled() };
}
