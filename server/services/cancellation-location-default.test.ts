import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Migration 0101 + service contracts for location cancellation defaults.
 * Fan-out / override / re-follow behaviour is covered with the publish helpers' unit contracts below
 * and integration-style assertions in cancellation-policy-settings.test.ts for snapshot metadata.
 */
describe('0101 location cancellation + tax migration', () => {
  const sql = readFileSync(new URL('../../migrations/0101_location_level_tax_and_cancellation.sql', import.meta.url), 'utf8');

  it('adds location tax, cancellation default columns, and follows-location flag without touching the snapshot trigger', () => {
    expect(sql).toContain('locations ADD COLUMN IF NOT EXISTS tax_rate_percent');
    expect(sql).toContain('cancellation_notice_hours');
    expect(sql).toContain('cancellation_late_charge_percent');
    expect(sql).toContain('cancellation_follows_location');
    expect(sql).toContain('COUNT(DISTINCT k.tax_rate_percent) = 1');
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION snapshot_kitchen_booking_policy/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION protect_booking_cancellation_snapshot/);
  });
});

describe('cancellation follow contracts', () => {
  it('documents the publishCancellationPolicy follow rules used by manager and admin routes', async () => {
    const source = readFileSync(new URL('./cancellation-policy-settings.ts', import.meta.url), 'utf8');
    expect(source).toContain('followLocation');
    expect(source).toContain('cancellationFollowsLocation');
    expect(source).toContain('publishLocationCancellationPolicy');
    expect(source).toContain('insertKitchenPolicyVersion');
    // Admin override never follows; re-follow does.
    expect(source).toMatch(/if \(admin && !initialPublication\) follows = false/);
    // A first policy only follows when it matches the location default (covered in the PGlite fan-out test).
    expect(source).toMatch(/let follows = followLocation \|\| \(initialPublication && noticeHours === row\.locationNotice/);
  });
});
