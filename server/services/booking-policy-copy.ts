/**
 * Copy overridable booking rules from one kitchen onto the other kitchens at its location.
 * Writes kitchen overrides (or clears them when the source effective value equals the location default).
 * Does not copy money settings (tax, cancellation).
 */
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations } from '@shared/schema';
import {
  bufferWritePatch,
  effectiveBookingBufferMinutes,
  resolveKitchenBookingPolicies,
} from '@shared/kitchen-booking-policies';
import { bookingDaysCap, bookingWindowCap } from './booking-policy-settings';

const OVERRIDE_FIELDS = [
  'minimumBookingWindowHours',
  'maxAdvanceBookingDays',
  'defaultDailyBookingLimit',
  'allowMultiDayBookings',
  'maxBookingDays',
] as const;

type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export type PolicyCopyChange = {
  field: string;
  from: unknown;
  to: unknown;
  action: 'set' | 'clear' | 'unchanged';
};

export type PolicyCopyKitchenPreview = {
  kitchenId: number;
  kitchenName: string;
  changes: PolicyCopyChange[];
};

function fieldValue(kitchen: typeof kitchens.$inferSelect, field: OverrideField) {
  return kitchen[field];
}

export async function previewCopyBookingPolicies(sourceKitchenId: number, managerId: number) {
  const [cap, daysCap] = await Promise.all([bookingWindowCap(), bookingDaysCap()]);
  const [owned] = await db.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(and(eq(kitchens.id, sourceKitchenId), eq(locations.managerId, managerId))).limit(1);
  if (!owned) throw Object.assign(new Error('Kitchen not found or access denied'), { status: 403 });
  const others = await db.select().from(kitchens)
    .where(and(eq(kitchens.locationId, owned.location.id), ne(kitchens.id, sourceKitchenId)));
  const sourceEffective = resolveKitchenBookingPolicies(owned.kitchen, owned.location, cap, daysCap);
  const locationDefaults = resolveKitchenBookingPolicies({}, owned.location, cap, daysCap);
  const kitchensPreview: PolicyCopyKitchenPreview[] = [];

  for (const target of others) {
    const changes: PolicyCopyChange[] = [];
    for (const field of OVERRIDE_FIELDS) {
      const desired = sourceEffective[field === 'defaultDailyBookingLimit' ? 'defaultDailyBookingLimit' : field];
      const locationValue = locationDefaults[field === 'defaultDailyBookingLimit' ? 'defaultDailyBookingLimit' : field];
      const currentOverride = fieldValue(target, field);
      const currentEffective = resolveKitchenBookingPolicies(target, owned.location, cap, daysCap)[
        field === 'defaultDailyBookingLimit' ? 'defaultDailyBookingLimit' : field
      ];
      const clear = desired === locationValue || desired == null && locationValue == null;
      const nextOverride = clear ? null : desired;
      const action = currentOverride === nextOverride || (currentOverride == null && nextOverride == null)
        ? 'unchanged'
        : clear ? 'clear' : 'set';
      if (action !== 'unchanged' || currentEffective !== desired) {
        changes.push({ field, from: currentEffective, to: desired, action: action === 'unchanged' ? 'unchanged' : action });
      }
    }
    const sourceBuffer = sourceEffective.bookingBufferMinutes;
    const locationBuffer = locationDefaults.bookingBufferMinutes;
    const currentBuffer = effectiveBookingBufferMinutes(target, owned.location);
    const clearBuffer = sourceBuffer === locationBuffer;
    const targetHasOverride = target.bookingBufferMinutes != null || target.turnoverBufferEnabled != null;
    if (currentBuffer !== sourceBuffer || (clearBuffer && targetHasOverride) || (!clearBuffer && !targetHasOverride)) {
      changes.push({
        field: 'bookingBufferMinutes', from: currentBuffer, to: sourceBuffer,
        action: clearBuffer ? (targetHasOverride ? 'clear' : 'unchanged') : 'set',
      });
    }
    const sourceWeekly = owned.kitchen.weeklyChefHoursLimit ?? null;
    const targetWeekly = target.weeklyChefHoursLimit ?? null;
    if (sourceWeekly !== targetWeekly) {
      changes.push({ field: 'weeklyChefHoursLimit', from: targetWeekly, to: sourceWeekly, action: sourceWeekly == null ? 'clear' : 'set' });
    }
    const sourceMin = owned.kitchen.minimumBookingHours ?? 0;
    const targetMin = target.minimumBookingHours ?? 0;
    if (sourceMin !== targetMin) {
      changes.push({ field: 'minimumBookingHours', from: targetMin, to: sourceMin, action: 'set' });
    }
    kitchensPreview.push({
      kitchenId: target.id, kitchenName: target.name,
      changes: changes.filter((c) => c.action !== 'unchanged'),
    });
  }
  return {
    sourceKitchenId, sourceKitchenName: owned.kitchen.name, locationId: owned.location.id,
    kitchens: kitchensPreview,
  };
}

export async function applyCopyBookingPolicies(sourceKitchenId: number, managerId: number) {
  const preview = await previewCopyBookingPolicies(sourceKitchenId, managerId);
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ kitchen: kitchens, location: locations }).from(kitchens)
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(and(eq(kitchens.id, sourceKitchenId), eq(locations.managerId, managerId))).limit(1);
    if (!owned) throw Object.assign(new Error('Kitchen not found or access denied'), { status: 403 });
    const [cap, daysCap] = await Promise.all([bookingWindowCap(), bookingDaysCap()]);
    const sourceEffective = resolveKitchenBookingPolicies(owned.kitchen, owned.location, cap, daysCap);
    const locationDefaults = resolveKitchenBookingPolicies({}, owned.location, cap, daysCap);
    const others = await tx.select().from(kitchens)
      .where(and(eq(kitchens.locationId, owned.location.id), ne(kitchens.id, sourceKitchenId)));
    let updated = 0;
    for (const target of others) {
      const patch: Partial<typeof kitchens.$inferInsert> = {};
      for (const field of OVERRIDE_FIELDS) {
        const desired = sourceEffective[field];
        const locationValue = locationDefaults[field];
        patch[field] = (desired === locationValue || desired == null && locationValue == null) ? null : desired as any;
      }
      const sourceBuffer = sourceEffective.bookingBufferMinutes;
      const locationBuffer = locationDefaults.bookingBufferMinutes;
      if (sourceBuffer === locationBuffer) {
        patch.bookingBufferMinutes = null;
        patch.turnoverBufferEnabled = null;
      } else {
        const written = bufferWritePatch(target, { bookingBufferMinutes: sourceBuffer });
        if (!('error' in written)) {
          patch.bookingBufferMinutes = written.bookingBufferMinutes;
          patch.turnoverBufferEnabled = written.turnoverBufferEnabled;
        }
      }
      patch.weeklyChefHoursLimit = owned.kitchen.weeklyChefHoursLimit ?? null;
      patch.minimumBookingHours = owned.kitchen.minimumBookingHours ?? 1;
      await tx.update(kitchens).set({ ...patch, updatedAt: new Date() }).where(eq(kitchens.id, target.id));
      updated += 1;
    }
    return { ...preview, updatedKitchens: updated };
  });
}
