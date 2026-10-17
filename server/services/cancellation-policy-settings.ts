import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { cancellationPolicyAudit, kitchenCancellationPolicies, kitchens, locations, platformSettings } from '@shared/schema';
import { ACCEPTED_DISCLOSURE_VERSIONS, CHECKBOX_DISCLOSURE_VERSION, cancellationTiers, NOTICE_OPTIONS, CHARGE_OPTIONS, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { matchingLocalInstants } from '@shared/booking-dst';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function cancellationSettings(reader: Tx | typeof db = db) {
  const rows = await reader.select().from(platformSettings).where(inArray(platformSettings.key, ['cancellation_notice_options', 'cancellation_charge_options', 'cancellation_default']));
  const values = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]));
  return validateCancellationSettings({ noticeOptions: values.cancellation_notice_options ?? [...NOTICE_OPTIONS], chargeOptions: values.cancellation_charge_options ?? [...CHARGE_OPTIONS], default: values.cancellation_default ?? { notice: 24, charge: 100 } });
}
export function validateCancellationSettings(value: any): { noticeOptions: number[]; chargeOptions: number[]; default: { notice: number; charge: number } } {
  if (!Array.isArray(value?.noticeOptions) || !value.noticeOptions.length || value.noticeOptions.some((v: number) => !NOTICE_OPTIONS.includes(v as 24))
    || !Array.isArray(value.chargeOptions) || !value.chargeOptions.length || value.chargeOptions.some((v: number) => !CHARGE_OPTIONS.includes(v as 50))
    || new Set(value.noticeOptions).size !== value.noticeOptions.length || new Set(value.chargeOptions).size !== value.chargeOptions.length
    || !value.noticeOptions.includes(value.default?.notice) || !value.chargeOptions.includes(value.default?.charge)) throw Error('Choose allowed notice periods, charges and a matching default');
  return { noticeOptions: value.noticeOptions, chargeOptions: value.chargeOptions, default: { notice: value.default.notice, charge: value.default.charge } };
}
export async function saveCancellationSettings(input: unknown, actorId: number) {
  const value = validateCancellationSettings(input);
  return db.transaction(async tx => {
    const before = await cancellationSettings(tx);
    for (const [key, data] of [['cancellation_notice_options', value.noticeOptions], ['cancellation_charge_options', value.chargeOptions], ['cancellation_default', value.default]] as const)
      await tx.insert(platformSettings).values({ key, value: JSON.stringify(data), updatedBy: actorId }).onConflictDoUpdate({ target: platformSettings.key, set: { value: JSON.stringify(data), updatedBy: actorId, updatedAt: new Date() } });
    await tx.insert(cancellationPolicyAudit).values({ actorId, reason: 'Platform cancellation settings', beforeState: before, afterState: value });
    return value;
  });
}
export async function publishedCancellationPolicy(kitchenId: number, reader: Tx | typeof db = db) {
  const [policy] = await reader.select().from(kitchenCancellationPolicies).where(and(eq(kitchenCancellationPolicies.kitchenId, kitchenId), eq(kitchenCancellationPolicies.status, 'published'))).orderBy(desc(kitchenCancellationPolicies.version)).limit(1);
  if (!policy) throw Error('This kitchen needs a published cancellation policy before checkout');
  return policy;
}

async function insertKitchenPolicyVersion(tx: Tx, kitchenId: number, actorId: number, noticeHours: number, lateChargePercent: number, reason: string, adminOverrideReason: string | null) {
  const tiers = cancellationTiers(noticeHours, lateChargePercent);
  const [before] = await tx.select().from(kitchenCancellationPolicies).where(eq(kitchenCancellationPolicies.kitchenId, kitchenId)).orderBy(desc(kitchenCancellationPolicies.version)).limit(1);
  const [policy] = await tx.insert(kitchenCancellationPolicies).values({
    kitchenId, version: (before?.version ?? 0) + 1, status: 'published', noticeHours, lateChargePercent, tiers,
    publishedBy: actorId, adminOverrideReason,
  }).returning();
  await tx.insert(cancellationPolicyAudit).values({ kitchenId, actorId, reason, beforeState: before ?? null, afterState: policy });
  return policy;
}

export async function managedCancellationPolicy(kitchenId: number, actorId: number, admin = false) {
  const [row] = await db.select({
    timezone: locations.timezone, managerId: locations.managerId, locationId: locations.id, locationName: locations.name,
    followsLocation: kitchens.cancellationFollowsLocation,
    locationNotice: locations.cancellationNoticeHours, locationCharge: locations.cancellationLateChargePercent,
  }).from(kitchens).innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, kitchenId)).limit(1);
  if (!row || !admin && row.managerId !== actorId) throw Error('Kitchen not found or access denied');
  const policy = await publishedCancellationPolicy(kitchenId);
  return {
    policy, settings: await cancellationSettings(), timezone: row.timezone,
    followsLocation: row.followsLocation && !policy.adminOverrideReason,
    locationDefault: { noticeHours: row.locationNotice, lateChargePercent: row.locationCharge },
    locationId: row.locationId, locationName: row.locationName,
  };
}

