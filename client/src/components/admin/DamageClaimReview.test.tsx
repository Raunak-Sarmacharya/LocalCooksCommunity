import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const day = 86_400_000, at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
const claim = (id: number, status: string, daysAgo: number, extra: object = {}) => ({ id, referenceCode: `DC-${id}`, kitchenBookingId: 100 + id, storageBookingId: null, status,
  claimedAmountCents: 4000, chefName: `Chef ${id}`, locationName: 'Harbour', createdAt: at(daysAgo), updatedAt: at(daysAgo), ...extra });
vi.mock('@/lib/damage-claims', () => ({ claimMoney: (cents: number) => `$${(cents / 100).toFixed(2)}`, claimRequest: async () => ({ claims: [
  claim(1, 'charge_succeeded', 9), claim(2, 'in_review', 1), claim(3, 'under_review', 11), claim(4, 'submitted', 2),
  claim(5, 'in_review', 3, { kitchenBookingId: null, storageBookingId: 44 }), claim(6, 'rejected', 4),
] }) }));
import { DamageClaimReview } from './DamageClaimReview';

it('puts what needs Local Cooks first, oldest first; storage claims open their rental; finished claims stay in history (owner, Oct 28)', async () => {
  render(<QueryClientProvider client={new QueryClient()}><DamageClaimReview /></QueryClientProvider>);
  const needs = await screen.findByRole('table', { name: /Needs you · 3/ });
  const rows = within(needs).getAllByRole('row').slice(1);
  expect(rows.map(row => within(row).getByText(/^DC-/).textContent)).toEqual(['DC-3', 'DC-5', 'DC-2']);
  expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/admin?section=storage-rentals&rental=44');
  expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/admin?section=booking-support&booking=103');
  const waiting = screen.getByRole('table', { name: /Waiting on the kitchen or chef · 1/ });
  expect(within(waiting).getByText('DC-4')).toBeInTheDocument();
  expect(screen.queryByText('DC-1')).toBeNull();
  expect(screen.queryByText('DC-6')).toBeNull();
  expect(screen.getByRole('link', { name: 'Claims history' })).toHaveAttribute('href', '/admin?section=damage-claims-history');
});
