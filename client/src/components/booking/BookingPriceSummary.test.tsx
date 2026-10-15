import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingPriceSummary } from './BookingPriceSummary';

vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
afterEach(cleanup);

it('itemises names and reconciles kitchen + equipment + HST + service fee to the unchanged $61 quote', () => {
  render(<BookingPriceSummary kitchenSubtotal={2500} equipmentSubtotal={2500} storageSubtotal={0}
    equipmentItems={[{ name: 'Stand mixer', priceCents: 2500 }]} storageItems={[]}
    taxRatePercent={15} serviceFeeRate={0.07} />);
  const summary = screen.getByTestId('booking-price-summary');
  for (const [name, amount] of [['Kitchen time', '$25.00'], ['Stand mixer', '$25.00'], ['HST (15%)', '$7.50'], ['Service fee', '$3.50'], ['Total', '$61.00 CAD']]) {
    expect(within(summary).getByText(name).parentElement).toHaveTextContent(amount);
  }
  expect(summary).not.toHaveTextContent(/Booking total|Taxes & non-govt/);
});

it('uses the configured tax label/rate and names each storage item; hides zero fee lines', () => {
  render(<BookingPriceSummary kitchenSubtotal={1000} equipmentSubtotal={0} storageSubtotal={2000}
    equipmentItems={[]} storageItems={[{ name: 'Cold shelf', priceCents: 1500 }, { name: 'Dry shelf', priceCents: 500 }]}
    taxRatePercent={5} taxLabel="GST" serviceFeeRate={0} />);
  expect(screen.getByText('GST (5%)').parentElement).toHaveTextContent('$1.50');
  expect(screen.getByText('Cold shelf').parentElement).toHaveTextContent('$15.00');
  expect(screen.getByText('Dry shelf').parentElement).toHaveTextContent('$5.00');
  expect(screen.getByText('Total').parentElement).toHaveTextContent('$31.50 CAD');
  expect(screen.queryByText('Service fee')).not.toBeInTheDocument();
});
