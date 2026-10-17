import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PartialAcceptance } from '@shared/partial-acceptance';

vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
import { PartialAcceptanceCard } from './PartialAcceptanceCard';

const proposal: PartialAcceptance = { id: '11111111-1111-4111-8111-111111111111', state: 'waiting', intentId: 'pi_1', actorId: 2,
  proposedAt: '2026-10-20T23:30:00Z', deadlineAt: '2026-10-21T23:30:00Z', equipment: [{ id: 31, status: 'cancelled' }],
  declined: [{ id: 31, name: 'Mixer', cents: 3000 }], oldTotalCents: 18300, newTotalCents: 14640 };
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); toast.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderCard(manager = false, extra: Partial<Parameters<typeof PartialAcceptanceCard>[0]> = {}) {
  const onChanged = vi.fn();
  render(<PartialAcceptanceCard bookingId={112} proposal={proposal} manager={manager} kitchenName="Kitchen North" chefName="Alex"
    timezone="America/St_Johns" onChanged={onChanged} {...extra} />);
  return { onChanged };
}

it('chef: plain-language offer with both totals, the exact deadline in the kitchen zone and what happens without an answer', () => {
  renderCard();
  expect(screen.getByRole('heading', { name: 'Kitchen North can host you, but can’t provide Mixer' })).toBeInTheDocument();
  expect(screen.getByText('New total $146.40 (was $183.00). Accept or decline by Wed, Oct 21, 9:00 p.m. Newfoundland Time.')).toBeInTheDocument();
  expect(screen.getByText('Nothing is charged until you accept. If you don’t answer, the request closes and your card hold is released.')).toBeInTheDocument();
});

it('chef accepts: posts the proposal id and refreshes the booking', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, status: 'confirmed' }) });
  const { onChanged } = renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Accept $146.40' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith('/api/chef/bookings/112/partial-acceptance', expect.objectContaining({ method: 'POST',
    body: JSON.stringify({ proposalId: proposal.id, answer: 'accept' }) }));
  expect(toast).toHaveBeenCalledWith({ title: 'Accepted. Your booking is confirmed.' });
});

it('chef declines only after confirming, and can go back', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, status: 'cancelled' }) });
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, decline' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ proposalId: proposal.id, answer: 'decline' });
});

it('shows the server’s reason when the answer is refused (e.g. the deadline passed)', async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'The time to answer has passed, so this request is closed. You weren’t charged.' }) });
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Accept $146.40' }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive',
    description: 'The time to answer has passed, so this request is closed. You weren’t charged.' })));
});

it('kitchen: waiting for the chef, no accept/decline, and a withdraw that declines the request', () => {
  const onWithdraw = vi.fn();
  renderCard(true, { onWithdraw });
  expect(screen.getByRole('heading', { name: 'Waiting for Alex to accept the new total' })).toBeInTheDocument();
  expect(screen.getByText('You accepted without Mixer. New total $146.40 (was $183.00). Alex has until Wed, Oct 21, 9:00 p.m. Newfoundland Time to answer.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw and decline the request' }));
  expect(onWithdraw).toHaveBeenCalledOnce();
});
