/**
 * Kitchen overrides of booking rules (buffer spacing, weekly chef hours). Built only by server code after authenticating
 * the owning manager or an admin; the symbol brand cannot come from a request body, so a chef can never supply a bypass.
 * Overrides never waive actual occupancy, opening hours, equipment ownership or payment consent.
 */
const trusted = Symbol('trustedBookingRuleOverride');

export type BookingRuleOverrideRecord = {
  ignoreBuffer: boolean; ignoreWeeklyLimit: boolean;
  actorId: number; actorRole: 'manager' | 'admin'; reason: string; at: string;
  /** What the grant is bound to, e.g. `invitation:<kitchenId>:<chefId>`. */
  scope: string;
};
export type BookingRuleOverride = BookingRuleOverrideRecord & { readonly [trusted]: true };

export class BookingRuleOverrideError extends Error {}

export function isTrustedOverride(value: unknown): value is BookingRuleOverride {
  return !!value && typeof value === 'object' && (value as { [trusted]?: unknown })[trusted] === true;
}

/** Grant from an authenticated kitchen actor. Callers must already have checked the actor owns the kitchen. */
export function kitchenRuleOverride(input: {
  actorId: number; actorRole: string | null | undefined; scope: string;
  ignoreBuffer?: unknown; ignoreWeeklyLimit?: unknown; reason?: unknown;
}, now = new Date()): BookingRuleOverride | undefined {
  const ignoreBuffer = input.ignoreBuffer === true, ignoreWeeklyLimit = input.ignoreWeeklyLimit === true;
  if (!ignoreBuffer && !ignoreWeeklyLimit) return undefined;
  if (input.actorRole !== 'manager' && input.actorRole !== 'admin') throw new BookingRuleOverrideError('Only the kitchen can override booking rules.');
  if (!Number.isSafeInteger(input.actorId)) throw new BookingRuleOverrideError('Override actor is required.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 500) throw new BookingRuleOverrideError('Give a reason (up to 500 characters) for the override.');
  return { [trusted]: true, ignoreBuffer, ignoreWeeklyLimit, actorId: input.actorId, actorRole: input.actorRole,
    reason, at: now.toISOString(), scope: input.scope };
}

/** Plain JSON for `booking_rule_overrides` (audit trail). */
export function overrideRecord(override: BookingRuleOverride | undefined): BookingRuleOverrideRecord | null {
  if (!override) return null;
  const { ignoreBuffer, ignoreWeeklyLimit, actorId, actorRole, reason, at, scope } = override;
  return { ignoreBuffer, ignoreWeeklyLimit, actorId, actorRole, reason, at, scope };
}

/** Re-trust a grant this server saved on a row, only for the exact scope it was granted for. */
export function savedOverride(record: unknown, scope: string): BookingRuleOverride | undefined {
  const saved = record as Partial<BookingRuleOverrideRecord> | null;
  if (!saved || typeof saved !== 'object' || saved.scope !== scope) return undefined;
  if (saved.actorRole !== 'manager' && saved.actorRole !== 'admin') return undefined;
  if (!Number.isSafeInteger(saved.actorId) || typeof saved.reason !== 'string' || typeof saved.at !== 'string') return undefined;
  return { [trusted]: true, ignoreBuffer: saved.ignoreBuffer === true, ignoreWeeklyLimit: saved.ignoreWeeklyLimit === true,
    actorId: saved.actorId!, actorRole: saved.actorRole, reason: saved.reason, at: saved.at, scope };
}

/** A grant saved on an invitation is valid only for that invitation row (its kitchen and chef). */
export const invitationOverrideScope = (row: { id: string; kitchenId: number; chefId: number }) =>
  `invitation:${row.id}:${row.kitchenId}:${row.chefId}`;
export const savedInvitationOverride = (row: { id: string; kitchenId: number; chefId: number; bookingRuleOverrides?: unknown }) =>
  savedOverride(row.bookingRuleOverrides, invitationOverrideScope(row));

export const waivesBuffer = (override: unknown) => isTrustedOverride(override) && override.ignoreBuffer;
export const waivesWeeklyLimit = (override: unknown) => isTrustedOverride(override) && override.ignoreWeeklyLimit;
