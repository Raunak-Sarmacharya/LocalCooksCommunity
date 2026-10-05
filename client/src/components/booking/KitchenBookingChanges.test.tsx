import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
import { KitchenBookingChanges, ChangePrice } from './KitchenBookingChanges';
const original = { date: '2026-11-10', windowStart: '08:00', slots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }] };
const quote = { originalKitchenCents: 10000, currentKitchenCents: 8000, retainedKitchenCents: 8000, addedKitchenCents: 0,
  taxCents: 0, feeCents: 0, payableCents: 0, currency: 'CAD', refundKitchenCents: 2000, refundTaxCents: 300, refundableCents: 2300 };
let data: any;
const entry = (state = 'requested') => ({ id: 'change-fixture', kind: 'move', state, label: state === 'applied' ? 'Change confirmed' : 'Awaiting manager decision',
  revision: 1, original, destination: { ...original, date: '2026-11-15' }, quote, decisionBy: '2026-11-09T12:00:00Z', paymentBy: null,
  canDecide: true, history: [{ revision: 1, state, message: 'Original booking remains reserved while awaiting approval.', at: '2026-11-08T12:00:00Z' }] });
describe('reservation-context kitchen change consumer', () => {
  beforeEach(() => {
    data = { original, policyReady: true, policyMessage: null, changes: [] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
  });
  it('shows the current cheaper price and refund including original tax', () => {
    render(<ChangePrice quote={quote} />);
    expect(screen.getByText(/Recorded kitchen subtotal/)).toHaveTextContent('100.00');
    expect(screen.getByText(/Current schedule quote/)).toHaveTextContent('80.00');
    expect(screen.getByText(/Kitchen subtotal after change/)).toHaveTextContent('80.00');
    expect(screen.getByText(/^Refund if approved:/)).toHaveTextContent('23.00');
  });
  it('does not expose a new rescheduling form for confirmed bookings', async () => {
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByText(/Confirmed kitchen bookings cannot be rescheduled/)).toBeInTheDocument();
    expect(screen.queryByText('Review a change')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
  });
  it('does not present a pending paid schedule as confirmed; history and withdrawal are visible', async () => {
    data.changes = [entry()];
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByText(/requested schedule is not confirmed/)).toBeInTheDocument();
    expect(screen.getByText('Withdraw request')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
    expect(screen.queryByText('Review a change')).not.toBeInTheDocument();
  });
  it('retires consent and authorization while preserving withdrawal and history', async () => {
    data.changes = [entry('awaiting_consent')];
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByText('Withdraw request')).toBeInTheDocument();
    expect(screen.queryByText('Accept updated quote for manager review')).not.toBeInTheDocument();
    expect(screen.queryByText('Authorize additional amount')).not.toBeInTheDocument();
  });
  it('ordinary read failures offer refresh without inventing uncertain payment', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Source unavailable' }) } as any);
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable');
    expect(screen.queryByText(/Do not pay again/)).not.toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });
  it('shows Local Cooks recovery with no second-pay or withdrawal action', async () => {
    data.changes = [{ ...entry('recovery_required'), paymentRecorded: true }];
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByText(/Do not pay again/)).toHaveTextContent('The additional payment or card hold is recorded');
    expect(screen.queryByText('Authorize additional amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Withdraw request')).not.toBeInTheDocument();
    expect(screen.getByText('Verify original payment and schedule')).toBeInTheDocument();
  });
  it('reports a recorded refund while keeping the schedule in Local Cooks recovery', async () => {
    data.changes = [{ ...entry('recovery_required'), refundRecorded: true }];
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByText(/Do not pay again/)).toHaveTextContent('The approved refund is recorded');
    expect(screen.getByText(/requested schedule is not confirmed/)).toBeInTheDocument();
    expect(screen.queryByText('Withdraw request')).not.toBeInTheDocument();
  });
  it('retires manager approval while preserving decline', async () => {
    data.changes = [entry()];
    render(<KitchenBookingChanges bookingId={10} manager onChanged={async () => {}} />);
    expect(await screen.findByText('Decline')).toBeInTheDocument();
    expect(screen.queryByText('Approve and refund quoted amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Review destination availability and tours')).not.toBeInTheDocument();
  });
  it('does not fabricate an empty result on an unavailable source', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Change source unavailable' }) } as any);
    render(<KitchenBookingChanges bookingId={10} manager={false} onChanged={async () => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Change source unavailable');
    expect(screen.queryByText('Review a change')).not.toBeInTheDocument();
  });
});
