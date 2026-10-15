import { describe, expect, it } from "vitest";
import { visitStatusSentence, type VisitSentenceInput } from "./visit-status-sentence";

const t = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
  let text = fallback ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const base: VisitSentenceInput = {
  bookingStatus: "confirmed", checkinStatus: "not_checked_in", canCheckin: false, canCheckout: false, beforeCheckinOpens: false,
  clockEnded: false, lateCheckout: false, startedBeforeCheckin: false, checkedInLate: false, kitchen: "Main Kitchen", bookingEnds: "10:30 a.m. Newfoundland Time",
};
const say = (overrides: Partial<VisitSentenceInput>) => visitStatusSentence({ ...base, ...overrides }, t);

describe("visitStatusSentence", () => {
  it("carries the check-in time and says it covers the check-in row", () => {
    const result = say({ checkinStatus: "checked_in", canCheckout: true, checkedInTime: "9:28 a.m." });
    expect(result.text).toBe("You checked in at 9:28 a.m. When you’re finished, submit checkout below.");
    expect(result.coversCheckin).toBe(true);
  });
  it("adds that the booking still ends on time after a late check-in", () => {
    expect(say({ checkinStatus: "checked_in", canCheckout: true, checkedInTime: "9:50 a.m.", checkedInLate: true }).text)
      .toMatch(/Your booking still ends at 10:30 a\.m\. Newfoundland Time\.$/);
  });
  it("carries the checkout time and never a review deadline", () => {
    const result = say({ checkinStatus: "checkout_requested", checkoutTime: "10:31 a.m." });
    expect(result.text).toBe("You checked out at 10:31 a.m. You’re all set.");
    expect(result.coversCheckout).toBe(true);
    expect(result.text).not.toMatch(/review|inspect|deadline|due/i);
  });
  it("says the booked time ended and check-out is open when the chef is still checked in", () => {
    expect(say({ checkinStatus: "checked_in", clockEnded: true, lateCheckout: true, bookingEnds: "10:30 a.m. NT" }).text)
      .toBe("Your booking ended at 10:30 a.m. NT. Please check out now — Main Kitchen may charge for the extra time.");
  });
  it("says an ended visit without a check-in is over", () => {
    expect(say({ clockEnded: true }).text).toBe("This visit is over. No check-in was recorded.");
  });
  it("uses the kitchen's all-good outcome only in chef-safe wording", () => {
    const cleared = say({ checkinStatus: "checked_out", inspectionOutcome: "manager_cleared" }).text;
    expect(cleared).toBe("Visit complete. Main Kitchen checked the space and it’s all good.");
    expect(say({ checkinStatus: "checked_out", inspectionOutcome: "due" }).text).toBe("Visit complete. See your booking for the record.");
  });
  it("opens check-in, and notes the unchanged end once the start has passed", () => {
    expect(say({ canCheckin: true }).text).toBe("Check-in is open. Follow the arrival instructions, then confirm below.");
    expect(say({ canCheckin: true, startedBeforeCheckin: true }).text).toMatch(/Your booking still ends at 10:30 a\.m\. Newfoundland Time\.$/);
  });
  it("waits for the window without stating its time (the time row has it)", () => {
    expect(say({ beforeCheckinOpens: true }).text).toMatch(/isn’t open yet/);
  });
});