export async function managedLocationCancellationPolicy(locationId: number, actorId: number) {
  const [row] = await db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, actorId))).limit(1);
  if (!row) throw Error('Location not found or access denied');
  const kitchenRows = await db.select({
    id: kitchens.id, name: kitchens.name, followsLocation: kitchens.cancellationFollowsLocation,
  }).from(kitchens).where(eq(kitchens.locationId, locationId));
  const following: { id: number; name: string }[] = [];
  const overriding: { id: number; name: string }[] = [];
  for (const kitchen of kitchenRows) {
    const policy = await publishedCancellationPolicy(kitchen.id).catch(() => null);
    if (kitchen.followsLocation && !policy?.adminOverrideReason) following.push({ id: kitchen.id, name: kitchen.name });
    else overriding.push({ id: kitchen.id, name: kitchen.name });
  }
  return {
    noticeHours: row.cancellationNoticeHours, lateChargePercent: row.cancellationLateChargePercent,
    settings: await cancellationSettings(), following, overriding,
  };
}

/** Save the location default and publish a new kitchen policy version for every following kitchen. */
export async function publishLocationCancellationPolicy(locationId: number, actorId: number, input: { noticeHours: number; lateChargePercent: number }) {
  const tiers = cancellationTiers(input.noticeHours, input.lateChargePercent);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, actorId))).for('update');
    if (!row) throw Error('Location not found or access denied');
    const settings = await cancellationSettings(tx);
    if (!settings.noticeOptions.includes(input.noticeHours) || !settings.chargeOptions.includes(input.lateChargePercent)) {
      throw Error('This policy option is unavailable');
    }
    const before = { noticeHours: row.cancellationNoticeHours, lateChargePercent: row.cancellationLateChargePercent };
    await tx.update(locations).set({
      cancellationNoticeHours: input.noticeHours, cancellationLateChargePercent: input.lateChargePercent,
      // Keep legacy hours field aligned for older readers of the location default.
      cancellationPolicyHours: input.noticeHours, updatedAt: new Date(),
    }).where(eq(locations.id, locationId));
    const kitchenRows = await tx.select({ id: kitchens.id, followsLocation: kitchens.cancellationFollowsLocation })
      .from(kitchens).where(eq(kitchens.locationId, locationId)).for('update');
    const published: number[] = [];
    for (const kitchen of kitchenRows) {
      if (!kitchen.followsLocation) continue;
      const [latest] = await tx.select().from(kitchenCancellationPolicies)
        .where(eq(kitchenCancellationPolicies.kitchenId, kitchen.id)).orderBy(desc(kitchenCancellationPolicies.version)).limit(1);
      if (latest?.adminOverrideReason) continue;
      await insertKitchenPolicyVersion(tx, kitchen.id, actorId, input.noticeHours, input.lateChargePercent, 'Location cancellation default', null);
      published.push(kitchen.id);
    }
    await tx.insert(cancellationPolicyAudit).values({
      actorId, reason: 'Location cancellation default', beforeState: before,
      afterState: { noticeHours: input.noticeHours, lateChargePercent: input.lateChargePercent, tiers, updatedKitchens: published },
    });
    return { noticeHours: input.noticeHours, lateChargePercent: input.lateChargePercent, updatedKitchens: published.length };
  });
}

export async function publishCancellationPolicy(kitchenId: number, actorId: number, input: any, admin = false, initialPublication = false) {
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (admin && (!reason || reason.length > 2000)) throw Error('Explain the kitchen override');
  const followLocation = input?.followLocation === true;
  return db.transaction(async tx => {
    // Kitchen row serializes publications, including first publication for a new kitchen.
    const [row] = await tx.select({
      id: kitchens.id, managerId: locations.managerId, locationId: locations.id,
      locationNotice: locations.cancellationNoticeHours, locationCharge: locations.cancellationLateChargePercent,
    }).from(kitchens).innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, kitchenId)).for('update');
    if (!row || !admin && row.managerId !== actorId) throw Error('Kitchen not found or access denied');
    const settings = await cancellationSettings(tx);
    const noticeHours = followLocation ? row.locationNotice : input.noticeHours;
    const lateChargePercent = followLocation ? row.locationCharge : input.lateChargePercent;
    if (!settings.noticeOptions.includes(noticeHours) || !settings.chargeOptions.includes(lateChargePercent)) throw Error('This policy option is unavailable');
    const [before] = await tx.select().from(kitchenCancellationPolicies).where(eq(kitchenCancellationPolicies.kitchenId, kitchenId)).orderBy(desc(kitchenCancellationPolicies.version)).limit(1);
    if (initialPublication && before) throw Error('This kitchen already has a cancellation policy');
    if (before?.adminOverrideReason && !admin) throw Error('Local Cooks set an override for this kitchen. Contact support to change it.');
    // Initial publish and re-follow keep following; a kitchen/admin edit stops following.
    // A first policy that differs from the location default is the kitchen's own choice, so it stops following.
    let follows = followLocation || (initialPublication && noticeHours === row.locationNotice && lateChargePercent === row.locationCharge);
    if (admin && !initialPublication) follows = false;
    await tx.update(kitchens).set({ cancellationFollowsLocation: follows, updatedAt: new Date() }).where(eq(kitchens.id, kitchenId));
    const policy = await insertKitchenPolicyVersion(
      tx, kitchenId, actorId, noticeHours, lateChargePercent,
      admin ? reason : followLocation ? 'Kitchen re-followed location cancellation policy' : initialPublication ? 'Initial kitchen cancellation policy' : 'Kitchen policy published',
      admin && !initialPublication ? reason : null,
    );
    return policy;
  });
}
export function policySessionStart(date: string, time: string, windowStart: string, timezone: string) {
  const instants = matchingLocalInstants(calendarDateForOperatingTime(date.slice(0, 10), time, windowStart), time, timezone);
  if (instants.length !== 1) throw Error('Cancellation policy needs an unambiguous kitchen-local start');
  return new Date(instants[0]).toISOString();
}
/**
 * `disclosureVersion` is the wording the chef's client showed: v3 = consent by selecting Checkout. Clients that predate v3
 * send none and showed the v2 checkbox, so that is what gets recorded for them.
 */
