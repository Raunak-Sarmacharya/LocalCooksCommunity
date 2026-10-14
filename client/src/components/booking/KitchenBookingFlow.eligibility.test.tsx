vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  toast: vi.fn(), mutate: vi.fn(), eligibilityBody: null as any, checkoutResponse: null as any, checkoutCalls: 0,
  kitchen: { id: 4, name: 'Test Kitchen', locationId: 1, hourlyRate: 0, location: { id: 1, minimumBookingWindowHours: 0 } },
}));
vi.mock('@/hooks/use-kitchen-bookings', () => ({ useKitchenBookings: () => ({ kitchens: [fixture.kitchen], createBooking: { mutate: fixture.mutate }, isLoadingKitchens: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (run: () => void) => run(), gate: null }) }));
vi.mock('@/hooks/use-unpaid-penalties', () => ({ useUnpaidPenaltiesCheck: () => ({ data: null }) }));
vi.mock('@/hooks/use-storage-pricing', () => ({ useStoragePricing: () => ({ totalPrice: 0, items: [] }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
vi.mock('@/lib/persisted-booking-prefs', () => ({ findPersistedBookingForKitchens: () => null, notifyBookingPrefsChanged: () => {} }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ i18n: { language: 'en-CA' },
  t: (key: string, options: any) => {
    if (typeof options === 'string') return options;
    return String(options?.defaultValue || key).replace(/\{(\w+)\}/g, (_match, name) => String(options?.[name] ?? `{${name}}`));
  } }) }));
import KitchenBookingFlow from './KitchenBookingFlow';

const approved = { canBook: true, status: 'approved', message: 'ok' };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  localStorage.clear(); fixture.toast.mockReset(); fixture.mutate.mockReset(); fixture.checkoutCalls = 0;
  fixture.eligibilityBody = { hasApplication: true, canBook: true, bookingEligibility: approved };
  fixture.checkoutResponse = json({ sessionUrl: 'https://checkout.example/session' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/firebase/chef/kitchen-applications/location/')) return json(fixture.eligibilityBody);
    if (url.includes('/api/chef/bookings/checkout')) { fixture.checkoutCalls += 1; return fixture.checkoutResponse; }
    return json(url.includes('/pricing') ? { hourlyRate: 100, dailyRate: 400, pricingModel: 'hourly', minimumBookingHours: 1 }
      : url.includes('/policy') ? { maxSlotsPerChef: 4 }
      : url.includes('/slots?') ? ['09:00', '10:00', '11:00'].map(time => ({ time, available: 1, capacity: 1, isFullyBooked: false }))
      : url.includes('equipment-listings') ? { included: [], rental: [] } : []);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KitchenBookingFlow locationId={1} locationName="Harbour Kitchens" initialDateIso="2099-10-04" initialSlots={['09:00']} onCancel={() => {}} onComplete={() => {}} />
  </QueryClientProvider>);
  await screen.findByText(/Choose consecutive hours for your visit/);
  await waitFor(() => expect(screen.getByRole('button', { name: /9:00.*10:00/ })).toBeEnabled());
}
const toConfirm = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  expect(screen.getByRole('tab', { name: /Confirm/ })).toHaveAttribute('aria-selected', 'true');
};
const submit = () => screen.getByRole('button', { name: /^(Checkout|Confirm Booking)$/ });

describe('booking is explained before it is attempted', () => {
  it('tier 2 (documents sent, awaiting final approval) shows the waiting banner and cannot continue or check out', async () => {
    fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'awaiting_final_approval', message: 'Your application and documents need final manager approval before you can book.' } };
    await open();
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText("Waiting for the kitchen's final approval")).toBeVisible();
    expect(within(banner).getByText(/Harbour Kitchens is reviewing your application and documents/)).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'View your application' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(screen.getByRole('tab', { name: /Confirm/ })).toHaveAttribute('aria-selected', 'false');
    expect(fixture.checkoutCalls).toBe(0);
    expect(fixture.mutate).not.toHaveBeenCalled();
  });

  it('an expired document says which one, when it expired, and links to renewal', async () => {
    fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'document_expired', message: 'x',
      actionUrl: '/dashboard?view=kitchen-requests&renewLocation=1', document: { key: 'foodSafetyLicense', label: 'Food Safety Certificate', expiry: '2026-10-13' } } };
    await open();
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('Your Food Safety Certificate expired on October 13, 2026. Upload a renewed one to book again.')).toBeVisible();
    expect(within(banner).getByText('Your existing bookings are not affected.')).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Upload a renewed document' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled());
  });

  it('a pending renewal on an expired document says it is under review', async () => {
    fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'renewal_under_review', message: 'x',
      actionUrl: '/dashboard?view=kitchen-requests&renewLocation=1', document: { key: 'foodSafetyLicense', label: 'Food Safety Certificate', expiry: '2026-10-13' } } };
    await open();
    expect(within(await screen.findByRole('alert')).getByText(/Your renewal is under review\. You can book again once Harbour Kitchens approves your renewed Food Safety Certificate\./)).toBeVisible();
  });

  it('ended access names the location and offers the kitchen and Local Cooks', async () => {
    fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'access_ended', message: 'x' } };
    await open();
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText(/Your access to Harbour Kitchens has ended\. Contact Harbour Kitchens or Local Cooks/)).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Message Harbour Kitchens' })).toBeVisible();
    expect(within(banner).getByRole('link', { name: 'Contact Local Cooks' })).toHaveAttribute('href', 'mailto:support@localcooks.ca');
  });

  it('shows no banner and keeps booking available when the chef is eligible', async () => {
    await open();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  });

  it('does not block when eligibility cannot be read; the server still decides', async () => {
    fixture.eligibilityBody = [];
    await open();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled());
  });
});

describe('checkout failures are never silent', () => {
  it.each([
    [403, { error: 'Your Food Safety Certificate has expired on October 13, 2026.', eligibility: { status: 'document_expired' } }, 'Your Food Safety Certificate has expired on October 13, 2026.'],
    [409, { error: 'That time was just booked by someone else.' }, 'That time was just booked by someone else.'],
    [422, { message: 'Choose hours inside the opening times.' }, 'Choose hours inside the opening times.'],
    [500, {}, 'Something went wrong on our side. Your card was not charged. Please try again in a moment.'],
  ])('a %s answer is shown inline as an alert and as a toast', async (status, body, expected) => {
    await open(); await toConfirm();
    fixture.checkoutResponse = json(body, status as number);
    if (status === 403) fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'document_expired', message: 'x', document: { key: 'foodSafetyLicense', label: 'x', expiry: '2026-10-13' } } };
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent === expected)).toBe(true));
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expected }));
    expect(fixture.checkoutCalls).toBe(1);
  });

  it('after a refused access the notice appears at the top and checkout stays disabled', async () => {
    await open(); await toConfirm();
    fixture.checkoutResponse = json({ error: 'Your access to Harbour Kitchens has ended.', eligibility: { status: 'access_ended' } }, 403);
    fixture.eligibilityBody = { hasApplication: true, canBook: false, bookingEligibility: { canBook: false, status: 'access_ended', message: 'x' } };
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText(/Your access to Harbour Kitchens has ended\. Contact/)).toBeVisible());
    await waitFor(() => expect(submit()).toBeDisabled());
  });

  it('a network failure is reported, not swallowed', async () => {
    await open(); await toConfirm();
    fixture.checkoutResponse = null;
    const original = global.fetch as any;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('/api/chef/bookings/checkout')) throw new TypeError('Failed to fetch'); return original(url); }));
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent === 'We could not reach Local Cooks. Check your connection and try again.')).toBe(true));
  });
});
