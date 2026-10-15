import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSettingImpact } from './setting-impact';

const getIdToken = vi.hoisted(() => vi.fn(async () => 'manager-token'));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken } } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('fetches authenticated manager bookings on a cold cache', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify([{ kitchenId: 1, status: 'pending', bookingDate: '2026-10-15', startTime: '10:00' }]),
    { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSettingImpact(1), { wrapper });
  expect(result.current.impactFetching).toBe(true);
  await waitFor(() => expect(result.current.impact).toEqual({ upcoming: 0, inSession: 0, pending: 1 }));
  expect(fetcher).toHaveBeenCalledWith('/api/manager/bookings', { credentials: 'include',
    headers: { Authorization: 'Bearer manager-token', 'Content-Type': 'application/json' } });
  client.clear();
});
