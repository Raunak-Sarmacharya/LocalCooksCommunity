vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ toast: vi.fn(), mutate: vi.fn(), minimum: 1, full: [] as string[], rental: [] as any[],
  rateMode: 'hourly',
  times: ['09:00', '10:00', '11:00', '12:00'],
  kitchen: { id: 4, name: 'Test Kitchen', locationId: 1, hourlyRate: 0, location: { id: 1, minimumBookingWindowHours: 0 } } }));
vi.mock('@/hooks/use-kitchen-bookings', () => ({ useKitchenBookings: () => ({ kitchens: [fixture.kitchen], createBooking: { mutate: fixture.mutate }, isLoadingKitchens: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (run: () => void) => run(), gate: null }) }));
vi.mock('@/hooks/use-unpaid-penalties', () => ({ useUnpaidPenaltiesCheck: () => ({ data: null }) }));
vi.mock('@/hooks/use-storage-pricing', () => ({ useStoragePricing: () => ({ totalPrice: 0, items: [] }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
vi.mock('@/lib/persisted-booking-prefs', () => ({ findPersistedBookingForKitchens: () => null, notifyBookingPrefsChanged: () => {} }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, options: any) => typeof options === 'string' ? options : key.startsWith('sheet') ? (options?.defaultValue || key).replace(/\{(\w+)\}/g, (_: string, name: string) => options[name] ?? `{${name}}`) : options?.defaultValue || key }) }));
import KitchenBookingFlow from './KitchenBookingFlow';

beforeEach(() => {
  localStorage.clear(); fixture.toast.mockReset(); fixture.mutate.mockReset(); fixture.minimum = 1; fixture.rental = [];
  fixture.times = ['09:00', '10:00', '11:00', '12:00']; fixture.full = [];
  fixture.rateMode = 'hourly';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/cancellation-policy')) return { ok: true, json: async () => ({ policy: { id: 1, version: 1, noticeHours: 24, lateChargePercent: 100 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100] } }) } as any;
    const data = url.includes('/pricing') ? { hourlyRate: 100, dailyRate: 400, pricingModel: fixture.rateMode, minimumBookingHours: fixture.minimum,
      preparationReminderHours: 36, managerResponseBufferHours: 2, timezone: 'America/St_Johns' }
      : url.includes('/policy') ? { maxSlotsPerChef: 4 }
      : url.includes('/slots?') ? fixture.times.map(time => ({ time, available: 1, capacity: 1, isFullyBooked: fixture.full.includes(time) }))
      : url.includes('equipment-listings') ? { included: [], rental: fixture.rental } : [];
    return { ok: true, json: async () => data };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(slots: string[] = []) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KitchenBookingFlow locationId={1} locationName="Test Location" initialDateIso="2099-10-04" initialSlots={slots} onCancel={() => {}} onComplete={() => {}} />
  </QueryClientProvider>);
  // Hours loaded: the Start picker (by the hour) or the day's cost (full day) is showing.
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'bkStart' }) ?? screen.queryByTestId('day-cost')).toBeInTheDocument(), { timeout: 3000 });
}
const time = (value: string) => new Date(`2099-10-04T${value}:00`).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
const options = (label: 'bkStart' | 'bkEnd') => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  return screen.getAllByRole('option');
};
const choose = (label: 'bkStart' | 'bkEnd', name: RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name }));
};
const startsWith = (value: string) => new RegExp(`^${time(value).replace(/\./g, '\\.')}`);

