/** Read-only kitchen ledger. Money stays in CAD cents; HST belongs to the kitchen. */
export type RevenueType = 'kitchen_time' | 'storage' | 'extra_time' | 'claim';
export type RevenueDay = { number: number; total: number; date: string };
export type RevenueAmounts = {
  kitchenTime: number; equipment: number; storage: number; extraTime: number; claimsReceived: number;
  refunds: number; hstCollected: number; cardProcessingFees: number; netPayout: number;
};
export type RevenueIdentity = {
  bookingId: number; bookingReference: string; bookingUrl: string; chefId: number | null; chefName: string | null;
  locationId: number; locationName: string; kitchenId: number; kitchenName: string; timezone: string;
  day: RevenueDay; type: RevenueType;
};
export type RevenuePayoutRow = RevenueIdentity & RevenueAmounts & {
  id: string; amountCents: number; expectedAt: string | null; paidAt: string | null;
  status: 'scheduled' | 'on_hold' | 'paid'; holdReason: string | null;
  reason: 'inspection' | 'processing' | null; stripeUrl: string | null; reversedCents: number;
};
export type RevenueReportRow = RevenueIdentity & RevenueAmounts & {
  id: string; date: string; bookingsCount: number; hoursBooked: number; paymentCount: number;
};
export type RevenueReportGroup = RevenueAmounts & {
  key: string; bookingsCount: number; hoursBooked: number; paymentCount: number;
};
export type RevenueSummary = {
  paidOut: number; upcoming: { total: number; nextPayout: { date: string; amount: number; timezone?: string } | null };
  onHold: { count: number; amount: number }; netEarnings: number;
};
export type ManagerRevenue = {
  summary: RevenueSummary; upcoming: RevenuePayoutRow[]; paid: RevenuePayoutRow[];
  report: { rows: RevenueReportRow[]; months: RevenueReportGroup[]; byChef: RevenueReportGroup[];
    byType: RevenueReportGroup[]; totals: RevenueReportGroup };
  filters: { locations: Array<{ id: number; name: string }>;
    kitchens: Array<{ id: number; name: string; locationId: number }> };
  range: { startDate: string; endDate: string };
};
