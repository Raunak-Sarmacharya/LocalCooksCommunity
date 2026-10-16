vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/lib/damage-claims', async importOriginal => ({ ...(await importOriginal<object>()),
  claimRequest: async () => ({ held: true, claims: [{ id: 11, bookingId: 178, kitchenName: 'Harbour Kitchen', amountCents: 4000 }] }) }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClaimHoldBookingPaused } from './DamageClaimCards';

it('says bookings are paused, what unlocks them (with the amount) and where to pay, before any time is picked', async () => {
  render(<QueryClientProvider client={new QueryClient()}><ClaimHoldBookingPaused onBack={() => {}} /></QueryClientProvider>);
  expect(await screen.findByText('Pay the $40.00 charge and you can book again right away. Your existing bookings aren’t affected.')).toBeInTheDocument();
  expect(screen.getByText('New bookings are paused')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', '/booking/178');
  expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument();
});
