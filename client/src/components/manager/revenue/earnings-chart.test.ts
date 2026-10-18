import { describe, expect, it } from "vitest";
import { buildEarningsBuckets } from "./earnings-chart";

describe("earnings chart", () => {
  it('keeps a partial month report in its monthly bucket', () => {
    const buckets = buildEarningsBuckets([{ date: '2026-10-01', totalRevenue: 500, managerRevenue: 500, platformFee: 0, bookingCount: 1 }],
      new Date(2026, 9, 15), new Date(2026, 9, 31), true);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].netEarnings).toBe(500);
  });
  it("keeps empty dates and places a later refund in its own period", () => {
    const buckets = buildEarningsBuckets([
      { date: "2026-09-01", totalRevenue: 12000, grossRevenue: 12000, refundedAmount: 0, paidEarnings: 10000, refundDebit: 0, managerRevenue: 10000, platformFee: 0, bookingCount: 1 },
      { date: "2026-09-03", totalRevenue: -6000, grossRevenue: 0, refundedAmount: 6000, paidEarnings: 0, refundDebit: 5000, managerRevenue: -5000, platformFee: 0, bookingCount: 0 },
    ], new Date(2026, 8, 1), new Date(2026, 8, 3));
    expect(buckets.map((bucket) => bucket.netEarnings)).toEqual([10000, 0, -5000]);
    expect(buckets[2].refundedAmount).toBe(6000);
    expect(buckets.reduce((sum, bucket) => sum + bucket.netEarnings, 0)).toBe(5000);
  });

  it("groups a year by month without dropping empty months", () => {
    const buckets = buildEarningsBuckets([
      { date: "2026-03-11", totalRevenue: 1000, paidEarnings: 900, managerRevenue: 900, platformFee: 0, bookingCount: 1 },
    ], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(buckets).toHaveLength(12);
    expect(buckets[2].date).toBe("2026-03-01");
    expect(buckets[2].netEarnings).toBe(900);
  });
});
