vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import booking from '../../../../shared/i18n/locales/en-CA/booking.json';

const fixture = vi.hoisted(() => ({ toast: vi.fn(), mutate: vi.fn(), earlier: null as any, checkoutResponse: null as any, urls: [] as string[], bodies: [] as any[],
  kitchen: { id: 4, name: 'Test Kitchen', locationId: 1, hourlyRate: 0, location: { id: 1, minimumBookingWindowHours: 0 } } }));
vi.mock('@/hooks/use-kitchen-bookings', () => ({ useKitchenBookings: () => ({ kitchens: [fixture.kitchen], createBooking: { mutate: fixture.mutate }, isLoadingKitchens: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (run: () => void) => run(), gate: null }) }));
vi.mock('@/hooks/use-unpaid-penalties', () => ({ useUnpaidPenaltiesCheck: () => ({ data: null }) }));
vi.mock('@/hooks/use-storage-pricing', () => ({ useStoragePricing: () => ({ totalPrice: 0, items: [] }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
vi.mock('@/lib/persisted-booking-prefs', () => ({ findPersistedBookingForKitchens: () => null, notifyBookingPrefsChanged: () => {} }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ i18n: { language: 'en-CA', resolvedLanguage: 'en-CA' },
  t: (key: string, options: any) => {
    if (typeof options === 'string') return options;
    const text = (booking as Record<string, string>)[key] ?? options?.defaultValue ?? key;
    return String(text).replace(/\{\{?(\w+)\}?\}/g, (_match, name) => String(options?.[name] ?? `{${name}}`));
  } }) }));
import KitchenBookingFlow from './KitchenBookingFlow';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  localStorage.clear(); fixture.toast.mockReset(); fixture.urls = []; fixture.bodies = [];
  fixture.earlier = { id: 10, referenceCode: 'KB-OLD111', status: 'pending', bookingDate: '2099-10-04T12:00:00.000Z', startTime: '09:00', endTime: '10:00', paymentTransaction: { amount: 2440 } };
  fixture.checkoutResponse = json({ sessionUrl: 'https://checkout.example/session' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    fixture.urls.push(url);
    if (url.includes('/cancellation-policy')) return { ok: true, json: async () => ({ policy: { id: 1, version: 1, noticeHours: 24, lateChargePercent: 100 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100] } }) } as any;
    if (url.includes('/api/firebase/chef/kitchen-applications/location/')) return json({ hasApplication: true, canBook: true, bookingEligibility: { canBook: true, status: 'approved', message: 'ok' } });
    if (url.includes('/api/chef/bookings/10/details')) return json(fixture.earlier);
    if (url.includes('/api/chef/bookings/checkout')) { fixture.bodies.push(JSON.parse(init.body)); return fixture.checkoutResponse; }
    return json(url.includes('/pricing') ? { hourlyRate: 100, dailyRate: 400, pricingModel: 'hourly', minimumBookingHours: 1 }
      : url.includes('/policy') ? { maxSlotsPerChef: 4 }
      : url.includes('/slots?') ? ['09:00', '10:00', '11:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: false }))
      : url.includes('equipment-listings') ? { included: [], rental: [] } : []);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(replacesBookingId?: number) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KitchenBookingFlow locationId={1} locationName="Harbour Kitchens" initialDateIso="2099-10-04" initialSlots={['09:00', '10:00']} replacesBookingId={replacesBookingId} onCancel={() => {}} onComplete={() => {}} />
  </QueryClientProvider>);
  // The restored hours show in the Start picker once the day's hours load.
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Start' })).toHaveTextContent(/9:00/));
}
const toConfirm = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^(Continue to payment|Confirm Booking)$/ })).toBeEnabled());
};
const submit = () => screen.getByRole('button', { name: /^(Continue to payment|Confirm Booking)$/ });

describe('changing a pending request (rebook first)', () => {
  it('says which request is being changed and that it stays until this one is sent', async () => {
    await open(10);
    const banner = await screen.findByTestId('change-request-banner');
    expect(banner).toHaveTextContent('Changing your request KB-OLD111 · Sun, Oct 4, 9:00 a.m.–10:00 a.m.Your current request stays until you send this one.');
    // No doubled full stop after the "a.m." of the time.
    expect(banner.textContent).not.toContain('a.m..');
  });

  it('asks for the hours with the earlier request’s own hours free (slots and calendar carry replaces)', async () => {
    await open(10);
    await screen.findByTestId('change-request-banner');
    const slots = fixture.urls.filter(url => url.includes('/slots?'));
    expect(slots.length).toBeGreaterThan(0);
    for (const url of slots) expect(url).toContain('replaces=10');
    for (const url of fixture.urls.filter(item => item.includes('/month-availability'))) expect(url).toContain('replaces=10');
  });

  it('adds one line to the consent: the earlier request, its exact hold amount, and that banks can take a few days', async () => {
    await open(10); await toConfirm();
    const line = await screen.findByTestId('change-request-consent');
    expect(line).toHaveTextContent('Your earlier request KB-OLD111 will be withdrawn and its $24.40 card hold released once you send this one. Banks can take a few days to show a released hold.');
    expect(line.textContent).not.toMatch(/free|pi_|cs_/i);
    expect(screen.getByTestId('checkout-consent')).toBeVisible();
  });

  it('uses neutral banner and consent wording for a legacy request with no public reference', async () => {
    fixture.earlier.referenceCode = null;
    await open(10);
    expect(await screen.findByTestId('change-request-banner')).toHaveTextContent('Changing your request');
    await toConfirm();
    const consent = await screen.findByTestId('change-request-consent');
    expect(consent).toHaveTextContent('$24.40 card hold');
    expect(`${screen.getByTestId('change-request-banner').textContent} ${consent.textContent}`).not.toMatch(/#10|KB-10|request 10/);
  });

  it('sends the earlier request id with the checkout so the server can verify it', async () => {
    await open(10); await toConfirm();
    fireEvent.click(submit());
    await waitFor(() => expect(fixture.bodies).toHaveLength(1));
    expect(fixture.bodies[0]).toMatchObject({ replacesBookingId: 10, kitchenId: 4 });
  });

  it('shows the server’s plain refusal when the kitchen answered meanwhile, and starts nothing', async () => {
    fixture.checkoutResponse = json({ error: 'Harbour Kitchens has already answered your earlier request, so it can’t be changed. Book a new time from the kitchen page.' }, 409);
    await open(10); await toConfirm();
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('has already answered your earlier request');
  });

  it('a normal booking shows no banner or extra consent line and sends no replaces', async () => {
    await open(); await toConfirm();
    expect(screen.queryByTestId('change-request-banner')).toBeNull();
    expect(screen.queryByTestId('change-request-consent')).toBeNull();
    expect(fixture.urls.some(url => url.includes('replaces='))).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(fixture.bodies).toHaveLength(1));
    expect(fixture.bodies[0]).not.toHaveProperty('replacesBookingId');
  });
});
