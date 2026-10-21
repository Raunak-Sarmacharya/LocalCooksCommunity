vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
// The dialog's job here is the quote/booking logic; the real DateField is a popover calendar
// whose month navigation would make these fixtures depend on the day the suite runs.
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));
import { ChangeBookingDialog, KitchenBookingChanges } from './KitchenBookingChanges';

const original = { date: '2030-11-10', windowStart: '06:00', slots: [{ startTime: '10:00', endTime: '11:00' }] };
const destination = { date: '2030-11-12', windowStart: '06:00', slots: [{ startTime: '14:00', endTime: '15:00' }, { startTime: '15:00', endTime: '16:00' }] };
const money = (over: Partial<Record<string, number>> = {}) => ({ oldTotalCents: 3050, newTotalCents: 6100, payCents: 3050, refundCents: 0, feeKeptCents: 0, currency: 'CAD', ...over });
const open = (over: Record<string, unknown> = {}) => ({ id: 'chg-1', state: 'authorized', revision: 2, original, destination, money: money(),
  decisionBy: '2030-11-09T12:00:00Z', freeCancelAfter: '2030-11-11T18:30:00Z', canDecide: false, canWithdraw: true, ...over });
let routes: Record<string, unknown>;
const calls: Array<{ url: string; body?: any }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find(pattern => url.includes(pattern));
    return { ok: true, json: async () => key ? routes[key] : {} };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('open change on the booking page', () => {
  it('nothing when no change is open', async () => {
    routes = { '/changes': { original, canRequest: { allowed: true }, timezone: 'America/St_Johns' } };
    const { container } = render(<KitchenBookingChanges bookingId={10} manager={false} counterpart="PHASE0 Main Kitchen" onChanged={async () => {}} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });
  it('chef: what was asked, until when, the hold, and a way to withdraw', async () => {
    routes = { '/changes': { original, canRequest: { allowed: false }, open: open(), timezone: 'America/St_Johns' } };
    render(<KitchenBookingChanges bookingId={10} manager={false} counterpart="PHASE0 Main Kitchen" onChanged={async () => {}} />);
    const row = await screen.findByTestId('booking-change-open');
    expect(row).toHaveTextContent(/You asked to move this booking to/);
    expect(row).toHaveTextContent(/PHASE0 Main Kitchen has until .* to answer\. Until then your booking stays/);
    expect(row).toHaveTextContent(/\$30\.50 is on hold on your card and charged only if they approve\./);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(calls.find(call => call.url.endsWith('/changes/chg-1/decision'))?.body).toEqual({ action: 'withdraw', revision: 2 }));
  });
  it('chef: a declined saved card offers another card, never a dead end', async () => {
    routes = { '/changes': { original, canRequest: { allowed: false }, open: open({ state: 'awaiting_payment', cardDeclined: true }), timezone: 'America/St_Johns' } };
    render(<KitchenBookingChanges bookingId={10} manager={false} counterpart="PHASE0 Main Kitchen" onChanged={async () => {}} />);
    expect(await screen.findByText(/Your saved card was declined, so the request wasn’t sent\. Nothing was charged\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with another card · $30.50' })).toBeInTheDocument();
  });
  it('kitchen: who asked, the money, the refund deadline it would move, Approve / Decline with an optional note', async () => {
    routes = { '/changes': { original, canRequest: { allowed: false }, open: open({ canDecide: true, canWithdraw: false, kitchenPayoutChangeCents: 2875 }), timezone: 'America/St_Johns' } };
    render(<KitchenBookingChanges bookingId={10} manager counterpart="Sam Chef" onChanged={async () => {}} />);
    const row = await screen.findByTestId('booking-change-open');
    expect(row).toHaveTextContent(/Sam Chef asked to move this booking to/);
    expect(row).toHaveTextContent(/The customer pays \$30\.50 more if you approve\./);
    expect(screen.getByTestId('change-kitchen-payout')).toHaveTextContent('Your payout goes up by $28.75, before the card processing fee.');
    expect(row).toHaveTextContent(/Their refund deadline would move to/);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Message to Sam Chef (optional)'), { target: { value: 'Closed that day.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline change' }));
    await waitFor(() => expect(calls.find(call => call.url.endsWith('/decision'))?.body).toEqual({ action: 'decline', revision: 2, message: 'Closed that day.' }));
  });
});

describe('Change date or time dialog', () => {
  it('shows a coded server error in the reader’s own words, with the item named', async () => {
    // The server sends English copy plus a stable code; the client must show the translated key, not the raw message.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false,
      json: async () => ({ error: 'Stand mixer is not available at the new time. Choose another time.', code: 'equipmentUnavailable', values: { item: 'Stand mixer' } }) })));
    render(<ChangeBookingDialog bookingId={10} kitchenId={54} kitchenName="PHASE0 Main Kitchen" timezone="America/St_Johns" open onOpenChange={() => {}} onChanged={async () => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Stand mixer isn’t available at the new time. Choose another time.');
    expect(alert).not.toHaveTextContent('Stand mixer is not available');
  });
  it('explains why when the booking can no longer be changed', async () => {
    routes = { '/changes': { original, canRequest: { allowed: false, reason: 'Changes close at your refund deadline.' }, timezone: 'America/St_Johns' } };
    render(<ChangeBookingDialog bookingId={10} kitchenId={54} kitchenName="PHASE0 Main Kitchen" timezone="America/St_Johns" open onOpenChange={() => {}} onChanged={async () => {}} />);
    expect(await screen.findByText('Changes close at your refund deadline.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send change request' })).not.toBeInTheDocument();
  });
  it('shows the exact money and the new refund deadline before sending, then sends the previewed request', async () => {
    const slots = ['10:00', '11:00', '14:00', '15:00', '16:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: false }));
    routes = { '/changes/preview': { destination, money: money(), decisionBy: '2030-11-09T12:00:00Z', freeCancelAfter: '2030-11-11T18:30:00Z', quoteHash: 'a'.repeat(64) },
      '/slots': slots, '/changes': { original, canRequest: { allowed: true }, timezone: 'America/St_Johns' } };
    const onOpenChange = vi.fn();
    render(<ChangeBookingDialog bookingId={10} kitchenId={54} kitchenName="PHASE0 Main Kitchen" timezone="America/St_Johns" open onOpenChange={onOpenChange} onChanged={async () => {}} />);
    await screen.findByRole('button', { name: /2:00/ });
    // The chef's own booking doesn't block its own hours.
    expect(calls.some(call => call.url.includes('/api/chef/kitchens/54/slots?date=2030-11-10&changing=10'))).toBe(true);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-11-12' } });
    fireEvent.click(await screen.findByRole('button', { name: /2:00/ }));
    fireEvent.click(screen.getByLabelText('Length'));
    fireEvent.click(screen.getByRole('option', { name: '2 hours' }));
    const preview = await screen.findByTestId('change-preview');
    expect(preview).toHaveTextContent('You’ll pay $30.50 more');
    expect(preview).toHaveTextContent(/Your refund deadline would move to/);
    expect(preview).toHaveTextContent(/The extra amount is held on your card and charged only if they approve\./);
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const sent = calls.find(call => call.url.endsWith('/api/bookings/10/changes') && call.body);
    expect(sent?.body).toMatchObject({ destination, quoteHash: 'a'.repeat(64) });
  });
  it('says why when the chosen length no longer fits after picking a later start', async () => {
    // 10:00 and 11:00 free, 12:00 taken (e.g. buffer before another booking): a 2-hour change can start at 10:00 but not 11:00.
    const slots = [['10:00', true], ['11:00', true], ['12:00', false]].map(([time, ok]) => ({ time, available: ok ? 1 : 0, capacity: 1, isFullyBooked: !ok }));
    routes = { '/slots': slots, '/changes': { original, canRequest: { allowed: true }, timezone: 'America/St_Johns' } };
    render(<ChangeBookingDialog bookingId={10} kitchenId={54} kitchenName="PHASE0 Main Kitchen" timezone="America/St_Johns" open onOpenChange={() => {}} onChanged={async () => {}} />);
    await screen.findByRole('button', { name: /11:00/ });
    fireEvent.click(screen.getByLabelText('Length'));
    fireEvent.click(screen.getByRole('option', { name: '2 hours' }));
    fireEvent.click(screen.getByRole('button', { name: /11:00/ }));

    expect(await screen.findByText(/the kitchen is free for 1 hour/)).toBeInTheDocument();
  });
});

