import { describe, expect, it } from "vitest";
import { arrivalRecorded, bookedHours, canCancelOrChange, bookingHeaderPhase, bookingPillTone, bookingPrimaryAction, canMessage, contactVisible, initials, sentence, timeRange } from "./booking-header-state";

const startAt = new Date("2030-01-15T13:30:00Z"), endAt = new Date("2030-01-15T15:30:00Z");
const checkinOpensAt = new Date(startAt.getTime() - 15 * 60_000);
const timed = { startAt, endAt, checkinOpensAt, timezone: "America/St_Johns" };

describe("bookingHeaderPhase", () => {
  it.each([
    [{ status: "pending" }, "pending"],
    [{ status: "cancelled", checkinStatus: "checked_in" }, "cancelled"],
    [{ status: "cancellation_requested" }, "cancellation_requested"],
    [{ status: "confirmed", ...timed, now: startAt.getTime() - 3 * 86_400_000 }, "confirmed"],
    [{ status: "confirmed", ...timed, now: startAt.getTime() - 3_600_000 }, "today"],
    [{ status: "confirmed", ...timed, now: startAt.getTime() - 60_000 }, "checkin_open"],
    [{ status: "confirmed", checkinStatus: "checked_in", ...timed }, "in_session"],
    [{ status: "confirmed", checkinStatus: "checked_in", closeoutPhase: "booked_time_ended" }, "time_ended_in_session"],
    [{ status: "confirmed", checkinStatus: "checkout_requested" }, "checkout_review"],
    [{ status: "confirmed", checkinStatus: "checked_out", inspectionCanRespond: true }, "checkout_review"],
    [{ status: "confirmed", checkinStatus: "checked_out" }, "completed"],
    [{ status: "completed" }, "completed"],
    [{ status: "confirmed", checkinStatus: "no_show" }, "no_show"],
    [{ status: "confirmed", checkinStatus: "checkout_claim_filed" }, "issue"],
    [{ status: "confirmed", closeoutPhase: "ended" }, "visit_ended"],
    [{ status: "confirmed", ...timed, now: endAt.getTime() + 60_000 }, "visit_ended"],
  ] as const)("%o → %s", (input, phase) => {
    expect(bookingHeaderPhase(input)).toBe(phase);
  });

  it("uses any visit's state for split bookings", () => {
    expect(bookingHeaderPhase({ status: "confirmed", visits: [{ checkinStatus: "checked_out" }, { checkinStatus: "checked_in" }] })).toBe("in_session");
    expect(bookingHeaderPhase({ status: "confirmed", visits: [{ checkinStatus: "checked_in" }, { checkinStatus: "checkout_requested" }] })).toBe("checkout_review");
  });
});

describe("bookingPrimaryAction", () => {
  it("gives the manager one decision per state and nothing otherwise", () => {
    expect(bookingPrimaryAction("pending", true)).toBe("review_request");
    expect(bookingPrimaryAction("cancellation_requested", true)).toBe("review_cancellation");
    expect(bookingPrimaryAction("checkout_review", true)).toBe("review_checkout");
    expect(bookingPrimaryAction("visit_ended", true, true)).toBe("inspect_visit");
    for (const phase of ["confirmed", "today", "checkin_open", "in_session", "completed", "cancelled", "visit_ended"] as const) {
      expect(bookingPrimaryAction(phase, true)).toBeNull();
    }
  });
  it("gives the chef Open your visit only in the check-in window or in session", () => {
    for (const phase of ["checkin_open", "in_session", "time_ended_in_session"] as const) expect(bookingPrimaryAction(phase, false)).toBe("open_visit");
    for (const phase of ["pending", "confirmed", "today", "checkout_review", "completed", "cancelled"] as const) expect(bookingPrimaryAction(phase, false)).toBeNull();
  });
});

describe("helpers", () => {
  it("maps tones to the spec palette", () => {
    expect(bookingPillTone("pending")).toBe("amber");
    expect(bookingPillTone("confirmed")).toBe("blue");
    expect(bookingPillTone("in_session")).toBe("green");
    expect(bookingPillTone("checkout_review")).toBe("purple");
    expect(bookingPillTone("completed")).toBe("neutral");
    expect(bookingPillTone("cancelled")).toBe("grey");
  });
  it("matches the server's messaging and contact rules", () => {
    expect(canMessage("pending")).toBe(true);
    expect(canMessage("cancelled")).toBe(false);
    expect(canMessage("confirmed")).toBe(true);
    expect(contactVisible("pending")).toBe(false);
    expect(contactVisible("completed")).toBe(true);
  });
  it("never ends a sentence with a double period", () => {
    expect(sentence("Visit complete. The kitchen reviews by Oct 15, 2026, 2:05 a.m..")).toBe("Visit complete. The kitchen reviews by Oct 15, 2026, 2:05 a.m.");
    expect(sentence("Visit complete.")).toBe("Visit complete.");
  });
  it("collapses a shared a.m./p.m. suffix and leaves other formats alone", () => {
    expect(timeRange("2:00 p.m.", "3:00 p.m.")).toBe("2:00–3:00 p.m.");
    expect(timeRange("10:00 a.m.", "12:00 p.m.")).toBe("10:00 a.m.–12:00 p.m.");
    expect(timeRange("14 h 00", "15 h 00")).toBe("14 h 00–15 h 00");
  });
  it("makes initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("")).toBe("?");
  });
});

