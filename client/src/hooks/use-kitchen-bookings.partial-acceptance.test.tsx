/**
 * ApplicantDashboard → useKitchenBookings → ChefBookingsView: the list needs partialAcceptance
 * for the "Answer needed" pill (paListAnswerNeeded). The hook used to drop it while normalizing.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKitchenBookings } from './use-kitchen-bookings';

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'token' } },
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string }) => void) => {
    cb({ uid: 'chef-1' });
    return () => undefined;
  },
}));

const offer = {
  id: 'p1', state: 'waiting', intentId: 'pi_1', proposedAt: '2026-10-17T12:00:00.000Z',
  deadlineAt: '2026-10-18T12:00:00.000Z', equipment: [{ id: 31, status: 'cancelled' }],
  declined: [{ id: 31, name: 'Mixer', cents: 2500 }], oldTotalCents: 6100, newTotalCents: 3050,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/chef/bookings') && !String(url).includes('/details')) {
      return new Response(JSON.stringify([{
        id: 200, chefId: 3, kitchenId: 4, bookingDate: '2026-10-22T00:00:00.000Z',
        startTime: '10:00', endTime: '12:00', status: 'pending', paymentStatus: 'authorized',
        createdAt: '2026-10-17T10:00:00.000Z', updatedAt: '2026-10-17T12:00:00.000Z',
        kitchenName: 'PHASE0 Main Kitchen', locationName: 'Harbour', locationTimezone: 'America/St_Johns',
        partialAcceptance: offer, chargedAmount: 6100,
      }]));
    }
    return new Response(JSON.stringify([]));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('chef My bookings list data (/api/chef/bookings via ApplicantDashboard)', () => {
  it('keeps partialAcceptance so ChefBookingsView can show Answer needed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useKitchenBookings(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.bookings?.length).toBe(1));
    expect(result.current.bookings![0]).toMatchObject({
      id: 200, status: 'pending', paymentStatus: 'authorized', partialAcceptance: offer,
    });
  });
});
