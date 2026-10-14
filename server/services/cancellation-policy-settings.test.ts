import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ policy: { id: 5, version: 2, noticeHours: 48, lateChargePercent: 50 } as any }));
vi.mock('../db', () => ({ db: { select: () => { const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => state.policy ? [state.policy] : [] }; return chain; } } }));
import { cancellationSnapshotFromMetadata, cancellationSnapshotMetadata, policySessionStart, validateCancellationSettings, checkoutCancellationSnapshot } from './cancellation-policy-settings';
import { cancellationTiers, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
it('freezes an accepted policy in size-safe metadata and never re-reads live settings', () => {
  const snapshot: CancellationPolicySnapshot = { policyId: 5, version: 2, noticeHours: 48, lateChargePercent: 50, tiers: cancellationTiers(48, 50),
    timezone: 'America/St_Johns', sessions: [{ startAt: '2026-10-30T12:00:00Z' }], disclosureVersion: 'food-corridor-v1', acceptedAt: '2026-10-14T12:00:00Z' };
  const metadata = cancellationSnapshotMetadata(snapshot);
  expect(Object.values(metadata).every(value => value.length <= 500)).toBe(true);
  expect(cancellationSnapshotFromMetadata(metadata)).toEqual(snapshot);
  expect(cancellationSnapshotFromMetadata({ cancellation_policy_hours: '48' })).toBeNull();
  expect(() => cancellationSnapshotFromMetadata({ ...metadata, cancellation_charge: '75' })).toThrow();
  expect(() => cancellationSnapshotFromMetadata({ ...metadata, cancellation_accepted_at: '' })).toThrow();
});
it('validates allowed choices and platform default as one audited settings change', () => {
  expect(validateCancellationSettings({ noticeOptions: [24, 48], chargeOptions: [50, 100], default: { notice: 24, charge: 100 } }).default).toEqual({ notice: 24, charge: 100 });
  for (const value of [{ noticeOptions: [], chargeOptions: [100], default: { notice: 24, charge: 100 } }, { noticeOptions: [24], chargeOptions: [75], default: { notice: 24, charge: 75 } }, { noticeOptions: [24], chargeOptions: [100], default: { notice: 72, charge: 100 } }]) expect(() => validateCancellationSettings(value)).toThrow();
});
it('resolves kitchen-local operating dates and refuses ambiguous DST starts', () => {
  expect(policySessionStart('2026-10-30', '09:00', '08:00', 'America/St_Johns')).toBe('2026-10-30T11:30:00.000Z');
  expect(policySessionStart('2026-10-30', '01:00', '20:00', 'America/St_Johns')).toBe('2026-10-31T03:30:00.000Z');
  expect(() => policySessionStart('2026-11-01', '01:30', '00:00', 'America/St_Johns')).toThrow();
});
it('requires acknowledgement of the current published version before authorizing checkout', async () => {
  await expect(checkoutCancellationSnapshot(4, '2026-10-30', '09:00', '08:00', 'America/St_Johns', false, 2)).rejects.toThrow('accept');
  await expect(checkoutCancellationSnapshot(4, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, 1)).rejects.toThrow('current');
  expect(await checkoutCancellationSnapshot(4, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, 2)).toMatchObject({ policyId: 5, version: 2, noticeHours: 48, lateChargePercent: 50 });
  state.policy = null;
  await expect(checkoutCancellationSnapshot(4, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, 2)).rejects.toThrow('published');
});
