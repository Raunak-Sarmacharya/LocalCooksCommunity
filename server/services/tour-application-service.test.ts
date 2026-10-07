import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
import { resolveTourApplicationNextStep } from './tour-application-service';

const now = new Date('2026-10-07T18:00:00Z');
const scheduledAt = new Date('2026-10-06T12:00:00Z');
const base = { id: 83, chefId: 8, locationId: 4, targetedKitchenId: 40, status: 'completed', visitResult: 'completed',
  lifecycleState: 'ended', confirmationVerified: true, visitEvidenceMigratedAt: now, visitEvidenceState: 'ready',
  scheduledAt, durationMinutes: 30, appointmentRevision: 1, checkedInAt: null, checkedOutAt: null, requestExpiredAt: null,
  sharedManagerNotes: 'Freezer arrangements discussed', chefNotes: 'Bring baking trays', managerNotes: 'PRIVATE STAFF NOTES',
  intakeData: { intendedUse: 'Catering meals', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: 'not_decided', additionalInfo: 'Storage' } };
let rows: Record<string, any[]>;
const result = () => ({ id: 1, viewingId: 83, kind: 'result', supersedesId: null, actorId: 2, actorRole: 'manager',
  source: 'decision', actualAt: null, recordedAt: new Date('2026-10-06T13:00:00Z'), scheduledAt,
  appointmentRevision: 1, result: 'completed', sharedExplanation: null, internalNotes: 'PRIVATE EVIDENCE', data: {} });
const connection: any = { select: () => {
  let table = '';
  const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
    where: () => chain, limit: () => chain, orderBy: () => chain, then: (resolve: any) => resolve(rows[table] || []) };
  return chain;
} };
const resolve = (patch = {}) => resolveTourApplicationNextStep(connection, { ...base, ...patch } as any, { id: 8 }, now);

describe('authorized current completion application next step', () => {
  beforeEach(() => { rows = {
    users: [{ role: 'chef' }], tour_visit_events: [result()],
    locations: [{ id: 4, isActive: true, kitchenLicenseUrl: '/license.pdf', kitchenLicenseStatus: 'approved', kitchenLicenseExpiry: '2027-01-01' }],
    kitchens: [{ id: 40, locationId: 4, isActive: true, listingStatus: 'active' }],
  }; });
  it('offers the exact toured kitchen and editable intended use with other answers as reference', async () => {
    expect(await resolve()).toEqual({ action: 'apply', outcomeVerified: true, applicationId: null, sourceTourId: 83, locationId: 4, kitchenId: 40,
      href: '/apply-kitchen/4?tourId=83&kitchenId=40', prefill: {
        intendedUse: 'Catering meals', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: 'not_decided',
        chefNotes: 'Bring baking trays', sharedManagerNotes: 'Freezer arrangements discussed', additionalInfo: 'Storage' } });
    expect(JSON.stringify(await resolve())).not.toContain('PRIVATE');
  });
  it('allows applying after scheduled end pending admin review without claiming completion', async () => {
    rows.tour_visit_events = [];
    expect(await resolve({ status: 'confirmed', lifecycleState: 'confirmed', visitResult: null }))
      .toMatchObject({ action: 'apply', outcomeVerified: false, sourceTourId: 83 });
    expect((await resolve({ status: 'confirmed', lifecycleState: 'confirmed', visitResult: null, scheduledAt: now })).action).toBe('unavailable');
    expect((await resolve({ status: 'cancelled', disruptionReason: 'outcome_unknown', visitResult: 'unrecorded' })).action).toBe('unavailable');
  });
  it.each([
    { status: 'confirmed', lifecycleState: 'confirmed', visitResult: null },
    { status: 'cancelled' }, { status: 'no_show', visitResult: 'visitor_absent' },
    { visitEvidenceState: 'review' }, { visitEvidenceMigratedAt: null }, { confirmationVerified: false },
    { disruptionReason: 'weather' }, { requestExpiredAt: scheduledAt }, { lifecycleState: 'closed' },
    { chefId: 9 }, { checkedInAt: scheduledAt },
  ])('does not turn elapsed time, corrected results or uncertain facts into eligibility: %j', async patch => {
    expect((await resolve(patch)).action).toBe('unavailable');
  });
  it.each(['manager', 'admin', null])('rechecks current role %s', async role => {
    rows.users = [{ role }]; expect((await resolve()).action).toBe('unavailable');
  });
  it.each(['missing', 'future', 'different_schedule', 'different_revision'])('rejects invalid result evidence: %s', async issue => {
    if (issue === 'missing') rows.tour_visit_events = [];
    if (issue === 'future') rows.tour_visit_events[0].recordedAt = new Date('2026-10-08T12:00:00Z');
    if (issue === 'different_schedule') rows.tour_visit_events[0].scheduledAt = now;
    if (issue === 'different_revision') rows.tour_visit_events[0].appointmentRevision = 2;
    expect((await resolve()).action).toBe('unavailable');
  });
  it.each(['hidden_location', 'hidden_kitchen', 'draft', 'expired_license', 'no_kitchen'])('rechecks unavailable kitchen: %s', async issue => {
    if (issue === 'hidden_location') rows.locations[0].isActive = false;
    if (issue === 'hidden_kitchen') rows.kitchens[0].isActive = false;
    if (issue === 'draft') rows.kitchens[0].listingStatus = 'draft';
    if (issue === 'expired_license') rows.locations[0].kitchenLicenseExpiry = '2025-01-01';
    if (issue === 'no_kitchen') rows.kitchens = [];
    expect((await resolve()).action).toBe('unavailable');
  });
  it.each([
    ['inReview', 1, null, 'view'], ['approved', 1, null, 'continue'], ['approved', 3, now, 'view'],
    ['rejected', 1, null, 'continue'], ['cancelled', 1, null, 'continue'], ['inReview', 2, null, 'continue'],
  ])('resolves existing %s tier %i application without duplicating', async (status, current_tier, tier2_completed_at, action) => {
    rows.chef_kitchen_applications = [{ id: 100, status, current_tier, tier2_completed_at }];
    expect(await resolve()).toMatchObject({ action, applicationId: 100, href: '/apply-kitchen/4?tourId=83&kitchenId=40' });
  });
  it('shows existing access without inviting another application', async () => {
    rows.chef_location_access = [{ id: 5 }]; expect(await resolve()).toMatchObject({ action: 'view', applicationId: null });
  });
  it('keeps completion eligible through an explained result correction without inventing arrival', async () => {
    rows.tour_visit_events.push({ ...result(), id: 2, supersedesId: 1, sharedExplanation: 'Corrected shared result details' });
    expect((await resolve()).action).toBe('apply');
  });
});