// The hours step offers only valid ranges (Start, then End), so consecutive / minimum / maximum / booked-hour rules are
// enforced by what can be picked rather than by error toasts after a tap.
describe('actual kitchen picker consecutive selection', () => {
  it('adds and removes an optional rental inline without opening a dialog', async () => {
    fixture.rental = [{ id: 17, equipmentType: 'mixer', sessionRate: 2500 }];
    await open(['09:00']);
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    const add = await screen.findByRole('button', { name: 'bkEqAddNamed' });
    expect(add).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'bkEqRemoveNamed' });
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'bkEqAddNamed' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('shows the configured preparation lead and a friendly kitchen-zone response deadline', async () => {
    await open(['09:00']);
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    const next = screen.getByTestId('what-happens-next');
    expect(next.textContent).toContain('36 hours before your visit');
    expect(next.textContent).toMatch(/The kitchen has until .+Newfoundland Time to respond/);
    expect(next.textContent).not.toContain('America/St_Johns');
    expect(next.textContent).not.toContain('48 hours');
  });
  it('offers only free, back-to-back end times up to the chef maximum, and booked hours cannot start a range', async () => {
    fixture.times = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00']; fixture.full = ['10:00'];
    await open();
    const starts = options('bkStart');
    expect(starts.find(option => option.textContent?.startsWith(time('10:00')))).toHaveAttribute('aria-disabled', 'true');
    expect(starts.find(option => option.textContent?.startsWith(time('10:00')))?.textContent).toContain('wfbBooked');
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    choose('bkStart', startsWith('09:00'));
    // 10:00 is booked, so a 9:00 start can only run one hour.
    expect(options('bkEnd').map(option => option.textContent)).toEqual([`${time('10:00')} · bkHours`]);
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    choose('bkStart', startsWith('11:00'));
    // Four hours free from 11:00, capped at the chef maximum of 4.
    expect(options('bkEnd')).toHaveLength(4);
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    choose('bkEnd', new RegExp(`^${time('14:00').replace(/\./g, '\\.')}`));
    expect(screen.getByTestId('day-cost')).toHaveTextContent('bkHoursCost');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByText(/Confirm/, { selector: 'p[aria-live="polite"]' })).toBeInTheDocument();
  });
  it('never offers a range shorter than the minimum', async () => {
    fixture.minimum = 2;
    await open();
    const starts = options('bkStart');
    // 12:00 is the last hour: only one hour is left, under the two-hour minimum.
    expect(starts.find(option => option.textContent?.startsWith(time('12:00')))).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    choose('bkStart', startsWith('09:00'));
    expect(options('bkEnd').map(option => option.textContent)).toEqual([`${time('11:00')} · bkHours`, `${time('12:00')} · bkHours`, `${time('13:00')} · bkHours`]);
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it('clears a restored gap rather than buying around it', async () => {
    fixture.minimum = 2;
    await open(['09:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' })));
    expect(screen.getByRole('combobox', { name: 'bkStart' })).toHaveTextContent('bkChooseStart');
  });
  it('clears a restored selection with a held middle hour', async () => {
    fixture.full = ['10:00']; await open(['09:00', '10:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' })));
    expect(screen.getByRole('combobox', { name: 'bkStart' })).toHaveTextContent('bkChooseStart');
  });
  it('renders and continues an overnight adjacent restored selection in operating order', async () => {
    fixture.times = ['22:00', '23:00', '00:00'];
    await open(['23:00', '00:00']);
    expect(screen.getByRole('combobox', { name: 'bkStart' })).toHaveTextContent(time('23:00'));
    expect(screen.getByRole('combobox', { name: 'bkEnd' })).toHaveTextContent(time('01:00')); // the duration shows under the pickers, not in the End trigger
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByText(/Confirm/, { selector: 'p[aria-live="polite"]' })).toBeInTheDocument();
  });
  it('keeps a full-day selection intact and rejects malformed restored hours without crashing', async () => {
    fixture.rateMode = 'daily'; await open();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'bkFullDayRate' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByTestId('day-cost')).toHaveTextContent('bkFullDayCost');
    expect(screen.queryByRole('combobox', { name: 'bkStart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByText(/Confirm/, { selector: 'p[aria-live="polite"]' })).toBeInTheDocument();
    cleanup(); fixture.rateMode = 'hourly'; fixture.toast.mockClear();
    await open(['25:00']);
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' }));
    expect(screen.getByRole('combobox', { name: 'bkStart' })).toHaveTextContent('bkChooseStart');
  });
});
