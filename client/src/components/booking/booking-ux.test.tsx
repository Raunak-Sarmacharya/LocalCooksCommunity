import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/booking.json";
import { BookingRefundPolicyNotice } from "./BookingRefundPolicyNotice";
import { KitchenPayoutStatementBreakdown } from "./BookingPricingBreakdown";
import { CheckinPolicyTimesCard } from "./CheckinPolicyTimesCard";

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    const raw = (en as Record<string, string>)[key] ?? (typeof options === "string" ? options : options?.defaultValue) ?? key;
    return Object.entries(typeof options === "object" ? options ?? {} : {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw);
  },
}) }));

afterEach(cleanup);

describe("pending cancellation notice", () => {
  it("merges the two cancellation sentences into one", () => {
    const { container } = render(<BookingRefundPolicyNotice single />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container).toHaveTextContent("Free to cancel until the kitchen confirms.");
  });
  it("keeps the two-part form for the cancellation dialogs", () => {
    const { container } = render(<BookingRefundPolicyNotice />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});

describe("manager payout breakdown", () => {
  const input = { kitchenBaseSubtotalCents: 10000, kitchenHstRatePercent: 15, chargeAmountCents: 11500, platformFeeRate: 0 } as never;
  it("shows the HST collected line so managers can see what they remit", () => {
    render(<KitchenPayoutStatementBreakdown {...(input as object)} hstCollectedLabel="Includes HST you collected and remit" />);
    expect(screen.getByText("Includes HST you collected and remit")).toBeInTheDocument();
    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });
});

describe("kitchen-local time label", () => {
  it("names the zone in words, not as an IANA id", () => {
    render(<CheckinPolicyTimesCard bookingDate="2030-01-15" startTime="10:00" timezone="America/St_Johns" checkinWindowMinutesBefore={15} noShowGraceMinutes={30} operatingWindowStartTime="08:00" />);
    expect(screen.getByText(/local time \(Newfoundland Time\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("America/St_Johns");
  });
});
