import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en-CA/chef.json';
import fr from '@shared/i18n/locales/fr-CA/chef.json';
import uk from '@shared/i18n/locales/uk/chef.json';
const state = vi.hoisted(() => ({ data: undefined as any }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.data, refetch: vi.fn() }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
import { BookingAttendancePanel } from './BookingAttendancePanel';
import { BookingOperationsStatus } from './BookingOperationsStatus';
const booking = { id: 10, bookingDate: '2026-10-02', startTime: '09:00', endTime: '17:00', status: 'confirmed' };
describe('attendance presentation (isolated static render)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T20:00:00Z')); state.data = { bookingId: 10, status: 'confirmed', checkinStatus: null, updatedAt: '2026-10-02T00:00:00Z', scheduledEnd: '2026-10-02T19:30:00Z', operationsComplete: true, visits: [], history: [] }; });
  afterEach(() => vi.useRealTimers());
  it('keeps optional unknown attendance separate from operations', () => {
    const html = renderToStaticMarkup(<BookingAttendancePanel bookingId={10} manager={false} onSaved={async () => {}} />);
    expect(html).toContain('bookingAttendanceEnded'); expect(html).toContain('bookingAttendanceUnknown');
    expect(html).not.toContain('bookingAttendanceNoShow');
  });
  it('renders explicit manager reporting disclosures and controls', () => {
    const html = renderToStaticMarkup(<BookingAttendancePanel bookingId={10} manager onSaved={async () => {}} />);
    expect(html).toContain('bookingAttendanceAbsent'); expect(html).toContain('bookingAttendanceMessage');
    expect(html).toContain('bookingAttendanceAttended');
  });
  it('shows completed operations for confirmed records without changing reservation state', () => {
    expect(renderToStaticMarkup(<BookingOperationsStatus booking={booking} />)).toContain('bookingAttendanceEnded');
    expect(booking.status).toBe('confirmed');
    expect(renderToStaticMarkup(<BookingOperationsStatus booking={{ ...booking, status: 'cancelled' }} />)).toBe('');
  });
  it('has matching attendance translation keys in every supported locale', () => {
    const keys = Object.keys(en).filter(key => key.startsWith('bookingAttendance'));
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of [fr, uk]) for (const key of keys) expect((locale as Record<string, string>)[key]).toBeTruthy();
  });
});
