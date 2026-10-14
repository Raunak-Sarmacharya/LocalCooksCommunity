import { describe, expect, it } from "vitest";
import { bookingResponseDeadline, formatResponseDeadline } from "./booking-response-deadline";

describe("booking response deadline", () => {
  const pending = { status: "pending", paymentStatus: "authorized", createdAt: "2026-10-13T15:00:00.000Z" };

  it("is 24 hours after the request was created, like the server expiry", () => {
    expect(bookingResponseDeadline(pending)?.toISOString()).toBe("2026-10-14T15:00:00.000Z");
  });
  it('prefers the server deadline and keeps the fallback for older or malformed payloads', () => {
    expect(bookingResponseDeadline({ ...pending, responseDeadlineAt: '2026-10-13T22:00:00Z' })?.toISOString()).toBe('2026-10-13T22:00:00.000Z');
    expect(bookingResponseDeadline({ ...pending, responseDeadlineAt: 'invalid' })?.toISOString()).toBe('2026-10-14T15:00:00.000Z');
  });

  it("is absent when there is no live card hold to time out", () => {
    expect(bookingResponseDeadline({ ...pending, status: "confirmed" })).toBeNull();
    expect(bookingResponseDeadline({ ...pending, paymentStatus: "paid" })).toBeNull();
    expect(bookingResponseDeadline({ ...pending, paymentDecision: { state: "pending" } })).toBeNull();
    expect(bookingResponseDeadline({ ...pending, createdAt: "not a date" })).toBeNull();
  });

  it("formats in the kitchen zone with a friendly name, never an IANA id", () => {
    const text = formatResponseDeadline(new Date("2026-10-14T15:00:00.000Z"), "en-CA")!;
    expect(text).toMatch(/12:30 p\.m\./);
    expect(text).toContain("Newfoundland Time");
    expect(text).not.toContain("America/St_Johns");
  });
});
