import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { kitchenBookings, kitchenBookingVisits, kitchenVisitArrivalChallenges, kitchens, locations } from '@shared/schema';
import { makeCloseoutSnapshot, reduceClockCloseout } from '@shared/clock-closeout';
import { payoutEligibility } from '@shared/kitchen-payout';
import { visitAttendanceEnd } from '@shared/booking-attendance';
import { previousVisitTaskAnswers, validateDutySection } from '@shared/visit-duties';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_, key) => state.db[key] }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: vi.fn() }));
import { ensureKitchenBookingVisits, type DatedVisitDay } from './kitchen-booking-visits';
import { ensureChallengesForBooking, getManagerVisitCodes, revokeForVisit, setMode, verifyArrivalCode, gateArrivalInTx } from './visit-code-challenge';
import { bookingInstructionRelease } from './visit-duties';
const timing = { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 };
const day = (date: string, anchor = '08:00'): DatedVisitDay => ({ date, pricingMode: 'hourly', operatingWindowStartTime: anchor,
  selectedSlots: [{ startTime: '01:00', endTime: '02:00' }], priceSnapshot: { subtotalCents: 1000 } });
let client: Awaited<ReturnType<typeof createTestDatabase>>['client'];
let booking: typeof kitchenBookings.$inferSelect;
beforeEach(async () => {
  vi.stubEnv('VISIT_CODE_HMAC_SECRET', 'test-secret-test-secret-test-secret-123456789');
  // PGlite schema generation omits migration triggers/indexes. Exercise the real 0043 body with 0099's WHEN guard.
  const migration = readFileSync('migrations/0043_kitchen_booking_visits.sql', 'utf8');
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'), migration.indexOf('DROP TRIGGER'));
  const result = await createTestDatabase([kitchenBookings, kitchenBookingVisits, kitchenVisitArrivalChallenges, kitchens, locations], [
    'CREATE UNIQUE INDEX visits_block ON kitchen_booking_visits (booking_id, block_index)',
    'CREATE UNIQUE INDEX visits_day ON kitchen_booking_visits (booking_id, schedule_revision, visit_date)',
    'CREATE UNIQUE INDEX challenge_target ON kitchen_visit_arrival_challenges (target_key)', body,
    `CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings FOR EACH ROW WHEN (NEW.schedule_revision = 0) EXECUTE FUNCTION create_kitchen_booking_visits()`,
  ]);
  client = result.client; state.db = result.db;
  await state.db.insert(locations).values({ id: 1, name: 'Test', address: 'Test street', managerId: 2, timezone: 'UTC' });
  await state.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Kitchen' });
  [booking] = await state.db.insert(kitchenBookings).values({ kitchenId: 1, chefId: 3, scheduleRevision: 1,
    bookingDate: new Date('2026-10-20'), startTime: '01:00', endTime: '02:00', status: 'confirmed',
    selectedSlots: [{ date: '2026-10-20', startTime: '01:00', endTime: '02:00' }, { date: '2026-10-23', startTime: '01:00', endTime: '02:00' }] }).returning();
});
afterEach(async () => { await client.close(); vi.unstubAllEnvs(); });
async function build() { return ensureKitchenBookingVisits(booking.id, undefined, [day('2026-10-20'), day('2026-10-23', '00:00')]); }
describe('CP2 dated visits, isolated PGlite', () => {
  it('bypasses the date-blind legacy trigger and creates one row per date with independent overnight anchors', async () => {
    expect(await state.db.select().from(kitchenBookingVisits)).toEqual([]);
    const visits = await build();
    expect(visits.map(v => [v.visitDate, v.blockIndex, v.pricingMode, v.priceSnapshot])).toEqual([
      ['2026-10-20', 0, 'hourly', { subtotalCents: 1000 }], ['2026-10-23', 1, 'hourly', { subtotalCents: 1000 }]]);
    const saved = makeCloseoutSnapshot(booking, 'UTC', timing, visits);
    expect(saved.visits.map(v => v.scheduledStartAt)).toEqual(['2026-10-21T01:00:00.000Z', '2026-10-23T01:00:00.000Z']);
    expect(new Set(saved.visits.map(v => v.key)).size).toBe(2);
    expect(reduceClockCloseout(booking, visits, saved, new Date('2026-10-21T03:00Z')).status).toBe('confirmed');
    expect(reduceClockCloseout(booking, visits, saved, new Date('2026-10-23T03:00Z')).status).toBe('completed');
    expect(visitAttendanceEnd({ ...booking, visitDuties: { clockCloseout: saved } }, visits[1]).toISOString()).toBe('2026-10-23T02:00:00.000Z');
  });
  it('keeps old URL ids stable on retries and never recycles block indexes across revisions', async () => {
    const original = await build();
    expect((await ensureKitchenBookingVisits(booking.id)).map(v => v.id)).toEqual(original.map(v => v.id));
    await state.db.update(kitchenBookingVisits).set({ scheduleState: 'superseded' });
    await state.db.update(kitchenBookings).set({ scheduleRevision: 2 }).where(eq(kitchenBookings.id, booking.id));
    const next = await ensureKitchenBookingVisits(booking.id, undefined, [day('2026-10-24')]);
    expect(next[0].blockIndex).toBe(2);
    expect(next[0].id).not.toBe(original[0].id);
    expect(await state.db.select().from(kitchenBookingVisits)).toHaveLength(3);
  });
  it('excludes cancelled/superseded days from attendance, inspections and the final completion timer', async () => {
    const visits = await build();
    const saved = makeCloseoutSnapshot(booking, 'UTC', timing, visits);
    visits[1].scheduleState = 'cancelled';
    const projection = reduceClockCloseout(booking, visits, saved, new Date('2026-10-21T03:00Z'));
    expect(projection.status).toBe('completed'); expect(projection.visits.map(v => v.visitId)).toEqual([visits[0].id]);
    expect(projection.visits[0].inspection.deadline).toBe('2026-10-22T02:00:00.000Z');
    expect(payoutEligibility(booking.status, projection, { openIssue: false, openFlag: false, resolvedIssue: false, supportReleased: false }).expectedAt).toBe('2026-10-22T02:00:00.000Z');
    visits[0].checkinStatus = 'no_show';
    visits[1].scheduleState = 'active'; visits[1].checkedInAt = new Date('2026-10-23T01:00Z');
    const second = reduceClockCloseout(booking, visits, saved, new Date('2026-10-23T01:30Z'));
    expect(second.visits.map(v => v.attendance)).toEqual(['no_show', 'recorded']);
    visits.forEach(visit => { visit.scheduleState = 'cancelled'; });
    expect(reduceClockCloseout(booking, visits, saved, new Date('2026-10-23T01:30Z'))).toMatchObject({ visits: [], nextDueAt: null });
  });
  it('releases shared details 48 hours before the first actual start and keeps them visible between nonadjacent days', async () => {
    const visits = await build();
    booking.visitDuties = { clockCloseout: makeCloseoutSnapshot(booking, 'UTC', timing, visits) };
    expect(bookingInstructionRelease(booking, 'UTC', visits, 1, 15, new Date('2026-10-19T00:59Z')).instructionsReleased).toBe(false);
    expect(bookingInstructionRelease(booking, 'UTC', visits, 1, 15, new Date('2026-10-19T01:00Z')).instructionsReleased).toBe(true);
    visits[0].checkinStatus = 'checked_out';
    const gap = bookingInstructionRelease(booking, 'UTC', visits, 1, 15, new Date('2026-10-22T03:00Z'));
    expect(gap.instructionsReleased).toBe(true); expect(gap.visits.map(v => v.instructionsReleased)).toEqual([true, true]);
  });
  it('leaves legacy split blocks and legacy contiguous bookings unchanged', async () => {
    const [legacy] = await state.db.insert(kitchenBookings).values({ kitchenId: 1, bookingDate: new Date('2026-10-20'), startTime: '09:00', endTime: '12:00',
      selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }] }).returning();
    expect((await ensureKitchenBookingVisits(legacy.id)).map(v => [v.blockIndex, v.visitDate])).toEqual([[0, null], [1, null]]);
    const [single] = await state.db.insert(kitchenBookings).values({ kitchenId: 1, bookingDate: new Date('2026-10-20'), startTime: '09:00', endTime: '10:00' }).returning();
    expect(await ensureKitchenBookingVisits(single.id)).toEqual([]);
  });
  it('enrolls one code per day, changes all to self in one action, and revokes only the chosen day', async () => {
    const visits = await build();
    await state.db.transaction((tx: any) => ensureChallengesForBooking(tx, booking.id, 2));
    const staffed = await getManagerVisitCodes(booking.id, 2);
    expect(staffed).toHaveLength(2); expect(staffed.every(code => /^\d{6}$/.test(code.code!))).toBe(true);
    await state.db.update(kitchenVisitArrivalChallenges).set({ failedAttempts: 5, lockedAt: new Date() }).where(eq(kitchenVisitArrivalChallenges.visitId, visits[0].id));
    await expect(verifyArrivalCode({ bookingId: booking.id, visitId: visits[0].id, chefId: 3, visitCode: staffed[0].code })).rejects.toThrow(/Too many/);
    expect((await verifyArrivalCode({ bookingId: booking.id, visitId: visits[1].id, chefId: 3, visitCode: staffed[1].code })).kind).toBe('ok');
    const self = await setMode(booking.id, 2, { all: true, mode: 'self', reason: 'Staff arranged self check-in for each day' });
    expect(self.map(v => v.mode)).toEqual(['self', 'self']);
    await state.db.transaction((tx: any) => revokeForVisit(tx, booking.id, visits[0].id, 'day cancelled'));
    const codes = await getManagerVisitCodes(booking.id, 2);
    expect(codes.map(v => v.revoked)).toEqual([true, false]);
    await state.db.update(kitchenBookingVisits).set({ scheduleState: 'cancelled' }).where(eq(kitchenBookingVisits.id, visits[0].id));
    expect((await getManagerVisitCodes(booking.id, 2)).map(v => v.visitId)).toEqual([visits[1].id]);
    await expect(state.db.transaction((tx: any) => gateArrivalInTx(tx, { bookingId: booking.id, visitId: visits[0].id, chefId: 3 }))).rejects.toThrow(/no longer valid/);
    await expect(setMode(booking.id, 2, { targetKey: `visit:${visits[0].id}`, mode: 'staffed' })).rejects.toThrow(/target not found/);
  });
  it('rolls back the whole build when a date has separated hours', async () => {
    await expect(ensureKitchenBookingVisits(booking.id, undefined, [day('2026-10-20'), { ...day('2026-10-23'), selectedSlots: [
      { startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }] }])).rejects.toThrow(/contiguous/);
    expect(await state.db.select().from(kitchenBookingVisits)).toEqual([]);
  });
});

it('copies only matching task choices; daily photos and submission remain required', () => {
  expect(previousVisitTaskAnswers([{ id: 'clean' }, { id: 'new' }], [{ id: 'clean', checked: true }, { id: 'removed', checked: true }])).toEqual(['clean']);
  expect(validateDutySection({ enabled: true, instructions: null, items: [{ id: 'clean', label: 'Clean' }], photos: [{ id: 'p', label: 'Fresh photo' }] }, [], [{ id: 'clean', checked: true }]).valid).toBe(false);
});
