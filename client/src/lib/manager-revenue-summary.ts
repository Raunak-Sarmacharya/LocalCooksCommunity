/**
 * The dashboard's "Revenue and payouts" card reads one shape, in cents. Today it is filled from the month's revenue
 * overview and the upcoming-payouts list (the Revenue page's own sources); the revenue summary endpoint can replace
 * `revenueSummaryFromCurrent` without touching the card. Display only.
 */
export type RevenueType = 'kitchen' | 'equipment' | 'storage' | 'extraTime' | 'claims';
export type RevenueSummary = {
  paidOut: number | null;
  upcoming: { total: number; next: { date: string; amount: number } | null } | null;
  onHold: { count: number; amount: number } | null;
  monthToDate?: Partial<Record<RevenueType, number>> | null;
};

type Overview = { completedNetRevenue?: number; netRevenue?: number } | undefined;
type Upcoming = { payouts: Array<{ bookingId: number; status: string; amountCents: number; expectedAt: string | null; timezone?: string | null }> } | undefined;

const dayOf = (at: string, timeZone: string) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)); }
  catch { return at.slice(0, 10); }
};

/**
 * Upcoming = scheduled payouts; on hold = held payouts (together they are the Revenue page's "Upcoming payouts" total).
 * The next payout is the earliest scheduled kitchen day and everything scheduled for that day.
 */
export function revenueSummaryFromCurrent(overview: Overview, upcoming: Upcoming, bookingIds?: Set<number>): RevenueSummary {
  const payouts = (upcoming?.payouts ?? []).filter(payout => !bookingIds || bookingIds.has(payout.bookingId));
  const scheduled = payouts.filter(payout => payout.status === 'scheduled');
  const held = payouts.filter(payout => payout.status === 'on_hold');
  const dated = scheduled.filter(payout => payout.expectedAt && Number.isFinite(Date.parse(payout.expectedAt)))
    .map(payout => ({ ...payout, day: dayOf(payout.expectedAt!, payout.timezone || 'America/St_Johns') }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const nextDay = dated[0]?.day;
  return {
    paidOut: overview ? overview.completedNetRevenue ?? overview.netRevenue ?? 0 : null,
    upcoming: upcoming ? { total: scheduled.reduce((sum, payout) => sum + payout.amountCents, 0),
      next: nextDay ? { date: nextDay, amount: dated.filter(payout => payout.day === nextDay).reduce((sum, payout) => sum + payout.amountCents, 0) } : null } : null,
    onHold: upcoming ? { count: held.length, amount: held.reduce((sum, payout) => sum + payout.amountCents, 0) } : null,
    monthToDate: null,
  };
}
