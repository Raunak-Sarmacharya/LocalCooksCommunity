vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const claim = { id: 11, referenceCode: 'DC-11', bookingId: 178, visitId: 9, chefId: 380, managerId: 379, status: 'approved', claimVersion: 2,
  description: 'Cracked tray', amountCents: 4000, claimedAmountCents: 4000, lines: [], visitEvidence: null, chefResponse: null, deadline: '2026-10-20T12:00:00Z',
  upheldAt: '2026-10-09T12:00:00Z', publicMessage: null, kitchenPaid: false, fundedBy: 'chef', chefOwes: true, chefVisible: true, reviewRequest: null,
  kitchenReply: null, paymentBusy: true, compensationPending: false, evidence: [], history: [], paymentReview: 'More than one payment matches this attempt.' };
const claimAction = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/damage-claims', () => ({ claimRequest: vi.fn(async () => ({ claims: [claim] })), claimAction: (...args: unknown[]) => claimAction(...args as []),
  claimMoney: (cents: number) => `$${(cents / 100).toFixed(2)}` }));
vi.mock('@/components/booking/DamageClaimCards', () => ({ ClaimEvidence: () => null, ClaimTimeline: () => null }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DamageClaimPanel } from './DamageClaimPanel';

it('a chef payment held for review shows why, and "Start the chef’s payment over" sends the provider check confirmation', async () => {
  render(<QueryClientProvider client={new QueryClient()}><DamageClaimPanel bookingId={178} /></QueryClientProvider>);
  expect(await screen.findByTestId('claim-payment-review')).toHaveTextContent('More than one payment matches this attempt.');
  fireEvent.click(screen.getByRole('button', { name: 'Start the chef’s payment over' }));
  expect(screen.getByText(/Nothing is charged by this action/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  for (const box of screen.getAllByRole('textbox')) fireEvent.change(box, { target: { value: 'Checked in the payment provider: no charge.' } });
  const save = screen.getAllByRole('button').filter(button => /save|confirm|submit|apply/i.test(button.textContent || '')).at(-1)!;
  fireEvent.click(save);
  await waitFor(() => expect(claimAction).toHaveBeenCalledWith(178, expect.objectContaining({ type: 'claim_restart_payment', verifiedNoPayment: true })));
});