describe('CP7: a dated booking changes as a whole day set', () => {
  const full = (date: string, equipmentIds: number[] = []) => ({ date, pricingMode: 'daily', windowStart: '09:00',
    slots: Array.from({ length: 8 }, (_, i) => ({ startTime: `${String(9 + i).padStart(2, '0')}:00`, endTime: `${String(10 + i).padStart(2, '0')}:00` })), equipmentIds });
  const days = { version: 'days-v1', days: [full('2030-11-04', [7]), full('2030-11-06', [7])] };
  const moved = { version: 'days-v1', days: [full('2030-11-05'), full('2030-11-07')] };
  it('kitchen: lists the old and the new days of the request', async () => {
    routes = { '/changes': { original: days, dated: true, canRequest: { allowed: false }, open: open({ original: days, destination: moved, canDecide: true, canWithdraw: false }), timezone: 'America/St_Johns' } };
    render(<KitchenBookingChanges bookingId={10} manager counterpart="Sam Chef" onChanged={async () => {}} />);
    const row = await screen.findByTestId('booking-change-open');
    expect(row).toHaveTextContent(/Tue, Nov 5 · 9:00.*5:00.*; Thu, Nov 7 · 9:00/);
    expect(row).toHaveTextContent(/Mon, Nov 4 · 9:00.*; Wed, Nov 6 · 9:00/);
  });
  it('chef: the day picker starts from the current days; an edit is priced as a days-v1 request and sent as previewed', async () => {
    const slots = Array.from({ length: 8 }, (_, i) => ({ time: `${String(9 + i).padStart(2, '0')}:00`, available: 1, capacity: 1, isFullyBooked: false }));
    const destination = { version: 'days-v1', days: [full('2030-11-04', [7]), full('2030-11-06', [])] };
    routes = { '/changes/preview': { destination, money: money({ newTotalCents: 2925, payCents: 0, refundCents: 120, feeKeptCents: 5 }), decisionBy: '2030-11-01T12:00:00Z',
      freeCancelAfter: '2030-11-03T09:00:00Z', quoteHash: 'b'.repeat(64) }, '/date-status': {}, '/slots': slots,
      '/equipment-listings': { rental: [{ id: 7, equipmentType: 'Mixer' }] }, '/changes': { original: days, dated: true, canRequest: { allowed: true }, timezone: 'America/St_Johns' } };
    const onOpenChange = vi.fn();
    render(<ChangeBookingDialog bookingId={10} kitchenId={54} kitchenName="PHASE0 Main Kitchen" timezone="America/St_Johns" open onOpenChange={onOpenChange} onChanged={async () => {}} />);
    await screen.findByTestId('dated-change-editor');
    // The booking's own days never block the picker.
    await waitFor(() => expect(calls.some(call => call.url.includes('/api/chef/kitchens/54/date-status?year=2030&month=10&changing=10'))).toBe(true));
    expect(screen.getByText('Choose different days, hours or equipment.')).toBeInTheDocument();
    const wednesday = await screen.findByTestId('change-day-2030-11-06');
    const mixer = await waitFor(() => { const box = wednesday.querySelector('input[type=checkbox]') as HTMLInputElement; expect(box).toBeTruthy(); return box; });
    expect(mixer.checked).toBe(true);
    fireEvent.click(mixer);
    const preview = await screen.findByTestId('change-preview');
    expect(preview).toHaveTextContent('$1.20');
    expect(calls.find(call => call.url.endsWith('/changes/preview'))?.body.destination).toMatchObject({ version: 'days-v1',
      days: [{ date: '2030-11-04', pricingMode: 'daily', equipmentIds: [7] }, { date: '2030-11-06', pricingMode: 'daily', equipmentIds: [] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.find(call => call.url.endsWith('/api/bookings/10/changes') && call.body)?.body).toMatchObject({ destination, quoteHash: 'b'.repeat(64) });
  });
});