describe("canCancelOrChange", () => {
  it("is offered before arrival", () => {
    for (const phase of ["pending", "confirmed", "today", "checkin_open"] as const) {
      expect(canCancelOrChange({ status: phase === "pending" ? "pending" : "confirmed", phase, arrivalRecorded: false })).toBe(true);
    }
  });
  it("is gone once an arrival is recorded, even for a DB-confirmed checked-out booking", () => {
    expect(canCancelOrChange({ status: "confirmed", phase: "completed", arrivalRecorded: true })).toBe(false);
    expect(canCancelOrChange({ status: "confirmed", phase: "today", arrivalRecorded: true })).toBe(false);
  });
  it("is gone in every phase past arrival", () => {
    for (const phase of ["in_session", "time_ended_in_session", "checkout_review", "visit_ended", "completed", "no_show", "issue"] as const) {
      expect(canCancelOrChange({ status: "confirmed", phase, arrivalRecorded: false })).toBe(false);
    }
  });
  it("is gone for cancelled bookings and keeps the manager's pending cancellation reviewable", () => {
    expect(canCancelOrChange({ status: "cancelled", phase: "cancelled", arrivalRecorded: false })).toBe(false);
    expect(canCancelOrChange({ status: "cancellation_requested", phase: "cancellation_requested", arrivalRecorded: false })).toBe(false);
    expect(canCancelOrChange({ status: "cancellation_requested", phase: "cancellation_requested", arrivalRecorded: false, manager: true })).toBe(true);
  });
  it("detects arrivals on the booking or any visit", () => {
    expect(arrivalRecorded({ checkinStatus: "not_checked_in" })).toBe(false);
    expect(arrivalRecorded({})).toBe(false);
    expect(arrivalRecorded({ checkinStatus: "checked_out" })).toBe(true);
    expect(arrivalRecorded({ visits: [{ checkinStatus: "not_checked_in" }, { checkinStatus: "checked_in" }] })).toBe(true);
  });
});

describe('bookedHours (header duration)', () => {
  it('uses the real start–end span of every visit, never a stale stored count', () => {
    expect(bookedHours({ closeoutVisits: [{ scheduledStartAt: '2026-10-14T21:00:00Z', scheduledEndAt: '2026-10-15T00:00:00Z' }], durationHours: 2.5 })).toBe(3);
    expect(bookedHours({ visits: [{ startTime: '09:00', endTime: '10:30' }, { startTime: '13:00', endTime: '14:15' }], durationHours: 1 })).toBe(2.75);
    expect(bookedHours({ startTime: '22:00', endTime: '01:30', durationHours: 2 })).toBe(3.5);
    expect(bookedHours({ durationHours: '4' })).toBe(4);
  });
  it('sentence() never leaves "p.m.." and keeps an ellipsis', () => {
    expect(sentence('You have until 7:55 p.m..')).toBe('You have until 7:55 p.m.');
    expect(sentence('Saving...')).toBe('Saving...');
  });
});

describe('closed-out bookings keep a raw check-in value (live #132 / #160 / #164)', () => {
  const base = { status: 'completed', closeoutPhase: 'ended' } as const;
  it('inspection closed: a leftover checked_in / checkout_requested is settled history → completed', () => {
    expect(bookingHeaderPhase({ ...base, checkinStatus: 'checked_in', inspectionCanRespond: false })).toBe('completed');
    expect(bookingHeaderPhase({ ...base, checkinStatus: 'checkout_requested', inspectionCanRespond: false })).toBe('completed');
  });
  it('inspection still open: the raw value is real — overstay or checkout to review', () => {
    expect(bookingHeaderPhase({ ...base, checkinStatus: 'checked_in', inspectionCanRespond: true })).toBe('time_ended_in_session');
    expect(bookingHeaderPhase({ ...base, checkinStatus: 'checkout_requested', inspectionCanRespond: true })).toBe('checkout_review');
  });
  it('a recorded no-show stays as recorded', () => {
    expect(bookingHeaderPhase({ ...base, checkinStatus: 'no_show', inspectionCanRespond: false })).toBe('no_show');
  });
});

describe('no check-in recorded (WP-N)', () => {
  const unknown = { visitAttendance: ['unknown'] };
  it.each([
    [{ status: 'completed', ...unknown }, 'no_checkin'],
    [{ status: 'confirmed', closeoutPhase: 'ended', ...unknown }, 'no_checkin'],
    // Still within the grace period after the booked end: not yet closed out.
    [{ status: 'confirmed', closeoutPhase: 'booked_time_ended', ...unknown }, 'visit_ended'],
    // The kitchen said "They came" (server projection reads it as recorded): a normal completed visit.
    [{ status: 'completed', visitAttendance: ['recorded'] }, 'completed'],
    [{ status: 'completed', checkinStatus: 'no_show', visitAttendance: ['no_show'] }, 'no_show'],
    [{ status: 'completed', checkinStatus: 'checked_out', visitAttendance: ['recorded'] }, 'completed'],
    // One of two visits attended: not a no-check-in booking.
    [{ status: 'completed', visits: [{ checkinStatus: 'checked_out' }, { checkinStatus: 'not_checked_in' }], visitAttendance: ['recorded', 'unknown'] }, 'completed'],
    [{ status: 'cancelled', ...unknown }, 'cancelled'],
  ] as const)('%o → %s', (input, phase) => {
    expect(bookingHeaderPhase(input as any)).toBe(phase);
  });
  it('is amber, and the kitchen answers only while the inspection window is open', () => {
    expect(bookingPillTone('no_checkin')).toBe('amber');
    expect(bookingPrimaryAction('no_checkin', true, true)).toBe('answer_attendance');
    expect(bookingPrimaryAction('no_checkin', true, false)).toBeNull();
    expect(bookingPrimaryAction('no_checkin', false, true)).toBeNull();
  });
});
