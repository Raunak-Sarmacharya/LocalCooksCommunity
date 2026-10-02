import type { RevenueByDate } from "./types";

export interface EarningsBucket {
  date: string;
  grossRevenue: number;
  refundedAmount: number;
  paidEarnings: number;
  refundDebit: number;
  netEarnings: number;
}

/** Keep empty periods visible; a refund can make a period negative. All values remain cents. */
export function buildEarningsBuckets(rows: RevenueByDate[], from: Date, to: Date): EarningsBucket[] {
  const utcDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const start = utcDay(from);
  const end = utcDay(to);
  if (end < start) return [];
  const days = Math.floor((end - start) / 86_400_000) + 1;
  const interval = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const buckets = new Map<string, EarningsBucket>();
  const keyFor = (time: number) => {
    const date = new Date(interval === "week" ? start + Math.floor((time - start) / (7 * 86_400_000)) * 7 * 86_400_000 : time);
    return interval === "month"
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`
      : date.toISOString().slice(0, 10);
  };
  let time = start;
  while (time <= end) {
    const key = keyFor(time);
    buckets.set(key, { date: key, grossRevenue: 0, refundedAmount: 0, paidEarnings: 0, refundDebit: 0, netEarnings: 0 });
    if (interval === "month") {
      const date = new Date(time);
      time = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    } else time += interval === "day" ? 86_400_000 : 7 * 86_400_000;
  }
  for (const row of rows) {
    const time = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(time) || time < start || time > end) continue;
    const bucket = buckets.get(keyFor(time));
    if (!bucket) continue;
    bucket.grossRevenue += row.grossRevenue ?? row.totalRevenue;
    bucket.refundedAmount += row.refundedAmount ?? 0;
    bucket.paidEarnings += row.paidEarnings ?? Math.max(0, row.managerRevenue);
    bucket.refundDebit += row.refundDebit ?? Math.max(0, -row.managerRevenue);
    bucket.netEarnings = bucket.paidEarnings - bucket.refundDebit;
  }
  return Array.from(buckets.values());
}
