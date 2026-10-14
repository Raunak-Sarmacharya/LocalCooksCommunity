import { describe, expect, it } from 'vitest';
import { validExtensionMinutes, extraTimeQuote, extensionDeadline, extensionPrice, sessionExtensionOptions, extendedSessionSnapshot, appendExtensionSlot, inExtensionWindow, extraTimeChargeOpen, earlyStartOptions, billedMinutes, defaultFree, inEarlyStartWindow, earlierSessionSnapshot, prependEarlySlot } from './session-extension';
import { absoluteOperatingSlotInterval } from './operating-hours';
const ratios = { subtotalCents: 10000, taxCents: 1500, commissionCents: 500 };
const input = { operatingDate: '2026-10-14', windowStartTime: '08:00', windowEndTime: '20:00', endTime: '16:00', endAt: '2026-10-14T18:30:00Z', timezone: 'America/St_Johns', durationMinutes: 120, maxMinutes: null, occupied: [], hourlyRateCents: 2500, ratios };
describe('session extensions', () => {
  it('prices integer cents with the original tax and service fee', () => {
    expect(extensionPrice(60, 2500, ratios)).toEqual({ subtotalCents: 2500, taxCents: 375, commissionCents: 125, amountCents: 3000, kitchenGrossCents: 2875 });
    expect(extensionPrice(30, 2500, { ...ratios, commissionCents: 0 }).amountCents).toBe(1438);
  });
  it('offers every free end in 15-minute steps up to closing (quick picks included) and allows abutting bookings', () => {
    // 16:00 end, closing 20:00: 15 … 240 minutes.
    expect(sessionExtensionOptions(input).map(o => o.minutes)).toEqual(Array.from({ length: 16 }, (_, i) => (i + 1) * 15));
    const occupied = [absoluteOperatingSlotInterval(input.operatingDate, { startTime: '17:00', endTime: '18:00' }, '08:00')];
    // Boundary at the next booking: up to 17:00 exactly, never past it.
    expect(sessionExtensionOptions({ ...input, occupied }).map(o => o.minutes)).toEqual([15, 30, 45, 60]);
    expect(sessionExtensionOptions({ ...input, occupied }).at(-1)).toMatchObject({ endTime: '17:00', endAt: '2026-10-14T19:30:00.000Z' });
  });
  it('prices custom lengths in 30-minute blocks', () => {
    const options = sessionExtensionOptions(input);
    const byMinutes = (minutes: number) => options.find(o => o.minutes === minutes)!;
    expect(byMinutes(15).amountCents).toBe(byMinutes(30).amountCents);
    expect(byMinutes(45).amountCents).toBe(byMinutes(60).amountCents);
    expect(byMinutes(60)).toMatchObject({ endTime: '17:00', amountCents: 3000, kitchenGrossCents: 2875 });
    expect(byMinutes(75).amountCents).toBe(extensionPrice(90, 2500, ratios).amountCents);
    expect([validExtensionMinutes(15), validExtensionMinutes(45), validExtensionMinutes(20), validExtensionMinutes(0), validExtensionMinutes(-15), validExtensionMinutes(7.5)])
      .toEqual([true, true, false, false, false, false]);
  });
  it('limits by blackout, operating hours and maximum booking duration', () => {
    expect(sessionExtensionOptions({ ...input, occupied: [absoluteOperatingSlotInterval(input.operatingDate, { startTime: '16:10', endTime: '18:00' }, '08:00')] })).toEqual([]);
    expect(sessionExtensionOptions({ ...input, occupied: [absoluteOperatingSlotInterval(input.operatingDate, { startTime: '16:15', endTime: '18:00' }, '08:00')] }).map(o => o.minutes)).toEqual([15]);
    expect(sessionExtensionOptions({ ...input, windowEndTime: '16:30' }).map(o => o.minutes)).toEqual([15, 30]);
    expect(sessionExtensionOptions({ ...input, maxMinutes: 180 }).map(o => o.minutes)).toEqual([15, 30, 45, 60]);
  });
  it('handles overnight windows', () => {
    const options = sessionExtensionOptions({ ...input, windowStartTime: '20:00', windowEndTime: '03:00', endTime: '00:00', endAt: '2026-10-15T02:30:00Z' });
    expect(options.find(o => o.minutes === 30)!.endAt).toBe('2026-10-15T03:00:00.000Z');
    expect(options.at(-1)).toMatchObject({ minutes: 180, endTime: '03:00' });
  });
  it('rejects nonexistent and ambiguous DST times and elapsed/wall-clock mismatch', () => {
    // 02:00 does not exist on 2026-03-08: the list stops at 01:45.
    expect(sessionExtensionOptions({ ...input, operatingDate: '2026-03-08', windowStartTime: '00:00', windowEndTime: '04:00', endTime: '01:00', endAt: '2026-03-08T04:30:00Z' }).map(o => o.minutes)).toEqual([15, 30, 45]);
    // 01:00–02:00 repeats on 2026-11-01: the list stops at 00:45, before the ambiguous hour.
    expect(sessionExtensionOptions({ ...input, operatingDate: '2026-11-01', windowStartTime: '00:00', windowEndTime: '04:00', endTime: '00:30', endAt: '2026-11-01T03:00:00Z' }).map(o => o.minutes)).toEqual([15]);
  });
  it('rounds actual overstay up to 30-minute blocks and only permits a lower amount', () => {
    expect(extraTimeQuote(input.endAt, '2026-10-14T19:10:00Z', 2500, ratios)).toMatchObject({ actualMinutes: 40, minutes: 60, amountCents: 3000 });
    expect(extraTimeQuote(input.endAt, '2026-10-14T19:10:00Z', 2500, ratios, 1438)).toMatchObject({ minutes: 60, amountCents: 1438 });
    expect(() => extraTimeQuote(input.endAt, '2026-10-14T19:10:00Z', 2500, ratios, 3001)).toThrow(/never raise/);
    expect(() => extraTimeQuote(input.endAt, input.endAt, 2500, ratios)).toThrow();
    expect(() => extensionPrice(30, 1.1, ratios)).toThrow();
  });
  it('bounds request/offer expiry by the booking end and escalates charges after 48 hours', () => {
    const now = new Date('2026-10-14T18:20:00Z');
    expect(extensionDeadline('request', now, input.endAt).toISOString()).toBe('2026-10-14T18:30:00.000Z');
    expect(extensionDeadline('offer', now, input.endAt).toISOString()).toBe('2026-10-14T18:30:00.000Z');
    expect(extensionDeadline('extra_time', now, input.endAt).getTime() - now.getTime()).toBe(48 * 3600_000);
  });
  it('propagates the saved clock and keeps the visit identity', () => {
    const snapshot = { version: 1 as const, timezone: input.timezone, serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30,
      visits: [{ key: 'stable', blockIndex: 0, startTime: '14:00', endTime: '16:00', scheduledStartAt: '2026-10-14T16:30:00Z', scheduledEndAt: input.endAt }] };
    expect(extendedSessionSnapshot(snapshot, 0, '17:00', '2026-10-14T19:30:00Z').visits[0]).toMatchObject({ key: 'stable', endTime: '17:00', scheduledEndAt: '2026-10-14T19:30:00Z' });
    expect(() => extendedSessionSnapshot(snapshot, 0, '15:00', '2026-10-14T17:30:00Z')).toThrow(/later end/);
    expect(() => extendedSessionSnapshot(snapshot, 3, '17:00', '2026-10-14T19:30:00Z')).toThrow();
  });
  it('appends the extra slot on the same operating date', () => {
    expect(appendExtensionSlot([{ startTime: '14:00', endTime: '16:00', date: '2026-10-15' }], '16:00', '16:30'))
      .toEqual([{ startTime: '14:00', endTime: '16:00', date: '2026-10-15' }, { startTime: '16:00', endTime: '16:30', date: '2026-10-15' }]);
    expect(appendExtensionSlot([{ startTime: '14:00', endTime: '16:00' }], '16:00', '17:00')[1]).toEqual({ startTime: '16:00', endTime: '17:00' });
  });
  it('opens requests in the final hour and extra-time charges for 24 hours after an overstay', () => {
    expect(inExtensionWindow(new Date('2026-10-14T17:29:00Z'), input.endAt)).toBe(false);
    expect(inExtensionWindow(new Date('2026-10-14T17:30:00Z'), input.endAt)).toBe(true);
    expect(inExtensionWindow(new Date(input.endAt), input.endAt)).toBe(false);
    expect(extraTimeChargeOpen(new Date('2026-10-14T20:00:00Z'), '2026-10-14T19:10:00Z', input.endAt)).toBe(true);
    expect(extraTimeChargeOpen(new Date('2026-10-15T19:11:00Z'), '2026-10-14T19:10:00Z', input.endAt)).toBe(false);
    expect(extraTimeChargeOpen(new Date('2026-10-14T20:00:00Z'), '2026-10-14T18:20:00Z', input.endAt)).toBe(false);
    expect(extraTimeChargeOpen(new Date('2026-10-14T20:00:00Z'), null, input.endAt)).toBe(false);
  });
  describe('early starts', () => {
    // 14:00 Newfoundland Daylight Time = 16:30Z.
    const early = { operatingDate: '2026-10-14', windowStartTime: '08:00', startTime: '14:00', startAt: '2026-10-14T16:30:00Z', timezone: 'America/St_Johns',
      durationMinutes: 120, maxMinutes: null, occupied: [] as Array<{ start: number; end: number }>, hourlyRateCents: 2500, ratios };
    it('offers 15-minute steps up to 2 hours, each priced in 30-minute blocks; free is only preselected up to 30 minutes', () => {
      const options = earlyStartOptions(early);
      expect(options.map(o => o.minutes)).toEqual([15, 30, 45, 60, 75, 90, 105, 120]);
      expect(options[1]).toMatchObject({ minutes: 30, startTime: '13:30', startAt: '2026-10-14T16:00:00.000Z', defaultFree: true, billedMinutes: 30, amountCents: 1501 });
      expect(options[2]).toMatchObject({ minutes: 45, startTime: '13:15', defaultFree: false, billedMinutes: 60, amountCents: 3000 });
      expect([defaultFree(30), defaultFree(31), defaultFree(45)]).toEqual([true, false, false]);
      expect([billedMinutes(15), billedMinutes(30), billedMinutes(31), billedMinutes(61)]).toEqual([30, 30, 60, 90]);
    });
    it('stops at the previous booking, a blackout, the kitchen opening and the maximum hours', () => {
      const previous = absoluteOperatingSlotInterval(early.operatingDate, { startTime: '12:00', endTime: '13:15' }, '08:00');
      expect(earlyStartOptions({ ...early, occupied: [previous] }).map(o => o.minutes)).toEqual([15, 30, 45]);
      const overlapping = absoluteOperatingSlotInterval(early.operatingDate, { startTime: '13:00', endTime: '13:50' }, '08:00');
      expect(earlyStartOptions({ ...early, occupied: [overlapping] })).toEqual([]);
      expect(earlyStartOptions({ ...early, windowStartTime: '13:00', startAt: early.startAt }).map(o => o.minutes)).toEqual([15, 30, 45, 60]);
      expect(earlyStartOptions({ ...early, maxMinutes: 180 }).map(o => o.minutes)).toEqual([15, 30, 45, 60]);
    });
    it('never offers a start in the past: steps from now (rounded up to 15 minutes), with "Start now" first', () => {
      // Booked start 14:00 NDT (16:30Z); it is 13:13 NDT (15:43Z): 13:15, 13:30, 13:45 are offered, and "Start now" is 13:00.
      const options = earlyStartOptions({ ...early, now: new Date('2026-10-14T15:43:00Z') });
      expect(options.map(o => [o.startTime, o.startNow])).toEqual([['13:00', true], ['13:45', false], ['13:30', false], ['13:15', false]]);
      expect(options.some(o => Date.parse(o.startAt) + 15 * 60_000 <= Date.parse('2026-10-14T15:43:00Z'))).toBe(false);
      // Exactly on a step: that step is "Start now"; nothing earlier.
      expect(earlyStartOptions({ ...early, now: new Date('2026-10-14T16:00:00Z') }).map(o => [o.startTime, o.startNow])).toEqual([['13:30', true], ['13:45', false]]);
      // 10 minutes before the start: only "Start now" (13:45).
      expect(earlyStartOptions({ ...early, now: new Date('2026-10-14T16:20:00Z') }).map(o => [o.startTime, o.startNow])).toEqual([['13:45', true]]);
    });
    it('opens the manager control 2 hours before the start until the start', () => {
      expect(inEarlyStartWindow(new Date('2026-10-14T14:29:00Z'), early.startAt)).toBe(false);
      expect(inEarlyStartWindow(new Date('2026-10-14T14:30:00Z'), early.startAt)).toBe(true);
      expect(inEarlyStartWindow(new Date(early.startAt), early.startAt)).toBe(false);
    });
    it('moves the saved start and prepends the paid slot', () => {
      const snapshot = { version: 1 as const, timezone: early.timezone, serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30,
        visits: [{ key: 'stable', blockIndex: 0, startTime: '14:00', endTime: '16:00', scheduledStartAt: early.startAt, scheduledEndAt: '2026-10-14T18:30:00Z' }] };
      expect(earlierSessionSnapshot(snapshot, 0, '13:00', '2026-10-14T15:30:00Z').visits[0]).toMatchObject({ key: 'stable', startTime: '13:00', scheduledStartAt: '2026-10-14T15:30:00Z', endTime: '16:00' });
      expect(() => earlierSessionSnapshot(snapshot, 0, '14:30', '2026-10-14T17:00:00Z')).toThrow();
      expect(prependEarlySlot([{ startTime: '14:00', endTime: '16:00', date: '2026-10-14' }], '13:00', '14:00')[0]).toEqual({ startTime: '13:00', endTime: '14:00', date: '2026-10-14' });
    });
  });
});
