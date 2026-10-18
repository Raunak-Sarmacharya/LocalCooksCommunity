import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, o?: any) => key === 'mdDaySubtotal' ? `Day subtotal: ${o.amount}` : key === 'kitchenSessionFullDay' ? 'Full day' : key }) }));
import { RequestedBookingDays } from './RequestedBookingDays';
afterEach(cleanup);
it('lists dates, mixed hours, equipment and the original day subtotal without day decisions', () => {
  render(<RequestedBookingDays revision={1} visits={[{ id: 1, visitDate: '2030-01-15', scheduleRevision: 1, startTime: '09:00', endTime: '11:00', priceSnapshot: { kitchenCents: 2000, equipment: [{ cents: 500 }] } },
    { id: 2, visitDate: '2030-01-17', scheduleRevision: 1, pricingMode: 'daily', startTime: '08:00', endTime: '18:00' }]} equipment={[{ name: 'Mixer', visitDate: '2030-01-17' }]} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('Day subtotal: $25.00')).toBeInTheDocument();
  expect(screen.getByText('Full day')).toBeInTheDocument(); expect(screen.getByText('Mixer')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
it('renders nothing for a single-day legacy request', () => {
  const { container } = render(<RequestedBookingDays />); expect(container).toBeEmptyDOMElement();
});
