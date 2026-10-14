import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckinPolicyTimesCard } from "./CheckinPolicyTimesCard";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" }, t: (key: string, options?: any) => (typeof options === "object" ? options.defaultValue : options) ?? key }) }));

const card = () => render(<CheckinPolicyTimesCard bookingDate="2030-01-15" startTime="10:00" timezone="America/St_Johns"
  checkinWindowMinutesBefore={15} noShowGraceMinutes={30} showIntro={false} earlyAction={<button type="button">Arrived early? Message the kitchen</button>} />);
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("check-in times card", () => {
  it("offers the early-arrival action next to the time check-in opens", () => {
    vi.setSystemTime(Date.parse("2030-01-15T12:00:00Z"));
    card();
    expect(screen.getByText("Check-in opens")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arrived early? Message the kitchen" })).toBeTruthy();
  });
  it("drops it once check-in is open", () => {
    vi.setSystemTime(Date.parse("2030-01-15T13:30:00Z"));
    card();
    expect(screen.getByText("Check-in opened at")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Arrived early? Message the kitchen" })).toBeNull();
  });
});
