import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { TourRequestAccess } from '@shared/tour-request-access';
import { useTourRequestAccess } from './use-tour-request-access';
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(value: TourRequestAccess) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['/api/viewings/request-access', 'chef-1', 40], value);
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => value }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('changes confirmed to ended at its exact end and still refreshes the server eligibility', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T10:29:59Z'));
  const value: TourRequestAccess = { canRequest: false, reason: 'confirmed', authorization: null,
    tour: { id: 77, kind: 'confirmed', scheduledAt: '2026-10-08T10:00:00Z', durationMinutes: 30 } };
  const fetcher = setup(value);
  const { result } = renderHook(() => useTourRequestAccess(40, 'chef-1'), { wrapper });
  await act(async () => { await Promise.resolve(); });
  const initialCalls = fetcher.mock.calls.length;
  value.tour!.kind = 'ended'; value.reason = 'ended';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.data).toMatchObject({ canRequest: false, tour: { id: 77, kind: 'ended' } });
  expect(fetcher.mock.calls.length).toBeGreaterThan(initialCalls);
});
it('refreshes an expired pending request at the start without waiting for polling', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T09:59:59Z'));
  const value: TourRequestAccess = { canRequest: false, reason: 'pending', authorization: null,
    tour: { id: 77, kind: 'pending', scheduledAt: '2026-10-08T10:00:00Z', durationMinutes: 30 } };
  setup(value);
  const { result } = renderHook(() => useTourRequestAccess(40, 'chef-1'), { wrapper });
  await act(async () => { await Promise.resolve(); });
  value.canRequest = true; value.reason = null; value.tour!.kind = 'failed';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.data?.canRequest).toBe(true);
});
it('removes unused permission access at expiry, including when the refresh fails', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  const value: TourRequestAccess = { canRequest: true, reason: null, tour: null,
    authorization: { id: 5, expiresAt: '2026-10-08T10:00:01Z', recovery: false } };
  const fetcher = setup(value);
  const { result } = renderHook(() => useTourRequestAccess(40, 'chef-1'), { wrapper });
  await act(async () => { await Promise.resolve(); });
  fetcher.mockResolvedValue({ ok: false, json: async () => value });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.data?.canRequest).toBe(false);
});
it('rejects a malformed eligibility response and isolates the cache by chef', async () => {
  setup({ canRequest: true, reason: null, authorization: null, tour: null });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  const { result } = renderHook(() => useTourRequestAccess(40, 'chef-2'), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
