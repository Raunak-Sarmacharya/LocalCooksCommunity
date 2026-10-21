import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ enabled: true, allowed: true, limit: 3, payload: null as any, toast: vi.fn(),
  kitchen: { id: 4, name: 'Harbour Kitchen', locationId: 1, taxRatePercent: 15, location: { id: 1, minimumBookingWindowHours: 0 } } }));
vi.mock('@/hooks/use-kitchen-bookings', () => ({ useKitchenBookings: () => ({ kitchens: [f.kitchen], createBooking: { mutate: vi.fn() }, isLoadingKitchens: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: f.toast }) }));
vi.mock('@/hooks/use-booking-eligibility', () => ({ useBookingEligibility: () => ({ eligibility: { canBook: true } }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (run: () => void) => run(), gate: null }) }));
vi.mock('@/hooks/use-unpaid-penalties', () => ({ useUnpaidPenaltiesCheck: () => ({ data: null }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'token' } } }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: (namespace: any) => importTranslation(Array.isArray(namespace) ? namespace[0] : namespace) }));
import { useBookingTranslation as importTranslation } from '@/test/booking-i18n';
vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import KitchenBookingFlow from './KitchenBookingFlow';

const policy = { policy: { id: 1, version: 2, noticeHours: 24, lateChargePercent: 50 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24], chargeOptions: [50] } };
const rental = { id: 17, equipmentType: 'mixer', sessionRate: 250 };
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); f.enabled = true; f.allowed = true; f.limit = 3; f.payload = null;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-10-01T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    let data: any = [];
    if (url.includes('/checkout')) { f.payload = JSON.parse(String(options?.body)); return { ok: false, status: 409, json: async () => ({ error: 'Fixture stops before payment' }) }; }
    if (url.includes('/cancellation-policy')) data = policy;
    else if (url.includes('/pricing')) data = { hourlyRate: 1000, dailyRate: 4000, minimumBookingHours: 1, platformCommissionRate: .07, timezone: 'America/St_Johns' };
    else if (url.includes('/policy')) data = { multidayCreationEnabled: f.enabled, allowMultiDayBookings: f.allowed, maxBookingDays: f.limit, maxSlotsPerChef: 3 };
    else if (url.includes('/slots?')) data = ['09:00', '10:00', '11:00', '12:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: url.includes('2030-10-09') && time === '12:00' }));
    else if (url.includes('equipment-listings')) data = { included: [], rental: url.includes('date=2030-10-11') ? [] : [rental] };
    else if (url.includes('date-status') || url.includes('month-availability')) {
      const month = Number(new URL(url, 'http://localhost').searchParams.get('month'));
      data = Object.fromEntries(Array.from({ length: 31 }, (_, i) => {
        const date = `2030-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        const reason = ({ '2030-10-04': 'booked', '2030-10-05': 'closed', '2030-10-06': 'notice', '2030-10-08': 'weekly_limit', '2030-10-10': 'beyond_advance_window' } as Record<string, string>)[date];
        return [date, url.includes('date-status') ? { hourly: !reason, fullDay: !reason && date !== '2030-10-09', reason: reason ?? null, fullDayReason: reason ?? 'booked' } : !reason];
      }));
    }
    return { ok: true, json: async () => data };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KitchenBookingFlow locationId={1} locationName="Harbour" onCancel={() => {}} />
  </QueryClientProvider>);
  await screen.findByText('Choose your days');
  await waitFor(() => expect(day(7) ?? screen.getAllByRole('gridcell', { name: '7' })[0]).not.toHaveAttribute('aria-disabled', 'true'));
}
function day(number: number) {
  return Array.from(document.querySelectorAll('button')).find(button => button.textContent === String(number) && button.getAttribute('aria-label')?.includes('October'))!;
}
// One row per booked day, named by its date (Oct 7, 9 and 11, 2030 are a Monday, Wednesday and Friday).
const row = (date: number) => screen.getByRole('region', { name: new RegExp(`, October ${date}$`) });
const pick = (date: number, label: 'Start' | 'End', name: RegExp) => {
  fireEvent.click(within(row(date)).getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name }));
};
async function chooseDays(...numbers: number[]) {
  for (const number of numbers) fireEvent.click(day(number));
  fireEvent.click(screen.getByRole('button', { name: 'Choose hours' }));
  await waitFor(() => numbers.forEach(number => expect(within(row(number)).getByRole('radio', { name: /By the hour/ })).toBeInTheDocument()));
}

describe('the existing flow with more days', () => {
  it('selects nonconsecutive dates, announces count and explains count/span limits without removing choices', async () => {
    await open(); fireEvent.click(day(7)); fireEvent.click(day(9)); fireEvent.click(day(11));
    expect(screen.getByRole('status')).toHaveTextContent('3 days');
    expect(day(12)).toHaveAccessibleName(/Up to 3 days per booking/);
    fireEvent.click(day(12)); expect(screen.getByRole('status')).toHaveTextContent('Up to 3 days');
    fireEvent.click(day(11));
    expect(day(21)).not.toHaveAttribute('aria-disabled'); // first + 14 is allowed
    expect(day(22)).toHaveAccessibleName(/within 14 days/);
    fireEvent.click(day(7)); // moving the first date retains the other selected date
    expect(day(9)).toHaveAttribute('aria-selected', 'true');
  });
  it('opens on the Date step with every day picked on the kitchen page selected', async () => {
    sessionStorage.setItem('kitchen_dates_4', JSON.stringify({ from: new Date(2030, 9, 7), dates: ['2030-10-07', '2030-10-09', '2030-10-11'] }));
    await open();
    for (const number of [7, 9, 11]) expect(day(number)).toHaveAttribute('aria-selected', 'true');
    const yourDays = screen.getByRole('region', { name: 'Your days' });
    await waitFor(() => expect(within(yourDays).getAllByRole('listitem')).toHaveLength(3));
    expect(within(yourDays).getByText(/Wed, Oct 9/)).toBeInTheDocument();
    // Days already chosen: the line says to check them (not "Tap an available date"), and the list leads the calendar.
    expect(screen.getByText('Check your days, then choose hours. Tap a date to add or remove it.')).toBeInTheDocument();
    expect(screen.queryByText('Tap an available date to continue')).toBeNull();
    expect(yourDays.compareDocumentPosition(day(7)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await chooseDays();
    expect(row(11)).toBeInTheDocument();
  });
  it('makes unavailable reasons focusable and readable to keyboard and screen reader users', async () => {
    await open();
    for (const [number, reason] of [[4, 'Already booked'], [5, 'Kitchen closed'], [6, 'Too soon'], [8, 'Over your weekly hours limit'], [10, 'Beyond how far ahead you can book']] as const) {
      const button = day(number); expect(button).toHaveAccessibleName(new RegExp(reason)); expect(button).toHaveAttribute('aria-disabled', 'true');
      act(() => button.focus()); expect(button).toHaveFocus(); expect(screen.getByRole('status')).toHaveTextContent(reason);
      fireEvent.click(button); expect(button).not.toHaveAttribute('aria-selected', 'true');
    }
  });
  it('copies one day’s hours to the others, keeps a per-day full day, prices each day and sends the dated disclosure and payload', async () => {
    await open(); await chooseDays(7, 9, 11);
    pick(7, 'Start', /^9:00/);
    fireEvent.click(screen.getByRole('button', { name: 'Use these hours for all days' }));
    expect(within(row(11)).getByRole('combobox', { name: 'Start' })).toHaveTextContent(/9:00/);
    fireEvent.click(within(row(11)).getByRole('radio', { name: /Full day/ }));
    expect(within(row(9)).getByRole('radio', { name: /Full day/ })).toBeDisabled(); // partly booked: hourly still allowed
    pick(9, 'End', /^11:00/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Mixer' }));
    // The mixer isn't free on Oct 11, so that day can't be chosen; drop it from Oct 9.
    expect(screen.getByRole('button', { name: 'Fri, Oct 11' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Wed, Oct 9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirm' }));
    expect(await screen.findByText(/Your card is held for the whole booking/)).toBeInTheDocument();
    expect(screen.getAllByTestId('cancel-headline')).toHaveLength(1);
    expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Free to cancel until the kitchen accepts\. After that, cancel by .*Oct 6/);
    const summaries = screen.getAllByTestId('booking-price-summary');
    const confirm = summaries[summaries.length - 1];
    // Every line itemised: each day's kitchen time, each rental with its days, then tax, fee and total.
    expect(confirm).toHaveTextContent(/Mon, Oct 7 · 1 hour × \$10\.00\s*\$10\.00/);
    expect(confirm).toHaveTextContent(/Wed, Oct 9 · 2 hours × \$10\.00\s*\$20\.00/);
    expect(confirm).toHaveTextContent(/Fri, Oct 11 · Full day\s*\$40\.00/);
    expect(confirm).toHaveTextContent(/Mixer × 1 day\s*\$2\.50/);
    expect(confirm).toHaveTextContent('$10.88'); // HST rounded once
    expect(confirm).toHaveTextContent('$5.08'); // service fee rounded once
    expect(confirm).toHaveTextContent('$88.46');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(f.payload).not.toBeNull());
    expect(f.payload.cancellationDisclosureVersion).toBe('food-corridor-booking-first-day-v1');
    expect(f.payload).not.toHaveProperty('bookingDate');
    expect(f.payload.days).toEqual([
      { date: '2030-10-07', pricingMode: 'hourly', slots: [{ startTime: '09:00', endTime: '10:00' }], equipmentIds: [17] },
      { date: '2030-10-09', pricingMode: 'hourly', slots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }], equipmentIds: [] },
      { date: '2030-10-11', pricingMode: 'daily', slots: ['09:00','10:00','11:00','12:00'].map(startTime => ({ startTime, endTime: `${Number(startTime.slice(0,2)) + 1}:00` })), equipmentIds: [] },
    ]);
  });
  it('keeps a single selected day on the original steps and scalar checkout even when multi-day is enabled', async () => {
    await open(); await chooseDays(7); pick(7, 'Start', /^9:00/);
    expect(screen.queryByRole('button', { name: 'Use these hours for all days' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to confirm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(f.payload).not.toBeNull());
    expect(f.payload).not.toHaveProperty('days');
    expect(f.payload.cancellationDisclosureVersion).toBe('food-corridor-v3');
    expect(f.payload.selectedSlots).toEqual([{ startTime: '09:00', endTime: '10:00' }]);
  });
  it('retains the last remaining day’s own full-day choice when returning to a single date', async () => {
    await open(); await chooseDays(7, 11); pick(7, 'Start', /^9:00/);
    fireEvent.click(within(row(11)).getByRole('radio', { name: /Full day/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Change date' })); fireEvent.click(day(7));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose hours' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Choose hours' }));
    expect(screen.queryByRole('button', { name: 'Use these hours for all days' })).toBeNull();
    await waitFor(() => expect(within(row(11)).getByRole('radio', { name: /Full day/ })).toHaveAttribute('aria-checked', 'true'));
  });
  it.each(['enabled', 'allowed'] as const)('keeps the legacy calendar when %s is off', async rule => {
    f[rule] = false; await open(); expect(screen.queryByText(/Choose up to/)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('date-status'))).toBe(false);
  });
  it('restores all selected days and individual edits after refreshing the flow', async () => {
    await open(); await chooseDays(7, 9); pick(7, 'Start', /^9:00/);
    pick(9, 'Start', /^9:00/); pick(9, 'End', /^11:00/);
    cleanup(); await open(); expect(day(7)).toHaveAttribute('aria-selected', 'true'); expect(day(9)).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Choose hours' }));
    await waitFor(() => expect(within(row(9)).getByRole('combobox', { name: 'End' })).toHaveTextContent(/11:00/)); expect(row(9)).toHaveTextContent(/2 hours/);
    expect(within(row(7)).getByRole('combobox', { name: 'End' })).toHaveTextContent(/10:00/); expect(row(7)).toHaveTextContent(/1 hour/);
  });
  it('applies the kitchen hourly cap to a restored multi-day draft before checkout', async () => {
    sessionStorage.setItem('kitchen_booking_days_4', JSON.stringify({ version: 1, dates: ['2030-10-07', '2030-10-11'],
      template: { pricingMode: 'hourly', times: ['09:00', '10:00', '11:00', '12:00'] }, hours: {}, equipmentIds: [], excluded: {}, notes: '' }));
    await open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose hours' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Choose hours' }));
    // Four restored hours exceed the three-hour cap: each day says so, and the flow won't move on.
    await waitFor(() => expect(within(row(7)).getByRole('alert')).toHaveTextContent('These hours don’t work for this day.'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose your hours' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Choose your hours' }));
    expect(screen.getByText(/Check your hours for Oct 7/)).toBeInTheDocument();
    expect(f.payload).toBeNull();
  });
});
