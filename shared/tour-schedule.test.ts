import { describe, expect, it } from "vitest";
import { blackoutDateKeys, bookingClosuresForTours, copyableTourHours, tourWindowsForDate } from "./tour-schedule";

describe("tour blackout date ranges", () => {
  it("includes every date across a leap-day closure", () => {
    expect(blackoutDateKeys("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
  });
  it("rejects invalid or unbounded ranges", () => {
    expect(blackoutDateKeys("2027-02-29", "2027-03-01")).toEqual([]);
    expect(blackoutDateKeys("2028-03-02", "2028-03-01")).toEqual([]);
    expect(blackoutDateKeys("2028-01-01", "2030-01-01")).toEqual([]);
  });
});

describe("copyable tour hours", () => {
  it("copies only active booking windows long enough for duration and buffers", () => {
    const hours = [
      { dayOfWeek: 1, startTime: "09:00", endTime: "09:44", isAvailable: true },
      { dayOfWeek: 2, startTime: "09:00", endTime: "09:45", isAvailable: true },
      { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isAvailable: false },
      { dayOfWeek: 4, startTime: "17:00", endTime: "09:00", isAvailable: true },
    ];
    expect(copyableTourHours(hours, 30, 0, 15)).toEqual([
      { dayOfWeek: 2, startTime: "09:00", endTime: "09:45", isAvailable: true },
      { dayOfWeek: 4, startTime: "17:00", endTime: "09:00", isAvailable: true },
    ]);
  });
});

describe('overnight tour windows', () => {
  const saturday = [{ dayOfWeek: 6, startTime: '23:00', endTime: '01:00', isAvailable: true }];
  it('retains the Saturday window and exposes its Sunday tail on Sunday', () => {
    const expected = [{ start: new Date('2026-10-04T01:30:00Z'), end: new Date('2026-10-04T03:30:00Z') }];
    expect(tourWindowsForDate(saturday, '2026-10-03', 'America/St_Johns')).toEqual(expected);
    expect(tourWindowsForDate(saturday, '2026-10-04', 'America/St_Johns')).toEqual(expected);
    expect(tourWindowsForDate(saturday, '2026-10-05', 'America/St_Johns')).toEqual([]);
  });
  it('uses calendar days across Newfoundland daylight-saving transitions', () => {
    const hours = [{ dayOfWeek: 6, startTime: '23:00', endTime: '04:00', isAvailable: true }];
    const spring = tourWindowsForDate(hours, '2026-03-08', 'America/St_Johns')[0];
    const fall = tourWindowsForDate(hours, '2026-11-01', 'America/St_Johns')[0];
    expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(4);
    expect((fall.end.getTime() - fall.start.getTime()) / 3600000).toBe(6);
  });
  it('ignores equal clocks and invalid saved ranges without looping', () => {
    expect(tourWindowsForDate([{ ...saturday[0], endTime: '23:00' }, { ...saturday[0], startTime: 'broken' }], '2026-10-03', 'America/St_Johns')).toEqual([]);
  });
  it('does not silently move a nonexistent DST opening to another hour', () => {
    expect(tourWindowsForDate([{ dayOfWeek: 0, startTime: '02:00', endTime: '04:00', isAvailable: true }], '2026-03-08', 'America/St_Johns')).toEqual([]);
  });
});

describe("booking closure copy", () => {
  it("copies full-day closures once in the kitchen timezone and skips custom hours", () => {
    const closed = { specificDate: new Date("2026-03-08T12:00:00Z"), isAvailable: false, reason: "Maintenance" };
    const copied = bookingClosuresForTours([closed, closed,
      { specificDate: new Date("2026-03-09T12:00:00Z"), isAvailable: true, reason: "Short day" }], "America/St_Johns");
    expect(copied).toHaveLength(1);
    expect(copied[0].reason).toBe("Maintenance");
    expect(copied[0].startDate.toISOString()).toBe("2026-03-08T03:30:00.000Z");
    expect(copied[0].endDate.toISOString()).toBe("2026-03-09T02:29:59.999Z");
  });
});
