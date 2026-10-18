import { expect, it } from 'vitest';
import { revenueSummaryFromLedger } from './manager-revenue-summary';

it('turns the ledger next-payout timestamp into the kitchen-local day the card formats (live crash, Oct 18)', () => {
  const zero = { kitchenTime: 0, equipment: 0, storage: 0, extraTime: 0, claimsReceived: 0, refunds: 0, hstCollected: 0, cardProcessingFees: 0, netPayout: 0, key: 'total', bookingsCount: 0, hoursBooked: 0, paymentCount: 0 };
  const summary = revenueSummaryFromLedger({ summary: { paidOut: 100, netEarnings: 0, onHold: { count: 0, amount: 0 },
    upcoming: { total: 500, nextPayout: { date: '2026-10-20T02:00:00.000Z', amount: 500, timezone: 'America/St_Johns' } } },
    upcoming: [], paid: [], report: { rows: [], months: [], byChef: [], byType: [], totals: zero }, filters: { locations: [], kitchens: [] },
    range: { startDate: '2026-10-01', endDate: '2026-10-31' } } as never)!;
  // 02:00 UTC Oct 20 is 11:30 p.m. Oct 19 in Newfoundland.
  expect(summary.upcoming!.next).toEqual({ date: '2026-10-19', amount: 500 });
  expect(Number.isFinite(Date.parse(`${summary.upcoming!.next!.date}T12:00:00Z`))).toBe(true);
});
