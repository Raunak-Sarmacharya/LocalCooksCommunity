import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ toast: vi.fn(), mutate: vi.fn(), minimum: 1, full: [] as string[],
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
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, options: any) => typeof options === 'string' ? options : options?.defaultValue || key }) }));
import KitchenBookingFlow from './KitchenBookingFlow';

beforeEach(() => {
  localStorage.clear(); fixture.toast.mockReset(); fixture.mutate.mockReset(); fixture.minimum = 1;
  fixture.times = ['09:00', '10:00', '11:00', '12:00']; fixture.full = [];
  fixture.rateMode = 'hourly';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const data = url.includes('/pricing') ? { hourlyRate: 100, dailyRate: 400, pricingModel: fixture.rateMode, minimumBookingHours: fixture.minimum }
      : url.includes('/policy') ? { maxSlotsPerChef: 4 }
      : url.includes('/slots?') ? fixture.times.map(time => ({ time, available: 1, capacity: 1, isFullyBooked: fixture.full.includes(time) }))
      : url.includes('equipment-listings') ? { included: [], rental: [] } : [];
    return { ok: true, json: async () => data };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(slots: string[] = []) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KitchenBookingFlow locationId={1} locationName="Test Location" initialDateIso="2099-10-04" initialSlots={slots} onCancel={() => {}} onComplete={() => {}} />
  </QueryClientProvider>);
  await screen.findByText(/Select consecutive hours for one continuous visit/);
  const first = Number(fixture.times[0].slice(0, 2));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`${first % 12 || 12}:00.*${(first + 1) % 12 || 12}:00`) })).toBeEnabled());
}
const hour = (start: number) => screen.getByRole('button', { name: new RegExp(`${start}:00.*${start === 12 ? 1 : start + 1}:00`) });
const selected = (start: number) => expect(hour(start).className).toContain('bg-[#F51042]');

describe('actual kitchen picker consecutive selection', () => {
  it('adds adjacent hours, rejects a distant click and middle deselection, allows end removal', async () => {
    await open();
    fireEvent.click(hour(9)); fireEvent.click(hour(11));
    selected(9); expect(hour(11).className).not.toContain('bg-[#F51042]');
    fireEvent.click(hour(10)); fireEvent.click(hour(11)); fireEvent.click(hour(10));
    selected(10); expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Select consecutive hours' }));
    fireEvent.click(hour(11)); expect(hour(11).className).not.toContain('bg-[#F51042]');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByRole('tab', { name: /Confirm/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.click(hour(12));
    expect(hour(12).className).not.toContain('bg-[#F51042]');
    fireEvent.click(hour(11)); selected(11);
    fireEvent.click(hour(10)); selected(10);
    fireEvent.click(screen.getByRole('button', { name: /Save time/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('clears a restored gap and blocks advancing below the minimum duration', async () => {
    fixture.minimum = 2;
    await open(['09:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your hours again' })));
    expect(hour(9).className).not.toContain('bg-[#F51042]');
    fireEvent.click(hour(9)); fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('at least 2') }));
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it('clears a restored selection with a held middle hour rather than buying around it', async () => {
    fixture.full = ['10:00']; await open(['09:00', '10:00', '11:00']);
    await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your hours again' })));
    expect(hour(10)).toBeDisabled();
    fireEvent.click(hour(9)); fireEvent.click(hour(11));
    expect(hour(11).className).not.toContain('bg-[#F51042]');
  });
  it('renders and continues an overnight adjacent restored selection in operating order', async () => {
    fixture.times = ['22:00', '23:00', '00:00'];
    await open(['23:00', '00:00']);
    expect(screen.getByRole('button', { name: /11:00.*12:00/ }).className).toContain('bg-[#F51042]');
    expect(screen.getByRole('button', { name: /12:00.*1:00/ }).className).toContain('bg-[#F51042]');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByRole('tab', { name: /Confirm/ })).toHaveAttribute('aria-selected', 'true');
  });
  it('keeps full-day selection intact and rejects malformed restored hours without crashing', async () => {
    fixture.rateMode = 'daily'; await open();
    await waitFor(() => selected(9)); selected(10); selected(11);
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.click(hour(12));
    expect(screen.getByRole('button', { name: /Save time/ })).toBeDisabled();
    expect(screen.getByText('A daily booking must include the full available operating day.')).toBeVisible();
    cleanup(); fixture.rateMode = 'hourly'; fixture.toast.mockClear();
    await open(['25:00']);
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose your hours again' }));
    expect(hour(9).className).not.toContain('bg-[#F51042]');
  });
});