export async function checkoutCancellationSnapshot(kitchenId: number, date: string, startTime: string, windowStart: string, timezone: string, acknowledgement: unknown, policyVersion: unknown, disclosureVersion?: unknown): Promise<CancellationPolicySnapshot> {
  const policy = await publishedCancellationPolicy(kitchenId);
  if (acknowledgement !== true || policyVersion !== policy.version) throw Error('Review and accept the current cancellation policy before payment');
  const disclosure = disclosureVersion == null ? CHECKBOX_DISCLOSURE_VERSION : disclosureVersion;
  if (typeof disclosure !== 'string' || !ACCEPTED_DISCLOSURE_VERSIONS.includes(disclosure)) throw Error('Review and accept the current cancellation policy before payment');
  return { policyId: policy.id, version: policy.version, noticeHours: policy.noticeHours, lateChargePercent: policy.lateChargePercent,
    tiers: cancellationTiers(policy.noticeHours, policy.lateChargePercent), timezone, sessions: [{ startAt: policySessionStart(date, startTime, windowStart, timezone) }],
    disclosureVersion: disclosure, acceptedAt: new Date().toISOString() };
}
/** Scalar metadata values stay well below Stripe's 500-character limit. */
export function cancellationSnapshotMetadata(snapshot: CancellationPolicySnapshot): Record<string, string> {
  return { cancellation_policy_id: String(snapshot.policyId), cancellation_policy_version: String(snapshot.version), cancellation_notice: String(snapshot.noticeHours),
    cancellation_charge: String(snapshot.lateChargePercent), cancellation_timezone: snapshot.timezone, cancellation_start: snapshot.sessions[0].startAt,
    cancellation_disclosure: snapshot.disclosureVersion, cancellation_accepted_at: snapshot.acceptedAt!,
    ...(snapshot.deadlineBasis ? { cancellation_deadline_basis: snapshot.deadlineBasis } : {}) };
}
export function cancellationSnapshotFromMetadata(metadata: Record<string, string>): CancellationPolicySnapshot | null {
  if (!metadata.cancellation_policy_id) return null; // Historical sessions remain fulfillable on their original hours.
  const policyId = Number(metadata.cancellation_policy_id), version = Number(metadata.cancellation_policy_version), noticeHours = Number(metadata.cancellation_notice), lateChargePercent = Number(metadata.cancellation_charge);
  const tiers = cancellationTiers(noticeHours, lateChargePercent);
  if (!Number.isSafeInteger(policyId) || policyId <= 0 || !Number.isSafeInteger(version) || version <= 0 || !metadata.cancellation_timezone
    || !Number.isFinite(Date.parse(metadata.cancellation_start)) || !Number.isFinite(Date.parse(metadata.cancellation_accepted_at)) || !ACCEPTED_DISCLOSURE_VERSIONS.includes(metadata.cancellation_disclosure)) throw Error('Checkout cancellation acceptance needs review');
  new Intl.DateTimeFormat('en-CA', { timeZone: metadata.cancellation_timezone });
  if (metadata.cancellation_deadline_basis && metadata.cancellation_deadline_basis !== 'booking_first_day') throw Error('Checkout deadline basis needs review');
  return { policyId, version, noticeHours, lateChargePercent, tiers, timezone: metadata.cancellation_timezone, sessions: [{ startAt: metadata.cancellation_start }], disclosureVersion: metadata.cancellation_disclosure, acceptedAt: metadata.cancellation_accepted_at,
    ...(metadata.cancellation_deadline_basis ? { deadlineBasis: 'booking_first_day' as const } : {}) };
}
