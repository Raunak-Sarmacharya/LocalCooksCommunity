vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/layouts/ManagerBookingLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/layouts/ChefDashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => false }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }),
  apiGet: async (path: string) => { const response = await fetch(`/api${path}`); if (!response.ok) throw new Error('Policy unavailable'); return response.json(); } }));
const route = { search: '?chefId=380&location=47', id: 'inv-1' };
vi.mock('wouter', () => ({
  Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
  useSearch: () => route.search, useRoute: () => [true, { id: route.id }], useLocation: () => ['/', vi.fn()],
}));
import type React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManagerInvitationNewPage from './ManagerInvitationNewPage';
import ChefInvitationPage from './ChefInvitationPage';
import { ChefInvitationsBanner } from '@/components/booking/ChefInvitationsBanner';
import { CANCELLATION_DISCLOSURE_VERSION, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';

// An overnight kitchen: 9:00 a.m. to 1:00 a.m. (12:00 a.m. is the last hour of the same operating day).
const overnight = [...Array.from({ length: 15 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`), '00:00']
  .map(time => ({ time, available: 1, isFullyBooked: time === '12:00' }));
const pricing = { listSubtotalCents: 5000, offeredSubtotalCents: 4000, discount: { type: 'amount', value: 1000 }, taxCents: 600, serviceFeeCents: 280, totalCents: 4880, managerEstimatedPayoutCents: 4459 };
const cancellation = { noticeHours: 24, lateChargePercent: 50, refundDeadlineAt: '2026-10-26T12:30:00.000Z' };
const invitation = (over: Record<string, unknown> = {}) => ({ id: 'inv-1', version: 1, status: 'sent', kitchen: { id: 54, name: 'Harbour Kitchen', locationId: 47, locationName: 'Water St', photoUrl: null },
  chef: null, date: '2026-10-27', startTime: '10:00', endTime: '12:00', timezone: 'America/St_Johns', pricing, note: 'Tuesday mornings are quiet.',
  expiresAt: '2026-10-18T13:00:00Z', createdAt: '2026-10-16T13:00:00Z', bookingId: null, startAt: '2026-10-27T12:30:00.000Z',
  dayCount: 1, dated: false, days: [{ date: '2026-10-27', pricingMode: 'hourly', startTime: '10:00', endTime: '12:00', equipment: [] }],
  cancellation, canPay: true, canDecline: true, ...over });
const rules = { allowMultiDayBookings: false, multidayCreationEnabled: false, maxBookingDays: 7, minimumBookingWindowHours: 1, timezone: 'America/St_Johns' };
let routes: Array<[RegExp, unknown]>;
const calls: Array<{ url: string; method: string; body?: any }> = [];
const policyResponse = { policy: { id: 1, version: 1, noticeHours: 24, lateChargePercent: 50 }, timezone: 'America/St_Johns' };
beforeEach(() => {
  calls.length = 0;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes.find(([pattern]) => pattern.test(url));
    if (hit && typeof hit[1] === 'function') return hit[1]();
    return { ok: !!hit, json: async () => hit ? hit[1] : { error: 'not found' } };
  }));
});
afterEach(() => vi.unstubAllGlobals());
const mount = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
/** The house date field opens the shared calendar; pick the day in the shown month. */
const pickDate = async (label: string, monthDay: string) => {
  const [month, day] = monthDay.split(' ');
  fireEvent.click(screen.getByLabelText(label));
  const popover = await screen.findByRole('dialog');
  const button = Array.from(popover.querySelectorAll('button'))
    .find(candidate => candidate.textContent === day && !candidate.className.includes('outside'));
  if (!button) throw new Error(`No ${month} ${day} in the date picker`);
  fireEvent.click(button);
};

describe('kitchen: invite to book', () => {
  it('previews the exact price the chef will see (list price struck through), then sends it once', async () => {
    routes = [[/eligible-chefs/, { chefs: [{ id: 380, name: 'Sam Chef' }] }], [/\/api\/manager\/kitchens\/47$/, [{ id: 54, name: 'Harbour Kitchen' }]],
      [/kitchen-rules/, rules], [/\/slots\?date=/, overnight], [/invitations\/preview/, { pricing, expiresAt: '2026-10-18T13:00:00Z', available: true, warnings: [] }],
      [/\/api\/manager\/invitations\?/, { invitations: [] }], [/\/api\/manager\/invitations$/, invitation()]];
    mount(<ManagerInvitationNewPage />);
    await waitFor(() => expect(screen.getByLabelText('Chef')).toHaveTextContent('Sam Chef'));
    await pickDate('Date', 'October 27');
    fireEvent.click(screen.getByRole('radio', { name: '$ off' }));
    fireEvent.change(screen.getByLabelText('Dollars off the kitchen time'), { target: { value: '10' } });
    const preview = screen.getByTestId('invitation-preview');
    await waitFor(() => expect(preview).toHaveTextContent('Sam Chef pays$48.80'));
    expect(preview).toHaveTextContent('$50.00$40.00');
    expect(preview).toHaveTextContent('You receive about$44.59');
    const sent = calls.filter(call => call.url.includes('/preview')).at(-1)!.body;
    expect(sent).toMatchObject({ chefId: 380, kitchenId: 54, date: '2026-10-27', startTime: '10:00', endTime: '12:00', expiresInHours: 48, discount: { type: 'amount', value: 1000 } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByTestId('invitation-sent')).toHaveTextContent('Invitation sent to Sam Chef');
    expect(calls.filter(call => call.url.endsWith('/api/manager/invitations') && call.method === 'POST')).toHaveLength(1);
  });
  it("offers the kitchen's own hours for that day, overnight included, and marks booked hours", async () => {
    routes = [[/eligible-chefs/, { chefs: [{ id: 380, name: 'Sam Chef' }] }], [/\/api\/manager\/kitchens\/47$/, [{ id: 54, name: 'Harbour Kitchen' }]],
      [/kitchen-rules/, rules], [/\/slots\?date=/, overnight], [/invitations\/preview/, { pricing, expiresAt: '2026-10-18T13:00:00Z', available: true, warnings: [] }],
      [/\/api\/manager\/invitations\?/, { invitations: [] }]];
    mount(<ManagerInvitationNewPage />);
    await waitFor(() => expect(screen.getByLabelText('Chef')).toHaveTextContent('Sam Chef'));
    expect(screen.getByLabelText('Start time')).toBeDisabled();
    await pickDate('Date', 'October 26');
    await waitFor(() => expect(screen.getByLabelText('Start time')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Start time'));
    expect(await screen.findByRole('option', { name: '12:00 a.m.' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '12:00 p.m. · booked' })).toHaveAttribute('data-disabled');
    fireEvent.click(screen.getByRole('option', { name: '11:00 p.m.' }));
    fireEvent.click(screen.getByLabelText('Length'));
    fireEvent.click(screen.getByRole('option', { name: '2 hours' }));
    fireEvent.click(screen.getByLabelText('Length'));
    expect(screen.queryByRole('option', { name: '3 hours' })).not.toBeInTheDocument();
    await waitFor(() => expect(calls.filter(call => call.url.includes('/preview')).at(-1)?.body).toMatchObject({ startTime: '23:00', endTime: '01:00' }));
  });
  it('an unavailable time explains why and cannot be sent', async () => {
    routes = [[/eligible-chefs/, { chefs: [{ id: 380, name: 'Sam Chef' }] }], [/\/api\/manager\/kitchens\/47$/, [{ id: 54, name: 'Harbour Kitchen' }]],
      [/kitchen-rules/, rules], [/\/slots\?date=/, overnight], [/invitations\/preview/, { pricing, expiresAt: '2026-10-18T13:00:00Z', available: false, unavailableReason: 'Sam Chef already has a request for this time.', warnings: [] }],
      [/\/api\/manager\/invitations\?/, { invitations: [] }]];
    mount(<ManagerInvitationNewPage />);
    await waitFor(() => expect(screen.getByLabelText('Chef')).toHaveTextContent('Sam Chef'));
    await pickDate('Date', 'October 27');
    expect(await screen.findByText('Sam Chef already has a request for this time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  });
  it('offers several days, each with its own hours and equipment, at a discount off the listed total', async () => {
    const multiRules = { ...rules, allowMultiDayBookings: true, multidayCreationEnabled: true, maxBookingDays: 3 };
    const listed = { listSubtotalCents: 12000, offeredSubtotalCents: 10000, discount: { type: 'amount', value: 2000 },
      taxCents: 1500, serviceFeeCents: 650, totalCents: 12150, managerEstimatedPayoutCents: 11000 };
    routes = [[/eligible-chefs/, { chefs: [{ id: 380, name: 'Sam Chef' }] }], [/\/api\/manager\/kitchens\/47$/, [{ id: 54, name: 'Harbour Kitchen' }]],
      [/kitchen-rules/, multiRules],
      [/date-status/, { '2026-10-27': { hourly: true }, '2026-10-29': { hourly: true } }],
      [/equipment-listings/, { included: [{ id: 9, equipmentType: 'Prep table', brand: null, sessionRate: null }],
        rental: [{ id: 7, equipmentType: 'Convection oven', brand: 'Rational', sessionRate: 2500 }] }],
      [/\/slots\?date=/, overnight],
      [/invitations\/preview/, { pricing: listed, expiresAt: '2026-10-18T13:00:00Z', available: true, warnings: [] }],
      [/\/api\/manager\/invitations\?/, { invitations: [] }],
      [/\/api\/manager\/invitations$/, invitation({ dayCount: 2, dated: true, date: '2026-10-27' })]];
    mount(<ManagerInvitationNewPage />);
    await waitFor(() => expect(screen.getByLabelText('Chef')).toHaveTextContent('Sam Chef'));
    fireEvent.click(await screen.findByRole('gridcell', { name: /Tuesday, October 27, 2026/ }));
    fireEvent.click(await screen.findByRole('gridcell', { name: /Thursday, October 29, 2026/ }));
    const first = await screen.findByTestId('invitation-day-2026-10-27');
    const second = screen.getByTestId('invitation-day-2026-10-29');
    expect(first).toHaveTextContent('Rational Convection oven · $25.00 per day');
    expect(second).toHaveTextContent('Rational Convection oven · $25.00 per day');
    fireEvent.click(within(first).getByRole('checkbox', { name: /Rational Convection oven/ }));
    const preview = screen.getByTestId('invitation-preview');
    await waitFor(() => expect(preview).toHaveTextContent('Sam Chef pays$121.50'));
    expect(preview).toHaveTextContent('$120.00$100.00');
    expect(screen.getByText(/Discounts apply to the kitchen time only, not equipment./)).toBeInTheDocument();
    const drafted = calls.filter(call => call.url.includes('/preview')).at(-1)!.body;
    expect(drafted.days).toEqual([
      { date: '2026-10-27', pricingMode: 'hourly', equipmentIds: [9, 7],
        slots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '11:00', endTime: '12:00' }] },
      { date: '2026-10-29', pricingMode: 'hourly', equipmentIds: [9],
        slots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '11:00', endTime: '12:00' }] },
    ]);
    expect(drafted).not.toHaveProperty('date');
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    const sent = await screen.findByTestId('invitation-sent');
    expect(sent).toHaveTextContent('2 days · Tue, Oct 27');
    expect(calls.filter(call => call.url.endsWith('/api/manager/invitations') && call.method === 'POST')).toHaveLength(1);
  });
});

describe('chef: an invitation', () => {
  it('shows who, when, the note and the full price, and pays through checkout', async () => {
    routes = [[/cancellation-policy/, policyResponse], [/\/api\/chef\/invitations\/inv-1\/checkout/, { url: 'https://checkout.stripe.test/s' }], [/\/api\/chef\/invitations\/inv-1$/, invitation()]];
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
    mount(<ChefInvitationPage />);
    const page = await screen.findByTestId('chef-invitation');
    expect(page).toHaveTextContent('Harbour Kitchen invited you to book');
    expect(page).toHaveTextContent('Tuesday mornings are quiet.');
    expect(page).toHaveTextContent('You save $10.00 on the kitchen time.');
    expect(page).toHaveTextContent('your booking is confirmed as soon as you pay');
    const pay = screen.getByRole('button', { name: 'Review and pay $48.80' });
    await waitFor(() => expect(pay).toBeEnabled()); fireEvent.click(pay);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/s'));
    expect(calls.find(call => call.url.endsWith('/checkout'))?.body).toEqual({ equipmentIds: [], cancellationPolicyAccepted: true,
      cancellationPolicyVersion: 1, cancellationDisclosureVersion: CANCELLATION_DISCLOSURE_VERSION });
  });
  it("adds the kitchen's rental equipment at its listed price and pays for it in the same checkout", async () => {
    routes = [[/\/quote/, { subtotalCents: 6500, taxCents: 975, serviceFeeCents: 455, totalCents: 7930 }],
      [/equipment-listings/, { rental: [{ id: 7, equipmentType: 'Convection oven', brand: 'Rational', sessionRate: 2500 }] }],
      [/cancellation-policy/, policyResponse],
      [/\/checkout/, { url: 'https://checkout.stripe.test/s' }], [/\/api\/chef\/invitations\/inv-1$/, invitation()]];
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
    mount(<ChefInvitationPage />);
    fireEvent.click(await screen.findByRole('checkbox'));
    const pay = await screen.findByRole('button', { name: 'Review and pay $79.30' });
    expect(screen.getByTestId('chef-invitation')).toHaveTextContent('Rational Convection oven$25.00');
    expect(calls.find(call => call.url.endsWith('/quote'))?.body).toEqual({ equipmentIds: [7] });
    fireEvent.click(pay);
    await waitFor(() => expect(calls.find(call => call.url.endsWith('/checkout'))?.body).toEqual({ equipmentIds: [7], cancellationPolicyAccepted: true,
      cancellationPolicyVersion: 1, cancellationDisclosureVersion: CANCELLATION_DISCLOSURE_VERSION }));
  });
  it('lists every invited day with its hours and per-day equipment, then pays the whole set', async () => {
    const dated = invitation({ dated: true, dayCount: 2, date: '2026-10-27', startTime: '10:00', endTime: '12:00', extraTimeRateCents: 1001,
      pricing: { listSubtotalCents: 12000, offeredSubtotalCents: 10000, discount: { type: 'amount', value: 2000 },
        taxCents: 1500, serviceFeeCents: 650, totalCents: 12150 },
      days: [
        { date: '2026-10-27', pricingMode: 'hourly', startTime: '10:00', endTime: '12:00',
          equipment: [{ listingId: 9, name: 'Prep table', cents: 0 }] },
        { date: '2026-10-29', pricingMode: 'daily', startTime: '00:00', endTime: '00:00', equipment: [] },
      ] });
    routes = [[/\/quote/, { subtotalCents: 10000, listSubtotalCents: 12000, taxCents: 1500, serviceFeeCents: 650, totalCents: 12150, extraTimeRateCents: 5000 }],
      [/equipment-listings/, { rental: [{ id: 7, equipmentType: 'Convection oven', brand: 'Rational', sessionRate: 2500 }] }],
      [/cancellation-policy/, policyResponse], [/\/checkout/, { url: 'https://checkout.stripe.test/s' }],
      [/\/api\/chef\/invitations\/inv-1$/, dated]];
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
    mount(<ChefInvitationPage />);
    const page = await screen.findByTestId('chef-invitation');
    expect(page).toHaveTextContent('2 days · Tuesday, October 27');
    const days = screen.getByTestId('invitation-days');
    expect(days).toHaveTextContent('Tuesday, October 27 · 10:00 a.m.–12:00 p.m.');
    expect(days).toHaveTextContent('Thursday, October 29 · Full day');
    expect(days).toHaveTextContent('Prep table (included)');
    expect(page).toHaveTextContent(/One refund deadline for every day: October 26/);
    expect(page).toHaveTextContent('Your card is charged in full when payment completes.');
    expect(page).toHaveTextContent('Discounts apply to kitchen time only, not equipment.');
    await waitFor(() => expect(page).toHaveTextContent('Extra time: $50.00/hour if you ask for more time or stay past the end.'));
    await waitFor(() => expect(calls.filter(call => call.url.endsWith('/quote')).at(-1)?.body)
      .toEqual({ equipment: [{ date: '2026-10-27', equipmentIds: [9] }, { date: '2026-10-29', equipmentIds: [] }] }));
    const secondDay = within(days).getByText('Thursday, October 29 · Full day').closest('li')!;
    fireEvent.click(within(secondDay).getByRole('checkbox', { name: /Rational Convection oven/ }));
    await waitFor(() => expect(calls.filter(call => call.url.endsWith('/quote')).at(-1)?.body)
      .toEqual({ equipment: [{ date: '2026-10-27', equipmentIds: [9] }, { date: '2026-10-29', equipmentIds: [7] }] }));
    const pay = screen.getByRole('button', { name: 'Review and pay $121.50' });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/s'));
    expect(calls.find(call => call.url.endsWith('/checkout'))?.body).toEqual({
      equipment: [{ date: '2026-10-27', equipmentIds: [9] }, { date: '2026-10-29', equipmentIds: [7] }],
      cancellationPolicyAccepted: true, cancellationPolicyVersion: 1, cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION });
  });
  it('refetches and displays a changed policy after 409, and sends that version on the next payment attempt', async () => {
    let current = policyResponse, attempts = 0;
    const changed = { ...policyResponse, policy: { id: 2, version: 2, noticeHours: 72, lateChargePercent: 100 } };
    routes = [[/cancellation-policy/, () => ({ ok: true, json: async () => current })],
      [/\/checkout/, () => { attempts++; current = changed; return { ok: false, status: 409,
        json: async () => ({ error: 'The cancellation policy changed. Review the updated policy before paying.' }) }; }],
      [/\/api\/chef\/invitations\/inv-1$/, invitation()]];
    mount(<ChefInvitationPage />);
    const pay = await screen.findByRole('button', { name: 'Review and pay $48.80' });
    await waitFor(() => expect(pay).toBeEnabled());
    const oldSummary = screen.getByTestId('chef-invitation').textContent;
    fireEvent.click(pay);
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the updated policy before paying.');
    await waitFor(() => expect(pay).toBeEnabled());
    expect(calls.filter(call => call.url.includes('/cancellation-policy'))).toHaveLength(2);
    expect(screen.getByTestId('chef-invitation').textContent).not.toBe(oldSummary);
    expect(screen.getByTestId('chef-invitation')).toHaveTextContent('Cancel by Sat, Oct 24, 10:00 a.m.');
    expect(screen.getByTestId('chef-invitation')).toHaveTextContent('this booking isn’t refundable.');
    fireEvent.click(pay);
    await waitFor(() => expect(attempts).toBe(2));
    expect(calls.filter(call => call.url.endsWith('/checkout')).map(call => call.body.cancellationPolicyVersion)).toEqual([1, 2]);
  });
  it('keeps payment disabled when the cancellation policy cannot be loaded', async () => {
    routes = [[/\/api\/chef\/invitations\/inv-1$/, invitation()]];
    mount(<ChefInvitationPage />);
    expect(await screen.findByRole('button', { name: 'Review and pay $48.80' })).toBeDisabled();
    expect(calls.some(call => call.url.endsWith('/checkout'))).toBe(false);
  });
  it('declines with an optional reason', async () => {
    routes = [[/decline/, invitation({ status: 'declined' })], [/\/api\/chef\/invitations\/inv-1$/, invitation()]];
    mount(<ChefInvitationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Tell Harbour Kitchen why (optional)'), { target: { value: 'Booked elsewhere.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1)!);
    await waitFor(() => expect(calls.find(call => call.url.endsWith('/decline'))?.body).toEqual({ reason: 'Booked elsewhere.' }));
  });
  it('a closed invitation says why and offers another time', async () => {
    routes = [[/\/api\/chef\/invitations\/inv-1$/, invitation({ status: 'withdrawn' })]];
    mount(<ChefInvitationPage />);
    expect(await screen.findByText('Harbour Kitchen withdrew this invitation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review and pay/ })).not.toBeInTheDocument();
  });
  it('the dashboard banner lists only open invitations', async () => {
    routes = [[/\/api\/chef\/invitations$/, { invitations: [invitation(), invitation({ id: 'inv-2', status: 'expired' })] }]];
    mount(<ChefInvitationsBanner />);
    const banner = await screen.findByTestId('chef-invitations');
    expect(banner).toHaveTextContent('Harbour Kitchen invited you to book Tue, Oct 27 at 10:00 a.m. · $48.80');
    expect(screen.getAllByRole('link', { name: 'Review' })).toHaveLength(1);
  });
});
