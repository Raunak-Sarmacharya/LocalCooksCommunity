import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShopStatus } from './useSellerRevenue';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'chef' } }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'token' } } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([
  [],
  [{ id: 1, status: 'pending' }],
  [{ id: 1, status: 'approved', foodSafetyLicenseStatus: 'pending' }],
  [{ id: 1, status: 'approved', foodSafetyLicenseStatus: 'approved', foodEstablishmentCertUrl: 'cert', foodEstablishmentCertStatus: 'pending' }],
  [{ id: 1, status: 'approved', foodSafetyLicenseStatus: 'approved' }, { id: 2, status: 'pending' }],
].map(applications => ({ applications })))('does not request shop status for an ineligible seller: $applications', async ({ applications }) => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => applications }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderHook(() => useShopStatus(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(client.getQueryData(['/api/firebase/applications/my', 'chef'])).toBeDefined());
  expect(fetchMock.mock.calls.every(call => call[0] !== '/api/chef/seller/shop-status')).toBe(true);
});
it('loads shop status after the newest seller application is fully approved', async () => {
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.includes('applications/my') ? [{ id: 1, status: 'approved', foodSafetyLicenseStatus: 'approved' }] : { linked: true } }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useShopStatus(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.data?.linked).toBe(true));
  expect(fetchMock).toHaveBeenCalledWith('/api/chef/seller/shop-status', expect.anything());
});
