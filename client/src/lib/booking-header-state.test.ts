import { describe, expect, it } from "vitest";
import { bookingHeaderPhase, bookingPillTone, bookingPrimaryAction, canMessage, contactVisible, initials, sentence, timeRange } from "./booking-header-state";

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
