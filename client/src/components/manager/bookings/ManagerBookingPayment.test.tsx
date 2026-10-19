import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ManagerPaymentSummary, type Booking } from './ManagerBookingPayment';
afterEach(cleanup);
it('shows a multi-day order as every charge on it, not only the first payment', () => {
  const booking = { id: 210, scheduleRevision: 2, status: 'confirmed', transactionAmount: 14030, managerRevenue: 12676,
    orderChargedCents: 26230, orderRefundedCents: 0,
    payout: { amountCents: 12676, installments: [{ amountCents: 12676 }, { amountCents: 10988 }] } } as unknown as Booking;
  render(<ManagerPaymentSummary booking={booking} />);
  expect(screen.getByText('$262.30')).toBeInTheDocument();
  expect(screen.getByText(/\$236\.64/)).toBeInTheDocument();
});
