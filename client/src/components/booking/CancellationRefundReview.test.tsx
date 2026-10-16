vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
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
    fireEvent.click(screen.getByText('Accept cancellation and send these refunds'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/manager/bookings/10/cancellation-request', { action: 'accept', quoteHash: 'a'.repeat(64) }));
  });
  it('keeps an acceptance error visible and permits refreshing the quote', async () => {
    request.mockImplementation(async (method: string) => { if (method === 'PUT') throw Error('Refund quote changed'); return { json: async () => data }; });
    show(); fireEvent.click(await screen.findByText('Accept cancellation and send these refunds'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Local Cooks is checking this refund');
    expect(screen.getByText('Refresh refund details')).toBeEnabled();
  });
  it('shows pending recovery without claiming customer bank receipt or another refund', async () => {
    data = { accepted: true, sources: [{ transactionId: 99, operation: { ...source, status: 'recovery_required', error: 'Original refund pending' } }] };
    show(false); expect(await screen.findByText(/Local Cooks is checking this refund/)).toBeInTheDocument();
    expect(screen.queryByText('Original refund pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Accept cancellation and send these refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Ask Local Cooks to review the service fee')).not.toBeInTheDocument();
  });
  it('shows named-party, date and normalized add-on amounts without provider or internal ids', async () => {
    data = { accepted: true, partyName: 'Harbour kitchen', date: '2026-11-10T12:30:00Z', timezone: 'America/St_Johns', sources: [{ transactionId: 99,
      operation: { id: 'chef-addon-private', intentId: 'pi_private', refundId: 're_private', itemName: 'Commercial Oven', scope: { kind: 'equipment', id: 31 },
        currency: 'CAD', capturedCents: 2122, alreadyRefundedCents: 0, customerRefund: 1028, managerRefund: 967, platformRefund: 61, feeRetainedCents: 67, status: 'succeeded', refunded: 1028 } }] };
    show(false);
    expect(await screen.findByText('Harbour kitchen')).toBeInTheDocument();
    expect(screen.getByText(/Nov.*10.*2026/i)).toBeInTheDocument();
    expect(screen.getByText('Commercial Oven')).toBeInTheDocument();
    expect(screen.getAllByText('$10.28').length).toBeGreaterThan(0);
    expect(screen.getByText('From the kitchen payout').nextSibling).toHaveTextContent('$9.67');
    expect(screen.getByText('From the Local Cooks service fee').nextSibling).toHaveTextContent('$0.61');
    expect(screen.getByText('$0.67')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/Payment #|chef-addon-private|pi_private|re_private|#31/);
  });
  it('does not claim a zero-dollar late add-on refund was sent', async () => {
    data = { accepted: true, partyName: 'Harbour kitchen', date: '2026-11-10T12:30:00Z', timezone: 'America/St_Johns', sources: [{ transactionId: 99,
      operation: { itemName: 'Commercial Oven', scope: { kind: 'equipment', id: 31 }, currency: 'CAD', capturedCents: 2122, customerRefund: 0, managerRefund: 0, feeRetainedCents: 67, status: 'succeeded' } }] };
    show(false);
    expect(await screen.findByText(/this item wasn’t refundable/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00 sent/i)).not.toBeInTheDocument();
  });
  it('routes selected storage through the same reviewed quote with its exact identity', async () => {
    show(true, { kind: 'storage', id: 77 });
    fireEvent.click(await screen.findByText('Accept cancellation and send these refunds'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/manager/bookings/10/items/storage/77/cancellation-request', expect.objectContaining({ quoteHash: 'a'.repeat(64) })));
  });
  it('requests platform fees through the existing admin-review endpoint only after verified manager refund', async () => {
    data = { accepted: true, sources: [{ transactionId: 99, operation: { ...source, status: 'succeeded', refunded: 11116 } }] };
    show(); fireEvent.click(await screen.findByText('Ask Local Cooks to review the service fee'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/manager/revenue/transactions/99/full-refund-request', expect.any(Object)));
  });
  it('refreshes the host booking state after accepted cancellation rather than leaving its request pending', async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    request.mockImplementation(async method => {
      if (method === 'PUT') data = { accepted: true, sources: [] };
      return { json: async () => data };
    });
    show(true, undefined, changed);
    fireEvent.click(await screen.findByText('Accept cancellation and send these refunds'));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Accept cancellation and send these refunds')).not.toBeInTheDocument();
  });
  it('explains completed used items and a declined service-fee review without raw status codes', async () => {
    data = { accepted: true, sources: [{ ...source, serviceFeeRequest: { status: 'rejected' } }],
      items: [{ kind: 'storage', id: 77, treatment: 'completed', paymentTreatment: 'used_payment_retained' }] };
    show();
    expect(await screen.findByText(/Payment kept for storage or equipment already used/)).toHaveTextContent('Finished');
    expect(screen.getByText(/Service fee review:/)).toHaveTextContent('Refund request declined');
    expect(screen.queryByText(/used_payment_retained|completed;/)).not.toBeInTheDocument();
  });

});
