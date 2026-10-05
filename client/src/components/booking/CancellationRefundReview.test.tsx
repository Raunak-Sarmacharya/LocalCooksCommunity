import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
import { CancellationRefundReview } from './CancellationRefundReview';
const source = { transactionId: 99, captured: 12200, alreadyRefunded: 0, managerRefund: 11116, processingCost: 384,
  serviceFeeReview: 700, currency: 'CAD', retainedUsedAddonCents: 0 };
let data: any;
const show = (manager = true, scope?: { kind: 'storage'; id: number }, onChanged?: () => Promise<void>) => render(<QueryClientProvider client={new QueryClient()}>
  <CancellationRefundReview bookingId={10} manager={manager} scope={scope} onChanged={onChanged} open onOpenChange={() => {}} />
</QueryClientProvider>);
describe('shared quoted cancellation review', () => {
  beforeEach(() => {
    data = { quoteHash: 'a'.repeat(64), sources: [source], items: [] };
    request.mockReset().mockImplementation(async () => ({ json: async () => data }));
  });
  it('shows exact amounts before acceptance and submits the reviewed hash', async () => {
    show(); expect(await screen.findByText('$111.16')).toBeInTheDocument(); expect(screen.getByText('$3.84')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Accept cancellation and initiate shown refunds'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/manager/bookings/10/cancellation-request', { action: 'accept', quoteHash: 'a'.repeat(64) }));
  });
  it('keeps an acceptance error visible and permits refreshing the quote', async () => {
    request.mockImplementation(async (method: string) => { if (method === 'PUT') throw Error('Refund quote changed'); return { json: async () => data }; });
    show(); fireEvent.click(await screen.findByText('Accept cancellation and initiate shown refunds'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refund quote changed');
    expect(screen.getByText('Refresh quote and outcomes')).toBeEnabled();
  });
  it('shows pending recovery without claiming customer bank receipt or another refund', async () => {
    data = { accepted: true, sources: [{ transactionId: 99, operation: { ...source, status: 'recovery_required', error: 'Original refund pending' } }] };
    show(false); expect(await screen.findByText('Original refund pending')).toBeInTheDocument();
    expect(screen.queryByText('Accept cancellation and initiate shown refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Request service-fee return from admin')).not.toBeInTheDocument();
  });
  it('routes selected storage through the same reviewed quote with its exact identity', async () => {
    show(true, { kind: 'storage', id: 77 });
    fireEvent.click(await screen.findByText('Accept cancellation and initiate shown refunds'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/manager/bookings/10/items/storage/77/cancellation-request', expect.objectContaining({ quoteHash: 'a'.repeat(64) })));
  });
  it('requests platform fees through the existing admin-review endpoint only after verified manager refund', async () => {
    data = { accepted: true, sources: [{ transactionId: 99, operation: { ...source, status: 'succeeded', refunded: 11116 } }] };
    show(); fireEvent.click(await screen.findByText('Request service-fee return from admin'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/manager/revenue/transactions/99/full-refund-request', expect.any(Object)));
  });
  it('refreshes the host booking state after accepted cancellation rather than leaving its request pending', async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    request.mockImplementation(async method => {
      if (method === 'PUT') data = { accepted: true, sources: [] };
      return { json: async () => data };
    });
    show(true, undefined, changed);
    fireEvent.click(await screen.findByText('Accept cancellation and initiate shown refunds'));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Accept cancellation and initiate shown refunds')).not.toBeInTheDocument();
  });
});
