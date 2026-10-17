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
  const first = Number(fixture.times[0].slice(0, 2));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`${first % 12 || 12}:00.*${(first + 1) % 12 || 12}:00`) })).toBeEnabled(), { timeout: 3000 });
}
const hour = (start: number) => screen.getByRole('button', { name: new RegExp(`${start}:00.*${start === 12 ? 1 : start + 1}:00`) });
const selected = (start: number) => expect(hour(start).className).toContain('bg-[#E10939]');

describe('actual kitchen picker consecutive selection', () => {
  it('adds and removes an optional rental inline without opening a dialog', async () => {
    fixture.rental = [{ id: 17, equipmentType: 'mixer', sessionRate: 2500 }];
    await open(['09:00']);
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    const add = await screen.findByRole('button', { name: 'wfbAdd Mixer' });
    expect(add).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'wfbRemove Mixer' });
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'wfbAdd Mixer' })).toHaveAttribute('aria-pressed', 'false');
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
  it('adds adjacent hours, rejects a distant click and middle deselection, allows end removal', async () => {
    await open();
    fireEvent.click(hour(9)); fireEvent.click(hour(11));
    selected(9); expect(hour(11).className).not.toContain('bg-[#E10939]');
    fireEvent.click(hour(10)); fireEvent.click(hour(11)); fireEvent.click(hour(10));
    selected(10); expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose consecutive hours' }));
    fireEvent.click(hour(11)); expect(hour(11).className).not.toContain('bg-[#E10939]');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByText(/Confirm/, { selector: 'p[aria-live="polite"]' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.click(hour(12));
    expect(hour(12).className).not.toContain('bg-[#E10939]');
    fireEvent.click(hour(11)); selected(11);
    fireEvent.click(hour(10)); selected(10);
    fireEvent.click(screen.getByRole('button', { name: /Save visit time/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('clears a restored gap and blocks advancing below the minimum duration', async () => {
    fixture.minimum = 2;
    await open(['09:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' })));
    expect(hour(9).className).not.toContain('bg-[#E10939]');
    fireEvent.click(hour(9)); fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('at least 2') }));
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it('clears a restored selection with a held middle hour rather than buying around it', async () => {
    fixture.full = ['10:00']; await open(['09:00', '10:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' })));
    expect(hour(10)).toBeDisabled();
    expect(hour(10)).toHaveTextContent('wfbBooked');
    fireEvent.click(hour(9)); fireEvent.click(hour(11));
    expect(hour(11).className).not.toContain('bg-[#E10939]');
  });
  it('renders and continues an overnight adjacent restored selection in operating order', async () => {
    fixture.times = ['22:00', '23:00', '00:00'];
    await open(['23:00', '00:00']);
    expect(screen.getByRole('button', { name: /11:00.*12:00/ }).className).toContain('bg-[#E10939]');
    expect(screen.getByRole('button', { name: /12:00.*1:00/ }).className).toContain('bg-[#E10939]');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByText(/Confirm/, { selector: 'p[aria-live="polite"]' })).toBeInTheDocument();
  });
  it('keeps full-day selection intact and rejects malformed restored hours without crashing', async () => {
    fixture.rateMode = 'daily'; await open();
    await waitFor(() => selected(9)); selected(10); selected(11);
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.click(hour(12));
    expect(screen.getByRole('button', { name: /Save visit time/ })).toBeDisabled();
    expect(screen.getByText('A daily booking must include the full available operating day.')).toBeVisible();
    cleanup(); fixture.rateMode = 'hourly'; fixture.toast.mockClear();
    await open(['25:00']);
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your visit hours' }));
    expect(hour(9).className).not.toContain('bg-[#E10939]');
  });
});
