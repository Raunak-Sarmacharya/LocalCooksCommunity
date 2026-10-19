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
  expect(screen.getByRole('heading', { name: 'Kitchen North can host you, with changes' })).toBeInTheDocument();
  expect(screen.getByTestId('partial-acceptance-changes')).toHaveTextContent('Without Mixer');
  expect(screen.getByText('New total $146.40 (was $183.00). Accept or decline by Wed, Oct 21, 9:00 p.m. Newfoundland Time.')).toBeInTheDocument();
  expect(screen.getByText('Nothing is charged until you accept. If you don’t answer, the request closes and your card hold is released.')).toBeInTheDocument();
});

it('chef: the answer is given on the offer page (full page, like Airbnb’s offer page)', () => {
  renderCard();
  expect(screen.getByRole('link', { name: 'Review the changes' })).toHaveAttribute('href', '/booking/112/offer');
  expect(screen.queryByRole('button', { name: 'Accept $146.40' })).not.toBeInTheDocument();
});

it('days (Oct 19): the chef reads each day the kitchen can’t host, then the items on kept days', () => {
  render(<PartialAcceptanceCard bookingId={5} manager={false} kitchenName="Kitchen North" chefName="Alex" timezone="America/St_Johns" onChanged={vi.fn()}
    proposal={{ ...proposal, declinedVisitIds: [8], declinedDays: [{ visitId: 8, date: '2026-11-25', cents: 7500 }] }} />);
  const lines = screen.getByTestId('partial-acceptance-changes');
  expect(lines).toHaveTextContent('Not on Wed, Nov 25');
  expect(lines).toHaveTextContent('Without Mixer');
});
it('kitchen: waiting for the chef, no accept/decline, and a withdraw that declines the request', () => {
  const onWithdraw = vi.fn();
  renderCard(true, { onWithdraw });
  expect(screen.getByRole('heading', { name: 'Waiting for Alex to accept the new total' })).toBeInTheDocument();
  expect(screen.getByText('You sent Alex your changes: without Mixer. New total $146.40 (was $183.00). Alex has until Wed, Oct 21, 9:00 p.m. Newfoundland Time to answer.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw and decline the request' }));
  expect(onWithdraw).toHaveBeenCalledOnce();
});
