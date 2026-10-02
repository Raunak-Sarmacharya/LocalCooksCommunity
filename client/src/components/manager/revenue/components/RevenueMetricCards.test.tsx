import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RevenueMetricCards } from "./RevenueMetricCards";

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
afterEach(cleanup);

describe("RevenueMetricCards", () => {
  it("keeps the third metric visible and excludes refunds from average payment earnings", () => {
    const data = [
      { date: "2026-09-03", managerRevenue: 10000, paidEarnings: 10000, bookingCount: 1, totalRevenue: 12000, platformFee: 0 },
      { date: "2026-09-06", managerRevenue: -4000, paidEarnings: 0, bookingCount: 0, totalRevenue: -4500, refundedAmount: 4500, platformFee: 0 },
    ];
    render(<RevenueMetricCards data={data} isLoading={false} />);
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.getByText("revenueAverageEarnings")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("revenueRefundsIssued")).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
  });
});
