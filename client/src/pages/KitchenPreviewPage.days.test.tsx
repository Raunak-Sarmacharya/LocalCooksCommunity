import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ multi: true }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'chef' }, loading: false }) }));
vi.mock('@/lib/firebase', () => ({ auth: null }));
vi.mock('wouter', () => ({ useLocation: () => ['/kitchen-preview/47', vi.fn()], useSearch: () => '' }));
vi.mock('@/i18n/booking-ns', async () => ({ bt: (await import('@/test/booking-i18n')).useBookingTranslation('booking').t }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue ?? (key === 'pickDaysHint' ? `Pick up to ${options.count}` : key), i18n: { language: 'en-CA' } }) }));
import { GuestHoursCard } from './KitchenPreviewPage';

const open = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, isAvailable: true, startTime: '09:00', endTime: '17:00' }));
beforeEach(() => {
  sessionStorage.clear(); f.multi = true; Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-10-01T12:00:00'));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let data: any = {};
    if (url.includes('booking-estimate')) data = { minimumBookingHours: 1, allowMultiDayBookings: f.multi, multidayCreationEnabled: true, maxBookingDays: 3 };
    else if (url.includes('date-status') || url.includes('month-availability')) {
      const month = Number(new URL(url, 'http://localhost').searchParams.get('month'));
      data = Object.fromEntries(Array.from({ length: 31 }, (_, i) => {
        const date = `2030-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        const booked = date === '2030-10-04';
        return [date, url.includes('date-status') ? { hourly: !booked, fullDay: !booked && date !== '2030-10-09', reason: booked ? 'booked' : null, fullDayReason: 'booked' } : !booked];
      }));
    }
    return { ok: true, json: async () => data };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const renderCard = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <GuestHoursCard kitchenId="54" locationId="47" kitchenName="Harbour" kitchenRateParts={['$25/hr']} availability={open as any} calendarOpen canBook />
</QueryClientProvider>);
const day = (n: number) => Array.from(document.querySelectorAll('button')).find(cell => cell.textContent === String(n) && cell.getAttribute('aria-label')?.includes('October'))!;

it('picks several days under the booking rules and saves them with the first day as from', async () => {
  renderCard();
  await waitFor(() => expect(day(9)).toHaveAccessibleName(/Not every hour is free/));
  expect(day(4)).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(day(7)); fireEvent.click(day(9)); fireEvent.click(day(11));
  expect(screen.getByTestId('preview-days-field')).toHaveTextContent('3 days · Mon, Oct 7 – Fri, Oct 11');
  expect(day(12)).toHaveAccessibleName(/Up to 3 days per booking/);
  const saved = JSON.parse(sessionStorage.getItem('kitchen_dates_54')!);
  expect(saved.dates).toEqual(['2030-10-07', '2030-10-09', '2030-10-11']);
  expect(new Date(saved.from).getDate()).toBe(7);
});

it('keeps the single typed date when the kitchen takes one day per booking', async () => {
  f.multi = false;
  renderCard();
  await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
  expect(screen.queryByTestId('preview-days-field')).toBeNull();
});
